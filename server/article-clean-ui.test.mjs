import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('unconnected diagnostic and analytics pages never invent results or successful exports', async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    await page.addInitScript(() => { window.__geoIdentity = { userId: 'test', role: 'project_admin', projectId: 'project-a' } })
    await page.route('**/api/**', route => route.fulfill({ json: { ok: true, value: null } }))
    await page.goto(vite.resolvedUrls.local[0] + '#/project/visibility')
    await page.getByText('诊断服务暂未接入，暂无真实诊断结果。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '创建诊断任务' }).count(), 0)
    assert.equal(await page.getByText('78%', { exact: true }).count(), 0)
    await page.goto(vite.resolvedUrls.local[0] + '#/project/data')
    await page.getByText('统计服务暂未接入，暂无统计报表。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '导出数据' }).count(), 0)
    await page.getByRole('button', { name: '成品文章库', exact: true }).last().click()
    await page.waitForURL('**/#/project/library')
    await page.locator('.operation-toolbar').getByText('成品文章库', { exact: true }).waitFor()
  } finally { await browser.close(); await vite.close() }
})

test('article library and editable preview show news without system metadata', async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    const store = { 'geo.activeBrand': '品牌A', 'geo.projectRows': [{ name: '品牌A' }], 'geo.articleRows': [{ id: 'a', title: '新闻测试标题', project: '品牌A', body: '## 第一名：测试企业\n\n正文讨论API技术与关键词应用，这些正常内容应保留。', words: '100', status: '已生成', generationSource: 'API成稿', keyword: '内部核心词' }] }
    await page.addInitScript(() => { window.__geoIdentity = { userId: 'test', role: 'project_admin', projectId: 'project-a' } })
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url())
      return route.fulfill({ json: { ok: true, value: store[url.searchParams.get('key')] ?? null } })
    })
    await page.goto(vite.resolvedUrls.local[0] + '#/project/library')
    await page.getByRole('button', { name: '全文查看', exact: true }).click()
    assert.equal(await page.getByText('内部核心词', { exact: false }).count(), 0)
    assert.equal(await page.getByText('API成稿', { exact: false }).count(), 0)
    await page.getByRole('heading', { name: '第一名：测试企业' }).waitFor()
    await page.screenshot({ path: 'outputs/article-clean-preview.png', fullPage: true })
    await page.getByRole('button', { name: '编辑文章', exact: true }).click()
    assert.equal(await page.locator('.article-meta-line').count(), 0)
    assert.match(await page.getByLabel('文章正文', { exact: true }).inputValue(), /API技术与关键词应用/)
  } finally { await browser.close(); await vite.close() }
})
