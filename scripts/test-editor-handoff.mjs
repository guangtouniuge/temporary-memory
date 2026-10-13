import fs from 'node:fs/promises'
import path from 'node:path'
import { runWritingEngine } from '../server/writing-engine.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'

process.loadEnvFile('.env.local')
const jobFile = process.argv[2]
if (!jobFile) throw new Error('Provide a local completed job file')
const record = JSON.parse(await fs.readFile(jobFile, 'utf8'))
const sourcePlan = record.plans.find(plan => plan.articleType === (process.argv[3] || '避坑指南'))
if (!sourcePlan) throw new Error('Missing test article type')
const { editorialBrief, ...plan } = sourcePlan
const payload = { ...record.body, plan: { ...plan, lockTopic: true }, previousArticles: [] }
const out = path.resolve(`outputs/api-tests/editor-handoff-${Date.now()}`)
await fs.mkdir(out, { recursive: true })
console.log(out)
let calls = 0
const result = await runWritingEngine(payload, {
  date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'Asia/Shanghai' }).format(new Date()),
  model: process.env.MODEL_NAME,
  articleId: 'handoff-acceptance',
  log: message => console.log(message),
  save: state => fs.writeFile(path.join(out, 'state.json'), JSON.stringify(state, null, 2)),
  callModel: async (messages, temperature, format) => {
    const body = { ...modelRequestOptions(process.env, temperature, format), messages }
    const index = ++calls
    await fs.writeFile(path.join(out, `request-${index}.json`), JSON.stringify(body, null, 2))
    const response = await fetch(process.env.MODEL_BASE_URL, {
      method: 'POST', signal: AbortSignal.timeout(300000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` },
      body: JSON.stringify(body),
    })
    const raw = await response.json()
    await fs.writeFile(path.join(out, `response-${index}.json`), JSON.stringify(raw, null, 2))
    return { ok: response.ok, content: raw.choices?.[0]?.message?.content || '', raw, error: response.ok ? undefined : `API status ${response.status}` }
  },
})
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2))
if (!result.ok) throw new Error(result.error)
await fs.writeFile(path.join(out, 'article.md'), `# ${result.title}\n\n${result.body}`)
console.log(JSON.stringify({ title: result.title, calls, version: result.production.version, out }))
