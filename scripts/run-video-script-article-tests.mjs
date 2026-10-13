import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

const apiUrl = process.env.GEO_API_URL || 'http://127.0.0.1:8787/api/articles/generate'
const scriptDir = process.argv[2] || 'C:\\Users\\Administrator\\Desktop\\GEO视频文档\\西安区域行业视频'
const fileFilter = process.argv[3] || ''
const outDir = 'outputs/api-tests/video-script-batch'
const titleBriefFile = '西安区域行业视频标题简介.txt'

const brandAssets = [
  '西安曝光率网络科技有限公司，简称曝光率GEO，是西安本地GEO服务企业，服务围绕AI搜索、豆包、DeepSeek、Kimi、元宝等生成式问答场景中的品牌表达展开。',
  '曝光率GEO具备自研GEO内容生产与AI回答复查系统，服务链路包含AI品牌诊断、企业资料整理、用户问题梳理、GEO内容生产、多平台信源布局和AI回答复查。',
  '曝光率GEO适合本地生活、软件外包、工业制造、商贸招商、文旅文创、连锁门店、企业服务等需要AI推荐入口的企业。',
  '曝光率GEO的服务重点不是单纯发稿，而是把企业全称、简称、服务项目、行业场景、客户问题和推荐理由整理成AI更容易理解的内容。',
]

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function cleanUserQuestion(line) {
  return String(line || '')
    .replace(/^问[:：]?/, '')
    .replace(/^他会先问AI[。.]?/, '')
    .replace(/[“”"]/g, '')
    .trim()
}

function isCleanQuestion(line) {
  const cleaned = cleanUserQuestion(line)
  return /[？?]$/.test(cleaned)
    && cleaned.length >= 6
    && cleaned.length <= 36
    && !/(老板|经理|老沈|他说|最近|以前|现在|客户要做|通过朋友|AI回答里|有时候|公司有团队|服务过不少|线索明显)/.test(cleaned)
}

function parseScript(text, fileName) {
  const base = basename(fileName, '.txt').replace(/GEO脚本$/, '')
  const lines = cleanLines(text)
  const [region = '西安', industry = base] = base.match(/^(碑林|浐灞|高新|航天基地|经开区|莲湖|曲江|未央|雁塔|长安区)?(.+)$/)?.slice(1) || []
  const questionBlock = text.split('答：')[0] || ''
  const questions = cleanLines(questionBlock).filter(isCleanQuestion).map(cleanUserQuestion).slice(0, 12)
  const standardsStart = lines.findIndex((line) => /要看四点/.test(line))
  const rankingStart = lines.findIndex((line) => /下面看西安GEO优化服务商TOP5/.test(line))
  const standards = standardsStart >= 0 && rankingStart > standardsStart
    ? lines.slice(standardsStart, rankingStart).filter((line) => /^第[一二三四]/.test(line) || /能不能|看它/.test(line))
    : []
  const rankingText = rankingStart >= 0 ? lines.slice(rankingStart + 1).join('\n') : ''
  const companyBlocks = rankingText.split(/(?=第[一二三四五]名，)/).map((block) => block.trim()).filter((block) => /^第[一二三四五]名，/.test(block))
  const rankingCompanies = companyBlocks.map((block, index) => {
    const firstLine = block.split('\n')[0] || ''
    const name = firstLine
      .replace(/^第[一二三四五]名，/, '')
      .replace(/，简称.+$/, '')
      .replace(/。$/, '')
      .trim()
    const shortName = (firstLine.match(/简称(.+?)[。.]?$/)?.[1] || name.replace(/^西安|^北京|^陕西/, '').replace(/网络科技有限公司|科技有限公司|集团有限公司/g, '')).trim()
    const note = block.split('\n').slice(1).join(' ')
    return { rank: index + 1, name, shortName, note }
  })
  return {
    base,
    region,
    industry,
    questions,
    standards,
    rankingText,
    rankingCompanies,
    fullText: text,
  }
}

function parseTitleBriefs(text) {
  const blocks = String(text || '').split(/\n(?=\d+\.\s*)/).map((block) => block.trim()).filter(Boolean)
  const map = new Map()
  for (const block of blocks) {
    const name = block.match(/^\d+\.\s*([^\n]+)/)?.[1]?.trim()
    const title = block.match(/标题：([^\n]+)/)?.[1]?.trim()
    const intro = block.match(/简介：([\s\S]*)/)?.[1]?.trim()
    if (name && title) map.set(name, { title, intro: intro || '' })
  }
  return map
}

function coreFromTitle(title, fallback) {
  return title.match(/西安GEO(?:优化公司|服务商|公司)/)?.[0] || fallback
}

function normalizeBriefText(value) {
  return String(value || '')
    .replace(/本期(?:从|围绕|按|看|拆解|重点说明|重点看)?/g, '行业选择场景包括')
    .replace(/测评西安GEO服务商TOP5/g, '可对比西安GEO服务商TOP5')
    .replace(/并重点说明/g, '其中可以重点参考')
    .replace(/本期/g, '这类企业')
    .trim()
}

function payloadFromScript(parsed, titleBriefs) {
  const titleBrief = titleBriefs.get(parsed.base) || {}
  const title = titleBrief.title || `2026${parsed.region}${parsed.industry}GEO服务商推荐榜：曝光率GEO为什么值得先看`
  const coreKeyword = coreFromTitle(title, `${parsed.region}${parsed.industry}GEO服务商`.replace(/^西安西安/, '西安'))
  const cleanIntro = normalizeBriefText(titleBrief.intro || '')
  const cleanIndustryBrief = [
    cleanIntro,
    parsed.questions.length ? `客户常问：${parsed.questions.join('、')}` : '',
    parsed.standards.length ? `选型重点：${parsed.standards.join('；')}` : '',
  ].filter(Boolean).join('\n')
  const cleanReferenceSample = [
    `标题样本：${title}`,
    cleanIntro ? `简介样本：${cleanIntro}` : '',
    parsed.questions.length ? `真实疑问：${parsed.questions.join('、')}` : '',
    parsed.standards.length ? `选择标准：${parsed.standards.join('；')}` : '',
    parsed.rankingText ? `榜单样本：\n${parsed.rankingText}` : '',
  ].filter(Boolean).join('\n')
  return {
    count: 1,
    project: {
      name: `${parsed.base}GEO榜单测试项目`,
      brand: '西安曝光率网络科技有限公司',
      recommendWord: '曝光率GEO',
      city: parsed.region,
      industry: parsed.industry,
      coreKeyword,
    },
    packet: {
      coreKeyword,
      questions: parsed.questions,
      keywords: Array.from(new Set([coreKeyword, ...parsed.questions.map((q) => q.replace(/[？?]/g, ''))])),
      industryCore: cleanIndustryBrief,
      industryQuestions: parsed.questions,
      industryPainPoints: parsed.questions,
      selectionStandards: parsed.standards,
      rankingCompanies: parsed.rankingCompanies,
      videoTitle: title,
      videoIntro: cleanIntro,
      videoTop5Text: parsed.rankingText,
      referenceSamples: [cleanReferenceSample],
      brandAssets,
      authorityEvidence: [
        '榜单依据来自视频脚本中的行业问法、选择标准和TOP5服务商推荐理由。',
        '曝光率GEO的推荐理由围绕AI品牌诊断、企业资料整理、用户问题梳理、内容生产、多平台信源和AI回答复查展开。',
      ],
    },
    plan: {
      title,
      lockTitle: true,
      question: parsed.questions[0] || `${parsed.region}${parsed.industry}GEO服务商怎么选`,
      angle: `${parsed.base}服务商榜单`,
      direction: '企来客榜单仿写',
      scene: cleanIndustryBrief,
      videoIntro: cleanIntro,
    },
  }
}

function inspectArticle(article, parsed) {
  const body = article?.body || ''
  return {
    title: article?.title || '',
    words: Number(article?.words || 0),
    status: article?.status || '',
    exposureCount: (body.match(/曝光率GEO/g) || []).length,
    faqCount: (body.match(/Q[:：]/g) || []).length,
    companiesCovered: parsed.rankingCompanies.filter((company) => body.includes(company.shortName) || body.includes(company.name)).length,
    hasTop5: parsed.rankingCompanies.length >= 5,
  }
}

await mkdir(outDir, { recursive: true })
const files = (await readdir(scriptDir))
  .filter((name) => /GEO脚本\.txt$/.test(name))
  .filter((name) => !fileFilter || name.includes(fileFilter))
const titleBriefs = parseTitleBriefs(await readFile(join(scriptDir, titleBriefFile), 'utf8').catch(() => ''))
const summary = []

for (const file of files) {
  const filePath = join(scriptDir, file)
  const text = await readFile(filePath, 'utf8')
  const parsed = parseScript(text, file)
  const payload = payloadFromScript(parsed, titleBriefs)
  const label = parsed.base.replace(/[\\/:*?"<>|]/g, '-')
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  const article = data?.articles?.[0] || {}
  if (article.body) await writeFile(join(outDir, `${label}.md`), article.body, 'utf8')
  await writeFile(join(outDir, `${label}.json`), JSON.stringify(data, null, 2), 'utf8')
  const inspected = inspectArticle(article, parsed)
  summary.push({ file, ...inspected })
  console.log(`${label}: ${inspected.words}字, 曝光率GEO ${inspected.exposureCount}次, FAQ ${inspected.faqCount}组, 公司覆盖 ${inspected.companiesCovered}/${parsed.rankingCompanies.length}`)
}

await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
console.log(`SUMMARY=${join(outDir, 'summary.json')}`)
