"""Deploy the self-media task sync endpoint without changing writing rules."""
import json
import os
import re
import shlex
import time
from pathlib import Path

import paramiko


ROOT = '/www/wwwroot/geoskill.7chacha.com'
UNIT = '/etc/systemd/system/geoskill-commercial-api.service'
SERVICE = 'geoskill-commercial-api.service'


def route_slice(source: str) -> str:
    start = source.index("    if (requestUrl.pathname === '/api/social/accounts'")
    end = source.index("    if (req.method === 'GET' && requestUrl.pathname === '/api/state')", start)
    return source[start:end]


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
    original_unit = ''
    try:
        with client.open_sftp() as sftp:
            with sftp.file(UNIT) as f:
                original_unit = f.read().decode()
            match = re.search(r'^ExecStart=(/\S+/node) (' + re.escape(ROOT) + r'/releases/\S+)/server/geo-api-server.mjs$', original_unit, re.M)
            if not match:
                raise RuntimeError('Unexpected service target')
            node, previous = match.groups()
            with sftp.file(previous + '/server/geo-api-server.mjs') as f:
                host = f.read().decode()

        local = Path('server/geo-api-server.mjs').read_text(encoding='utf-8')
        local_routes = route_slice(local)
        if "/api/social/tasks" not in local_routes:
            raise RuntimeError('Local social task route missing')
        host_routes = route_slice(host)
        patched = host.replace(host_routes, local_routes)
        release = ROOT + '/releases/social-tasks-' + str(int(time.time()))
        run('test ! -e ' + shlex.quote(release) + ' && cp -a --reflink=auto ' + shlex.quote(previous) + ' ' + shlex.quote(release))

        with client.open_sftp() as sftp:
            sftp.put('server/social-accounts.mjs', release + '/server/social-accounts.mjs')
            with sftp.file(release + '/server/geo-api-server.mjs', 'w') as f:
                f.write(patched)
            with sftp.file(release + '/service-before.conf', 'w') as f:
                f.write(original_unit)

        run(shlex.quote(node) + ' --check ' + shlex.quote(release + '/server/geo-api-server.mjs'))
        with client.open_sftp() as sftp:
            changed = True
            with sftp.file(UNIT, 'w') as f:
                f.write(original_unit.replace(previous + '/server/geo-api-server.mjs', release + '/server/geo-api-server.mjs'))
        run('systemctl daemon-reload && systemctl restart ' + SERVICE + ' && sleep 2 && systemctl is-active --quiet ' + SERVICE)
        status = run("curl --max-time 15 -s -o /dev/null -w '%{http_code}' https://geoskill.7chacha.com/api/social/tasks")
        if status != '401':
            raise RuntimeError('Authentication check failed: ' + status)
        result = {'release': release, 'previous': previous, 'endpoint': 'authenticated', 'testRecordsCreated': 0}
        Path('outputs/deployment-social-tasks.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        if changed and original_unit:
            with client.open_sftp() as sftp:
                with sftp.file(UNIT, 'w') as f:
                    f.write(original_unit)
            run('systemctl daemon-reload && systemctl restart ' + SERVICE)
        raise
    finally:
        client.close()


if __name__ == '__main__':
    main()
