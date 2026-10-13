import {PagedRows} from './PagedRows'
import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Minus, History } from 'lucide-react'
import { accountRequest, Modal } from './console-ui'
import './platform-admin.css'
import { MemberPackages } from './MemberPackages'
import { MemberOperations } from './MemberOperations'

type Balance = { available: number; used: number; held: number; managed: boolean }
type Member = { id: string; username: string; displayName: string; role: string; resources: Record<string, Balance> }
type Data = { members: Member[]; resources: Record<string,string>; actorId: string; canAdjust: boolean }
type Entry = { id: string; resource: string; delta: number; before_amount: number; after_amount: number; reason: string; created_at: string }
const value = (key: string, n: number) => key === 'money' ? (n / 100).toFixed(2) : String(n)
const resourceOrder = ['articles','money','publications','publishingAccounts','storageMB','keywords','projects','points']
export function MemberAccounts() {
  const [data,setData] = useState<Data | null>(null)
  const [query,setQuery] = useState('')
  const [target,setTarget] = useState<Member | null>(null)
  const [resource,setResource] = useState('articles')
  const [direction,setDirection] = useState(1)
  const [amount,setAmount] = useState('')
  const [reason,setReason] = useState('')
  const [requestId,setRequestId] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [history,setHistory] = useState<Member | null>(null)
  const [entries,setEntries] = useState<Entry[]>([])
  const [historyError,setHistoryError] = useState('')
  const load = async () => { const r=await accountRequest<Data>('/api/admin/members'); setData(r); return r }
  useEffect(()=>{ void load().catch(e=>setError(e.message)) },[])
  const open = (u: Member, sign: number) => { setTarget(u);setDirection(sign);setAmount('');setReason('');setError('');setRequestId(crypto.randomUUID()) }
  const updateDraft = () => setRequestId(crypto.randomUUID())
  const save = async () => {
    if (!target) return
    const number=Number(amount), units=resource==='money'?Math.round(number*100):number
    if (!Number.isFinite(number) || number<=0 || !Number.isSafeInteger(units) || (resource==='money' && !/^\d+(\.\d{1,2})?$/.test(amount))) {setError('请输入正确数量，金额最多两位小数');return}
    setBusy(true);setError('')
    try {
      await accountRequest('/api/admin/members/adjust',{userId:target.id,resource,delta:direction*units,reason,requestId,expectedAvailable:target.resources[resource].available})
      await load();setTarget(null)
    } catch(e) {setError(e instanceof Error?e.message:'调整失败')} finally {setBusy(false)}
  }
  const showHistory = async (u: Member) => {
    setHistory(u);setEntries([]);setHistoryError('')
    try { const r=await accountRequest<{entries:Entry[]}>('/api/admin/members/history',{userId:u.id});setEntries(r.entries) } catch(e) {setHistoryError(e instanceof Error?e.message:'读取失败')}
  }
  const labels: Record<string,string> = {...data?.resources,money:'余额（元）'}
  return <section className="platform-admin">
    <header className="pa-heading"><h2>会员额度与流水</h2>{data?.canAdjust && <MemberPackages members={data.members.filter(u=>u.id!==data.actorId)} onChange={load}/>}<button title="刷新额度" aria-label="刷新额度" onClick={()=>void load().catch(e=>setError(e.message))}><RefreshCw size={16}/></button></header>
    {data?.canAdjust && <div className="pa-actions"><MemberOperations onChange={load}/></div>}
    {error && !target && <p role="alert">{error}</p>}
    <div className="pa-filters"><input aria-label="搜索会员" placeholder="搜索会员名称或账号" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <div className="pa-scroll"><table><thead><tr><th>会员</th>{Object.keys(data?.resources || {}).map(k=><th key={k}>{labels[k]}</th>)}<th>操作</th></tr></thead><tbody><PagedRows table>{data?.members.filter(u=>`${u.displayName} ${u.username}`.includes(query)).map(u=><tr key={u.id}><td><strong>{u.displayName}</strong><small>{u.username}</small>{u.id===data.actorId && <small>我的资源</small>}</td>{Object.entries(u.resources).map(([k,b])=><td key={k}>{value(k,b.available)}<small>已用 {value(k,b.used)} · 预占 {value(k,b.held)}</small>{k==='articles' && <small>{b.managed?'按篇扣减已启用':'未配置，禁止生成'}</small>}</td>)}<td><div className="pa-actions">{data.canAdjust && u.id!==data.actorId && <><button title="增加额度" aria-label={`增加额度${u.username}`} onClick={()=>open(u,1)}><Plus size={16}/></button><button title="减少额度" aria-label={`减少额度${u.username}`} onClick={()=>open(u,-1)}><Minus size={16}/></button></>}<button title="额度流水" aria-label={`额度流水${u.username}`} onClick={()=>void showHistory(u)}><History size={16}/></button></div></td></tr>)}</PagedRows></tbody></table></div>
    {!data?.members.length && <p className="pa-empty">暂无会员账户</p>}
    {target && <Modal title={direction>0?'增加会员额度':'减少会员额度'} onClose={()=>{if(!busy)setTarget(null)}} actions={<><button disabled={busy} onClick={()=>setTarget(null)}>取消</button><button className="primary-button" disabled={busy||!amount||!reason.trim()} onClick={()=>void save()}>确认调整</button></>}><div className="pa-dialog pa-form"><strong>{target.displayName} · {target.username}</strong><label>资源类型<select disabled={busy} value={resource} onChange={e=>{setResource(e.target.value);updateDraft()}}>{Object.keys(data?.resources || {}).map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label><p>当前可用：{value(resource,target.resources[resource].available)}</p><label>调整数量<input disabled={busy} type="number" min={resource==='money'?'0.01':'1'} step={resource==='money'?'0.01':'1'} value={amount} onChange={e=>{setAmount(e.target.value);updateDraft()}}/></label><label>调整原因<textarea disabled={busy} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);updateDraft()}}/></label>{data?.members.some(u=>u.id===data.actorId && u.role==='agent') && <p>{direction>0?'从我的可用资源中转出给客户。':'从客户可用资源退回我的账户。'}</p>}{error && <p role="alert">{error}<button disabled={busy} onClick={()=>void load().then(r=>{const u=r.members.find(u=>u.id===target.id);if(u)setTarget(u);setRequestId(crypto.randomUUID());setError('')}).catch(e=>setError(e.message))}>刷新额度</button></p>}</div></Modal>}
    {history && <Modal title={`${history.displayName}的额度流水`} onClose={()=>setHistory(null)} actions={<button onClick={()=>setHistory(null)}>关闭</button>}><div className="pa-dialog pa-scroll">{historyError && <p role="alert">{historyError}</p>}<table><thead><tr><th>时间</th><th>资源</th><th>变动</th><th>调整前</th><th>调整后</th><th>原因</th></tr></thead><tbody><PagedRows table>{entries.map(e=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td>{labels[e.resource]}</td><td>{e.delta>0?'+':''}{value(e.resource,e.delta)}</td><td>{value(e.resource,e.before_amount)}</td><td>{value(e.resource,e.after_amount)}</td><td>{e.reason}</td></tr>)}</PagedRows></tbody></table>{!entries.length && !historyError && <p>暂无流水</p>}</div></Modal>}
  </section>
}

export function MyQuota() {
  const [data,setData] = useState<Data | null>(null)
  const [history,setHistory] = useState(false)
  const [entries,setEntries] = useState<Entry[]>([])
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const load = async () => { const r=await accountRequest<Data>('/api/admin/members'); setData(r); return r }
  useEffect(()=>{ void load().catch(e=>setError(e.message)) },[])
  const labels: Record<string,string> = {...data?.resources,money:'余额（元）'}
  const member = data?.members.find(u=>u.id===data.actorId) || data?.members.find(u=>u.role==='project_admin') || data?.members[0]
  const ordered = Object.entries(member?.resources || {}).sort(([a],[b])=>{
    const ai=resourceOrder.indexOf(a), bi=resourceOrder.indexOf(b)
    return (ai===-1?99:ai)-(bi===-1?99:bi)
  })
  const showHistory = async () => {
    if(!member)return
    setBusy(true);setError('')
    try {
      const r=await accountRequest<{entries:Entry[]}>('/api/admin/members/history',{userId:member.id})
      setEntries(r.entries);setHistory(true)
    } catch(e) {setError(e instanceof Error?e.message:'读取流水失败')} finally {setBusy(false)}
  }
  return <section className="platform-admin my-quota-page">
    <header className="pa-heading"><div><h2>我的额度</h2><p>这里只展示当前项目可用资源，额度调整请联系上级管理员。</p></div><div className="pa-actions"><button disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}><RefreshCw size={16}/>刷新额度</button><button disabled={!member||busy} onClick={()=>void showHistory()}><History size={16}/>额度流水</button></div></header>
    {error && <p role="alert">{error}</p>}
    {member ? <><div className="my-quota-owner"><strong>{member.displayName}</strong><span>{member.username}</span>{member.id!==data?.actorId && <small>项目额度由主账号统一管理</small>}</div>
      <div className="my-quota-grid">{ordered.map(([key,balance])=><article key={key} className="my-quota-card"><span>{labels[key]||key}</span><strong>{value(key,balance.available)}</strong><div><small>已用 {value(key,balance.used)}</small><small>预占 {value(key,balance.held)}</small></div>{key==='articles'&&!balance.managed&&<em>未配置，暂不能生成文章</em>}</article>)}</div></> : <p className="pa-empty">当前账号暂未配置额度，请联系管理员。</p>}
    {history && <Modal title="我的额度流水" onClose={()=>setHistory(false)} actions={<button onClick={()=>setHistory(false)}>关闭</button>}><div className="pa-dialog pa-scroll"><table><thead><tr><th>时间</th><th>资源</th><th>变动</th><th>调整前</th><th>调整后</th><th>原因</th></tr></thead><tbody><PagedRows table>{entries.map(e=><tr key={e.id}><td>{new Date(e.created_at).toLocaleString()}</td><td>{labels[e.resource]||e.resource}</td><td>{e.delta>0?'+':''}{value(e.resource,e.delta)}</td><td>{value(e.resource,e.before_amount)}</td><td>{value(e.resource,e.after_amount)}</td><td>{e.reason}</td></tr>)}</PagedRows></tbody></table>{!entries.length && <p>暂无流水</p>}</div></Modal>}
  </section>
}
