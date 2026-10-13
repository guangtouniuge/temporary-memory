import test from 'node:test'
import assert from 'node:assert/strict'
import { modelResponseFailure } from './model-response.mjs'

test('missing, malformed, whitespace and reasoning-only replies are retryable failures', () => {
  for (const data of [{}, null, { choices: [] }, { choices: [{ message: { content: '  ' } }] }, { choices: [{ message: { reasoning_content: 'private reasoning' } }] }]) {
    assert.equal(modelResponseFailure(data).retryable, true)
  }
})

test('normal content succeeds; length and refusal are not retried blindly', () => {
  assert.equal(modelResponseFailure({ choices: [{ message: { content: '正文' }, finish_reason: 'stop' }] }), null)
  for (const reason of ['length', 'content_filter']) {
    assert.equal(modelResponseFailure({ choices: [{ finish_reason: reason, message: { content: 'partial' } }] }).retryable, false)
  }
  assert.equal(modelResponseFailure({ choices: [{ message: { refusal: 'no' } }] }).retryable, false)
})
