import fs from 'node:fs'
import { prepareAgentBatch, runArticleAgents } from '../server/agents-workflow.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'

// In-memory production-shaped validation; never creates customer tasks or deducts quotas.
const record = JSON.parse(fs.readFileSync(0, 'utf8'))
const payload = record.body
const state = { stages: {} }, calls = []
const options = { state, model: process.env.MODEL_NAME, date: '2026年9月', log: stage => console.error(stage),
  callModel: async (messages, temperature, format) => {
    calls.push({ json: Boolean(format), purpose: messages[0].content.slice(0, 30) })
    const response = await fetch(process.env.MODEL_BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
      body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, format), messages }), signal: AbortSignal.timeout(240000) })
    if (!response.ok) return { ok: false, error: `Provider HTTP ${response.status}` }
    const raw = await response.json(), failure = modelResponseFailure(raw)
    return failure ? { ok: false, error: failure.error } : { ok: true, content: raw.choices[0].message.content, raw }
  } }
const prior = process.env.VALIDATE_REUSE_BRIEF === '1' ? JSON.parse(fs.readFileSync('.tmp/compact-generation-validation.json', 'utf8')).results[0] : undefined
const plans = prior ? [{ articleType: '选型指南', editorialBrief: prior.editorialBrief }] : await prepareAgentBatch(payload, [{ articleType: '选型指南' }], [], options)
const results = []
for (const mode of process.env.VALIDATE_MODE ? [process.env.VALIDATE_MODE] : ['deep', 'concise']) {
  const before = calls.length
  const article = await runArticleAgents({ ...payload, task: { ...payload.task, writingDepth: mode }, plan: plans[0] }, { ...options, articleId: `isolated-compact-${mode}` })
  results.push({ mode, calls: calls.length - before, ...article })
  fs.writeFileSync('.tmp/compact-generation-validation.json', JSON.stringify({ calls, results }, null, 2))
  console.log(JSON.stringify({ mode, calls: calls.length - before, title: article.title, characters: article.visibleCharacters, opening: article.body.slice(0, 300) }))
}
