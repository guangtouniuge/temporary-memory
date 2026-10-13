import test from 'node:test'
import assert from 'node:assert/strict'
import {cleanSelectionTerms,distillationCount,distillSelectionTerms} from './keyword-distillation.mjs'

test('selection terms keep the core, short intent and industry identity without fake defaults',()=>{
  const core='西安GEO公司'
  assert.deepEqual(cleanSelectionTerms([core+'哪家好？',core+'哪家好',core+'是什么',core+'源头厂家哪家好','其他公司哪家好',core+'怎么做',core+'报价怎么选','专业的'+core,core+'哪家好因为我有很多特殊需求需要比较服务商的实际交付过程'],core,'GEO服务'),[core+'哪家好',core+'报价怎么选','专业的'+core])
  for(const value of [0,201,1.5,'oops'])assert.throws(()=>distillationCount(value))
})
test('simple distillation generates short terms without calling any model',async()=>{
  const calls=[],core='管理咨询公司'
  const r=await distillSelectionTerms({project:{name:'甲',industry:'管理咨询'},core,count:3,materials:[{brand:'入企陪跑'}],existing:[core+'哪家好']},async messages=>{
    calls.push(messages)
    return {ok:true,content:JSON.stringify(calls.length===1?{buyers:['企业经营者'],concerns:['顾问落地能力']}:calls.length===2?{terms:[core+'哪家好',core+'哪家靠谱',core+'怎么选']}:{terms:[core+'推荐哪家']})}
  })
  assert.equal(r.terms.length,3)
  assert.equal(calls.length,0)
  assert.deepEqual(r.terms,[core+'哪家靠谱',core+'怎么选',core+'推荐哪家'])
})
test('model balance does not affect simple distillation and completed lists are idempotent',async()=>{
  const input={project:{name:'甲',industry:'GEO服务'},core:'GEO公司',count:2,materials:[]}
  const first=await distillSelectionTerms({...input,count:200},async()=>{throw new Error('must not call provider')})
  assert.equal(first.terms.length,20)
  let calls=0
  const repeat=await distillSelectionTerms({...input,existing:first.terms},async()=>{calls++;throw new Error('unexpected')})
  assert.deepEqual(repeat.terms,[])
  assert.equal(calls,0)
})
