import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdirSync} from 'node:fs'

const base=process.env.GEO_VERIFY_ORIGIN
if(!['https://geoskill.7chacha.com','http://127.0.0.1:5173'].includes(base))throw Error('Unexpected verification target')
const browser=await chromium.launch({channel:'chrome',headless:true})
const context=await browser.newContext({viewport:{width:1600,height:1100}})
const api=context.request
try{
  let response=await api.post(base+'/api/auth/login',{data:{username:process.env.GEO_VERIFY_USER,password:process.env.GEO_VERIFY_PASSWORD}})
  assert.equal(response.status(),200,'Login failed')
  if(process.env.GEO_VERIFY_TARGET){
    response=await api.post(base+'/api/auth/management/enter',{data:{userId:process.env.GEO_VERIFY_TARGET}})
    assert.equal(response.status(),200,'Project access failed')
  }
  response=await api.get(base+'/api/media/resources?channel=social&platform=1003&verification=6001')
  assert.equal(response.status(),200)
  const catalog=await response.json()
  assert.equal(catalog.complete,true)
  assert.ok(catalog.total>0)
  assert.ok(catalog.resources.every(r=>r.details.platform==='网易号'&&r.details.verification==='已认证'))
  console.log(JSON.stringify({catalogTotal:catalog.catalogTotal,verifiedNetease:catalog.total,enterpriseSubject:catalog.resources[0].details.subject}))
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/gongju/geo#/project/distribution')
  await page.getByRole('heading',{name:'补充媒体投喂',exact:true}).waitFor()
  await page.locator('.media-task-table tbody tr').first().waitFor()
  await page.getByLabel('全选任务',{exact:true}).check()
  const next=page.getByRole('button',{name:/发布 · 已选[1-9]/})
  await next.waitFor();await next.click()
  await page.getByLabel('所属平台').selectOption('1003')
  await page.getByLabel('认证状态').selectOption('6001')
  await page.waitForResponse(r=>r.url().includes('/api/media/resources?')&&r.url().includes('verification=6001'))
  await page.locator('.media-resource-table tbody tr').first().waitFor()
  mkdirSync('outputs',{recursive:true})
  await page.screenshot({path:'outputs/social-classification-online.png',fullPage:true})
  assert.equal(await page.getByRole('button',{name:'B2B网站',exact:true}).count(),0)
  await page.goto(base+'/gongju/geo#/project/media-b2b')
  await page.getByRole('heading',{name:'新闻渠道-1',exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('Live named channels and legacy B2B redirect passed; no quotes or submissions created')
}finally{
  await api.post(base+'/api/auth/logout',{data:{}}).catch(()=>{})
  await context.close();await browser.close()
}
