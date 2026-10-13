"""Harden only the new GEO application locations; retain the old site and services."""
import os
import time
import paramiko

path = '/etc/nginx/conf.d/geoskill.7chacha.com.conf'
client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)

def run(command):
    _, out, err = client.exec_command(command, timeout=60)
    text, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or text)
    return text

headers = '''
        # geoskill commercial security headers
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=86400" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'" always;
'''
try:
    with client.open_sftp() as sftp:
        with sftp.file(path) as f:
            original = f.read().decode()
        if 'server_name geoskill.7chacha.com;' not in original:
            raise RuntimeError('Unexpected site configuration')
        if '# geoskill commercial security headers' not in original:
            updated = original
            for location in ['location /api/ {', 'location ^~ /gongju/ {', 'location ^~ /gongju/assets/ {']:
                if updated.count(location) != 1:
                    raise RuntimeError('Expected location not found: ' + location)
                updated = updated.replace(location, location + headers)
            backup = path + '.backup-' + time.strftime('%Y%m%d-%H%M%S')
            with sftp.file(backup, 'w') as f:
                f.write(original)
            try:
                with sftp.file(path, 'w') as f:
                    f.write(updated)
                run('nginx -t')
                run('systemctl reload nginx')
            except Exception:
                with sftp.file(path, 'w') as f:
                    f.write(original)
                run('nginx -t')
                run('systemctl reload nginx')
                raise
            print('Security headers enabled; configuration backup: ' + backup)
        else:
            print('Security headers already configured')
finally:
    client.close()
