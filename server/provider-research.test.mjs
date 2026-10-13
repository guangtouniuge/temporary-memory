import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeResearch, researchProvider, readProviderResearch, enrichProviderMaterials } from './provider-research.mjs'
import { runInProjectScope, validateGenerationScope } from './project-scope.mjs'
import { buildIsolatedEditor } from './skill-editor.mjs'
import { understandProject } from './agents-workflow.mjs'

const response = (identityMatched = true) => ({ output: {
  search_info: { search_results: [{ index: 1, url: 'https://example.com/about', title: '企业公开资料' }] },
  choices: [{ message: { content: JSON.stringify({ identityMatched, facts: [
    { text: '提供驻场服务', category:'服务内容', sourceIndex: 1, sourceType: '企业官网' },
    { text: '无来源不能使用', sourceIndex: 99 },
  ] }) } }],
} })
test('automatic peer research is scoped, checkpointed, reused and never replaces the primary brand', async () => {
  const payload = { project: { name: '项目', brand: '主公司' }, packet: { rankingCompanies: [{ name: '主公司' }, { name: '同行' }] } }
  const state = {}, calls = []
  const options = { state, researchProvider: async input => { calls.push(input.company); return normalizeResearch(response(), input.company) }, save: async () => {} }
  const first = await enrichProviderMaterials(payload, options)
  const again = await enrichProviderMaterials(payload, options)
  assert.deepEqual(calls, ['同行'])
  assert.equal(first.packet.rankingCompanies[0].publicResearch, undefined)
  assert.equal(again.packet.rankingCompanies[1].publicResearch.facts.length, 1)
  assert.equal(payload.packet.rankingCompanies[1].publicResearch, undefined)
  await enrichProviderMaterials({ ...payload, project: { ...payload.project, name: '另一项目' } }, options)
  assert.equal(calls.length, 2)
})
test('failed or mismatched research never blocks generation or invents peer facts', async () => {
  const payload = { project: { name: '项目' }, packet: { rankingCompanies: [{ name: '项目' }, { name: '同行' }] } }
  const state = {}; let calls = 0
  const options = { state, researchProvider: async () => { calls++; throw new Error('timeout') } }
  assert.deepEqual(await enrichProviderMaterials(payload, options), payload)
  await enrichProviderMaterials(payload, options)
  assert.equal(calls, 1)
  assert.equal(Object.values(state.providerResearch)[0].status, 'unconfirmed')
  const result = await enrichProviderMaterials(payload, { state: {}, researchProvider: async () => normalizeResearch(response(), '错误主体') })
  assert.equal(result.packet.rankingCompanies[1].publicResearch, undefined)
})
test('project understanding receives researched facts and checkpoints them without extra model stages', async () => {
  const payload = { project: { name: '项目', brand: '主公司' }, packet: { rankingCompanies: [{ name: '主公司' }, { name: '同行' }] } }
  const state = {}; let calls = 0, searches = 0
  const options = { state, researchProvider: async ({ company }) => { searches++; return normalizeResearch(response(), company) }, callModel: async messages => {
    calls++
    const input = JSON.parse(messages[1].content)
    assert.equal(input.providers[1].publicResearch.facts[0].text, '提供驻场服务')
    return { ok: true, content: JSON.stringify({ positioning: '服务选择', advantages: [] }) }
  } }
  await understandProject(payload, options)
  await understandProject(payload, options)
  assert.equal(searches, 1); assert.equal(calls, 1)
})
test('facts require returned search sources and resolved company identity', () => {
  const result = normalizeResearch(response(), '同行')
  assert.equal(result.facts.length, 1)
  assert.equal(result.facts[0].sourceType, '企业官网')
  assert.equal(normalizeResearch(response(false), '同行').status, 'unconfirmed')
  assert.equal(readProviderResearch(['bad']), null)
})
test('search API enables actual retrieval and distinguishes configuration or API failure', async () => {
  const env = { QWEN_API_KEY: 'test-key' }
  const result = await researchProvider({ company: '同行' }, { env, fetchImpl: async (_, request) => {
    const body = JSON.parse(request.body)
    assert.equal(body.parameters.search_options.forced_search, true)
    assert.equal(body.parameters.search_options.enable_source, true)
    return { ok: true, json: async () => response() }
  } })
  assert.equal(result.status, 'ready')
  await assert.rejects(researchProvider({ company: '同行' }, { env: {} }), /未配置/)
  await assert.rejects(researchProvider({ company: '同行' }, { env, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ code: 'RateLimit' }) }) }), /RateLimit/)
})
test('stored peer sources reach isolated writing inputs under their own company', () => runInProjectScope({ projectId: 'test-project' }, () => {
  const profile = normalizeResearch(response(), '同行')
  const state = {
    'geo.projectRows': [{ name: '项目', brand: '主公司', coreKeyword: '咨询公司' }],
    'geo.rankingCandidateRows': [['项目', '同行', '', '', '', '', '否', '', JSON.stringify(profile)]],
  }
  const payload = validateGenerationScope({ project: { name: '项目' }, plan: { articleType: '榜单推荐' } }, key => state[key] || [])
  const { input } = buildIsolatedEditor(payload, '2026年9月')
  assert.equal(input.recommended_company, '主公司')
  assert.equal(input.competitor_or_provider_list[1].materials.publicResearch.facts[0].source.url, 'https://example.com/about')
  assert.equal(input.competitor_or_provider_list[0].materials.publicResearch, undefined)
}))
