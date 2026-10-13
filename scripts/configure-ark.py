"""Update server-only Ark credentials without printing them or restarting active jobs."""
import os, paramiko
c=paramiko.SSHClient()
c.load_system_host_keys()
c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
try:
    values={'ARK_API_KEY':os.environ['ARK_API_KEY'],'ARK_IMAGE_MODEL':os.environ['ARK_IMAGE_MODEL'],'ARK_IMAGE_ENABLED':os.environ.get('ARK_IMAGE_ENABLED','false')}
    assert all('\n' not in v and '\r' not in v for v in values.values())
    with c.open_sftp() as s:
        path='/root/.geoskill/commercial.env'
        with s.file(path) as f: old=f.read().decode()
        lines=[line for line in old.splitlines() if line.split('=',1)[0] not in values]
        with s.file(path,'w') as f: f.write('\n'.join(lines+[k+'='+v for k,v in values.items()])+'\n')
        s.chmod(path,0o600)
    print('Ark configuration stored; no customer data changed.')
finally:c.close()
