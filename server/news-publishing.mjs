import {createXiaoqingwaClient} from './xiaoqingwa-client.mjs'
import {createMeiticaigouClient} from './meiticaigou-client.mjs'
import {articleHtml} from './article-format.mjs'
import {prepareNewsImages,newsImageBytes} from './news-assets.mjs'
import {b2bResources,b2bOptions} from './b2b-catalog.mjs'
import sanitizeHtml from 'sanitize-html'
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})}
const nonRepeatArticleStates=new Set(['scheduled','reserved','sending','uncertain','submitted','linked'])
export function createNewsPublishing({auth,readState,scope,readJson,json,priceFor}) {
  const catalog=new Map()
  const client=(channel,projectId=scope().projectId)=>{
    if(channel==='news2')return createMeiticaigouClient({baseUrl:process.env.MEITICAIGOU_BASE_URL,key:process.env.MEITICAIGOU_APP_KEY})
    const custom=auth.providerConfig(projectId,'xiaoqingwa')
    return createXiaoqingwaClient({baseUrl:custom?.baseUrl||process.env.XIAOQINGWA_BASE_URL,key:custom?.apiKey||process.env.XIAOQINGWA_KEY})
  }
  let queueRunning=false
  const submitReservedRows=async(owner,store,rows,projectId=scope().projectId)=>{
    for(const row of rows){
      const item=store.claim(owner,row.id);if(!item)continue
      try {const receipt=await client(item.providerChannel||'news',projectId).submit(item.providerChannel||'news',{resourceId:item.resourceId,title:item.title,content:item.content,thirdId:item.id,b2b:item.b2b});store.accepted(owner,item.id,receipt.orderId)}
      catch(error) {store.uncertain(owner,item.id,error.message)}
    }
  }
  const processDueScheduled=(owner,store,projectId=scope().projectId)=>{
    if(queueRunning)return
    const due=store.dueScheduled(owner,Date.now(),20)
    if(!due.length)return
    queueRunning=true
    void (async()=>{
      try{
        const rows=store.reserve(owner,due.map(o=>o.id))
        await submitReservedRows(owner,store,rows,projectId)
      }catch(error){
        console.error('News scheduled queue stopped:',error.message)
      }finally{
        queueRunning=false
      }
    })()
  }
  const scanScheduledQueues=()=>{
    if(typeof auth.newsProjectIds!=='function')return
    for(const projectId of auth.newsProjectIds()){
      try{
        const {owner,store}=auth.newsOrders(projectId)
        processDueScheduled(owner,store,projectId)
      }catch(error){
        console.error('News scheduled queue scan failed:',error.message)
      }
    }
  }
  setTimeout(scanScheduledQueues,3000).unref()
  const scheduleTimer=setInterval(scanScheduledQueues,30*1000)
  scheduleTimer.unref()
  return {
    publicImage(req,res,url){
      if(req.method!=='GET'||!url.pathname.startsWith('/api/news-image/'))return false
      const asset=auth.newsAsset(url.pathname.slice('/api/news-image/'.length))
      if(!asset){json(res,404,{error:'图片不存在'});return true}
      try{const bytes=newsImageBytes(asset);res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(bytes)}catch{json(res,404,{error:'图片不存在'})}
      return true
    },
    remember(resources,page,channel='news'){for(const r of resources)catalog.set(`${channel}:${r.resource_id}`,{...r,page:r.sourcePage||page,pageSize:r.sourcePageSize||20,at:Date.now()})},
    async handle(req,res,url,account){
      if(!url.pathname.startsWith('/api/news/'))return false
      if(!['super_admin','agent','project_admin'].includes(account.role))fail(403,'需要发布权限')
      const articles=()=>readState('geo.articleRows').filter(a=>a.status==='已生成' && typeof a.body==='string' && a.body.trim())
      if(req.method==='GET'&&url.pathname==='/api/news/content'){json(res,200,{ok:true,articles:articles(),brands:readState('geo.projectRows').map(p=>p.name)});return true}
      const {owner,store}=auth.newsOrders(scope().projectId)
      if(req.method==='GET'&&url.pathname==='/api/news/orders'){store.expireAllStale();processDueScheduled(owner,store);json(res,200,{ok:true,orders:store.list(owner)});return true}
      if(req.method!=='POST')fail(405,'请求方法不支持')
      const body=await readJson(req)
      if(url.pathname==='/api/news/quote'){
        const channel=body.channel||'news'
        if(!['news','social','b2b','news2'].includes(channel))fail(400,'投稿渠道不支持')
        if(!readState('geo.projectRows').some(p=>p.name===body.brand))fail(403,'品牌不属于当前项目')
        if(!Array.isArray(body.allocations)||!body.allocations.length||body.allocations.length>100)fail(400,'请选择媒体和文章')
        const available=articles(),items=[],seen=new Set(),fresh=new Map()
        const lockedArticles=new Set(store.list(owner).filter(o=>o.brand===body.brand&&nonRepeatArticleStates.has(o.state)).map(o=>o.articleId))
        for(const a of body.allocations){
          let media
          if(channel==='b2b')media=b2bResources.find(r=>r.resource_id===a.resourceId)
          else {
            const cached=catalog.get(`${channel}:${a.resourceId}`)
            if(!cached)fail(409,'媒体资料已过期，请刷新媒体列表')
            if(channel==='news2')media=cached
            else {
              const pageKey=`${cached.page}:${cached.pageSize}`
              if(!fresh.has(pageKey))fresh.set(pageKey,await client(channel).resources(channel,cached.page,cached.pageSize))
              media=fresh.get(pageKey).find(r=>String(r.resource_id)===String(a.resourceId))
            }
          }
          if(!media)fail(409,'所选媒体已变化，请刷新')
          media = typeof priceFor === 'function' ? priceFor(media, channel, account) : media
          if(!Array.isArray(a.articleIds)||!a.articleIds.length)fail(400,'请分配文章')
          for(const id of a.articleIds){
            const article=available.find(r=>r.id===id && r.project===body.brand)
            if(!article)fail(403,'文章不属于当前品牌或没有可发布正文')
            if(lockedArticles.has(id))fail(409,`文章“${article.title}”已进入发布流程或已有发布记录，退回后才能重新发布`)
            const pair=`${id}:${media.resource_id}`;if(seen.has(pair))fail(400,'同一媒体不能重复分配同一篇文章');seen.add(pair)
            const edit=body.edits?.[id]
            const title=edit?.title??article.title,content=edit?.body??article.body
            if(typeof title!=='string'||!title.trim()||typeof content!=='string'||!content.trim())fail(400,'投稿标题和正文不能为空')
            const prepared=prepareNewsImages(articleHtml(content))
            let options
            if(channel==='b2b'){
              let cover=''
              sanitizeHtml(prepared.content,{transformTags:{img:(tagName,attribs)=>{if(!cover)cover=attribs.src||'';return {tagName,attribs}}}})
              options=b2bOptions({...body.b2b,image_url:body.b2b?.image_url?.trim()||cover},media.type)
            }
            items.push({channel,providerChannel:channel,...(options?{b2b:options}:{}),articleId:id,title,...prepared,resourceId:media.resource_id,mediaTitle:media.title,basePriceCents:media.basePriceCents,priceCents:media.priceCents,sourceTask:article.batchId||article.taskName||'history'})
          }
        }
        if(items.length>200)fail(400,'一次最多分发200篇，请拆分发布任务')
        const orders=store.quote(owner,body.brand,items,body.requestId)
        json(res,200,{ok:true,orders,totalCents:orders.reduce((sum,o)=>sum+o.priceCents,0),funding:store.funding(owner,orders.map(o=>o.id))});return true
      }
      if(url.pathname==='/api/news/check'){json(res,200,{ok:true,funding:store.funding(owner,body.ids)});return true}
      if(url.pathname==='/api/news/schedule'){
        store.schedule(owner,body.ids,body.scheduledAt,{retryWithNewArticle:true,maxRetry:1})
        json(res,202,{ok:true,orders:store.list(owner)});return true
      }
      if(url.pathname==='/api/news/cancel'){store.cancel(owner,body.id);store.expireAllStale();json(res,200,{ok:true,orders:store.list(owner)});return true}
      if(url.pathname==='/api/news/delete'){store.delete(owner,body.id);store.expireAllStale();json(res,200,{ok:true,orders:store.list(owner)});return true}
      if(url.pathname==='/api/news/fail'){store.fail(owner,body.id,body.reason);store.expireAllStale();json(res,200,{ok:true,orders:store.list(owner)});return true}
      if(url.pathname==='/api/news/dispatch'||url.pathname==='/api/news/resume'){
        if(!Array.isArray(body.ids)||!body.ids.length)fail(400,'请选择订单')
        for(const id of body.ids){const o=store.get(owner,id);if(['quoted','scheduled','reserved'].includes(o.state))for(const asset of o.assets||[])newsImageBytes(asset)}
        if(url.pathname.endsWith('/resume')){
          for(const id of body.ids){
            const current=store.get(owner,id)
            if(current.state==='uncertain'&&!current.orderId)store.requeue(owner,id)
          }
          if(!Array.isArray(body.ids)||body.ids.some(id=>store.get(owner,id).state!=='reserved'))fail(409,'只能继续尚未发起或无平台订单号的待核实订单')
        }
        const rows=store.reserve(owner,body.ids)
        // Claim is durable before network I/O; interrupted claims are never resent.
        void submitReservedRows(owner,store,rows).catch(error=>console.error('News dispatch stopped:',error.message))
        store.expireAllStale();json(res,202,{ok:true,orders:store.list(owner)});return true
      }
      if(url.pathname==='/api/news/refresh'){
        if(!Array.isArray(body.ids)||body.ids.length>100)fail(400,'订单选择无效')
        for(const id of body.ids){const order=store.get(owner,id);if(!order.orderId)continue;const details=await client(order.providerChannel||'news').orderDetails(order.providerChannel||'news',[order.orderId]);for(const d of details)store.detail(owner,id,d)}
        store.expireAllStale();json(res,200,{ok:true,orders:store.list(owner)});return true
      }
      fail(404,'接口不存在')
    }
  }
}
