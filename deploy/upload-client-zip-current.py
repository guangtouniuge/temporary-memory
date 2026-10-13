import os,re,shlex,paramiko,pathlib,json,time
local=pathlib.Path('dist/downloads/geo-social-publisher-client-v7-complete.zip')
if not local.exists():
    raise SystemExit('local zip missing')
c=paramiko.SSHClient(); c.load_system_host_keys(); c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(cmd, timeout=120):
    _,out,err=c.exec_command(cmd,timeout=timeout)
    text=out.read().decode(); bad=err.read().decode(); code=out.channel.recv_exit_status()
    if code: raise RuntimeError(bad or text)
    return text
try:
    conf=run('cat /etc/nginx/conf.d/geoskill.7chacha.com.conf')
    roots=re.findall(r'\broot\s+([^;]+);', conf)
    if not roots: raise RuntimeError('frontend root not found')
    dist=roots[0].strip().rstrip('/')
    remote=dist+'/downloads/geo-social-publisher-client-v7-complete.zip'
    backup='/root/.geoskill/backups/client-zip-'+time.strftime('%Y%m%d-%H%M%S')+'.zip'
    run('mkdir -p '+shlex.quote(dist+'/downloads')+' /root/.geoskill/backups')
    run('[ -f '+shlex.quote(remote)+' ] && cp -L '+shlex.quote(remote)+' '+shlex.quote(backup)+' || true')
    with c.open_sftp() as s:
        s.put(str(local), remote+'.tmp')
    run('mv '+shlex.quote(remote+'.tmp')+' '+shlex.quote(remote)+' && chmod 644 '+shlex.quote(remote))
    size=run('stat -c %s '+shlex.quote(remote)).strip()
    print(json.dumps({'status':'uploaded','remote':remote,'size':int(size),'backup':backup},ensure_ascii=False))
finally:
    c.close()
