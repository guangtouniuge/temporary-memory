import test from 'node:test'
import assert from 'node:assert/strict'
import {createXiaoqingwaClient,moneyCents} from './xiaoqingwa-client.mjs'
test('media prices use integer cents and reject malformed prices',()=>{
  assert.equal(moneyCents('27.01'),2701)
  for(const value of ['NaN','-1','1.234','1e3',''])assert.throws(()=>moneyCents(value))
})
test('channels, order arrays and submission receipts follow the documented contract',async()=>{
  const calls=[]
  const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async(url,options)=>{
    calls.push({url:String(url),form:options.body})
    const data=String(url).endsWith('media_list')?[{resource_id:1,title:'媒体',price:'10.20',case_link:'javascript:alert(1)'}]:String(url).endsWith('order_info')?{order_nid:'123',status:4,is_refund:1}:{order_nid:'123'}
    return Response.json({code:1,data})
  }})
  assert.equal((await client.resources('social'))[0].case_link,'')
  assert.match(calls[0].url,/zi_media_api\/media_list$/)
  assert.equal((await client.orderDetails('news',['123']))[0].status,4)
  assert.deepEqual(calls[1].form.getAll('order_nids[]'),['123'])
  assert.deepEqual(await client.submit('news',{resourceId:1,title:'标题',content:'正文',thirdId:'stable'}),{orderId:'123',status:'submitted'})
  assert.equal(calls[2].form.get('third_id'),'stable')
})
test('uncertain submission is not retried and cannot be called published',async()=>{
  let count=0
  const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async()=>{count++;throw Error('timeout')}})
  await assert.rejects(client.submit('news',{resourceId:1,title:'标题',content:'正文',thirdId:'stable'}),e=>e.uncertain===true)
  assert.equal(count,1)
})

test('social classification uses wemedia rather than the website dictionary',async()=>{
  const types=[]
  const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async(url,options)=>{
    types.push(options.body.get('media_type'));return Response.json({code:1,data:[]})
  }})
  await client.fields('news');await client.fields('social')
  assert.deepEqual(types,['website','wemedia'])
})

test('B2B uses form encoding, preserves long order IDs, and queries arrays',async()=>{
 const calls=[]
 const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async(url,options)=>{
  calls.push({url:String(url),body:options.body})
  return new Response('{"code":1,"data":{"order_nid":202608130930695932}}',{headers:{'Content-Type':'application/json'}})
 }})
 const receipt=await client.submit('b2b',{resourceId:'b2b:4',title:'标题',content:'正文',thirdId:'stable',b2b:{author:'联系人',phone:'18100000000',area:'271',image_url:'https://example.com/a.png'}})
 assert.equal(receipt.orderId,'202608130930695932')
 assert.ok(calls[0].body instanceof URLSearchParams)
 assert.match(calls[0].url,/b2b_v2\/send_article$/)
 assert.equal(calls[0].body.get('type'),'4')
 await client.orderDetails('b2b',[receipt.orderId])
 assert.deepEqual(calls[1].body.getAll('order_nids[]'),[receipt.orderId])
})

test('diagnosis and report endpoints use documented Xiaoqingwa routes',async()=>{
 const calls=[]
 const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async(url,options)=>{
  calls.push({url:String(url),body:options.body,method:options.method})
  if(String(url).includes('/api/geo/add_shoulu'))return Response.json({code:1,data:{request_id:'geo-1'}})
  if(String(url).includes('/api/geo/check_task'))return Response.json({code:1,data:{status:1}})
  if(String(url).includes('/api/we_wo/preAnalyze'))return Response.json({code:1,data:{candidates:[{fullName:'曝光率GEO'}]}})
  if(String(url).includes('/api/we_wo/createReports'))return Response.json({code:1,data:{reportId:'report-1'}})
  if(String(url).includes('/api/we_wo/queryReports'))return Response.json({code:1,data:{status:'completed'}})
  if(String(url).includes('/api/we_wo/downloadReportsForPdf'))return Response.json({code:1,data:{url:'https://provider.test/report.pdf'}})
  return Response.json({code:1,data:{balance:99}})
 }})
 assert.deepEqual(await client.createInclusion({platform:'2',keywords:'曝光率GEO',question:'豆包是否推荐曝光率GEO',thirdId:'task-1'}),{requestId:'geo-1'})
 assert.equal(calls[0].body.get('third_id'),'task-1')
 assert.equal((await client.checkInclusion('geo-1')).status,1)
 assert.equal(calls[1].body.get('request_id'),'geo-1')
 assert.equal((await client.preAnalyze('曝光率GEO')).candidates[0].fullName,'曝光率GEO')
 assert.ok(calls[2].body instanceof URLSearchParams)
 const report=await client.createReport({brandName:'曝光率GEO',requirement:'诊断要求',thirdPartyIdentifier:'task-2'})
 assert.equal(report.reportId,'report-1')
 assert.equal(calls[3].body.get('third_party_identifier'),'task-2')
 assert.equal((await client.reportStatus('report-1')).status,'completed')
 assert.match(calls[4].url,/queryReports\/reportId\/report-1\?api_key=fixture$/)
 assert.equal((await client.reportDownload('report-1')).url,'https://provider.test/report.pdf')
 assert.match(calls[5].url,/downloadReportsForPdf\/reportId\/report-1\?api_key=fixture$/)
})

test('PRO report submission may be accepted before a report id is generated',async()=>{
 const client=createXiaoqingwaClient({baseUrl:'https://provider.test',key:'fixture',fetcher:async(url)=>{
  if(String(url).includes('/api/we_wo/createReports'))return Response.json({code:1,data:{message:'accepted'}})
  return Response.json({code:1,data:{}})
 }})
 assert.deepEqual(await client.createReport({brandName:'曝光率GEO',requirement:'诊断要求',thirdPartyIdentifier:'task-2'}),{message:'accepted'})
})
