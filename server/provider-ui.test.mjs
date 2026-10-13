import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'

for (const role of ['project_admin', 'project_operator']) test(`${role}: provider controls match server permissions`, async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    if(process.env.PROVIDER_PATCH_TEST) {
      await page.route('**/patched.js',async route=>route.fulfill({contentType:'text/javascript',body:await fs.readFile('outputs/provider-patched.js','utf8')}))
      await page.route('**/patched.css',async route=>route.fulfill({contentType:'text/css',body:await fs.readFile('outputs/provider-patched.css','utf8')}))
      await page.route(vite.resolvedUrls.local[0],route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><head><link rel="stylesheet" href="/patched.css"></head><body><div id="root"></div><script type="module" src="/patched.js"></script></body></html>'}))
    }
    const store = { 'geo.activeBrand': '品牌A', 'geo.projectRows': [{ name: '品牌A', recommendWord: '主推荐企业' }] }
    const calls = []
    await page.addInitScript(role => { window.__geoIdentity = { userId: 'test', role, projectId: 'project-a' } }, role)
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url())
      if (url.pathname === '/api/state') {
        if (req.method() === 'POST') { const body = req.postDataJSON(); store[body.key] = body.value }
        return route.fulfill({ json: { ok: true, value: store[url.searchParams.get('key')] ?? null } })
      }
      if (url.pathname === '/api/providers/research') {
        const { company, brand } = req.postDataJSON(); assert.equal(brand, '品牌A'); calls.push(company)
        return route.fulfill({ json: { research: { company, status: 'ready', note: '来源资料', facts: [{ category: '服务', text: '提供驻场服务', sourceType: '企业自述', source: { title: '企业官网', url: 'https://example.com/about' } }] } } })
      }
      return route.fulfill({ json: { ok: true } })
    })
    await page.goto(vite.resolvedUrls.local[0] + '#/project/candidates')
    await page.getByRole('button', { name: '添加4家公司', exact: true }).first().click()
    const fields = page.locator('.company-name-grid input')
    await fields.nth(0).fill('同行甲'); await fields.nth(1).fill('同行乙')
    await fields.nth(2).fill('同行丙'); await fields.nth(3).fill('同行丁')
    await page.getByRole('button', { name: '保存并查询资料', exact: true }).click()
    await page.getByText('同行甲', { exact: true }).waitFor()
    await page.getByText('1条资料', { exact: true }).nth(3).waitFor()
    assert.deepEqual(calls, ['同行甲', '同行乙', '同行丙', '同行丁'])
    await page.getByRole('button', { name: '编辑4家公司', exact: true }).click()
    await fields.nth(0).fill('新同行甲')
    await fields.nth(1).fill('新同行乙')
    await fields.nth(2).fill('新同行丙')
    await fields.nth(3).fill('新同行丁')
    await page.getByRole('button', { name: '保存并查询资料', exact: true }).click()
    await page.getByText('新同行甲', { exact: true }).waitFor()
    assert.deepEqual(store['geo.rankingCandidateRows'].slice(0,4).map(row=>row[1]), ['新同行甲', '新同行乙', '新同行丙', '新同行丁'])
    await page.getByText('1条资料', { exact: true }).nth(3).waitFor()
    assert.equal(await page.locator('.provider-summary p').filter({hasText:'提供驻场服务'}).count(),4)
    assert.equal(await page.locator('.simple-candidate-table').evaluate(el=>el.scrollHeight<=el.clientHeight+2),true)
    await page.screenshot({...(process.env.PROVIDER_PATCH_TEST?{}:{path:'outputs/provider-list-desktop.png'}),fullPage:true})
    await page.setViewportSize({width:390,height:844})
    assert.equal(await page.locator('.simple-candidate-table').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true)
    await page.screenshot({...(process.env.PROVIDER_PATCH_TEST?{}:{path:'outputs/provider-list-mobile.png'}),fullPage:true})
    await page.setViewportSize({width:1366,height:900})
    await page.getByRole('button', { name: '业务介绍', exact:true }).first().click()
    await page.getByText('新同行甲 · 业务介绍',{exact:true}).waitFor()
    assert.equal(await page.locator('.form-modal a').count(),0)
    await page.screenshot({ ...(process.env.PROVIDER_PATCH_TEST?{}:{path:'outputs/provider-research-preview.png'}), fullPage: true })
    assert.equal(JSON.parse(store['geo.rankingCandidateRows'][0][8]).facts.length, 1)
    await page.reload()
    await page.locator('.provider-summary p').filter({hasText:'提供驻场服务'}).nth(3).waitFor()
    assert.equal(calls.length,8)
    assert.equal(await page.getByRole('button',{name:'更新资料',exact:true}).count(),0)
    store['geo.rankingCandidateRows']=store['geo.rankingCandidateRows'].map(row=>row.slice(0,8))
    await page.reload()
    await page.getByText('1条资料',{exact:true}).nth(3).waitFor()
    assert.ok(calls.length>=8)
  } finally { await browser.close(); await vite.close() }
})
