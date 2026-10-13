import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const validChannels = new Set(['news', 'news2', 'social', 'b2b'])
const validFailureActions = new Set(['manual', 'refund', 'retry_same', 'retry_backup'])

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
}

function localDateTime() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/\//g, '-')
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const time = Date.parse(`${value}T00:00:00+08:00`)
  return Number.isFinite(time) ? new Date(time) : null
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function normalizeWeekdays(value) {
  const items = Array.isArray(value) ? value : []
  const days = Array.from(new Set(items.map(Number).filter(day => day >= 1 && day <= 7))).sort((a, b) => a - b)
  return days.length ? days : [1, 3, 5]
}

function weekdayOf(date) {
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

function numberBetween(value, min, max, fallback) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function text(value, max = 120) {
  return String(value || '').trim().slice(0, max)
}

function normalizeMediaPool(input = {}) {
  const channels = Array.isArray(input.channels) ? input.channels.filter(item => validChannels.has(item)) : []
  return {
    name: text(input.name || '默认收藏夹', 40) || '默认收藏夹',
    channels: channels.length ? channels : ['news2'],
    favoriteFolder: text(input.favoriteFolder || '默认收藏夹', 40) || '默认收藏夹',
    backupFolder: text(input.backupFolder || '', 40),
    maxPriceCents: numberBetween(input.maxPriceCents, 0, 10000000, 0),
  }
}

function normalizeDepth(value) {
  const text = String(value || '')
  if (text === 'concise' || text.includes('精选')) return 'concise'
  return 'deep'
}

function normalizePlan(body, previous = null, projects = []) {
  const brand = text(body.brand || previous?.brand, 80)
  if (!brand || !projects.some(project => project.name === brand)) fail(400, '请选择当前项目下的品牌')
  const startDate = text(body.startDate || previous?.startDate || today(), 10)
  const endDate = text(body.endDate || previous?.endDate || '', 10)
  if (!parseDate(startDate)) fail(400, '开始日期无效')
  if (endDate && (!parseDate(endDate) || parseDate(endDate) < parseDate(startDate))) fail(400, '结束日期无效')
  const now = new Date().toISOString()
  return {
    id: previous?.id || randomUUID(),
    brand,
    name: text(body.name || previous?.name || `${brand}自动发布计划`, 80),
    status: body.status === 'paused' ? 'paused' : 'draft',
    startDate,
    endDate,
    weeklyTarget: numberBetween(body.weeklyTarget ?? previous?.weeklyTarget, 1, 200, 5),
    weekdays: normalizeWeekdays(body.weekdays ?? previous?.weekdays),
    perRunCount: numberBetween(body.perRunCount ?? previous?.perRunCount, 1, 100, 1),
    generateLeadDays: numberBetween(body.generateLeadDays ?? previous?.generateLeadDays, 0, 14, 2),
    requireReview: Boolean(body.requireReview ?? previous?.requireReview ?? true),
    mediaPool: normalizeMediaPool(body.mediaPool || previous?.mediaPool || {}),
    failurePolicy: {
      staleDays: numberBetween(body.failurePolicy?.staleDays ?? previous?.failurePolicy?.staleDays, 1, 30, 2),
      action: validFailureActions.has(body.failurePolicy?.action) ? body.failurePolicy.action : previous?.failurePolicy?.action || 'manual',
      maxRetry: numberBetween(body.failurePolicy?.maxRetry ?? previous?.failurePolicy?.maxRetry, 0, 10, 1),
    },
    generationPolicy: {
      articleType: text(body.generationPolicy?.articleType || previous?.generationPolicy?.articleType || '按项目设置', 40),
      writingDepth: text(body.generationPolicy?.writingDepth || previous?.generationPolicy?.writingDepth || '精选', 40),
      allowAutoGenerate: Boolean(body.generationPolicy?.allowAutoGenerate ?? previous?.generationPolicy?.allowAutoGenerate ?? false),
    },
    notes: text(body.notes || previous?.notes || '', 300),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  }
}

export function expandPlan(plan, windowDays = 30) {
  const start = parseDate(plan.startDate)
  const configuredEnd = plan.endDate ? parseDate(plan.endDate) : null
  const end = configuredEnd && configuredEnd < addDays(start, windowDays - 1) ? configuredEnd : addDays(start, windowDays - 1)
  const rows = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const weekday = weekdayOf(cursor)
    if (!plan.weekdays.includes(weekday)) continue
    const articles = plan.perRunCount
    rows.push({
      date: dateKey(cursor),
      weekday,
      enabled: plan.status !== 'paused',
      plannedArticles: articles,
      mediaChannels: plan.mediaPool.channels,
      favoriteFolder: plan.mediaPool.favoriteFolder,
      estimatedMaxCents: plan.mediaPool.maxPriceCents ? plan.mediaPool.maxPriceCents * articles : 0,
      status: 'planned',
    })
  }
  return rows
}

function readStore(dataDirectory) {
  const directory = dataDirectory()
  mkdirSync(directory, { recursive: true })
  const file = resolve(directory, 'auto-publish-plans.json')
  if (!existsSync(file)) return { plans: [], runs: [] }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return { plans: Array.isArray(value.plans) ? value.plans : [], runs: Array.isArray(value.runs) ? value.runs : [] }
  } catch {
    fail(503, '自动发布计划读取失败，已停止写入以保护原有数据')
  }
}

function writeStore(dataDirectory, value) {
  const directory = dataDirectory()
  mkdirSync(directory, { recursive: true })
  const file = resolve(directory, 'auto-publish-plans.json')
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { encoding: 'utf8', flush: true })
  renameSync(`${file}.tmp`, file)
  return value
}

export function buildTaskFromPlan(plan, project, day) {
  const coreKeyword = text(project?.coreKeyword || '', 60)
  if (!coreKeyword) fail(400, '当前品牌缺少核心词，不能生成文章任务')
  const plannedArticles = numberBetween(day?.plannedArticles ?? plan.perRunCount, 1, 100, plan.perRunCount || 1)
  const taskName = `${plan.name}-${day.date}`
  const articleType = plan.generationPolicy?.articleType === '按项目设置' ? '' : text(plan.generationPolicy?.articleType || '', 80)
  return {
    project: plan.brand,
    name: taskName,
    coreKeyword,
    question: coreKeyword,
    limit: String(plannedArticles),
    created: '0',
    knowledge: '',
    detail: `自动发布计划 / ${articleType || '根据选题自动匹配'} / 全部知识库`,
    error: '-',
    status: '待生成',
    latest: '待生成',
    time: localDateTime(),
    batchId: '',
    articleType,
    writingSceneMode: 'AI场景',
    writingDepth: normalizeDepth(plan.generationPolicy?.writingDepth),
    sceneCity: '',
    sceneIndustry: '',
    businessScenes: [],
    imageSource: 'ai',
    sourceAutoPlan: { planId: plan.id, date: day.date, mediaChannels: day.mediaChannels, favoriteFolder: day.favoriteFolder },
  }
}

export function countReadyArticles(articles, brand) {
  return readyArticles(articles, brand).length
}

function readyArticles(articles, brand) {
  return (Array.isArray(articles) ? articles : []).filter(article => (
    article?.project === brand
    && article?.status === '已生成'
    && typeof article.body === 'string'
    && article.body.trim()
  ))
}

export function buildPublishDraftFromPlan(plan, day, articles, excludedIds = []) {
  const excluded = new Set(Array.isArray(excludedIds) ? excludedIds.map(String) : [])
  const selected = readyArticles(articles, plan.brand)
    .filter(article => !excluded.has(String(article.id)))
    .slice(0, numberBetween(day?.plannedArticles, 1, 100, plan.perRunCount || 1))
  if (selected.length < numberBetween(day?.plannedArticles, 1, 100, plan.perRunCount || 1)) fail(409, '成品文章库存不足，请先备稿')
  return {
    id: randomUUID(),
    brand: plan.brand,
    channel: 'auto-publish',
    status: '待确认投放',
    createdAt: new Date().toISOString(),
    date: day.date,
    sourceAutoPlan: { planId: plan.id, date: day.date },
    mediaPool: plan.mediaPool,
    failurePolicy: plan.failurePolicy,
    articles: selected.map(article => ({ id: article.id, title: article.title, body: article.body })),
    resources: [],
    allocations: [],
  }
}

function buildGenerationBody(task, project) {
  const count = numberBetween(task.limit, 1, 100, 1)
  const batchLabel = task.time || localDateTime()
  return {
    project,
    packet: { coreKeyword: task.coreKeyword || project.coreKeyword || '', knowledgeName: task.knowledge || '' },
    task: {
      name: task.name,
      knowledge: task.knowledge || '',
      articleType: task.articleType || '',
      writingSceneMode: task.writingSceneMode || 'AI场景',
      sceneCity: task.sceneCity || '',
      sceneIndustry: task.sceneIndustry || '',
      writingDepth: task.writingDepth || 'deep',
      businessScenes: Array.isArray(task.businessScenes) ? task.businessScenes : [],
      imageSource: task.imageSource || 'ai',
    },
    count,
    taskName: task.name,
    batchId: `${task.project}-${task.name}`,
    batchLabel,
    requestId: `auto-plan-${task.sourceAutoPlan?.planId || 'plan'}-${task.sourceAutoPlan?.date || task.name}`,
  }
}

export function createAutoPublishPlans({ readState, setTaskRows, setDistributionTasks, startGenerationTask, dataDirectory, json, readJson }) {
  const store = () => readStore(dataDirectory)
  const listPlans = () => store().plans.filter(plan => !plan.deletedAt)
  const listRuns = () => store().runs
  const savePlans = value => writeStore(dataDirectory, { ...store(), plans: value })
  const saveRuns = value => writeStore(dataDirectory, { ...store(), runs: value })
  const safe = plan => ({ ...plan, preview: expandPlan(plan, 30) })
  const selectedPlanDay = (plan, date) => {
    const targetDate = text(date || '', 10)
    return expandPlan(plan, 120).find(day => day.date === targetDate) || expandPlan(plan, 30)[0]
  }
  const createOrGetTask = (plan, project, day, overrideCount = null) => {
    const currentTasks = readState('geo.taskRows')
    const existing = currentTasks.find(task => task?.project === plan.brand && task?.sourceAutoPlan?.planId === plan.id && task?.sourceAutoPlan?.date === day.date)
    const task = existing || buildTaskFromPlan(
      plan,
      project,
      overrideCount === null ? day : { ...day, plannedArticles: overrideCount },
    )
    if (!existing) setTaskRows([task, ...currentTasks])
    return { task, existing }
  }
  return {
    expandPlan,
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/api/auto-publish/')) return false
      if (req.method === 'OPTIONS') { json(res, 204, {}); return true }
      if (req.method === 'GET' && url.pathname === '/api/auto-publish/plans') {
        const drafts = readState('geo.distributionTasks').filter(row => row?.channel === 'auto-publish' && row?.status === '待确认投放')
        json(res, 200, { ok: true, plans: listPlans().map(safe), runs: listRuns().slice(0, 100), drafts })
        return true
      }
      if (req.method === 'GET' && url.pathname === '/api/auto-publish/preview') {
        const plan = listPlans().find(item => item.id === url.searchParams.get('id'))
        if (!plan) fail(404, '自动发布计划不存在')
        json(res, 200, { ok: true, preview: expandPlan(plan, numberBetween(url.searchParams.get('days'), 7, 120, 30)) })
        return true
      }
      if (req.method !== 'POST') fail(405, '请求方法不支持')
      const body = await readJson(req)
      const projects = readState('geo.projectRows')
      if (url.pathname === '/api/auto-publish/plans') {
        const plans = listPlans()
        const previous = body.id ? plans.find(item => item.id === body.id) : null
        if (body.id && !previous) fail(404, '自动发布计划不存在')
        const plan = normalizePlan(body, previous, projects)
        const next = previous ? plans.map(item => item.id === plan.id ? plan : item) : [plan, ...plans]
        savePlans(next)
        json(res, 200, { ok: true, plan: safe(plan), plans: next.map(safe) })
        return true
      }
      if (url.pathname === '/api/auto-publish/delete') {
        const plans = listPlans()
        const target = plans.find(item => item.id === body.id)
        if (!target) fail(404, '自动发布计划不存在')
        const next = plans.map(item => item.id === body.id ? { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item)
        savePlans(next)
        json(res, 200, { ok: true, plans: next.filter(item => !item.deletedAt).map(safe) })
        return true
      }
      if (url.pathname === '/api/auto-publish/dry-run') {
        const plan = listPlans().find(item => item.id === body.id)
        if (!plan) fail(404, '自动发布计划不存在')
        const run = {
          id: randomUUID(),
          planId: plan.id,
          brand: plan.brand,
          mode: 'dry-run',
          status: 'checked',
          message: '仅预演计划，不创建文章任务、不扣额度、不发稿。',
          preview: expandPlan(plan, 14),
          createdAt: new Date().toISOString(),
        }
        saveRuns([run, ...listRuns()].slice(0, 200))
        json(res, 200, { ok: true, run, runs: listRuns().slice(0, 100) })
        return true
      }
      if (url.pathname === '/api/auto-publish/create-task') {
        const plan = listPlans().find(item => item.id === body.id)
        if (!plan) fail(404, '自动发布计划不存在')
        if (plan.status === 'paused') fail(409, '计划已暂停，不能生成任务')
        const selectedDay = selectedPlanDay(plan, body.date)
        if (!selectedDay) fail(400, '当前计划没有可生成的执行日期')
        const projects = readState('geo.projectRows')
        const project = projects.find(row => row.name === plan.brand)
        if (!project) fail(400, '品牌项目不存在，不能生成任务')
        const { task, existing } = createOrGetTask(plan, project, selectedDay)
        const run = {
          id: randomUUID(),
          planId: plan.id,
          brand: plan.brand,
          mode: 'create-task',
          status: existing ? 'exists' : 'created',
          taskName: task.name,
          message: existing ? '已存在同日自动任务，未重复创建。' : '已生成普通文章任务，未启动模型生成、未扣发布费、未发稿。',
          date: selectedDay.date,
          createdAt: new Date().toISOString(),
        }
        saveRuns([run, ...listRuns()].slice(0, 200))
        json(res, 200, { ok: true, task, run, runs: listRuns().slice(0, 100) })
        return true
      }
      if (url.pathname === '/api/auto-publish/prepare') {
        const plan = listPlans().find(item => item.id === body.id)
        if (!plan) fail(404, '自动发布计划不存在')
        if (plan.status === 'paused') fail(409, '计划已暂停，不能备稿')
        const selectedDay = selectedPlanDay(plan, body.date)
        if (!selectedDay) fail(400, '当前计划没有可执行日期')
        const projects = readState('geo.projectRows')
        const project = projects.find(row => row.name === plan.brand)
        if (!project) fail(400, '品牌项目不存在，不能备稿')
        const readyCount = countReadyArticles(readState('geo.articleRows'), plan.brand)
        const requiredCount = numberBetween(selectedDay.plannedArticles, 1, 100, plan.perRunCount || 1)
        const shortage = Math.max(0, requiredCount - readyCount)
        let task = null
        let existing = false
        let job = null
        let message = `库存充足：已有${readyCount}篇，可满足${requiredCount}篇。`
        let status = 'ready'
        if (shortage > 0) {
          ;({ task, existing } = createOrGetTask(plan, project, selectedDay, shortage))
          message = existing ? `库存不足${shortage}篇，已存在同日补稿任务。` : `库存不足${shortage}篇，已创建补稿任务。`
          status = existing ? 'task-exists' : 'task-created'
          if (body.start === true || plan.generationPolicy?.allowAutoGenerate) {
            if (!startGenerationTask) fail(503, '自动生成入口尚未接入')
            if (task.jobId) {
              message = `库存不足${shortage}篇，同日补稿任务已在生成流程中。`
              status = 'job-exists'
            } else {
              const generationBody = buildGenerationBody(task, project)
              job = startGenerationTask(generationBody)
              task = { ...task, jobId: job.id, batchId: generationBody.batchId, status: '生成中', latest: '后台任务' }
              setTaskRows(readState('geo.taskRows').map(row => (
                row?.project === task.project && row?.name === task.name ? task : row
              )))
              message = `库存不足${shortage}篇，已启动原文章生成流程。`
              status = 'job-started'
            }
          }
        }
        const run = {
          id: randomUUID(),
          planId: plan.id,
          brand: plan.brand,
          mode: 'prepare',
          status,
          taskName: task?.name,
          message,
          date: selectedDay.date,
          createdAt: new Date().toISOString(),
          stock: { readyCount, requiredCount, shortage },
          jobId: job?.id,
        }
        saveRuns([run, ...listRuns()].slice(0, 200))
        json(res, 200, { ok: true, stock: run.stock, task, job, run, runs: listRuns().slice(0, 100) })
        return true
      }
      if (url.pathname === '/api/auto-publish/publish-draft') {
        const plan = listPlans().find(item => item.id === body.id)
        if (!plan) fail(404, '自动发布计划不存在')
        if (plan.status === 'paused') fail(409, '计划已暂停，不能创建投放包')
        if (!setDistributionTasks) fail(503, '投放池入口尚未接入')
        const selectedDay = selectedPlanDay(plan, body.date)
        if (!selectedDay) fail(400, '当前计划没有可执行日期')
        const current = readState('geo.distributionTasks')
        const existing = current.find(row => row?.channel === 'auto-publish' && row?.sourceAutoPlan?.planId === plan.id && row?.sourceAutoPlan?.date === selectedDay.date && row?.status !== '已取消')
        const reservedArticleIds = current
          .filter(row => row?.channel === 'auto-publish' && row?.status === '待确认投放')
          .flatMap(row => Array.isArray(row.articles) ? row.articles.map(article => article.id) : [])
        const draft = existing || buildPublishDraftFromPlan(plan, selectedDay, readState('geo.articleRows'), reservedArticleIds)
        if (!existing) setDistributionTasks([draft, ...current])
        const run = {
          id: randomUUID(),
          planId: plan.id,
          brand: plan.brand,
          mode: 'publish-draft',
          status: existing ? 'exists' : 'created',
          taskName: draft.articles.map(article => article.title).slice(0, 2).join('；'),
          message: existing ? '已存在同日待确认投放包，未重复创建。' : `已生成待确认投放包：${draft.articles.length}篇文章，未选择媒体、未扣费、未下单。`,
          date: selectedDay.date,
          createdAt: new Date().toISOString(),
        }
        saveRuns([run, ...listRuns()].slice(0, 200))
        const drafts = readState('geo.distributionTasks').filter(row => row?.channel === 'auto-publish' && row?.status === '待确认投放')
        json(res, 200, { ok: true, draft, run, runs: listRuns().slice(0, 100), drafts })
        return true
      }
      fail(404, '接口不存在')
    },
  }
}
