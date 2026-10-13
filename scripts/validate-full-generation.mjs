import fs from 'node:fs'
import assert from 'node:assert/strict'
import { prepareAgentBatch, runArticleAgents } from '../server/agents-workflow.mjs'
import { freshArticlePlans, topicHistory } from '../server/batch-editor.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
import { articleSceneImages } from '../server/volcengine-images.mjs'

const record = JSON.parse(fs.readFileSync(0, 'utf8'))
const root = '.tmp/full-generation-20260915'
fs.mkdirSync(root, { recursive: true })
const state = { stages: {} }, rows = [], imageFiles = new Map()
const save = () => fs.writeFileSync(`${root}/checkpoint.json`, JSON.stringify(state))
let calls = 0, injected = false
const options = { state, model: process.env.MODEL_NAME, date: '2026年9月', save, log: text => console.log(text),
  callModel: async (messages, temperature, format) => {
    calls++
    const response = await fetch(process.env.MODEL_BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
      body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, format), messages }), signal: AbortSignal.timeout(240000) })
    if (!response.ok) return { ok: false, error: `Provider HTTP ${response.status}` }
    const raw = await response.json(), failure = modelResponseFailure(raw)
    return failure ? { ok: false, error: failure.error } : { ok: true, content: raw.choices[0].message.content, raw }
  } }
const payload = record.body
const history = topicHistory(record.job.articles || [], payload.project)
const original = freshArticlePlans(record.plans || record.body.plans || record.job.plans)
const plans = await prepareAgentBatch(payload, original, history, options)
assert.equal(plans.length, original.length)
fs.writeFileSync(`${root}/plans.json`, JSON.stringify(plans))
for (const [index, plan] of plans.entries()) {
  const input = { ...payload, plan, previousArticles: topicHistory(rows, payload.project) }
  const articleOptions = { ...options, articleId: `isolated-full-${index}` }
  if (index === 0 && !injected) {
    const interrupt = { ...articleOptions, callModel: async (...args) => {
      if (!args[2]) { injected = true; return { ok: false, error: 'ISOLATED_TRANSPORT_INTERRUPTION' } }
      return options.callModel(...args)
    } }
    await assert.rejects(runArticleAgents(input, interrupt), /ISOLATED_TRANSPORT_INTERRUPTION/)
    console.log('已注入并验证正文中断，使用保存进度续跑')
  }
  const article = await runArticleAgents(input, articleOptions)
  assert.ok(article.body.trim())
  assert.ok(article.visibleCharacters <= (article.writingDepth === 'concise' ? 2000 : 9999))
  const before = calls
  assert.equal((await runArticleAgents(input, { ...articleOptions, callModel: () => { throw new Error('completed generation repeated') } })).body, article.body)
  assert.equal(calls, before)
  if (index === 0) {
    const imageOptions = { project: payload.project, ...article, scene: plan.sceneIndustry || plan.editorialBrief?.customerIndustry, articleId: `isolated-full-${index}`, state, saveState: save,
      findSaved: key => imageFiles.get(key), saveImage: (key, file) => {
        const path = `${root}/${key}.${file.ext}`; fs.writeFileSync(path, file.data); imageFiles.set(key, path); return path
      }, log: console.log }
    article.imagePaths = await articleSceneImages(imageOptions)
    assert.equal(article.imagePaths.length, 2)
    assert.deepEqual(await articleSceneImages({ ...imageOptions, generate: () => { throw new Error('completed image repeated') } }), article.imagePaths)
  }
  rows.push({ ...article, project: payload.project.name })
  fs.writeFileSync(`${root}/articles.json`, JSON.stringify(rows))
  console.log(JSON.stringify({ completed: rows.length, total: plans.length, title: article.title, characters: article.visibleCharacters, images: article.imagePaths?.length || 0 }))
}
fs.writeFileSync(`${root}/receipt.json`, JSON.stringify({ status: 'passed', articles: rows.length, calls, resumed: injected, images: imageFiles.size, productionWrites: 0 }))
