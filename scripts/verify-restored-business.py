"""Run business acceptance against a private restore copy, never the live service."""
import io
import os
import pathlib
import shlex
import tarfile
import time
import paramiko

root = pathlib.Path(__file__).resolve().parent.parent
base = '/root/.geoskill/restore-business/' + time.strftime('%Y%m%d-%H%M%S')
node = '/root/.geoskill/runtime/node-v24.21.0-linux-x64/bin/node'
backup = '/root/.geoskill/backups/verified-20260913-131346/private-data.tgz'
payload = io.BytesIO()
with tarfile.open(fileobj=payload, mode='w:gz') as archive:
    for name in ('server', 'package.json', 'package-lock.json', 'scripts/accept-restored-business.mjs'):
        archive.add(root / name, arcname=name)
payload.seek(0)
c = paramiko.SSHClient()
c.load_system_host_keys()
c.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = c.exec_command(command, timeout=300)
    output, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or output)
    return output

try:
    run('umask 077\nmkdir -p ' + shlex.quote(base + '/code') + ' ' + shlex.quote(base + '/snapshot'))
    with c.open_sftp() as sftp:
        sftp.putfo(payload, base + '/code.tgz')
    command = '\n'.join([
        'set -eu', 'umask 077',
        'tar -xzf ' + shlex.quote(base + '/code.tgz') + ' -C ' + shlex.quote(base + '/code'),
        'tar -xzf ' + shlex.quote(backup) + ' -C ' + shlex.quote(base + '/snapshot'),
        'cd ' + shlex.quote(base + '/code'),
        'export PATH=' + shlex.quote(str(pathlib.PurePosixPath(node).parent)) + ':"$PATH"',
        'npm ci --ignore-scripts --no-audit --no-fund > ' + shlex.quote(base + '/install.log') + ' 2>&1',
        'export GEO_ACCEPTANCE_ROOT=' + shlex.quote(base + '/snapshot/www/wwwroot/geoskill.7chacha.com'),
        'export GEO_ACCEPTANCE_AUTH=' + shlex.quote(base + '/snapshot/root/.geoskill/auth'),
        shlex.quote(node) + ' scripts/accept-restored-business.mjs > ' + shlex.quote(base + '/acceptance.json'),
        'cat ' + shlex.quote(base + '/acceptance.json'),
        'systemctl is-active geoskill-commercial-api.service',
    ])
    print(run(command))
    print('Isolated evidence: ' + base)
finally:
    c.close()
