import test from 'node:test'
import assert from 'node:assert/strict'
import { runInProjectScope, validateGenerationScope } from './project-scope.mjs'
import { getUnderstanding, storeUnderstanding } from './project-understanding.mjs'
import { understandProject } from './agents-workflow.mjs'

const project = { name: '咨询品牌', brand: '咨询公司', industry: '管理咨询', coreKeyword: '民企咨询公司' }
const state = {
  'geo.projectRows': [project],
  'geo.keywordLibraryRows': [[project.name,project.coreKeyword,'工厂管理咨询','场景业务词','已启用']],
  'geo.knowledgeRows': [[project.name, '连锁资料'], [project.name, '工厂资料']],
  'geo.knowledgeContentRows': [
    [project.name, '连锁资料', '连锁案例', '支持门店经营诊断', '客户提供的连锁案例'],
    [project.name, '工厂资料', '工厂案例', '支持工厂成本分析', '客户提供的工厂案例'],
    [project.name, '工厂资料', '空记录', '', ''],
    ['其他品牌', '工厂资料', '外部资料', '不能混入', '不能混入'],
  ],
}
const scope = callback => runInProjectScope({ projectId: 'legacy', legacy: true }, callback)
const input = (knowledge = '') => scope(() => validateGenerationScope({ project, packet: { brandAssets: ['伪造资料'], selectedPains: '固定痛点' }, task: { knowledge, articleType: '', writingSceneMode: '按实际场景写' } }, key => state[key]))

test('selected library replaces caller facts, empty selection combines owned libraries only', () => {
  const selected = input('工厂资料')
  assert.deepEqual(selected.packet.brandAssets, ['工厂案例：支持工厂成本分析'])
  assert.deepEqual(selected.packet.authorityEvidence, ['工厂案例：客户提供的工厂案例'])
  assert.equal(selected.packet.selectedPains, undefined)
  assert.equal(selected.packet.articleType, '')
  assert.equal(selected.packet.writingSceneMode, '按实际场景写')
  assert.equal(input().packet.brandAssets.length, 2)
  assert.throws(() => input('已删除的库'), /知识库不存在/)
})

test('understanding follows project and source scope; changed facts invalidate cached profile', () => {
  const factory = input('工厂资料')
  const chain = input('连锁资料')
  let rows = storeUnderstanding(factory, { positioning: '工厂管理咨询' }, [], '重点面向成长型民企')
  rows = storeUnderstanding(chain, { positioning: '连锁经营咨询' }, rows)
  assert.equal(rows.length, 2)
  assert.equal(getUnderstanding(factory, rows).record.notes, '重点面向成长型民企')
  const changed = { ...factory, packet: { ...factory.packet, brandAssets: ['已更新的工厂资料'] } }
  assert.equal(getUnderstanding(changed, rows).stale, true)
  assert.equal(getUnderstanding(changed, rows).record, null)
  assert.equal(getUnderstanding({ ...factory, project: { ...project, name: '其他品牌' } }, rows).previous, null)
})

test('stored project understanding reaches writing without another model call; corrections reach fresh analysis', async () => {
  const payload = input('工厂资料')
  const state = { stages: {} }
  const reused = await understandProject({ ...payload, projectUnderstanding: { positioning: '工厂管理咨询', advantages: [] }, understandingNotes: '突出成长型客户' }, {
    state, callModel: () => { throw new Error('must not call model') },
  })
  assert.equal(reused.projectClarifications, '突出成长型客户')
  assert.equal(Object.values(state.stages)[0].origin, 'project-profile')
  let saved
  const fresh = await understandProject({ ...payload, understandingNotes: '面向工厂经营者' }, {
    onUnderstanding: (_payload, value) => { saved = value },
    callModel: async messages => {
      assert.match(messages[1].content, /面向工厂经营者/)
      return { ok: true, content: JSON.stringify({ positioning: '工厂咨询', advantages: [{ source: 'brand', quote: '支持工厂成本分析', capability: '成本分析' }] }) }
    },
  })
  assert.equal(fresh.projectClarifications, '面向工厂经营者')
  assert.equal(saved.advantages.length, 1)
})
