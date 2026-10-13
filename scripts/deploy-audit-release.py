"""Deploy reviewed audit changes while preserving live dependencies and private data."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import paramiko

ROOT = '/www/wwwroot/geoskill.7chacha.com'
UNIT = '/etc/systemd/system/geoskill-commercial-api.service'
NGINX = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
SERVICE = 'geoskill-commercial-api.service'
manifest = json.loads(Path('server/writing-release.json').read_text())
release = ROOT + '/releases/audit-' + manifest['version'] + '-' + time.strftime('%Y%m%d-%H%M%S')
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = client.exec_command(command, timeout=300)
    value, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or value or 'Remote check failed')
    return value.strip()

def write(path, value):
    with client.open_sftp() as sftp:
        with sftp.file(path, 'w') as f:
            f.write(value)

def idle():
    code = "import pathlib,json,sqlite3; rows=[json.loads(p.read_text()).get('job',{}) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; assert not any(r.get('status') in ('queued','running') for r in rows), 'Active article task'; db=sqlite3.connect('file:/root/.geoskill/auth/member-ledger.sqlite?mode=ro',uri=True); assert not db.execute(\"SELECT 1 FROM news_orders WHERE state='sending' LIMIT 1\").fetchone(), 'Media submission in progress'; db.close()"
    run('python3 -c ' + shlex.quote(code))

changed = False
try:
    run('systemctl is-active --quiet ' + SERVICE)
    idle()
    if int(run('df -B1 --output=avail / | tail -n 1')) < 3 * 1024**3:
        raise RuntimeError('Insufficient disk space')
    with client.open_sftp() as sftp:
        original_unit = sftp.open(UNIT).read().decode()
        original_nginx = sftp.open(NGINX).read().decode()
        match = re.search(r'^ExecStart=(/\S+/node) (' + re.escape(ROOT) + r'/releases/\S+)/server/geo-api-server.mjs$', original_unit, re.M)
        if not match:
            raise RuntimeError('Unexpected service configuration')
        node, previous = match.groups()
        old = json.loads(sftp.open(previous + '/server/writing-release.json').read())
        if old['version'] != '8.2.76' or manifest['version'] != '8.2.77':
            raise RuntimeError('Version changed; review deployment again')
        for name, digest in manifest['files'].items():
            if name.startswith('skills/') and old['files'].get(name) != digest:
                raise RuntimeError('Frozen Skill changed')
        for path in Path('server').glob('*.mjs'):
            if '.test.' in path.name or path.name in ('agents-workflow.mjs', 'geo-api-server.mjs'):
                continue
            if sftp.open(previous + '/server/' + path.name).read().replace(b'\r\n', b'\n') != path.read_bytes().replace(b'\r\n', b'\n'):
                raise RuntimeError('Unreviewed backend difference: ' + path.name)
    run('test ! -e ' + shlex.quote(release) + ' && cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release))
    write(release + '/service-before.conf', original_unit)
    write(release + '/nginx-before.conf', original_nginx)
    with client.open_sftp() as sftp:
        for name in [*manifest['files'], 'writing-release.json', 'geo-api-server.mjs']:
            path = Path('server') / name
            data = path.read_bytes()
            if name in manifest['files'] and hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest() != manifest['files'][name]:
                raise RuntimeError('Local manifest mismatch: ' + name)
            sftp.put(str(path), release + '/server/' + name)
        for path in Path('dist').rglob('*'):
            if not path.is_file():
                continue
            destination = release + '/' + path.as_posix()
            run('mkdir -p ' + shlex.quote(destination.rsplit('/', 1)[0]))
            sftp.put(str(path), destination)
    version = run('cd ' + shlex.quote(release) + ' && ' + shlex.quote(node) + ' --input-type=module -e ' + shlex.quote("import('./server/writing-engine.mjs').then(m=>console.log(m.writingRelease.version))"))
    if version != manifest['version']:
        raise RuntimeError('Server writing seal rejected')
    run(shlex.quote(node) + ' --check ' + shlex.quote(release + '/server/geo-api-server.mjs'))
    print('Staged and verified:', release, flush=True)
    backup = json.loads(subprocess.check_output([sys.executable, 'scripts/verify-commercial-backup.py'], text=True))
    if backup.get('status') != 'file-restore-verified':
        raise RuntimeError('Backup verification failed')
    idle()
    with client.open_sftp() as sftp:
        if sftp.open(UNIT).read().decode() != original_unit or sftp.open(NGINX).read().decode() != original_nginx:
            raise RuntimeError('Concurrent deployment detected')
    updated_nginx = re.sub(re.escape(ROOT) + r'/releases/[^/;\s]+/dist', release + '/dist', original_nginx)
    if updated_nginx == original_nginx:
        raise RuntimeError('Frontend target missing')
    changed = True
    write(UNIT, original_unit.replace(previous + '/server/geo-api-server.mjs', release + '/server/geo-api-server.mjs'))
    write(NGINX, updated_nginx)
    run('nginx -t && systemctl daemon-reload && systemctl restart ' + SERVICE + ' && sleep 2 && systemctl is-active --quiet ' + SERVICE + ' && systemctl reload nginx')
    for path, expected in [('/gongju/agents', '200'), ('/gongju/skill', '200'), ('/gongju/geo', '200'), ('/api/state?key=geo.articleRows', '401'), ('/api/news/content', '401')]:
        status = run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' " + shlex.quote('https://geoskill.7chacha.com' + path))
        if status != expected:
            raise RuntimeError('Endpoint failed: ' + path + ' ' + status)
    for asset in re.findall(r'(?:src|href)="(/gongju/assets/[^"?#]+\.(?:js|css))"', Path('dist/index.html').read_text(encoding='utf-8')):
        expected = hashlib.sha256((Path('dist') / asset.removeprefix('/gongju/')).read_bytes()).hexdigest()
        actual = run('set -o pipefail; curl --fail --max-time 20 -s ' + shlex.quote('https://geoskill.7chacha.com' + asset) + ' | sha256sum').split()[0]
        if actual != expected:
            raise RuntimeError('Live asset mismatch')
    pid = run('systemctl show -p MainPID --value ' + SERVICE)
    if release + '/server/geo-api-server.mjs' not in run("tr '\\0' ' ' < /proc/" + pid + '/cmdline'):
        raise RuntimeError('Running process release mismatch')
    result = {'status': 'verified', 'version': version, 'release': release, 'previous': previous, 'backup': backup, 'customerData': 'unchanged', 'verification': 'read-only endpoints, live asset hashes, running process, writing seal'}
    write(release + '/deployment.json', json.dumps(result, indent=2))
    Path('outputs/deployment-audit.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)
except Exception:
    if changed:
        write(UNIT, original_unit)
        write(NGINX, original_nginx)
        run('systemctl daemon-reload && systemctl restart ' + SERVICE + ' && nginx -t && systemctl reload nginx')
        print('Rolled back service and UI; private data unchanged', flush=True)
    raise
finally:
    client.close()
