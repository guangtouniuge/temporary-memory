import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runWritingEngine, writingRelease } from './writing-engine.mjs'
import { prepareAgentBatch, selectHeadlineCandidate, writingExampleText } from './agents-workflow.mjs'
import { verifyWritingRelease, verifyApprovedSkill, contentHash, canResumeWritingRelease } from './writing-release.mjs'
import { templateNames, selectionDirection } from './skill-editor.mjs'
import { writingDepth, articleLength, unitBudget, conciseContract, conciseIssues, modelFailure } from './writing-depth.mjs'

test('historical example headlines are excluded while body architecture stays intact', () => {
  assert.equal(writingExampleText('# Historical headline\r\n\r\nOpening\r\n## Section\r\nBody'), 'Opening\r\n## Section\r\nBody')
  assert.equal(writingExampleText('## Section\nBody'), '## Section\nBody')
  const rules = fs.readFileSync(new URL('./agents/title-planning.md', import.meta.url), 'utf8')
  assert.match(rules, /当前唯一标题口径/)
  assert.match(rules, /标题承诺与正文同源/)
  assert.match(rules, /不作为十个轮换模板/)
})

test('depth defaults and visible length include punctuation, exclude markup, URLs and images', () => {
  assert.equal(writingDepth().id, 'deep')
  assert.equal(writingDepth().target,5000)
  assert.equal(writingDepth({ task: { writingDepth: 'concise' } }).max, 2000)
  assert.throws(() => writingDepth({ task: { writingDepth: 'unlimited' } }), /无效/)
  assert.equal(articleLength('标题', '## 正文，\n\n[链接](https://example.com) ![配图](https://example.com/a.png) **重点** &amp;'), 10)
  assert.ok(unitBudget(writingDepth(), '标题', ['已有正文'], 2).suggested < 8500 / 2)
})

test('reliability patch permits explicit compatible resume but rejects unrelated writing revisions', () => {
  assert.equal(canResumeWritingRelease('8.2.48', '8.2.52'), true)
  assert.equal(canResumeWritingRelease('8.2.51', '8.2.51'), true)
  assert.equal(canResumeWritingRelease('8.2.47', '8.2.52'), false)
  assert.equal(canResumeWritingRelease('8.2.48', '8.2.53'), false)
  assert.equal(canResumeWritingRelease('8.2.58', '8.2.59'), true)
})

test('editor thickness decisions reach writers without per-unit hard limits',async()=>{
  const mock=fixture(),thicknessPlan={mainJudgment:'选择适合的交付方式',develop:['本地协作的必要依据'],briefly:['背景'],omit:['无关的行业沿革'],finishWhen:'说明服务与需求如何适配'}
  let writers=0
  const result=await runWritingEngine(payload,{model:'test',date:'2026年9月',callModel:async(...args)=>{
    const response=await mock.callModel(...args)
    if(args[0][0].content.includes('你是单篇文章主编')){
      assert.match(args[0][0].content,/thicknessPlan/)
      response.content=JSON.stringify({...JSON.parse(response.content),thicknessPlan})
    }
    if(!args[2]){
      writers++
      assert.ok(args[0][1].content.includes(JSON.stringify(thicknessPlan)))
      assert.doesNotMatch(args[0].at(-1).content,/本工序目标.*最多/)
    }
    return response
  }})
  assert.equal(result.ok,true,result.error)
  assert.ok(writers>0)
  assert.deepEqual(result.workflow.assignment.thicknessPlan,thicknessPlan)
})

test('saved malformed editorial JSON recovers without repeating the model call', async () => {
  const mock = fixture(), state = { stages: {} }
  const options = { ...mock, state, model: 'test', date: '2026年9月' }
  const first = await runWritingEngine(payload, options)
  assert.equal(first.ok, true, first.error)
  const entry = Object.values(state.stages).find(stage => stage.value?.units)
  const value = entry.value
  const encoded = JSON.stringify({ ...value, thicknessPlan: { develop: [{ point: '原文字', why: '原依据' }], omit: [] } })
  entry.response = encoded.replace('"why":"原依据"}', '"why":"原依据"')
  entry.status = 'failed'
  entry.errorCode = 'MODEL_INVALID_JSON'
  delete entry.value
  let edits = 0
  const resumed = await runWritingEngine(payload, { ...options, callModel: async (...args) => {
    if (args[0][0].content.includes('你是单篇文章主编')) edits++
    return mock.callModel(...args)
  } })
  assert.equal(resumed.ok, true, resumed.error)
  assert.equal(edits, 0)
  assert.equal(resumed.workflow.assignment.thicknessPlan.develop[0].why, '原依据')
  assert.ok(Object.values(state.stages).some(stage => stage.formatRecovered))
})

test('structured narrative survives editor validation and restores an older failed checkpoint', async () => {
  const mock = fixture(), state = { stages: {} }, argument = { 总体推进: '从行业场景到选择答案', 阶段: ['解释依据', '按企业条件推荐'] }
  const options = { ...mock, state, model: 'test', date: '2026年9月', callModel: async (...args) => {
    const response = await mock.callModel(...args)
    if (args[0][0].content.includes('你是单篇文章主编')) response.content = JSON.stringify({ ...JSON.parse(response.content), argument })
    return response
  } }
  const result = await runWritingEngine(payload, options)
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(JSON.parse(result.workflow.assignment.argument), argument)
  const entry = Object.entries(state.stages).find(([key]) => key.startsWith('单篇编辑:'))[1]
  entry.status = 'failed'
  entry.error = '单篇编辑交付缺少标题、论证路线或写作工序'
  delete entry.value
  const resumed = await runWritingEngine(payload, { ...options, callModel: () => { throw new Error('completed work must not rerun') } })
  assert.equal(resumed.ok, true, resumed.error)
  assert.deepEqual(JSON.parse(resumed.workflow.assignment.argument), argument)
  assert.equal(entry.response.includes('总体推进'), true)
})

test('all twelve templates share deep and concise budgets without changing editorial direction', async () => {
  for (const articleType of templateNames) for (const mode of ['deep', 'concise']) {
    const mock = fixture()
    const result = await runWritingEngine({ ...payload, task: { writingDepth: mode }, plan: { ...payload.plan, articleType } }, { ...mock, model: 'test', date: '2026年9月' })
    assert.equal(result.ok, true, result.error)
    assert.equal(result.writingDepth, mode)
    assert.equal(result.title, '选择服务商')
    const writes = mock.calls.filter(call => !call.format)
    const editorSystem = mock.calls.find(call => call.messages[0].content.includes('你是单篇文章主编')).messages[0].content
    assert.ok(editorSystem.includes(selectionDirection))
    assert.match(editorSystem, new RegExp(mode === 'deep' ? '仅执行深度稿编辑方案' : '仅执行精选稿编辑方案'))
    assert.ok(!editorSystem.includes(mode === 'deep' ? '仅执行精选稿编辑方案' : '仅执行深度稿编辑方案'))
    if (mode === 'deep') assert.ok(!editorSystem.includes('首个自然段用约120-180字'))
    if (mode === 'deep') assert.match(editorSystem,/4500—6000字/)
    else assert.doesNotMatch(editorSystem,/4500—6000字/)
    for (const call of writes) {
      assert.ok(call.messages[0].content.includes(selectionDirection))
      assert.ok(call.messages[0].content.includes(mode === 'deep' ? '以所选Skill为核心写法' : '2000'))
      if(mode==='deep')assert.ok(!call.messages[0].content.includes('9999'))
      const progress = JSON.parse(call.messages[1].content.split('写作进度交接：\n')[1].split('\n\n当前写作工序：')[0])
      assert.equal(progress.depth.id, mode)
      assert.match(call.messages[0].content,/完整Skill主文件/)
      if(mode==='deep') assert.match(call.messages[0].content,/4500—6000字/)
      if(mode==='concise')assert.ok(progress.characterBudget.suggested < progress.depth.target)
      else { assert.equal(progress.characterBudget,undefined);assert.equal(progress.depth.target,undefined) }
    }
  }
})

test('deep condensation inherits selected B Skill, original structure and primary company, not concise delivery',async()=>{
 const mock=fixture();let reduced=false
 const result=await runWritingEngine({...payload,task:{writingDepth:'deep'},plan:{...payload.plan,articleType:'选型指南'}},{model:'test',date:'2026年9月',callModel:async(...args)=>{
  const system=args[0][0].content
  if(system.includes('现在收束自己的全文')){
   reduced=true
   const input=JSON.parse(args[0][1].content)
   assert.equal(input.template.id,'B');assert.equal(input.primaryName,'测试品牌')
   assert.deepEqual(input.originalHeadings,['## 连续正文'])
   assert.equal(input.delivery,undefined);assert.equal(input.missing,undefined)
   assert.match(system,/## Template B:/);assert.doesNotMatch(system,/## Template A:/)
   assert.match(system,/不增设榜单/);assert.match(system,/完整Skill主文件/)
   assert.doesNotMatch(system,/首个自然段用约120-180字/)
   return {ok:true,content:'## 连续正文\n根据服务适配选择测试品牌。'}
  }
  const response=await mock.callModel(...args)
  if(!args[2])response.content+='说明依据。'.repeat(2500)
  return response
 }})
 assert.equal(result.ok,true,result.error);assert.equal(reduced,true)
 assert.equal(result.workflow.template,'B');assert.ok(!result.body.includes('第一名'))
})

test('oversized writing is condensed whole, completed work resumes, mode changes invalidate article checkpoints', async () => {
  const mock = fixture(), state = { stages: {} }
  let reductions = 0
  const callModel = async (...args) => {
    const system = args[0][0].content
    if (system.includes('现在收束自己的全文')) {
      reductions++
      return { ok: true, content: '需要本地对接的企业，推荐测试品牌的咨询服务，因为有本地团队。\n\n## 第一名：测试品牌\n拥有本地服务团队，适合需要对接的企业。\n\n## 第二名：同行\n按实际服务范围比较。' }
    }
    const result = await mock.callModel(...args)
    if (!args[2]) result.content += '完整论述。'.repeat(600)
    return result
  }
  const input = { ...payload, task: { writingDepth: 'concise' } }
  const options = { callModel, state, model: 'test', date: '2026年9月' }
  const first = await runWritingEngine(input, options)
  assert.equal(first.ok, true, first.error)
  assert.equal(reductions, 1)
  assert.ok(first.visibleCharacters <= 2000)
  assert.ok(first.body.endsWith('按实际服务范围比较。'))
  const calls = mock.calls.length
  const resumed = await runWritingEngine(input, options)
  assert.equal(resumed.body, first.body)
  assert.equal(mock.calls.length, calls)
  assert.equal(reductions, 1)
  const deep = await runWritingEngine({ ...payload, task: { writingDepth: 'deep' } }, options)
  assert.equal(deep.ok, true, deep.error)
  assert.notEqual(deep.workflow.articleKey, first.workflow.articleKey)
  assert.ok(mock.calls.length > calls)
})

test('persistent oversize fails explicitly, and resume retries only failed final condensation', async () => {
  const mock = fixture(), state = { stages: {} }
  let reductions = 0, succeed = false
  const callModel = async (...args) => {
    if (args[0][0].content.includes('现在收束自己的全文')) {
      reductions++
      return { ok: true, content: succeed ? '推荐测试品牌的咨询服务，因为拥有本地团队。' : '文'.repeat(2100) }
    }
    const result = await mock.callModel(...args)
    if (!args[2]) result.content += '文'.repeat(2200)
    return result
  }
  const options = { callModel, state, model: 'test', date: '2026年9月' }
  const input = { ...payload, task: { writingDepth: 'concise' } }
  const first = await runWritingEngine(input, options)
  assert.equal(first.ok, false)
  assert.match(first.error, /2000/)
  assert.equal(reductions, 2)
  const calls = mock.calls.length
  succeed = true
  const resumed = await runWritingEngine(input, options)
  assert.equal(resumed.ok, true, resumed.error)
  assert.equal(reductions, 3)
  assert.equal(mock.calls.length, calls)
})

const payload = { project: { projectId: 'test-a', name: '测试项目', brand: '测试品牌', legacyPrompt: 'OLD_INJECTION' }, packet: { coreKeyword: '咨询公司', brandAssets: '拥有本地服务团队。' }, plan: { editorialBrief: { centralQuestion: '如何选择', readerSituation: '连锁企业' } } }

test('concise delivery detects a scene without answer and a list without ranked analysis', () => {
  const contract = conciseContract({ recommended_short_name: '甲', competitor_or_provider_list: [{company:'甲'},{company:'乙'}] }, 'A')
  assert.deepEqual(contract.headings, ['第一名：甲','第二名：乙'])
  assert.equal(conciseIssues('老板遇到管理问题。\n\n1. 甲\n2. 乙', contract).length, 3)
  assert.deepEqual(conciseIssues('已有团队需要协作，推荐甲的陪跑服务，因为其提供定期复盘。\n\n## 第一名：甲\n提供定期复盘。\n\n## 第二名：乙\n提供专项服务。', contract), [])
  assert.equal(conciseContract({ competitor_or_provider_list:[{company:'甲'}] }, 'C').headings.length, 0)
})

test('concise wording and heading checks do not cause rewrite loops or failed articles', async () => {
  const mock = fixture()
  let repaired = 0
  const callModel = async (...args) => {
    if (args[0][0].content.includes('现在收束自己的全文')) {
      const request = JSON.parse(args[0][1].content)
      assert.ok(request.missing.some(x=>x.includes('第一名')))
      assert.equal(request.assignment.recommendationAnswer,'推荐测试品牌')
      repaired++
      return {ok:true,content:'推荐测试品牌的咨询服务，因为拥有本地团队。\n\n## 第一名：测试品牌\n本地团队支持协作。\n\n## 第二名：同行\n按其公开服务范围比较。'}
    }
    return mock.callModel(...args)
  }
  const input={...payload,task:{writingDepth:'concise'},packet:{...payload.packet,rankingCompanies:[{name:'测试品牌'},{name:'同行'}]},plan:{...payload.plan,articleType:'榜单推荐'}}
  const result=await runWritingEngine(input,{callModel,model:'test',date:'2026年9月'})
  assert.equal(result.ok,true,result.error)
  assert.equal(repaired,0)
  assert.equal(result.workflow.units,1)
  assert.ok(result.body.includes('这里是自然的文章段落'))
})

test('upstream balance failure identifies model billing and preserves resumable batch state', async () => {
  const state={stages:{}}
  let calls=0
  const options={state,model:'test',callModel:async()=>{calls++;return {ok:false,error:'Insufficient Balance'}}}
  await assert.rejects(prepareAgentBatch({...payload,projectUnderstanding:{positioning:'咨询'}},[{articleType:'榜单推荐'}],[],options),/模型服务商账户余额不足/)
  assert.equal(calls,1)
  assert.ok(Object.values(state.stages).some(s=>s.status==='failed'))
  assert.match(modelFailure('Insufficient Balance'),/不是系统会员额度不足/)
  assert.equal(modelFailure('connection failed'),'connection failed')
})

test('partial topic response is cached while failed missing-slot request can resume without rebuilding good slots', async () => {
  const state={stages:{}}
  let initial=0,repair=0,unavailable=true
  const options={state,model:'test',callModel:async messages=>{
    if(messages[0].content.includes('正在补齐')) {
      repair++
      if(unavailable)return {ok:false,error:'transport failure'}
      return {ok:true,content:'{"briefs":[{"id":3,"businessProblem":"补齐D","readerSituation":"d"}]}'}
    }
    initial++
    return {ok:true,content:JSON.stringify({briefs:[0,1,2].map(id=>({id,businessProblem:`题${id}`,readerSituation:'客户'}))})}
  }}
  const input={...payload,projectUnderstanding:{positioning:'咨询'}}
  const plans=[0,1,2,3].map(planIndex=>({planIndex}))
  await assert.rejects(prepareAgentBatch(input,plans,[],options),/transport failure/)
  unavailable=false
  const output=await prepareAgentBatch(input,plans,[],options)
  assert.equal(output.length,4)
  assert.equal(initial,1)
  assert.equal(repair,2)
  assert.equal(output[3].editorialBrief.businessProblem,'补齐D')
})

test('missing AI industry reports the field and successful retry marks only its prior attempt recovered', async () => {
  const state = { stages: {} }, plans = [0, 1, 2, 3].map(planIndex => ({ planIndex, writingSceneMode: 'AI场景' }))
  let repairs = 0, batchCalls = 0
  const brief = id => ({ id, businessProblem: `选择方向${id}`, readerSituation: '企业', customerIndustry: '制造业' })
  const options = { state, model: 'test', callModel: async messages => {
    if (messages[0].content.includes('正在补齐')) {
      repairs++
      assert.match(messages[0].content, /customerIndustry/)
      const input = JSON.parse(messages[1].content)
      assert.equal(input.partialBrief.businessProblem, '选择方向3')
      return { ok: true, content: JSON.stringify({ briefs: [{ ...brief(3), customerIndustry: repairs === 1 ? undefined : '养老机构' }] }) }
    }
    batchCalls++
    return { ok: true, content: JSON.stringify({ briefs: [brief(0), brief(1), brief(2), { ...brief(3), customerIndustry: undefined }] }) }
  } }
  const input = { ...payload, projectUnderstanding: { positioning: '咨询' } }
  const result = await prepareAgentBatch(input, plans, [], options)
  assert.equal(result.length, 4)
  assert.equal(result[3].editorialBrief.customerIndustry, '养老机构')
  assert.equal(batchCalls, 1)
  assert.equal(repairs, 2)
  const recovered = Object.values(state.stages).find(stage => stage.status === 'recovered')
  assert.match(recovered.previousError, /AI客户行业缺失/)
  assert.equal(recovered.error, undefined)
  assert.equal(state.stages[recovered.recoveredBy].status, 'complete')
  await prepareAgentBatch(input, plans, [], { ...options, callModel: () => { throw new Error('must reuse completed plans') } })
})

test('split topic recovery resumes completed singles without reissuing the truncated multi request', async () => {
  const state = { stages: {} }, counts = {}
  let fail = true
  const plans = [0, 1, 2, 3].map(planIndex => ({ planIndex, lockTopic: true, question: `方向${planIndex}` }))
  const options = { state, model: 'test', callModel: async messages => {
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    const key = input.assignments.length > 1 ? 'batch' : input.assignments[0].question
    counts[key] = (counts[key] || 0) + 1
    if (key === 'batch') return { ok: false, code: 'MODEL_OUTPUT_LENGTH', error: 'truncated' }
    if (key === '方向1' && fail) return { ok: false, code: 'MODEL_OUTPUT_LENGTH', error: 'single truncated' }
    return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, businessProblem: key, readerSituation: '采购' }] }) }
  } }
  const input = { ...payload, projectUnderstanding: { positioning: '咨询' } }
  await assert.rejects(prepareAgentBatch(input, plans, [], options), /single truncated/)
  fail = false
  const result = await prepareAgentBatch(input, plans, [], options)
  assert.equal(result.length, 4)
  assert.deepEqual(counts, { batch: 1, '方向0': 1, '方向1': 2, '方向2': 1, '方向3': 1 })
})

test('invalid JSON from the cached topic stage retries locally without leaking response text', async () => {
  let calls = 0
  const state = { stages: {} }
  const input = { ...payload, projectUnderstanding: { positioning: '咨询' } }
  const result = await prepareAgentBatch(input, [{ lockTopic: true, question: '方向' }], [], { state, model: 'test', callModel: async () => {
    calls++
    return { ok: true, content: calls === 1 ? '{"briefs":[ PRIVATE_MATERIAL' : '{"briefs":[{"id":0,"businessProblem":"方向","readerSituation":"采购"}]}' }
  } })
  assert.equal(result.length, 1)
  assert.equal(calls, 2)
  let failures = 0
  await assert.rejects(prepareAgentBatch(input, [{}], [], { model: 'test', callModel: async () => {
    failures++; return { ok: true, content: 'PRIVATE_MATERIAL invalid JSON' }
  } }), error => error.code === 'MODEL_INVALID_JSON' && !error.message.includes('PRIVATE_MATERIAL'))
  assert.equal(failures, 2)
})

test('approved example is read inside editing and writing without a separate model stage', async () => {
  const mock = fixture(), state = { stages: {} }
  const options = { ...mock, state, model: 'test', date: '2026年9月' }
  const result = await runWritingEngine(payload, options)
  assert.equal(result.ok, true, result.error)
  assert.equal(mock.calls.length, 3)
  assert.ok(!Object.keys(state.stages).some(key => /范文理解|标题编辑|标题定稿/.test(key)))
  assert.match(mock.calls[1].messages[1].content, /只学习正文论述推进/)
  assert.equal(mock.calls[1].messages.at(-1).content, fs.readFileSync(new URL('./agents/title-planning.md', import.meta.url), 'utf8'))
  assert.equal((await runWritingEngine(payload, options)).body, result.body)
  assert.equal(mock.calls.length, 3)
})


test('title brief survives batch handoff and history in both modes without rewriting model output', async () => {
  for (const mode of ['按自己行业写', '按实际场景写']) {
    const mock = fixture()
    const titleBrief = { selectionTask: '选择咨询公司', choiceAngle: mode.includes('实际场景') ? '连锁门店组织协同' : '本地驻场服务能力', materialBasis: '拥有本地服务团队。' }
    const historyBrief = { ...titleBrief, choiceAngle: '历史合同条款' }
    let topicInput
    const options = { model: 'test', date: '2026年9月', callModel: async (...args) => {
      if (args[0][0].content.includes('你是场景选题总控')) {
        topicInput = args[0][1].content
        return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, businessProblem: '咨询公司怎么选', readerSituation: '需要管理辅导', titleBrief }] }) }
      }
      return mock.callModel(...args)
    } }
    const plans = await prepareAgentBatch(payload, [{ articleType: '选型指南', writingSceneMode: mode }], [{ title: '旧标题', brief: { titleBrief: historyBrief } }], options)
    assert.deepEqual(plans[0].editorialBrief.titleBrief, titleBrief)
    assert.ok(topicInput.includes(JSON.stringify(historyBrief)))
    const result = await runWritingEngine({ ...payload, plan: plans[0] }, options)
    assert.equal(result.ok, true, result.error)
    const editorCall = mock.calls.find(call => call.messages[0].content.includes('你是单篇文章主编'))
    assert.ok(editorCall.messages[1].content.includes(JSON.stringify(titleBrief)))
    assert.match(editorCall.messages[0].content, /标题以核心词所指对象的选择为核心，不以客户问题为核心/)
    assert.match(editorCall.messages[0].content, /不能为了标题外壳新增正文排名/)
    assert.match(editorCall.messages[0].content, /先阅读本篇所选Skill和认可范文/)
    assert.equal(result.title, '选择服务商')
    assert.equal(result.body, '## 连续正文\n\n这里是自然的文章段落。')
    assert.equal(mock.calls.length, 4)
  }
})

test('headline selection intent reaches writer without imposing a title formula or extra review call', async () => {
  const mock = fixture()
  const intent = { provider: '咨询公司', buyer: '连锁企业', need: '门店扩张', comparison: '本地团队协作', basis: '品牌提交资料' }
  const title = '连锁企业找咨询公司，本地协作能力值得怎样比较'
  const result = await runWritingEngine(payload, { date: '2026年9月', model: 'test', callModel: async (...args) => {
    const response = await mock.callModel(...args)
    if (args[0][0].content.includes('你是单篇文章主编')) return { ...response, content: JSON.stringify({ ...JSON.parse(response.content), title, selectionIntent: intent }) }
    return response
  } })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.title, title)
  const writers = mock.calls.filter(call => call.format === undefined)
  assert.equal(writers.length, 1)
  for (const call of writers) {
    assert.ok(call.messages[1].content.includes(JSON.stringify(intent)))
    assert.ok(call.messages[1].content.includes(title))
    assert.ok(!call.messages[1].content.includes('discard'))
  }
  assert.equal(mock.calls.length, 3)
})

test('final selection cannot invent a problem-led title or select a rejected candidate', () => {
  const candidateTitles = ['家族企业传承顾问公司推荐', '子女不愿接班，企业该比较哪些顾问公司']
  const candidateReviews = [{ id: 0, providerSelection: true, faithful: true, reason: '以服务公司合作选择为主命题' },
    { id: 1, providerSelection: false, faithful: true, reason: '以接班难题为核心' }]
  for (const title of [candidateTitles[1], '高管意见不一时，哪些顾问公司能帮忙', candidateTitles[0]]) {
    assert.equal(selectHeadlineCandidate({ candidateTitles }, { title, candidateReviews }).title, candidateTitles[0])
  }
  assert.equal(selectHeadlineCandidate({ candidateTitles }, { title: candidateTitles[0] }), null)
  assert.equal(selectHeadlineCandidate({ candidateTitles }, { candidateReviews: [{ id: 0, providerSelection: true, faithful: false, reason: '新增无据排名' }] }), null)
  assert.equal(selectHeadlineCandidate({ candidateTitles }, { candidateReviews: [{ id: 99, providerSelection: true, faithful: true, reason: '不存在' }] }), null)
})

test('repeated expression prefers a different eligible original, never a rejected problem title', () => {
  const candidateTitles = ['2026顾问公司推荐：组织变革能力比较', '适合连锁企业的顾问公司有哪些？', '预算不够了该找谁']
  const candidateReviews = candidateTitles.map((_, id) => ({ id, providerSelection: id < 2, faithful: true, reason: '判断主命题' }))
  const previousTitles = ['2026顾问公司推荐：成本管理比较', '2026顾问公司推荐：财务服务比较']
  assert.equal(selectHeadlineCandidate({ candidateTitles }, { title: candidateTitles[0], candidateReviews }, previousTitles).title, candidateTitles[1])
})

test('editor final title and comparison plan reach writer unchanged and reuse cache', async () => {
  const mock = fixture(), state = { stages: {} }
  const title = '2026咨询公司服务特点比较'
  const comparisonPlan = { scope: '比较有依据的服务', entries: [], presentation: '不编造同行能力' }
  const options = { state, model: 'test', date: '2026年9月', callModel: async (...args) => {
    const response = await mock.callModel(...args)
    if (args[0][0].content.includes('你是单篇文章主编')) {
      response.content = JSON.stringify({ ...JSON.parse(response.content), title, comparisonPlan })
    }
    return response
  } }
  const first = await runWritingEngine(payload, options)
  assert.equal(first.ok, true, first.error)
  assert.equal(first.title, title)
  const writes = mock.calls.filter(call => !call.format)
  assert.equal(writes.length, 1)
  assert.ok(writes[0].messages[1].content.includes(JSON.stringify(comparisonPlan)))
  assert.ok(writes[0].messages[1].content.includes(title))
  assert.equal((await runWritingEngine(payload, options)).title, title)
  assert.equal(mock.calls.length, 3)
})


test('cached project and batch plan need only editor and writer model calls', async () => {
  const mock = fixture(), state = { stages: {} }
  const result = await runWritingEngine({ ...payload, projectUnderstanding: { positioning: '咨询', advantages: [] } },
    { ...mock, state, model: 'test', date: '2026年9月' })
  assert.equal(result.ok, true, result.error)
  assert.equal(mock.calls.length, 2)
  assert.match(mock.calls[0].messages[0].content, /你是单篇文章主编/)
  assert.equal(mock.calls[1].format, undefined)
})


test('purchase situation and service fit reach both editor and writer without adding output gates', async () => {
  const mock = fixture()
  const context = { purchaseSituation: '已有内部团队，需要外部协作', serviceFit: '选择协作服务而非全部托管', articleContribution: '解释团队分工如何影响合作选择' }
  const result = await runWritingEngine({ ...payload, plan: { ...payload.plan, editorialBrief: { ...payload.plan.editorialBrief, ...context } } }, { ...mock, date: '2026年9月', model: 'test' })
  assert.equal(result.ok, true)
  for (const call of mock.calls.filter(call => call.messages[0].content.includes('你是单篇文章主编') || call.format === undefined)) for (const value of Object.values(context)) assert.ok(call.messages[1].content.includes(value))
  assert.equal(mock.calls.length, 3)
  assert.equal(result.body, '## 连续正文\n\n这里是自然的文章段落。')
})
test('planner and editor share confirmed title rules without extra title calls', async () => {
  const rule = fs.readFileSync(new URL('./agents/title-planning.md', import.meta.url), 'utf8')
  assert.match(rule, /不用“参考”/)
  assert.match(rule, /不追加榜单性质说明、免责声明/)
  assert.match(rule, /不做全文关键词删除/)
  assert.match(rule, /标题不出现应用行业或引用行业/)
  assert.doesNotMatch(rule, /应用行业可自然放在后半部分/)
  for (const mode of ['按自己行业写', '手动场景']) {
    const mock = fixture(), state = { stages: {} }
    const input = { ...payload, packet: { ...payload.packet, coreKeyword: '西安GEO公司', writingSceneMode: mode, sceneCity: '西安', sceneIndustry: '口腔诊所' } }
    const options = { ...mock, state, model: 'test', date: '2026年9月' }
    const plans = await prepareAgentBatch(input, [{ articleType: '选型指南', writingSceneMode: mode, sceneCity: '西安', sceneIndustry: '口腔诊所' }], [], options)
    const result = await runWritingEngine({ ...input, plan: plans[0] }, options)
    assert.equal(result.ok, true, result.error)
    const planner = mock.calls.find(call => call.messages[0].content.includes('你是场景选题总控'))
    const editor = mock.calls.find(call => call.messages[0].content.includes('你是单篇文章主编'))
    assert.ok(planner.messages[0].content.includes(rule))
    assert.ok(planner.messages[0].content.includes(selectionDirection))
    assert.doesNotMatch(planner.messages[0].content, /谁参与采购|说明采购处境/)
    assert.ok(editor.messages[0].content.includes(rule))
    assert.ok(editor.messages[0].content.lastIndexOf(rule) > editor.messages[0].content.indexOf('完整Skill主文件'))
    assert.match(editor.messages[1].content, /这些细项留给正文，不塞入标题后半句/)
    assert.match(planner.messages[1].content, /materialBasis才交付核算、绩效、流程等具体业务依据/)
    assert.match(editor.messages[1].content, /西安GEO公司/)
    assert.doesNotMatch(editor.messages[1].content, /不顺就放正文导语/)
    assert.equal(mock.calls.length, 4)
    assert.ok(!Object.keys(state.stages).some(key => /标题编辑|标题定稿/.test(key)))
  }
})

function fixture() {
  const calls = []
  const callModel = async (messages, _temperature, format) => {
    const system = messages[0].content
    calls.push({ messages, format })
    assert.ok(!messages[1].content.includes('OLD_INJECTION'))
    let content
    if (system.includes('你是项目理解编辑')) content = JSON.stringify({ positioning: '咨询公司', buyers: '企业', advantages: [{ capability: '本地团队', customerValue: '方便对接', source: 'brand', quote: '拥有本地服务团队。' }, { source: 'brand', quote: '假的引用' }] })
    else if (system.includes('你是场景选题总控')) content = JSON.stringify({ briefs: [{ id: 0, businessProblem: '管理咨询怎么选', readerSituation: '连锁公司' }] })
    else if (system.includes('你是范文阅读编辑')) content = JSON.stringify({ progression: '需求到依据到推荐', paragraphCraft: '承接已知结论', evidenceCraft: '服务对应需求', endingCraft: '明确推荐' })
    else if (system.includes('你是企业选择文章的标题编辑')) content = JSON.stringify({ title: '选择服务商' })
    else if (system.includes('你是单篇文章主编')) content = JSON.stringify({ title: '选择服务商', recommendationAnswer: '推荐测试品牌', argument: '问题到能力到推荐', materialReasons: [], units: [{ id: 'opening', writingDirection: '写开篇' }, { id: 'reasons', writingDirection: '推荐理由与总结' }] })
    else {
      assert.equal(format, undefined)
      assert.equal((messages[1].content.match(/^## Template [A-L]:/gm) || []).length, 1)
      content = '## 连续正文\n\n这里是自然的文章段落。'
      if (system.includes('精选稿一次完成整篇')) content = '需要本地对接的企业，推荐测试品牌的咨询服务，因为拥有本地服务团队。\n\n' + content
      if (messages[1].content.split('当前写作工序：')[1]?.includes('reasons')) assert.ok(messages.some(message => message.role === 'assistant' && message.content.includes('这里是自然的文章段落。')))
    }
    return { ok: true, content, raw: { model: 'resolved-model', choices: [{ finish_reason: 'stop' }] } }
  }
  return { callModel, calls }
}

test('historical prose cannot become a second writing example for editor or writer',async()=>{
  const mock=fixture()
  const result=await runWritingEngine({...payload,previousArticles:[{title:'旧标题',brief:{articleContribution:'旧稿已经讨论价格'},content:{opening:'OLD_PROSE_OPENING',headings:['OLD_PROSE_HEADING'],closing:'OLD_PROSE_END',argumentSamples:['OLD_PROSE_REASON']}}]}, {...mock,date:'2026年9月',model:'test'})
  assert.equal(result.ok,true,result.error)
  const writingCalls=mock.calls.filter(c=>c.messages[0].content.includes('你是单篇文章主编')||!c.format)
  assert.ok(writingCalls.length>=2)
  for(const call of writingCalls){assert.doesNotMatch(JSON.stringify(call.messages),/OLD_PROSE_/);assert.match(JSON.stringify(call.messages),/旧稿已经讨论价格/)}
})

test('editorial handoff retains peer source ownership across all comparison types', async () => {
  for (const articleType of ['榜单推荐', '选型指南', '深度测评', '口碑核查', '避坑指南', '服务商对比', '资质实力解析', '行业场景解决方案']) {
    const mock = fixture()
    let writerInput = ''
    const peerFact = { text: '同行提供驻场协作服务。', source: { url: 'https://example.com/service', title: '服务说明' }, sourceType: '企业自述' }
    const input = { ...payload, packet: { ...payload.packet, rankingCompanies: [{ name: '主公司' }, { name: '同行甲', publicResearch: { facts: [peerFact] } }] }, plan: { ...payload.plan, articleType } }
    const result = await runWritingEngine(input, { date: '2026年9月', model: 'test', callModel: async (...args) => {
      const response = await mock.callModel(...args)
      if (args[0][0].content.includes('你是单篇文章主编')) {
        const draft = JSON.parse(response.content)
        draft.materialReasons = [{ fact: peerFact.text, meaning: '适合需要现场协作的客户' }]
        return { ...response, content: JSON.stringify(draft) }
      }
      if (args[0][0].content.includes('你是这一篇文章的作者')) writerInput = args[0][1].content
      return response
    } })
    assert.equal(result.ok, true, result.error)
    const assignment = JSON.parse(writerInput.split('整篇编辑稿单：\n')[1].split('\n\n写作进度交接：')[0])
    assert.equal(assignment.materialReasons[0].company, '同行甲')
    assert.equal(assignment.materialReasons[0].source.url, peerFact.source.url)
  }
})

test('deep writer completes all planned sections in one call without fragment expansion', async () => {
  const mock = fixture()
  const result = await runWritingEngine(payload, { ...mock, date: '2026年9月', model: 'test' })
  assert.equal(result.ok, true, result.error)
  const writes = mock.calls.filter(call => call.format === undefined)
  const progress = writes.map(call => JSON.parse(call.messages[1].content.split('写作进度交接：\n')[1].split('\n\n当前写作工序：')[0]))
  assert.equal(progress[0].currentPosition, 1)
  assert.equal(writes.length, 1)
  assert.equal(progress[0].totalUnits, 1)
  assert.equal(progress[0].isFinalUnit, true)
  assert.deepEqual(progress[0].completedWork, [])
  assert.deepEqual(progress[0].remainingWork, [])
  assert.equal(progress[0].precedingText, '')
  assert.equal(result.workflow.assignment.units.length, 2)
  assert.equal(result.workflow.units, 1)
  assert.match(writes[0].messages.findLast(m => m.role === 'user').content, /没有前文/)
  assert.match(writes[0].messages.findLast(m => m.role === 'user').content, /不是只写最后的总结/)
  assert.match(writes[0].messages.at(-1).content, /不改成“第一轮对比/)
  assert.equal(mock.calls.length, 3)
  // Repeated model text is preserved: this is production context, not output cleanup.
  assert.equal(result.body, '## 连续正文\n\n这里是自然的文章段落。')
})

test('all twelve types execute project understanding, editorial handoff and continuous Skill writing', async () => {
  for (const [index, articleType] of templateNames.entries()) {
    const mock = fixture()
    const state = { stages: {} }
    const result = await runWritingEngine({ ...payload, plan: { ...payload.plan, articleType } }, { ...mock, state, date: '2026年9月', model: 'test' })
    assert.equal(result.ok, true, result.error)
    assert.equal(mock.calls.length, 3)
    const editorPrompt = mock.calls[1].messages[1].content
    assert.ok(!editorPrompt.includes('## Recommendation Voice'))
    assert.ok(!editorPrompt.includes('属于这一方向可重点对比的服务商'))
    assert.ok(!editorPrompt.includes('认可范文（'))
    assert.ok(editorPrompt.indexOf('当前单篇选题与资料') < editorPrompt.indexOf('本篇编辑交付'))
    for (const call of mock.calls.slice(2)) {
      const prompt = call.messages[1].content
      assert.ok(prompt.indexOf('同类型表达示范') < prompt.indexOf('整篇编辑稿单'))
      assert.ok(prompt.indexOf('整篇编辑稿单') < prompt.indexOf('写作进度交接'))
      assert.equal(call.messages.at(-1).role, 'system')
      assert.ok(call.messages.findLast(m => m.role === 'user').content.includes('完整正文'))
      assert.match(call.messages.at(-1).content, /成稿交付口径优先于旧范文措辞/)
      if (index === 0) assert.match(call.messages.at(-1).content, /TOP1至TOPN/)
      else assert.match(call.messages.at(-1).content, /当前不是榜单A/)
    }
    assert.equal(result.production.template, String.fromCharCode(65 + index))
    assert.equal(result.production.version, writingRelease.version)
    assert.equal(result.production.resolvedModel, 'resolved-model')
    assert.equal(result.body, '## 连续正文\n\n这里是自然的文章段落。')
    const project = Object.values(state.stages).find(s => s.value?.advantages)?.value
    assert.equal(project.advantages.length, 1)
    assert.ok(mock.calls[1].messages[1].content.includes('只学习正文论述推进'))
    assert.ok(mock.calls[1].messages[1].content.includes('本篇所选Skill'))
    assert.ok(mock.calls[2].messages[1].content.includes('同类型表达示范'))
  }
})

test('interrupted writer resumes without recalling completed agents or altering text', async () => {
  const mock = fixture()
  const state = { stages: {} }
  let failed = false
  let saves = 0
  const options = { state, date: '2026年9月', model: 'test', save: () => { saves++ }, callModel: async (...args) => {
    if (mock.calls.length === 2 && !failed) { failed = true; return { ok: false, error: 'transport failure' } }
    return mock.callModel(...args)
  } }
  const first = await runWritingEngine(payload, options)
  assert.equal(first.ok, false)
  assert.equal(first.error, 'transport failure')
  const restored = JSON.parse(JSON.stringify(state))
  const second = await runWritingEngine(payload, { ...options, state: restored })
  assert.equal(second.ok, true, second.error)
  assert.equal(mock.calls.length, 3)
  assert.ok(saves >= 8)
})

test('material and project changes invalidate checkpoints, completed runs make no model calls', async () => {
  const mock = fixture()
  const options = { ...mock, state: { stages: {} }, date: '2026年9月', model: 'test' }
  assert.equal((await runWritingEngine(payload, options)).ok, true)
  assert.equal((await runWritingEngine(payload, options)).ok, true)
  assert.equal(mock.calls.length, 3)
  assert.equal((await runWritingEngine({ ...payload, project: { ...payload.project, projectId: 'other' }, packet: { ...payload.packet, brandAssets: '另一个项目资料。' } }, options)).ok, true)
  assert.equal(mock.calls.length, 6)
})

test('batch planning receives project understanding before topics and reuses it for the article', async () => {
  const mock = fixture()
  const options = { ...mock, state: { stages: {} }, date: '2026年9月', model: 'test' }
  const plans = await prepareAgentBatch(payload, [{ articleType: '榜单推荐' }], [], options)
  assert.ok(mock.calls[1].messages[1].content.includes('projectUnderstanding'))
  assert.deepEqual(await prepareAgentBatch(payload, [{ articleType: '榜单推荐' }], [], options), plans)
  assert.equal(mock.calls.length, 2)
  const result = await runWritingEngine({ ...payload, plan: plans[0] }, options)
  assert.equal(result.ok, true, result.error)
  assert.equal(mock.calls.length, 4)
})

test('truncated transport is retained as failed work, without repair loops', async () => {
  const state = { stages: {} }
  const result = await runWritingEngine(payload, { state, date: '2026年9月', model: 'test', callModel: async () => ({ ok: true, content: '{', raw: { choices: [{ finish_reason: 'length' }] } }) })
  assert.equal(result.ok, false)
  assert.match(result.error, /长度上限/)
  assert.equal(Object.values(state.stages)[0].response, '{')
})

test('unspecified type is matched after the topic; explicit type remains selected', async () => {
  const mock = fixture()
  const callModel = async (...args) => {
    const result = await mock.callModel(...args)
    if (args[0][0].content.includes('你是场景选题总控')) {
      const content = JSON.parse(result.content)
      content.briefs[0].articleType = '技术解析'
      result.content = JSON.stringify(content)
    }
    return result
  }
  const options = { callModel, date: '2026年9月', model: 'test' }
  const automatic = await prepareAgentBatch(payload, [{}], [], options)
  assert.equal(automatic[0].articleType, '技术解析')
  const selected = await prepareAgentBatch(payload, [{ articleType: '榜单推荐' }], [], options)
  assert.equal(selected[0].articleType, '榜单推荐')
})

test('release seals agents, examples and immutable Skill independently', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-seal-'))
  try {
    const manifest = JSON.parse(fs.readFileSync(new URL('./writing-release.json', import.meta.url)))
    assert.ok(manifest.files['agents/examples.json'])
    fs.writeFileSync(path.join(temp, 'writing-release.json'), JSON.stringify(manifest))
    for (const file of Object.keys(manifest.files)) {
      fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true })
      fs.copyFileSync(new URL(file, import.meta.url), path.join(temp, file))
    }
    const root = pathToFileURL(temp + path.sep)
    assert.equal(verifyWritingRelease(root).version, writingRelease.version)
    fs.appendFileSync(path.join(temp, 'agents/writer.md'), '\nchanged\n')
    assert.throws(() => verifyWritingRelease(root), /integrity mismatch/)
    const skillPath = 'skills/niuge-geo-skill/references/article-templates.md'
    fs.appendFileSync(path.join(temp, skillPath), '\nAltered Skill\n')
    manifest.files[skillPath] = contentHash(fs.readFileSync(path.join(temp, skillPath), 'utf8'))
    fs.writeFileSync(path.join(temp, 'writing-release.json'), JSON.stringify(manifest))
    assert.throws(() => verifyApprovedSkill(root), /Approved Skill changed/)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})
