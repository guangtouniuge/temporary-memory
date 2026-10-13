import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'

test('scheduled news orders stay queued until due and then dispatch once',async()=>{
 let sends=0
 const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData()
  let data
  if(req.url.endsWith('/get_field'))data=[]
  else if(req.url.endsWith('/media_list'))data=[{resource_id:'1',title:'预约测试媒体',price:'10.00'}]
  else if(req.url.endsWith('/send')){sends++;assert.equal(form.get('title'),'预约成品文章');data={order_nid:'schedule-order'}}
  else data={order_nid:'schedule-order',status:2,is_refund:0,order_url:'https://example.com/scheduled'}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:1,data}))
 })
 await new Promise(r=>provider.listen(0,'127.0.0.1',r))
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 const dir=mkdtempSync(join(tmpdir(),'news-schedule-'))
 const child=spawn(process.execPath,[resolve('server/geo-api-server.mjs')],{cwd:dir,env:{...process.env,GEO_API_PORT:String(port),GEO_AUTH_DATA_DIR:join(dir,'auth'),GEO_JOB_DIR:join(dir,'jobs'),GEO_ADMIN_USERNAME:'root-test',GEO_ADMIN_PASSWORD:'Safe-test-password',XIAOQINGWA_BASE_URL:`http://127.0.0.1:${provider.address().port}`,XIAOQINGWA_KEY:'fixture'},stdio:['ignore','pipe','pipe']})
 const call=async(path,body,cookie='')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error(String(c))))})
  const root=(await call('/api/auth/login',{username:'root-test',password:'Safe-test-password'})).cookie
  const user=(await call('/api/admin/users',{username:'schedule-client',password:'Safe-test-password',role:'project_admin',initialAllocation:{days:30,quantities:{articles:0,keywords:0,storageMB:10,projects:1,points:0,money:10000,publications:5,publishingAccounts:0}},saleCents:0,requestId:'schedule-client'},root)).data.user
  const cookie=(await call('/api/auth/login',{username:'schedule-client',password:'Safe-test-password'})).cookie
  await call('/api/state',{key:'geo.projectRows',value:[{name:'预约品牌'}]},cookie)
  const upload=join(dir,'outputs','projects',user.projectId,'uploads');mkdirSync(upload,{recursive:true})
  const file=join(upload,'fixture.png'),image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=','base64');writeFileSync(file,image)
  await call('/api/state',{key:'geo.articleRows',value:[{id:'article',project:'预约品牌',title:'预约成品文章',body:`正文\n\n![配图](/api/gallery/file?file=${encodeURIComponent(file)})`,status:'已生成'}]},cookie)
  for(let i=0;i<100;i++){const r=await call('/api/media/resources?channel=news&page=1',undefined,cookie);if(r.data.complete)break;await new Promise(r=>setTimeout(r,20))}
  const quote=await call('/api/news/quote',{brand:'预约品牌',channel:'news',allocations:[{resourceId:'1',articleIds:['article']}],requestId:'schedule-quote'},cookie)
  assert.equal(quote.status,200,JSON.stringify(quote.data))
  const id=quote.data.orders[0].id
  const scheduledAt=new Date(Date.now()+500).toISOString()
  const scheduled=await call('/api/news/schedule',{ids:[id],scheduledAt},cookie)
  assert.equal(scheduled.status,202,JSON.stringify(scheduled.data))
  assert.equal(scheduled.data.orders.find(o=>o.id===id).state,'scheduled')
  assert.equal(sends,0)
  let rows=(await call('/api/news/orders',undefined,cookie)).data.orders
  assert.equal(rows.find(o=>o.id===id).state,'scheduled')
  assert.equal(sends,0)
  await new Promise(r=>setTimeout(r,3600))
  assert.equal(sends,1)
  let placed
  for(let i=0;i<100;i++){
   rows=(await call('/api/news/orders',undefined,cookie)).data.orders
   placed=rows.find(o=>o.id===id)
   if(placed.orderId)break
   await new Promise(r=>setTimeout(r,20))
  }
  assert.equal(sends,1)
  assert.equal(placed.state,'submitted')
  assert.equal(placed.orderId,'schedule-order')
  const duplicate=await call('/api/news/quote',{brand:'预约品牌',channel:'news',allocations:[{resourceId:'1',articleIds:['article']}],requestId:'schedule-duplicate'},cookie)
  assert.equal(duplicate.status,409)
 }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await new Promise(r=>provider.close(r));rmSync(dir,{recursive:true,force:true})}
})
