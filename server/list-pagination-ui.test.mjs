import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

test('table pagination preserves all rows and resets after filtering',async()=>{
 const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{PagedRows}from'/src/PagedRows.tsx';const h=React.createElement;function App(){const[n,setN]=useState(45);return h(React.Fragment,null,h('button',{onClick:()=>setN(3)},'Filter'),h('table',null,h('tbody',null,h(PagedRows,{table:true},Array.from({length:n},(_,i)=>h('tr',{key:i},h('td',null,'Row '+(i+1))))))))}createRoot(document.getElementById('root')).render(h(App));`
 const vite=await createServer({configFile:false,cacheDir:'.tmp/pagination-vite-cache',plugins:[{name:'pagination-fixture',resolveId(id){if(id==='/fixture.tsx')return '\0fixture.tsx'},load(id){if(id==='\0fixture.tsx')return fixture}},react()],server:{host:'127.0.0.1',port:41951}});await vite.listen()
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const page=await browser.newPage()
  page.on('pageerror',error=>console.error(error.message))
  page.on('requestfailed',request=>console.error(request.url(),request.failure()))
  await page.route('**/pagination-test',async route=>route.fulfill({contentType:'text/html',body:await vite.transformIndexHtml('/pagination-test','<div id="root"></div><script type="module" src="/fixture.tsx"></script>')}))
  await page.goto(vite.resolvedUrls.local[0]+'pagination-test')
  await page.getByText('Row 1',{exact:true}).waitFor()
  assert.equal(await page.locator('tbody tr:not(.pagination-row)').count(),20)
  await page.getByRole('combobox',{name:'页码'}).selectOption('3')
  assert.equal(await page.locator('tbody tr:not(.pagination-row)').count(),5)
  await page.getByRole('button',{name:'Filter'}).click()
  await page.getByText('Row 1',{exact:true}).waitFor()
  assert.equal(await page.locator('tbody tr').count(),3)
  assert.equal(await page.getByRole('navigation',{name:'列表分页'}).count(),0)
 }finally{await browser.close();await vite.close()}
})

test('task history and inline results paginate by 20 and download selected IDs across pages',async()=>{
 const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}});await vite.listen()
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],exports=[]
  page.on('pageerror',e=>errors.push(e.message))
  const brand='分页验收品牌',project={name:brand,coreKeyword:'咨询公司',industry:'咨询'}
  const articles=Array.from({length:45},(_,i)=>({id:`a${i}`,project:brand,title:`文章${i+1}`,body:'验收正文',words:'100',status:'已生成',batchId:`batch-${i%3}`}))
  const tasks=Array.from({length:45},(_,i)=>({project:brand,name:`任务${i+1}`,coreKeyword:project.coreKeyword,limit:'45',created:String(i),jobId:`JOB-${i}`,batchId:'batch',status:'已生成',time:'2026-09-15',imageSource:'imported'}))
  const store={'geo.activeBrand':brand,'geo.projectRows':[project],'geo.keywordRows':[[brand,project.coreKeyword]],'geo.taskRows':tasks,'geo.articleRows':articles}
  await page.addInitScript(()=>{
    window.__geoIdentity={userId:'test',role:'project_admin',projectId:'pagination'}
    Storage.prototype.setItem=function(){throw new DOMException('Storage quota exhausted','QuotaExceededError')}
  })
  let articleUnavailable=true,statusReads=0
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.pathname==='/api/state'){
    if(req.method()==='GET'&&url.searchParams.get('key')==='geo.articleRows'&&articleUnavailable)return route.fulfill({status:503,json:{error:'文章库暂不可用'}})
    if(req.method()==='POST'){const {key,value}=req.postDataJSON();store[key]=value;return route.fulfill({json:{ok:true,value}})}
    return route.fulfill({json:{ok:true,value:store[url.searchParams.get('key')]??null}})
   }
   if(url.pathname==='/api/jobs/status'){
    statusReads++
    if(statusReads===1)await new Promise(resolve=>setTimeout(resolve,16000))
    return route.fulfill({json:{ok:true,job:{id:url.searchParams.get('id'),project:brand,status:'done',completed:45,total:45,passed:45,failed:0,articles,logs:[]}}})
   }
   if(url.pathname==='/api/articles/export'){exports.push(req.postDataJSON());return route.fulfill({json:{ok:true,downloadUrl:'/api/export/file',filePath:'results.doc',count:exports.at(-1).articles.length}})}
   if(url.pathname==='/api/export/file')return route.fulfill({contentType:'application/msword',body:'downloaded document'})
   return route.fulfill({json:{ok:true}})
  })
  await page.goto(vite.resolvedUrls.local[0]+'#/project/tasks')
  await page.getByRole('button',{name:'读取中…',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'读取中…',exact:true}).isDisabled(),true)
  await page.locator('.current-task-articles').getByText('文章1',{exact:true}).waitFor()
  assert.equal(statusReads,1)
  await page.getByRole('button',{name:'任务列表',exact:true}).click()
  const table=page.locator('.mature-task-table')
  await table.getByText('任务1',{exact:true}).waitFor()
  assert.equal(await table.locator('.ops-row').count(),20)
  await table.getByRole('button',{name:'下一页',exact:true}).click()
  assert.equal(await table.locator('.ops-row').count(),20)
  await table.getByRole('button',{name:'下一页',exact:true}).click()
  assert.equal(await table.locator('.ops-row').count(),5)
  assert.equal(await table.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true)
  await table.getByRole('combobox',{name:'页码'}).selectOption('1')
  const buttons=await table.locator('.task-action-grid').first().locator('button').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})))
  assert.equal(buttons[0].y,buttons[1].y);assert.equal(buttons[2].y,buttons[3].y);assert.ok(buttons[2].y>buttons[0].y)
  await table.locator('.ops-row').first().getByRole('button',{name:'查看结果',exact:true}).click()
  assert.ok(page.url().endsWith('#/project/task-history'))
  const results=page.locator('.panel').filter({has:page.getByText('本次生成文章',{exact:true})})
  await results.getByText('文章1',{exact:true}).waitFor()
  assert.equal(await results.locator('.current-task-article').count(),20)
  await results.getByRole('checkbox',{name:'选择文章1',exact:true}).check()
  await results.getByRole('button',{name:'下一页',exact:true}).click()
  await results.getByRole('checkbox',{name:'选择文章21',exact:true}).check()
  const download=page.waitForEvent('download')
  await results.getByRole('button',{name:'下载选中文章',exact:true}).click()
  assert.equal((await download).suggestedFilename(),'results.doc')
  assert.deepEqual(exports[0].articles,[{id:'a0'},{id:'a20'}]);assert.equal(exports[0].brand,brand)
  assert.ok(page.url().endsWith('#/project/task-history'))
  const historyDownload=page.waitForEvent('download')
  await table.locator('.ops-row').first().getByRole('button',{name:'文章下载',exact:true}).click()
  await historyDownload
  assert.equal(exports.at(-1).articles.length,45)
  assert.ok(page.url().endsWith('#/project/task-history'))
  await results.getByRole('button',{name:'下一页',exact:true}).click()
  assert.equal(await results.locator('.current-task-article').count(),5)
  await results.getByRole('combobox',{name:'页码'}).selectOption('1')
  assert.equal(await results.getByRole('checkbox',{name:'选择文章1',exact:true}).isChecked(),true)
  await page.screenshot({path:'outputs/task-pagination-desktop.png',fullPage:true})
  articleUnavailable=false
  await page.getByRole('button',{name:'成品文章库',exact:true}).click()
  await page.reload()
  const library=page.locator('.library-table')
  await library.getByText('文章1',{exact:true}).waitFor()
  assert.equal(await page.getByText('文章任务列表',{exact:true}).count(),0)
  assert.equal(await page.locator('.task-batch-table').count(),0)
  assert.equal(await page.getByRole('button',{name:'最新任务',exact:true}).count(),0)
  assert.equal(await library.locator('.ops-row').count(),20)
  await library.getByRole('combobox',{name:'页码'}).selectOption('3')
  assert.equal(await library.locator('.ops-row').count(),5)
  await library.getByText('文章45',{exact:true}).waitFor()
  const allDownload=page.waitForEvent('download')
  await page.getByRole('button',{name:'下载全部Word',exact:true}).click()
  await allDownload
  assert.equal(exports.at(-1).articles.length,45)
  await page.screenshot({path:'outputs/library-articles-only.png',fullPage:true})
  assert.deepEqual(errors,[])
 }finally{await browser.close();await vite.close()}
})
