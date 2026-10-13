import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runArticleAgents } from '../server/agents-workflow.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'

const directory = path.resolve(process.argv[2] || '')
if (!directory.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Temporary input directory required')
const source = JSON.parse(await fs.readFile(path.join(directory, 'source.json'), 'utf8'))
const plans = JSON.parse(await fs.readFile(path.join(directory, 'plans.json'), 'utf8'))
const checkpoint = JSON.parse(await fs.readFile(path.join(directory, 'checkpoint.json'), 'utf8'))
const understanding = Object.entries(checkpoint.stages).find(([key, row]) => key.startsWith('项目理解') && row.status === 'complete')?.[1]?.value
const results = []
const stop = new Error('Title-only test: writer intentionally not invoked')
for (const [index, plan] of plans.slice(0, 3).entries()) {
  const state = structuredClone(checkpoint)
  try {
    await runArticleAgents({ ...source.body, projectUnderstanding: understanding, plan, previousArticles: results.map(row => ({ title: row.title })) }, {
      state, model: process.env.MODEL_NAME, date: '2026年9月', articleId: `title-smoke-${index}`,
      callModel: async (messages, temperature, responseFormat) => {
        if (!responseFormat) throw stop
        const response = await fetch(process.env.MODEL_BASE_URL, {
          method: 'POST', signal: AbortSignal.timeout(600000),
          headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...modelRequestOptions(process.env, temperature, responseFormat), messages }),
        })
        const raw = await response.json()
        if (!response.ok) throw new Error(raw.error?.message || `HTTP ${response.status}`)
        const content = raw.choices?.[0]?.message?.content || ''
        if (messages[0].content.includes('你是单篇文章主编')) {
          const draft = JSON.parse(content)
          results.push({ title: draft.title, angle: plan.editorialBrief?.titleBrief, recommendationAnswer: draft.recommendationAnswer, argument: draft.argument })
          console.log('TITLE', index + 1, draft.title)
        }
        return { ok: true, content, raw }
      },
    })
  } catch (error) { if (error !== stop) throw error }
}
if (results.length !== 3) throw new Error('Missing editorial results')
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'geo-title-direction-'))
await fs.writeFile(path.join(output, 'titles.json'), JSON.stringify(results, null, 2))
console.log('TITLE_ONLY_REPORT', output)
