import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'

test('history is separate, regeneration preserves old task, polls new articles, hides planning content',async()=>{
 const vite=await createServer({configFile:false,base:'/',plugins:[react()],server:{host:'127.0.0.1',port:0}});await vite.listen()
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  const project={name:'品牌A',coreKeyword:'管理咨询公司',industry:'咨询'},oldArticle={id:'old-article',project:project.name,title:'历史文章',body:'历史正文',words:'100',status:'已生成',batchId:'old-batch'}
  const oldTask={project:project.name,name:'历史任务一',coreKeyword:project.coreKeyword,limit:'2',created:'1',jobId:'JOB-old',batchId:'old-batch',status:'已生成',time:'2026-09-14',imageSource:'imported'}
  const store={'geo.activeBrand':project.name,'geo.projectRows':[project],'geo.keywordRows':[[project.name,project.coreKeyword]],'geo.taskRows':[oldTask,{...oldTask,name:'历史任务二',jobId:'JOB-old2',batchId:'old-batch2'}],'geo.articleRows':[oldArticle]}
  let startBody,statusPolls=0
  const jobs={
   'JOB-old':{id:'JOB-old',project:project.name,status:'done',completed:1,total:1,passed:1,failed:0,articles:[oldArticle],logs:[]},
   'JOB-new':{id:'JOB-new',project:project.name,status:'running',completed:0,total:2,passed:0,failed:0,articles:[],logs:[{time:'now',message:'DO_NOT_SHOW_LOG_DETAILS'}],workflowSteps:[{key:'单篇编辑:a',label:'单篇编辑',status:'complete',value:{argument:'DO_NOT_SHOW_AGENT_ARGUMENT'}}]}
  }
  await page.addInitScript(()=>{window.__geoIdentity={userId:'test',role:'project_admin',projectId:'project-a'}})
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url())
   if(url.pathname==='/api/gallery/file') return route.fulfill({contentType:'image/gif',body:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')})
   if(url.pathname==='/api/state'){
    if(req.method()==='POST'){const {key,value}=req.postDataJSON();store[key]=value;return route.fulfill({json:{ok:true,value}})}
    return route.fulfill({json:{ok:true,value:store[url.searchParams.get('key')]??null}})
   }
   if(url.pathname==='/api/jobs/start'){startBody=req.postDataJSON();return route.fulfill({json:{ok:true,job:jobs['JOB-new']}})}
   if(url.pathname==='/api/jobs/status'){
    const id=url.searchParams.get('id')
    if(id==='JOB-new'){
     statusPolls++
     const articles=Array.from({length:Math.min(statusPolls,2)},(_,i)=>({id:`new-${i}`,project:project.name,title:`新文章${i+1}`,body:`摘要：本篇介绍服务选择依据。\n\n## 正文标题\n新内容${i+1}\n\n![AI场景图](/api/gallery/file?file=test.gif)`,words:'120',status:'已生成',batchId:startBody.batchId}))
     jobs[id]={...jobs[id],articles,completed:articles.length,passed:articles.length,status:articles.length===2?'done':'running'}
    }
    return route.fulfill({json:{ok:true,job:jobs[id]}})
   }
   return route.fulfill({json:{ok:true}})
  })
  await page.goto(vite.resolvedUrls.local[0]+'#/project/task-history')
  await page.getByText('历史任务二',{exact:true}).waitFor()
  assert.equal(await page.locator('.mature-task-table .ops-row').count(),2)
  assert.equal(await page.locator('.workflow-summary').count(),0)
  await page.screenshot({path:'outputs/task-history-desktop.png',fullPage:true})
  await page.locator('.mature-task-table .ops-row').first().getByRole('button',{name:'新生成一批',exact:true}).click()
  await page.waitForFunction(() => location.hash === '#/project/tasks')
  await page.getByText('新文章1',{exact:true}).waitFor()
  assert.equal(await page.locator('.mature-task-table .ops-row').count(),1)
  assert.equal(startBody.restartOf,'JOB-old');assert.notEqual(startBody.batchId,'old-batch');assert.notEqual(startBody.taskName,oldTask.name)
  assert.equal(startBody.plans,undefined);assert.equal(startBody.task.imageSource,'imported')
  assert.equal(await page.getByText('DO_NOT_SHOW_LOG_DETAILS').count(),0);assert.equal(await page.getByText('DO_NOT_SHOW_AGENT_ARGUMENT').count(),0)
  await page.getByText('新文章2',{exact:true}).waitFor()
  await page.getByRole('button',{name:'查看文章',exact:true}).first().click()
  await page.getByRole('heading',{name:'正文标题'}).waitFor()
  assert.equal(await page.locator('.article-reader-modal .article-reader .article-page-view h1').textContent(),'新文章1')
  assert.equal(await page.locator('.article-content-view .article-formatted-block:not(.article-summary) p').textContent(),'新内容1')
  assert.equal(await page.locator('.article-content-view .article-formatted-block:not(.article-summary) p').evaluate(el=>getComputedStyle(el).fontSize),'16px')
  assert.equal(await page.locator('.article-summary p').evaluate(el=>getComputedStyle(el).fontSize),'14px')
  assert.equal(await page.locator('.article-image-block figcaption').count(),0)
  assert.equal(await page.locator('.article-image-block img').getAttribute('alt'),'文章配图')
  assert.equal(await page.locator('.modal-backdrop .article-body').count(),0)
  await page.screenshot({path:'outputs/task-article-reader-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.locator('.article-reader-modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
  await page.screenshot({path:'outputs/task-article-reader-mobile.png',fullPage:true})
  await page.setViewportSize({width:1440,height:1050})
  await page.getByRole('button',{name:'关闭',exact:true}).click()
  await page.screenshot({path:'outputs/task-current-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'任务列表',exact:true}).click()
  await page.getByText('历史任务二',{exact:true}).waitFor()
  assert.equal(await page.locator('.mature-task-table .ops-row').count(),3)
  const preserved=store['geo.taskRows'].find(r=>r.name===oldTask.name)
  assert.equal(preserved.jobId,'JOB-old');assert.equal(preserved.batchId,'old-batch');assert.ok(store['geo.articleRows'].some(a=>a.id==='old-article'))
  assert.deepEqual(errors,[])
 }finally{await browser.close();await vite.close()}
})
