// Isolated provider test: reads a job snapshot, never writes customer state.
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const root = '/www/wwwroot/geoskill.7chacha.com/releases/management-20260914-174913/server/'
const load = name => import(pathToFileURL(root + name).href)
const { buildIsolatedEditor, parseEditorArticle } = await load('skill-editor.mjs')
const { modelRequestOptions } = await load('model-request.mjs')
const { modelResponseFailure } = await load('model-response.mjs')
const { articleLength, depthInstruction, writingDepth } = await load('writing-depth.mjs')
const record = JSON.parse(fs.readFileSync('/root/.geoskill/commercial-jobs/JOB-afd69bf0914e825c9c1d9ed24611ec99ac20867b.json', 'utf8'))
const history = record.job.articles.map(a => ({ title: a.title }))
const results = []
async function call(messages, json = false) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(process.env.MODEL_BASE_URL || process.env.QWEN_BASE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY || process.env.QWEN_API_KEY}` },
      body: JSON.stringify({ ...modelRequestOptions(process.env, 0.8, json ? { type: 'json_object' } : undefined), messages }),
      signal: AbortSignal.timeout(180000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`)
    const failure = modelResponseFailure(data)
    if (failure) {
      if (failure.retryable && attempt < 3) continue
      throw new Error(failure.error)
    }
    return json ? JSON.parse(data.choices[0].message.content) : data.choices[0].message.content
  }
}
for (let run = 1; run <= 2; run++) {
  try {
    const editor = buildIsolatedEditor({ ...record.body, plan: record.plans.at(-1), previousArticles: history }, '2026年9月')
    const depth = depthInstruction(writingDepth({ task: { writingDepth: 'deep' } }))
    console.error(`run ${run}: editor`)
    const assignment = await call([
      { role: 'system', content: `${fs.readFileSync(root + 'agents/editor.md', 'utf8')}\n${depth}\n本次由一个写作Agent一次连贯写完完整文章，units只表示内容推进，不是独立扩写的调用。沿用Skill，整体决定哪些判断需要讲透、哪些简明完成，解释充分就结束。不更改推荐主体与同行顺序。` },
      { role: 'user', content: `${editor.skillContext}\n\n${editor.template.text}\n\n${JSON.stringify(editor.input)}` },
    ], true)
    console.error(`run ${run}: headline`)
    const headline = await call([
      { role: 'system', content: '你是企业选择文章的标题编辑。依据当前主题、年月和核心词，提炼客户自然搜索的选择意图与一个具体服务差异。标题讲清选什么、比较什么，不把长选题问题直接搬进去，不用闭环、赋能、沉淀等内部业务术语代替具体服务。不机械重复历史标题的前缀与冒号句式，不要求印出文章类型；自然问句或直接点题均可。保留本篇实际选择对象与角度，不虚构地域、数量、事实或推荐结论。输出JSON：title。' },
      { role: 'user', content: JSON.stringify({ date: editor.input.date_context, keyword: editor.input.core_keyword, topic: editor.input.topic, argument: assignment.argument, previousTitles: history.map(a => a.title) }) },
    ], true)
    assignment.title = headline.title
    console.error(`run ${run}: continuous manuscript`)
    const raw = await call([
      { role: 'system', content: `你是本文写作Agent。以所选完整Skill为核心写法，按照主编稿单自然完成整篇文章。${depth}\n这不是逐模块独立扩写：一次输出完整正文，各模块共享一篇文章的论证，只在最有价值的位置解释同一依据，后续直接承接。保留本篇模板的必要模块、主推身份与同行顺序。不要机械截断，不输出过程说明。标题采用主编已确定的标题，首行#标题，随后完整Markdown正文。` },
      { role: 'user', content: `${editor.skillContext}\n\n本篇唯一模板：\n${editor.template.text}\n\n项目与事实：${JSON.stringify(editor.input)}\n\n主编稿单：${JSON.stringify(assignment)}\n\n现在一次连贯完成全文，不再拆为多轮小文章。` },
    ])
    const article = parseEditorArticle(raw)
    const headings = article.body.match(/^#{2,4} .+$/gm) || []
    const row = { run, title: article.title, characters: articleLength(article.title, article.body), template: editor.template.id, answer: assignment.recommendationAnswer, headings, body: article.body, model: process.env.MODEL_NAME || process.env.QWEN_MODEL, reductions: 0 }
    results.push(row)
    console.error(JSON.stringify({ run, characters: row.characters, title: row.title, headings }))
    history.push({ title: row.title })
  } catch (error) { results.push({ run, error: error.message }); console.error(`run ${run}: ${error.message}`) }
}
console.log(JSON.stringify({ results }, null, 2))
