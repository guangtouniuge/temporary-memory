import { normalizePricing, validMultiplier } from './billing-pricing.mjs'
const limitKeys = ['agents', 'projects', 'storageMB', 'publishingAccounts', 'keywords', 'questionsPerKeyword', 'articles', 'publications', 'verificationCalls']
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max)
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const providerKeys = ['textModel', 'imageModel', 'keywordModel', 'xiaoqingwa']
const providerLabels = { textModel: '文字模型', imageModel: '图片模型', keywordModel: '关键词模型', xiaoqingwa: '小青蛙接口' }
const integer = value => {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || value < 0) fail(400, '额度需为非负整数或不限')
  return value
}
const secretValue = value => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw === '__KEEP__') return raw
  if (raw.length > 5000) fail(400, '接口密钥过长')
  return raw
}
const endpointValue = value => {
  const raw = text(value, 1000)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail(400, '接口地址无效')
  } catch { fail(400, '接口地址无效') }
  return raw
}
const modelConfig = (input = {}, previous = {}) => ({
  enabled: Boolean(input.enabled),
  name: text(input.name, 120),
  baseUrl: input.baseUrl ? endpointValue(input.baseUrl) : '',
  model: text(input.model, 160),
  apiKey: secretValue(input.apiKey) === '__KEEP__' ? previous.apiKey || '' : secretValue(input.apiKey),
  notes: text(input.notes, 1000),
})
const publicProviderConfig = (config = {}) => Object.fromEntries(providerKeys.map(key => {
  const row = config[key] || {}
  return [key, { ...row, apiKey: row.apiKey ? '已保存' : '', hasKey: Boolean(row.apiKey), label: providerLabels[key] }]
}))
const providerConfigComplete = row => Boolean(row?.enabled && row?.baseUrl && row?.model && row?.apiKey)
const providerSummary = (config = {}) => Object.fromEntries(providerKeys.map(key => [key, providerConfigComplete(config[key])]))
export function platformAdmin({ db, save, actor, path, method, body = {} }) {
  const state = db.platformAdmin ||= { revision: 0, settings: { siteName: '曝光率GEO自研系统', filing: '', seoTitle: '', seoKeywords: '', seoDescription: '', retentionDays: null, taskSize: 100 }, rates: [], policies: {}, applications: [], audit: [] }
  state.pricing = normalizePricing(state.pricing)
  state.providerConfigs ||= { platform: {} }
  const audit = (action, target) => { state.audit.push({ id: crypto.randomUUID(), action, target, actorId: actor.management?.actorId || actor.id, effectiveActorId: actor.id, at: new Date().toISOString() }) }
  const commit = () => { state.revision++; save() }
  if (path === '/api/admin/platform/provider-config') {
    if (!['super_admin', 'agent'].includes(actor.role)) fail(403, '仅总后台和代理可管理接口配置')
    const targetId = actor.role === 'super_admin' ? text(body.targetId || 'platform', 100) : actor.id
    if (actor.role === 'super_admin' && targetId !== 'platform' && !db.users.some(u => u.id === targetId && u.role === 'agent' && !u.deletedAt)) fail(404, '代理不存在')
    if (method === 'GET') {
      const inherited = targetId === 'platform' ? null : state.providerConfigs.platform || {}
      return { revision: state.revision, targetId, providerConfig: publicProviderConfig(state.providerConfigs[targetId] || {}), inherited: inherited ? publicProviderConfig(inherited) : null, summary: providerSummary(state.providerConfigs[targetId] || {}) }
    }
    if (method !== 'POST') fail(404, '接口不存在')
    if (body.revision !== state.revision) fail(409, '配置已更新，请刷新后再保存')
    const current = state.providerConfigs[targetId] || {}
    const next = {}
    for (const key of providerKeys) next[key] = modelConfig(body.providerConfig?.[key] || {}, current[key] || {})
    state.providerConfigs[targetId] = next
    audit('provider.configure', targetId); commit()
    const inherited = targetId === 'platform' ? null : state.providerConfigs.platform || {}
    return { revision: state.revision, targetId, providerConfig: publicProviderConfig(next), inherited: inherited ? publicProviderConfig(inherited) : null, summary: providerSummary(next) }
  }
  if (path === '/api/admin/platform/verification') {
    if (method === 'GET') return { applications: state.applications.filter(a => actor.role === 'super_admin' || (actor.role === 'agent' ? a.agentId === actor.agentId : a.projectId === actor.projectId)), revision: state.revision }
    if (method === 'POST') {
      if (actor.role !== 'super_admin') fail(403, '仅总后台可审核认证')
      const application = state.applications.find(a => a.id === body.id)
      if (!application) fail(404, '申请不存在')
      if (application.status !== 'pending') fail(409, '此申请已处理，请刷新')
      if (!['approved', 'returned'].includes(body.status) || !text(body.reason)) fail(400, '请选择审核结果并填写意见')
      Object.assign(application, { status: body.status, reason: text(body.reason, 1000), reviewedAt: new Date().toISOString(), reviewerId: actor.id })
      audit('verification.' + body.status, application.id); commit()
      return { applications: state.applications, revision: state.revision }
    }
  }
  if (actor.role !== 'super_admin') fail(403, '仅总后台可管理平台配置')
  if (path === '/api/admin/platform' && method === 'GET') return { ...state, providerConfigs: undefined, providerSummary: Object.fromEntries(Object.entries(state.providerConfigs).map(([id, config]) => [id, providerSummary(config)])), capabilities: { charging: false, quotaEnforcement: false, verificationUpload: false, customProviderRouting: true } }
  if (method !== 'POST') fail(404, '接口不存在')
  if (body.revision !== state.revision) fail(409, '配置已更新，请刷新后再保存')
  if (path === '/api/admin/platform/settings') {
    const s = body.settings || {}
    if (!text(s.siteName)) fail(400, '请填写站点名称')
    state.settings = { siteName: text(s.siteName), filing: text(s.filing), seoTitle: text(s.seoTitle), seoKeywords: text(s.seoKeywords, 1000), seoDescription: text(s.seoDescription, 2000), retentionDays: integer(s.retentionDays), taskSize: integer(s.taskSize) }
    audit('settings.update', 'platform')
  } else if (path === '/api/admin/platform/rates') {
    if (!Array.isArray(body.rates) || body.rates.length > 30) fail(400, '计费项目无效')
    const names = new Set()
    state.rates = body.rates.map(r => {
      if (!['distill', 'write', 'publish', 'research', 'diagnose', 'video'].includes(r.key) || names.has(r.key) || !['points', 'money'].includes(r.currency)) fail(400, '计费项目或单位无效')
      names.add(r.key)
      if (!Number.isFinite(r.amount) || r.amount < 0 || r.amount > 1000000) fail(400, '价格无效')
      return { key: r.key, currency: r.currency, amount: Math.round(r.amount * 100) / 100 }
    })
    audit('rates.configure', 'platform')
  } else if (path === '/api/admin/platform/pricing') {
    state.pricing = normalizePricing(body.pricing || {})
    audit('pricing.configure', 'platform')
  } else if (path === '/api/admin/platform/policy') {
    const target = db.users.find(u => u.id === body.userId && !u.deletedAt && ['agent', 'project_admin'].includes(u.role))
    if (!target) fail(404, '代理或企业账户不存在')
    const p = body.policy || {}
    if (p.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(p.expiresAt)) fail(400, '到期日期无效')
    const markup = validMultiplier(p.mediaMarkup)
    if (markup === null) fail(400, '加价倍数需为1至100')
    state.policies[target.id] = { limits: Object.fromEntries(limitKeys.map(k => [k, integer(p.limits?.[k] ?? null)])), mediaMarkup: markup, modelMode: p.modelMode === 'custom' ? 'custom' : 'inherit', providerMode: p.providerMode === 'custom' ? 'custom' : 'inherit', keywordMode: p.keywordMode === 'custom' ? 'custom' : 'inherit', imageMode: p.imageMode === 'custom' ? 'custom' : 'inherit', xiaoqingwaMode: p.xiaoqingwaMode === 'custom' ? 'custom' : 'inherit', manualCheck: Boolean(p.manualCheck), expiresAt: text(p.expiresAt, 10), notes: text(p.notes, 1000) }
    target.displayName = text(body.displayName || target.displayName)
    audit('policy.configure', target.id)
  } else fail(404, '接口不存在')
  commit()
  return { ...state, capabilities: { charging: false, quotaEnforcement: false, verificationUpload: false, customProviderRouting: false } }
}
