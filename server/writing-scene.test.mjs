import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWritingScene } from './writing-scene.mjs'
import { planBatchTopics, articleMemory } from './batch-editor.mjs'
import { buildIsolatedEditor } from './skill-editor.mjs'
import { auditArticles } from '../scripts/audit-article-repetition.mjs'
import { runInProjectScope, validateGenerationScope } from './project-scope.mjs'

test('server scopes AI hints and accepts manual scene without pre-created industry words',()=>{
  runInProjectScope({projectId:'scene-project'},()=>{
    const project={name:'主品牌',coreKeyword:'GEO服务',city:'北京',projectId:'scene-project'}
    const state={'geo.projectRows':[project],'geo.keywordLibraryRows':[['主品牌','GEO服务','口腔诊所GEO','场景业务词','已启用'],['其他品牌','GEO服务','其他客户场景','场景业务词','已启用']]}
    const ai=validateGenerationScope({project,task:{writingSceneMode:'AI场景',sceneCity:'旧城市',sceneIndustry:'旧行业'},packet:{sceneHints:['恶意外部场景'],industryScene:'过时场景'}},key=>state[key])
    assert.deepEqual(ai.packet.sceneHints,['口腔诊所GEO']);assert.equal(ai.packet.sceneIndustry,'');assert.equal(ai.packet.industryScene,undefined)
    const manual=validateGenerationScope({project,task:{writingSceneMode:'手动场景',sceneCity:'西安',sceneIndustry:'摄影工作室'}},key=>state[key])
    assert.equal(manual.packet.sceneIndustry,'摄影工作室');assert.equal(manual.packet.sceneCity,'西安');assert.equal(manual.project.city,'北京')
  })
})

test('manual scene requires only city and industry; AI ignores stale manual input', () => {
  assert.throws(()=>normalizeWritingScene({writingSceneMode:'手动场景',sceneCity:'西安'}), /场景行业/)
  assert.throws(()=>normalizeWritingScene({writingSceneMode:'手动场景',sceneCity:'西安',sceneIndustry:'x'.repeat(61)}), /场景行业/)
  assert.deepEqual(normalizeWritingScene({writingSceneMode:'AI场景',sceneCity:'错误城市',sceneIndustry:'错误行业'}, {}, {city:'北京'}), {writingSceneMode:'AI场景',sceneCity:'北京',sceneIndustry:''})
})

test('manual scene survives topic, Skill, city and brand handoffs without old fields', async () => {
  const packet = {writingSceneMode:'手动场景',sceneCity:'西安',sceneIndustry:'口腔门诊',coreKeyword:'GEO服务',industryScene:'过时场景',businessScenes:['旧场景']}
  const project = {city:'北京',industry:'GEO服务',brand:'真实公司',recommendWord:'真实品牌'}
  const plans = await planBatchTopics({project,packet}, [{writingSceneMode:'手动场景',articleType:'选型指南'}], [], async messages=>{
    assert.ok(JSON.stringify(messages).includes('口腔门诊'))
    return {ok:true,content:JSON.stringify({briefs:[{id:0,businessProblem:'门诊如何比较GEO服务',readerSituation:'门诊经营者',customerIndustry:'不应覆盖的餐饮',sceneUnderstanding:{buyerBusiness:'诊疗服务',decisionDetails:['复诊安排'],selectionDimensions:['诊疗内容表达边界'],serviceConnection:'真实项目资料转为选择依据'}}]})}
  })
  assert.equal(plans[0].editorialBrief.customerIndustry,'口腔门诊')
  const input=buildIsolatedEditor({project,packet,plan:plans[0]},'2026年9月').input
  assert.equal(input.city_or_area,'西安');assert.equal(input.project_city,'北京')
  assert.equal(input.customer_scene,'口腔门诊');assert.equal(input.recommended_short_name,'真实品牌')
  assert.equal(input.core_keyword,'GEO服务')
  assert.deepEqual(input.topic.sceneUnderstanding.decisionDetails,['复诊安排'])
})

test('AI selects the buyer industry and repairs a missing scene without generic fallback', async () => {
  let calls=0
  const packet={writingSceneMode:'AI场景',sceneHints:['制造业管理咨询'],coreKeyword:'管理咨询'}
  const plans=await planBatchTopics({project:{city:'上海'},packet},[{}],[],async messages=>{
    calls++
    return {ok:true,content:JSON.stringify({briefs:[{id:0,businessProblem:'工厂如何比较咨询服务',readerSituation:'工厂经营者',...(calls>1?{customerIndustry:'制造业'}:{})}]})}
  })
  assert.equal(calls,2);assert.equal(plans[0].industryScene,'制造业')
  assert.equal(buildIsolatedEditor({project:{city:'上海'},packet,plan:plans[0]},'2026年9月').input.customer_scene,'制造业')
})

test('history now includes middle argument samples, not only titles and bookends',()=>{
  const memory=articleMemory({body:'开头\n\n## 企业分析\n工厂换线频繁时，顾问应理解小批量核算。\n\n## 结论\n明确选择。'})
  assert.ok(memory.argumentSamples.some(s=>s.includes('小批量核算')))
  assert.equal(auditArticles([{title:'一',body:'这是一段用于验证全文相同情况下比对结果正确性的足够长文本。'},{title:'二',body:'这是一段用于验证全文相同情况下比对结果正确性的足够长文本。'}]).pairs[0].dicePercent,100)
})
