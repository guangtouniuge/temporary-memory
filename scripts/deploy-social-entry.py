"""Add the scoped social workspace to a copy of the live UI, preserving all existing assets."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import time
import paramiko

ROOT = '/www/wwwroot/geoskill.7chacha.com'
CONFIG = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
SERVICE = 'geoskill-commercial-api.service'
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)
def run(command):
    _, out, err = client.exec_command(command, timeout=90)
    value, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or value)
    return value.strip()
changed = False
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
        if not previous.startswith(ROOT + '/releases/') or not previous.endswith('/dist'):
            raise RuntimeError('Unexpected UI root')
        with sftp.file(previous + '/index.html') as f:
            index = f.read().decode()
    if 'social-publisher-' in index:
        old_scripts = re.findall(r'<script src="/gongju/social-publisher-[a-f0-9]{12}\.js"></script>', index)
        old_styles = re.findall(r'<link rel="stylesheet" href="/gongju/social-publisher-[a-f0-9]{12}\.css">', index)
        if len(old_scripts) != 1 or len(old_styles) != 1:
            raise RuntimeError('Unexpected existing social entry')
        index = index.replace(old_scripts[0], '').replace(old_styles[0], '')
    if '</head>' not in index or '</body>' not in index:
        raise RuntimeError('Unexpected live HTML')
    release = ROOT + '/releases/ui-social-entry-' + str(int(time.time()))
    run('test ! -e ' + shlex.quote(release) + ' && mkdir ' + shlex.quote(release) + ' && cp -a ' + shlex.quote(previous) + ' ' + shlex.quote(release + '/dist'))
    asset_urls = []
    with client.open_sftp() as sftp:
        for ext in ['js', 'css']:
            data = Path('desktop-news/renderer/social.' + ext).read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            name = 'social-publisher-' + digest[:12] + '.' + ext
            remote = release + '/dist/' + name
            with sftp.file(remote, 'wb') as f:
                f.write(data)
            if run('sha256sum ' + shlex.quote(remote)).split()[0] != digest:
                raise RuntimeError('Upload verification failed')
            asset_urls.append('/gongju/' + name)
        updated_index = index.replace('</head>', '<link rel="stylesheet" href="' + asset_urls[1] + '"></head>').replace('</body>', '<script src="' + asset_urls[0] + '"></script></body>')
        with sftp.file(release + '/dist/index.html', 'w') as f:
            f.write(updated_index)
        with sftp.file(release + '/nginx-before.conf', 'w') as f:
            f.write(original)
        updated = original.replace(previous, release + '/dist')
        changed = True
        with sftp.file(CONFIG, 'w') as f:
            f.write(updated)
    run('nginx -t && systemctl reload nginx')
    for url, expected in [(u, '200') for u in asset_urls] + [('/gongju/agents', '200'), ('/api/state?key=geo.articleRows', '401')]:
        status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + url))
        if status != expected:
            raise RuntimeError('Endpoint check failed: ' + url + ' ' + status)
    if run('systemctl show -p MainPID --value ' + SERVICE) != pid:
        raise RuntimeError('API process changed during deployment')
    result = {'release': release, 'previous': previous, 'assets': asset_urls, 'apiPidUnchanged': True, 'scope': 'social entry only; original UI assets preserved', 'status': 'verified'}
    Path('outputs/deployment-social-entry.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
except Exception:
    if changed:
        with client.open_sftp() as sftp:
            with sftp.file(CONFIG, 'w') as f:
                f.write(original)
        run('nginx -t && systemctl reload nginx')
        print('Restored previous UI')
    raise
finally:
    client.close()
