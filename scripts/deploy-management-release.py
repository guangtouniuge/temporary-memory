"""Versioned geoskill-only deployment; preserve accounts, projects and model settings."""
import json
import os
import pathlib
import re
import shlex
import time
import subprocess
import sys
import paramiko

root = '/www/wwwroot/geoskill.7chacha.com'
stamp = time.strftime('%Y%m%d-%H%M%S')
release = root + '/releases/management-' + stamp
backup = '/root/.geoskill/backups/management-' + stamp
unit = '/etc/systemd/system/geoskill-commercial-api.service'
nginx = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
node_binary = os.environ.get('GEO_SERVER_NODE', '/usr/bin/node')
if not re.fullmatch(r'/[A-Za-z0-9_./-]+/node', node_binary):
    raise RuntimeError('Invalid server runtime path')
c = paramiko.SSHClient()
c.load_system_host_keys()
c.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = c.exec_command(command, timeout=240)
    value, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or value)
    return value

def write(path, content):
    with c.open_sftp() as s:
        with s.file(path, 'w') as f:
            f.write(content)

changed = False
try:
    free = int(run("df -B1 --output=avail / | tail -n 1").strip())
    if free < 3 * 1024**3:
        raise RuntimeError('Server disk below 3 GiB free; deployment stopped')
    run(shlex.quote(node_binary) + ' --input-type=module -e "import {DatabaseSync,backup} from \'node:sqlite\'; const db=new DatabaseSync(\':memory:\'); db.close()"')
    run("systemctl is-active --quiet geoskill-commercial-api.service")
    run("python3 -c \"import pathlib,json,sys; rows=[json.loads(p.read_text()) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; sys.exit(1 if any(r.get('job',{}).get('status') in ('queued','running') for r in rows) else 0)\"")
    with c.open_sftp() as s:
        with s.file(unit) as f: original_unit = f.read().decode()
        with s.file(nginx) as f: original_nginx = f.read().decode()
    if root + '/releases/' not in original_unit or 'server_name geoskill.7chacha.com;' not in original_nginx:
        raise RuntimeError('Unexpected deployment target')
    verified = json.loads(subprocess.check_output([sys.executable, 'scripts/verify-commercial-backup.py'], text=True))
    if verified.get('status') != 'file-restore-verified':
        raise RuntimeError('Consistent backup was not verified')
    run(f'mkdir -p {backup} {release} && chmod 700 {backup} && cp {unit} {backup}/service.conf && cp {nginx} {backup}/nginx.conf && cp {shlex.quote(verified["backup"])} {backup}/private-data.tgz')
    with c.open_sftp() as s:
        s.put('deploy/management-release.tgz', release + '/release.tgz')
    node_path = str(pathlib.PurePosixPath(node_binary).parent)
    run(f'export PATH={shlex.quote(node_path)}:$PATH; tar -xzf {release}/release.tgz -C {release} && cd {release} && npm ci --omit=dev --ignore-scripts --no-audit --no-fund > install.log 2>&1 && node --check server/geo-api-server.mjs && node --input-type=module -e "import(\'./server/writing-engine.mjs\')"')
    updated_unit = re.sub(r'^ExecStart=.*$', 'ExecStart=' + node_binary + ' ' + release + '/server/geo-api-server.mjs', original_unit, flags=re.M)
    updated_nginx = re.sub(re.escape(root) + r'/releases/[^/;\s]+/dist', release + '/dist', original_nginx)
    if updated_nginx == original_nginx:
        raise RuntimeError('Frontend target not found')
    # Permit the sandboxed media preview; scripts and parent framing stay restricted.
    updated_nginx = updated_nginx.replace("object-src 'none'; base-uri 'self'; frame-ancestors", "object-src 'none'; frame-src 'self' https:; base-uri 'self'; frame-ancestors")
    changed = True
    write(unit, updated_unit)
    write(nginx, updated_nginx)
    run('nginx -t && systemctl daemon-reload && systemctl restart geoskill-commercial-api.service && sleep 2 && systemctl is-active --quiet geoskill-commercial-api.service && systemctl reload nginx')
    for path in ['/gongju/agents', '/gongju/skill', '/gongju/geo']:
        status = run('curl -s -o /dev/null -w "%{http_code}" ' + shlex.quote('https://geoskill.7chacha.com' + path)).strip()
        if status != '200': raise RuntimeError('Login page check failed: ' + path + ' ' + status)
    status = run("curl -s -o /dev/null -w '%{http_code}' 'https://geoskill.7chacha.com/api/state?key=geo.articleRows'").strip()
    if status != '401': raise RuntimeError('Anonymous data boundary failed')
    pathlib.Path('outputs/deployment-management.json').write_text(json.dumps({'release': release, 'backup': backup, 'status': 'deployed'}, indent=2), encoding='utf-8')
    print('Deployed: ' + release + '\nBackup: ' + backup)
except Exception:
    if changed:
        write(unit, original_unit)
        write(nginx, original_nginx)
        run('systemctl daemon-reload && systemctl restart geoskill-commercial-api.service && nginx -t && systemctl reload nginx')
        print('Rolled back program and nginx; project data unchanged')
    raise
finally:
    c.close()
