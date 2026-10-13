"""Deploy the current built dist as the web UI release."""
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
CONFIG = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
SERVICE = 'geoskill-commercial-api.service'
ARCHIVE = Path('deploy/current-ui-dist.tgz')


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


def main():
    if not Path('dist/index.html').exists():
        raise RuntimeError('Run npm build first')
    parser = AssetParser()
    parser.feed(Path('dist/index.html').read_text(encoding='utf-8'))
    asset_urls = ['/gongju/geo', *parser.assets]
    with tarfile.open(ARCHIVE, 'w:gz') as archive:
        archive.add('dist', arcname='.')
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
            raise RuntimeError('Expected one UI root')
        previous = roots.pop()
        if not previous.startswith(ROOT + '/releases/'):
            raise RuntimeError('Unexpected UI root')
        release = ROOT + '/releases/ui-current-dist-' + str(int(time.time()))
        run('test ! -e ' + shlex.quote(release) + ' && mkdir -p ' + shlex.quote(release))
        with client.open_sftp() as sftp:
            sftp.put(str(ARCHIVE), release + '/ui.tgz')
            with sftp.file(release + '/nginx-before.conf', 'w') as f:
                f.write(original)
        run('tar -xzf ' + shlex.quote(release + '/ui.tgz') + ' -C ' + shlex.quote(release) + ' && test -f ' + shlex.quote(release + '/index.html'))
        with client.open_sftp() as sftp:
            changed = True
            with sftp.file(CONFIG, 'w') as f:
                f.write(original.replace(previous, release))
        run('nginx -t && systemctl reload nginx')
        for url in asset_urls:
            status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + url))
            if status != '200':
                raise RuntimeError('UI asset unavailable: ' + url + ' ' + status)
        if run('systemctl show -p MainPID --value ' + SERVICE) != pid:
            raise RuntimeError('API process changed during UI deployment')
        result = {'release': release, 'previous': previous, 'apiPidUnchanged': True, 'testRecordsCreated': 0}
        Path('outputs/deployment-current-ui-dist.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
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
