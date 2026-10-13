import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createXiaoqingwaClient} from './xiaoqingwa-client.mjs'
import {createMeiticaigouClient} from './meiticaigou-client.mjs'
import {b2bPlatform,mediaDetails} from './media-classification.mjs'
import {b2bCatalog} from './b2b-catalog.mjs'
export function createMediaCatalog({directory=resolve('outputs/media-catalog'),client,identity}={}){
  const config=c=>c==='news2'?{provider:'meiticaigou',baseUrl:process.env.MEITICAIGOU_BASE_URL,key:process.env.MEITICAIGOU_APP_KEY}:{provider:'xiaoqingwa',baseUrl:process.env.XIAOQINGWA_BASE_URL,key:process.env.XIAOQINGWA_KEY}
  const fingerprint=c=>identity||createHash('sha256').update(JSON.stringify(config(c))).digest('hex')
  const cache=new Map(),running=new Map(),progress=new Map()
  const file=c=>resolve(directory,`${fingerprint(c)}-${c}.json`)
  const read=c=>{
    const key=file(c);if(cache.has(key))return cache.get(key)
    try{const d=JSON.parse(readFileSync(key,'utf8'));if(d.complete&&Array.isArray(d.resources)&&(c!=='social'||d.fieldSchema==='wemedia-v1')&&(c!=='news2'||d.fieldSchema==='meiticaigou-news-v2')){cache.set(key,d);return d}}catch{}
    return null
  }
  const sync=c=>{
    if(!['news','social','news2'].includes(c))throw new Error('不支持的媒体渠道')
    const target=file(c);if(running.has(target))return running.get(target)
    const api=client||(c==='news2'?createMeiticaigouClient(config(c)):createXiaoqingwaClient(config(c)))
    const job=(async()=>{
      progress.set(target,{syncing:true,pages:0,count:0,error:''})
      try{
        const fields=await api.fields(c),rows=new Map()
        const models=typeof api.resourceModels==='function'?api.resourceModels(c):[null]
        let pages=0
        for(const modelId of models){
          const pageSize=c==='news2'?1000:100
          for(let page=1;page<=10000;page++){
            const batch=await api.resources(c,page,pageSize,modelId?{modelId}:undefined)
            pages++
            const before=rows.size
            for(const r of batch)rows.set(r.resource_id,r)
            progress.set(target,{syncing:true,pages,count:rows.size,error:''})
            if(batch.length<pageSize)break
            if(rows.size===before)throw new Error('供应商重复返回相同页，已保留原媒体库')
          }
        }
        const snapshot={complete:true,fieldSchema:c==='social'?'wemedia-v1':c==='news2'?'meiticaigou-news-v2':'website-v1',updatedAt:new Date().toISOString(),resources:[...rows.values()],fields}
        const temporary=target+`.${process.pid}.${Date.now()}.tmp`
        mkdirSync(directory,{recursive:true});writeFileSync(temporary,JSON.stringify(snapshot),{flush:true});renameSync(temporary,target);cache.set(target,snapshot)
        progress.set(target,{syncing:false,pages,count:rows.size,error:''});return snapshot
      }catch(e){progress.set(target,{...progress.get(target),syncing:false,error:e.message});throw e}
      finally{running.delete(target)}
    })()
    running.set(target,job);return job
  }
  return {sync,query(c,params,options={}){
    const priceFor = typeof options.priceFor === 'function' ? options.priceFor : resource => resource
    if(c==='b2b')return b2bCatalog(params,{priceFor})
    if(!['news','social','b2b','news2'].includes(c))throw Object.assign(new Error('不支持的媒体渠道'),{status:400})
    const channel=c;c=c==='b2b'?'news':c
    const data=read(c),state=progress.get(file(c))||{syncing:false,pages:0,count:0,error:''}
    const refresh=params.get('refresh')==='1'
    if((!data||refresh)&&!state.syncing&&(!state.error||refresh))void sync(c).catch(()=>{})
    const pageSize=Number(params.get('pageSize')||20),wanted=Number(params.get('page')||1)
    if(![20,50,100].includes(pageSize)||!Number.isSafeInteger(wanted)||wanted<1)throw Object.assign(new Error('页码无效'),{status:400})
    const q=(params.get('q')||'').trim().toLowerCase(),region=params.get('region'),industry=params.get('industry'),kind=params.get('kind'),min=params.get('minPrice'),max=params.get('maxPrice'),sort=params.get('sort')
    const platform=params.get('platform'),verification=params.get('verification'),mediaIdentity=params.get('mediaIdentity'),feature=params.get('feature'),mediaType=params.get('mediaType')
    const portal=params.get('portal'),pageLevel=params.get('pageLevel'),indexEffect=params.get('indexEffect'),linkType=params.get('linkType'),publishSpeed=params.get('publishSpeed'),weight=params.get('weight'),fans=params.get('fans'),reads=params.get('reads'),accountType=params.get('accountType')
    const source=(data?.resources||[]).filter(r=>channel!=='b2b'||b2bPlatform(r)).map(r=>priceFor(r,channel))
    const matches=(r,type,id)=>!id||String(r.fields?.[type]||'').split(',').includes(id)
    const industryField=c==='news2'?'field_2':c==='social'?'field_2':'field_1'
    const passes=(r,omit='')=>(!q||r.title.toLowerCase().includes(q))&&(omit==='field_3'||matches(r,'field_3',region))&&(omit===industryField||matches(r,industryField,industry))&&(omit==='field_0'||!mediaType||matches(r,'field_0',mediaType))&&(!kind||kind!=='local'||(r.fields.field_3&&r.fields.field_3!=='3001'))&&(!min||r.priceCents>=Number(min)*100)&&(!max||r.priceCents<=Number(max)*100)&&(omit==='field_1'||matches(r,'field_1',platform))&&(omit==='field_2'||matches(r,'field_2',portal))&&(omit==='field_4'||((!pageLevel||matches(r,'field_4',pageLevel))&&(!fans||matches(r,'field_4',fans))))&&(omit==='field_5'||((!indexEffect||matches(r,'field_5',indexEffect))&&(!reads||matches(r,'field_5',reads))))&&(omit==='field_6'||((!verification||matches(r,'field_6',verification))&&(!linkType||matches(r,'field_6',linkType))))&&(omit==='field_7'||((!mediaIdentity||matches(r,'field_7',mediaIdentity))&&(!publishSpeed||matches(r,'field_7',publishSpeed))&&(!accountType||matches(r,'field_7',accountType))))&&(omit==='field_8'||(c!=='social'||matches(r,'field_8',feature)))&&(omit==='field_9'||(c!=='news'||matches(r,'field_9',feature)))&&(omit==='field_11'||matches(r,'field_11',weight))
    let rows=source.filter(r=>passes(r))
    if(sort==='low'||sort==='high')rows=[...rows].sort((a,b)=>(sort==='low'?1:-1)*(a.priceCents-b.priceCents)||a.resource_id.localeCompare(b.resource_id))
    const total=rows.length,totalPages=Math.ceil(total/pageSize),page=Math.min(wanted,Math.max(1,totalPages))
    const counts=new Map();for(const r of source)for(const [type,ids] of Object.entries(r.fields))for(const id of String(ids||'').split(',').filter(Boolean))counts.set(type+':'+id,(counts.get(type+':'+id)||0)+1)
    return {resources:rows.slice((page-1)*pageSize,page*pageSize).map(r=>({...r,details:mediaDetails(r,c,data?.fields||[])})),total,totalPages,page,pageSize,catalogTotal:source.length,complete:!!data,updatedAt:data?.updatedAt||null,sync:progress.get(file(c))||state,fields:(data?.fields||[]).map(f=>({...f,count:counts.get(f.type+':'+f.id)||0}))}
  }}
}
