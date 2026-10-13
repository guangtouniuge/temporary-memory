import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('scene word UI supports manual add, edit, delete and AI preview without losing history',async()=>{
 const vite=await createServer({configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:0}});await vite.listen()
 const browser=await chromium.launch({channel:process.env.GEO_TEST_BROWSER||'chrome',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),brand='GEO服务品牌',core='西安GEO公司'
  const old=[brand,core,'旧拓展词','长尾类','已启用']
  const state={'geo.projectRows':[{name:brand,coreKeyword:core,industry:'GEO服务'}],'geo.activeBrand':brand,'geo.keywordRows':[[brand,core]],'geo.keywordLibraryRows':[old]}
  await page.addInitScript(()=>{window.__geoIdentity={userId:'u',role:'project_admin',projectId:'p'}})
  await page.route('**/api/**',async r=>{
   const req=r.request(),url=new URL(req.url())
   if(url.pathname==='/api/state'){
    if(req.method()==='POST'){const {key,value}=req.postDataJSON();state[key]=value;return r.fulfill({json:{ok:true,value}})}
    return r.fulfill({json:{ok:true,value:state[url.searchParams.get('key')]||null}})
   }
   if(url.pathname==='/api/keywords/scenes'){assert.equal(req.postDataJSON().count,2);return r.fulfill({json:{ok:true,words:['宠物诊所GEO','连锁餐饮GEO']}})}
   assert.notEqual(url.pathname,'/api/keywords/expand')
   return r.fulfill({json:{ok:true}})
  })
  await page.goto(vite.resolvedUrls.local[0]+'#/project/questions');await page.waitForLoadState('networkidle')
  await page.getByRole('button',{name:'添加行业词',exact:true}).click()
  await page.getByLabel('场景业务词（每行一个）',{exact:true}).fill('口腔诊所GEO')
  await page.getByRole('button',{name:'保存场景业务词',exact:true}).click()
  await page.locator('.wide-modal').waitFor({state:'hidden'})
  await page.getByText('口腔诊所GEO',{exact:true}).waitFor()
  const row=page.locator('.ops-row').filter({hasText:'口腔诊所GEO'})
  await row.getByRole('button',{name:'编辑',exact:true}).click()
  await page.getByLabel('场景业务词（每行一个）',{exact:true}).fill('口腔连锁GEO')
  await page.getByRole('button',{name:'保存场景业务词',exact:true}).click()
  await page.locator('.wide-modal').waitFor({state:'hidden'})
  await page.getByText('口腔连锁GEO',{exact:true}).waitFor()
  assert.ok(!state['geo.keywordLibraryRows'].some(r=>r[2]==='口腔诊所GEO'))
  await page.getByRole('button',{name:'添加行业词',exact:true}).click()
  await page.getByLabel('拓展数量',{exact:true}).fill('2')
  await page.getByRole('button',{name:'AI拓展',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('textarea')?.value.includes('宠物诊所GEO'))
  assert.equal(state['geo.keywordLibraryRows'].length,2)
  await page.screenshot({path:'outputs/business-scenes-desktop.png'})
  await page.setViewportSize({width:390,height:844})
  const box=await page.locator('.wide-modal').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391)
  await page.screenshot({path:'outputs/business-scenes-mobile.png'})
  await page.getByRole('button',{name:'保存场景业务词',exact:true}).click()
  await page.locator('.wide-modal').waitFor({state:'hidden'})
  await page.getByText('宠物诊所GEO',{exact:true}).waitFor()
  page.on('dialog',d=>d.accept())
  await page.locator('.ops-row').filter({hasText:'口腔连锁GEO'}).getByRole('button',{name:'删除',exact:true}).click()
  await page.waitForFunction(()=>![...document.querySelectorAll('.ops-row')].some(r=>r.textContent.includes('口腔连锁GEO')))
  assert.equal(state['geo.keywordLibraryRows'].length,3)
  assert.ok(state['geo.keywordLibraryRows'].some(r=>r[2]==='旧拓展词'))
 }finally{await browser.close();await vite.close()}
})
