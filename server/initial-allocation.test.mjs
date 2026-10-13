import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemberLedger,resources} from './member-ledger.mjs'
test('opening quotas and enrollment are atomic, scoped and deducted from agent',()=>{
  const ledger=createMemberLedger(':memory:')
  const root={id:'root',role:'super_admin'},agent={id:'agent',role:'agent',agentId:'agent'},client={id:'client',role:'project_admin',agentId:'agent'},users=[root,agent,client]
  const quantities=Object.fromEntries(Object.keys(resources).map(k=>[k,10]))
  const open=(overrides={})=>ledger.handle({actor:agent,users,path:'/api/admin/members/packages/apply',method:'POST',enrollment:client,body:{userId:'client',initialAllocation:{quantities,days:30},saleCents:2000,reason:'开户',requestId:'opening-test-001',...overrides}})
  try {
    for(const resource of Object.keys(resources))ledger.handle({actor:root,users,path:'/api/admin/members/adjust',method:'POST',body:{userId:agent.id,resource,delta:resource==='publishingAccounts'?5:20,expectedAvailable:0,requestId:`fund-${resource}`,reason:'fixture'}})
    assert.throws(()=>open(),e=>e.status===409)
    assert.equal(ledger.summary(agent.id).articles.available,20)
    assert.equal(ledger.summary(client.id).articles.available,0)
    assert.equal(ledger.enrolledUsers().length,0)
    quantities.publishingAccounts=5
    open()
    assert.equal(ledger.summary(agent.id).articles.available,10)
    assert.equal(ledger.summary(client.id).articles.available,10)
    assert.equal(ledger.enrolledUsers()[0].id,client.id)
    assert.equal(open().duplicate,true)
    assert.equal(ledger.summary(agent.id).articles.available,10)
    assert.throws(()=>open({initialAllocation:{days:30,quantities:{articles:1}}}),e=>e.status===400)
    assert.throws(()=>ledger.handle({actor:agent,users,path:'/api/admin/members/packages/apply',method:'POST',body:{userId:client.id,initialAllocation:{days:30,quantities},saleCents:0,reason:'invalid',requestId:'opening-invalid'}}),e=>e.status===400)
  } finally {ledger.close()}
})
