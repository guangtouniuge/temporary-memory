import json
import os
import re
import shlex
import time
from pathlib import Path

import paramiko

ROOT = '/www/wwwroot/geoskill.7chacha.com'
UNIT = '/etc/systemd/system/geoskill-commercial-api.service'
NGINX = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
SERVICE = 'geoskill-commercial-api.service'
RELEASE_PREFIXES = (
    'pricing-', 'management-', 'ui-current-dist-', 'news2-', 'gallery-upload-',
    'writing-', 'provider-auto-', 'ui-no-social-inject-', 'ui-social-current-',
    'provider-business-', 'social-tasks-',
)


def cleanup_command(keep):
    prefixes = ','.join(repr(item) for item in RELEASE_PREFIXES)
    keep_names = ','.join(repr(item.rstrip('/').split('/')[-1]) for item in keep if item)
    return (
        "python3 -c "
        + shlex.quote(
            "import pathlib,shutil;"
            f"root=pathlib.Path({ROOT + '/releases'!r}).resolve();"
            f"keep={{{keep_names}}};"
            f"prefixes=({prefixes},);"
            "removed=[];"
            "[ (shutil.rmtree(p), removed.append(p.name)) "
            "for p in list(root.iterdir()) "
            "if p.is_dir() and p.resolve().parent==root and p.name not in keep and p.name.startswith(prefixes) ];"
            "print('cleaned_releases=' + str(len(removed)))"
        )
    )


def main():
    password = os.environ['GEO_DEPLOY_PASSWORD']
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.connect('geoskill.7chacha.com', username='root', password=password, timeout=20)

    def run(command, timeout=240):
        _, out, err = client.exec_command(command, timeout=timeout)
        value, error = out.read().decode(), err.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError(error or value)
        return value.strip()

    changed_unit = False
    changed_nginx = False
    original_unit = ''
    original_nginx = ''
    release = ''
    try:
        run("python3 -c \"import pathlib,json,sys; rows=[json.loads(p.read_text()) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; sys.exit(1 if any(r.get('job',{}).get('status') in ('queued','running') for r in rows) else 0)\"")
        with client.open_sftp() as sftp:
            original_unit = sftp.file(UNIT).read().decode()
            original_nginx = sftp.file(NGINX).read().decode()
        match = re.search(r'^ExecStart=(/\S+/node) (' + re.escape(ROOT) + r'/releases/\S+)/server/geo-api-server.mjs$', original_unit, re.M)
        if not match:
            raise RuntimeError('Unexpected service target')
        node, previous = match.groups()
        roots = set(re.findall(r'\broot\s+([^;]+);', original_nginx))
        if len(roots) != 1:
            raise RuntimeError('Expected one nginx root')
        previous_root = roots.pop()
        if not previous_root.startswith(ROOT + '/releases/'):
            raise RuntimeError('Unexpected nginx root')

        stamp = time.strftime('%Y%m%d-%H%M%S')
        release = f'{ROOT}/releases/pricing-{stamp}'
        backup = f'/root/.geoskill/backups/pricing-{stamp}'
        run(f'mkdir -p {shlex.quote(backup)} && chmod 700 {shlex.quote(backup)} && cp {shlex.quote(UNIT)} {shlex.quote(backup)}/service.conf && cp {shlex.quote(NGINX)} {shlex.quote(backup)}/nginx.conf')
        run('cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release), timeout=240)
        with client.open_sftp() as sftp:
            sftp.put('deploy/management-release.tgz', release + '/release.tgz')
            with sftp.file(release + '/service-before.conf', 'w') as f:
                f.write(original_unit)
            with sftp.file(release + '/nginx-before.conf', 'w') as f:
                f.write(original_nginx)
        run('tar -xzf ' + shlex.quote(release + '/release.tgz') + ' -C ' + shlex.quote(release), timeout=240)
        run(shlex.quote(node) + ' --check ' + shlex.quote(release + '/server/geo-api-server.mjs'))
        with client.open_sftp() as sftp:
            changed_unit = True
            with sftp.file(UNIT, 'w') as f:
                f.write(original_unit.replace(previous + '/server/geo-api-server.mjs', release + '/server/geo-api-server.mjs'))
            changed_nginx = True
            with sftp.file(NGINX, 'w') as f:
                f.write(original_nginx.replace(previous_root, release + '/dist'))
        run('nginx -t && systemctl daemon-reload && systemctl restart ' + SERVICE + ' && sleep 2 && systemctl is-active --quiet ' + SERVICE + ' && systemctl reload nginx')
        for path in ['/gongju/agents', '/gongju/skill', '/gongju/geo']:
            status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + path))
            if status != '200':
                raise RuntimeError('Login page check failed: ' + path + ' ' + status)
        status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' 'https://geoskill.7chacha.com/api/state?key=geo.articleRows'")
        if status != '401':
            raise RuntimeError('Anonymous data boundary failed: ' + status)
        cleaned = run(cleanup_command([release, previous]), timeout=300)
        result = {'release': release, 'backup': backup, 'previous': previous, 'status': 'deployed', 'cleanup': cleaned}
        Path('outputs/deployment-pricing.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        if changed_nginx and original_nginx:
            with client.open_sftp() as sftp:
                with sftp.file(NGINX, 'w') as f:
                    f.write(original_nginx)
            run('nginx -t && systemctl reload nginx')
        if changed_unit and original_unit:
            with client.open_sftp() as sftp:
                with sftp.file(UNIT, 'w') as f:
                    f.write(original_unit)
            run('systemctl daemon-reload && systemctl restart ' + SERVICE)
        if release:
            run(cleanup_command([previous]), timeout=300)
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
