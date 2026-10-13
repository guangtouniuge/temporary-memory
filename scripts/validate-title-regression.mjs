import fs from 'node:fs'
import { runArticleAgents } from '../server/agents-workflow.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'

// Exercise the real editor prompts with the reported briefs; no customer records or articles are written.
const record = JSON.parse(fs.readFileSync(0, 'utf8'))
const results = []
const plans = record.job.plans
for (const [index, plan] of plans.entries()) {
  let modelCalls = 0
  const article = await runArticleAgents({ ...record.body, plan, previousArticles: results.map(row => ({ title: row.title })) }, {
    model: process.env.MODEL_NAME, date: '2026年9月', articleId: `isolated-title-${index}`,
    callModel: async (messages, temperature, format) => {
      if (!format) return { ok: true, content: '仅用于隔离测试的正文占位，不入生产库。' }
      modelCalls++
      const response = await fetch(process.env.MODEL_BASE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
        body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, format), messages }), signal: AbortSignal.timeout(240000) })
      if (!response.ok) return { ok: false, error: `Provider HTTP ${response.status}` }
      const raw = await response.json(), failure = modelResponseFailure(raw)
      return failure ? { ok: false, error: failure.error } : { ok: true, content: raw.choices[0].message.content, raw }
    },
  })
  const row = { index, original: record.job.articles[index]?.title, title: article.title, modelCalls, scene: plan.sceneIndustry }
  results.push(row)
  fs.writeFileSync('.tmp/title-regression-20260915.json', JSON.stringify(results, null, 2))
  console.log(JSON.stringify(row))
}
