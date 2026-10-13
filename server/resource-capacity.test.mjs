import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemberLedger} from './member-ledger.mjs'
import {stateCapacity} from './resource-capacity.mjs'

test('capacity is enforced, released and rolled back without changing article quotas',()=>{
  const ledger=createMemberLedger(':memory:')
  const user={id:'client',role:'project_admin'},root={id:'root',role:'super_admin'}
  try {
    let saved=false
    assert.throws(()=>ledger.withCapacity(user.id,{projects:1},()=>{saved=true}),e=>e.status===409)
    assert.equal(saved,false)
    for(const resource of ['projects','keywords','storageMB'])ledger.handle({actor:root,users:[user],path:'/api/admin/members/adjust',method:'POST',body:{userId:user.id,resource,delta:2,expectedAvailable:0,requestId:`capacity-${resource}`,reason:'test'}})
    ledger.withCapacity(user.id,{projects:2,keywords:2,storageMB:1},()=>{saved=true})
    assert.equal(saved,true)
    assert.equal(ledger.summary(user.id).projects.available,0)
    assert.throws(()=>ledger.withCapacity(user.id,{projects:3},()=>assert.fail('must not persist')),e=>e.status===409)
    assert.throws(()=>ledger.withCapacity(user.id,{projects:1},()=>{throw Error('disk failed')}),/disk failed/)
    assert.equal(ledger.summary(user.id).projects.used,2)
    ledger.withCapacity(user.id,{projects:1,keywords:0},()=>{})
    assert.equal(ledger.summary(user.id).projects.available,1)
    assert.equal(ledger.summary(user.id).keywords.available,2)
    assert.equal(ledger.summary(user.id).articles.managed,false)
    const history=ledger.handle({actor:root,users:[user],path:'/api/admin/members/history',method:'POST',body:{userId:user.id}})
    assert.ok(history.entries.some(e=>e.reason==='资源释放'))
  } finally {ledger.close()}
})

test('keywords share one capacity pool and repeated words within a brand are not counted twice',()=>{
  assert.deepEqual(stateCapacity({'geo.projectRows':[{},{}],'geo.keywordRows':[['brand','core']],'geo.keywordLibraryRows':[['brand','core','question']],'geo.questionRows':[['brand','core','question'],['other','core','question']]}),{projects:2,keywords:3})
})

test('terminal job releases only its own unfinished reservations',()=>{
  const ledger=createMemberLedger(':memory:'),user={id:'client',role:'project_admin'}
  try {
    ledger.handle({actor:{id:'root',role:'super_admin'},users:[user],path:'/api/admin/members/adjust',method:'POST',body:{userId:user.id,resource:'articles',delta:5,expectedAvailable:0,requestId:'job-fixture',reason:'test'}})
    for(const id of ['client:job1:0','client:job1:1','client:job10:0'])ledger.reserveArticle(user.id,id)
    ledger.settleArticle('client:job1:0',true,{articles:[{body:'saved'}]})
    ledger.releaseJob('client:job1:');ledger.releaseJob('client:job1:')
    assert.deepEqual(ledger.summary(user.id).articles,{available:3,used:1,held:1,managed:true})
    assert.ok(ledger.articleResult('client:job1:0'))
  } finally {ledger.close()}
})

test('reconciliation retains purchased capacity and permits reducing overage without creating free quota',()=>{
  const l=createMemberLedger(':memory:'),u={id:'c',role:'project_admin'}
  try {
    l.handle({actor:{id:'root',role:'super_admin'},users:[u],path:'/api/admin/members/adjust',method:'POST',body:{userId:'c',resource:'projects',delta:2,expectedAvailable:0,requestId:'reconcile-test',reason:'test'}})
    l.reconcileCapacity('c',{projects:5})
    assert.equal(l.summary('c').projects.available,0)
    assert.equal(l.summary('c').projects.used,2)
    assert.throws(()=>l.withCapacity('c',{projects:6},()=>{}),e=>e.status===409)
    l.withCapacity('c',{projects:4},()=>{})
    assert.equal(l.summary('c').projects.available,0)
    l.withCapacity('c',{projects:1},()=>{})
    assert.equal(l.summary('c').projects.available,1)
    l.reconcileCapacity('c',{projects:1})
    assert.equal(l.summary('c').projects.available,1)
  } finally {l.close()}
})
