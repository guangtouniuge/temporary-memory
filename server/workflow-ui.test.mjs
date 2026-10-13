import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('workflow UI: material scope, project corrections, automatic type, real handoffs and resume', async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: process.env.GEO_TEST_BROWSER || 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(12000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const brand = { name: '咨询测试项目', brand: '咨询测试公司', recommendWord: '咨询测试', coreKeyword: '民企咨询公司', industry: '管理咨询', city: '上海', status: '新建' }
    const store = { 'geo.projectRows': [brand], 'geo.activeBrand': brand.name,
      'geo.keywordRows': [[brand.name, brand.coreKeyword]],
      'geo.keywordLibraryRows': [[brand.name,brand.coreKeyword,'工厂管理咨询','场景业务词','已启用']],
      'geo.knowledgeRows': [[brand.name, '工厂资料'], [brand.name, '连锁资料']],
      'geo.knowledgeContentRows': [[brand.name, '工厂资料', '工厂诊断案例', '工厂成本分析', '案例资料'], [brand.name, '连锁资料', '连锁案例', '连锁经营分析', '']],
      'geo.taskRows': [], 'geo.articleRows': [] }
    let profile = { sourceHash: 'source-a', stale: false, record: { value: { positioning: '成长型民企管理咨询', buyers: ['企业经营者'], scenarios: ['工厂成本管理'], advantages: [{ capability: '经营诊断', customerValue: '明确成本问题', source: 'brand', quote: '工厂成本分析' }], recommendationLogic: '以经营问题匹配咨询能力' }, notes: '', updatedAt: '2026-09-12' } }
    let startBody, resumed = false
    let job = { id: 'test-job-1', project: brand.name, status: 'failed', total: 1, completed: 0, passed: 0, failed: 1, articles: [], logs: [{ time: '10:00', message: '编辑完成，写作接口中断' }], error: '测试连接中断', workflowStage: 'Skill写作:unit:1/2', materialScope: { knowledgeName: '工厂资料', sources: [{ library: '工厂资料', name: '工厂诊断案例' }] }, plans: [{ articleType: '选型指南', writingSceneMode: '按实际场景写', editorialBrief: { businessProblem: '工厂利润下降如何选择咨询公司', serviceBuyer: '工厂经营者', customerIndustry: '制造业', decisionFocus: '成本诊断能力' } }], workflowSteps: [{ key: '项目理解:a', label: '项目理解', status: 'complete', value: profile.record.value }, { key: '单篇编辑:a', label: '单篇编辑', status: 'complete', value: { title: '民企咨询公司怎么选', recommendationAnswer: '按成本诊断经验匹配咨询团队', argument: '经营变化、问题、依据、推荐', units: [{ purpose: '解释成本痛点', writingDirection: '从工厂利润变化切入', connections: '承接经营场景' }] } }] }
    job.workflowSteps.push({ key: '选题交接:recovered', label: '选题交接', status: 'recovered' })
    await page.addInitScript(() => { window.__geoIdentity = { userId: 'test', role: 'project_admin', projectId: 'test' } })
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.pathname === '/api/state') {
        if (req.method() === 'POST') { const { key, value } = req.postDataJSON(); store[key] = value; return route.fulfill({ json: { ok: true, value } }) }
        return route.fulfill({ json: { ok: true, value: store[url.searchParams.get('key')] ?? null } })
      }
      if (url.pathname === '/api/projects/understanding') {
        if (req.method() === 'POST') {
          const data = req.postDataJSON()
          assert.equal(data.action, 'notes', 'test must never request model analysis')
          profile = { ...profile, record: { ...profile.record, notes: data.notes } }
        }
        return route.fulfill({ json: { ok: true, ...profile } })
      }
      if (url.pathname === '/api/jobs/start') { startBody = req.postDataJSON(); return route.fulfill({ json: { ok: true, job } }) }
      if (url.pathname === '/api/jobs/resume') { assert.equal(req.postDataJSON().id, job.id); resumed = true; job = { ...job, status: 'done', completed: 1, passed: 1, failed: 0, error: '' }; return route.fulfill({ json: { ok: true, job } }) }
      if (url.pathname === '/api/jobs/status') return route.fulfill({ json: { ok: true, job } })
      assert.notEqual(url.pathname, '/api/articles/generate', 'UI must not call legacy generation directly')
      return route.fulfill({ json: { ok: true } })
    })
    const base = vite.resolvedUrls.local[0]
    await page.goto(`${base}#/project/projects`)
    await page.getByRole('button', { name: '项目理解', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '项目理解' })
    assert.equal(await dialog.getByRole('button', { name: '更新项目理解', exact: true }).count(), 0)
    await dialog.getByText('成长型民企管理咨询', { exact: true }).waitFor()
    await page.getByLabel('项目理解修正说明').fill('推荐依据优先采用工厂诊断经验')
    await page.getByRole('button', { name: '保存修正', exact: true }).click()
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '保存修正')?.disabled)
    assert.equal(profile.record.notes, '推荐依据优先采用工厂诊断经验')
    mkdirSync('outputs/ui-workflow-mapping', { recursive: true })
    await page.screenshot({ path: 'outputs/ui-workflow-mapping/project-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await dialog.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 391)
    await page.screenshot({ path: 'outputs/ui-workflow-mapping/project-mobile.png' })
    await page.getByRole('button', { name: '关闭项目理解' }).click()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${base}#/project/tasks`)
    await page.getByRole('button', { name: '创建生成任务', exact: true }).first().click()
    const modal = page.locator('.wide-modal')
    assert.equal(await modal.getByRole('button',{name:'AI配图 · 2元/篇（2张，成功扣费）',exact:true}).getAttribute('aria-pressed'),'true')
    assert.equal(await modal.getByRole('button', { name: '深度好文 · 1万字以下' }).getAttribute('aria-pressed'), 'true')
    await modal.getByRole('button', { name: '精选好文 · 2000字以内' }).click()
    assert.equal(await modal.getByRole('button', { name: '精选好文 · 2000字以内' }).getAttribute('aria-pressed'), 'true')
    assert.equal(await modal.getByRole('button',{name:'AI场景',exact:true}).getAttribute('aria-pressed'),'true')
    assert.equal(await modal.getByLabel('场景城市',{exact:true}).count(),0)
    await modal.getByRole('button', { name: '手动场景', exact: true }).click()
    await modal.getByLabel('场景城市',{exact:true}).fill('西安')
    await modal.getByLabel('场景行业',{exact:true}).fill('制造业')
    await modal.locator('select').filter({ has: page.locator('option', { hasText: '工厂资料' }) }).selectOption('工厂资料')
    await modal.locator('select').filter({ has: page.locator('option', { hasText: /^1篇$/ }) }).selectOption('1篇')
    assert.equal(await modal.locator('.type-selector').last().locator('.active').count(), 0)
    assert.equal(await modal.getByText('客户痛点', { exact: true }).count(), 0)
    await page.screenshot({ path: 'outputs/ui-workflow-mapping/task-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    const depthButton = modal.getByRole('button', { name: '精选好文 · 2000字以内' })
    await depthButton.scrollIntoViewIfNeeded()
    const depthBox = await depthButton.boundingBox()
    assert.ok(depthBox.x >= 0 && depthBox.x + depthBox.width <= 391)
    await page.screenshot({ path: 'outputs/ui-workflow-mapping/task-depth-mobile.png' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await modal.getByRole('button', { name: '确定', exact: true }).click()
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await page.getByRole('button', { name: '继续本次任务', exact: true }).waitFor()
    assert.equal(startBody.task.articleType, '')
    assert.equal(startBody.task.writingDepth, 'concise')
    assert.equal(startBody.task.writingSceneMode,'手动场景')
    assert.equal(startBody.task.sceneCity,'西安')
    assert.equal(startBody.task.sceneIndustry,'制造业')
    assert.equal(startBody.task.imageSource,'ai')
    assert.equal(store['geo.taskRows'][0].writingDepth, 'concise')
    assert.equal(startBody.task.knowledge, '工厂资料')
    assert.equal(startBody.task.writingSceneMode, '手动场景')
    assert.deepEqual(startBody.task.businessScenes,[])
    assert.equal(startBody.packet.coreKeyword, '民企咨询公司')
    assert.equal(startBody.plans, undefined)
    assert.equal(startBody.packet.brandAssets, undefined)
    await page.getByText('分配选题角度', { exact: true }).waitFor()
    assert.equal(await page.locator('.workflow-summary details').count(),0)
    assert.equal(await page.getByText('从工厂利润变化切入', { exact: true }).count(),0)
    assert.equal(await page.getByText('本次资料来源', { exact: true }).count(),0)
    await page.screenshot({ path: 'outputs/ui-workflow-mapping/task-handoffs.png', fullPage: true })
    await page.reload()
    await page.getByRole('button', { name: '继续本次任务', exact: true }).click()
    await page.getByText('进度：1/1', { exact: true }).waitFor()
    assert.equal(resumed, true)
    assert.equal(store['geo.taskRows'][0].jobId, 'test-job-1')
    await page.goto('about:blank')
    store['geo.taskRows'][0] = { ...store['geo.taskRows'][0], writingSceneMode: '按自己行业写', jobId: undefined, status: '待生成', created: '0' }
    startBody = undefined
    await page.goto(`${base}#/project/tasks`)
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await page.waitForFunction(()=>document.body.textContent.includes('进度：1/1'))
    assert.equal(startBody.task.writingSceneMode,'AI场景')
    assert.deepEqual(errors, [])
  } finally { await browser.close(); await vite.close() }
})
