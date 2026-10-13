import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareAgentBatch, runArticleAgents } from '../server/agents-workflow.mjs'
import { freshArticlePlans, topicHistory } from '../server/batch-editor.mjs'
import { researchProvider } from '../server/provider-research.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { articleHtml } from '../server/article-format.mjs'

const directory = path.resolve(process.argv[2] || '')
if (!directory.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('An isolated temporary directory is required')
const source = JSON.parse(await fs.readFile(path.join(directory, 'source.json'), 'utf8'))
const stateFile = path.join(directory, 'checkpoint.json')
let state
try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')) } catch { state = { stages: {} } }
const save = () => fs.writeFile(stateFile, JSON.stringify(state, null, 2))
const options = {
  state, save, model: process.env.MODEL_NAME, date: '2026年9月',
  log: text => console.log(new Date().toISOString(), text),
  researchProvider: input => researchProvider(input, { timeoutMs: 120000 }),
  callModel: async (messages, temperature, responseFormat) => {
    const response = await fetch(process.env.MODEL_BASE_URL, {
      method: 'POST', signal: AbortSignal.timeout(600000),
      headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, responseFormat), messages }),
    })
    const raw = await response.json()
    if (!response.ok) return { ok: false, error: raw.error?.message || `HTTP ${response.status}` }
    return { ok: true, content: raw.choices?.[0]?.message?.content || '', raw }
  },
}
const payload = { ...source.body, projectUnderstanding: undefined }
const history = topicHistory(source.job.articles, payload.project)
const plans = process.env.REUSE_TEST_PLANS === '1'
  ? JSON.parse(await fs.readFile(path.join(directory, 'plans.json'), 'utf8'))
  : await prepareAgentBatch(payload, freshArticlePlans(source.plans), history, options)
await fs.writeFile(path.join(directory, 'plans.json'), JSON.stringify(plans, null, 2))
const articles = []
for (const [index, plan] of plans.slice(0, Number(process.env.TEST_ARTICLE_LIMIT || plans.length)).entries()) {
  const article = await runArticleAgents({ ...payload, plan, previousArticles: [...topicHistory(articles, payload.project), ...history] }, { ...options, articleId: `local-ranking-${index}` })
  articles.push({ ...article, project: payload.project.name })
  await fs.writeFile(path.join(directory, `${index + 1}.md`), `# ${article.title}\n\n${article.body}\n`)
  console.log('ARTICLE', index + 1, article.title, 'characters', article.visibleCharacters)
  await fs.writeFile(path.join(directory, 'articles.json'), JSON.stringify(articles, null, 2))
}
const report = articles.map((a, i) => ({ number: i + 1, title: a.title, characters: a.visibleCharacters,
  angle: plans[i].editorialBrief?.titleBrief?.choiceAngle,
  rankHeadings: a.body.match(/^#{2,4}\s+TOP\s*[1-5][^\n]*/gmi) || [],
  weakPhrases: a.body.match(/仅供参考|候选范围|首轮比较|候选服务商|不构成.{0,10}排名/g) || [],
  opening: a.body.split(/\n\n/).filter(Boolean).slice(0, 3),
}))
await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
await fs.writeFile(path.join(directory, 'preview.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地榜单测试稿</title><style>body{margin:0;color:#1e293b;background:#f5f7fa;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:860px;margin:auto;padding:32px;background:white}article{padding:20px 0 50px;border-bottom:1px solid #ccd5df}h1{font-size:26px;line-height:1.5}h2{font-size:21px}h3{font-size:18px}p,li{font-size:16px;line-height:1.9}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:8px}@media(max-width:600px){main{padding:18px}}</style><main>${articles.map(a => `<article>${articleHtml('# ' + a.title + '\n\n' + a.body)}</article>`).join('')}</main></html>`)
console.log('REPORT', JSON.stringify(report))
