"""Install a verified, site-private runtime without changing system Node or services."""
import os
import paramiko

client = paramiko.SSHClient()
client.load_system_host_keys()
client.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)
script = r'''
import hashlib,json,pathlib,subprocess,urllib.request
base='https://nodejs.org/dist/'
releases=json.load(urllib.request.urlopen(base+'index.json',timeout=30))
version=next(r['version'] for r in releases if r['version'].startswith('v24.') and r['lts'])
name='node-'+version+'-linux-x64.tar.xz'
root=pathlib.Path('/root/.geoskill/runtime')
root.mkdir(parents=True,exist_ok=True)
checks=urllib.request.urlopen(base+version+'/SHASUMS256.txt',timeout=30).read().decode()
expected=next(line.split()[0] for line in checks.splitlines() if line.split()[-1]==name)
archive=root/name
data=archive.read_bytes() if archive.exists() else urllib.request.urlopen(base+version+'/'+name,timeout=120).read()
if hashlib.sha256(data).hexdigest()!=expected: raise RuntimeError('Runtime checksum mismatch')
archive.write_bytes(data)
subprocess.run(['tar','-xJf',str(archive),'-C',str(root)],check=True)
binary=root/name[:-7]/'bin/node'
subprocess.run([str(binary),'--input-type=module','-e',"import {DatabaseSync,backup} from 'node:sqlite';const db=new DatabaseSync(':memory:');db.exec('SELECT 1');db.close();console.log('SQLite runtime ready')"],check=True)
print(str(binary))
'''
try:
    stdin, stdout, stderr = client.exec_command('python3 -', timeout=240)
    stdin.write(script)
    stdin.channel.shutdown_write()
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error or output)
    print(output)
finally:
    client.close()
