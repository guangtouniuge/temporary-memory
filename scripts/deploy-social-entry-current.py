"""Deploy current social client assets into the active UI release layout."""
import hashlib
import json
import os
import re
import shlex
import time
from pathlib import Path

import paramiko


ROOT = '/www/wwwroot/geoskill.7chacha.com'
CONFIG = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
SERVICE = 'geoskill-commercial-api.service'


def main():
    password = os.environ.get('GEO_DEPLOY_PASSWORD')
    if not password:
        raise RuntimeError('GEO_DEPLOY_PASSWORD is required')
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.connect('geoskill.7chacha.com', username='root', password=password, timeout=20)

    def run(command, timeout=120):
        _, out, err = client.exec_command(command, timeout=timeout)
        value, error = out.read().decode(), err.read().decode()
        if out.channel.recv_exit_status():
            raise RuntimeError(error or value)
        return value.strip()

    changed = False
    original = ''
    try:
        pid = run('systemctl show -p MainPID --value ' + SERVICE)
        if not pid or pid == '0':
            raise RuntimeError('API is not active')
        with client.open_sftp() as sftp:
            with sftp.file(CONFIG) as f:
                original = f.read().decode()
            roots = set(re.findall(r'\broot\s+([^;]+);', original))
            if len(roots) != 1:
                raise RuntimeError('Expected one live UI root')
            previous = roots.pop()
            if not previous.startswith(ROOT + '/releases/'):
                raise RuntimeError('Unexpected UI root')
            with sftp.file(previous + '/index.html') as f:
                index = f.read().decode()
        old_scripts = re.findall(r'<script src="/gongju/social-publisher-[a-f0-9]{12}\.js"></script>', index)
        old_styles = re.findall(r'<link rel="stylesheet" href="/gongju/social-publisher-[a-f0-9]{12}\.css">', index)
        for tag in old_scripts + old_styles:
            index = index.replace(tag, '')
        if '</head>' not in index or '</body>' not in index:
            raise RuntimeError('Unexpected live HTML')
        release = ROOT + '/releases/ui-social-current-' + str(int(time.time()))
        run('test ! -e ' + shlex.quote(release) + ' && cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release))
        asset_urls = []
        with client.open_sftp() as sftp:
            for ext in ['js', 'css']:
                data = Path('desktop-news/renderer/social.' + ext).read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                name = 'social-publisher-' + digest[:12] + '.' + ext
                remote = release + '/' + name
                with sftp.file(remote, 'wb') as f:
                    f.write(data)
                if run('sha256sum ' + shlex.quote(remote)).split()[0] != digest:
                    raise RuntimeError('Upload verification failed')
                asset_urls.append('/gongju/' + name)
            updated_index = index.replace('</head>', '<link rel="stylesheet" href="' + asset_urls[1] + '"></head>').replace('</body>', '<script src="' + asset_urls[0] + '"></script></body>')
            with sftp.file(release + '/index.html', 'w') as f:
                f.write(updated_index)
            with sftp.file(release + '/nginx-before.conf', 'w') as f:
                f.write(original)
            changed = True
            with sftp.file(CONFIG, 'w') as f:
                f.write(original.replace(previous, release))
        run('nginx -t && systemctl reload nginx')
        for url in asset_urls:
            status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + url))
            if status != '200':
                raise RuntimeError('Endpoint check failed: ' + url + ' ' + status)
        if run('systemctl show -p MainPID --value ' + SERVICE) != pid:
            raise RuntimeError('API process changed during UI deployment')
        result = {'release': release, 'previous': previous, 'assets': asset_urls, 'apiPidUnchanged': True, 'status': 'verified'}
        Path('outputs/deployment-social-entry-current.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        if changed and original:
            with client.open_sftp() as sftp:
                with sftp.file(CONFIG, 'w') as f:
                    f.write(original)
            run('nginx -t && systemctl reload nginx')
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
