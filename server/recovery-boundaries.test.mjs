import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,readFileSync,existsSync,rmSync,mkdirSync,writeFileSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createMemberLedger} from './member-ledger.mjs'

const fund=(l,resource,amount)=>l.handle({actor:{id:'root',role:'super_admin'},users:[{id:'client',role:'project_admin'}],path:'/api/admin/members/adjust',method:'POST',body:{userId:'client',resource,delta:amount,expectedAvailable:0,requestId:`fund-${resource}`,reason:'test fixture'}})
test('expired lease is refunded once; a stale worker cannot settle a replacement claim',()=>{
  const dir=mkdtempSync(join(tmpdir(),'geo-lease-')),file=join(dir,'ledger.sqlite')
  let ledger=createMemberLedger(file)
  try {
    fund(ledger,'articles',3)
    const id=ledger.reserveArticle('client','client:direct:test',{instance:'old',fingerprint:'same'})
    assert.throws(()=>ledger.reserveArticle('client',id,{instance:'new',fingerprint:'same'}),e=>e.status===409)
    const sql=new DatabaseSync(file)
    sql.prepare('UPDATE work_leases SET expires=0 WHERE id=?').run(id);sql.close()
    ledger.close();ledger=createMemberLedger(file)
    assert.equal(ledger.recoverExpiredLeases(),1)
    assert.equal(ledger.recoverExpiredLeases(),0)
    assert.equal(ledger.summary('client').articles.available,3)
    assert.throws(()=>ledger.reserveArticle('client',id,{instance:'new',fingerprint:'changed'}),e=>e.status===409)
    ledger.reserveArticle('client',id,{instance:'new',fingerprint:'same'})
    assert.throws(()=>ledger.settleArticle(id,true,{ok:true},'old'),e=>e.status===409)
    ledger.releaseJob('client:direct:','old')
    assert.equal(ledger.summary('client').articles.held,1)
    assert.equal(ledger.summary('client').articles.available,2)
    ledger.renewLeases('new')
    ledger.settleArticle(id,true,{ok:true,articles:[{body:'durable'}]},'new')
    assert.deepEqual(ledger.summary('client').articles,{available:2,used:1,held:0,managed:true})
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true})}
})

test('file intent and capacity commit together; reopening replays the same files exactly once',()=>{
  const dir=mkdtempSync(join(tmpdir(),'geo-files-')),root=join(dir,'project'),file=join(dir,'ledger.sqlite')
  let ledger=createMemberLedger(file)
  try {
    fund(ledger,'storageMB',10)
    const writes=[{path:join(root,'data','app-state.json'),data:Buffer.from('{"saved":true}').toString('base64')},{path:join(root,'uploads','image.png'),data:Buffer.from('image bytes').toString('base64')}]
    ledger.stageFiles('client',{storageMB:1},root,writes)
    assert.equal(existsSync(writes[0].path),false)
    assert.equal(ledger.summary('client').storageMB.used,1)
    assert.throws(()=>ledger.stageFiles('client',{storageMB:2},root,writes),e=>e.status===503)
    assert.equal(ledger.summary('client').storageMB.used,1)
    ledger.close();ledger=createMemberLedger(file)
    ledger.flushFiles('client');ledger.flushFiles('client')
    assert.equal(readFileSync(writes[0].path,'utf8'),'{"saved":true}')
    assert.equal(readFileSync(writes[1].path,'utf8'),'image bytes')
    assert.equal(ledger.summary('client').storageMB.used,1)
    const sql=new DatabaseSync(file)
    sql.exec("CREATE TRIGGER reject_intent BEFORE INSERT ON pending_files BEGIN SELECT RAISE(ABORT,'injected intent failure'); END")
    assert.throws(()=>ledger.stageFiles('client',{storageMB:2},root,writes),/injected intent failure/)
    assert.equal(ledger.summary('client').storageMB.used,1)
    sql.exec('DROP TRIGGER reject_intent');sql.close()
    assert.throws(()=>ledger.stageFiles('client',{storageMB:2},root,[{...writes[0],path:join(dir,'escape')}]),/范围/)
    // A blocked directory leaves the committed intent available for replay.
    writeFileSync(join(root,'blocked'),'not a directory')
    ledger.stageFiles('client',{storageMB:2},root,[{path:join(root,'blocked','next'),data:Buffer.from('restored').toString('base64')}])
    assert.throws(()=>ledger.flushFiles('client'))
    rmSync(join(root,'blocked'));mkdirSync(join(root,'blocked'))
    ledger.close();ledger=createMemberLedger(file);ledger.flushFiles('client')
    assert.equal(readFileSync(join(root,'blocked','next'),'utf8'),'restored')
    assert.equal(ledger.summary('client').storageMB.used,2)
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true})}
})

test('restored pending writes remain inside the restored project, never the original site',()=>{
  const dir=mkdtempSync(join(tmpdir(),'geo-restore-path-')),original=join(dir,'original'),restored=join(dir,'restored'),file=join(dir,'source.sqlite'),copy=join(dir,'copy.sqlite')
  let ledger=createMemberLedger(file)
  try {
    fund(ledger,'storageMB',5)
    ledger.stageFiles('client',{storageMB:1},original,[{path:join(original,'data','state.json'),data:Buffer.from('saved').toString('base64')}])
    ledger.close();copyFileSync(file,copy);ledger=createMemberLedger(copy)
    ledger.flushFiles('client',restored)
    assert.equal(readFileSync(join(restored,'data','state.json'),'utf8'),'saved')
    assert.equal(existsSync(join(original,'data','state.json')),false)
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true})}
})

test('pending file recovery uses short temporary names for long export titles',()=>{
  const dir=mkdtempSync(join(tmpdir(),'geo-long-pending-')),root=join(dir,'project'),file=join(dir,'ledger.sqlite')
  let ledger=createMemberLedger(file)
  try {
    fund(ledger,'storageMB',2)
    const longName='2026年9月业财融合财务体系搭建经营数据分析财务诊断财务咨询成本核算利润最大化服务商推荐'.repeat(2).slice(0,70)+'.doc'
    const final=join(root,'exports',longName)
    ledger.stageFiles('client',{storageMB:1},root,[{path:final,data:Buffer.from('saved').toString('base64')}])
    ledger.flushFiles('client')
    assert.equal(readFileSync(final,'utf8'),'saved')
  } finally {ledger.close();rmSync(dir,{recursive:true,force:true})}
})
