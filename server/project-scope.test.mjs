import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { runInProjectScope, currentProjectScope, resolveCurrentUser, validateGenerationScope } from './project-scope.mjs'

test('temporary identity bridge rejects malformed identity; legacy remains explicit', () => {
  assert.equal(resolveCurrentUser({ headers: {} }), null)
  assert.throws(() => resolveCurrentUser({ headers: { 'x-geo-role': 'unknown' } }))
})

test('concurrent async work retains the starting project', async () => {
  const results = await Promise.all(['a', 'b'].map(projectId => runInProjectScope({ projectId }, async () => {
    await delay(projectId === 'a' ? 15 : 1)
    return currentProjectScope().projectId
  })))
  assert.deepEqual(results, ['a', 'b'])
})

test('generation replaces caller material with current project brand records', () => {
  runInProjectScope({ projectId: 'a' }, () => {
    const state = {
      'geo.projectRows': [{ name: 'Brand A', coreKeyword: 'core', projectId: 'a' }],
      'geo.knowledgeContentRows': [['Brand A', 'kb', 'intro', 'own assets', 'own evidence'], ['Brand B', 'kb', 'intro', 'foreign', 'foreign']],
      'geo.keywordRows': [['Brand A', 'core']],
      'geo.questionRows': [['Brand A', 'core', 'own question', '', ''], ['core', 'legacy question']],
    }
    const payload = validateGenerationScope({ project: { name: 'Brand A' }, packet: { brandAssets: ['foreign injected'] }, plan: { title: 'Stable title' } }, key => state[key])
    assert.deepEqual(payload.packet.brandAssets, ['intro：own assets'])
    assert.deepEqual(payload.packet.questions, ['own question'])
    assert.equal(payload.plan.title, 'Stable title')
    assert.throws(() => validateGenerationScope({ project: { name: 'Brand B' } }, key => state[key]))
  })
})

test('HTTP isolation: state, summaries, generation jobs, gallery, export and anonymous access', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'geoskill-scope-'))
  const apiFile = resolve(dirname(fileURLToPath(import.meta.url)), 'geo-api-server.mjs')
  mkdirSync(resolve(dir, 'outputs/data'), { recursive: true })
  mkdirSync(resolve(dir, 'outputs/auth'), { recursive: true })
  const users=['a','b'].map(id=>({id:`user-${id}`,username:`test-${id}`,role:'project_admin',projectId:id,agentId:`agent-${id}`,status:'active'}))
  writeFileSync(resolve(dir,'outputs/auth/accounts.json'),JSON.stringify({version:1,users,sessions:[]}))
  const {createMemberLedger}=await import('./member-ledger.mjs')
  const ledger=createMemberLedger(resolve(dir,'outputs/auth/member-ledger.sqlite'))
  for(const u of users)for(const resource of ['projects','keywords','storageMB'])ledger.handle({actor:{id:'root',role:'super_admin'},users,path:'/api/admin/members/adjust',method:'POST',body:{userId:u.id,resource,delta:20,expectedAvailable:0,requestId:`fund-${u.id}-${resource}`,reason:'isolation fixture'}})
  ledger.close()
  writeFileSync(resolve(dir, 'outputs/data/project-accounts.json'), JSON.stringify([
    { projectId: 'a', agentId: 'agent-a', projectName: 'Project A', status: 'active' },
    { projectId: 'b', agentId: 'agent-b', projectName: 'Project B', status: 'active' },
  ]))
  const port = 19000 + Math.floor(Math.random() * 10000)
  const child = spawn(process.execPath, [apiFile], { cwd: dir, env: { ...process.env, GEO_JOB_DIR:resolve(dir,'jobs'), GEO_API_PORT: String(port), GEO_ALLOW_HEADER_IDENTITY: 'true', GEO_ALLOW_LEGACY_ANONYMOUS: 'false', QWEN_API_KEY: '', DASHSCOPE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exit = once(child, 'exit')
  try {
    await Promise.race([once(child.stdout, 'data'), delay(8000).then(() => { throw new Error('API startup timed out') })])
    const headers = (projectId, role = 'project_admin', agentId = `agent-${projectId}`) => ({ 'x-geo-user-id': `user-${projectId}`, 'x-geo-role': role, 'x-geo-agent-id': agentId, 'x-geo-project-id': projectId })
    const request = async (path, projectId, body, extraHeaders) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { ...(projectId ? headers(projectId) : {}), ...extraHeaders, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    const save = async (projectId, key, value) => {
      const result = await request('/api/state', projectId, { key, value })
      assert.equal(result.status, 200, await result.text())
    }
    for (const project of ['a', 'b']) {
      await save(project, 'geo.projectRows', [{ name: 'Same brand', coreKeyword: 'Same core' }])
      await save(project, 'geo.articleRows', [{ id: `article-${project}`, project: 'Same brand', title: `Title ${project}`, body: `Secret ${project}`, status: '已生成' }])
      for (const key of ['keywordRows', 'keywordLibraryRows', 'questionRows', 'knowledgeRows', 'knowledgeContentRows', 'rankingCandidateRows', 'industrySceneRows']) {
        await save(project, `geo.${key}`, [['Same brand', `secret-${project}`]])
      }
    }
    const a = await (await request('/api/state?key=geo.articleRows', 'a')).json()
    assert.equal(a.value.length, 1)
    assert.equal(a.value[0].body, 'Secret a')
    assert.equal(a.value[0].projectId, 'a')
    const mediaDraft = { brand: 'Same brand', channel: 'news', articles: [{ id: 'article-a', title: 'Title a', body: 'Secret a' }], resources: [{ resource_id: 7, title: 'Media', price: '10' }], allocations: [{ resourceId: 7, articleIds: ['article-a'] }] }
    const savedMedia = await request('/api/media/drafts', 'a', mediaDraft)
    assert.equal(savedMedia.status, 201)
    assert.deepEqual((await savedMedia.json()).draft.allocations, mediaDraft.allocations)
    assert.equal((await request('/api/media/drafts', 'a', { ...mediaDraft, allocations: [{ resourceId: 7, articleIds: ['article-b'] }] })).status, 400)
    assert.equal((await request('/api/media/drafts', 'a', { ...mediaDraft, allocations: [{ resourceId: 8, articleIds: ['article-a'] }] })).status, 400)
    assert.equal((await request('/api/state', 'a', { key: 'geo.articleRows', value: [{ projectId: 'b' }] })).status, 403)
    assert.equal((await request('/api/state?key=global')).status, 401)
    assert.equal((await request('/api/state?key=global', 'a')).status, 400)
    assert.equal((await request('/api/state?key=geo.articleRows', 'b', undefined, headers('b', 'agent', 'agent-a'))).status, 403)
    const agentSummary = await (await request('/api/projects/summary', 'a', undefined, headers('a', 'agent'))).json()
    assert.deepEqual(agentSummary.projects.map(row => row.projectId), ['a'])
    const adminSummary = await (await request('/api/projects/summary', 'a', undefined, headers('a', 'super_admin'))).json()
    assert.equal(adminSummary.projects.length, 2)
    assert.equal((await request('/api/articles/generate', 'a', { project: { name: 'Foreign brand' }, plan: { title: 'test' } })).status, 400)
    const understandingUrl = '/api/projects/understanding?project=Same%20brand'
    const profile = await (await request(understandingUrl, 'a')).json()
    assert.equal(profile.record, null)
    await save('a', 'geo.projectUnderstandingRows', [{ project: 'Same brand', knowledgeName: '', sourceHash: profile.sourceHash, value: { positioning: 'Private A', advantages: [] }, notes: '' }])
    assert.equal((await (await request(understandingUrl, 'a')).json()).record.value.positioning, 'Private A')
    assert.equal((await (await request(understandingUrl, 'b')).json()).record, null)
    assert.equal((await request('/api/projects/understanding', 'a', { projectName: 'Same brand', action: 'notes', sourceHash: profile.sourceHash, notes: 'Focus A' })).status, 200)
    assert.equal((await request('/api/projects/understanding', 'a', { projectName: 'Same brand', action: 'notes', sourceHash: 'stale', notes: 'Wrong revision' })).status, 409)
    assert.equal((await request('/api/projects/understanding?project=Foreign', 'a')).status, 400)
    // Header-only test identities cannot start paid jobs without a billing account.
    for(const [id,projectId,jobProject,status,expected] of [['foreign','b','Same brand','done',403],['brand','a','Other brand','done',403],['running','a','Same brand','running',409]]) {
      const job={id:`JOB-restart-${id}`,projectId,jobProject,status}
      writeFileSync(resolve(dir,'jobs',job.id+'.json'),JSON.stringify({job}))
      const response=await request('/api/jobs/start','a',{project:{name:'Same brand'},count:1,restartOf:job.id})
      assert.equal(response.status,expected)
      assert.match((await response.json()).error,/原任务/)
    }
    assert.equal((await request('/api/jobs/start', 'a', { project: { name: 'Same brand' }, count: 1 })).status,403)
    assert.equal((await request('/api/jobs/status?id=unowned-job', 'b')).status,404)
    await save('a','geo.taskRows',[{project:'Same brand',name:'delete-me'}])
    assert.equal((await request('/api/jobs/delete','b',{brand:'Same brand',name:'delete-me'})).status,404)
    assert.equal((await request('/api/jobs/delete','a',{brand:'Same brand',name:'delete-me'})).status,200)
    assert.equal((await (await request('/api/state?key=geo.articleRows','a')).json()).value.length,1)
    const job={id:'JOB-delete-fixture',projectId:'a',legacyScope:false,status:'running'}
    writeFileSync(resolve(dir,'jobs',job.id+'.json'),JSON.stringify({job}))
    await save('a','geo.taskRows',[{project:'Same brand',name:'active-task',jobId:job.id}])
    assert.equal((await request('/api/jobs/delete','a',{brand:'Same brand',name:'active-task'})).status,409)
    job.status='failed'
    writeFileSync(resolve(dir,'jobs',job.id+'.json'),JSON.stringify({job}))
    assert.equal((await request('/api/jobs/delete','a',{brand:'Same brand',name:'active-task'})).status,200)
    assert.equal((await request('/api/jobs/status?id='+job.id,'a')).status,404)
    assert.equal((await request('/api/jobs/resume','a',{id:job.id})).status,409)
    const upload = await (await request('/api/gallery/upload', 'a', { brand: 'Same brand', files: [{ name: 'pixel.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] })).json()
    const image = upload.files[0]
    assert.equal((await request(image.path, 'a')).status, 200)
    assert.equal((await request(image.path, 'b')).status, 404)
    assert.equal((await request('/api/state', 'b', { key: 'geo.galleryRows', value: [['Same brand', '', '', '', '', image.path]] })).status, 403)
    assert.equal((await request('/api/state', 'b', { key: 'geo.articleRows', value: [{ id: 'x', body: `![foreign](${image.path})` }] })).status, 403)
    const exported = await (await request('/api/articles/export', 'a', { articles: [{ id: 'article-a', body: 'forged' }], format: 'doc' })).json()
    const doc = await request(exported.downloadUrl, 'a')
    assert.equal(doc.status, 200)
    const docText = await doc.text()
    assert.match(docText, /Secret a/)
    assert.doesNotMatch(docText, /归属品牌：|推荐词：|核心词：|生成来源：|第1篇：/)
    const markdownExport = await (await request('/api/articles/export', 'a', { articles: [{ id: 'article-a' }], format: 'md' })).json()
    const markdownText = await (await request(markdownExport.downloadUrl, 'a')).text()
    assert.match(markdownText, /^# Title a\n/)
    assert.doesNotMatch(markdownText, /归属品牌：|推荐词：|核心词：|生成来源：|第1篇：/)
    assert.equal((await request(exported.downloadUrl, 'b')).status, 404)
    assert.equal((await request('/api/articles/export', 'b', { articles: [{ id: 'article-a' }] })).status, 403)
  } finally {
    child.kill()
    await exit
    // This path is the fresh temporary fixture created above, never the workspace.
    rmSync(dir, { recursive: true, force: true })
  }
})
