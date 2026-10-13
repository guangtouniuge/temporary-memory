import { createHash } from 'node:crypto'

export function imageSource(value) {
  if(value===undefined)return 'imported'
  if(!['ai','imported'].includes(value))throw Object.assign(new Error('请选择有效的图片来源'),{status:400})
  return value
}

const safeCode=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(value)?value:undefined

export function sceneImagePrompt({project,scene,index}) {
  const context={industry:String(project.industry||'').slice(0,160),scene:String(scene||'').slice(0,200)}
  return `制作一张横向AI场景示意配图。画面行业和应用场景：${JSON.stringify(context)}。根据该行业选择合理的办公、门店或工作现场环境。画面侧重${index===0?'工作人员在日常业务环境中交流、观察或整理资料的宽景':'工作人员协作处理业务、查看资料或操作该行业常用工具的近景'}。使用虚构人物和通用场所，画面清晰自然，以人物动作、工具和环境构成画面。`
}

export async function generateSceneImage(prompt,{fetchImpl=fetch,apiKey=process.env.ARK_API_KEY,model=process.env.ARK_IMAGE_MODEL,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  if(!apiKey||!model)throw Object.assign(new Error('火山引擎生图尚未配置，请联系管理员'),{confirmedFailure:true})
  let response
  for(let attempt=1;attempt<=3;attempt++){
  try {
    response=await fetchImpl('https://ark.cn-beijing.volces.com/api/v3/images/generations',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,prompt,size:'2K',response_format:'b64_json',sequential_image_generation:'disabled',stream:false,watermark:true}),
      signal:AbortSignal.timeout(180000),redirect:'error',
    })
  }catch{throw new Error('火山引擎请求结果待确认，已暂停自动重发，避免重复费用')}
  if(!response.ok){
    const code=response.status
    const detail=await response.json().catch(()=>({}))
    const providerCode=safeCode(detail.error?.code),requestId=safeCode(response.headers.get('x-request-id')||detail.request_id)
    if(providerCode==='AccountOverdueError')throw Object.assign(new Error(`火山引擎账户欠费，AI配图暂停；正文进度已保留。请管理员处理火山账户余额后续跑，不是系统会员额度不足（HTTP ${code}，${providerCode}${requestId?`，请求 ${requestId}`:''}）`),{confirmedFailure:true,providerCode,requestId,httpStatus:code})
    const sensitive=/SensitiveContent|ContentFilter|ContentPolicy/i.test(providerCode||'')
    const message=sensitive?'火山引擎内容检查未通过，请检查图片主题或改用自有图片；正文已保留':providerCode==='ModelNotOpen'?'火山账号尚未开通当前Seedream生图模型，请管理员在火山方舟开通':code===401||code===403?'火山引擎密钥或模型权限不可用':code===402?'火山引擎余额不足':code===429?'火山引擎请求受限，请稍后重试':code===400?'火山引擎未接受生图请求，请检查图片参数':'火山引擎生图服务异常，结果待确认，请勿重复提交'
    if(code===429&&!sensitive&&attempt<3){await wait(1200*attempt);continue}
    throw Object.assign(new Error(`${message}（HTTP ${code}${providerCode?`，${providerCode}`:''}${requestId?`，请求 ${requestId}`:''}）`),{confirmedFailure:code>=400&&code<500,providerCode,requestId,httpStatus:code})
  }
  break
  }
  const reader=response.body.getReader(),chunks=[];let size=0
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>28*1024*1024){await reader.cancel();throw new Error('生图响应超出限制，结果待确认')}chunks.push(value)}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(result.data?.[0]?.error)throw Object.assign(new Error('图片未通过生成服务检查，请调整场景后重试'),{confirmedFailure:true})
  const base64=result.data?.[0]?.b64_json
  if(typeof base64!=='string'||!/^[A-Za-z0-9+/=\r\n]+$/.test(base64))throw new Error('未收到完整图片，结果待确认，未自动重发')
  const data=Buffer.from(base64,'base64')
  const ext=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':data[0]===255&&data[1]===216?'jpg':null
  if(!ext||data.length>20*1024*1024)throw new Error('生图文件格式异常，未自动重发')
  return {data,ext}
}

export async function articleSceneImages({project,title,body,scene,articleId,state,saveState,findSaved,saveImage,log=()=>{},generate=generateSceneImage,billing}) {
  const reservation=billing ? await billing.reserve() : null
  try {
  state.imageSlots ||= {}
  const images=[]
  for(let index=0;index<2;index++){
    const key=createHash('sha256').update(JSON.stringify({articleId,project:project.name,title,body,index})).digest('hex')
    const saved=await findSaved(key)
    if(saved){images.push(saved);continue}
    const old=state.imageSlots[key]
    if(old&&['sending','uncertain','complete'].includes(old.status))throw new Error(`第${index+1}张图片结果待确认，请联系管理员核对；正文已保留`)
    const prompt=sceneImagePrompt({project,scene,index})
    state.imageSlots[key]={status:'sending',index,prompt};await saveState()
    log(`正在生成场景图片 ${index+1}/2`)
    try{
      const file=await generate(prompt)
      const stored=await saveImage(key,file,index)
      state.imageSlots[key]={status:'complete',index,path:stored.path};await saveState()
      images.push(stored)
    }catch(error){state.imageSlots[key]={status:error.confirmedFailure?'failed':'uncertain',index,error:error.message,providerCode:error.providerCode,requestId:error.requestId,httpStatus:error.httpStatus};await saveState();throw error}
  }
  if(billing)await billing.settle(reservation,true)
  return images
  } catch(error) {
    if(billing)await billing.settle(reservation,false)
    throw error
  }
}
