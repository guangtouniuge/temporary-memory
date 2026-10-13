import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs'
import {join} from 'node:path'
const pending = new Map()
export async function lookupProvider(directory, input, lookup, now = Date.now()) {
  const file = join(directory, 'provider-lookups.json')
  const key = JSON.stringify(input)
  const flight = file + key
  if (pending.has(flight)) return pending.get(flight)
  let state = {day:'', count:0, cache:{}}
  try { state = JSON.parse(readFileSync(file,'utf8')) } catch (e) { if(e.code!=='ENOENT')throw e }
  const cached = state.cache[key]
  if(cached && now-cached.at < (cached.value.status==='ready'?86400000:60000))return cached.value
  const day = new Date(now).toISOString().slice(0,10)
  if(state.day!==day){state.day=day;state.count=0}
  if(state.count>=40)throw Object.assign(Error('本项目今日查询次数已达上限，请明天重试'),{status:429})
  const save=()=>{mkdirSync(directory,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file)}
  state.count++;save()
  const task=Promise.resolve().then(()=>lookup(input)).then(value=>{
    // Another company may have completed while this request was awaiting the search.
    state=JSON.parse(readFileSync(file,'utf8'))
    state.cache[key]={at:now,value};save();return value
  }).finally(()=>pending.delete(flight))
  pending.set(flight,task)
  return task
}
