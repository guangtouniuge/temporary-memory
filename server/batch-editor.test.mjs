import test from 'node:test'
import assert from 'node:assert/strict'
import { planBatchTopics, topicHistory, repeatedTopic, freshArticlePlans, completeTopicBriefs } from './batch-editor.mjs'
import { buildIsolatedEditor, selectTemplate, templateNames } from './skill-editor.mjs'

test('bounded batch topic calls preserve ten isolated templates and carry preceding briefs', async () => {
  const assignments = Array.from({ length: 10 }, (_, planIndex) => ({ articleType: templateNames[planIndex], planIndex, writingSceneMode: planIndex % 2 ? '按实际场景写' : '按自己行业写', industryScene: 'GEO行业' }))
  let calls = 0
  const progress = []
  const plans = await planBatchTopics({ packet: { coreKeyword: '西安GEO公司' } }, assignments, [{ title: '历史文章', brief: { centralQuestion: '旧问题', readerSituation: 'DO_NOT_COPY_OLD_STORY' } }], async messages => {
    calls++
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    assert.ok(input.previousTopics.some(row => row.title === '历史文章'))
    assert.equal(input.previousTopics[0].question, undefined)
    assert.ok(!JSON.stringify(messages).includes('DO_NOT_COPY_OLD_STORY'))
    assert.equal(input.assignments.length, calls < 3 ? 4 : 2)
    if (calls > 1) assert.ok(input.previousTopics.some(row => row.businessProblem === '问题0'))
    assert.ok(input.assignments.every(a => a.articleType && a.originalTemplate === selectTemplate(a.articleType).text))
    assert.equal(input.assignments[0].scene, undefined)
    assert.equal(input.assignments[1].scene, 'GEO行业')
    return { ok: true, content: JSON.stringify({ briefs: input.assignments.map(a => ({ id: a.id, businessProblem: `问题${(calls - 1) * 4 + a.id}`, customerQuestion: `终端问法${(calls - 1) * 4 + a.id}`, readerSituation: `处境${a.id}`, sectionTasks: ['UNWANTED_REPLACEMENT_OUTLINE'] })) }) }
  }, message => progress.push(message))
  assert.equal(calls, 3)
  assert.equal(new Set(plans.map(p => p.question)).size, 10)
  assert.ok(progress.some(message => message.includes('直接执行对应Skill稿单')))
  for (const [index, plan] of plans.entries()) {
    assert.equal(plan.articleType, assignments[index].articleType)
    const editor = buildIsolatedEditor({ plan, packet: { brandAssets: '原始品牌资料', evidence: '原始引证资料' } }, '2026年9月')
    assert.equal(editor.template.id, selectTemplate(plan.articleType).id)
    assert.ok(editor.messages[1].content.includes(`问题${index}`))
    assert.ok(editor.messages[1].content.includes(`终端问法${index}`))
    assert.ok(editor.messages[1].content.includes('原始品牌资料'))
    assert.ok(editor.messages[1].content.includes('原始引证资料'))
    assert.ok(!editor.messages[1].content.includes('UNWANTED_REPLACEMENT_OUTLINE'))
  }
})

test('history belongs to the selected project only', () => {
  assert.deepEqual(topicHistory([{ project: 'a', title: 'a' }, { project: 'b', title: 'b' }], { name: 'a' }).map(x => x.title), ['a'])
})

test('regeneration sends project understanding and historical coverage to fresh topic planning',async()=>{
 const history=[{title:'旧服务商口碑选择',brief:{businessProblem:'原合作问题',titleBrief:{choiceAngle:'旧方向'}},content:'旧文章比较论据'}]
 const plans=freshArticlePlans([{articleType:'选型指南',writingSceneMode:'按自己行业写',editorialBrief:{businessProblem:'不应复用'},title:'不应复用标题'}])
 const result=await planBatchTopics({restartOf:'JOB-old',project:{name:'项目'},projectUnderstanding:{positioning:'原项目服务定位'},packet:{coreKeyword:'咨询公司'}},plans,history,async messages=>{
  const input=JSON.parse(messages[1].content.split('项目资料：\n')[1])
  assert.match(input.generationPurpose,/全新批次/);assert.match(input.generationPurpose,/不是失败续跑/)
  assert.equal(input.projectUnderstanding.positioning,'原项目服务定位')
  assert.equal(input.previousTopics[0].businessProblem,'原合作问题')
  assert.equal(input.previousTopics[0].content,'旧文章比较论据')
  assert.ok(!JSON.stringify(input.assignments).includes('不应复用'))
  return {ok:true,content:JSON.stringify({briefs:[{id:0,businessProblem:'新设分公司扩张阶段怎样匹配顾问合作方式',readerSituation:'扩张企业',topicDifference:'新阶段与合作方式，非旧口碑核查'}]})}
 })
 assert.match(result[0].editorialBrief.businessProblem,/扩张/)
})

test('length-limited multi-topic response splits to singles with original plans and growing history', async () => {
  const original = templateNames.slice(0, 5).map((articleType, planIndex) => ({ articleType, planIndex, lockTopic: true, question: `方向${planIndex}` }))
  const sizes = []
  const result = await planBatchTopics({}, original, [], async messages => {
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    sizes.push(input.assignments.length)
    if (input.assignments.length > 1) return { ok: false, code: 'MODEL_OUTPUT_LENGTH', error: 'truncated' }
    const item = input.assignments[0]
    if (item.question !== '方向0') assert.ok(input.previousTopics.some(row => row.businessProblem === '方向0'))
    return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, businessProblem: item.question, readerSituation: '采购' }] }) }
  })
  assert.deepEqual(sizes, [4, 1, 1, 1, 1, 1])
  assert.deepEqual(result.map(p => p.planIndex), [0, 1, 2, 3, 4])
  assert.deepEqual(result.map(p => p.articleType), original.map(p => p.articleType))
})

test('single-topic truncation and unrelated provider failures do not fan out or loop', async () => {
  for (const [plans, code] of [[[{}], 'MODEL_OUTPUT_LENGTH'], [[{}, {}], 'AUTH_FAILED']]) {
    let calls = 0
    await assert.rejects(planBatchTopics({}, plans, [], async () => { calls++; return { ok: false, code, error: 'provider failure' } }), /provider failure/)
    assert.equal(calls, 1)
  }
})

test('historical article content reaches the editor without images or other projects', () => {
  const history = topicHistory([{project:'a',title:'历史标题',body:'![图](private-file)\n开场旧论点\n## 旧论证维度',editorialBrief:{businessProblem:'旧业务问题'}},{project:'b',title:'其他客户'}], {name:'a'})
  const editor = buildIsolatedEditor({previousArticles:history}, '2026年9月')
  assert.match(JSON.stringify(editor.input.previous_content), /旧论证维度/)
  assert.doesNotMatch(JSON.stringify(editor.input.previous_content), /private-file|其他客户/)
})

test('duplicate topic is replanned before writing, with bounded retries', async () => {
  const old = {businessProblem:'连锁品牌如何选择能落地一城一策的服务商',readerSituation:'扩张'}
  let calls=0
  const result=await planBatchTopics({},[{}],[{title:'旧标题',brief:old}],async messages=> messages[0].content.includes('你是选题去重编辑') ? {ok:true,content:'{"conflicts":[]}'} : ({ok:true,content:JSON.stringify({briefs:[{...old,id:0,businessProblem:++calls===1?old.businessProblem:'首次采购如何明确合同中的数据归属与迁移权限'}]})}))
  assert.equal(calls,2)
  assert.match(result[0].question,/数据归属/)
  assert.equal(repeatedTopic(old,old),true)
  let failedCalls=0
  const continued=await planBatchTopics({},[{}],[{brief:old}],async()=>{failedCalls++;return {ok:true,content:JSON.stringify({briefs:[{...old,id:0}]})}})
  assert.match(continued[0].editorialBrief.noveltyWarning,/不保证全新角度/)
  assert.equal(failedCalls,3)
})

test('short repeated service angles are detected without treating different short angles as duplicates', () => {
  assert.equal(repeatedTopic({titleBrief:{choiceAngle:'服务响应能力'}},{titleBrief:{choiceAngle:'服务响应能力'}}),true)
  assert.equal(repeatedTopic({titleBrief:{choiceAngle:'服务响应能力'}},{titleBrief:{choiceAngle:'数据迁移能力'}}),false)
})

test('one unresolved overlap cannot discard accepted topics or prevent the fifth article plan', async () => {
  const old={businessProblem:'企业如何选择能够落实完整财务管理体系的咨询公司',readerSituation:'企业采购'}
  let calls=0
  const plans=await planBatchTopics({},Array.from({length:5},(_,planIndex)=>({planIndex})),[{brief:old}],async messages=>{
    if(messages[0].content.includes('你是选题去重编辑')) return {ok:true,content:'{"conflicts":[]}'}
    calls++
    const input=JSON.parse(messages[1].content.split('项目资料：\n')[1])
    const briefs=input.assignments.length===4
      ? [{id:0,...old},...[1,2,3].map(id=>({id,businessProblem:`新题${id}`,readerSituation:'采购'}))]
      : [{id:0,...(calls<=3?old:{businessProblem:'第五篇新题',readerSituation:'采购'})}]
    return {ok:true,content:JSON.stringify({briefs})}
  })
  assert.equal(plans.length,5)
  assert.deepEqual(plans.map(p=>p.planIndex),[0,1,2,3,4])
  assert.match(plans[0].editorialBrief.noveltyWarning,/角度相近/)
  assert.deepEqual(plans.slice(1).map(p=>p.question),['新题1','新题2','新题3','第五篇新题'])
  assert.equal(calls,4)
})

test('new tasks strip generated briefs but preserve explicit user topic and scene choices', () => {
  const input = [{ lockTopic:true, question:'保留用户主题', businessScene:'口腔诊所', editorialBrief:{businessProblem:'上次稿单'} }]
  const fresh=freshArticlePlans(input)
  assert.equal(fresh[0].editorialBrief,undefined)
  assert.equal(fresh[0].question,'保留用户主题')
  assert.equal(fresh[0].businessScene,'口腔诊所')
  assert.equal(input[0].editorialBrief.businessProblem,'上次稿单')
  const generated=freshArticlePlans([{question:'自动分配的老问题',angle:'旧处境',editorialBrief:{businessProblem:'自动分配的老问题',readerSituation:'旧处境'}}])[0]
  assert.equal(generated.question,undefined)
  assert.equal(generated.angle,undefined)
})

test('semantic comparison is folded into planning with history and no review call', async () => {
  const history = [{ title: '旧财务方向', brief: { businessProblem: '财务咨询选择', articleContribution: '资金管理' } }]
  let calls = 0
  const result = await planBatchTopics({}, [{ planIndex: 10 }, { planIndex: 11 }], history, async messages => {
    calls++
    assert.match(messages[0].content, /你是场景选题总控/)
    assert.match(messages[0].content, /先理解项目真实核心词、产品\/服务\/企业\/厂家\/门店\/品牌与品牌资料/)
    assert.match(messages[0].content, /此要求适用于所有新批次/)
    assert.match(messages[0].content, /行业不同不算实质差异|行业不同不算|行业不同|行业轮换/)
    assert.match(messages.at(-1).content, /在本次调用内比较历史/)
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    assert.equal(input.previousTopics[0].title, '旧财务方向')
    return { ok: true, content: JSON.stringify({ briefs: [
      { id: 0, businessProblem: '选择支持跨区域协作的管理咨询公司', readerSituation: '跨区域扩展', topicDifference: '比较组织协作而非资金管理' },
      { id: 1, businessProblem: '企业接班人培养适合哪些咨询公司', readerSituation: '接班需求', topicDifference: '比较人才培养而非资金管理' }
    ] }) }
  })
  assert.equal(calls, 1)
  assert.equal(result[0].planIndex, 10)
  assert.equal(result[1].planIndex, 11)
  assert.match(result[1].editorialBrief.topicDifference, /人才培养/)
})

test('planner only returns topic and material, not paragraph instructions', async () => {
  const [plan] = await planBatchTopics({}, [{ articleType: '问答解释' }], [], async messages => {
    assert.equal(messages.length, 4)
    assert.match(messages.at(-1).content, /只交付简洁选题简报/)
    assert.ok(!JSON.stringify(messages).includes('sectionFocus'))
    return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, businessProblem: '已有内容如何更新', readerSituation: '服务范围刚刚变化', sectionFocus: [{ task: 3, focus: 'OLD_SECTION' }], openingAnswer: 'OLD_OPENING', reasoningPath: 'OLD_REASONING' }] }) }
  })
  assert.equal(plan.editorialBrief.businessProblem, '已有内容如何更新')
  assert.ok(!/OLD_SECTION|OLD_OPENING|OLD_REASONING/.test(JSON.stringify(plan)))
})


test('fixed topic rebuilds recommendation judgment while preserving the customer problem', async () => {
  const [plan] = await planBatchTopics({}, [{ articleType: '榜单推荐', lockTopic: true, question: '投入进展如何看清', angle: '负责人需要了解执行进展' }], [], async messages => {
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    assert.equal(input.assignments[0].fixedTopic, true)
    assert.equal(input.assignments[0].readerSituation, '负责人需要了解执行进展')
    return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, businessProblem: '偏移的问题', readerSituation: '偏移的场景', openingAnswer: '推荐能展示执行进展的服务', reasoningPath: '由进展不清解释过程可见的用途' }] }) }
  })
  assert.equal(plan.question, '投入进展如何看清')
  assert.equal(plan.editorialBrief.businessProblem, '投入进展如何看清')
  assert.equal(plan.editorialBrief.readerSituation, '负责人需要了解执行进展')
  assert.equal(plan.editorialBrief.openingAnswer, undefined)
})

test('same-type batch carries distinct editorial decisions without replacing the template', async () => {
  const assignments = Array.from({ length: 3 }, (_, planIndex) => ({ articleType: '榜单推荐', planIndex, writingSceneMode: '按自己行业写' }))
  const history = [{ title: '旧标题', brief: { centralQuestion: '旧问题', decisionFocus: '旧决策', titleAngle: '旧角度' } }]
  const plans = await planBatchTopics({}, assignments, history, async messages => {
    assert.ok(messages[1].content.includes('titleBrief'))
    assert.ok(messages[1].content.includes('这里不提前写成品标题'))
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    assert.equal(input.topicExamples, undefined)
    assert.equal(input.previousTopics[0].businessProblem, '旧问题')
    assert.equal(input.previousTopics[0].decisionFocus, '旧决策')
    return { ok: true, content: JSON.stringify({ briefs: assignments.map((_, id) => ({ id, businessProblem: `问题${id}`, readerSituation: `处境${id}`, decisionFocus: `决策${id}`, titleAngle: `标题方向${id}`, openingAnswer: `直接答案${id}`, reasoningPath: `推荐推理${id}`, sectionTasks: ['OTHER_OUTLINE'] })) }) }
  })
  for (const [id, plan] of plans.entries()) {
    const editor = buildIsolatedEditor({ plan }, '2026年9月')
    assert.equal(editor.input.topic.decisionFocus, `决策${id}`)
    assert.equal(editor.input.topic.openingAnswer, undefined)
    assert.equal(editor.input.topic.reasoningPath, undefined)
    assert.equal(editor.input.topic.titleAngle, `标题方向${id}`)
    assert.ok(!editor.messages[1].content.includes('OTHER_OUTLINE'))
    assert.ok(editor.messages[1].content.endsWith(selectTemplate('榜单推荐').text))
  }
})

test('topic handoff selects source excerpts and keeps the two customer identities', async () => {
  const payload = { project: { brand: '服务公司' }, packet: { coreKeyword: 'GEO公司', brandAssets: ['提供门店资料梳理。提供多城市运营。'], authorityEvidence: ['品牌自行提供的服务说明。'] } }
  const [plan] = await planBatchTopics(payload, [{ articleType: '问答解释', writingSceneMode: '按实际场景写' }], [], async messages => {
    const input = JSON.parse(messages[1].content.split('项目资料：\n')[1])
    assert.equal(input.assignments[0].articleType, '问答解释')
    assert.deepEqual(input.projectMaterials.brand, payload.packet.brandAssets)
    return { ok: true, content: JSON.stringify({ briefs: [{ id: 0, readerSituation: '门店介绍不清', businessProblem: '门店服务信息准确', serviceBuyer: '婚礼策划公司负责人', endCustomer: '准备婚礼的新人', customerIndustry: '婚礼策划', customerQuestion: '策划包含哪些', materialQuotes: [{ source: 'brand', quote: '提供门店资料梳理。', relevance: '整理套餐包含项' }, { source: 'brand', quote: '保证推荐第一。', relevance: 'INVALID_CONNECTION' }] }] }) }
  })
  const editor = buildIsolatedEditor({ ...payload, plan }, '2026年9月')
  assert.equal(editor.input.customer_scene, '婚礼策划')
  assert.equal(editor.input.participants.service_buyer, '婚礼策划公司负责人')
  assert.equal(editor.input.participants.buyers_customers, '准备婚礼的新人')
  assert.deepEqual(editor.input.primary_company_materials.brand_assets, ['提供门店资料梳理。'])
  assert.ok(!JSON.stringify(editor.input.primary_company_materials).includes('提供多城市运营。'))
  assert.ok(JSON.stringify(editor.input.available_project_materials).includes('提供多城市运营。'))
  assert.ok(!JSON.stringify(editor.input).includes('保证推荐第一。'))
  assert.deepEqual(editor.input.material_connections, [{ source: 'brand', source_index: 0, relevance: '整理套餐包含项' }])
  assert.ok(!JSON.stringify(editor.input).includes('INVALID_CONNECTION'))
  assert.ok(editor.messages[1].content.endsWith(selectTemplate('问答解释').text))
})

test('incomplete batch and missing reader question fail without generic fallback', async () => {
  await assert.rejects(planBatchTopics({}, [{ articleType: '榜单推荐' }], [], async () => ({ ok: true, content: '{"briefs":[]}' })), /补齐/)
  await assert.rejects(planBatchTopics({}, [{ articleType: '榜单推荐' }], [], async () => ({ ok: true, content: '{"briefs":[{"id":0}]}' })), /中心问题/)
})

test('three-of-four response retains all good briefs and requests only missing original id', async () => {
  const briefs=[0,1,2].map(id=>({id,businessProblem:`已有${id}`,readerSituation:'原处境'}))
  let calls=0
  const result=await completeTopicBriefs({briefs},{assignments:[0,1,2,3].map(id=>({id,articleType:`类型${id}`}))},async messages=>{
    calls++
    const request=JSON.parse(messages[1].content)
    assert.deepEqual(request.assignments,[{id:3,articleType:'类型3'}])
    assert.deepEqual(request.acceptedBriefs,briefs)
    return {ok:true,content:JSON.stringify({briefs:[{id:3,businessProblem:'补齐',readerSituation:'新处境'}]})}
  })
  assert.equal(calls,1)
  assert.deepEqual(result.briefs.slice(0,3),briefs)
  assert.deepEqual(result.briefs.map(b=>b.id),[0,1,2,3])
})

test('out-of-order, extra and duplicate ids never misassign briefs; malformed slots are repaired', async () => {
  let calls=0
  const result=await completeTopicBriefs({briefs:[{id:'1',businessProblem:'B',readerSituation:'b'}, {id:1,businessProblem:'duplicate',readerSituation:'x'}, {id:8,businessProblem:'extra',readerSituation:'x'}, {id:0}]}, {assignments:[{id:0},{id:1}]},async()=>{
    calls++
    return {ok:true,content:JSON.stringify({briefs:[{id:calls===1?9:0,businessProblem:'A',readerSituation:'a'}]})}
  })
  assert.equal(calls,2)
  assert.deepEqual(result.briefs.map(b=>b.businessProblem),['A','B'])
})

test('invalid JSON retries the same request only once; articles are not rewritten', async () => {
  const calls = []
  const progress = []
  const result = await planBatchTopics({}, [{ articleType: '榜单推荐' }], [], async messages => {
    calls.push(messages)
    return { ok: true, content: calls.length === 1 ? '{"briefs":\n' : '{"briefs":[{"id":0,"businessProblem":"问题","readerSituation":"处境"}]}' }
  }, message => progress.push(message))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(result[0].editorialBrief.businessProblem, '问题')
  assert.ok(progress.some(message => message.includes('重试本份稿单一次')))
  let count = 0
  await assert.rejects(planBatchTopics({}, [{ articleType: '榜单推荐' }], [], async () => { count++; return { ok: true, content: '{' } }), /连续返回无效JSON/)
  assert.equal(count, 2)
})

test('all twelve types receive original facts and their own full skill at writing time', async () => {
  for (const articleType of templateNames) {
    const payload = { packet: { brandAssets: '主品牌服务原文', authorityEvidence: '原始来源', rankingCompanies: [{ name: '已提供公司' }] } }
    const [plan] = await planBatchTopics(payload, [{ articleType }], [], async () => ({ ok: true, content: '{"briefs":[{"id":0,"businessProblem":"业务问题","readerSituation":"客户处境"}]}' }))
    const editor = buildIsolatedEditor({ ...payload, plan }, '2026年9月')
    assert.ok(editor.messages[1].content.includes(selectTemplate(articleType).text))
    assert.equal((editor.messages[1].content.match(/^## Template [A-L]:/gm) || []).length, 1)
    assert.ok(editor.messages[1].content.includes('主品牌服务原文'))
    assert.ok(editor.messages[1].content.includes('原始来源'))
  }
})
