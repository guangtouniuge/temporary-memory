import test from 'node:test'
import assert from 'node:assert/strict'
import {articleSceneImages,generateSceneImage,imageSource,resetPendingImageSlots,sceneImagePrompt} from './volcengine-images.mjs'

test('scene prompts contain visual context, never whole article text',()=>{
 const prompt=sceneImagePrompt({project:{industry:'管理咨询'},title:'如何选择顾问',scene:'门店经营',body:'PRIVATE ARTICLE',index:0})
 assert.match(prompt,/管理咨询/);assert.match(prompt,/门店经营/);assert.ok(!prompt.includes('PRIVATE ARTICLE'));assert.ok(!prompt.includes('如何选择顾问'));assert.ok(prompt.length<1000)
})

test('content rejection retains safe diagnostics and is never auto retried',async()=>{
 let calls=0
 await assert.rejects(()=>generateSceneImage('topic',{apiKey:'secret',model:'test',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{code:'InputTextSensitiveContentDetected',message:'secret'}}),{status:400,headers:{'x-request-id':'request-123'}})}}),e=>{
 assert.equal(e.providerCode,'InputTextSensitiveContentDetected');assert.equal(e.requestId,'request-123');assert.equal(e.confirmedFailure,true);assert.ok(!e.message.includes('secret'));return true
 });assert.equal(calls,1)
})

test('provider account overdue on 403 is billing, not key permissions, and is never retried',async()=>{
 let calls=0
 await assert.rejects(()=>generateSceneImage('topic',{apiKey:'secret',model:'test',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({error:{code:'AccountOverdueError',message:'secret'}}),{status:403})}}),error=>{
  assert.match(error.message,/火山引擎账户欠费/);assert.match(error.message,/正文进度已保留/)
  assert.doesNotMatch(error.message,/密钥|权限|secret/);assert.equal(error.confirmedFailure,true);return true
 });assert.equal(calls,1)
})

test('only explicit rate limiting is retried; ambiguous server failure stops',async()=>{
 let calls=0
 await assert.rejects(()=>generateSceneImage('topic',{apiKey:'secret',model:'test',wait:async()=>{},fetchImpl:async()=>{calls++;return new Response('{}',{status:429})}}),/429/);assert.equal(calls,3)
 calls=0
 await assert.rejects(()=>generateSceneImage('topic',{apiKey:'secret',model:'test',fetchImpl:async()=>{calls++;return new Response('{}',{status:503})}}),e=>e.confirmedFailure===false);assert.equal(calls,1)
})

test('image request uses official API, single output, watermark and no secret in error',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,1])
 const result=await generateSceneImage('场景',{apiKey:'secret',model:'test',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/images/generations')
  const body=JSON.parse(options.body);assert.equal(body.watermark,true);assert.equal(body.response_format,'b64_json');assert.equal(body.sequential_image_generation,'disabled')
  return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}))
 }})
 assert.equal(result.ext,'png');assert.deepEqual(result.data,png)
 await assert.rejects(()=>generateSceneImage('x',{apiKey:'secret',model:'test',fetchImpl:async()=>new Response('secret',{status:403})}),/权限/)
 assert.throws(()=>imageSource('other'));assert.equal(imageSource(undefined),'imported')
})
test('two image slots resume without regenerating completed images',async()=>{
 const state={},stored=new Map();let calls=0,fail=true
 const options={project:{name:'brand'},title:'title',body:'content',articleId:'job:1',state,saveState:async()=>{},findSaved:key=>stored.get(key),saveImage:async(key,file)=>{const r={path:'/api/gallery/file?file='+key};stored.set(key,r);return r},generate:async()=>{calls++;if(calls===2&&fail)throw Object.assign(new Error('余额不足'),{confirmedFailure:true});return {data:Buffer.from('image'),ext:'png'}}}
 await assert.rejects(()=>articleSceneImages(options),/余额/);assert.equal(stored.size,1)
 fail=false;assert.equal((await articleSceneImages(options)).length,2);assert.equal(calls,3)
 await articleSceneImages(options);assert.equal(calls,3)
})
test('uncertain image calls are not retried automatically',async()=>{
 const state={};let calls=0
 const options={project:{name:'brand'},title:'title',body:'body',articleId:'job',state,saveState:async()=>{},findSaved:()=>null,saveImage:()=>{},generate:async()=>{calls++;throw new Error('timeout')}}
 await assert.rejects(()=>articleSceneImages(options));await assert.rejects(()=>articleSceneImages(options),/待确认/);assert.equal(calls,1)
})

test('pending image slots can be explicitly released before resume',async()=>{
 const state={};let calls=0
 const options={project:{name:'brand'},title:'title',body:'body',articleId:'job',state,saveState:async()=>{},findSaved:()=>null,saveImage:async()=>({path:'/image.png'}),generate:async()=>{calls++;if(calls===1)throw new Error('timeout');return {data:Buffer.from('image'),ext:'png'}}}
 await assert.rejects(()=>articleSceneImages(options))
 assert.equal(resetPendingImageSlots(state),1)
 assert.equal((await articleSceneImages(options)).length,2)
 assert.equal(calls,3)
})
