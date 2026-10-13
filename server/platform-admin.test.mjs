import test from 'node:test'
import assert from 'node:assert/strict'
import { platformAdmin } from './platform-admin.mjs'

test('platform configuration is admin-only, revisioned and persists zero versus unlimited', () => {
  const db = { users: [{ id: 'a', role: 'agent', displayName: 'Agent' }] }
  let saves = 0
  const call = (path, body, actor = { id: 'root', role: 'super_admin' }) => platformAdmin({ db, save: () => saves++, actor, path: '/api/admin/platform' + path, method: body ? 'POST' : 'GET', body })
  assert.throws(() => call('', undefined, { id: 'a', role: 'agent' }), /仅总后台/)
  assert.equal(call('').revision, 0)
  const result = call('/policy', { revision: 0, userId: 'a', policy: { limits: { articles: 0, projects: 10, storageMB: null }, mediaMarkup: 1.5 } })
  assert.equal(result.policies.a.limits.articles, 0)
  assert.equal(result.policies.a.limits.storageMB, null)
  assert.equal(result.policies.a.limits.projects, 10)
  assert.equal(result.audit[0].actorId, 'root')
  assert.equal(saves, 1)
  assert.throws(() => call('/policy', { revision: 0, userId: 'a' }), /配置已更新/)
  assert.throws(() => call('/rates', { revision: 1, rates: [{ key: 'write', currency: 'points', amount: -1 }] }), /价格无效/)
  assert.equal(saves, 1)
  assert.equal(result.capabilities.charging, false)
})

test('verification applications stay in scope and cannot be approved twice', () => {
  const db = { users: [] }
  const args = { db, save() {}, path: '/api/admin/platform', method: 'GET', actor: { id: 'root', role: 'super_admin' } }
  platformAdmin(args)
  db.platformAdmin.applications = [{ id: 'v', projectId: 'p', agentId: 'a', status: 'pending' }]
  const read = actor => platformAdmin({ ...args, path: '/api/admin/platform/verification', actor })
  assert.equal(read({ role: 'agent', agentId: 'b' }).applications.length, 0)
  assert.equal(read({ role: 'project_admin', projectId: 'p' }).applications.length, 1)
  const review = { ...args, path: '/api/admin/platform/verification', method: 'POST', body: { id: 'v', status: 'returned', reason: '请补充材料' } }
  platformAdmin(review)
  assert.throws(() => platformAdmin(review), /已处理/)
})

test('provider configs support platform defaults and agent-owned secrets without echoing keys', () => {
  const db = { users: [{ id: 'agent-1', role: 'agent', displayName: 'Agent' }] }
  let saves = 0
  const admin = { id: 'root', role: 'super_admin' }
  const agent = { id: 'agent-1', role: 'agent', agentId: 'a' }
  const call = (actor, method, body = {}) => platformAdmin({ db, save: () => saves++, actor, path: '/api/admin/platform/provider-config', method, body })
  const platform = call(admin, 'POST', { revision: 0, providerConfig: { textModel: { enabled: true, name: '平台模型', baseUrl: 'https://api.example.com/v1/chat/completions', model: 'deepseek-chat', apiKey: 'platform-secret' } } })
  assert.equal(platform.providerConfig.textModel.apiKey, '已保存')
  assert.equal(platform.providerConfig.textModel.hasKey, true)
  assert.equal(db.platformAdmin.providerConfigs.platform.textModel.apiKey, 'platform-secret')
  const inherited = call(agent, 'GET')
  assert.equal(inherited.inherited.textModel.hasKey, true)
  const custom = call(agent, 'POST', { revision: inherited.revision, providerConfig: { textModel: { enabled: true, name: '代理模型', baseUrl: 'https://agent.example.com/v1/chat/completions', model: 'agent-model', apiKey: 'agent-secret' } } })
  assert.equal(custom.providerConfig.textModel.apiKey, '已保存')
  assert.equal(db.platformAdmin.providerConfigs['agent-1'].textModel.apiKey, 'agent-secret')
  const kept = call(agent, 'POST', { revision: custom.revision, providerConfig: { textModel: { enabled: true, name: '代理模型2', baseUrl: 'https://agent.example.com/v1/chat/completions', model: 'agent-model', apiKey: '__KEEP__' } } })
  assert.equal(db.platformAdmin.providerConfigs['agent-1'].textModel.apiKey, 'agent-secret')
  assert.equal(kept.providerConfig.textModel.name, '代理模型2')
  assert.equal(saves, 3)
})
