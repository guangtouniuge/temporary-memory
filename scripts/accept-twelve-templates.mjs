import fs from 'node:fs/promises'
import path from 'node:path'
import { runWritingEngine, writingRelease } from '../server/writing-engine.mjs'
import { prepareAgentBatch } from '../server/agents-workflow.mjs'
import { templateNames } from '../server/skill-editor.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { researchProvider } from '../server/provider-research.mjs'
import { articleHtml } from '../server/article-format.mjs'

process.loadEnvFile('.env.local')
const record = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const out = path.resolve(process.argv[3] || `outputs/api-tests/twelve-acceptance-${Date.now()}`)
await fs.mkdir(out, { recursive: true })
console.log(out)
const read = async (name, fallback) => { try { return JSON.parse(await fs.readFile(path.join(out, name), 'utf8')) } catch { return fallback } }
const write = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2))
const state = await read('state.json', { stages: {} })
const payload = await read('input.json', structuredClone(record.body))
for (const row of (payload.packet.rankingCompanies || []).slice(1)) {
  const key = `peer-${encodeURIComponent(row.name)}.json`
  let research = await read(key, null)
  if (!research) {
    console.log(`同行资料：${row.name}`)
    try { research = await researchProvider({ company: row.name, industry: payload.project.industry, city: payload.project.city }) }
    catch (error) { research = { company: row.name, status: 'failed', note: error.message, facts: [] } }
    await write(key, research)
  }
  row.publicResearch = research
  console.log(`同行资料完成：${row.name} ${research.facts.length}条`)
}
await write('input.json', payload)
let calls = (await fs.readdir(out)).filter(name => /^response-\d+\.json$/.test(name)).length
const options = {
  date: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'Asia/Shanghai' }).format(new Date()),
  model: process.env.MODEL_NAME, state, save: value => write('state.json', value), log: console.log,
  callModel: async (messages, temperature, format) => {
    const index = ++calls
    const body = { ...modelRequestOptions(process.env, temperature, format), messages }
    await write(`request-${index}.json`, body)
    const response = await fetch(process.env.MODEL_BASE_URL, {
      method: 'POST', signal: AbortSignal.timeout(300000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY}` }, body: JSON.stringify(body),
    })
    const raw = await response.json()
    await write(`response-${index}.json`, raw)
    return { ok: response.ok, content: raw.choices?.[0]?.message?.content || '', raw, error: response.ok ? undefined : `API ${response.status}` }
  },
}
let plans = await read('plans.json', null)
if (!plans) {
  plans = await prepareAgentBatch(payload, templateNames.map((articleType, planIndex) => ({ articleType, planIndex, writingSceneMode: planIndex % 2 ? '按实际场景写' : '按自己行业写' })), [], options)
  await write('plans.json', plans)
}
const results = []
for (const [index, plan] of plans.entries()) {
  const stem = `${String(index + 1).padStart(2, '0')}-${plan.articleType}`
  let result = await read(`${stem}.json`, null)
  if (!result?.ok || result.production?.version !== writingRelease.version) {
    console.log(`START ${index + 1}/12 ${plan.articleType} ${plan.writingSceneMode}`)
    result = await runWritingEngine({ ...payload, plan, previousArticles: results.filter(r => r.ok).map(r => ({ title: r.title })) }, { ...options, articleId: stem })
    await write(`${stem}.json`, result)
  }
  results.push(result)
  if (result.ok) await fs.writeFile(path.join(out, `${stem}.md`), `# ${result.title}\n\n${result.body}`)
  await write('summary.json', results.map((r, i) => ({ type: plans[i].articleType, mode: plans[i].writingSceneMode, ok: r.ok, error: r.error, title: r.title, chars: (r.body?.match(/[\u3400-\u9fff]/g) || []).length, template: r.workflow?.template, version: r.production?.version })))
  console.log(`DONE ${index + 1}/12 ${result.ok ? result.title : result.error}`)
}
const escape = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
await fs.writeFile(path.join(out, 'articles.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>12类文章验收样稿</title><style>body{font:16px/1.9 "Microsoft YaHei",sans-serif;margin:32px auto;padding:0 24px;max-width:880px;color:#202124}h1{font-size:26px}h2{font-size:22px}h3{font-size:18px}article{padding:32px 0;border-top:1px solid #ddd}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}img{max-width:100%}a{color:#2563eb}</style><h1>12类文章验收样稿</h1><nav>${plans.map((p,i)=>`<p><a href="#a${i}">${escape(p.articleType)} · ${escape(results[i].title || '生成未完成')}</a></p>`).join('')}</nav>${results.map((r,i)=>`<article id="a${i}"><small>${escape(plans[i].articleType)} · ${escape(plans[i].writingSceneMode)}</small><h1>${escape(r.title)}</h1>${r.ok ? articleHtml(r.body) : escape(r.error)}</article>`).join('')}</html>`)
console.log(JSON.stringify({ out, calls, completed: results.filter(r => r.ok).length, version: writingRelease.version }))
