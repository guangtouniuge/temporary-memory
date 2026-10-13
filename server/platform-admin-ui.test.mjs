import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('platform menus, settings and agent tabs persist editable data', async () => {
  const vite = await createServer({ configFile: false, base: '/', plugins: [react()], server: { host: '127.0.0.1', port: 0 } })
  await vite.listen()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []; page.on('pageerror', e=>errors.push(e.message))
    const state = { revision: 0, settings: { siteName: '曝光率GEO自研系统', filing: '', seoTitle: '', seoKeywords: '', seoDescription: '', retentionDays: null, taskSize: 100 }, rates: [], policies: {}, audit: [], applications: [] }
    const users = [{ id: 'agent', username: 'agent-test', displayName: '测试代理', role: 'agent', agentId: 'a', workspaceId: 'a', status: 'active' }]
    const balances={money:{available:20000,used:0,held:0},publications:{available:0,used:0,held:0}}
    await page.addInitScript(()=>{ window.__geoIdentity = { userId: 'root', role: 'super_admin', projectId: 'platform' } })
    await page.route('**/api/**', async route => {
      const req = route.request(); const url = new URL(req.url())
      if(url.pathname==='/api/admin/members')return route.fulfill({json:{members:[{...users[0],resources:balances}],resources:{money:'余额',publications:'发布篇数'},canAdjust:true,actorId:'root'}})
      if(url.pathname==='/api/admin/members/adjust-many'){const b=req.postDataJSON();assert.equal(b.userId,'agent');for(const c of b.changes){assert.equal(c.expectedAvailable,balances[c.resource].available);balances[c.resource].available+=c.delta}return route.fulfill({json:{ok:true}})}
      if (url.pathname === '/api/admin/users') return route.fulfill({json:{users:users.filter(u=>!u.deletedAt)}})
      if (url.pathname === '/api/admin/users/deleted') return route.fulfill({json:{users:users.filter(u=>u.deletedAt)}})
      if (url.pathname.startsWith('/api/admin/users/')) {
        const body=req.postDataJSON(); const u=users.find(u=>u.id===body.id)
        if (url.pathname.endsWith('/update')) u.displayName=body.displayName
        if (url.pathname.endsWith('/delete')) { u.deletedAt=new Date().toISOString(); u.status='disabled' }
        if (url.pathname.endsWith('/restore')) delete u.deletedAt
        return route.fulfill({json:{ok:true}})
      }
      if (url.pathname.startsWith('/api/admin/platform')) {
        if (req.method()==='POST') {
          const body = req.postDataJSON(); assert.equal(body.revision,state.revision)
          if (body.settings) state.settings=body.settings
          if (body.policy) state.policies[body.userId]=body.policy
          state.revision++
        }
        return route.fulfill({json:state})
      }
      return route.fulfill({json:{ok:true,value:null,projects:[]}})
    })
    await page.goto(vite.resolvedUrls.local[0]+'#/platform/settings')
    await page.getByLabel('站点名称',{exact:true}).fill('平台展示名称')
    await page.getByRole('button',{name:'保存基础配置',exact:true}).click()
    await page.getByText('配置已保存',{exact:true}).waitFor()
    assert.equal(state.settings.siteName,'平台展示名称')
    await page.getByRole('button',{name:'代理管理',exact:true}).click()
    await page.getByLabel('编辑agent-test',{exact:true}).click()
    await page.getByRole('button',{name:'额度配置',exact:true}).click()
    await page.getByLabel('可用发布篇数',{exact:true}).fill('20')
    await page.getByLabel('额度调整原因').fill('测试增加代理发布额度')
    await page.screenshot({path:'outputs/platform-agent-limits.png',fullPage:true})
    await page.getByRole('button',{name:'保存额度',exact:true}).click()
    await page.getByText('额度已保存',{exact:true}).waitFor()
    assert.equal(balances.publications.available,20);assert.equal(balances.money.available,20000)
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).last().click()
    await page.screenshot({path:'outputs/platform-agent-list.png',fullPage:true})
    await page.getByLabel('修改账户agent-test',{exact:true}).click()
    await page.getByRole('dialog').getByLabel('名称',{exact:true}).fill('更新后的代理')
    await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click()
    await page.getByText('更新后的代理',{exact:true}).waitFor()
    await page.getByLabel('删除agent-test',{exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
    assert.equal(users[0].deletedAt,undefined)
    await page.getByLabel('删除agent-test',{exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'确认',exact:true}).click()
    await page.getByText('暂无匹配账户',{exact:true}).waitFor()
    await page.getByRole('button',{name:'账户回收站',exact:true}).click()
    await page.getByLabel('恢复agent-test',{exact:true}).click()
    await page.getByRole('dialog',{name:'恢复账户',exact:true}).getByRole('button',{name:'确认',exact:true}).click()
    await page.getByText('暂无已删除账户',{exact:true}).waitFor()
    await page.getByRole('dialog',{name:'账户回收站',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByText('更新后的代理',{exact:true}).waitFor()
    assert.equal(users[0].status,'disabled')
    await page.getByRole('button',{name:'实名审核',exact:true}).click()
    await page.getByText('暂无认证申请',{exact:true}).waitFor()
    assert.deepEqual(errors,[])
  } finally { await browser.close(); await vite.close() }
})
