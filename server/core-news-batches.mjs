import { createHash } from 'node:crypto'
const fail = message => { throw Object.assign(new Error(message), { status: 400 }) }
const owned = (row, brand) => (row?.project || row?.brand) === brand
export function taskBatches(tasks, articles, brand) {
  const rows = Array.isArray(articles) ? articles.filter(row => owned(row, brand) && row.status === '已生成' && row.body?.trim()) : []
  const list = (Array.isArray(tasks) ? tasks : []).filter(row => owned(row, brand)).map(task => {
    const id = task.jobId || task.batchId || 'task-' + createHash('sha256').update(JSON.stringify([brand, task.name, task.time])).digest('hex').slice(0, 20)
    const found = rows.filter(row => task.batchId ? row.batchId === task.batchId : !row.batchId && row.taskName === task.name)
    return { id, name: task.name, batchId: task.batchId || '', jobId: task.jobId || '', time: task.time || '', planned: Math.max(0, Number(task.limit) || 0), completed: Math.max(found.length, Number(task.created) || 0), available: found.length, articles: found }
  })
  for (const article of rows) {
    if (!article.batchId || list.some(batch => batch.batchId === article.batchId)) continue
    const found = rows.filter(row => row.batchId === article.batchId)
    list.push({ id: article.batchId, name: article.taskName || article.batchLabel || '历史批次', batchId: article.batchId, jobId: '', time: article.batchLabel || '', planned: found.length, completed: found.length, available: found.length, articles: found })
  }
  return list
}

// Capacity and uniqueness are enforced before any publisher automation is allowed.
export function allocateBatch(articles, targets) {
  if (new Set(articles.map(row => row.id)).size !== articles.length) fail('批次存在重复文章编号，请重新读取')
  if (!Array.isArray(targets) || !targets.length) fail('请先选择媒体并设置篇数')
  const seen = new Set()
  let total = 0
  for (const target of targets) {
    if (!target.id || seen.has(target.id)) fail('媒体重复或缺少编号')
    seen.add(target.id)
    if (!Number.isInteger(target.count) || target.count < 1 || target.count > 200) fail('每个媒体的篇数必须为1到200的整数')
    total += target.count
  }
  if (total > articles.length) fail(`选择了${total}篇，但本批次只有${articles.length}篇可用文章`)
  const remaining = [...articles]
  const assignments = []
  for (const target of targets) {
    const terms = String(target.category || '').split(/[\s,，、/|]+/).filter(Boolean)
    const score = row => terms.reduce((sum, term) => sum + (String(row.title).includes(term) ? 2 : 0) + (String(row.keyword || '').includes(term) ? 1 : 0), 0)
    remaining.sort((a, b) => score(b) - score(a))
    for (const article of remaining.splice(0, target.count)) assignments.push({ articleId: article.id, title: article.title, mediaId: target.id, mediaName: target.name, unitPriceFen: target.priceFen ?? null, reason: terms.length ? '按媒体分类与文章主题匹配' : '媒体无分类信息，按批次顺序分配' })
  }
  return { assignments, articleCount: assignments.length, unassignedCount: remaining.length, totalFen: assignments.every(row => Number.isInteger(row.unitPriceFen)) ? assignments.reduce((sum, row) => sum + row.unitPriceFen, 0) : null, submitted: false }
}
