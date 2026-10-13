"""Deploy only the account metadata endpoint; preserve the sealed writing engine."""
import os,json,re,time,shlex
from pathlib import Path
import paramiko
root='/www/wwwroot/geoskill.7chacha.com'
unit='/etc/systemd/system/geoskill-commercial-api.service'
service='geoskill-commercial-api.service'
c=paramiko.SSHClient();c.load_system_host_keys();c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(command):
    _,o,e=c.exec_command(command,timeout=90);value,error=o.read().decode(),e.read().decode()
    if o.channel.recv_exit_status():raise RuntimeError(error or value)
    return value.strip()
def idle():
    code="import pathlib,json,sys; rows=[json.loads(p.read_text()).get('job',{}) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; active=[r for r in rows if r.get('status') in ('running','queued')]; print('Active jobs:',len(active));sys.exit(bool(active))"
    print(run('python3 -c '+shlex.quote(code)))
changed=False
try:
    idle()
    with c.open_sftp() as s:
        with s.file(unit) as f:original=f.read().decode()
        match=re.search(r'^ExecStart=(/\S+/node) ('+re.escape(root)+r'/releases/\S+)/server/geo-api-server.mjs$',original,re.M)
        if not match:raise RuntimeError('Unexpected service target')
        node,previous=match.groups()
        with s.file(previous+'/server/geo-api-server.mjs') as f:host=f.read().decode()
    local=Path('server/geo-api-server.mjs').read_text(encoding='utf-8')
    start=local.index("    if (requestUrl.pathname === '/api/social/accounts'")
    end=local.index("    if (req.method === 'GET' && requestUrl.pathname === '/api/state')",start)
    anchor=local[end:local.index('\n',end)]
    if host.count(anchor)!=1 or '/api/social/accounts' in host:raise RuntimeError('Unexpected host route state')
    patched=host.replace(anchor,local[start:end]+anchor)
    release=root+'/releases/social-accounts-'+str(int(time.time()))
    run('test ! -e '+shlex.quote(release)+' && cp -a --reflink=auto '+shlex.quote(previous)+' '+shlex.quote(release))
    with c.open_sftp() as s:
        s.put('server/social-accounts.mjs',release+'/server/social-accounts.mjs')
        with s.file(release+'/server/geo-api-server.mjs','w') as f:f.write(patched)
        with s.file(release+'/service-before.conf','w') as f:f.write(original)
    run(shlex.quote(node)+' --check '+shlex.quote(release+'/server/geo-api-server.mjs'))
    version=run('cd '+shlex.quote(release)+' && '+shlex.quote(node)+' --input-type=module -e '+shlex.quote("import('./server/writing-engine.mjs').then(m=>console.log(m.writingRelease.version))"))
    idle()
    with c.open_sftp() as s:
        changed=True
        with s.file(unit,'w') as f:f.write(original.replace(previous+'/server/geo-api-server.mjs',release+'/server/geo-api-server.mjs'))
    run('systemctl daemon-reload && systemctl restart '+service+' && sleep 2 && systemctl is-active --quiet '+service)
    status=run("curl --max-time 15 -s -o /dev/null -w '%{http_code}' https://geoskill.7chacha.com/api/social/accounts")
    if status!='401':raise RuntimeError('Authentication check failed: '+status)
    print(json.dumps({'release':release,'previous':previous,'writingVersionUnchanged':version,'accountEndpoint':'authenticated','testRecordsCreated':0}))
except Exception:
    if changed:
        with c.open_sftp() as s:
            with s.file(unit,'w') as f:f.write(original)
        run('systemctl daemon-reload && systemctl restart '+service)
    raise
finally:c.close()
