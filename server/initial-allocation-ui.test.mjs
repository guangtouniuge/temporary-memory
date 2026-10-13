import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
test('agent enters all opening quotas before account creation',async()=>{
  const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}})
  await vite.listen()
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}})
    let submitted=null
    await page.addInitScript(()=>{window.__geoIdentity={userId:'agent',role:'agent',projectId:'agent'}})
    await page.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url())
      if(url.pathname==='/api/auth/me')return route.fulfill({json:{user:{id:'agent',role:'agent',username:'agent',status:'active'}}})
      if(url.pathname==='/api/admin/users'){
        if(req.method()==='POST')submitted=req.postDataJSON()
        return route.fulfill({json:{ok:true,users:[]}})
      }
      if(url.pathname==='/api/admin/members/packages')return route.fulfill({json:{packages:[]}})
      return route.fulfill({json:{ok:true,value:null,users:[],projects:[]}})
    })
    await page.goto(vite.resolvedUrls.local[0]+'#/agency/accounts')
    await page.getByRole('button',{name:'添加项目账号',exact:true}).click()
    assert.equal(await page.getByLabel('销售登记金额（元）',{exact:true}).count(),0)
    assert.equal(await page.locator('input[name="projectId"]').count(),0)
    await page.getByLabel('登录账号',{exact:true}).fill('opening-client')
    await page.getByLabel('显示名称',{exact:true}).fill('开户测试')
    await page.getByLabel('初始密码',{exact:true}).fill('Opening-test-password')
    await page.getByLabel('项目名称',{exact:true}).fill('测试品牌')
    await page.getByRole('button',{name:'保存账号',exact:true}).click()
    assert.equal(submitted,null)
    for(const label of ['开户文章篇数','开户关键词数','开户空间（MB）','开户项目数','开户点数','开户发布篇数','开户授权账号数'])await page.getByLabel(label,{exact:true}).fill('10')
    await page.getByLabel('开户余额（元）',{exact:true}).fill('12.34')
    await page.screenshot({path:'outputs/initial-allocation-desktop.png',fullPage:true})
    await page.getByRole('button',{name:'保存账号',exact:true}).click()
    await page.getByText('项目账号已创建',{exact:true}).waitFor()
    assert.equal(submitted.initialAllocation.quantities.money,1234)
    assert.equal(submitted.initialAllocation.quantities.articles,10)
    assert.equal(submitted.initialAllocation.days,365)
    assert.equal(submitted.role,'project_admin')
    assert.equal(submitted.saleCents,'0')
    assert.equal(submitted.projectId,undefined)
  } finally {await browser.close();await vite.close()}
})
