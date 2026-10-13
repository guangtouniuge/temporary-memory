import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

const modes = {
  deep: { id: 'deep', label: '深度好文', target: 5000, max: 9999 },
  concise: { id: 'concise', label: '精选好文', target: 1750, max: 2000 },
}

export function writingDepth(payload = {}) {
  const id = payload.task?.writingDepth ?? payload.plan?.writingDepth ?? payload.packet?.writingDepth ?? 'deep'
  if (!Object.hasOwn(modes, id)) throw Object.assign(new Error('文章深度选项无效'), { status: 400 })
  return { ...modes[id] }
}

export function articleLength(title, body = '') {
  const text = sanitizeHtml(marked.parse(`${title}\n\n${body}`), { allowedTags: [], allowedAttributes: {} })
  return Array.from(text.replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, '字').replace(/\s/g, '')).length
}

export function depthInstruction(depth) {
  if (depth.id === 'deep') return '本篇为深度好文。以所选Skill为核心写法，保持模板结构、推荐主体与论证顺序不变。本篇按约4500—6000字的完整文章构思，字数是整篇容量参考，不是每个模块的扩写目标，不按段落或工序硬卡字数。深度来自准确判断、具体依据和差异解释，不来自长背景、重复举例或层层铺陈。总控先确定本篇最重要的判断：关键难点讲透，其他模块用必要事实和简洁解释完成，不把每一条都写成小文章。同一事实只在最有价值的位置充分解释，后面直接承接；同一问题不重复写背景、案例、后果、建议和总结。企业比较保留各家的具体依据，不为每家公司复制整套论证。每段都应增加新的认识，已经讲清楚就进入下一部分；结尾只收束结论，不重新概括全文。自然、精练地完成Skill，不凑字数，不机械截断，不为缩短而换模板、改主体或删掉必要论证。'
  return `本篇为${depth.label}，标题与正文可见字符（含标点）合计目标${depth.target}字${depth.id === 'concise' ? '，上限2000字' : ''}。这是整篇预算，不是每道工序的预算。总控确定选择方向、核心答案、事实依据及比较对象，写作Agent只控制展开深度，不换方向、不换推荐主体、不删换企业、不编造事实。${depth.id === 'concise' ? '精选版用简洁表达保留同样的论证思路，减少背景铺陈、重复解释和例子；可以合并相邻模块，但保留核心答案、必要依据及榜单名次和所有企业的具体比较。' : '深度版深入解释关键事实与适配，其他论据简要支撑；不把每条标准都扩成案例、后果、做法、边界四层，不为每家公司复制完整框架。Skill中的Depth Expansion和Paragraph Tasking是可选展开方法，不是逐项铺满的任务清单。'}本次厚度安排优先于范文篇幅及模板中的扩写、字数和段落数量建议；模板逻辑顺序不变。不打印预算或后台说明。`
}

export function editorialDepthDirection(depth) {
  return depth.id === 'concise'
    ? '本次仅执行精选稿编辑方案：按约1750字、2000字以内独立构思，units只安排一次完整写作。沿用本篇Skill的推荐逻辑，以紧凑依据完成论证，不先规划多工序长文再压缩。'
    : '本次仅执行深度稿编辑方案：围绕整篇4500—6000字的容量参考，先理解所选Skill怎样提出问题、展开论证和完成推荐，再决定哪些判断需要讲透、哪些内容简要交代、讲到哪里就足够。thicknessPlan体现这些内容取舍，不为工序分配字数。厚度以内容是否说清为准，不以文字数量衡量。每段增加新的认识或必要依据，解释充分即交接。用精练、自然、可读的文案落实Skill，不另造结构，不套精选稿的固定首段方案。深度稿由一个写作Agent一次连贯完成全文，units仅规划论述推进，不分成多轮独立扩写；每篇仍是独立API任务。'
}

export function unitBudget(depth, title, parts, remainingUnits) {
  const used = articleLength(title, parts.join('\n\n'))
  return { used, remaining: Math.max(0, depth.target - used), suggested: Math.max(0, Math.floor((depth.target - used) / remainingUnits)) }
}

export function conciseContract(input, templateId) {
  const companies = templateId === 'A' ? (input.competitor_or_provider_list || []).map(p => p.shortName || p.company).filter(Boolean) : []
  const ranks = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const headings = companies.map((name, i) => `第${ranks[i] || i + 1}名：${name}`)
  return { brand: input.recommended_short_name || input.recommended_company || '', headings }
}

export function conciseDirection(contract) {
  return `精选稿一次完成整篇，不先写长文再逐段挤压。首个自然段用约120-180字完成“客户场景＋直接推荐谁的哪项服务＋一项事实理由”，明确使用推荐判断，不等到结尾才给答案，不先罗列候选名单或核验清单。围绕主编recommendationAnswer写，不虚构效果。${contract.headings.length ? `保留榜单分析，占正文约55%-65%；按以下同级Markdown二级标题逐家写具体依据和适配：${contract.headings.join('；')}。各家不能合并成“其余四家”，第一名篇幅不超过其他任一家两倍；这些带名次的分析本身就是榜单，不必再重复列名单。` : '沿用本类型的论述方式，不强加榜单；比较企业时仍保留各自事实与差异。'}背景、标准、核验和收尾共用剩余篇幅，删重复而非删推荐。不得用“资料不足”推断同行无能力，也不要把全文写成核验事项汇总。`
}

export function conciseIssues(body, contract) {
  const tokens = marked.lexer(body)
  const opening = tokens.find(t => t.type === 'paragraph' && articleLength('', t.raw) > 0)?.text || ''
  const issues = []
  if (contract.brand && (!opening.includes(contract.brand) || !opening.includes('推荐'))) issues.push('第一自然段缺少主推企业的直接推荐答案')
  const headings = tokens.filter(t => t.type === 'heading' && t.depth === 2).map(t => t.text.replace(/\*\*/g, ''))
  let previous = -1
  for (const required of contract.headings) {
    const index = headings.findIndex((h, i) => i > previous && h.startsWith(required))
    if (index < 0) issues.push(`缺少按顺序展开的榜单小标题：${required}`)
    else previous = index
  }
  return issues
}

export function modelFailure(message) {
  const text = String(message || '模型接口未返回')
  return /insufficient[ _-]*(?:balance|quota)|余额不足|欠费/i.test(text)
    ? '模型服务商账户余额不足，选题或写作已暂停。这不是系统会员额度不足，请总管理员充值当前模型账户后继续原任务。' : text
}
