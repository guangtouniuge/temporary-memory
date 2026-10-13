import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemberLedger} from './member-ledger.mjs'
import {articleSceneImages} from './volcengine-images.mjs'

test('two-image batch charges 200 cents only on success, failures refund, cached retry charges once',async()=>{
  const l=createMemberLedger(':memory:')
  const root={id:'root',role:'super_admin'},client={id:'client',role:'project_admin'},users=[root,client]
  const adjust=(resource,delta)=>l.handle({actor:root,users,path:'/api/admin/members/adjust',method:'POST',body:{userId:'client',resource,delta,requestId:`opening-${resource}`,expectedAvailable:0,reason:'isolated test'}})
  try {
    adjust('money',200);adjust('articles',3)
    l.reserveArticle('client','job:0',{instance:'worker'})
    l.reserveArticle('client','job:1',{instance:'worker'})
    const saved=new Map(),state={},billing={reserve:()=>l.reserveImages('client','job:0','worker'),settle:(id,ok)=>l.settleImages(id,ok,'worker')}
    let calls=0
    const options={project:{name:'A'},title:'title',body:'body',articleId:'job:0',state,billing,saveState:()=>{},findSaved:key=>saved.get(key),saveImage:(key)=>{const row={path:key};saved.set(key,row);return row},generate:async()=>{
      calls++;assert.equal(l.summary('client').money.held,200)
      assert.throws(()=>l.reserveImages('client','job:1','worker'),/余额不足/)
      if(calls===2)throw Object.assign(new Error('rejected'),{confirmedFailure:true})
      return {}
    }}
    await assert.rejects(articleSceneImages(options),/rejected/)
    assert.equal(l.summary('client').money.available,200);assert.equal(l.summary('client').money.used,0)
    assert.equal(saved.size,1)
    assert.equal((await articleSceneImages(options)).length,2)
    assert.equal(calls,3);assert.equal(l.summary('client').money.available,0);assert.equal(l.summary('client').money.used,200);assert.equal(l.summary('client').money.held,0)
    await articleSceneImages(options);assert.equal(calls,3);assert.equal(l.summary('client').money.used,200)
    l.settleArticle('job:0',false);assert.equal(l.summary('client').money.used,200)
    assert.throws(()=>l.checkImageMoney('client'),/自有图库/)
    assert.throws(()=>l.reserveImages('foreign','job:0','worker'),/归属冲突/)
    assert.throws(()=>l.reserveImages('client','job:1','other-worker'),/租约无效/)
  }finally{l.close()}
})

test('canceling an article releases its image reservation; insufficient money never calls image model',async()=>{
  const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},client={id:'client',role:'project_admin'}
  try {
    for(const [resource,delta] of [['money',200],['articles',1]])l.handle({actor:root,users:[root,client],path:'/api/admin/members/adjust',method:'POST',body:{userId:'client',resource,delta,requestId:`opening-${resource}`,expectedAvailable:0,reason:'isolated test'}})
    l.reserveArticle('client','job:0',{instance:'worker'})
    l.reserveImages('client','job:0','worker');l.releaseJob('job:','worker')
    assert.equal(l.summary('client').money.available,200);assert.equal(l.summary('client').money.held,0)
    let called=false
    await assert.rejects(articleSceneImages({billing:{reserve:()=>{throw new Error('余额不足')}},generate:()=>{called=true}}),/余额不足/)
    assert.equal(called,false)
  }finally{l.close()}
})

test('expired worker releases held image money without changing completed image charges',t=>{
  const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},client={id:'client',role:'project_admin'}
  try {
    for(const [resource,delta] of [['money',400],['articles',2]])l.handle({actor:root,users:[root,client],path:'/api/admin/members/adjust',method:'POST',body:{userId:'client',resource,delta,requestId:`opening-${resource}`,expectedAvailable:0,reason:'isolated test'}})
    for(const id of ['done','interrupted']){l.reserveArticle('client',id,{instance:'worker'});l.reserveImages('client',id,'worker')}
    l.settleImages('done',true,'worker')
    const future=Date.now()+180000;t.mock.method(Date,'now',()=>future)
    l.recoverExpiredLeases()
    assert.equal(l.summary('client').money.available,200);assert.equal(l.summary('client').money.used,200);assert.equal(l.summary('client').money.held,0)
    l.recoverExpiredLeases();assert.equal(l.summary('client').money.available,200)
  }finally{t.mock.restoreAll();l.close()}
})
