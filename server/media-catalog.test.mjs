import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMediaCatalog} from './media-catalog.mjs'
import {mediaDetails,b2bPlatform} from './media-classification.mjs'
test('complete catalog supports hundreds of pages and global filtering; failed sync preserves snapshot',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'catalog-'));let broken=false,calls=0
 const client={fields:async()=>[{id:'3026',type:'field_3',title:'陕西'}],resources:async(c,p,size)=>{
  calls++;if(broken)throw Error('provider unavailable')
  return Array.from({length:Math.max(0,Math.min(size,13413-(p-1)*size))},(_,i)=>{const n=(p-1)*size+i;return {resource_id:String(n),title:`媒体${n}`,priceCents:n,fields:{field_1:'1006',field_3:n===13412?'3026':'3001'},sourcePage:p,sourcePageSize:size}})
 }}
 try{
  const catalog=createMediaCatalog({directory,client,identity:'fixture'})
  await catalog.sync('news');assert.equal(calls,135)
  let result=catalog.query('news',new URLSearchParams({page:'671'}))
  assert.equal(result.total,13413);assert.equal(result.totalPages,671);assert.equal(result.resources.length,13)
  result=catalog.query('news',new URLSearchParams({q:'媒体13412',region:'3026',maxPrice:'140'}))
  assert.equal(result.total,1);assert.equal(result.resources[0].sourcePage,135)
  assert.equal(result.fields[0].count,1)
  result=catalog.query('news',new URLSearchParams({pageSize:'100',sort:'high'}));assert.equal(result.resources[0].resource_id,'13412')
  broken=true;await assert.rejects(catalog.sync('news'))
  assert.equal(catalog.query('news',new URLSearchParams()).catalogTotal,13413)
  const reopened=createMediaCatalog({directory,client,identity:'fixture'})
  assert.equal(reopened.query('news',new URLSearchParams()).total,13413)
  assert.throws(()=>catalog.query('news',new URLSearchParams({page:'NaN'})))
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('social filters use platform, industry and real certification fields independently',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'social-catalog-'))
 const fields=[{id:'1011',type:'field_1',title:'知乎号'},{id:'2010',type:'field_2',title:'健康'},{id:'6001',type:'field_6',title:'已认证'},{id:'6002',type:'field_6',title:'未认证'},{id:'7002',type:'field_7',title:'非官方媒体'},{id:'8004',type:'field_8',title:'黄V认证'}]
 const rows=[{resource_id:'1',title:'企业蓝V名字不能作为认证依据',priceCents:600,fields:{field_1:'1011',field_2:'2010',field_3:'3009',field_6:'6002',field_7:'7002',field_8:''}},{resource_id:'2',title:'健康作者',priceCents:900,fields:{field_1:'1011',field_2:'2010',field_3:'3009',field_6:'6001',field_7:'7002',field_8:'8004'}}]
 try{
  const c=createMediaCatalog({directory,identity:'social-fixture',client:{fields:async()=>fields,resources:async()=>rows}})
  await c.sync('social')
  const result=c.query('social',new URLSearchParams({platform:'1011',industry:'2010',verification:'6001',mediaIdentity:'7002',feature:'8004'}))
  assert.equal(result.total,1);assert.equal(result.resources[0].resource_id,'2')
  assert.equal(result.resources[0].details.platform,'知乎号')
  assert.equal(result.resources[0].details.industry,'健康')
  assert.equal(result.resources[0].details.subject,'未提供')
  assert.equal(mediaDetails(rows[0],'social',fields).verification,'未认证')
  assert.equal(b2bPlatform({title:'博客园（GEO可发）'}),'博客园')
  assert.equal(b2bPlatform({title:'新闻报道博客园大会'}),'')
  await c.sync('news')
  assert.equal(c.query('b2b',new URLSearchParams()).total,5)
}finally{rmSync(directory,{recursive:true,force:true})}
})

test('news source 2 keeps a separate catalog and raw provider field ids',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'news2-catalog-'))
 const client={fields:async c=>c==='news2'?[{id:'网络媒体',type:'field_0',title:'网络媒体'},{id:'自媒体账号',type:'field_0',title:'自媒体账号'},{id:'北京',type:'field_3',title:'北京'},{id:'新闻资讯',type:'field_1',title:'新闻资讯'},{id:'今日头条',type:'field_1',title:'今日头条'},{id:'科技',type:'field_2',title:'科技'}]:[],resources:async(c,p,size)=>[{resource_id:'mtcg:1:44990',title:'媒体采购网新闻源',priceCents:1200,fields:{field_0:'网络媒体',field_1:'新闻资讯',field_3:'北京'},meta:{deadline:'18:00前',indexing:'包网页收录',linkType:'可带网址',weekendActive:'周末可发',weight:'5'},sourcePage:p,sourcePageSize:size},{resource_id:'mtcg:2:88',title:'自媒体账号资源',priceCents:1800,fields:{field_0:'自媒体账号',field_1:'今日头条',field_2:'科技',field_3:'自媒体账号'},meta:{publishSpeed:'当天发布',fans:'10万-100万'},sourcePage:p,sourcePageSize:size}]}
 try{
  const c=createMediaCatalog({directory,identity:'news2-fixture',client})
  await c.sync('news2')
  const result=c.query('news2',new URLSearchParams({region:'北京',platform:'新闻资讯'}))
  assert.equal(result.total,1)
  assert.equal(result.resources[0].details.region,'北京')
  assert.equal(result.resources[0].details.industry,'新闻资讯')
  assert.equal(result.resources[0].details.publishSpeed,'18:00前')
  assert.equal(result.resources[0].details.indexing,'包网页收录')
  assert.equal(result.resources[0].details.linkType,'可带网址')
  assert.equal(result.resources[0].details.weekendActive,'周末可发')
  assert.equal(result.resources[0].details.weight,'5')
  const self=c.query('news2',new URLSearchParams({mediaType:'自媒体账号',industry:'科技'}))
  assert.equal(self.total,1)
  assert.equal(self.resources[0].details.type,'自媒体账号')
  assert.equal(self.resources[0].details.category,'科技')
  assert.equal(self.resources[0].details.publishSpeed,'当天发布')
  assert.equal(self.resources[0].details.fans,'10万-100万')
  assert.equal(self.fields.find(f=>f.type==='field_1'&&f.id==='今日头条')?.count,1)
  assert.equal(self.fields.find(f=>f.type==='field_1'&&f.id==='新闻资讯')?.count,1)
  assert.equal(c.query('news',new URLSearchParams()).total,0)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('news source 1 exposes portal, indexing and speed filters like a media market',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'news1-catalog-'))
 const fields=[{id:'1006',type:'field_1',title:'新闻资讯'},{id:'2027',type:'field_2',title:'门户网'},{id:'3001',type:'field_3',title:'全国'},{id:'5001',type:'field_5',title:'包网页收录'},{id:'6002',type:'field_6',title:'可带网址'},{id:'7002',type:'field_7',title:'2小时'},{id:'9001',type:'field_9',title:'周末可发'}]
 const rows=[{resource_id:'1',title:'新闻媒体',priceCents:300,fields:{field_1:'1006',field_2:'2027',field_3:'3001',field_5:'5001',field_6:'6002',field_7:'7002',field_9:'9001'}},{resource_id:'2',title:'不匹配媒体',priceCents:300,fields:{field_1:'1006',field_2:'',field_3:'3001',field_5:'',field_6:'',field_7:'',field_9:''}}]
 try{
  const c=createMediaCatalog({directory,identity:'news1-market-fixture',client:{fields:async()=>fields,resources:async()=>rows}})
  await c.sync('news')
  const result=c.query('news',new URLSearchParams({platform:'1006',portal:'2027',indexEffect:'5001',linkType:'6002',publishSpeed:'7002',feature:'9001'}))
  assert.equal(result.total,1)
  assert.equal(result.resources[0].details.platform,'门户网')
  assert.equal(result.resources[0].details.indexing,'包网页收录')
  assert.equal(result.resources[0].details.publishSpeed,'2小时')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('media filter options stay visible while searching',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'media-filter-options-'))
 const fields=[{id:'网络媒体',type:'field_0',title:'网络媒体'},{id:'自媒体账号',type:'field_0',title:'自媒体账号'},{id:'新闻资讯',type:'field_1',title:'新闻资讯'},{id:'今日头条',type:'field_1',title:'今日头条'}]
 const rows=[{resource_id:'1',title:'博客园',priceCents:200,fields:{field_0:'网络媒体',field_1:'新闻资讯'}},{resource_id:'2',title:'头条资源',priceCents:300,fields:{field_0:'自媒体账号',field_1:'今日头条'}}]
 try{
  const c=createMediaCatalog({directory,identity:'media-filter-options-fixture',client:{fields:async()=>fields,resources:async()=>rows}})
  await c.sync('news2')
  const result=c.query('news2',new URLSearchParams({q:'博客园'}))
  assert.equal(result.total,1)
  assert.equal(result.fields.find(f=>f.type==='field_0'&&f.id==='自媒体账号')?.count,1)
  assert.equal(result.fields.find(f=>f.type==='field_1'&&f.id==='今日头条')?.count,1)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('news source 2 uses cache until an explicit refresh starts',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'news2-cache-'))
 let calls=0
 const client={fields:async()=>[{id:'网络媒体',type:'field_0',title:'网络媒体'}],resources:async()=>{calls++;return [{resource_id:'mtcg:1:1',title:'缓存媒体',priceCents:100,fields:{field_0:'网络媒体'}}]}}
 try{
  const c=createMediaCatalog({directory,identity:'news2-cache-fixture',client})
  await c.sync('news2')
  calls=0
  const first=c.query('news2',new URLSearchParams())
  const second=c.query('news2',new URLSearchParams())
  assert.equal(first.total,1)
  assert.equal(second.total,1)
  assert.equal(calls,0)
  c.query('news2',new URLSearchParams({refresh:'1'}))
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal(calls,1)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('B2B catalog prices use current pricing policy without media sync',()=>{
 const directory=mkdtempSync(join(tmpdir(),'b2b-pricing-'))
 try{
  const c=createMediaCatalog({directory,identity:'b2b-pricing-fixture'})
  const result=c.query('b2b',new URLSearchParams({q:'列举网'}),{priceFor:r=>({...r,basePriceCents:r.priceCents,priceCents:Math.ceil(r.priceCents*1.1/100)*100,price:(Math.ceil(r.priceCents*1.1/100)).toFixed(2)})})
  assert.equal(result.total,1)
  assert.equal(result.resources[0].resource_id,'b2b:4')
  assert.equal(result.resources[0].basePriceCents,80)
  assert.equal(result.resources[0].priceCents,100)
  assert.equal(result.resources[0].price,'1.00')
 }finally{rmSync(directory,{recursive:true,force:true})}
})
