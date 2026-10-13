import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPublishDraftFromPlan, buildTaskFromPlan, countReadyArticles, expandPlan } from './auto-publish-plans.mjs'

test('auto publish plan expands selected weekdays without touching orders', () => {
  const days = expandPlan({
    startDate: '2026-10-05',
    endDate: '2026-10-18',
    status: 'draft',
    weekdays: [1, 3, 5],
    perRunCount: 2,
    mediaPool: { channels: ['news2', 'social'], favoriteFolder: '核心收藏夹', maxPriceCents: 3000 },
  }, 30)
  assert.deepEqual(days.map(day => day.date), ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12', '2026-10-14', '2026-10-16'])
  assert.equal(days[0].plannedArticles, 2)
  assert.deepEqual(days[0].mediaChannels, ['news2', 'social'])
  assert.equal(days[0].favoriteFolder, '核心收藏夹')
  assert.equal(days[0].estimatedMaxCents, 6000)
})

test('paused plan preview is disabled but still visible', () => {
  const days = expandPlan({
    startDate: '2026-10-05',
    status: 'paused',
    weekdays: [1],
    perRunCount: 1,
    mediaPool: { channels: ['news'], favoriteFolder: '默认收藏夹', maxPriceCents: 0 },
  }, 7)
  assert.equal(days.length, 1)
  assert.equal(days[0].enabled, false)
})

test('auto publish plan builds a normal pending generation task', () => {
  const task = buildTaskFromPlan(
    {
      id: 'plan-1',
      brand: '测试品牌',
      name: '测试自动计划',
      perRunCount: 3,
      generationPolicy: { articleType: '选型指南', writingDepth: '精选' },
    },
    { coreKeyword: '西安GEO公司' },
    {
      date: '2026-10-12',
      plannedArticles: 3,
      mediaChannels: ['news2'],
      favoriteFolder: '默认收藏夹',
    },
  )

  assert.equal(task.project, '测试品牌')
  assert.equal(task.name, '测试自动计划-2026-10-12')
  assert.equal(task.coreKeyword, '西安GEO公司')
  assert.equal(task.limit, '3')
  assert.equal(task.status, '待生成')
  assert.equal(task.latest, '待生成')
  assert.equal(task.writingDepth, 'concise')
  assert.equal(task.imageSource, 'ai')
  assert.deepEqual(task.sourceAutoPlan, {
    planId: 'plan-1',
    date: '2026-10-12',
    mediaChannels: ['news2'],
    favoriteFolder: '默认收藏夹',
  })
})

test('ready stock only counts generated articles with body for the same brand', () => {
  const count = countReadyArticles([
    { project: '品牌A', status: '已生成', body: '正文' },
    { project: '品牌A', status: '已生成', body: '   ' },
    { project: '品牌A', status: '生成异常', body: '正文' },
    { project: '品牌B', status: '已生成', body: '正文' },
  ], '品牌A')

  assert.equal(count, 1)
})

test('auto publish draft locks articles but does not select media or create orders', () => {
  const draft = buildPublishDraftFromPlan(
    {
      id: 'plan-1',
      brand: '品牌A',
      perRunCount: 2,
      mediaPool: { channels: ['news2'], favoriteFolder: '核心收藏夹' },
      failurePolicy: { staleDays: 2, action: 'manual', maxRetry: 1 },
    },
    { date: '2026-10-12', plannedArticles: 2 },
    [
      { id: 'a1', project: '品牌A', title: '文章一', status: '已生成', body: '正文一' },
      { id: 'a2', project: '品牌A', title: '文章二', status: '已生成', body: '正文二' },
      { id: 'b1', project: '品牌B', title: '其他品牌', status: '已生成', body: '正文' },
    ],
  )

  assert.equal(draft.status, '待确认投放')
  assert.equal(draft.channel, 'auto-publish')
  assert.equal(draft.articles.length, 2)
  assert.deepEqual(draft.resources, [])
  assert.deepEqual(draft.allocations, [])
  assert.deepEqual(draft.sourceAutoPlan, { planId: 'plan-1', date: '2026-10-12' })
})

test('auto publish draft skips articles already reserved by another draft', () => {
  const draft = buildPublishDraftFromPlan(
    { id: 'plan-1', brand: '品牌A', perRunCount: 1, mediaPool: { channels: ['news2'] }, failurePolicy: {} },
    { date: '2026-10-13', plannedArticles: 1 },
    [
      { id: 'a1', project: '品牌A', title: '已占用', status: '已生成', body: '正文一' },
      { id: 'a2', project: '品牌A', title: '可投放', status: '已生成', body: '正文二' },
    ],
    ['a1'],
  )

  assert.equal(draft.articles[0].id, 'a2')
})
