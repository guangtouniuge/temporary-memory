import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanBusinessScenes,expandBusinessScenes,resolveBusinessScenes,createSceneRequests } from './business-scenes.mjs'
import { runInProjectScope,validateGenerationScope } from './project-scope.mjs'
import { planBatchTopics } from './batch-editor.mjs'
import { buildIsolatedEditor } from './skill-editor.mjs'

test('business terms differ from company selection questions and deduplicate',()=>{
  assert.deepEqual(cleanBusinessScenes(['口腔诊所GEO','口腔诊所GEO','口腔诊所GEO怎么选','宠物诊所GEO']),['口腔诊所GEO','宠物诊所GEO'])
})

test('identical scene requests share work and completion or failure releases immediately',async()=>{
 const run=createSceneRequests();let finish,calls=0
 const work=()=>{calls++;return new Promise(r=>{finish=r})}
 const first=run('a','same',work),second=run('a','same',work)
 await Promise.resolve()
 assert.equal(calls,1)
 await assert.rejects(run('a','other',work),/另一笔/)
 finish(['词']);assert.deepEqual(await first,['词']);assert.deepEqual(await second,['词'])
 assert.deepEqual(await run('a','new',async()=>['新词']),['新词'])
 await assert.rejects(run('a','bad',async()=>{throw new Error('failed')}),/failed/)
 assert.deepEqual(await run('a','retry',async()=>['恢复']),['恢复'])
})

test('partial valid industry candidates are returned instead of discarded',async()=>{
 let calls=0
 const words=await expandBusinessScenes({project:{},core:'咨询',count:50},async()=>{
  calls++
  return {ok:true,content:JSON.stringify(calls===1?{service:'咨询',buyers:['制造业']}:{words:['制造业咨询']})}
 })
 assert.deepEqual(words,['制造业咨询'])
 assert.equal(calls,3)
})
test('selected application scene reaches topic editor and writer as buyer context',async()=>{
 const scene='口腔诊所GEO'
 const [plan]=await planBatchTopics({packet:{coreKeyword:'西安GEO公司'}},[{businessScene:scene,industryScene:scene,writingSceneMode:'按实际场景写'}],[],async messages=>{
  assert.ok(JSON.stringify(messages).includes(scene))
  return {ok:true,content:JSON.stringify({briefs:[{id:0,businessProblem:'口腔诊所如何选择GEO服务',readerSituation:'诊所寻找服务商',customerIndustry:'其他行业'}]})}
 })
 assert.equal(plan.editorialBrief.customerIndustry,scene)
 const editor=buildIsolatedEditor({project:{name:'服务商'},packet:{coreKeyword:'西安GEO公司'},plan},'2026年9月')
 assert.equal(editor.input.customer_scene,scene)
 assert.match(editor.input.business_scene_direction,/不推荐场景行业本身/)
})

test('own industry discards stale scene fields at both planning and writing handoffs',async()=>{
 const stale={writingSceneMode:'按自己行业写',businessScene:'口腔诊所GEO',industryScene:'口腔诊所GEO'}
 const [plan]=await planBatchTopics({packet:{coreKeyword:'GEO服务'}},[stale],[],async messages=>{
  const input=JSON.parse(messages[1].content.split('项目资料：\n')[1])
  assert.equal(input.assignments[0].businessScene,undefined)
  assert.equal(input.assignments[0].scene,undefined)
  return {ok:true,content:JSON.stringify({briefs:[{id:0,businessProblem:'GEO服务的内容更新与交付如何选择',readerSituation:'已有内容需要更新',customerIndustry:'口腔诊所'}]})}
 })
 assert.equal(plan.businessScene,undefined)
 assert.equal(plan.editorialBrief.customerIndustry,undefined)
 for(const p of [plan,stale]) {
  const editor=buildIsolatedEditor({plan:p},'2026年9月')
  assert.equal(editor.input.customer_scene,undefined)
  assert.equal(editor.input.business_scene_direction,undefined)
  assert.match(editor.input.mode_direction,/核心词所指对象本身/)
 }
})
test('understands the actual business before expanding application industries',async()=>{
  const calls=[]
  const words=await expandBusinessScenes({project:{industry:'GEO服务'},core:'西安GEO公司',count:2,materials:['品牌资料']},async messages=>{
    calls.push(JSON.parse(messages[1].content))
    return {ok:true,content:JSON.stringify(calls.length===1?{service:'GEO',buyers:['诊所'],needs:['获客']}:{words:['口腔诊所GEO','宠物诊所GEO']})}
  })
  assert.equal(words.length,2);assert.equal(calls[1].profile.service,'GEO');assert.deepEqual(calls[0].materials,['品牌资料'])
})
test('writing selects owned active scenario terms, never historical words or foreign brands',()=>{
 const rows=[['A','GEO','口腔诊所GEO','场景业务词','已启用'],['A','GEO','哪家好','历史词','已启用'],['B','GEO','宠物诊所GEO','场景业务词','已启用']]
 assert.deepEqual(resolveBusinessScenes(rows,'A','GEO',undefined,'按实际场景写'),['口腔诊所GEO'])
 assert.throws(()=>resolveBusinessScenes(rows,'A','GEO',['宠物诊所GEO'],'按实际场景写'))
 runInProjectScope({projectId:'a'},()=>{
  const state={'geo.projectRows':[{name:'A',coreKeyword:'GEO'}],'geo.keywordLibraryRows':rows}
  const result=validateGenerationScope({project:{name:'A'},task:{writingSceneMode:'按实际场景写',businessScenes:['口腔诊所GEO']}},k=>state[k])
  assert.deepEqual(result.packet.businessScenes,['口腔诊所GEO'])
  assert.deepEqual(validateGenerationScope({project:{name:'A'},task:{writingSceneMode:'按自己行业写'}},k=>state[k]).packet.businessScenes,[])
 })
})
