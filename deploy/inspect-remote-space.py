import os, paramiko, json, shlex, re
root='/www/wwwroot/geoskill.7chacha.com'
conf='/etc/nginx/conf.d/geoskill.7chacha.com.conf'
c=paramiko.SSHClient(); c.load_system_host_keys(); c.connect('geoskill.7chacha.com',username='root',password=os.environ['GEO_DEPLOY_PASSWORD'],timeout=20)
def run(cmd, timeout=120):
    _,out,err=c.exec_command(cmd,timeout=timeout)
    value=out.read().decode(); error=err.read().decode(); code=out.channel.recv_exit_status()
    if code: raise RuntimeError(error or value)
    return value.strip()
try:
    nginx=run('cat '+shlex.quote(conf))
    roots=re.findall(r'\broot\s+([^;]+);', nginx)
    current=roots[0] if roots else ''
    df=run("df -h / && echo '--- releases ---' && du -sh /www/wwwroot/geoskill.7chacha.com/releases/* 2>/dev/null | sort -h | tail -n 20")
    print(json.dumps({'current':current,'report':df},ensure_ascii=False,indent=2))
finally:
    c.close()
