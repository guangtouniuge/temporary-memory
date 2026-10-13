import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync, backup } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemberLedger } from './member-ledger.mjs'

test('commercial ledger: two agents, four clients, crash consistency and restored backup', async () => {
  const dir=mkdtempSync(join(tmpdir(),'commercial-acceptance-'))
  const file=join(dir,'ledger.sqlite'), restored=join(dir,'restored.sqlite')
  let ledger=createMemberLedger(file)
  const root={id:'root',role:'super_admin'}
  const agents=['a','b'].map(id=>({id,agentId:id,role:'agent'}))
  const clients=['a1','a2','b1','b2'].map(id=>({id,agentId:id[0],role:'project_admin'}))
  const users=[root,...agents,...clients]
  const adjust=(actor,userId,delta,requestId)=>ledger.handle({actor,users,path:'/api/admin/members/adjust',method:'POST',body:{userId,delta,resource:'articles',requestId,expectedAvailable:ledger.summary(userId).articles.available,reason:'acceptance'}})
  try {
    for(const a of agents)adjust(root,a.id,100,`fund-agent-${a.id}`)
    for(const c of clients)adjust(agents.find(a=>a.id===c.agentId),c.id,10,`fund-client-${c.id}`)
    for(const a of agents) {
      const list=ledger.handle({actor:a,users,path:'/api/admin/members',method:'GET'})
      assert.deepEqual(list.members.map(u=>u.id),[a.id,...clients.filter(c=>c.agentId===a.id).map(c=>c.id)])
      for(const c of clients.filter(c=>c.agentId!==a.id)) {
        assert.throws(()=>adjust(a,c.id,1,`cross-${a.id}-${c.id}`),e=>e.status===403)
        assert.throws(()=>ledger.handle({actor:a,users,path:'/api/admin/members/history',method:'POST',body:{userId:c.id}}),e=>e.status===403)
      }
    }
    for(let i=0;i<5;i++) {
      const id=`a1:job:${i}`, success=i<3
      ledger.reserveArticle('a1',id)
      ledger.settleArticle(id,success,success?{ok:true,articles:[{id:`article-${i}`,body:'Completed article'}]}:null)
      ledger.settleArticle(id,success)
    }
    assert.deepEqual(ledger.summary('a1').articles,{available:7,used:3,held:0,managed:true})
    ledger.close();ledger=createMemberLedger(file)
    assert.equal(ledger.articleResult('a1:job:2').articles[0].id,'article-2')
    ledger.reserveArticle('a1','a1:job:2')
    assert.equal(ledger.summary('a1').articles.available,7)

    // Inject a storage failure after the result INSERT, within settlement.
    const probe=new DatabaseSync(file)
    probe.exec("CREATE TRIGGER fail_settle BEFORE UPDATE ON wallets WHEN NEW.used > OLD.used BEGIN SELECT RAISE(ABORT,'injected storage failure'); END")
    const hold=ledger.reserveArticle('a1','a1:crash')
    assert.throws(()=>ledger.settleArticle(hold,true,{ok:true,articles:[{body:'Durable article'}]}),/injected storage failure/)
    assert.equal(ledger.articleResult(hold),null)
    assert.deepEqual(ledger.summary('a1').articles,{available:6,used:3,held:1,managed:true})
    probe.exec('DROP TRIGGER fail_settle');probe.close()
    ledger.close();ledger=createMemberLedger(file)
    ledger.settleArticle(hold,true,{ok:true,articles:[{body:'Durable article'}]})
    assert.deepEqual(ledger.summary('a1').articles,{available:6,used:4,held:0,managed:true})

    // SQLite online backup includes WAL changes, unlike copying the main file.
    const source=new DatabaseSync(file)
    try { await backup(source,restored) } finally { source.close() }
    const copy=createMemberLedger(restored)
    try {
      for(const u of [...agents,...clients])assert.deepEqual(copy.summary(u.id),ledger.summary(u.id))
      assert.deepEqual(copy.articleResult(hold),ledger.articleResult(hold))
    } finally { copy.close() }
  } finally { ledger.close();rmSync(dir,{recursive:true,force:true}) }
})
