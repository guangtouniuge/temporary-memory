import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemberLedger } from './member-ledger.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('batch quota edits transfer atomically and reach news funding',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},agent={id:'agent',role:'agent',agentId:'a'},client={id:'client',role:'project_admin',agentId:'a'},foreign={id:'foreign',role:'project_admin',agentId:'b'},users=[root,agent,client,foreign]
 const edit=(actor,userId,changes,id)=>l.handle({actor,users,path:'/api/admin/members/adjust-many',method:'POST',body:{userId,changes,requestId:id,reason:'测试额度配置'}})
 const change=(resource,delta,expectedAvailable=0)=>({resource,delta,expectedAvailable})
 try{
  edit(root,'agent',[change('money',20000),change('publications',10)],'root-batch-1')
  const changes=[change('money',1900),change('publications',5)]
  edit(agent,'client',changes,'agent-batch-1');assert.equal(edit(agent,'client',changes,'agent-batch-1').duplicate,true)
  assert.equal(l.summary('agent').publications.available,5)
  const orders=l.news.quote('client','品牌',Array.from({length:5},(_,i)=>({articleId:String(i),priceCents:380})),'test-quote-funds')
  assert.equal(l.news.funding('client',orders.map(o=>o.id)).reason,'')
  assert.throws(()=>edit(agent,'client',[change('money',100,1900),change('publications',6,5)],'agent-batch-2'),e=>e.status===409)
  assert.equal(l.summary('client').money.available,1900)
  assert.throws(()=>edit(agent,'foreign',[change('money',1)],'agent-batch-3'),e=>e.status===403)
  edit(agent,'client',[change('publications',-2,5)],'agent-batch-4');assert.equal(l.summary('agent').publications.available,7)
 }finally{l.close()}
})

test('member allocation: atomic transfer, insufficient balance, isolation, idempotency and persistence', () => {
  const dir=mkdtempSync(join(tmpdir(),'member-ledger-')), file=join(dir,'ledger.sqlite')
  let ledger=createMemberLedger(file)
  const root={id:'root',role:'super_admin'},agent={id:'agent',role:'agent',agentId:'a'},client={id:'client',role:'project_admin',agentId:'a'},foreign={id:'foreign',role:'project_admin',agentId:'b'}
  const users=[root,agent,client,foreign]
  const adjust=(actor,userId,delta,requestId,expectedAvailable,resource='articles')=>ledger.handle({actor,users,path:'/api/admin/members/adjust',method:'POST',body:{userId,delta,requestId,expectedAvailable,resource,reason:'测试分配'}})
  const status=(fn,n)=>assert.throws(fn,e=>e.status===n)
  try {
    adjust(root,'agent',100,'credit-001',0)
    adjust(agent,'client',40,'transfer-001',0)
    assert.equal(ledger.summary('agent').articles.available,60)
    assert.equal(ledger.summary('client').articles.available,40)
    assert.equal(adjust(agent,'client',40,'transfer-001',0).duplicate,true)
    status(()=>adjust(agent,'client',41,'transfer-001',40),409)
    status(()=>adjust(agent,'client',70,'transfer-002',40),409)
    assert.equal(ledger.summary('client').articles.available,40)
    assert.equal(ledger.summary('agent').articles.available,60)
    status(()=>adjust(agent,'client',1,'transfer-003',0),409)
    status(()=>adjust(agent,'foreign',1,'transfer-004',0),403)
    status(()=>adjust(client,'client',1,'transfer-005',40),403)
    status(()=>adjust(agent,'agent',1,'transfer-006',60),403)
    status(()=>adjust(root,'client',0.1,'transfer-007',40),400)
    adjust(agent,'client',-10,'return-001',40)
    assert.equal(ledger.summary('agent').articles.available,70)
    assert.equal(ledger.summary('client').articles.available,30)
    const hold=ledger.reserveArticle('client','job-article-1')
    assert.equal(ledger.summary('client').articles.available,29)
    assert.equal(ledger.summary('client').articles.held,1)
    ledger.reserveArticle('client','job-article-1')
    assert.equal(ledger.summary('client').articles.available,29)
    ledger.settleArticle(hold,false)
    ledger.settleArticle(hold,false)
    assert.equal(ledger.summary('client').articles.available,30)
    ledger.reserveArticle('client','job-article-1')
    ledger.settleArticle(hold,true)
    ledger.settleArticle(hold,true)
    ledger.reserveArticle('client','job-article-1')
    assert.equal(ledger.summary('client').articles.available,29)
    assert.equal(ledger.summary('client').articles.used,1)
    assert.equal(ledger.summary('client').articles.held,0)
    status(()=>ledger.reserveArticle('unconfigured','job-unknown'),403)
    status(()=>adjust(agent,'client',-31,'return-002',30),409)
    assert.equal(ledger.summary('agent').articles.available,70)
    adjust(root,'agent',1234,'money-001',0,'money')
    const list=ledger.handle({actor:agent,users,path:'/api/admin/members',method:'GET'})
    assert.deepEqual(list.members.map(u=>u.id),['agent','client'])
    const history=ledger.handle({actor:agent,users,path:'/api/admin/members/history',method:'POST',body:{userId:'agent'}})
    assert.equal(history.entries.length,4)
    ledger.close();ledger=createMemberLedger(file)
    assert.equal(ledger.summary('agent').money.available,1234)
    assert.equal(ledger.summary('client').articles.available,29)
  } finally { ledger.close();rmSync(dir,{recursive:true,force:true}) }
})
