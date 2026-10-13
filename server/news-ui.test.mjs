import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
test('news page loads selectable content, confirms quote and shows individual states',async()=>{
 const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}});await vite.listen()
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  let dispatched=false,quotes=0,dispatches=0,deleted=false,serverOrders=[]
  const articles=[{id:'a',title:'可选成品文章',body:'这是成品正文。',status:'已生成',project:'测试品牌',words:'8',batchId:'task-1',taskName:'测试生成任务'}]
  const order={id:'order-1',articleId:'a',title:articles[0].title,content:articles[0].body,mediaTitle:'测试新闻媒体',priceCents:1000,brand:'测试品牌',sourceTask:'task-1'}
  await page.addInitScript(()=>{window.__geoIdentity={userId:'test',role:'project_admin',projectId:'test'};window.authExpired=false;window.addEventListener('geo-auth-expired',()=>{window.authExpired=true})})
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname
   if(path==='/api/news/content')return route.fulfill({json:{articles,brands:['测试品牌']}})
   if(path==='/api/news/orders')return route.fulfill({json:{orders:serverOrders}})
   if(path==='/api/media/resources'){
    const params=new URL(route.request().url()).searchParams,p=Number(params.get('page')||1)
    return route.fulfill({json:{resources:[{resource_id:p===671?'tail':'1',title:p===671?'末页新闻媒体':'测试新闻媒体',price:'10.00',case_link:'https://example.com'}],total:13413,totalPages:671,catalogTotal:13413,complete:true,page:p,fields:[]}})
   }
   if(path==='/api/news/quote'){assert.deepEqual(route.request().postDataJSON().allocations,[{resourceId:'1',articleIds:['a']}]);if(++quotes===1){await new Promise(r=>setTimeout(r,500));return route.fulfill({status:400,json:{error:'投稿配图不存在'}})}return route.fulfill({json:{orders:[{...order,state:'quoted'}],totalCents:1000,funding:{requiredCents:1000,requiredPublications:1,availableCents:0,availablePublications:0,reason:'余额不足，发布额度不足'}}})}
   if(path==='/api/news/check')return route.fulfill({json:{funding:{requiredCents:1000,requiredPublications:1,availableCents:2000,availablePublications:2,reason:''}}})
   if(path==='/api/news/refresh'){serverOrders=[{...order,state:'linked',orderId:'123',url:'https://example.com/article'}];return route.fulfill({json:{orders:serverOrders}})}
   if(path==='/api/news/delete'){assert.deepEqual(route.request().postDataJSON(),{id:order.id});deleted=true;serverOrders=[];return route.fulfill({json:{orders:serverOrders}})}
   if(path==='/api/news/dispatch'){if(++dispatches===1)return route.fulfill({status:409,json:{error:'发布额度不足'}});dispatched=true;serverOrders=[{...order,state:'submitted',orderId:'123'}];return route.fulfill({json:{orders:serverOrders}})}
   return route.fulfill({json:{ok:true,value:null,projects:[]}})
  })
  await page.goto(vite.resolvedUrls.local[0]+'#/project/media-news')
  await page.getByText('测试生成任务',{exact:true}).waitFor()
  await page.getByLabel('全选任务',{exact:true}).check()
  await page.getByRole('button',{name:'发布 · 本次1篇',exact:true}).click()
  await page.getByLabel('测试新闻媒体',{exact:true}).check()
  await page.getByLabel('跳转页码').fill('671')
  await page.getByRole('button',{name:'跳转',exact:true}).click()
  await page.getByRole('table').getByText('末页新闻媒体',{exact:true}).waitFor()
  await page.getByRole('button',{name:'首页',exact:true}).click()
  await page.getByLabel('测试新闻媒体',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('测试新闻媒体',{exact:true}).isChecked(),true)
  await page.screenshot({path:'outputs/media-catalog-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'outputs/media-catalog-mobile.png',fullPage:true})
  await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'确认发布稿',exact:true}).click()
  await page.getByText('正在核对媒体价格与投稿配图，请稍候…',{exact:true}).waitFor()
  await page.getByRole('alert').filter({hasText:'投稿配图不存在'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'确认扣费并分发',exact:true}).isEnabled(),false)
  await page.getByRole('button',{name:'重新核价',exact:true}).click()
  await page.getByText('确认费用：¥10.00；同时预占 1 篇发布额度。',{exact:true}).waitFor()
  assert.equal(dispatched,false)
  await page.getByRole('alert').filter({hasText:'余额不足，发布额度不足'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'确认扣费并分发',exact:true}).isEnabled(),false)
  assert.equal(await page.locator('.media-editor [role="alert"]').count(),0)
  const alertBox=await page.getByRole('alert').boundingBox();assert.ok(alertBox.y>=0&&alertBox.y+alertBox.height<=1000)
  await page.getByRole('button',{name:'刷新额度',exact:true}).click()
  await page.getByRole('button',{name:'确认扣费并分发',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'发布额度不足'}).waitFor()
  assert.equal(await page.evaluate(()=>window.authExpired),false)
  await page.getByRole('button',{name:'确认扣费并分发',exact:true}).click()
  await page.locator('.media-state').filter({hasText:'执行中'}).first().waitFor()
  await page.screenshot({path:'outputs/news-orders-desktop.png',fullPage:true})
  assert.equal(dispatched,true)
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'outputs/news-orders-mobile.png',fullPage:true})
  await page.getByRole('button',{name:'更新状态',exact:true}).click()
  await page.locator('.media-tabs').getByRole('button',{name:/发布记录/}).click()
  await page.getByRole('button',{name:'查看详情',exact:true}).click()
  await page.getByRole('button',{name:'查看发布页面',exact:true}).waitFor()
  page.once('dialog',dialog=>dialog.dismiss())
  await page.getByLabel('删除发布记录可选成品文章').click()
  assert.equal(deleted,false)
  page.once('dialog',dialog=>dialog.accept())
  await page.getByLabel('删除发布记录可选成品文章').click()
  await page.getByText('暂无发布记录',{exact:true}).waitFor()
  assert.equal(deleted,true)
  assert.deepEqual(errors,[])
 }finally{await browser.close();await vite.close()}
})
