import {useEffect,useState} from 'react'
import {accountRequest} from './console-ui'
type Balance={available:number;used:number;held:number}
export type QuotaMember={id:string;username:string;displayName:string;resources:Record<string,Balance>}
export function MemberQuotaEditor({userId,onSaved}:{userId:string;onSaved:()=>Promise<unknown>}){
  const [member,setMember]=useState<QuotaMember|null>(null),[labels,setLabels]=useState<Record<string,string>>({})
  const [values,setValues]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const load=async()=>{
    const d=await accountRequest<{members:QuotaMember[];resources:Record<string,string>;canAdjust:boolean;actorId:string}>('/api/admin/members')
    if(!d.canAdjust||d.actorId===userId)throw Error('需要上级管理员调整此账户额度')
    const u=d.members.find(m=>m.id===userId);if(!u)throw Error('无权管理此账户')
    setMember(u);setLabels({...d.resources,money:'余额（元）'});setValues(Object.fromEntries(Object.entries(u.resources).map(([k,v])=>[k,k==='money'?(v.available/100).toFixed(2):String(v.available)])))
  }
  useEffect(()=>{setMember(null);void load().catch(e=>setError(e.message))},[userId])
  const save=async()=>{
    if(!member)return
    setBusy(true);setError('');setNotice('')
    try{
      const changes=Object.keys(labels).flatMap(resource=>{
        const raw=values[resource]||'',valid=resource==='money'?/^\d+(\.\d{1,2})?$/:/^\d+$/
        if(!valid.test(raw))throw Error(`${labels[resource]}请输入非负数${resource==='money'?'，最多两位小数':'整数'}`)
        const next=resource==='money'?Math.round(Number(raw)*100):Number(raw)
        if(!Number.isSafeInteger(next))throw Error('额度数值过大')
        const expectedAvailable=member.resources[resource].available,delta=next-expectedAvailable
        return delta?[{resource,delta,expectedAvailable}]:[]
      })
      if(!changes.length){setNotice('额度未变化');return}
      await accountRequest('/api/admin/members/adjust-many',{userId,changes,reason,requestId})
      await load();setRequestId(crypto.randomUUID());setReason('');setNotice('额度已保存');await onSaved()
    }catch(e){setError(e instanceof Error?e.message:'保存失败')}finally{setBusy(false)}
  }
  return <div>
    {member&&<><strong>{member.displayName} · {member.username}</strong><div className="member-quota-grid">{Object.entries(labels).map(([k,label])=><label key={k}>{label}<input aria-label={`可用${label}`} type="number" min="0" step={k==='money'?'0.01':'1'} disabled={busy} value={values[k]??''} onChange={e=>{setValues({...values,[k]:e.target.value});setRequestId(crypto.randomUUID());setNotice('')}}/><small>已用 {k==='money'?(member.resources[k].used/100).toFixed(2):member.resources[k].used} · 预占 {k==='money'?(member.resources[k].held/100).toFixed(2):member.resources[k].held}</small></label>)}</div><label>调整原因<textarea aria-label="额度调整原因" disabled={busy} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setRequestId(crypto.randomUUID())}}/></label></>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="pa-actions"><button disabled={busy} onClick={()=>void load().then(()=>{setError('');setRequestId(crypto.randomUUID())}).catch(e=>setError(e.message))}>刷新额度</button><button className="primary-button" disabled={busy||!member||!reason.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存额度'}</button></div>
  </div>
}
