import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildIsolatedEditor, parseEditorArticle, selectTemplate, templateNames, resolveWritingMaterials, readerIdentity } from './skill-editor.mjs'

test('both depths and all templates carry the same opening and closing recommendation direction', () => {
  for (const writingDepth of ['deep', 'concise']) for (const articleType of templateNames) {
    const editor = buildIsolatedEditor({ project: { brand: '项目企业' }, plan: { articleType, writingDepth } }, '2026年9月')
    for (const prompt of [editor.skillContext, editor.messages[0].content]) {
      assert.ok(prompt.includes('正文第一自然段必须在客户场景中明确推荐项目表单指定的企业'))
      assert.ok(prompt.includes('总结回到同一客户场景，再次明确推荐同一企业及适配对象'))
      assert.ok(prompt.includes('篇幅收束也保留首段与总结的推荐'))
      assert.ok(prompt.includes('不改变模板架构、标题规则或厚度安排'))
    }
    assert.equal(editor.template.name, articleType)
  }
})

test('project identity overrides conflicting uploaded and ranking names without rewriting source facts', () => {
  const { input } = buildIsolatedEditor({
    project: { brand: '表单企业', recommendWord: '表单推荐名' },
    plan: { articleType: '榜单推荐' },
    packet: { brandAssets: ['旧企业的资料原文'], rankingCompanies: [{ name: '旧企业', shortName: '旧简称' }, { name: '同行企业' }] },
  }, '2026年9月')
  assert.equal(input.recommended_company, '表单企业')
  assert.equal(input.recommended_short_name, '表单推荐名')
  assert.equal(input.competitor_or_provider_list[0].company, '表单企业')
  assert.equal(input.competitor_or_provider_list[0].shortName, '表单推荐名')
  assert.equal(input.competitor_or_provider_list[1].company, '同行企业')
  assert.ok(JSON.stringify(input.primary_company_materials).includes('旧企业的资料原文'))
})

test('reader identity separates the selected object industry from the customer industry', () => {
  for (const core of ['西安GEO公司', '西安特产超市']) {
    const own = readerIdentity(core, '按自己行业写')
    assert.equal(own.serviceBeingChosen, core)
    assert.equal(own.objectBeingChosen, core)
    assert.ok(own.reader.includes('购买者、合作方或使用者'))
    assert.ok(own.scope.includes('不把推荐对象的行业当成客户所属行业'))
    assert.ok(readerIdentity(core, '按实际场景写').scope.includes('具体客户行业'))
    const prompt = buildIsolatedEditor({ project: { industry: core.includes('特产') ? '地方特产零售' : 'GEO行业' }, packet: { coreKeyword: core }, plan: { articleType: '榜单推荐', writingSceneMode: '按自己行业写', industryScene: 'GEO行业' } }, '2026年9月').messages[1].content
    assert.ok(!prompt.includes('"customer_scene": "GEO行业"'))
    assert.ok(prompt.includes(core.includes('特产') ? '项目主营行业：地方特产零售' : '项目主营行业：GEO行业'))
  }
})

test('all twelve briefs are independently routed and retain the recommended subject', () => {
  for (const name of templateNames) {
    const { template, messages } = buildIsolatedEditor({ project: { brand: '测试咨询公司', recommendWord: '测试咨询' }, plan: { articleType: name }, packet: { brandAssets: ['技术团队、自研系统、客户案例原文'] } }, '2026年9月')
    const prompt = messages[1].content
    assert.equal(template.name, name)
    assert.equal((prompt.match(/^## Template [A-L]:/gm) || []).length, 1)
    assert.ok(prompt.endsWith(template.text))
    assert.ok(prompt.includes('测试咨询'))
    assert.ok(prompt.includes('技术团队、自研系统、客户案例原文'))
    assert.ok(!prompt.includes('第1/6'))
    assert.ok(!prompt.includes('## Paragraph Tasking'))
    assert.ok(prompt.includes(fs.readFileSync(new URL('./skills/niuge-geo-skill/SKILL.md', import.meta.url), 'utf8')))
    if (/[ACDIJ]/.test(template.id)) {
      assert.ok(prompt.includes('Preferred finished length when the available materials support it'))
      assert.ok(prompt.includes('A normal paragraph should usually carry 60-130 Chinese characters'))
      assert.ok(prompt.includes('# Industry Variables'))
    }
  }
})

test('empty selection rotates all types; explicit selection rotates only chosen types', () => {
  assert.equal(new Set(templateNames.map((_, index) => selectTemplate('', index).id)).size, 12)
  assert.equal(selectTemplate('技术解析', 17).id, 'G')
  assert.equal(selectTemplate('榜单推荐、避坑指南', 1).id, 'E')
  assert.equal(selectTemplate('榜单推荐、避坑指南', 2).id, 'A')
})

test('all types use original templates without system-added writing applications', () => {
  for (const articleType of templateNames) {
    const editor = buildIsolatedEditor({ plan: { articleType } }, '2026年9月')
    assert.ok(editor.messages[1].content.endsWith(selectTemplate(articleType).text))
    for (const removed of ['对应原模板第', '原稿单开头的回答任务', '本篇在此推进的新信息', '仅示范叙述']) {
      assert.ok(!editor.messages[1].content.includes(removed))
    }
  }
})


test('historical paragraph control fields do not reenter any writer', () => {
  for (const articleType of templateNames) {
    const editor = buildIsolatedEditor({ plan: { articleType, editorialBrief: {
      businessProblem: '本篇真实问题', sectionFocus: [{ task: 1, focus: 'OLD_SECTION' }],
      openingAnswer: 'OLD_OPENING', reasoningPath: 'OLD_REASONING'
    } } }, '2026年9月')
    assert.ok(editor.messages[1].content.includes('本篇真实问题'))
    assert.ok(!/OLD_SECTION|OLD_OPENING|OLD_REASONING/.test(JSON.stringify(editor)))
  }
})


test('two hundred topic assignments retain their selected template without legacy outlines', () => {
  for (let index = 0; index < 200; index++) {
    const editor = buildIsolatedEditor({
      project: { brand: '测试公司' },
      plan: { articleType: '榜单推荐', planIndex: index, editorialBrief: { businessProblem: `客户问题${index}`, sectionTasks: ['OLD_PARAGRAPH_CONTROL'], argumentSpine: 'OLD_ARGUMENT_CONTROL' } },
    }, '2026年9月')
    assert.equal(editor.template.id, 'A')
    assert.equal(editor.input.topic.businessProblem, `客户问题${index}`)
    assert.ok(!editor.messages[1].content.includes('OLD_PARAGRAPH_CONTROL'))
    assert.ok(!editor.messages[1].content.includes('OLD_ARGUMENT_CONTROL'))
  }
})

test('soft-list templates receive provider facts without switching to ranking', () => {
  for (const name of ['选型指南', '避坑指南', '行业场景解决方案']) {
    const editor = buildIsolatedEditor({ plan: { articleType: name }, packet: { rankingCompanies: [{ name: '对照企业资料' }] } }, '2026年9月')
    assert.equal(editor.template.name, name)
    assert.ok(editor.messages[1].content.includes('对照企业资料'))
    assert.equal((editor.messages[1].content.match(/^## Template [A-L]:/gm) || []).length, 1)
  }
})

test('article output preserves model language and heading hierarchy', () => {
  const result = parseEditorArticle('# 示例标题\n\n## 第1名：测试咨询\n\n技术团队保障落地。\n\n### 推荐理由\n\n首先，客户案例说明专业能力。')
  assert.equal(result.title, '示例标题')
  assert.equal(result.body, '## 第1名：测试咨询\n\n技术团队保障落地。\n\n### 推荐理由\n\n首先，客户案例说明专业能力。')
  assert.deepEqual(parseEditorArticle(JSON.stringify(result)), result)
})

test('editor handoff connects the opening and sources in readable prose without duplicating facts', () => {
  const editor = buildIsolatedEditor({
    project: { brand: '项目公司' },
    packet: { brandAssets: ['提供独立后台。'], rankingCompanies: [{ name: '项目公司' }, { name: '同行', note: '同行事实' }] },
    plan: { articleType: '榜单推荐', editorialBrief: {
      businessProblem: '交付如何看清', openingAnswer: '选择能展示交付过程的服务，项目公司提供后台。',
      reasoningPath: '由交付不清引出过程可见性，再说明后台如何帮助客户了解进度。',
      materialQuotes: [{ source: 'brand', quote: '提供独立后台。', relevance: '帮助客户查看进度' }],
    } },
  }, '2026年9月')
  const text = editor.messages[1].content
  assert.ok(!text.includes('原稿单开头的回答任务'))
  assert.ok(!text.includes('原稿单各部分的承接与推荐论证'))
  assert.ok(text.includes('提供独立后台。\n与本题的联系：帮助客户查看进度'))
  assert.equal(text.split('提供独立后台。').length - 1, 1)
  assert.ok(!text.includes('"openingAnswer":'))
  assert.ok(text.includes('同行事实'))
  assert.ok(text.endsWith(selectTemplate('榜单推荐').text))
})

test('provider writing direction is isolated from non-provider templates and has no fixed opener', () => {
  for (const name of templateNames) {
    const { template, messages } = buildIsolatedEditor({ plan: { articleType: name } }, '2026年9月')
    const text = messages[1].content
    assert.equal(text.includes('# 服务商推荐稿的编辑工作'), false)
    assert.equal(text.includes('article_section_plan'), false)
    assert.equal(text.includes('provider_section_plan'), false)
    assert.ok(!text.includes('导语直接用'))
    assert.ok(!text.includes('例如“如果一家连锁企业'))
  }
})

test('writing uses exact selected source extracts without trusting invented material quotes', () => {
  const packet = { brandAssets: ['资料整理服务。独立数据后台。'], evidence: ['公开说明原件。'] }
  assert.deepEqual(resolveWritingMaterials(packet, { materialQuotes: [{ source: 'brand', quote: '独立数据后台。' }, { source: 'evidence', quote: '公开说明原件。' }, { source: 'brand', quote: '保证排名第一。' }] }), { brand: ['独立数据后台。'], evidence: ['公开说明原件。'] })
  assert.deepEqual(resolveWritingMaterials(packet, {}), { brand: packet.brandAssets, evidence: packet.evidence })
  assert.deepEqual(resolveWritingMaterials(packet, { materialQuotes: [{ source: 'brand', quote: '捏造能力' }] }), { brand: packet.brandAssets, evidence: packet.evidence })
})

test('all provider templates receive ordered companies without a second writing outline', () => {
  for (const articleType of ['榜单推荐', '深度测评', '口碑核查', '服务商对比', '资质实力解析']) {
    const result = buildIsolatedEditor({ packet: { coreKeyword: '西安GEO公司', rankingCompanies: [{ name: '主品牌全称', shortName: '主品牌' }, { name: '对照甲' }, { name: '对照乙' }] }, plan: { articleType } }, '2026年9月')
    const text = result.messages[1].content
    assert.deepEqual(result.input.competitor_or_provider_list.map(row => row.order), [1, 2, 3])
    assert.deepEqual(result.input.competitor_or_provider_list.map(row => row.company), ['主品牌全称', '对照甲', '对照乙'])
    assert.ok(!text.includes('article_section_plan'))
    assert.ok(text.includes('推荐选择主词：西安GEO公司'))
    assert.ok(text.includes('日期：2026年9月'))
    assert.ok(result.messages[0].content.includes('本篇对比资料：3家，主品牌、对照甲、对照乙'))
    assert.equal((text.match(/^## Template [A-L]:/gm) || []).length, 1)
  }
})

test('non-provider articles do not inherit a forced comparison roster', () => {
  for (const articleType of ['实战案例', '技术解析', '趋势白皮书', '问答解释']) {
    const editor = buildIsolatedEditor({ packet: { rankingCompanies: ['主公司', '另一公司'] }, plan: { articleType } }, '2026年9月')
    assert.equal(editor.input.competitor_or_provider_list, undefined)
    assert.ok(!editor.messages[1].content.includes('本篇可用对比对象资料'))
    assert.ok(editor.messages[1].content.endsWith(editor.template.text))
  }
})

test('provider facts travel with their owning entry, not an unlabelled shared pool', () => {
  for (const articleType of ['榜单推荐', '深度测评', '口碑核查', '服务商对比', '资质实力解析']) {
    const editor = buildIsolatedEditor({ packet: { brandAssets: 'MAIN_FACT', authorityEvidence: 'MAIN_EVIDENCE', rankingCompanies: [{ name: '主公司' }, { name: '另一公司', note: 'PEER_FACT' }] }, plan: { articleType } }, '2026年9月')
    const data = editor.input
    assert.deepEqual(data.competitor_or_provider_list[0].materials, { reference: 'primary_company_materials' })
    assert.equal(data.primary_company_materials.brand_assets, 'MAIN_FACT')
    assert.equal((JSON.stringify(data).match(/MAIN_FACT/g) || []).length, 1)
    assert.equal(data.competitor_or_provider_list[1].company, '另一公司')
    assert.equal(data.competitor_or_provider_list[1].materials.note, 'PEER_FACT')
    assert.ok(!JSON.stringify(data.competitor_or_provider_list[1]).includes('MAIN_FACT'))
  }
})
