import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
test('HTTP content selection to quoted dispatch and verified refund',async()=>{
 let sends=0,refund=false
 const sendPaths=[],sendForms=[],queryPaths=[]
 const provider=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':req.headers['content-type']}}).formData()
  let data
  if(req.url.endsWith('/get_field'))data=[]
  else if(req.url.endsWith('/media_list'))data=[{resource_id:'1',title:'测试媒体',price:req.url.includes('zi_media')?'12.00':'10.00'},{resource_id:'2',title:'博客园（GEO可发）',price:'8.00'}]
  else if(req.url.endsWith('/send')||req.url.endsWith('/send_article')){sends++;sendPaths.push(req.url);sendForms.push(Object.fromEntries(form));data={order_nid:'123'}}
  else {queryPaths.push(req.url);assert.deepEqual(form.getAll('order_nids[]'),['123']);data={order_nid:'123',status:4,is_refund:refund?1:0,order_url:refund?'':'https://example.com/result'}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:1,data}))
 })
 await new Promise(r=>provider.listen(0,'127.0.0.1',r))
 const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
 const dir=mkdtempSync(join(tmpdir(),'news-http-'))
 const child=spawn(process.execPath,[resolve('server/geo-api-server.mjs')],{cwd:dir,env:{...process.env,GEO_API_PORT:String(port),GEO_AUTH_DATA_DIR:join(dir,'auth'),GEO_JOB_DIR:join(dir,'jobs'),GEO_ADMIN_USERNAME:'root-test',GEO_ADMIN_PASSWORD:'Safe-test-password',XIAOQINGWA_BASE_URL:`http://127.0.0.1:${provider.address().port}`,XIAOQINGWA_KEY:'fixture'},stdio:['ignore','pipe','pipe']})
 const call=async(path,body,cookie='')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 try{
  await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error(String(c))))})
  const root=(await call('/api/auth/login',{username:'root-test',password:'Safe-test-password'})).cookie
  const user=(await call('/api/admin/users',{username:'news-client',password:'Safe-test-password',role:'project_admin',initialAllocation:{days:30,quantities:{articles:0,keywords:0,storageMB:10,projects:1,points:0,money:10000,publications:0,publishingAccounts:0}},saleCents:0,requestId:'client-opening'},root)).data.user
  const cookie=(await call('/api/auth/login',{username:'news-client',password:'Safe-test-password'})).cookie
  assert.ok(user)
  await call('/api/state',{key:'geo.projectRows',value:[{name:'品牌'}]},cookie)
  const upload=join(dir,'outputs','projects',user.projectId,'uploads');mkdirSync(upload,{recursive:true})
  const file=join(upload,'fixture.png'),image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH3sAAAAASUVORK5CYII=','base64');writeFileSync(file,image)
  await call('/api/state',{key:'geo.articleRows',value:[{id:'article',project:'品牌',title:'真实成品',body:`正文\n\n![配图](/api/gallery/file?file=${encodeURIComponent(file)})`,status:'已生成'}]},cookie)
  assert.equal((await call('/api/news/content',undefined,cookie)).data.articles.length,1)
  for(let i=0;i<100;i++){const r=await call('/api/media/resources?channel=news&page=1',undefined,cookie);if(r.data.complete)break;await new Promise(r=>setTimeout(r,20))}
  assert.equal((await call('/api/news/quote',{brand:'品牌',allocations:[{resourceId:'1',articleIds:['foreign']}],requestId:'forged-article'},cookie)).status,403)
  const b2b=await call('/api/media/resources?channel=b2b',undefined,cookie)
  assert.deepEqual(b2b.data.resources.map(r=>r.resource_id),['b2b:1','b2b:3','b2b:4','b2b:5','b2b:6'])
  assert.equal((await call('/api/news/quote',{brand:'品牌',channel:'b2b',allocations:[{resourceId:'1',articleIds:['article']}],requestId:'wrong-b2b-resource'},cookie)).status,409)
  const b2bQuote=await call('/api/news/quote',{brand:'品牌',channel:'b2b',b2b:{image_url:'https://example.com/cover.png'},allocations:[{resourceId:'b2b:3',articleIds:['article']}],requestId:'b2b-quote'},cookie)
  assert.equal(b2bQuote.data.orders[0].channel,'b2b');assert.equal(b2bQuote.data.totalCents,300)
  await call('/api/news/cancel',{id:b2bQuote.data.orders[0].id},cookie)
  const q=await call('/api/news/quote',{brand:'品牌',allocations:[{resourceId:'1',articleIds:['article']}],price:0,requestId:'publish-quote'},cookie)
  assert.equal(q.status,200,JSON.stringify(q.data));assert.equal(q.data.totalCents,1000)
  const src=new URL(q.data.orders[0].content.match(/src="([^"]+)"/)[1])
  assert.ok(src.pathname.startsWith('/api/news-image/'))
  assert.equal((await fetch(`http://127.0.0.1:${port}${src.pathname}`)).status,404,'quote must not publish images')
  const forged=await call('/api/news/quote',{brand:'品牌',allocations:[{resourceId:'1',articleIds:['article']}],edits:{article:{body:'![非法](/api/gallery/file?file=/etc/passwd)'}},requestId:'foreign-image'},cookie)
  assert.equal(forged.status,400)
  const ids=q.data.orders.map(o=>o.id)
  assert.match(q.data.funding.reason,/发布额度不足/)
  const adjustment=await call('/api/admin/members/adjust-many',{userId:user.id,changes:[{resource:'publications',delta:10,expectedAvailable:0}],reason:'补齐测试发布额度',requestId:'fund-publish-quota'},root)
  assert.equal(adjustment.status,200,JSON.stringify(adjustment.data))
  assert.equal((await call('/api/news/check',{ids},cookie)).data.funding.reason,'')
  assert.equal((await call('/api/news/dispatch',{ids},cookie)).status,202)
  await call('/api/news/dispatch',{ids},cookie)
  let rows=[]
  for(let i=0;i<50;i++){rows=(await call('/api/news/orders',undefined,cookie)).data.orders;if(rows[0].orderId)break;await new Promise(r=>setTimeout(r,20))}
  assert.equal(sends,1);assert.equal(rows[0].state,'submitted')
  const duplicateWhileSubmitted=await call('/api/news/quote',{brand:'品牌',allocations:[{resourceId:'2',articleIds:['article']}],requestId:'duplicate-while-submitted'},cookie)
  assert.equal(duplicateWhileSubmitted.status,409)
  assert.match(duplicateWhileSubmitted.data.error,/退回后才能重新发布/)
  const publicImage=await fetch(`http://127.0.0.1:${port}${src.pathname}`)
  assert.equal(publicImage.status,200);assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),image)
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/news-image/${'0'.repeat(64)}`)).status,404)
  refund=true
  await call('/api/news/refresh',{ids},cookie);await call('/api/news/refresh',{ids},cookie)
  const members=(await call('/api/admin/members',undefined,root)).data.members
  assert.equal(members.find(u=>u.id===user.id).resources.money.available,10000)
  for(const channel of ['social','b2b']){
    refund=false
    for(let i=0;i<100;i++){const r=await call(`/api/media/resources?channel=${channel}`,undefined,cookie);if(r.data.complete)break;await new Promise(r=>setTimeout(r,20))}
    const quoteBody={brand:'品牌',channel,b2b:{image_url:'',author:'联系人',phone:'18100000000',area:'271'},allocations:[{resourceId:channel==='social'?'1':'b2b:4',articleIds:['article']}],requestId:`publish-${channel}`}
    if(channel==='b2b')assert.equal((await call('/api/news/quote',{...quoteBody,b2b:{...quoteBody.b2b,area:''},requestId:'missing-region'},cookie)).status,400)
    const q2=await call('/api/news/quote',quoteBody,cookie)
    assert.equal(q2.status,200,JSON.stringify(q2.data))
    assert.equal(q2.data.totalCents,channel==='social'?1200:80)
    if(channel==='b2b')assert.match(q2.data.orders[0].b2b.image_url,/\/api\/news-image\//)
    const selectedIds=q2.data.orders.map(o=>o.id)
    await call('/api/news/dispatch',{ids:selectedIds},cookie);await call('/api/news/dispatch',{ids:selectedIds},cookie)
    let placed
    for(let i=0;i<100;i++){placed=(await call('/api/news/orders',undefined,cookie)).data.orders.find(o=>o.id===selectedIds[0]);if(placed.orderId)break;await new Promise(r=>setTimeout(r,20))}
    assert.equal(placed.state,'submitted');assert.equal(placed.providerChannel,channel)
    assert.equal(sendPaths.at(-1),channel==='social'?'/api/zi_media_api/send':'/api/b2b_v2/send_article')
    if(channel==='b2b'){assert.equal(sendForms.at(-1).type,'4');assert.equal(sendForms.at(-1).area,'271');assert.equal(sendForms.at(-1).author,'联系人')}
    const checked=await call('/api/news/refresh',{ids:selectedIds},cookie)
    assert.equal(checked.data.orders.find(o=>o.id===selectedIds[0]).url,'https://example.com/result')
    assert.equal(queryPaths.at(-1),channel==='social'?'/api/zi_media_api/order_info':'/api/b2b_v2/order_info')
    refund=true
    await call('/api/news/refresh',{ids:selectedIds},cookie);await call('/api/news/refresh',{ids:selectedIds},cookie)
    const wallet=(await call('/api/admin/members',undefined,root)).data.members.find(u=>u.id===user.id)
    assert.equal(wallet.resources.money.available,10000);assert.equal(wallet.resources.publications.available,10)
  }
  assert.equal(sends,3,'One news, one social and one B2B submission despite repeated dispatch requests')
 }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await new Promise(r=>provider.close(r));rmSync(dir,{recursive:true,force:true})}
})
