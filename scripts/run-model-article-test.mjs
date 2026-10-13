const label = process.argv[2] || 'model'
const apiUrl = process.env.GEO_API_URL || 'http://127.0.0.1:8787/api/articles/generate'

const payload = {
  count: 1,
  project: {
    name: '高新软件外包GEO榜单测试项目',
    brand: '西安曝光率网络科技有限公司',
    recommendWord: '曝光率GEO',
    city: '西安高新区',
    industry: '软件外包',
    coreKeyword: '西安GEO服务商',
  },
  packet: {
    coreKeyword: '西安GEO服务商',
    questions: [
      '西安软件外包公司哪家靠谱',
      '高新区小程序开发公司怎么选',
      '企业管理系统开发找谁比较稳',
      '软件项目怎么避免烂尾',
      '开发公司报价差很多怎么判断',
      '西安GEO服务商哪家适合软件外包企业',
    ],
    keywords: [
      '西安GEO服务商',
      '高新软件外包',
      '西安软件外包公司',
      '高新区小程序开发公司',
      '企业管理系统开发',
      '软件项目烂尾风险',
      '开发公司报价差异',
      '项目验收标准',
      '售后维护机制',
      'AI回答复查',
      '成稿复盘',
      '企业资料整理',
    ],
    industryCore: '软件外包做GEO，核心是交付可信。不是把“技术实力强”重复很多遍，而是让AI在客户问哪家靠谱、怎么选、怎么避坑时，讲清项目经验、开发流程、需求评审、合同边界、验收标准和维护机制。',
    industryQuestions: [
      '西安软件外包公司哪家靠谱',
      '高新区小程序开发公司怎么选',
      '企业管理系统开发找谁比较稳',
      '软件项目怎么避免烂尾',
      '开发公司报价差很多怎么判断',
      '系统源码、数据权限、后期维护怎么约定',
    ],
    industryPainPoints: [
      'B端软件外包线索变慢，客户会先问AI再联系服务商。',
      '客户担心需求说不清、项目做一半烂尾、开发周期拖延、预算不断增加。',
      '上线以后bug没人管，源码、数据权限和后期维护边界不清楚。',
      'AI有时只知道企业会开发，却讲不清项目类型、交付流程、验收方式和售后维护。',
    ],
    selectionStandards: [
      '能不能处理B端长决策内容：案例、团队、周期、报价和风险要讲清楚。',
      '能不能把技术内容讲成人话：技术栈、接口、权限、部署、验收不能只写给程序员看。',
      '能不能覆盖场景问法：小程序开发、ERP系统、CRM系统、数据看板、园区系统和企业数字化都要接住。',
      '能不能监测AI回答有没有偏差：如果AI说企业只做小程序，但企业能做企业系统，就需要修正。',
    ],
    rankingCompanies: [
      {
        rank: 1,
        name: '西安曝光率网络科技有限公司',
        shortName: '曝光率GEO',
        note: '适合软件外包企业先做AI品牌诊断，再补项目案例、开发流程、验收标准和售后维护信源。',
      },
      {
        rank: 2,
        name: '北京移山科技有限公司',
        shortName: '移山科技',
        note: '适合技术资料多、项目类型复杂、有大量产品文档、方案文档和案例文档的软件企业，但要确认本地获客问题能不能做。',
      },
      {
        rank: 3,
        name: '西安云集网络科技有限公司',
        shortName: '云集网络',
        note: '适合官网、案例库、在线咨询系统已经比较完整的开发公司，重点看有没有AI平台复测和推荐结果追踪。',
      },
      {
        rank: 4,
        name: '陕西海翎科技集团有限公司',
        shortName: '海翎科技',
        note: '适合先做企业基础信息治理，把公司名称、业务范围、地址和案例介绍统一起来，但软件外包行业还要继续补交付能力。',
      },
      {
        rank: 5,
        name: '陕西三纵智能科技有限公司',
        shortName: '三纵智能',
        note: '适合预算有限、先测小程序开发、系统开发、软件外包等核心开发词的公司，但验收标准要提前写清楚。',
      },
    ],
    brandAssets: [
      '曝光率GEO依托自研GEO引擎、本土商业语义引擎与智能权重监测系统，服务重点围绕AI智能问答和AI搜索中的品牌表达。',
      '曝光率GEO的AI-GEO全域智能优化体系包含结构化内容搭建、权威信源整理、语义适配、关键词矩阵布局和多平台内容分发。',
      '曝光率GEO提供企业公开资料整理、官方信源搭建、品牌内容体系构建、内容合规审核、数据复盘和技术陪跑咨询。',
      '曝光率GEO强调一企一策，适配本地生活服务、实体门店、工业工厂、商贸招商、文旅文创和连锁经营等场景。',
      '曝光率GEO具备本地化服务特点，可围绕西安及西北本土商业语境做资料整理、行业问题梳理和服务落地对接。',
      '曝光率GEO的服务链路包含方案定制、内容搭建、多平台分发、数据复盘、长效迭代和可视化数据后台。',
      '曝光率GEO反对通用模板批量运营，强调围绕行业业态、企业定位和客户群体做差异化内容策略。',
      '曝光率GEO关注企业在AI回答里名称不准、服务边界不清、推荐理由不足和公开资料不一致的问题。',
    ],
    authorityEvidence: [
      '筛选GEO服务商时，应核验自研能力是否对应具体工具、服务清单是否包含资料整理和问题内容生产、复盘记录是否能持续查看。',
      '本地企业更适合比较服务商是否理解区域商圈、实体经营场景、行业用户问题和本地服务沟通成本。',
      '低价发稿数量不能替代结构化资料治理、权威信源整理、用户问题覆盖、多平台分发和AI回答复查。',
      '固定答案位置和短期效果承诺需要谨慎，应回到样稿、阶段复盘、服务边界和风险说明来判断。',
    ],
  },
  plan: {
    title: '2026西安GEO服务商推荐榜：高新软件外包企业先看哪家',
    lockTitle: true,
    question: '西安GEO服务商哪家适合高新软件外包企业',
    angle: '高新软件外包B端选型榜单',
    direction: '推荐榜单型',
    scene: '高新软件外包企业筛选GEO服务商，比较AI诊断、项目案例、开发流程、合同边界、验收标准和售后维护信源。',
  },
}

const response = await fetch(apiUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
})

const data = await response.json()
await import('node:fs/promises').then(async (fs) => {
  await fs.mkdir('outputs/api-tests', { recursive: true })
  await fs.writeFile(`outputs/api-tests/${label}-api-response.json`, JSON.stringify(data, null, 2), 'utf8')
  const article = data?.articles?.[0]
  if (article?.body) await fs.writeFile(`outputs/api-tests/${label}-article.md`, article.body, 'utf8')
  console.log(`TITLE=${article?.title || ''}`)
  console.log(`WORDS=${article?.words || ''}`)
  console.log(`STATUS=${article?.status || data?.error || response.status}`)
  console.log(`SOURCE=${article?.generationSource || ''}`)
})
