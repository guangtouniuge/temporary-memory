const fail = (status, message, uncertain = false) => { throw Object.assign(new Error(message), {status, uncertain}) }
const paths = {news:'/api/media', social:'/api/zi_media_api', b2b:'/api/b2b_v2'}
const geoPlatforms = new Set(['1','2','3','4','5','6','7','8'])
export function moneyCents(value) {
  const text=String(value ?? '')
  if(!/^\d+(\.\d{1,2})?$/.test(text))fail(502,'媒体报价无效')
  const [whole,fraction='']=text.split('.')
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
  if(!Number.isSafeInteger(cents))fail(502,'媒体报价无效')
  return cents
}
export function createXiaoqingwaClient({baseUrl,key,fetcher=fetch}) {
  async function request(path, fields = {}, {submission=false, method='POST', encoded=false} = {}) {
    if(!baseUrl || !key)fail(503,'小青蛙尚未配置')
    const endpoint=new URL(path,baseUrl)
    if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)fail(503,'媒体接口地址无效')
    let options={method,redirect:'error',signal:AbortSignal.timeout(30000)}
    if(method==='GET') {
      for(const [name,value] of Object.entries({api_key:key,...fields}))endpoint.searchParams.set(name,String(value))
    } else {
      const form=encoded?new URLSearchParams():new FormData();form.set('api_key',key)
      for(const [name,value] of Object.entries(fields)) {
        for(const item of Array.isArray(value)?value:[value])form.append(name,String(item))
      }
      options.body=form
    }
    let response,data
    try {
      response=await fetcher(endpoint,options)
      const text=await response.text()
      data=JSON.parse(text,(k,v,context)=>k==='order_nid'&&typeof v==='number'?context.source:v)
    } catch {fail(502,submission?'平台结果待核实，请勿重复提交':'小青蛙接口暂时不可用',submission)}
    if(!response.ok || Number(data?.code)!==1){
      const reason=String(data?.msg||'').replaceAll(key,'[已隐藏]').replace(/<[^>]*>/g,'').slice(0,180)
      fail(502,(submission?'平台提交未确认，请先核实订单':'小青蛙接口返回异常')+(reason?`：${reason}`:''),submission)
    }
    return data.data
  }
  async function call(channel,action,fields,submission=false) {
    if(!paths[channel])fail(400,'不支持的媒体渠道')
    return request(`${paths[channel]}/${action}`,fields,{submission,encoded:channel==='b2b'})
  }
  return {
    async createInclusion({platform,keywords,question,thirdId}) {
      if(!geoPlatforms.has(String(platform)))fail(400,'诊断平台无效')
      if(!String(keywords||'').trim()||!String(question||'').trim())fail(400,'诊断词和问题不能为空')
      const data=await request('/api/geo/add_shoulu',{platform,keywords,question,third_id:thirdId||''},{submission:true})
      if(!data?.request_id)fail(502,'诊断结果缺少任务编号，请勿重复提交',true)
      return {requestId:String(data.request_id)}
    },
    async checkInclusion(requestId) {
      if(!String(requestId||'').trim())fail(400,'诊断任务编号无效')
      return request('/api/geo/check_task',{request_id:String(requestId)})
    },
    async balance() {
      return request('/api/geo/get_balance',{})
    },
    async preAnalyze(input) {
      if(!String(input||'').trim())fail(400,'品牌名称不能为空')
      return request('/api/we_wo/preAnalyze',{input:String(input).trim()},{encoded:true})
    },
    async createReport({brandName,requirement,thirdPartyIdentifier}) {
      if(!String(brandName||'').trim()||!String(requirement||'').trim())fail(400,'报告资料不完整')
      const data=await request('/api/we_wo/createReports',{brandName,requirement,third_party_identifier:thirdPartyIdentifier||'geoskill'},{submission:true,encoded:true})
      return data
    },
    async reportStatus(reportId) {
      if(!String(reportId||'').trim())fail(400,'报告编号无效')
      return request(`/api/we_wo/queryReports/reportId/${encodeURIComponent(String(reportId))}`,{}, {method:'GET'})
    },
    async reportDownload(reportId) {
      if(!String(reportId||'').trim())fail(400,'报告编号无效')
      return request(`/api/we_wo/downloadReportsForPdf/reportId/${encodeURIComponent(String(reportId))}`,{}, {method:'GET'})
    },
    async fields(channel){
      const data=await call(channel,'get_field',{media_type:channel==='social'?'wemedia':'website',field_type:''})
      if(!Array.isArray(data))fail(502,'媒体分类格式异常')
      return data.map(r=>({id:String(r.field_id),type:String(r.field_type),title:String(r.field_title)}))
    },
    async resources(channel,page=1,pageSize=20) {
      if(!Number.isSafeInteger(page)||page<1)fail(400,'页码无效')
      if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail(400,'每页数量无效')
      const data=await call(channel,'media_list',{page,page_size:pageSize})
      if(!Array.isArray(data))fail(502,'媒体列表格式异常')
      return data.map(r=>{
        if(!r.resource_id || !String(r.title||'').trim())fail(502,'媒体资料不完整')
        const cents=moneyCents(r.price)
        let caseLink=''
        try {const u=new URL(r.case_link);if(['https:','http:'].includes(u.protocol))caseLink=u.href}catch{}
        return {resource_id:String(r.resource_id),title:String(r.title).trim(),price:(cents/100).toFixed(2),priceCents:cents,remarks:String(r.remarks||''),case_link:caseLink,providerStatus:r.status,pc_weigh:String(r.pc_weigh??''),wap_weigh:String(r.wap_weigh??''),fields:Object.fromEntries(Array.from({length:11},(_,i)=>[`field_${i+1}`,String(r[`field_${i+1}`]??'')])),sourcePage:page,sourcePageSize:pageSize}
      })
    },
    async orderDetails(channel,ids) {
      if(!Array.isArray(ids)||!ids.length||ids.some(id=>!/^\d+$/.test(String(id))))fail(400,'订单编号无效')
      const data=await call(channel,'order_info',{'order_nids[]':ids})
      const rows=Array.isArray(data)?data:[data]
      if(rows.some(r=>!r?.order_nid||!ids.map(String).includes(String(r.order_nid))))fail(502,'返回订单与查询不一致')
      // Preserve provider status until its complete enumeration is verified.
      return rows
    },
    async submit(channel,{resourceId,title,content,thirdId,remark='',b2b}) {
      if(!resourceId||!title?.trim()||!content?.trim()||!thirdId)fail(400,'投稿资料不完整')
      const data=channel==='b2b'
        ?await call(channel,'send_article',{type:String(resourceId).replace(/^b2b:/,''),title,content,...b2b},true)
        :await call(channel,'send',{resource_id:resourceId,title,content,third_id:thirdId,remark},true)
      if(!data?.order_nid || typeof data.order_nid==='number'&&!Number.isSafeInteger(data.order_nid))fail(502,'投稿结果缺少可靠订单号，请勿重复投稿',true)
      return {orderId:String(data.order_nid),status:'submitted'}
    }
  }
}
