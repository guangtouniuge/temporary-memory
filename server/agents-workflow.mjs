import { readFileSync } from 'node:fs'
import { buildIsolatedEditor, selectionDirection } from './skill-editor.mjs'
import { planBatchTopics } from './batch-editor.mjs'
import { contentHash } from './writing-release.mjs'
import { parseModelJson } from './model-json.mjs'
import { enrichProviderMaterials } from './provider-research.mjs'
import { writingDepth, depthInstruction, editorialDepthDirection, unitBudget, articleLength, conciseContract, conciseDirection, modelFailure } from './writing-depth.mjs'

const read = file => readFileSync(new URL(`./agents/${file}`, import.meta.url), 'utf8')
const instructions = { project: read('project.md'), editor: read('editor.md'), writer: read('writer.md'), titlePlanning: read('title-planning.md') }
const examples = JSON.parse(read('examples.json'))
const workflowVersion = contentHash(JSON.stringify({ flow: 'compact-editor-writer-v1', instructions, examples, selectionDirection }))
export const projectUnderstandingVersion = contentHash(instructions.project)
export function writingExampleText(text) {
  // Keep the approved example intact on disk; its historical headline is not a title instruction.
  return String(text || '').replace(/^# [^\r\n]*(?:\r?\n|$)/gm, '').trim()
}
function headlineExpression(title) {
  const value = String(title || '').trim()
  const opening = value.split(/[：:，,？?]/)[0]
  return JSON.stringify([/^\d{4}/.test(value), /[：:]/.test(value), /[？?]/.test(value), /推荐/.test(opening), /榜|TOP\s*\d/i.test(opening), /测评|评测/.test(opening)])
}

export function selectHeadlineCandidate(headline, review, previousTitles = []) {
  const candidates = Array.isArray(headline.candidateTitles) ? headline.candidateTitles : []
  const reviews = Array.isArray(review?.candidateReviews) ? review.candidateReviews : []
  const eligible = reviews.filter(item =>
    Number.isInteger(item?.id) && typeof candidates[item.id] === 'string' && item.providerSelection === true && item.faithful === true
      && typeof item.reason === 'string' && item.reason.trim() && reviews.filter(row => row?.id === item.id).length === 1)
  let selected = eligible.find(item => candidates[item.id] === review.title) || eligible[0]
  // Diversity is a tie-break among semantically accepted originals, never a rewrite.
  const recent = previousTitles.slice(0, 6).map(headlineExpression)
  const repetitions = item => recent.filter(value => value === headlineExpression(candidates[item.id])).length
  if (selected && repetitions(selected) >= 2) {
    const alternative = eligible.reduce((best, item) => repetitions(item) < repetitions(best) ? item : best, selected)
    selected = alternative
  }
  return selected ? { title: candidates[selected.id], candidateReviews: review.candidateReviews } : null
}
const flatten = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(flatten).join('\n') : value && typeof value === 'object' ? Object.values(value).map(flatten).join('\n') : ''

export function projectInput(payload) {
  const p = payload.packet || {}
  return {
    project: Object.fromEntries(['projectId', 'name', 'brand', 'recommendWord', 'industry', 'city', 'coreKeyword'].map(key => [key, payload.project?.[key]])),
    coreKeyword: p.coreKeyword || payload.project?.coreKeyword,
    knowledgeName: p.knowledgeName || '',
    brand: p.brandAssets || p.assets || p.knowledge || '', evidence: p.authorityEvidence || p.evidence || p.citations || '',
    providers: p.rankingCompanies || p.providerList || [],
    provenance: '品牌提交资料为品牌自述；外部引证的事实范围以提供的来源为准。',
  }
}

function controller(options) {
  const state = options.state || { stages: {} }
  state.stages ||= {}
  const save = async () => options.save?.(state)
  async function stage(key, messages, json = true, validate = value => value, retainTruncation = false) {
    let recoveryGroup
    if (key.startsWith('选题交接:')) {
      try {
        const input = JSON.parse(messages[1]?.content)
        if (input.repairAttempt && input.assignments?.length === 1) {
          const { repairAttempt, ...stableInput } = input
          recoveryGroup = contentHash(JSON.stringify({ system: messages[0].content, input: stableInput, model: options.model, workflowVersion }))
        }
      } catch { /* Ordinary topic prompts are not JSON handoffs. */ }
    }
    const hash = contentHash(JSON.stringify({ messages, json, model: options.model, workflowVersion }))
    const cached = state.stages[key]
    if (cached?.hash === hash && cached.status === 'complete') return cached.value
    if (retainTruncation && cached?.hash === hash && cached.status === 'failed' && cached.errorCode === 'MODEL_OUTPUT_LENGTH') {
      throw Object.assign(new Error(cached.error), { code: cached.errorCode })
    }
    if (json && cached?.hash === hash && cached.status === 'failed' && (cached.errorCode === 'MODEL_INVALID_JSON' || (key.startsWith('单篇编辑:') && /单篇编辑交付缺少|写作工序缺少/.test(cached.error || '')))) {
      let recovered
      try { recovered = { value: validate(parseModelJson(cached.response)) } } catch { /* Retry the original stage if structural recovery is insufficient. */ }
      if (recovered) {
        state.stages[key] = { ...cached, status: 'complete', value: recovered.value, error: undefined, errorCode: undefined, formatRecovered: true, completedAt: new Date().toISOString() }
        options.log?.(`${key}已恢复原稿单格式，无需重新调用模型`)
        await save()
        return recovered.value
      }
    }
    state.current = key
    state.stages[key] = { hash, recoveryGroup, status: 'running', startedAt: new Date().toISOString() }
    await save()
    options.log?.(key)
    try {
      let result, parsed
      for (let attempt = 0; attempt < 2; attempt++) {
      const requestMessages = attempt ? [...messages, { role: 'user', content: '前次交接的JSON结构未完整闭合。本次仍完成同一个任务，只返回一个合法且完整的JSON对象，正确转义字符串，不输出代码围栏或对象外说明。不改变项目、事实、已确认选题或写作规则。' }] : messages
      result = await options.callModel(requestMessages, 0.8, json ? { type: 'json_object' } : undefined)
      state.stages[key].response = result.content || ''
      if (!result.ok) throw Object.assign(new Error(modelFailure(result.error)), { code: result.code })
      if (result.raw?.choices?.[0]?.finish_reason === 'length') throw Object.assign(new Error('模型输出达到长度上限，当前工序未完整返回'), { code: 'MODEL_OUTPUT_LENGTH' })
      if (!result.content?.trim()) throw new Error('模型接口没有返回内容')
      parsed = result.content
      if (json) {
        try { parsed = parseModelJson(result.content, () => options.log?.(`${key}交接格式已恢复，原文字与数值未改动`)) } catch {
          if (!attempt) {
            state.stages[key].formatRetries = 1
            options.log?.(`${key}格式不完整，只重试当前交接一次，保留之前进度`)
            await save()
            continue
          }
          throw Object.assign(new Error('模型连续返回不完整JSON，已保留其他完成步骤，可稍后续跑当前交接'), { code: 'MODEL_INVALID_JSON', jsonAttempts: 2 })
        }
      }
      break
      }
      const value = validate(parsed)
      state.stages[key] = { ...state.stages[key], status: 'complete', value, response: result.content, resolvedModel: result.raw?.model || options.model, completedAt: new Date().toISOString() }
      if (recoveryGroup) for (const [previousKey, previous] of Object.entries(state.stages)) {
        if (previousKey !== key && previous.status === 'failed' && previous.recoveryGroup === recoveryGroup) {
          state.stages[previousKey] = { ...previous, status: 'recovered', previousError: previous.error, error: undefined, recoveredBy: key }
        }
      }
      await save()
      return value
    } catch (error) {
      state.stages[key] = { ...state.stages[key], status: 'failed', error: error.message, errorCode: error.code }
      await save()
      throw error
    }
  }
  return { state, stage, save, onUnderstanding: options.onUnderstanding }
}

async function understand(payload, control) {
  const input = projectInput(payload)
  const key = `项目理解:${contentHash(JSON.stringify(input)).slice(0, 16)}`
  if (payload.projectUnderstanding) {
    const value = { ...payload.projectUnderstanding, projectClarifications: payload.understandingNotes || '' }
    control.state.stages[key] = { status: 'complete', value, hash: contentHash(JSON.stringify(value)), origin: 'project-profile' }
    control.state.current = key
    await control.save()
    return value
  }
  const value = await control.stage(key, [{ role: 'system', content: instructions.project }, { role: 'user', content: JSON.stringify({ ...input, projectClarifications: payload.understandingNotes || '' }) }], true, value => {
    if (!value || typeof value.positioning !== 'string' || !Array.isArray(value.advantages)) throw new Error('项目理解交付缺少定位或优势依据')
    // An interpretation may guide writing; only exact source quotes become factual anchors.
    value.advantages = value.advantages.filter(item => ['brand', 'evidence'].includes(item.source) && typeof item.quote === 'string' && item.quote.trim() && flatten(input[item.source]).includes(item.quote.trim()))
    return value
  })
  await control.onUnderstanding?.(payload, value)
  return { ...value, projectClarifications: payload.understandingNotes || '' }
}

export async function understandProject(payload, options) {
  const control = controller(options)
  return understand(await enrichProviderMaterials(payload, { ...options, state: control.state }), control)
}

export async function prepareAgentBatch(payload, plans, history, options) {
  const control = controller(options)
  payload = await enrichProviderMaterials(payload, { ...options, state: control.state })
  const understanding = await understand(payload, control)
  const inputHash = contentHash(JSON.stringify({ project: projectInput(payload), restartOf: payload.restartOf, plans, history, understanding, model: options.model, workflowVersion }))
  const key = `批量选题:${inputHash.slice(0, 16)}`
  if (control.state.stages[key]?.status === 'complete') return control.state.stages[key].value
  control.state.current = key
  control.state.stages[key] = { status: 'running', hash: inputHash }
  await control.save()
  try {
    const topicModel = async (messages, _temperature, _format, validate, retainTruncation) => {
      const result = await control.stage(`选题交接:${contentHash(JSON.stringify(messages)).slice(0, 16)}`, messages, true, validate, retainTruncation)
      return { ok: true, content: JSON.stringify(result) }
    }
    const value = await planBatchTopics({ ...payload, projectUnderstanding: understanding }, plans, history, topicModel, options.log)
    control.state.stages[key] = { status: 'complete', hash: inputHash, value }
    await control.save()
    return value
  } catch (error) {
    control.state.stages[key] = { status: 'failed', hash: inputHash, error: error.message }
    await control.save()
    throw error
  }
}

export async function runArticleAgents(payload, options) {
  const depth = writingDepth(payload)
  const control = controller(options)
  payload = await enrichProviderMaterials(payload, { ...options, state: control.state })
  const understanding = await understand(payload, control)
  const plan = payload.plan?.editorialBrief ? payload.plan : (await prepareAgentBatch(payload, [payload.plan || {}], payload.previousArticles || [], { ...options, state: control.state }))[0]
  const editor = buildIsolatedEditor({ ...payload, plan }, options.date)
  // Historical prose is for the planner's comparison, never a second writing example.
  editor.input.previous_content = editor.input.previous_content.map(item => ({ topic: item.topic }))
  const editorialDepth = { id: depth.id, label: depth.label, ...(depth.id === 'concise' ? { target: depth.target, max: depth.max } : {}) }
  editor.input.writing_depth = editorialDepth
  const modeDirection = editorialDepthDirection(depth)
  const contract = conciseContract(editor.input, editor.template.id)
  const conciseRules = depth.id === 'concise' ? conciseDirection(contract) : ''
  if (conciseRules) editor.input.concise_delivery = conciseRules
  const example = examples[editor.template.id]
  if (!example?.text) throw new Error(`缺少${editor.template.id}类认可范文`)
  // Read the approved example within editing, not through another model handoff.
  const craft = { source: example.source, text: writingExampleText(example.text), instruction: '只学习正文论述推进、段落承接和依据如何支持选择；不学习历史标题，不迁移范文企业、数字、案例或原句。标题只按当前标题策划口径。' }
  const articleKey = contentHash(JSON.stringify({ projectId: payload.project?.projectId, input: editor.input, date: options.date, articleId: options.articleId || '', workflowVersion })).slice(0, 20)
  const material = projectInput(payload)
  const draft = await control.stage(`单篇编辑:${articleKey}`, [
    { role: 'system', content: `${instructions.editor}\n\n${depthInstruction(depth)}\n${modeDirection}\n${conciseRules}\n${editor.skillContext}\n总控先确定核心答案和内容取舍，再按整篇预算安排工序。本次模式要求仅调整展开厚度，当前模板决定结构，项目表单决定推荐主体。\n\n最终标题采用以下出版口径；Skill负责正文结构，不用正文目录替代标题：\n${instructions.titlePlanning}\n\n${selectionDirection}` },
    { role: 'user', content: `本篇所选Skill：\n${editor.template.text}\n\n同类型范文写作要点：\n${JSON.stringify(craft)}\n\n项目理解：\n${JSON.stringify(understanding)}\n\n当前单篇选题与资料：\n${JSON.stringify(editor.input)}\n\n本篇编辑交付：\n面向上述客户写推荐文章，先回答“推荐谁的什么服务，哪些已有事实支撑它适合这类需求”。recommendationAnswer写成可直接发表的肯定推荐句，例如“有内部团队、需要门店信息协同的企业，推荐选择甲公司的半托管服务，现有团队继续提供业务资料，由服务团队负责内容组织和更新。”企业、服务及依据均采用本篇实际资料；这是适配推荐，不是效果承诺。\n每道工序交付原模板中的一个论述任务，结尾形式沿用本类型Core logic。合作清单、问答或行动建议由对应工序一次完成，最后收束承接已经完成的内容，不再另列一份同义清单。场景用明确的假设举例讲清需求，真实事件依据来源叙述。\n最后编写title：依据当前唯一标题策划口径，把本篇内容表达为企业推荐与选择。titleBrief的业务细项只留正文；这些细项留给正文，不塞入标题后半句。标题的企业数量、推荐角度和文体必须由本篇实际内容支持。主编直接交付最终标题，不增加其他调用。` },
    { role: 'system', content: instructions.titlePlanning },
  ], true, value => {
    // A structured narrative is still a complete plan; preserve its keys and text losslessly.
    if (value?.argument && typeof value.argument === 'object' && flatten(value.argument).trim()) value.argument = JSON.stringify(value.argument)
    if (!value?.title?.trim() || typeof value.argument !== 'string' || !Array.isArray(value.units) || !value.units.length) throw new Error('单篇编辑交付缺少标题、论证路线或写作工序')
    if (value.units.some(unit => !unit || typeof unit.writingDirection !== 'string' || !unit.writingDirection.trim())) throw new Error('写作工序缺少任务内容')
    const peerFacts = (editor.input.competitor_or_provider_list || []).flatMap(provider =>
      (provider.materials?.publicResearch?.facts || []).map(fact => ({ ...fact, company: provider.company })))
    value.materialReasons = (Array.isArray(value.materialReasons) ? value.materialReasons : []).flatMap(item => {
      if (typeof item.fact !== 'string' || !item.fact.trim()) return []
      const peer = peerFacts.find(fact => fact.text === item.fact.trim())
      if (peer) return [{ ...item, company: peer.company, source: peer.source, sourceType: peer.sourceType }]
      return flatten(material.brand).includes(item.fact.trim()) || flatten(material.evidence).includes(item.fact.trim()) ? [item] : []
    })
    return value
  })
  const assignment = draft
  // Planned units describe the article, not separate expansion calls.
  const writingUnits = depth.id === 'concise'
    ? [{ id: 'complete-concise', purpose: '完整精选文章', writingDirection: conciseRules, newAnswer: assignment.recommendationAnswer }]
    : [{ id: 'complete-deep', purpose: '完整深度文章', writingDirection: '按整篇编辑稿单一次连贯完成全文。units是论述推进，不是各自扩写的小文章；遵循thicknessPlan，重点讲透，辅助依据简明说明，同一事实只在最有价值的位置充分解释。保留所选Skill的必要结构、推荐主体及有依据的比较，不套用精选稿首段方案，不输出标题。', newAnswer: assignment.recommendationAnswer || assignment.argument }]
  const parts = []
  for (const [index, unit] of writingUnits.entries()) {
    const handoff = {
      depth: editorialDepth,
      ...(depth.id === 'concise' ? { characterBudget: unitBudget(depth, assignment.title, parts, writingUnits.length - index) } : {}),
      currentPosition: index + 1,
      totalUnits: writingUnits.length,
      isFinalUnit: index === writingUnits.length - 1,
      completedWork: writingUnits.slice(0, index).map(item => ({ id: item.id, purpose: item.purpose, newAnswer: item.newAnswer })),
      remainingWork: writingUnits.slice(index + 1).map(item => ({ id: item.id, purpose: item.purpose, newAnswer: item.newAnswer })),
      precedingText: parts.at(-1)?.slice(-1800) || '',
    }
    const part = await control.stage(`Skill写作:${articleKey}:${index + 1}/${writingUnits.length}`, [
      { role: 'system', content: `${instructions.writer}\n\n${editor.skillContext}\n${depthInstruction(depth)}\n${modeDirection}\n${conciseRules}\n优先执行总控thicknessPlan的内容取舍，以及当前工序的解释终点。篇幅数字仅作整体参考，不按数字填满段落；核心判断说明白即可交接。总控的方向和核心答案保持不变。当前模板决定结构，项目表单决定主推主体，其他企业不能替代主推主体。` },
      { role: 'user', content: `所选Skill：\n${editor.template.text}\n\n同类型表达示范（范文阅读编辑提炼的写作要点）：\n${JSON.stringify(craft)}\n\n本项目写作事实：\n${JSON.stringify(editor.input)}\n\n整篇编辑稿单：\n${JSON.stringify(assignment)}\n\n写作进度交接：\n${JSON.stringify(handoff)}\n\n当前写作工序：\n${JSON.stringify(unit)}\n\n本次写作落点：${unit.newAnswer || unit.purpose || unit.writingDirection}\n选题里的客户处境是编辑设想，不是采访记录。用“例如，一家……如果……”这样的假设叙述说明业务需求；只在本项目事实明确提供真实案例时叙述已发生的经历。推荐段依据整篇稿单说明推荐哪项服务及其用途。当前类型的收束按原模板和主编分工执行，承接已有回答，交付本次的新认识。` },
      ...(parts.length ? [{ role: 'assistant', content: parts.join('\n\n') }] : []),
      { role: 'user', content: `现在完成${unit.purpose}。${unit.writingDirection}\n本次交付的新认识：${unit.newAnswer || unit.purpose}。${depth.id === 'concise' ? '本次从开头直接推荐到完整结论，一次写完全文，没有下一工序。' : '本次从开头到结论一次完成整篇深度文章，没有前文，也没有下一道扩写工序。各模块共享整篇容量参考，已经说清的依据不重复铺陈；完整交付正文，不是只写最后的总结。'}输出完整正文，不重复标题。没有资料对应的真实客户案例，开篇直接写这类行业客户的选择需求，不编一家公司过去发生过的故事，不编营收、项目数量、增长、人员履历和经营年限。需要举例时明确标为假设，只说明服务需求；案例类也遵守真实案例与假设场景的身份区别。\n落笔前理解三项编辑取舍，不输出思考过程：第一，只有名称的同行不推断能力；A类榜单保留每家TOP名次小标题与名称，不因资料少跳过名次，不写候选范围说明。不能从“战略”“智库”或城市字样推断服务能力，也不分别安排待核验段。需要比较服务类型时独立分析培训、专项咨询、综合辅导等合作方式，不给无资料公司分配类型。稿单若作了此类推断，以原始资料为准。第二，企业分析已经充分解释的核算、绩效、人才、平台等依据，后续推荐结论不再逐项复述，更不能以“断点”改名再讲；结尾直接给适合谁与如何开始的取舍。第三，把同一问题的为什么、判断标准、验证方式组织成递进解释，不把同一组项目指标在背景、标准、清单里反复铺开。具体行业能力未经资料确认，保持为需洽谈的应用方向，不因写到结论而升级为已经具备。` },
      { role: 'system', content: `成稿交付口径优先于旧范文措辞：第一自然段直接表达主编recommendationAnswer的推荐结论，总结再次明确推荐该企业与适配服务，不改成“第一轮对比、可以了解、纳入候选、仅供参考”。这是基于已知服务的适配推荐，不是效果承诺，也不证明行业专项业绩。全文不出现“按输入顺序、项目表单、本篇只保留名称、没有资料所以、不同主体需要说明”等后台解释。事实不足不得猜测或转嫁。${editor.template.id === 'A' ? '当前是榜单A：名单之后按同级TOP1至TOPN小标题完整逐家写，企业及顺序用输入原名次，不跳号。辅助企业用可确认业务事实简写，没有事实的保持名次名称，不为填满段落编造能力或写索要材料的套话；不要加一段解释榜单只是比较范围。主推企业必须有清楚的推荐理由，不能把整份榜单退成待筛选名单。' : '当前不是榜单A，保留所选Skill，不新增TOP榜。'}其余模块与篇幅取舍仍按原Skill和本篇稿单，只输出正文。` },
    ], false)
    parts.push(part)
  }
  let body = parts.join('\n\n')
  // A bounded writer pass reduces expansion; never cut a sentence or ship an oversized draft.
  for (let attempt = 1; articleLength(assignment.title, body) > depth.max && attempt <= 2; attempt++) {
    body = await control.stage(`篇幅收束:${articleKey}:${attempt}`, [
      { role: 'system', content: `${instructions.writer}\n\n${editor.skillContext}\n本篇唯一所选模板：\n${editor.template.text}\n${depthInstruction(depth)}\n${modeDirection}\n你是本篇原作者，现在收束自己的全文，不是重选题或评分审核。保留原稿模块顺序和论证关系，不增设榜单、不新排名、不改变模板类型，不将主推企业换成候选企业。原稿已有名次才保留其名次；选型、测评与榜单各按本篇模板写，不能相互改造。保留主编核心答案、企业身份、事实归属及比较对象。只缩短铺陈和重复说明，完整输出正文，不输出标题，不硬截断。` },
      { role: 'user', content: JSON.stringify({ title: assignment.title, template: { id: editor.template.id, name: editor.template.name }, originalHeadings: body.match(/^#{1,6}\s+.+$/gm) || [], primaryCompany: editor.input.recommended_company, primaryName: editor.input.recommended_short_name, assignment, materials: editor.input, ...(depth.id === 'concise' ? { delivery: conciseRules } : {}), currentLength: articleLength(assignment.title, body), target: depth.target, body }) },
    ], false, value => {
      if (attempt === 2 && articleLength(assignment.title, value) > depth.max) throw new Error(`${depth.label}篇幅仍超过${depth.max}字，可继续收束任务。`)
      return value
    })
  }
  if (articleLength(assignment.title, body) > depth.max) throw new Error(`${depth.label}篇幅收束未完成：仍超过${depth.max}字，未入成品库，可继续任务。`)
  control.state.current = `成品:${articleKey}`
  await control.save()
  return {
    title: assignment.title, body, writingDepth: depth.id, visibleCharacters: articleLength(assignment.title, body), editorialBrief: plan.editorialBrief,
    workflow: { version: workflowVersion, articleKey, template: editor.template.id, units: writingUnits.length, exampleSource: example.source, assignment },
    resolvedModel: Object.values(control.state.stages).filter(stage => stage.resolvedModel).at(-1)?.resolvedModel || options.model,
    promptHash: contentHash(JSON.stringify(Object.entries(control.state.stages).map(([key, value]) => [key, value.hash]))),
  }
}
