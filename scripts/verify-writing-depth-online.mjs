import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const base = 'https://geoskill.7chacha.com'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const api = context.request
try {
  const login = await api.post(base + '/api/auth/login', { data: { username: process.env.GEO_VERIFY_USER, password: process.env.GEO_VERIFY_PASSWORD } })
  assert.equal(login.status(), 200, 'Login failed')
  const enter = await api.post(base + '/api/auth/management/enter', { data: { userId: process.env.GEO_VERIFY_TARGET } })
  assert.equal(enter.status(), 200, 'Project access failed')
  const response = await api.get(base + '/api/media/resources?channel=news')
  assert.equal(response.status(), 200)
  const news = await response.json()
  assert.ok(news.catalogTotal > 10000)
  assert.ok(news.resources.length > 0)
  const contentResponse = await api.get(base + '/api/news/content')
  assert.equal(contentResponse.status(), 200)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base + '/gongju/geo#/project/tasks')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '创建生成任务', exact: true }).first().click()
  const modal = page.locator('.wide-modal')
  const deep = modal.getByRole('button', { name: '深度好文 · 1万字以下', exact: true })
  const concise = modal.getByRole('button', { name: '精选好文 · 2000字以内', exact: true })
  try { await deep.waitFor() } catch (error) {
    await page.screenshot({ path: 'outputs/writing-depth-online-failure.png', fullPage: true })
    console.log((await page.locator('body').innerText()).slice(-2000))
    throw error
  }
  assert.equal(await deep.getAttribute('aria-pressed'), 'true')
  await concise.click()
  assert.equal(await concise.getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: 'outputs/writing-depth-online.png', fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ depthSelection: 'passed', newsCatalog: news.catalogTotal, newsContent: contentResponse.status(), generatedOrPublished: false }))
} finally {
  await api.post(base + '/api/auth/logout', { data: {} }).catch(() => {})
  await context.close()
  await browser.close()
}
