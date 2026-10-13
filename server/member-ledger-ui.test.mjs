import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createMemberLedger } from './member-ledger.mjs'

test('member UI credits, debits, failed adjustment and history use the ledger', async()=>{
  const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}})
  await vite.listen()
  const browser=await chromium.launch({channel:'chrome',headless:true})
  const ledger=createMemberLedger(':memory:')
  const root={id:'root',role:'super_admin'}, agent={id:'agent',username:'agent-test',displayName:'测试代理',role:'agent',agentId:'a'}
  try {
    const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(()=>{window.__geoIdentity={userId:'root',role:'super_admin',projectId:'platform'}})
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname
      if(path.startsWith('/api/admin/members')) {
        try {const result=ledger.handle({actor:root,users:[root,agent],path,method:req.method(),body:req.method()==='POST'?req.postDataJSON():{}});return route.fulfill({json:result})}
        catch(e){return route.fulfill({status:e.status||500,json:{error:e.message}})}
      }
      return route.fulfill({json:{ok:true,value:null,projects:[]}})
    })
    await page.goto(vite.resolvedUrls.local[0]+'#/platform/members')
    await page.getByRole('button',{name:'套餐管理',exact:true}).click()
    await page.getByRole('button',{name:'添加套餐',exact:true}).click()
    const editor=page.getByRole('dialog',{name:'添加套餐',exact:true})
    await editor.getByLabel('套餐名称').fill('试用五篇')
    await editor.getByLabel('文章篇数',{exact:true}).fill('5')
    await editor.getByRole('button',{name:'保存套餐'}).click()
    await editor.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'分配套餐',exact:true}).click()
    const grant=page.getByRole('dialog',{name:'分配套餐额度',exact:true})
    await grant.getByLabel('分配原因').fill('试用开户')
    await grant.getByRole('button',{name:'确认分配'}).click()
    await grant.waitFor({state:'hidden'})
    assert.equal(ledger.summary('agent').articles.available,5)
    await page.getByLabel('编辑套餐试用五篇').click()
    const edit=page.getByRole('dialog',{name:'编辑套餐',exact:true})
    await edit.getByLabel('套餐名称').fill('标准五篇')
    await edit.getByRole('button',{name:'保存套餐'}).click()
    await edit.waitFor({state:'hidden'})
    await page.getByLabel('删除套餐标准五篇').click()
    await page.getByRole('button',{name:'确认删除',exact:true}).click()
    await page.getByRole('dialog',{name:'删除套餐',exact:true}).waitFor({state:'hidden'})
    await page.getByText('暂无套餐',{exact:true}).waitFor()
    assert.equal(ledger.summary('agent').articles.available,5)
    await page.getByRole('dialog',{name:'统一套餐管理',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByRole('button',{name:'经营账目',exact:true}).click()
    await page.getByLabel('修改收支测试代理').click()
    const accounting=page.getByRole('dialog',{name:'收支登记（元）',exact:true})
    await accounting.getByLabel('累计实收').fill('100')
    await accounting.getByLabel('累计退款').fill('10')
    await accounting.getByLabel('实际成本').fill('20')
    await accounting.getByLabel('记账依据').fill('收款凭证测试')
    await accounting.getByRole('button',{name:'保存登记'}).click()
    await accounting.waitFor({state:'hidden'})
    await page.getByRole('dialog',{name:'套餐经营账目',exact:true}).getByText('70.00',{exact:true}).waitFor()
    await page.screenshot({path:'outputs/member-commerce-desktop.png',fullPage:true})
    await page.getByRole('button',{name:'修改记录',exact:true}).click()
    await page.getByRole('dialog',{name:'收支修改记录'}).getByText('收款凭证测试').waitFor()
    await page.getByRole('dialog',{name:'收支修改记录'}).getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByRole('dialog',{name:'套餐经营账目',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
    await page.getByLabel('增加额度agent-test',{exact:true}).click()
    await page.getByLabel('资源类型').selectOption('money')
    await page.getByLabel('调整数量').fill('123.45')
    await page.getByLabel('调整原因').fill('测试入账')
    await page.getByRole('button',{name:'确认调整',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    assert.equal(ledger.summary('agent').money.available,12345)
    await page.getByLabel('减少额度agent-test',{exact:true}).click()
    await page.getByLabel('调整数量').fill('200')
    await page.getByLabel('调整原因').fill('测试不足')
    await page.getByRole('button',{name:'确认调整',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'可用额度不足'}).waitFor()
    assert.equal(ledger.summary('agent').money.available,12345)
    await page.getByLabel('调整数量').fill('23.45')
    await page.getByRole('button',{name:'确认调整',exact:true}).click()
    await page.getByRole('dialog').waitFor({state:'hidden'})
    assert.equal(ledger.summary('agent').money.available,10000)
    await page.screenshot({path:'outputs/member-ledger-desktop.png',fullPage:true})
    await page.getByLabel('额度流水agent-test',{exact:true}).click()
    await page.getByText('测试入账',{exact:true}).waitFor()
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
    await page.setViewportSize({width:390,height:844})
    await page.getByLabel('增加额度agent-test',{exact:true}).click()
    await page.screenshot({path:'outputs/member-ledger-mobile.png',fullPage:true})
    const box=await page.getByRole('dialog').boundingBox()
    assert.ok(box.x>=0 && box.x+box.width<=391)
    assert.deepEqual(errors,[])
  } finally {ledger.close();await browser.close();await vite.close()}
})
