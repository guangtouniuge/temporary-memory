import {createCipheriv,createHash,randomBytes} from 'node:crypto'
import {moneyCents} from './xiaoqingwa-client.mjs'

const fail=(status,message,uncertain=false)=>{throw Object.assign(new Error(message),{status,uncertain})}
const modelNames={1:'网络媒体',2:'自媒体账号',3:'微信',4:'微博',5:'贴吧',6:'论坛',7:'问答',10:'小红书',11:'百科'}
const enabledModels=Object.keys(modelNames)
const paths={resources:'/api/companyResource/syncResource',submit:'/api/companyOrder/receive',status:'/api/companyOrder/getOrderStatusNew'}
const csv=text=>String(text).split(',').map(s=>s.trim()).filter(Boolean)
const aiIncludeNames={1:'百度AI',2:'豆包AI',3:'deepseek',4:'元宝',5:'kimi',6:'通义千问',7:'纳米',8:'智谱',9:'夸克'}
const yesNo=(value,yes='是',no='否')=>{
  const text=String(value??'').trim()
  if(!text)return ''
  if(['1','true','yes','是','可发'].includes(text))return yes
  if(['0','false','no','否','不可发'].includes(text))return no
  return text
}
const detailValue=(r,keys)=>keys.map(key=>String(r[key]??'').trim()).find(Boolean)||''
const aiInclude=value=>csv(value).map(v=>aiIncludeNames[v]||v).join('、')
const decodeProviderResponse=async response=>{
  const bytes=new Uint8Array(await response.arrayBuffer())
  const charset=String(response.headers?.get?.('content-type')||'').match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase()
  const decode=encoding=>new TextDecoder(encoding,{fatal:false}).decode(bytes)
  if(charset&&charset!=='utf-8'&&charset!=='utf8')return decode(charset)
  const utf8=decode('utf-8')
  if(!utf8.includes('\uFFFD'))return utf8
  try{
    const gb=decode('gb18030')
    if(gb&&!gb.includes('\uFFFD'))return gb
  }catch{}
  return utf8
}
const modelValues=Object.values(modelNames).join(',')
const networkFields=[
  ['field_0','__model',modelValues],
  ['field_1','pindaoleixing','IT科技,财经金融,新闻资讯,健康医疗,汽车行业,留学教育,家装家居,房产行业,生活消费,酒店旅游,女性时尚,游戏行业,娱乐行业,文化艺术,亲子母婴,贸易能源,食品餐饮,体育运动,区块链,公益,其他'],
  ['field_3','quyu','全国,海外发稿,北京,天津,河北,山西,内蒙古,辽宁,吉林,黑龙江,上海,江苏,浙江,安徽,福建,江西,山东,河南,湖北,湖南,广东,广西,海南,重庆,四川,贵州,云南,西藏,陕西,甘肃,青海,宁夏,新疆,台湾,香港,澳门'],
  ['field_4','zonghemenhu','搜狐网,新浪网,凤凰网,网易网,腾讯网,中国网,人民网,央视网,中国日报网,中国经济网,官方百家号,中国广播网,中国新闻网,光明网,环球网,中国青年网,国际在线,和讯网,其他门户'],
  ['field_5','lianjieleixing','不可带网址,可带网址'],
  ['field_6','shouluxiaoguo','包网页收录,不包网页收录,包资讯收录,不包资讯收录'],
]
const fieldMap=Object.fromEntries(networkFields.map(([type,key])=>[type,key]))
const selfMediaFields=[
  ['field_0','__model',modelValues],
  ['field_1','pingtai','今日头条,百家号,新浪,网易,腾讯,凤凰,搜狐,车市e家,懂车帝,网上车市,车架号,易车号,太平洋汽车,爱卡汽车,汽车之家,汽车头条,爱奇艺,优酷,腾讯视频,哔哩哔哩,东方头条,一点资讯,UC,知乎,豆瓣,北京时间,简书,东方财富,中金在线,雪球,趣头条,封面新闻,搜狗号,快传号,金色财经,马蜂窝,驴妈妈,携程,去哪儿,同花顺,艾瑞网,其他'],
  ['field_2','hangyefenlei','热门,KOL,科技,商业,财经,新闻,电商,健康,生活,房产家居,互联网,教育,时尚,母婴,汽车,娱乐,旅游,职场,文化,历史,体育,美食,公益,游戏动漫,情感,三农,搞笑,地区,其他'],
  ['field_3','__region','自媒体账号'],
  ['field_6','huangv','是,否,蓝V认证,红V认证'],
  ['field_7','meitihao','非企业号,企业号'],
]
const selfMediaFieldMap=Object.fromEntries(selfMediaFields.map(([type,key])=>[type,key]))
const extendedFields=[
  ['field_0','__model',modelValues],
  ['field_1','__primary','微信,微博,贴吧,论坛,问答,小红书,百科,科技类,财经类,综合类,健康类,教育类,家居类,房产类,生活类,旅游类,女性类,汽车类,游戏类,娱乐类,艺术类,母婴类,能源类,食品类,体育类,其他,百度问答,知乎问答,360问答,soso问答,悟空问答,天涯问答,新浪问答,太平洋亲子问答,其他问答,美妆,时尚,育儿,科技,财经,健康,家居,企业词条,品牌词条,网站词条,APP词条,电影词条,游戏词条,人物词条,产品词条'],
  ['field_2','__secondary','美妆时尚,美女帅哥,流量名人,媒体传播,美食,动漫,游戏,IT互联网,母婴,汽车,萌宠,运动健身,数码,影视,教育,旅游,设计,健康养生,音乐,人文艺术,摄影娱乐,明星,家居房产,理财,法律法规,公益,电商物流,健康医疗,金融财经,加盟,可带联系方式,不可带联系方式,普通,优质,百度百科,搜狗百科,互动百科,维基百科'],
  ['field_3','quyu','全国,海外发稿,北京,天津,河北,山西,内蒙古,辽宁,吉林,黑龙江,上海,江苏,浙江,安徽,福建,江西,山东,河南,湖北,湖南,广东,广西,海南,重庆,四川,贵州,云南,西藏,陕西,甘肃,青海,宁夏,新疆,台湾,香港,澳门,海外'],
  ['field_6','__cert','未认证,金V认证,红V认证,蓝V认证,普通,优质,不保证,保证,基础版本,标准版本,高级版本'],
]
const fieldValue=(r,keys)=>keys.map(key=>String(r[key]??'').trim()).find(Boolean)||''
const modelFieldMaps={
  '3':{field_1:r=>fieldValue(r,['hangyeleixing']),field_2:r=>fieldValue(r,['wxcankaofensi','wxcankaoyuedu']),field_3:r=>fieldValue(r,['quyu']),field_6:r=>fieldValue(r,['fabusudu'])},
  '4':{field_1:r=>fieldValue(r,['hangyeleixing']),field_2:r=>fieldValue(r,['wbcankaofensi']),field_3:r=>fieldValue(r,['quyu']),field_6:r=>fieldValue(r,['shenfenrenzheng'])},
  '5':{field_1:r=>fieldValue(r,['pindaoleixing']),field_2:r=>fieldValue(r,['kefaleixing']),field_3:r=>fieldValue(r,['quyu']),field_6:r=>fieldValue(r,['lianxifangshi'])},
  '6':{field_1:r=>fieldValue(r,['pindaoleixing']),field_2:r=>fieldValue(r,['kefaleixing']),field_3:r=>fieldValue(r,['quyu']),field_6:r=>fieldValue(r,['lianxifangshi'])},
  '7':{field_1:r=>fieldValue(r,['pingtai']),field_2:r=>fieldValue(r,['kefaleixing']),field_3:()=> '问答',field_6:r=>fieldValue(r,['lianxifangshi'])},
  '10':{field_1:r=>fieldValue(r,['pindaoleixing']),field_2:r=>fieldValue(r,['fensiliang']),field_3:()=> '小红书',field_6:r=>fieldValue(r,['zhanghaozhiliang','shouluxiaoguo'])},
  '11':{field_1:r=>fieldValue(r,['pindaoleixing']),field_2:r=>fieldValue(r,['baikeleixing']),field_3:()=> '百科',field_6:r=>fieldValue(r,['zhanxianleixing'])},
}
const parseResourceId=id=>{
  const match=String(id).match(/^mtcg:(\d+):(.+)$/)
  return match?{modelId:match[1],resourceId:match[2]}:{modelId:'1',resourceId:String(id)}
}
const cleanResourceId=(modelId,id)=>`mtcg:${modelId}:${id}`
const providerOrderId=id=>String(id).replace(/[^A-Za-z0-9_]/g,'')
const resourceMeta=(r,modelId)=>{
  const meta={
    publishSpeed: detailValue(r,['fabusudu','chugaosudu','chugaoshijian','jiaogaoshijian','hw_fabusudu']),
    deadline: detailValue(r,['jiegaoshijian']),
    indexing: detailValue(r,['shouluxiaoguo']),
    linkType: detailValue(r,['lianjieleixing','zhanxianleixing']),
    contact: detailValue(r,['lianxifangshi']),
    weekendActive: yesNo(r.weekend_active,'周末可发','周末不可发'),
    linkPeriod: detailValue(r,['link_period']),
    weight: detailValue(r,['meitiquanzhong']),
    portal: detailValue(r,['zonghemenhu']),
    aiInclude: aiInclude(r.ai_include),
    imageFee: detailValue(r,['tupianfeiyong']),
    translation: detailValue(r,['fanyixuanxiang']),
    country: detailValue(r,['guojiadiqu']),
    language: detailValue(r,['yuyanfenlei']),
    fans: detailValue(r,['wxcankaofensi','wbcankaofensi','fensiliang']),
    reads: detailValue(r,['wxcankaoyuedu']),
    likes: detailValue(r,['dianzanliang']),
  }
  if(modelId==='2')meta.identity=detailValue(r,['huangv'])
  return Object.fromEntries(Object.entries(meta).filter(([,value])=>String(value||'').trim()))
}

export function phpSerialize(value){
  if(Array.isArray(value))return `a:${value.length}:{${value.map((v,i)=>phpSerialize(String(i))+phpSerialize(v)).join('')}}`
  if(value&&typeof value==='object'){
    const entries=Object.entries(value)
    return `a:${entries.length}:{${entries.map(([k,v])=>phpSerialize(k)+phpSerialize(v)).join('')}}`
  }
  const text=String(value??'')
  return `s:${Buffer.byteLength(text,'utf8')}:"${text}";`
}

export function encryptedFormFields(data,key,iv=randomBytes(16)){
  if(!/^[\s\S]{32}$/.test(String(key||'')))fail(503,'媒体采购网KEY格式无效')
  const cipher=createCipheriv('aes-256-cbc',Buffer.from(key),iv)
  const encrypted=Buffer.concat([cipher.update(phpSerialize(data),'utf8'),cipher.final()]).toString('base64')
  const response=Buffer.from(JSON.stringify({iv:iv.toString('base64'),value:encrypted})).toString('base64')
  return {response,sign:createHash('md5').update(response).digest('hex'),app_key:key}
}

export function createMeiticaigouClient({baseUrl,key,fetcher=fetch}){
  async function call(path,data,submission=false){
    if(!baseUrl||!key)fail(503,'媒体采购网尚未配置')
    const endpoint=new URL(path,baseUrl)
    if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)fail(503,'媒体采购网接口地址无效')
    const form=new FormData()
    for(const [name,value] of Object.entries(encryptedFormFields(data,key)))form.set(name,value)
    let response,body
    try{
      response=await fetcher(endpoint,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(60000)})
      body=JSON.parse(await decodeProviderResponse(response))
    }catch{fail(502,submission?'投稿结果待核实，请勿重复投稿':'媒体采购网接口暂时不可用',submission)}
    if(!response.ok||String(body?.errorCode??'')!==''){
      const reason=String(body?.message||body?.errorCode||'').replaceAll(key,'[已隐藏]').replace(/<[^>]*>/g,'').slice(0,180)
      fail(502,(submission?'投稿未确认，请先核实订单':'媒体采购网返回异常')+(reason?`：${reason}`:''),submission)
    }
    return body
  }
  const normalizeResource=(r,page,pageSize,modelId=String(r?.model_id||'1'))=>{
    if(!r?.id||!String(r.name||'').trim())fail(502,'媒体采购网资源资料不完整')
    const cents=moneyCents(r.price_assign)
    let caseLink=''
    try{const u=new URL(String(r.meitianli||''));if(['http:','https:'].includes(u.protocol))caseLink=u.href}catch{}
    const map=modelId==='2'?selfMediaFieldMap:fieldMap
    const fields=enabledModels.includes(modelId)&&!['1','2'].includes(modelId)
      ? Object.fromEntries(Object.entries(modelFieldMaps[modelId]||{}).map(([type,read])=>[type,read(r)]).concat([['field_0',modelNames[modelId]||modelId]]))
      : Object.fromEntries(Object.entries(map).map(([type,key])=>[type,key==='__model'?modelNames[modelId]||modelId:key==='__region'?'自媒体账号':String(r[key]??'')]))
    return {resource_id:cleanResourceId(modelId,r.id),providerResourceId:String(r.id),providerModelId:modelId,title:String(r.name).trim(),price:(cents/100).toFixed(2),priceCents:cents,remarks:String(r.meitibeizhu||''),case_link:caseLink,providerStatus:r.status,fields,meta:resourceMeta(r,modelId),sourcePage:page,sourcePageSize:pageSize}
  }
  return {
    resourceModels(){return enabledModels},
    async fields(channel){
      if(channel!=='news2')fail(400,'不支持的媒体渠道')
      const rows=[...networkFields,...selfMediaFields,...extendedFields].flatMap(([type,,values])=>csv(values).map(title=>({id:title,type,title})))
      return [...new Map(rows.map(row=>[`${row.type}:${row.id}`,row])).values()]
    },
    async resources(channel,page=1,pageSize=20,{modelId='1'}={}){
      if(channel!=='news2')fail(400,'不支持的媒体渠道')
      if(!Number.isSafeInteger(page)||page<1)fail(400,'页码无效')
      if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1000)fail(400,'每页数量无效')
      if(!enabledModels.includes(String(modelId)))fail(400,'媒体类型暂不支持')
      const body=await call(paths.resources,{model_id:String(modelId),limit:String(pageSize),page:String(page)})
      const rows=Array.isArray(body.data)?body.data:Array.isArray(body.data?.data)?body.data.data:null
      if(!rows)fail(502,'媒体采购网资源格式异常')
      return rows.map(r=>normalizeResource(r,page,pageSize,String(modelId)))
    },
    async submit(channel,{resourceId,title,content,thirdId}){
      if(channel!=='news2')fail(400,'不支持的媒体渠道')
      if(!resourceId||!title?.trim()||!content?.trim()||!thirdId)fail(400,'投稿资料不完整')
      const parsed=parseResourceId(resourceId)
      const customerOrderId=providerOrderId(thirdId)
      if(!customerOrderId)fail(400,'投稿订单号无效')
      const prop=JSON.stringify({biaoti:title,neirong:content,laiyuan:'',miaoshu:'',tuiguang:'',xuanchuan:'',xinwenlianjie:'',yingyezhizhao:'',qiyelogo:'',yuanwenlianjie:'',fengmian:''})
      await call(paths.submit,{customer_order_id:customerOrderId,out_model_id:parsed.modelId,out_resource_id:parsed.resourceId,resource_price:'',prop},true)
      return {orderId:`${parsed.modelId}:${customerOrderId}`,status:'submitted'}
    },
    async orderDetails(channel,ids){
      if(channel!=='news2')fail(400,'不支持的媒体渠道')
      if(!Array.isArray(ids)||!ids.length||ids.some(id=>!String(id)))fail(400,'订单编号无效')
      const rows=[]
      for(const id of ids){
        const parsed=String(id).match(/^(\d+):(.+)$/)
        const modelId=parsed?.[1]||'1',customerId=parsed?.[2]||String(id)
        const body=await call(paths.status,{model_id:modelId,customer_order_id:customerId})
        const data=body.data&&typeof body.data==='object'?body.data:{}
        const status=Number(body.status||data.status||0)
        const firstLink=String(data.return_info||'').split(';').find(item=>/^https?:\/\//i.test(item.trim()))?.trim()
        rows.push({order_nid:String(id),status,message:String(body.message||''),rejection_info:String(data.refund_reason||''),refund_info:String(data.refund_info||''),is_refund:Number(body.is_refund??data.is_refund??(status===1004?1:0)),url:firstLink||''})
      }
      return rows
    }
  }
}
