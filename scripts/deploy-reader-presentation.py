"""Replace only the built app bundle/styles, preserving auxiliary live scripts."""
import json
import os
from pathlib import Path
import re
import shlex
import time
import paramiko

config_path = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
root = '/www/wwwroot/geoskill.7chacha.com'
target = root + '/releases/ui-reader-polish-' + str(int(time.time()))
c = paramiko.SSHClient()
c.load_system_host_keys()
c.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = c.exec_command(command, timeout=60)
    result, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or result)
    return result

def idle():
    code = "import pathlib,json,sys; rs=[json.loads(p.read_text()) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; n=sum(r.get('job',{}).get('status') in ('queued','running') for r in rs); print('Active jobs:',n); sys.exit(bool(n))"
    print(run('python3 -c ' + shlex.quote(code)).strip())

changed = False
try:
    idle()
    with c.open_sftp() as s:
        original = s.open(config_path).read().decode()
        previous = re.search(r'root (' + re.escape(root) + r'/releases/[^;]+/dist);', original)[1]
        html = s.open(previous + '/index.html').read().decode()
        local_html = Path('dist/index.html').read_text(encoding='utf-8')
        replacements = []
        for ext in ['js', 'css']:
            pattern = r'assets/index-[\w-]+\.' + ext
            old, new = re.findall(pattern, html), re.findall(pattern, local_html)
            if len(old) != 1 or len(new) != 1:
                raise RuntimeError('Unexpected app entry assets')
            replacements.append((old[0], new[0]))
        run('test ! -e ' + shlex.quote(target) + ' && mkdir -p ' + shlex.quote(target) + ' && cp -a ' + shlex.quote(previous) + ' ' + shlex.quote(target + '/dist'))
        with s.file(target + '/nginx-before.conf', 'w') as f:
            f.write(original)
        for old, new in replacements:
            s.put(str(Path('dist') / new), target + '/dist/' + new)
            html = html.replace(old, new)
        with s.file(target + '/dist/index.html', 'w') as f:
            f.write(html)
        idle()
        changed = True
        with s.file(config_path, 'w') as f:
            f.write(original.replace(previous, target + '/dist'))
    run('nginx -t && systemctl reload nginx')
    for path in ['/gongju/agents'] + ['/gongju/' + new for _, new in replacements]:
        status = run("curl -s --max-time 20 -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + path)).strip()
        if status != '200':
            raise RuntimeError('Live asset failed: ' + path)
    run('systemctl is-active --quiet geoskill-commercial-api.service')
    result = {'release': target, 'previous': previous, 'assets': replacements, 'status': 'verified', 'auxiliaryScripts': 'preserved'}
    Path('outputs/deployment-reader.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
except Exception:
    if changed:
        with c.open_sftp() as s:
            with s.file(config_path, 'w') as f:
                f.write(original)
        run('nginx -t && systemctl reload nginx')
    raise
finally:
    c.close()
