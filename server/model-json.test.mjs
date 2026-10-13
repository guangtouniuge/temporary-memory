import test from 'node:test'
import assert from 'node:assert/strict'
import { parseModelJson } from './model-json.mjs'

test('repair missing object delimiter inside a complete editorial handoff without changing text', () => {
  const source = '{"thicknessPlan":{"develop":[{"point":"适配边界","why":"不能替代专项意见。"],"briefly":["合作清单"]},"title":"原标题"}'
  let repairs = 0
  assert.deepEqual(parseModelJson(source, () => repairs++), { thicknessPlan: { develop: [{ point: '适配边界', why: '不能替代专项意见。' }], briefly: ['合作清单'] }, title: '原标题' })
  assert.equal(repairs, 1)
})

test('valid JSON stays exact; missing comma may be inserted outside strings', () => {
  assert.deepEqual(parseModelJson('{"text":"} ] , \\\"原文","amount":19}'), { text: '} ] , "原文', amount: 19 })
  assert.deepEqual(parseModelJson('{"title":"保留" "units":[]}'), { title: '保留', units: [] })
})

test('never repair truncated output, missing values, changed strings or discarded characters', () => {
  for (const source of ['{"title":"未完', '{"title":}', '{"a":True}', '{title:"文字"}', '{"a":1,}', '{"title":"说"你好""}', '```json\n{"a":1}\n```']) {
    assert.throws(() => parseModelJson(source), undefined, source)
  }
})
