"""Package the current live geoskill article system for rollback.

Creates a server-side snapshot under /root/.geoskill/backups/article-system-*:
- current frontend release and API release code
- nginx vhost and systemd unit
- private env/auth/jobs/project outputs data as a live emergency snapshot
- a code-only rollback script that restores nginx/unit pointers without data rewind
- restore verification manifest
"""
import json
import os
import paramiko


HOST = "geoskill.7chacha.com"
UNIT = "geoskill-commercial-api.service"


REMOTE_SCRIPT = r'''
import hashlib,json,os,pathlib,re,shlex,shutil,sqlite3,subprocess,time

os.umask(0o077)
root=pathlib.Path('/www/wwwroot/geoskill.7chacha.com')
conf=pathlib.Path('/etc/nginx/conf.d/geoskill.7chacha.com.conf')
unit_name='geoskill-commercial-api.service'
unit_file=pathlib.Path('/etc/systemd/system')/unit_name
backup_root=pathlib.Path('/root/.geoskill/backups')/('article-system-'+time.strftime('%Y%m%d-%H%M%S'))
backup_root.mkdir(parents=True,mode=0o700)

def run(args, **kwargs):
    completed=subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, **kwargs)
    return completed.stdout.strip()

def sha256(path):
    digest=hashlib.sha256()
    with open(path,'rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def manifest_for(paths):
    out={}
    for source in paths:
        source=pathlib.Path(source)
        if not source.exists():
            continue
        items=[source] if source.is_file() else source.rglob('*')
        for item in items:
            if item.is_symlink():
                out[str(item)]='SYMLINK->'+os.readlink(item)
            elif item.is_file():
                out[str(item)]=sha256(item)
    return out

def tar_create(output, paths):
    existing=[str(pathlib.Path(p).relative_to('/')) for p in paths if pathlib.Path(p).exists()]
    if not existing:
        return False
    run(['tar','-czf',str(output),'-C','/',*existing], timeout=900)
    return True

nginx_conf=conf.read_text()
unit_conf=unit_file.read_text()
roots=re.findall(r'\broot\s+([^;]+);', nginx_conf)
if not roots:
    raise RuntimeError('Cannot detect nginx frontend root')
current_ui=pathlib.Path(roots[0].strip().rstrip('/'))
m=re.search(r'ExecStart=\S+\s+([^\s]+/server/geo-api-server\.mjs)', unit_conf)
current_api=pathlib.Path(m.group(1).rsplit('/server/',1)[0]) if m else current_ui

jobs=pathlib.Path('/root/.geoskill/commercial-jobs')
for p in jobs.glob('JOB-*.json'):
    try:
        status=json.loads(p.read_text()).get('job',{}).get('status')
    except Exception:
        status=''
    if status in ('queued','running'):
        raise RuntimeError('Active article job found; postpone packaging until it finishes: '+p.name)

ledger=pathlib.Path('/root/.geoskill/auth/member-ledger.sqlite')
if ledger.exists():
    with sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='news_orders'").fetchone():
            if db.execute("SELECT 1 FROM news_orders WHERE state='sending' LIMIT 1").fetchone():
                raise RuntimeError('News submission in progress; postpone packaging')

meta={
    'createdAt':time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'host':'geoskill.7chacha.com',
    'unit':unit_name,
    'currentUi':str(current_ui),
    'currentApi':str(current_api),
    'nginxConf':str(conf),
    'unitFile':str(unit_file),
    'note':'rollback-code-only.sh restores code/config pointers only and does not roll back customer data. private-data.tgz is a live emergency snapshot, not a normal update rollback target.',
}
(backup_root/'nginx.conf').write_text(nginx_conf)
(backup_root/'systemd.service').write_text(unit_conf)

private_paths=[
    '/root/.geoskill/auth',
    '/root/.geoskill/commercial-jobs',
    '/root/.geoskill/commercial.env',
    '/www/wwwroot/geoskill.7chacha.com/outputs',
]
code_paths=[str(current_ui), str(current_api), str(conf), str(unit_file)]

tar_create(backup_root/'code-and-config.tgz', code_paths)
tar_create(backup_root/'private-data.tgz', private_paths)

manifest=manifest_for(code_paths+private_paths)
(backup_root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))

rollback=f"""#!/usr/bin/env bash
set -euo pipefail
CONF={shlex.quote(str(conf))}
UNIT_FILE={shlex.quote(str(unit_file))}
UI={shlex.quote(str(current_ui))}
API={shlex.quote(str(current_api))}
UNIT={shlex.quote(unit_name)}
echo "Rollback code/config to packaged snapshot:"
echo "  UI  $UI"
echo "  API $API"
python3 - "$CONF" "$UI" <<'PY'
import pathlib,re,sys
conf=pathlib.Path(sys.argv[1])
ui=sys.argv[2]
text=conf.read_text()
text=re.sub(r'root\\s+[^;]+;', 'root '+ui+';', text)
conf.write_text(text)
PY
python3 - "$UNIT_FILE" "$API" <<'PY'
import pathlib,re,sys
unit=pathlib.Path(sys.argv[1])
api=sys.argv[2]
text=unit.read_text()
text=re.sub(r'ExecStart=(\\S+)\\s+[^\\n]*?/server/geo-api-server\\.mjs', r'ExecStart=\\1 '+api+'/server/geo-api-server.mjs', text)
unit.write_text(text)
PY
nginx -t
systemctl daemon-reload
systemctl restart "$UNIT"
systemctl reload nginx
curl --max-time 20 -fsS https://geoskill.7chacha.com/gongju/geo >/dev/null
systemctl is-active --quiet "$UNIT"
echo "rollback complete"
"""
rb=backup_root/'rollback-code-only.sh'
rb.write_text(rollback)
rb.chmod(0o700)

restore_check=backup_root/'restore-check'
restore_check.mkdir(mode=0o700)
run(['tar','-xzf',str(backup_root/'code-and-config.tgz'),'-C',str(restore_check)], timeout=900)
run(['tar','-tzf',str(backup_root/'private-data.tgz')], timeout=120)
shutil.rmtree(restore_check)

report={
    **meta,
    'backupDir':str(backup_root),
    'codeArchive':str(backup_root/'code-and-config.tgz'),
    'dataArchive':str(backup_root/'private-data.tgz'),
    'rollbackScript':str(rb),
    'manifestFiles':len(manifest),
    'status':'packaged-and-verified',
}
(backup_root/'package-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
'''


def main():
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.connect(HOST, username="root", password=os.environ["GEO_DEPLOY_PASSWORD"], timeout=20)
    try:
        stdin, stdout, stderr = client.exec_command("python3 -", timeout=1200)
        stdin.write(REMOTE_SCRIPT)
        stdin.channel.shutdown_write()
        out = stdout.read().decode()
        err = stderr.read().decode()
        code = stdout.channel.recv_exit_status()
        if code:
            raise RuntimeError(err or out)
        print(out.strip())
    finally:
        client.close()


if __name__ == "__main__":
    main()
