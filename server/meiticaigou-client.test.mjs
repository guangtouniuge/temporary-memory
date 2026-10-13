import test from 'node:test'
import assert from 'node:assert/strict'
import {createDecipheriv,createHash} from 'node:crypto'
import {createMeiticaigouClient,encryptedFormFields,phpSerialize} from './meiticaigou-client.mjs'

const key='12345678901234567890123456789012'
function decryptForm(form){
  const fields=Object.fromEntries(form.entries())
  assert.equal(fields.app_key,key)
  assert.equal(fields.sign,createHash('md5').update(fields.response).digest('hex'))
  const box=JSON.parse(Buffer.from(fields.response,'base64').toString('utf8'))
  const decipher=createDecipheriv('aes-256-cbc',Buffer.from(key),Buffer.from(box.iv,'base64'))
  return Buffer.concat([decipher.update(Buffer.from(box.value,'base64')),decipher.final()]).toString('utf8')
}

test('php serialization and encrypted form match provider contract',()=>{
  assert.equal(phpSerialize({model_id:'1',title:'标题'}),'a:2:{s:8:"model_id";s:1:"1";s:5:"title";s:6:"标题";}')
  const form=encryptedFormFields({model_id:'1'},key,Buffer.alloc(16,1))
  assert.equal(form.app_key,key)
  assert.equal(form.sign,createHash('md5').update(form.response).digest('hex'))
})

test('resources map media purchase rows into news source catalog rows',async()=>{
  const posted=[]
  const client=createMeiticaigouClient({baseUrl:'http://provider.test',key,fetcher:async(url,{body})=>{
    assert.equal(url.href,'http://provider.test/api/companyResource/syncResource')
    const payload=decryptForm(body);posted.push(payload)
    const self=payload.includes('s:8:"model_id";s:1:"2"')
    const forum=payload.includes('s:8:"model_id";s:1:"6"')
    const data=forum?{id:77,model_id:6,name:'测试论坛博客源',price_assign:'8.00',pindaoleixing:'科技类',kefaleixing:'金融财经',quyu:'全国',lianxifangshi:'不可带联系方式',chugaosudu:'24小时内',weekend_active:'1',link_period:'长期有效',meitianli:'https://case.example/forum',meitibeizhu:'论坛投稿',status:1}:self?{id:552,model_id:2,name:'测试自媒体账号',price_assign:'21.00',pingtai:'百家号',hangyefenlei:'科技',huangv:'蓝V认证',meitihao:'企业号',fabusudu:'当天发布',wxcankaofensi:'10万-100万',wxcankaoyuedu:'5000+',meitianli:'https://case.example/self',meitibeizhu:'账号投稿',status:1}:{id:44990,model_id:1,name:'测试新闻源',price_assign:'12.50',pindaoleixing:'新闻资讯',quyu:'北京',zonghemenhu:'搜狐网',lianjieleixing:'可带网址',shouluxiaoguo:'包网页收录',jiegaoshijian:'18:00前',weekend_active:'1',meitiquanzhong:'5',ai_include:'1,3',meitianli:'https://case.example/a',meitibeizhu:'可带图',status:1}
    return new Response(JSON.stringify({errorCode:'',message:'查询成功',data:{data:[data]}}))
  }})
  const rows=await client.resources('news2',1,20)
  assert.match(posted[0],/s:8:"model_id";s:1:"1"/)
  assert.equal(rows[0].resource_id,'mtcg:1:44990')
  assert.equal(rows[0].title,'测试新闻源')
  assert.equal(rows[0].priceCents,1250)
  assert.equal(rows[0].fields.field_1,'新闻资讯')
  assert.equal(rows[0].case_link,'https://case.example/a')
  assert.equal(rows[0].meta.deadline,'18:00前')
  assert.equal(rows[0].meta.indexing,'包网页收录')
  assert.equal(rows[0].meta.linkType,'可带网址')
  assert.equal(rows[0].meta.weekendActive,'周末可发')
  assert.equal(rows[0].meta.weight,'5')
  assert.equal(rows[0].meta.aiInclude,'百度AI、deepseek')
  const selfRows=await client.resources('news2',1,20,{modelId:'2'})
  assert.match(posted[1],/s:8:"model_id";s:1:"2"/)
  assert.equal(selfRows[0].resource_id,'mtcg:2:552')
  assert.equal(selfRows[0].fields.field_0,'自媒体账号')
  assert.equal(selfRows[0].fields.field_1,'百家号')
  assert.equal(selfRows[0].fields.field_3,'自媒体账号')
  assert.equal(selfRows[0].fields.field_7,'企业号')
  assert.equal(selfRows[0].meta.publishSpeed,'当天发布')
  assert.equal(selfRows[0].meta.fans,'10万-100万')
  assert.equal(selfRows[0].meta.reads,'5000+')
  const forumRows=await client.resources('news2',1,20,{modelId:'6'})
  assert.match(posted[2],/s:8:"model_id";s:1:"6"/)
  assert.equal(forumRows[0].resource_id,'mtcg:6:77')
  assert.equal(forumRows[0].fields.field_0,'论坛')
  assert.equal(forumRows[0].fields.field_1,'科技类')
  assert.equal(forumRows[0].fields.field_3,'全国')
  assert.equal(forumRows[0].meta.publishSpeed,'24小时内')
  assert.equal(forumRows[0].meta.contact,'不可带联系方式')
  assert.equal(forumRows[0].meta.linkPeriod,'长期有效')
})

test('submit uses local order id and refresh maps provider status link',async()=>{
  const calls=[]
  const client=createMeiticaigouClient({baseUrl:'http://provider.test',key,fetcher:async(url,{body})=>{
    calls.push({path:url.pathname,payload:decryptForm(body)})
    if(url.pathname.endsWith('/receive'))return new Response(JSON.stringify({errorCode:'',message:'成功',data:'success'}))
    return new Response(JSON.stringify({errorCode:'',message:'稿件状态：已发布',status:1002,data:{status:1002,return_info:'https://news.example/a;https://news.example/b',refund_reason:''}}))
  }})
  const receipt=await client.submit('news2',{resourceId:'mtcg:1:44990',title:'标题',content:'<p>正文</p>',thirdId:'local-order-1'})
  assert.equal(receipt.orderId,'1:localorder1')
  assert.match(calls[0].payload,/s:17:"customer_order_id";s:11:"localorder1"/)
  assert.match(calls[0].payload,/s:15:"out_resource_id";s:5:"44990"/)
  const details=await client.orderDetails('news2',['1:local-order-1'])
  assert.equal(details[0].order_nid,'1:local-order-1')
  assert.equal(details[0].status,1002)
  assert.equal(details[0].url,'https://news.example/a')
})

test('rejected media purchase status is normalized as a confirmed refund',async()=>{
  const client=createMeiticaigouClient({baseUrl:'http://provider.test',key,fetcher:async(url,{body})=>{
    assert.equal(url.pathname,'/api/companyOrder/getOrderStatusNew')
    assert.match(decryptForm(body),/customer_order_id/)
    return new Response(JSON.stringify({errorCode:'',message:'稿件状态：已退稿',status:1004,data:{status:1004,refund_reason:'内容与网站定位不符'}}))
  }})
  const details=await client.orderDetails('news2',['1:local-order-1'])
  assert.equal(details[0].status,1004)
  assert.equal(details[0].is_refund,1)
  assert.equal(details[0].rejection_info,'内容与网站定位不符')
})
