"""Deploy sealed writing files to geoskill while retaining the live host and UI."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import time
import paramiko

ROOT = '/www/wwwroot/geoskill.7chacha.com'
UNIT = '/etc/systemd/system/geoskill-commercial-api.service'
SERVICE = 'geoskill-commercial-api.service'
manifest = json.loads(Path('server/writing-release.json').read_text(encoding='utf-8'))
release = ROOT + '/releases/writing-' + manifest['version'] + '-' + time.strftime('%Y%m%d-%H%M%S')
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = client.exec_command(command, timeout=180)
    result, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or result or 'Remote check failed')
    return result

def idle():
    code = "import pathlib,json,sys; rows=[json.loads(p.read_text()) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; active=[r.get('job',{}).get('id') for r in rows if r.get('job',{}).get('status') in ('queued','running')]; print('Active jobs:',len(active)); sys.exit(bool(active))"
    print(run('python3 -c ' + shlex.quote(code)).strip())

changed = False
try:
    run('systemctl is-active --quiet ' + SERVICE)
    idle()
    with client.open_sftp() as sftp:
        with sftp.file(UNIT) as f:
            original = f.read().decode()
        match = re.search(r'^ExecStart=(/[^\s]+/node) (' + re.escape(ROOT) + r'/releases/[^\s]+)/server/geo-api-server.mjs$', original, re.M)
        if not match:
            raise RuntimeError('Unexpected service target')
        node = match.group(1)
        previous = match.group(2)
        run('test -x ' + shlex.quote(node))
        with sftp.file(previous + '/server/writing-release.json') as f:
            old = json.loads(f.read())
        for name, digest in manifest['files'].items():
            if name.startswith('skills/') and old['files'].get(name) != digest:
                raise RuntimeError('Frozen Skill differs: ' + name)
    print('Current version:', old['version'], 'Target:', manifest['version'])
    run('test ! -e ' + shlex.quote(release) + ' && cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release))
    run('cp ' + UNIT + ' ' + shlex.quote(release + '/service-before.conf'))
    files = list(manifest['files']) + ['writing-release.json', 'provider-research.mjs']
    with client.open_sftp() as sftp:
        for name in files:
            local = Path('server') / name
            data = local.read_bytes()
            if name in manifest['files'] and hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest() != manifest['files'][name]:
                raise RuntimeError('Local seal mismatch: ' + name)
            sftp.put(str(local), release + '/server/' + name)
        if os.environ.get('GEO_DEPLOY_IMAGE_LABEL') == '1':
            host_path = release + '/server/geo-api-server.mjs'
            with sftp.file(host_path) as f:
                host = f.read().decode()
            before = 'galleries=images.map(image=>`AI生成场景示意（文件：${image.path}）`)'
            after = 'galleries=images.map(image=>`文章配图（文件：${image.path}）`)'
            if host.count(before) != 1:
                raise RuntimeError('Unexpected image label insertion; refusing host patch')
            patched = host.replace(before, after)
            if patched.replace('\r\n', '\n') != Path('server/geo-api-server.mjs').read_text(encoding='utf-8').replace('\r\n', '\n'):
                raise RuntimeError('Host contains unrelated local changes; refusing upload')
            with sftp.file(host_path, 'w') as f:
                f.write(patched)
        with sftp.file(release + '/deployment.json', 'w') as f:
            f.write(json.dumps({'previous': previous, 'version': manifest['version'], 'scope': 'sealed-writing-only'}))
    verify = "import('./server/writing-engine.mjs').then(m=>console.log(m.writingRelease.version))"
    version = run('cd ' + shlex.quote(release) + ' && ' + shlex.quote(node) + ' --input-type=module -e ' + shlex.quote(verify)).strip()
    if version != manifest['version']:
        raise RuntimeError('Release verification failed')
    run(shlex.quote(node) + ' --check ' + shlex.quote(release + '/server/geo-api-server.mjs'))
    idle()
    updated = original.replace(previous + '/server/geo-api-server.mjs', release + '/server/geo-api-server.mjs')
    changed = True
    with client.open_sftp() as sftp:
        with sftp.file(UNIT, 'w') as f:
            f.write(updated)
    run('systemctl daemon-reload && systemctl restart ' + SERVICE + ' && sleep 2 && systemctl is-active --quiet ' + SERVICE)
    for path, expected in [('/gongju/agents', '200'), ('/gongju/skill', '200'), ('/gongju/geo', '200'), ('/api/state?key=geo.articleRows', '401')]:
        status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + path)).strip()
        if status != expected:
            raise RuntimeError('Endpoint check failed: ' + path + ' ' + status)
    result = {'release': release, 'previous': previous, 'version': version, 'status': 'verified', 'ui': 'unchanged', 'projectData': 'unchanged'}
    Path('outputs/deployment-writing.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
except Exception:
    if changed:
        with client.open_sftp() as sftp:
            with sftp.file(UNIT, 'w') as f:
                f.write(original)
        run('systemctl daemon-reload && systemctl restart ' + SERVICE)
        print('Restored previous service release')
    raise
finally:
    client.close()
