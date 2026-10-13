import test from 'node:test'
import assert from 'node:assert/strict'
import { markedUpCents, priceMedia } from './billing-pricing.mjs'

test('media price markup is applied in sequence and rounded up to yuan', () => {
  assert.equal(markedUpCents(80, [1]), 80)
  assert.equal(markedUpCents(200, [1.1]), 300)
  assert.equal(markedUpCents(200, [1.1, 1.2]), 300)
  assert.equal(markedUpCents(990, [1.1]), 1100)
  const resource = priceMedia({ resource_id: 'm1', title: '媒体', priceCents: 200 }, 'news2', {
    platform: { news2: 1.1 },
    agentMarkup: 1.2,
    accountMarkup: 1,
  })
  assert.equal(resource.basePriceCents, 200)
  assert.equal(resource.priceCents, 300)
  assert.equal(resource.price, '3.00')
  assert.equal(resource.pricing.platformMarkup, 1.1)
})
