"""One-off, provenance-scoped cleanup. Run on host; default is dry run."""
import json, pathlib, re, shutil, sqlite3, subprocess, sys, time, hashlib

ROOT=pathlib.Path('/www/wwwroot/geoskill.7chacha.com')
AUTH=pathlib.Path('/root/.geoskill/auth/accounts.json')
JOBS=pathlib.Path('/root/.geoskill/commercial-jobs')
UNIT='geoskill-commercial-api.service'
def read(p): return json.loads(p.read_text())
def plan():
    accounts=read(AUTH)
    users=[u for u in accounts['users'] if re.fullmatch(r'qa-(agent|a|b|op)-[a-z0-9]+',u.get('username','')) and u.get('displayName')=='验收测试账号' and u.get('projectName')=='验收隔离测试']
    ids={u['id'] for u in users}; projects={u['projectId'] for u in users if u.get('projectId')}
    assert all(u.get('projectId') not in projects for u in accounts['users'] if u['id'] not in ids)
    jobs=[];articles=set()
    for p in JOBS.glob('JOB-*.json'):
        r=read(p);j=r.get('job',{})
        if j.get('status') in ('queued','running'): raise RuntimeError('Active job: abort cleanup')
        name=r.get('body',{}).get('taskName','')
        if j.get('projectId') in projects or (j.get('projectId')=='exposure-main' and re.search('验收|复测|测试|原Skill生产路径清理验证',name)):
            jobs.append(p);articles.update(a['id'] for a in j.get('articles',[]) if a.get('id'))
    db=sqlite3.connect('/root/.geoskill/auth/member-ledger.sqlite')
    assert db.execute("SELECT count(*) FROM news_orders WHERE state='sending'").fetchone()[0]==0
    if ids: assert db.execute('SELECT count(*) FROM wallets WHERE owner IN ('+','.join('?' for _ in ids)+')',tuple(ids)).fetchone()[0]==0
    order_data='\n'.join(r[0] for r in db.execute('SELECT data FROM news_orders'))
    linked={a for a in articles if a in order_data}
    jobs=[p for p in jobs if not any(a.get('id') in linked for a in read(p).get('job',{}).get('articles',[]))]
    articles={a['id'] for p in jobs for a in read(p).get('job',{}).get('articles',[]) if a.get('id')}
    print(json.dumps({'published_article_ids_preserved':len(linked)}))
    db.close()
    state=ROOT/'outputs/projects/exposure-main/data/app-state.json'
    old=read(state);removed=[a for a in old.get('geo.articleRows',[]) if a.get('id') in articles]
    return accounts,ids,projects,jobs,articles,state,old,removed

data=plan()
print(json.dumps({'accounts':len(data[1]),'projects':len(data[2]),'jobs':len(data[3]),'articles':len(data[7]),'mode':'apply' if '--apply' in sys.argv else 'dry-run'}))
if '--apply' not in sys.argv: sys.exit(0)
subprocess.check_call(['systemctl','stop',UNIT])
try:
    accounts,ids,projects,jobs,articles,state,old,removed=plan()
    backup=pathlib.Path('/root/.geoskill/backups/test-cleanup-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir(mode=0o700)
    protected={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'outputs/projects').glob('*/data/app-state.json') if p.parts[-3] not in projects|{'exposure-main'}}
    shutil.copy2(AUTH,backup/'accounts.json');shutil.copy2(state,backup/'exposure-state.json')
    (backup/'jobs').mkdir();(backup/'projects').mkdir()
    index=ROOT/'outputs/data/project-accounts.json'
    if index.exists(): shutil.copy2(index,backup/'project-accounts.json')
    accounts['users']=[u for u in accounts['users'] if u['id'] not in ids]
    accounts['sessions']=[s for s in accounts.get('sessions',[]) if not any(i in json.dumps(s) for i in ids)]
    AUTH.write_text(json.dumps(accounts,ensure_ascii=False,indent=2))
    jobids={p.stem for p in jobs}
    old['geo.articleRows']=[a for a in old.get('geo.articleRows',[]) if a.get('id') not in articles]
    old['geo.taskRows']=[t for t in old.get('geo.taskRows',[]) if t.get('jobId') not in jobids]
    state.write_text(json.dumps(old,ensure_ascii=False,indent=2))
    if index.exists(): index.write_text(json.dumps([r for r in read(index) if r.get('projectId') not in projects],ensure_ascii=False,indent=2))
    for p in jobs: shutil.move(str(p),str(backup/'jobs'/p.name))
    for project in projects:
        p=(ROOT/'outputs/projects'/project).resolve()
        assert p.parent==(ROOT/'outputs/projects').resolve()
        if p.exists(): shutil.move(str(p),str(backup/'projects'/project))
    assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in protected.items())
    assert not any(u['id'] in ids for u in read(AUTH)['users'])
    print(json.dumps({'backup':str(backup),'remaining_accounts':len(accounts['users']),'remaining_exposure_articles':len(old['geo.articleRows']),'real_projects_unchanged':True}))
finally:
    subprocess.check_call(['systemctl','start',UNIT])
    subprocess.check_call(['systemctl','is-active','--quiet',UNIT])
