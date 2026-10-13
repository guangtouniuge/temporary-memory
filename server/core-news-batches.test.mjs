import test from 'node:test'
import assert from 'node:assert/strict'
import { taskBatches, allocateBatch } from './core-news-batches.mjs'

test('batches retain task identities and never mix brands or generated runs', () => {
  const tasks=[{project:'A',name:'同名任务',jobId:'job1',batchId:'batch1',limit:'20',created:'2'},{project:'B',name:'其他品牌',jobId:'other'}]
  const articles=[{id:'a',project:'A',batchId:'batch1',status:'已生成',body:'正文'},{id:'b',project:'A',batchId:'batch2',status:'已生成',body:'正文'},{id:'secret',project:'B',batchId:'batch1',status:'已生成',body:'正文'}]
  const batches=taskBatches(tasks,articles,'A')
  assert.equal(batches[0].id,'job1');assert.equal(batches[0].planned,20)
  assert.deepEqual(batches[0].articles.map(a=>a.id),['a'])
  assert.equal(batches.length,2)
})
test('media quantities are exact, articles unique, and costs cannot be invented', () => {
  const rows=[{id:'1',title:'口腔服务商推荐'},{id:'2',title:'企业管理口碑榜'},{id:'3',title:'服务商实力测评'}]
  const targets=[{id:'m1',name:'企业媒体',category:'企业管理',priceFen:250,count:1},{id:'m2',name:'新闻媒体',priceFen:300,count:2}]
  const plan=allocateBatch(rows,targets)
  assert.equal(plan.assignments[0].articleId,'2')
  assert.equal(new Set(plan.assignments.map(row=>row.articleId)).size,3)
  assert.equal(plan.totalFen,850);assert.equal(plan.submitted,false)
  assert.throws(()=>allocateBatch(rows,[{...targets[0],count:4}]),/只有3篇/)
  assert.throws(()=>allocateBatch(rows,[targets[0],targets[0]]),/重复/)
  assert.throws(()=>allocateBatch(rows,[{...targets[0],count:1.5}]),/整数/)
  assert.equal(allocateBatch(rows,[{id:'m',name:'未定价',count:1}]).totalFen,null)
  assert.throws(()=>allocateBatch([rows[0],rows[0]],targets),/重复文章/)
})
