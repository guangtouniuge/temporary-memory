import json
import os
import re
import shlex
import tarfile
import time
from pathlib import Path
from html.parser import HTMLParser

import paramiko


ROOT = '/www/wwwroot/geoskill.7chacha.com'
UNIT = '/etc/systemd/system/geoskill-commercial-api.service'
SERVICE = 'geoskill-commercial-api.service'
NGINX = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
ENV_PATH = '/root/.geoskill/commercial.env'
MEITICAIGOU_ENV = os.environ.get('MEITICAIGOU_ENV', 'prod').strip().lower()
MEITICAIGOU_CONFIG = {
    'test': {
        'base': 'http://39.108.71.152:8990',
        'key': '985dd6223c9c7c91dd221e7392d4546b',
        'label': 'meiticaigou-test',
    },
    'prod': {
        'base': 'http://mcapi.meiticaigou.com',
        'key': '24acb59e54ee38f4616bd852962da811',
        'label': 'meiticaigou-prod',
    },
}


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for key in ['src', 'href']:
            value = values.get(key)
            if value and value.startswith('/gongju/'):
                self.assets.append(value)


def update_env(text):
    if MEITICAIGOU_ENV not in MEITICAIGOU_CONFIG:
        raise RuntimeError('MEITICAIGOU_ENV must be test or prod')
    target = MEITICAIGOU_CONFIG[MEITICAIGOU_ENV]
    settings = {
        'MEITICAIGOU_BASE_URL': target['base'],
        'MEITICAIGOU_APP_KEY': target['key'],
    }
    lines = [line for line in text.splitlines() if line.split('=', 1)[0] not in settings]
    return '\n'.join(lines + [f'{key}={value}' for key, value in settings.items()]) + '\n'


def main():
    if not Path('dist/index.html').exists():
        raise RuntimeError('Run npm run build first')
    password = os.environ.get('GEO_DEPLOY_PASSWORD')
    if not password:
        raise RuntimeError('GEO_DEPLOY_PASSWORD is required')

    archive_path = Path('deploy/news2-ui.tgz')
    archive_path.parent.mkdir(exist_ok=True)
    parser = AssetParser()
    parser.feed(Path('dist/index.html').read_text(encoding='utf-8'))
    asset_urls = ['/gongju/geo', *parser.assets]
    with tarfile.open(archive_path, 'w:gz') as archive:
        archive.add('dist', arcname='dist')

    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.connect('geoskill.7chacha.com', username='root', password=password, timeout=20)

    def run(command, timeout=120):
        _, out, err = client.exec_command(command, timeout=timeout)
        value, error = out.read().decode(), err.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError(error or value)
        return value.strip()

    changed_unit = False
    changed_nginx = False
    changed_env = False
    original_unit = ''
    original_nginx = ''
    original_env = ''
    release = ''
    previous = ''
    try:
        run("python3 -c \"import pathlib,json,sys; rows=[json.loads(p.read_text()) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; sys.exit(1 if any(r['job']['status'] in ('queued','running') for r in rows) else 0)\"")
        with client.open_sftp() as sftp:
            with sftp.file(UNIT) as f:
                original_unit = f.read().decode()
            with sftp.file(NGINX) as f:
                original_nginx = f.read().decode()
            with sftp.file(ENV_PATH) as f:
                original_env = f.read().decode()
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

        release = ROOT + '/releases/news2-' + str(int(time.time()))
        run('test ! -e ' + shlex.quote(release) + ' && cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release), timeout=240)

        files = [
            'server/geo-api-server.mjs',
            'server/media-catalog.mjs',
            'server/news-publishing.mjs',
            'server/meiticaigou-client.mjs',
            'server/media-classification.mjs',
            'server/b2b-catalog.mjs',
            'server/b2b-areas.json',
            'server/xiaoqingwa-client.mjs',
            'server/news-assets.mjs',
            'server/news-orders.mjs',
            'server/article-format.mjs',
        ]
        with client.open_sftp() as sftp:
            for path in files:
                sftp.put(path, release + '/' + path)
            sftp.put(str(archive_path), release + '/ui.tgz')
            with sftp.file(release + '/service-before.conf', 'w') as f:
                f.write(original_unit)
            with sftp.file(release + '/nginx-before.conf', 'w') as f:
                f.write(original_nginx)
            with sftp.file(release + '/commercial-before.env', 'w') as f:
                f.write(original_env)
            sftp.chmod(release + '/commercial-before.env', 0o600)

        run(shlex.quote(node) + ' --check ' + shlex.quote(release + '/server/geo-api-server.mjs'))
        run('tar -xzf ' + shlex.quote(release + '/ui.tgz') + ' -C ' + shlex.quote(release) + ' && test -f ' + shlex.quote(release + '/dist/index.html'))
        with client.open_sftp() as sftp:
            changed_env = True
            with sftp.file(ENV_PATH, 'w') as f:
                f.write(update_env(original_env))
            sftp.chmod(ENV_PATH, 0o600)
            changed_unit = True
            with sftp.file(UNIT, 'w') as f:
                f.write(original_unit.replace(previous + '/server/geo-api-server.mjs', release + '/server/geo-api-server.mjs'))
            changed_nginx = True
            with sftp.file(NGINX, 'w') as f:
                f.write(original_nginx.replace(previous_root, release + '/dist'))

        run('systemctl daemon-reload && systemctl restart ' + SERVICE + ' && sleep 2 && systemctl is-active --quiet ' + SERVICE)
        run('nginx -t && systemctl reload nginx')
        status = run("curl --max-time 15 -s -o /dev/null -w '%{http_code}' https://geoskill.7chacha.com/api/state?key=geo.projectRows")
        if status != '401':
            raise RuntimeError('Authentication check failed: ' + status)
        for url in asset_urls:
            status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + url))
            if status != '200':
                raise RuntimeError('UI asset unavailable: ' + url + ' ' + status)
        result = {'release': release, 'previous': previous, 'env': MEITICAIGOU_CONFIG[MEITICAIGOU_ENV]['label'], 'testRecordsCreated': 0}
        Path('outputs/deployment-meiticaigou-news2.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        if changed_nginx and original_nginx:
            with client.open_sftp() as sftp:
                with sftp.file(NGINX, 'w') as f:
                    f.write(original_nginx)
            run('nginx -t && systemctl reload nginx')
        if changed_env and original_env:
            with client.open_sftp() as sftp:
                with sftp.file(ENV_PATH, 'w') as f:
                    f.write(original_env)
                sftp.chmod(ENV_PATH, 0o600)
        if changed_unit and original_unit:
            with client.open_sftp() as sftp:
                with sftp.file(UNIT, 'w') as f:
                    f.write(original_unit)
            run('systemctl daemon-reload && systemctl restart ' + SERVICE)
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
