import os,re,shlex,tarfile,time,json,paramiko,pathlib
root='/www/wwwroot/geoskill.7chacha.com'
conf='/etc/nginx/conf.d/geoskill.7chacha.com.conf'
service='geoskill-commercial-api.service'
archive=pathlib.Path('deploy/current-ui-lite.tgz')
with tarfile.open(archive,'w:gz') as tgz:
    for item in ['dist/index.html','dist/assets','dist/favicon.svg','dist/.nojekyll','dist/core-news-browser.js']:
        p=pathlib.Path(item)
        if p.exists(): tgz.add(str(p), arcname=str(p.relative_to('dist')))
c=paramiko.SSHClient(); c.load_system_host_keys(); c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(cmd,timeout=180):
    _,out,err=c.exec_command(cmd,timeout=timeout)
    value=out.read().decode(); error=err.read().decode(); code=out.channel.recv_exit_status()
    if code: raise RuntimeError(error or value)
    return value.strip()
changed=False; original=''
try:
    pid=run('systemctl show -p MainPID --value '+service)
    with c.open_sftp() as s:
        with s.file(conf) as f: original=f.read().decode()
    previous=set(re.findall(r'\broot\s+([^;]+);',original)).pop().rstrip('/')
    release=root+'/releases/ui-lite-'+str(int(time.time()))
    run('mkdir -p '+shlex.quote(release))
    with c.open_sftp() as s:
        s.put(str(archive), release+'/ui.tgz')
        with s.file(release+'/nginx-before.conf','w') as f: f.write(original)
    run('tar -xzf '+shlex.quote(release+'/ui.tgz')+' -C '+shlex.quote(release)+' && test -f '+shlex.quote(release+'/index.html'))
    run('if [ -d '+shlex.quote(previous+'/downloads')+' ]; then ln -s '+shlex.quote(previous+'/downloads')+' '+shlex.quote(release+'/downloads')+'; fi')
    updated=original.replace(previous, release)
    with c.open_sftp() as s:
        changed=True
        with s.file(conf,'w') as f: f.write(updated)
    run('nginx -t && systemctl reload nginx')
    for url in ['/gongju/geo','/gongju/assets/'+pathlib.Path(next(pathlib.Path('dist/assets').glob('index-*.js'))).name]:
        status=run("curl --max-time 20 -s -o /dev/null -w '%{http_code}' "+shlex.quote('https://geoskill.7chacha.com'+url))
        if status!='200': raise RuntimeError(url+' '+status)
    if run('systemctl show -p MainPID --value '+service)!=pid: raise RuntimeError('API process changed')
    result={'release':release,'previous':previous,'apiPidUnchanged':True,'testRecordsCreated':0,'downloadsLinked':True}
    pathlib.Path('outputs/deployment-current-ui-lite.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
except Exception:
    if changed:
        with c.open_sftp() as s:
            with s.file(conf,'w') as f: f.write(original)
        run('nginx -t && systemctl reload nginx')
    raise
finally:
    c.close()
