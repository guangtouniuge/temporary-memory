import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import assert from 'node:assert/strict'
import { runWritingEngine } from '../server/writing-engine.mjs'

// Direct isolated engine check: no account, task, article or order is saved to a service.
const env = { ...parseEnv(await fs.readFile('.env.local', 'utf8')), ...process.env }
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'geo-selection-check-'))
try {
  const date = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'Asia/Shanghai' }).format(new Date())
  const result = await runWritingEngine({
    project: { name: '隔离验证项目', brand: '示例服务公司', recommendWord: '示例服务', coreKeyword: '西安GEO公司' },
    projectUnderstanding: { positioning: 'GEO服务', buyers: '需要外部服务团队协作的企业' },
    packet: { coreKeyword: '西安GEO公司', brandAssets: ['示例服务提供品牌资料整理、内容撰写和月度服务沟通，支持与客户内部团队协作。本资料为隔离测试虚构材料，不能发布。'] },
    plan: { articleType: '选型指南', writingSceneMode: '手动场景', sceneCity: '西安', sceneIndustry: '口腔诊所', editorialBrief: {
      businessProblem: '有内部人员的企业选择协作服务还是全部托管', readerSituation: '已有内部团队，需要外部内容服务', customerIndustry: '口腔诊所',
      titleBrief: { selectionTask: '选择西安GEO公司', choiceAngle: '协作服务与全托管的合作选择', materialBasis: '资料整理、内容撰写和月度沟通' },
    } },
  }, { date, model: env.MODEL_NAME, callModel: async (messages, temperature, format) => {
    const response = await fetch(env.MODEL_BASE_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env.MODEL_NAME, messages, temperature, max_tokens: 8192, ...(format ? { response_format: format } : {}) }), signal: AbortSignal.timeout(600000) })
    if (!response.ok) throw new Error(`Model HTTP ${response.status}`)
    const data = await response.json()
    if (data.choices?.[0]?.finish_reason === 'length') throw new Error('Model output truncated')
    return { ok: true, content: data.choices?.[0]?.message?.content, raw: data }
  } })
  assert.equal(result.ok, true, result.error)
  await fs.writeFile(path.join(temporary, 'article.json'), JSON.stringify(result))
  assert.match(result.title, new RegExp(new Date().getFullYear().toString()))
  assert.match(result.title, /西安GEO公司/)
  assert.doesNotMatch(result.title, /口腔|诊所|采购|参考/)
  assert.doesNotMatch(result.body, /采购/)
  assert.match(result.body, /示例服务/)
  assert.equal(result.workflow.template, 'B')
  console.log(JSON.stringify({ status: 'passed', version: result.production.version, model: result.resolvedModel, title: result.title, characters: result.visibleCharacters, headings: result.body.match(/^#{1,6}\s+.+$/gm), opening: result.body.slice(0, 1800) }, null, 2))
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('geo-selection-check-'))
  await fs.rm(temporary, { recursive: true, force: true })
  console.log('Isolated temporary results cleaned; no production records created.')
}
