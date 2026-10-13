import {identityKey,projectHeaders} from './project-scope'
export async function readSocialWeb(action:string,body:Record<string,unknown>={}) {
  const identity=identityKey()
  async function read(url:string,payload?:unknown,method?:string) {
    const response=await fetch(url,{method:method|| (payload?'POST':'GET'),body:payload?JSON.stringify(payload):undefined,credentials:'same-origin',headers:{...projectHeaders(),...(payload?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(30000)})
    const value=await response.json()
    if(identity!==identityKey())throw Error('项目已切换，请刷新页面')
    if(!response.ok)throw Error(value.error||'读取失败，请重新登录')
    return value
  }
  const brand=(await read('/api/state?key=geo.activeBrand')).value
  if(!brand||body.brand&&body.brand!==brand)throw Error('品牌已切换，请重新读取')
  if(action==='addAccount')return (await read('/api/social/accounts',{brand,platform:body.platform,name:body.name})).account
  if(action==='deleteAccount')return await read('/api/social/accounts',{brand,id:body.id},'DELETE')
  if(action==='deleteTask')return await read('/api/social/tasks',{brand,id:body.id},'DELETE')
  const serverTasks=async(includeCompleted=false)=>((await read('/api/social/tasks?brand='+encodeURIComponent(brand)+(includeCompleted?'&includeCompleted=1':''))).tasks||[]).map((task:any)=>({
    id:task.id,createdAt:task.createdAt,rows:(Array.isArray(task.rows)?task.rows:[]).map((row:any)=>({
      id:row.id,articleId:row.articleId,title:row.title,accountId:row.accountId,accountName:row.accountName,platform:row.platform,status:row.status||'pending',message:'后台任务已保存，需在客户端执行',
    })),
  }))
  const tasks=(await read('/api/state?key=geo.taskRows')).value
  const articleRows=(await read('/api/state?key=geo.articleRows')).value
  const onlineTasks=await serverTasks()
  const allOnlineTasks=await serverTasks(true)
  const used=new Set(allOnlineTasks.flatMap((task:any)=>task.rows.filter((row:any)=>row.status!=='cancelled').map((row:any)=>row.articleId)))
  const generated=(Array.isArray(articleRows)?articleRows:[]).filter(row=>(row.project||row.brand)===brand&&row.status==='已生成'&&typeof row.body==='string'&&row.body.trim())
  const batches=(Array.isArray(tasks)?tasks:[]).filter(row=>(row.project||row.brand)===brand).map((row,index)=>{
    const id=row.jobId||row.batchId||`legacy-${index}`
    const found=generated.filter(article=>row.batchId?article.batchId===row.batchId:article.taskName===row.name)
    const available=found.filter(article=>!used.has(article.id)).length
    return {id,name:row.name,jobId:row.jobId||'',batchId:row.batchId||'',planned:Number(row.limit)||0,completed:Math.max(Number(row.created)||0,found.length),available}
  }).filter(row=>row.available>0||row.completed<row.planned)
  if(action==='snapshot')return {identity,brand,batches,accounts:(await read('/api/social/accounts?brand='+encodeURIComponent(brand))).accounts,tasks:onlineTasks}
  if(action==='selection') {
    const ids=body.batchIds
    if(!Array.isArray(ids)||!ids.length||ids.length>50)throw Error('请选择1至50个批次')
    const articles=new Map()
    for(const id of ids) {
      const batch=batches.find(b=>b.id===id);if(!batch)throw Error('批次不属于当前品牌')
      const value=await read(batch.jobId?'/api/jobs/status?id='+encodeURIComponent(batch.jobId):'/api/state?key=geo.articleRows')
      const rows=batch.jobId?value.job?.articles:value.value
      for(const row of Array.isArray(rows)?rows:[])if((row.project||row.brand)===brand&&row.status==='已生成'&&row.body?.trim()&&(batch.jobId||(batch.batchId?row.batchId===batch.batchId:row.taskName===batch.name)))articles.set(row.id,{id:row.id,title:row.title,assigned:false})
    }
    if((await read('/api/state?key=geo.activeBrand')).value!==brand)throw Error('品牌已切换，请重新读取')
    return {articles:[...articles.values()].map(article=>({...article,assigned:used.has(article.id)}))}
  }
  if(action==='plan') {
    const articleIds=body.articleIds
    const targets=body.targets
    if(!Array.isArray(articleIds)||!articleIds.length)throw Error('请选择文章')
    if(!Array.isArray(targets)||!targets.length)throw Error('请选择发布账号')
    return (await read('/api/social/tasks',{brand,batchIds:body.batchIds,articleIds,targets})).task
  }
  throw Error('账号登录和发布任务需在客户端操作')
}
