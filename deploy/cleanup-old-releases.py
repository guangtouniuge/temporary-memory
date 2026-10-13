import os, paramiko, json, shlex, re
root='/www/wwwroot/geoskill.7chacha.com'
releases=root+'/releases'
conf='/etc/nginx/conf.d/geoskill.7chacha.com.conf'
service='/etc/systemd/system/geoskill-commercial-api.service'
c=paramiko.SSHClient(); c.load_system_host_keys(); c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(cmd, timeout=240):
    _,out,err=c.exec_command(cmd,timeout=timeout)
    value=out.read().decode(); error=err.read().decode(); code=out.channel.recv_exit_status()
    if code: raise RuntimeError(error or value)
    return value.strip()
try:
    nginx=run('cat '+shlex.quote(conf))
    unit=run('cat '+shlex.quote(service))
    current_ui=re.findall(r'\broot\s+([^;]+);', nginx)[0].rstrip('/')
    m=re.search(r'ExecStart=\S+\s+([^\s]+/server/geo-api-server\.mjs)', unit)
    current_api=m.group(1).rsplit('/server/',1)[0] if m else ''
    before=run('df -h /')
    listing=run('find '+shlex.quote(releases)+' -mindepth 1 -maxdepth 1 -type d | sort')
    deleted=[]
    for path in listing.splitlines():
        path=path.rstrip('/')
        if path in {current_ui,current_api}: continue
        name=path.rsplit('/',1)[-1]
        if name.startswith(('ui-current-dist-','management-','pricing-')):
            run('test '+shlex.quote(path)+' != '+shlex.quote(current_ui)+' && test '+shlex.quote(path)+' != '+shlex.quote(current_api)+' && rm -rf '+shlex.quote(path), timeout=240)
            deleted.append(path)
    after=run('df -h /')
    sizes=run('du -sh '+shlex.quote(releases)+'/* 2>/dev/null | sort -h | tail -n 20')
    print(json.dumps({'currentUi':current_ui,'currentApi':current_api,'deleted':deleted,'before':before,'after':after,'remaining':sizes},ensure_ascii=False,indent=2))
finally:
    c.close()
