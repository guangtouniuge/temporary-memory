import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemberLedger} from './member-ledger.mjs'
test('news orders reserve atomically, claim once and refund confirmed orders once',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},user={id:'customer',role:'project_admin'}
 try{
  for(const [resource,delta] of [['money',2000],['publications',2]])l.handle({actor:root,users:[root,user],path:'/api/admin/members/adjust',method:'POST',body:{userId:user.id,resource,delta,expectedAvailable:0,requestId:`fund-${resource}`,reason:'fixture'}})
  const n=l.news,items=[{articleId:'one',title:'标题',content:'正文',resourceId:'m',priceCents:1500}]
  const q=n.quote(user.id,'品牌',items,'quote-request')
  const unfunded=n.quote('unfunded','品牌',Array.from({length:10},(_,i)=>({...items[0],articleId:String(i),priceCents:470})),'unfunded-quote')
  const check=n.funding('unfunded',unfunded.map(o=>o.id))
  assert.equal(check.requiredCents,4700);assert.equal(check.requiredPublications,10)
  assert.match(check.reason,/余额不足.*47.00.*发布额度不足/)
  assert.throws(()=>n.reserve('unfunded',unfunded.map(o=>o.id)),e=>e.status===409&&e.message===check.reason)
  assert.equal(n.list('unfunded').every(o=>o.state==='quoted'),true)
  assert.equal(l.summary('unfunded').money.available,0)
  assert.equal(n.quote(user.id,'品牌',items,'quote-request')[0].id,q[0].id)
  assert.throws(()=>n.quote(user.id,'品牌',[{...items[0],priceCents:1}],'quote-request'),e=>e.status===409)
  assert.throws(()=>n.get('other',q[0].id),e=>e.status===404)
  const q2=n.quote(user.id,'品牌',items,'quote-request-two')
  assert.throws(()=>n.reserve(user.id,[q[0].id,q2[0].id]),e=>e.status===409)
  assert.equal(l.summary(user.id).money.available,2000)
  n.reserve(user.id,[q[0].id]);n.reserve(user.id,[q[0].id])
  assert.equal(l.summary(user.id).money.held,1500)
  assert.ok(n.claim(user.id,q[0].id));assert.equal(n.claim(user.id,q[0].id),null)
  n.accepted(user.id,q[0].id,'123')
  assert.equal(l.summary(user.id).money.used,1500)
  n.detail(user.id,q[0].id,{order_nid:'123',status:4,is_refund:1})
  n.detail(user.id,q[0].id,{order_nid:'123',status:4,is_refund:1})
  assert.equal(l.summary(user.id).money.available,2000)
  assert.equal(l.summary(user.id).publications.available,2)
  n.reserve(user.id,[q2[0].id]);n.claim(user.id,q2[0].id);n.uncertain(user.id,q2[0].id)
  assert.equal(n.claim(user.id,q2[0].id),null)
  assert.equal(l.summary(user.id).money.held,1500)
  assert.throws(()=>n.delete(user.id,q2[0].id),e=>e.status===409)
  assert.equal(n.requeue(user.id,q2[0].id).state,'reserved')
  assert.equal(l.summary(user.id).money.held,1500)
  assert.ok(n.claim(user.id,q2[0].id))
  n.uncertain(user.id,q2[0].id,'钱包余额不足')
  assert.equal(n.fail(user.id,q2[0].id,'人工确认失败').state,'refunded')
  assert.equal(l.summary(user.id).money.available,2000)
  assert.equal(l.summary(user.id).publications.available,2)
  assert.throws(()=>n.fail(user.id,q2[0].id),e=>e.status===409)
  assert.ok(n.delete(user.id,q2[0].id).deletedAt)
  assert.throws(()=>n.delete('other',q[0].id),e=>e.status===404)
  n.delete(user.id,q[0].id)
  assert.ok(!n.list(user.id).some(o=>o.id===q[0].id))
  assert.ok(n.get(user.id,q[0].id).deletedAt)
 }finally{l.close()}
})

test('deleting a reserved publication refunds once and retains its ledger record',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},u={id:'u',role:'project_admin'}
 try{
  for(const [resource,delta] of [['money',100],['publications',1]])l.handle({actor:root,users:[root,u],path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta,expectedAvailable:0,requestId:`fund-${resource}`,reason:'fixture'}})
  const n=l.news,[o]=n.quote(u.id,'brand',[{articleId:'a',title:'t',content:'c',resourceId:'m',priceCents:100}],'delete-request')
  n.reserve(u.id,[o.id]);n.delete(u.id,o.id);n.delete(u.id,o.id)
  assert.equal(l.summary(u.id).money.available,100)
  assert.equal(l.summary(u.id).publications.available,1)
  assert.equal(n.list(u.id).length,0)
  assert.equal(n.get(u.id,o.id).state,'cancelled')
  assert.equal(n.claim(u.id,o.id),null)
 }finally{l.close()}
})

test('scheduled publications wait in queue without charging until execution starts',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},u={id:'scheduler',role:'project_admin'}
 try{
  for(const [resource,delta] of [['money',1000],['publications',1]])l.handle({actor:root,users:[root,u],path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta,expectedAvailable:0,requestId:`schedule-fund-${resource}`,reason:'fixture'}})
  const n=l.news,[o]=n.quote(u.id,'brand',[{articleId:'a',title:'t',content:'c',resourceId:'m',priceCents:1000}],'schedule-request')
  const at=new Date(Date.now()+60_000).toISOString()
  assert.equal(n.schedule(u.id,[o.id],at)[0].state,'scheduled')
  assert.equal(l.summary(u.id).money.available,1000)
  assert.equal(l.summary(u.id).money.held,0)
  assert.equal(n.dueScheduled(u.id,Date.now()).length,0)
  assert.equal(n.dueScheduled(u.id,Date.now()+120_000).map(row=>row.id)[0],o.id)
  n.reserve(u.id,[o.id])
  assert.equal(l.summary(u.id).money.held,1000)
  assert.equal(n.get(u.id,o.id).state,'reserved')
 }finally{l.close()}
})

test('confirmed rejected publication returns used money and publication quota once',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},u={id:'u',role:'project_admin'}
 try{
  for(const [resource,delta] of [['money',1500],['publications',1]])l.handle({actor:root,users:[root,u],path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta,expectedAvailable:0,requestId:`reject-fund-${resource}`,reason:'fixture'}})
  const n=l.news,[o]=n.quote(u.id,'brand',[{articleId:'a',title:'t',content:'c',resourceId:'m',priceCents:1500}],'reject-request')
  n.reserve(u.id,[o.id])
  assert.ok(n.claim(u.id,o.id))
  n.accepted(u.id,o.id,'1:order')
  assert.equal(l.summary(u.id).money.used,1500)
  assert.equal(l.summary(u.id).money.available,0)
  n.detail(u.id,o.id,{order_nid:'1:order',status:1004,is_refund:1,rejection_info:'内容与网站定位不符'})
  n.detail(u.id,o.id,{order_nid:'1:order',status:1004,is_refund:1,rejection_info:'内容与网站定位不符'})
  assert.equal(n.get(u.id,o.id).state,'refunded')
  assert.equal(l.summary(u.id).money.available,1500)
  assert.equal(l.summary(u.id).money.used,0)
  assert.equal(l.summary(u.id).publications.available,1)
  assert.equal(l.summary(u.id).publications.used,0)
 }finally{l.close()}
})

test('stale publications are automatically marked failed and refunded after the timeout',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},u={id:'u',role:'project_admin'}
 try{
  for(const [resource,delta] of [['money',5000],['publications',5]])l.handle({actor:root,users:[root,u],path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta,expectedAvailable:0,requestId:`stale-fund-${resource}`,reason:'fixture'}})
  const n=l.news
  const [pending]=n.quote(u.id,'brand',[{articleId:'pending',title:'t1',content:'c',resourceId:'m1',priceCents:1000}],'stale-pending')
  const [arranged]=n.quote(u.id,'brand',[{articleId:'arranged',title:'t2',content:'c',resourceId:'m2',providerChannel:'news2',priceCents:1200}],'stale-arranged')
  const [success]=n.quote(u.id,'brand',[{articleId:'success',title:'t3',content:'c',resourceId:'m3',providerChannel:'news2',priceCents:800}],'stale-success')
  const [quoted]=n.quote(u.id,'brand',[{articleId:'quoted',title:'t4',content:'c',resourceId:'m4',priceCents:900}],'stale-quoted')
  const [scheduled]=n.quote(u.id,'brand',[{articleId:'scheduled',title:'t5',content:'c',resourceId:'m5',priceCents:1100}],'stale-scheduled')
  n.schedule(u.id,[scheduled.id],new Date(Date.now()+60_000).toISOString())
  n.reserve(u.id,[pending.id])
  n.claim(u.id,pending.id)
  n.uncertain(u.id,pending.id,'平台未返回订单号')
  n.reserve(u.id,[arranged.id])
  n.claim(u.id,arranged.id)
  n.accepted(u.id,arranged.id,'arranged-order')
  n.detail(u.id,arranged.id,{order_nid:'arranged-order',status:1001,is_refund:0})
  n.reserve(u.id,[success.id])
  n.claim(u.id,success.id)
  n.accepted(u.id,success.id,'success-order')
  n.detail(u.id,success.id,{order_nid:'success-order',status:1002,is_refund:0})
  assert.equal(l.summary(u.id).money.held,1000)
  assert.equal(l.summary(u.id).money.used,2000)
  const expired=n.expireStale(u.id,Date.now()+49*60*60*1000)
  assert.equal(expired.length,5)
  assert.equal(n.get(u.id,pending.id).state,'refunded')
  assert.equal(n.get(u.id,arranged.id).state,'refunded')
  assert.equal(n.get(u.id,success.id).state,'refunded')
  assert.equal(n.get(u.id,quoted.id).state,'cancelled')
  assert.equal(n.get(u.id,scheduled.id).state,'cancelled')
  assert.equal(l.summary(u.id).money.available,5000)
  assert.equal(l.summary(u.id).money.held,0)
  assert.equal(l.summary(u.id).money.used,0)
  assert.equal(l.summary(u.id).publications.available,5)
  assert.equal(l.summary(u.id).publications.held,0)
  assert.equal(l.summary(u.id).publications.used,0)
 }finally{l.close()}
})

test('stale publication cleanup can sweep every owner safely',()=>{
 const l=createMemberLedger(':memory:'),root={id:'root',role:'super_admin'},a={id:'a',role:'project_admin'},b={id:'b',role:'project_admin'}
 try{
  for(const u of [a,b])for(const [resource,delta] of [['money',500],['publications',1]])l.handle({actor:root,users:[root,u],path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta,expectedAvailable:0,requestId:`global-stale-${u.id}-${resource}`,reason:'fixture'}})
  const n=l.news
  for(const u of [a,b]){
    const [o]=n.quote(u.id,'brand',[{articleId:`article-${u.id}`,title:'t',content:'c',resourceId:'m',providerChannel:'news2',priceCents:500}],`global-stale-${u.id}`)
    n.reserve(u.id,[o.id]);n.claim(u.id,o.id);n.accepted(u.id,o.id,`order-${u.id}`)
    n.detail(u.id,o.id,{order_nid:`order-${u.id}`,status:1001,is_refund:0})
  }
  const expired=n.expireAllStale(Date.now()+49*60*60*1000)
  assert.equal(expired.length,2)
  assert.equal(l.summary(a.id).money.available,500)
  assert.equal(l.summary(b.id).money.available,500)
  assert.equal(l.summary(a.id).money.used,0)
  assert.equal(l.summary(b.id).money.used,0)
 }finally{l.close()}
})
