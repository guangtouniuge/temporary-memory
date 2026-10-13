"""Quiesce only the new GEO API, snapshot private data, and verify a separate restore."""
import os
import paramiko

c = paramiko.SSHClient()
c.load_system_host_keys()
c.connect('geoskill.7chacha.com', username='root', password=os.environ['GEO_DEPLOY_PASSWORD'], timeout=20)
script = r'''
import hashlib,json,os,pathlib,shutil,sqlite3,subprocess,time
os.umask(0o077)
unit='geoskill-commercial-api.service'
jobs=pathlib.Path('/root/.geoskill/commercial-jobs')
for p in jobs.glob('JOB-*.json'):
    if json.loads(p.read_text()).get('job',{}).get('status') in ('queued','running'): raise RuntimeError('Active production job; backup postponed')
subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
ledger=pathlib.Path('/root/.geoskill/auth/member-ledger.sqlite')
if ledger.exists():
    with sqlite3.connect('file:'+str(ledger)+'?mode=ro',uri=True) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='news_orders'").fetchone():
            if db.execute("SELECT 1 FROM news_orders WHERE state='sending' LIMIT 1").fetchone():
                raise RuntimeError('News submission in progress; backup postponed')
base=pathlib.Path('/root/.geoskill/backups')/('verified-'+time.strftime('%Y%m%d-%H%M%S'))
base.mkdir(parents=True)
names=['root/.geoskill/auth','root/.geoskill/commercial-jobs','root/.geoskill/commercial.env','www/wwwroot/geoskill.7chacha.com/outputs']
archive=base/'private-data.tgz'
manifest={}
def digest_file(file):
    digest=hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): digest.update(chunk)
    return digest.hexdigest()
subprocess.run(['systemctl','stop',unit],check=True)
try:
    for name in names:
        root=pathlib.Path('/')/name
        for file in ([root] if root.is_file() else root.rglob('*')):
            if file.is_symlink(): raise RuntimeError('Symlink needs explicit backup review')
            if file.is_file(): manifest[str(file.relative_to('/'))]=digest_file(file)
    subprocess.run(['tar','-czf',str(archive),'-C','/',*names],check=True)
finally:
    subprocess.run(['systemctl','start',unit],check=True)
    subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
restored=base/'restore-check'
restored.mkdir()
try:
    subprocess.run(['tar','-xzf',str(archive),'-C',str(restored)],check=True)
    for name,digest in manifest.items():
        file=restored/name
        if digest_file(file)!=digest: raise RuntimeError('Restored data mismatch')
finally:
    if restored.is_symlink() or restored.resolve().parent != base.resolve():
        raise RuntimeError('Unsafe verification cleanup path')
    shutil.rmtree(restored)
report={'backup':str(archive),'verifiedFiles':len(manifest),'status':'file-restore-verified','applicationRestored':False}
(base/'verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
'''
try:
    i, out, err = c.exec_command('python3 -', timeout=300)
    i.write(script)
    i.channel.shutdown_write()
    output, error = out.read().decode(), err.read().decode()
    if out.channel.recv_exit_status():
        raise RuntimeError(error or output)
    print(output)
finally:
    c.close()
