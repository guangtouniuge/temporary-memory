import os,re,json,time,shlex,hashlib
from pathlib import Path
import paramiko
root='/www/wwwroot/geoskill.7chacha.com'
unit='/etc/systemd/system/geoskill-commercial-api.service'
conf='/etc/nginx/conf.d/geoskill.7chacha.com.conf'
service='geoskill-commercial-api.service'
c=paramiko.SSHClient();c.load_system_host_keys();c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(cmd):
    _,o,e=c.exec_command(cmd,timeout=90);v,err=o.read().decode(),e.read().decode()
    if o.channel.recv_exit_status():raise RuntimeError(err or v)
    return v.strip()
def read(p):
    with c.open_sftp() as s:
        with s.file(p) as f:return f.read().decode()
def write(p,v):
    with c.open_sftp() as s:
        with s.file(p,'wb') as f:f.write(v.encode() if isinstance(v,str) else v)
def idle():
    code="import pathlib,json,sys; a=[json.loads(p.read_text()).get('job',{}) for p in pathlib.Path('/root/.geoskill/commercial-jobs').glob('JOB-*.json')]; n=sum(r.get('status') in ('running','queued') for r in a); print('active_jobs',n); sys.exit(bool(n))"
    print(run('python3 -c '+shlex.quote(code)))
changed=False
try:
    idle()
    original=read(unit);nginx=read(conf)
    node,old=re.search(r'^ExecStart=(/\S+/node) ('+re.escape(root)+r'/releases/\S+)/server/geo-api-server.mjs$',original,re.M).groups()
    roots=set(re.findall(r'\broot\s+([^;]+);',nginx));assert len(roots)==1
    oldui=roots.pop();assert oldui.startswith(root+'/releases/')
    index=read(oldui+'/index.html')
    for ext,name in [('js','index-UTzKgzLo.js'),('css','index-7q_l2qgi.css')]:
        assert read(oldui+'/assets/'+name)==Path('outputs/provider-live.'+ext).read_text(encoding='utf-8')
        assert index.count(name)==1
    host=read(old+'/server/geo-api-server.mjs')
    local=Path('server/geo-api-server.mjs').read_text(encoding='utf-8')
    begin="  if(req.method==='POST' && "
    anchor="  if (['/api/config/status', '/api/model/test']"
    s=host.index(begin,host.index('async function handleProjectRequest'))
    e=host.index(anchor,s)
    ls=local.index(begin,local.index('async function handleProjectRequest'));le=local.index(anchor,ls)
    assert '/api/providers/research' in host[s:e]
    patched=host[:s]+local[ls:le]+host[e:]
    release=root+'/releases/provider-business-'+str(int(time.time()))
    run('test ! -e '+shlex.quote(release)+' && cp -a --reflink=auto '+shlex.quote(old)+' '+shlex.quote(release))
    write(release+'/server/geo-api-server.mjs',patched)
    manifest=json.loads(read(old+'/server/writing-release.json'))
    for name in ['provider-research.mjs','provider-lookup.mjs']:
        data=Path('server/'+name).read_bytes();write(release+'/server/'+name,data)
        if name in manifest['files']:manifest['files'][name]=hashlib.sha256(data).hexdigest()
    manifest['version']='8.2.85'
    write(release+'/server/writing-release.json',json.dumps(manifest,ensure_ascii=False,indent=2))
    run(shlex.quote(node)+' --check '+shlex.quote(release+'/server/geo-api-server.mjs'))
    print(run('cd '+shlex.quote(release)+' && '+shlex.quote(node)+' --input-type=module -e '+shlex.quote("import('./server/writing-engine.mjs').then(m=>console.log('sealed',m.writingRelease.version))")))
    ui=release+'/provider-ui'
    run('cp -a '+shlex.quote(oldui)+' '+shlex.quote(ui))
    assets=[]
    for ext,oldname in [('js','index-UTzKgzLo.js'),('css','index-7q_l2qgi.css')]:
        data=Path('outputs/provider-patched.'+ext).read_bytes()
        name='provider-'+hashlib.sha256(data).hexdigest()[:12]+'.'+ext
        write(ui+'/assets/'+name,data);index=index.replace(oldname,name);assets.append('/gongju/assets/'+name)
    write(ui+'/index.html',index);write(release+'/service-before.conf',original);write(release+'/nginx-before.conf',nginx)
    idle();changed=True
    write(unit,original.replace(old+'/server/geo-api-server.mjs',release+'/server/geo-api-server.mjs'))
    run('systemctl daemon-reload && systemctl restart '+service+' && sleep 2 && systemctl is-active --quiet '+service)
    write(conf,nginx.replace(oldui,ui));run('nginx -t && systemctl reload nginx')
    for url,expected in [(x,'200') for x in assets]+[('/api/providers/research','401'),('/','200')]:
        status=run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' "+shlex.quote('https://geoskill.7chacha.com'+url))
        assert status==expected,(url,status)
    print(json.dumps({'release':release,'assets':assets,'verified':True,'productionTestRecords':0}))
except Exception:
    if changed:
        write(unit,original);write(conf,nginx)
        run('systemctl daemon-reload && systemctl restart '+service+' && nginx -t && systemctl reload nginx')
    raise
finally:c.close()
