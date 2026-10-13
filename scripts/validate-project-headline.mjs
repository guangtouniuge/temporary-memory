// Uses a read-only snapshot; no customer records or articles are written.
import { readFileSync } from 'node:fs'
import { buildIsolatedEditor } from '../server/skill-editor.mjs'
import { projectInput, selectHeadlineCandidate } from '../server/agents-workflow.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
throw new Error('旧候选标题审核已归档；请运行 npm run test:writing 或 scripts/verify-selection-writing.mjs')
let source = ''
for await (const chunk of process.stdin) source += chunk
const record = JSON.parse(source)
const drafts = Object.entries(record.job.workflow.stages).filter(([key, value]) => key.startsWith('单篇编辑:') && value.status === 'complete').map(([, stage]) => stage.value)
if (!drafts.length || drafts.length !== record.plans.length) throw new Error('Missing readonly editorial drafts')
async function call(name, input) {
  const prompt = readFileSync(new URL(`../server/agents/${name}.md`, import.meta.url), 'utf8')
  const response = await fetch(process.env.MODEL_BASE_URL || process.env.QWEN_BASE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY || process.env.QWEN_API_KEY}` },
    body: JSON.stringify({ ...modelRequestOptions(process.env, 0.8, { type: 'json_object' }), messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(input) }] }),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`)
  const data = await response.json(), failure = modelResponseFailure(data)
  if (failure) throw new Error(failure.error)
  return JSON.parse(data.choices[0].message.content)
}
const previousTitles = record.job.articles.map(a => a.title)
for (const [index, draft] of drafts.entries()) {
const editor = buildIsolatedEditor({ ...record.body, plan: record.plans[index] }, '2026年9月')
const context = { date: editor.input.date_context, keyword: editor.input.core_keyword, mode: editor.input.writing_mode,
  articleType: editor.template.name, titleBrief: editor.input.topic.titleBrief, argument: draft.argument,
  previousTitles, materials: projectInput(record.body), recommendation: draft.recommendationAnswer }
const candidate = await call('headline', { ...context, topicContext: editor.input.topic, recommendation: draft.recommendationAnswer,
  materials: projectInput(record.body), providers: editor.input.competitor_or_provider_list, plannedContent: draft.units, materialReasons: draft.materialReasons })
const final = await call('headline-final', { ...context, candidateTitles: candidate.candidateTitles, selectionIntent: candidate.selectionIntent })
const selected = selectHeadlineCandidate(candidate, final, previousTitles)
if (!selected) throw new Error(`No eligible title for original article ${index + 1}`)
console.log(JSON.stringify({ index, oldTitle: record.job.articles[index]?.title, candidateTitles: candidate.candidateTitles, finalTitle: selected.title, reviews: selected.candidateReviews }, null, 2))
previousTitles.unshift(selected.title)
}
