// Isolated prompt smoke test; no accounts, jobs, articles or publishing orders are created.
import { readFileSync } from 'node:fs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'

throw new Error('旧标题审核流程已归档；请运行 npm run test:writing 验证当前规则')
const prompt = readFileSync(new URL('../docs/archive/writing/headline.md', import.meta.url), 'utf8')
const finalPrompt = readFileSync(new URL('../docs/archive/writing/headline-final.md', import.meta.url), 'utf8')
async function call(system, input) {
  const response = await fetch(process.env.MODEL_BASE_URL || process.env.QWEN_BASE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MODEL_API_KEY || process.env.QWEN_API_KEY}` },
    body: JSON.stringify({ ...modelRequestOptions(process.env, 0.8, { type: 'json_object' }), messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }),
    signal: AbortSignal.timeout(180000),
  })
  if (!response.ok) throw new Error(`Title smoke test HTTP ${response.status}`)
  const data = await response.json()
  const failure = modelResponseFailure(data)
  if (failure) throw new Error(failure.error)
  return { value: JSON.parse(data.choices[0].message.content), model: data.model }
}
const cases = [
  { mode: '按自己行业写', buyer: '首次采购GEO服务的企业', need: '分清单次内容服务与持续维护服务', comparison: '服务范围', fact: '示例甲服务说明列有内容制作和持续更新，示例乙只列有内容制作。' },
  { mode: '按自己行业写', buyer: '有内部运营团队的企业', need: '找能配合内部团队的外部GEO服务商', comparison: '协作方式', fact: '示例甲接受企业团队提供资料并负责内容更新，示例乙提供全托管服务。' },
  { mode: '按实际场景写', buyer: '口腔诊所', need: '选择能配合诊所核实业务信息的GEO服务商', comparison: '业务资料核实和更新协作', fact: '示例甲服务说明包含客户资料确认与修改流程，没有医疗效果或获客实测资料。' },
  { mode: '按实际场景写', buyer: '跨区域餐饮连锁', need: '找能维护不同门店信息的GEO服务商', comparison: '多门店更新能力', fact: '示例甲支持逐门店提交资料与更新，示例乙服务说明仅包含单品牌内容制作。' },
  { mode: '按自己行业写', buyer: '需要选择外部管理顾问的企业', keyword: '民企咨询公司', need: '筛选能持续提供管理辅导的公司', comparison: '咨询服务特点', fact: '测试稿单按已提供的服务范围、辅导形式和适用阶段比较甲乙丙丁戊五家公司；按本次公开标准排序，甲优先用于需要持续辅导的企业。不是权威榜单，不是实测。', argument: '按稿单给出五家公司的编辑推荐TOP5，解释各自服务特点与适用阶段。', articleType: '榜单推荐' },
  { mode: '按自己行业写', buyer: '需要了解服务商客户评价的企业', need: '选择服务体验更适合自己的公司', comparison: '服务口碑和适用范围', fact: '测试资料包含甲乙两家可追溯的客户评价原文，甲的评价谈及沟通响应，乙的评价谈及专项服务；个案不代表全部客户，也不据此评口碑第一。', articleType: '口碑比较' },
  { mode: '按实际场景写', buyer: '工业设备制造企业', need: '寻找能理解专业产品资料的GEO服务公司', comparison: '专业产品服务特点', fact: '测试资料中甲提供产品资料整理服务，乙侧重普通品牌内容服务，没有销售线索实测或排名依据。', articleType: '服务商比较' },
  { mode: '按实际场景写', buyer: '旅游景区运营企业', need: '避开服务范围不适合景区的GEO服务商', comparison: '景区服务范围匹配', fact: '测试资料中甲支持景区项目分项资料整理，乙只提供单品牌内容制作。只讨论选择风险，不指控乙违法或服务差。', articleType: '避坑指南' },
]
const previousTitles = []
for (const entry of cases) {
  const input = {
    date: '2026年9月', keyword: entry.keyword || '西安GEO公司', mode: entry.mode,
    titleBrief: { selectionTask: `选择${entry.keyword || 'GEO服务商'}`, choiceAngle: entry.comparison, materialBasis: entry.fact },
    topicContext: { serviceBuyer: entry.buyer, businessProblem: entry.need },
    argument: entry.argument || `根据${entry.comparison}比较服务商与客户需求的适配，不作名次排名。`, articleType: entry.articleType || '服务商比较',
    materials: { brand: entry.fact, evidence: '', provenance: '虚构测试资料，仅用于测试提示词，不是可发布的企业事实。' },
    plannedContent: [{ purpose: '说明客户需求' }, { purpose: '比较资料支持的服务差异并给出适配建议' }],
    previousTitles,
  }
  const { value } = await call(prompt, input)
  if (!value.title?.trim()) throw new Error('Missing title')
  const final = await call(finalPrompt, { candidateTitles: value.candidateTitles, selectionIntent: value.selectionIntent,
    date: input.date, keyword: input.keyword, mode: input.mode, articleType: input.articleType,
    titleBrief: input.titleBrief, argument: input.argument, previousTitles })
  if (!final.value.title?.trim()) throw new Error('Missing final title')
  console.log(JSON.stringify({ mode: entry.mode, buyer: entry.buyer, model: final.model, title: final.value.title }))
  previousTitles.push(final.value.title)
}
