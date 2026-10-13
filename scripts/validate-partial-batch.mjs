// Replay a read-only failed snapshot; all generated results stay in memory.
import { prepareAgentBatch } from '../server/agents-workflow.mjs'
import { freshArticlePlans } from '../server/batch-editor.mjs'
import { runWritingEngine } from '../server/writing-engine.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
let source = ''
for await (const chunk of process.stdin) source += chunk
const record = JSON.parse(source)
const partial = Object.entries(record.job.workflow.stages).find(([key, stage]) => key.startsWith('\u9009\u9898\u4ea4\u63a5:') && stage.value?.briefs?.length === 3)?.[1].value
const truncated = record.job.error?.includes('模型输出达到长度上限')
if ((!partial && !truncated) || record.plans.length !== 5) throw new Error('Expected a failed five-article snapshot with partial or truncated topic output')
let replayed = false
const options = {
  model: process.env.MODEL_NAME || process.env.QWEN_MODEL,
  date: '2026\u5e749\u6708', state: {},
  log: message => console.error(message),
  callModel: async (messages, temperature, format) => {
    if (!replayed && messages[0].content.startsWith('\u4f60\u662f\u9009\u9898\u7f16\u8f91\u3002')) {
      replayed = true
      if (truncated) {
        console.error('Replaying actual provider length failure for four briefs')
        return { ok: false, code: 'MODEL_OUTPUT_LENGTH', error: record.job.error }
      }
      console.error('Replaying actual incomplete response: 3 of 4 briefs')
      return { ok: true, content: JSON.stringify(partial) }
    }
    const response = await fetch(process.env.MODEL_BASE_URL || process.env.QWEN_BASE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY || process.env.QWEN_API_KEY}` },
      body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, format), messages }), signal: AbortSignal.timeout(180000),
    })
    if (!response.ok) return { ok: false, error: `Provider HTTP ${response.status}` }
    const raw = await response.json(), failure = modelResponseFailure(raw)
    return failure ? { ok: false, error: failure.error, code: failure.code } : { ok: true, content: raw.choices[0].message.content, raw }
  },
}
const previous = (record.job.articles || []).map(a => ({ title: a.title }))
const plans = await prepareAgentBatch(record.body, freshArticlePlans(record.plans), previous, options)
if (!replayed || plans.length !== 5) throw new Error('Partial batch replay did not complete')
console.log(JSON.stringify({ stage: 'planning-complete', count: plans.length, replayed }))
for (const [index, plan] of plans.entries()) {
  const result = await runWritingEngine({ ...record.body, plan, previousArticles: previous }, { ...options, articleId: `isolated-${index}` })
  console.log(JSON.stringify({ index, ok: result.ok, error: result.error, title: result.title, characters: result.visibleCharacters, template: result.workflow?.template }))
  if (!result.ok || !result.body) throw new Error(`Article ${index + 1} failed: ${result.error}`)
  previous.push({ title: result.title, brief: plan.editorialBrief })
}
console.log(JSON.stringify({ ok: true, articles: 5, customerRecordsWritten: 0 }))
