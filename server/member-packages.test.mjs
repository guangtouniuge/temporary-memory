import test from 'node:test'
import assert from 'node:assert/strict'
import { createMemberLedger } from './member-ledger.mjs'
test('package CRUD, atomic grants, immutable snapshots and durable enrollment',()=>{
 const l=createMemberLedger(':memory:'),root={id:'r',role:'super_admin'},agent={id:'a',role:'agent',agentId:'a'},client={id:'c',role:'project_admin',agentId:'a'},users=[root,agent,client]
 const call=(actor,path,body)=>l.handle({actor,users,path:'/api/admin/members/packages'+path,method:body?'POST':'GET',body})
 try{
  const p=call(root,'/save',{name:'测试套餐',days:30,priceCents:10000,status:'active',quantities:{articles:100,storageMB:50}}).package
  assert.throws(()=>call(agent,'/save',p),e=>e.status===403)
  const payload={userId:'c',packageId:p.id,revision:p.revision,requestId:'package-test-001',saleCents:20000,reason:'购买登记'}
  assert.throws(()=>call(agent,'/apply',payload),e=>e.status===409)
  assert.equal(l.summary('c').articles.available,0)
  call(root,'/apply',{...payload,userId:'a'})
  call(agent,'/apply',payload)
  assert.equal(l.summary('a').articles.available,0)
  assert.equal(l.summary('c').articles.available,100)
  assert.equal(call(agent,'/apply',payload).duplicate,true)
  const commercial=(actor,path='',body)=>l.handle({actor,users,path:'/api/admin/members/commerce'+path,method:body?'POST':'GET',body})
  const orders=commercial(agent).orders
  assert.equal(orders.length,1)
  assert.equal(orders[0].settlement.costCents,null)
  assert.throws(()=>commercial(client),e=>e.status===403)
  const settlement={id:orders[0].id,revision:0,receivedCents:20000,refundedCents:1000,costCents:8000,reason:'bank statement'}
  commercial(agent,'/save',settlement)
  assert.equal(commercial(agent).orders[0].settlement.receivedCents,20000)
  assert.throws(()=>commercial(agent,'/save',settlement),e=>e.status===409)
  assert.throws(()=>commercial({id:'other',role:'agent',agentId:'other'},'/save',settlement),e=>e.status===403)
  assert.throws(()=>commercial(agent,'/save',{...settlement,revision:1,refundedCents:30000}),e=>e.status===400)
  assert.equal(commercial(agent,'/history',{id:orders[0].id}).entries.length,1)
  assert.equal(l.summary('c').money.available,0)
  const p2=call(root,'/save',{...p,name:'改名套餐',quantities:{articles:200},revision:p.revision}).package
  assert.equal(l.membership('c').snapshot.name,'测试套餐')
  assert.throws(()=>call(root,'/save',p),e=>e.status===409)
  assert.throws(()=>call(root,'/apply',{...payload,requestId:'old-plan-test'}),e=>e.status===409)
  const newUser={id:'n',username:'new',role:'project_admin',agentId:'a'}
  assert.throws(()=>l.handle({actor:agent,users:[...users,newUser],enrollment:newUser,path:'/api/admin/members/packages/apply',method:'POST',body:{...payload,userId:'n',revision:p2.revision,requestId:'enroll-failure'}}),e=>e.status===409)
  assert.equal(l.enrolledUsers().length,0)
  l.handle({actor:root,users:[...users,newUser],enrollment:newUser,path:'/api/admin/members/packages/apply',method:'POST',body:{...payload,userId:'n',revision:p2.revision,requestId:'enroll-success'}})
  assert.equal(l.enrolledUsers()[0].username,'new')
  assert.equal(l.summary('n').articles.available,200)
  call(root,'/delete',{id:p2.id,revision:p2.revision})
  assert.equal(call(root,'').packages.length,0)
  assert.equal(l.summary('c').articles.available,100)
 }finally{l.close()}
})
