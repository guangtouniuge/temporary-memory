export const defaultPricing = () => ({
  mediaMarkup: { news: 1, news2: 1, social: 1, b2b: 1 },
  articlePointCost: 1,
  publicationPointCost: 0,
})

export function validMultiplier(value) {
  const number = Number(value ?? 1)
  if (!Number.isFinite(number) || number < 1 || number > 100) return null
  return Math.round(number * 1000) / 1000
}

export function normalizePricing(value = {}) {
  const fallback = defaultPricing()
  const media = value.mediaMarkup || {}
  const mediaMarkup = Object.fromEntries(Object.keys(fallback.mediaMarkup).map(key => [key, validMultiplier(media[key]) ?? fallback.mediaMarkup[key]]))
  const articlePointCost = Number(value.articlePointCost ?? fallback.articlePointCost)
  const publicationPointCost = Number(value.publicationPointCost ?? fallback.publicationPointCost)
  return {
    mediaMarkup,
    articlePointCost: Number.isFinite(articlePointCost) && articlePointCost >= 0 ? Math.round(articlePointCost * 100) / 100 : fallback.articlePointCost,
    publicationPointCost: Number.isFinite(publicationPointCost) && publicationPointCost >= 0 ? Math.round(publicationPointCost * 100) / 100 : fallback.publicationPointCost,
  }
}

export function markedUpCents(baseCents, multipliers = []) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0))
  if (!base) return 0
  const normalized = multipliers.map(multiplier => validMultiplier(multiplier) ?? 1)
  if (normalized.every(multiplier => multiplier === 1)) return base
  const total = normalized.reduce((value, multiplier) => value * multiplier, base)
  return Math.ceil(total / 100) * 100
}

export function priceMedia(resource, channel, policy = {}) {
  const basePriceCents = Number(resource.basePriceCents ?? resource.priceCents ?? 0)
  const platformMarkup = validMultiplier(policy.platform?.[channel]) ?? 1
  const accountMarkup = validMultiplier(policy.accountMarkup) ?? 1
  const agentMarkup = validMultiplier(policy.agentMarkup) ?? 1
  const priceCents = markedUpCents(basePriceCents, [platformMarkup, agentMarkup, accountMarkup])
  return { ...resource, basePriceCents, priceCents, price: (priceCents / 100).toFixed(2), pricing: { platformMarkup, agentMarkup, accountMarkup, rounded: 'ceil-yuan' } }
}
