// Read-only job snapshot input; generation stays in memory and never reaches customer storage.
import { runWritingEngine } from '../server/writing-engine.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
let input = ''
for await (const chunk of process.stdin) input += chunk
const record = JSON.parse(input)
const stages = []
let injected = false
const result = await runWritingEngine({ ...record.body, plan: record.plans.at(-1), previousArticles: record.job.articles.map(a => ({ title: a.title })) }, {
  model: process.env.MODEL_NAME || process.env.QWEN_MODEL, date: '2026年9月',
  log: stage => { stages.push(stage); console.error(stage.split(':')[0]) },
  callModel: async (messages, temperature, format) => {
    if (process.env.VALIDATE_BAD_JSON === '1' && !injected && messages[0].content.includes('你是范文阅读编辑')) {
      injected = true
      console.error('Replay malformed example-understanding JSON')
      return { ok: true, content: '{"progression":' }
    }
    const response = await fetch(process.env.MODEL_BASE_URL || process.env.QWEN_BASE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY || process.env.QWEN_API_KEY}` },
      body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, format), messages }), signal: AbortSignal.timeout(180000),
    })
    if (!response.ok) return { ok: false, error: `Provider HTTP ${response.status}` }
    const raw = await response.json()
    const failure = modelResponseFailure(raw)
    return failure ? { ok: false, error: failure.error } : { ok: true, content: raw.choices[0].message.content, raw }
  },
})
console.log(JSON.stringify({ ok: result.ok, error: result.error, title: result.title, characters: result.visibleCharacters,
  units: result.workflow?.units, template: result.workflow?.template, model: result.production?.resolvedModel,
  reductions: stages.filter(x => x.startsWith('篇幅收束:')).length,
  headings: result.body?.match(/^#{1,4} .+$/gm), opening: result.body?.slice(0, 500),
}, null, 2))
if (!result.ok) process.exitCode = 1
