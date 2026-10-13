import fs from 'node:fs/promises'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
import { runWritingEngine } from '../server/writing-engine.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'

process.loadEnvFile('.env.local')
const { payload } = JSON.parse(await fs.readFile('outputs/api-tests/simplified-7.2.3-1789173046736/inputs.json', 'utf8'))
payload.plan = { articleType: '榜单推荐', writingSceneMode: '按实际场景写', industryScene: '西安连锁家政品牌', question: '连锁家政品牌如何选择能表达多门店与服务差异的西安GEO服务商？', lockTopic: true }
payload.packet.coreKeyword = '西安GEO服务商'
const out = process.argv[2] || `outputs/api-tests/agents-workflow-${Date.now()}`
await fs.mkdir(out, { recursive: true })
let state
try { state = JSON.parse(await fs.readFile(`${out}/state.json`, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; state = { stages: {} } }
console.log(out)
let count = 0
const result = await runWritingEngine(payload, {
  state, date: '2026年9月', model: 'deepseek-flash', articleId: 'agent-test-housekeeping', log: message => console.log(message),
  save: async value => { await fs.writeFile(`${out}/state.next.json`, JSON.stringify(value, null, 2)); await fs.rename(`${out}/state.next.json`, `${out}/state.json`) },
  callModel: async (messages, temperature, format) => {
    const stage = `call-${Date.now()}-${++count}`
    const body = { ...modelRequestOptions({ MODEL_NAME: 'deepseek-flash', MODEL_MAX_TOKENS: '16384', MODEL_THINKING: 'enabled', MODEL_REASONING_EFFORT: 'high' }, temperature, format), messages }
    await fs.writeFile(`${out}/${stage}-request.json`, JSON.stringify(body, null, 2))
    const response = await fetch(process.env.MODEL_BASE_URL, { method: 'POST', signal: AbortSignal.timeout(300000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` }, body: JSON.stringify(body) })
    const raw = await response.json()
    await fs.writeFile(`${out}/${stage}-response.json`, JSON.stringify(raw, null, 2))
    return { ok: response.ok, content: raw.choices?.[0]?.message?.content || '', raw, error: response.ok ? undefined : 'API request failed' }
  },
})
await fs.writeFile(`${out}/result.json`, JSON.stringify(result, null, 2))
if (!result.ok) throw new Error(result.error)
const article = `# ${result.title}\n\n${result.body}`
await fs.writeFile(`${out}/article.md`, article)
await fs.writeFile(`${out}/article.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${sanitizeHtml(result.title, { allowedTags: [] })}</title><style>body{font:17px/1.9 "Microsoft YaHei",sans-serif;color:#222;background:#f7f8fa;margin:0;letter-spacing:0}article{max-width:820px;margin:24px auto;padding:30px;background:white}h1{font-size:26px}h2{font-size:22px}h3{font-size:19px}table{display:block;overflow:auto;border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}@media(max-width:700px){article{margin:0;padding:20px}}</style><article>${sanitizeHtml(marked.parse(article))}</article></html>`)
console.log(JSON.stringify({ out, calls: count, han: (article.match(/\p{Script=Han}/gu) || []).length, units: result.workflow.units, template: result.workflow.template }))
