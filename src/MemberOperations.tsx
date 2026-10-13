import {PagedRows} from './PagedRows'
import {useState} from 'react'
import {BookOpen, Calculator, Pencil} from 'lucide-react'
import {accountRequest,Modal} from './console-ui'

type Usage={id:string;name:string;resources:{key:string;actual:number;recorded:number;allocated:number;overage:number}[]}
type Settlement={revision:number;receivedCents:number;refundedCents:number;costCents:number|null;reason?:string}
type Order={id:string;customer:string;saleCents:number;snapshot:{name:string;priceCents:number};createdAt:string;settlement:Settlement}
const money=(n:number)=>(n/100).toFixed(2)
const labels:Record<string,string>={projects:'项目',keywords:'关键词',storageMB:'空间（MB）'}
export function MemberOperations({onChange}:{onChange:()=>Promise<unknown>}) {
  const [view,setView]=useState<'usage'|'commerce'|null>(null),[rows,setRows]=useState<Usage[]>([]),[orders,setOrders]=useState<Order[]>([])
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<Order|null>(null)
  const [received,setReceived]=useState(''),[refund,setRefund]=useState(''),[cost,setCost]=useState(''),[reason,setReason]=useState('')
  const [history,setHistory]=useState<{actor:string;data:{revision:number;after:Settlement};created_at:string}[]|null>(null)
  const load=async(v:'usage'|'commerce')=>{
    if(v==='usage')setRows((await accountRequest<{rows:Usage[]}>('/api/admin/members/reconcile')).rows)
    else setOrders((await accountRequest<{orders:Order[]}>('/api/admin/members/commerce')).orders)
  }
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}}
  const cents=(v:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(v))throw Error('金额最多两位小数');return Math.round(Number(v)*100)}
  return <>
    <button onClick={()=>{setView('usage');void run(()=>load('usage'))}}><Calculator size={16}/>存量对账</button>
    <button onClick={()=>{setView('commerce');void run(()=>load('commerce'))}}><BookOpen size={16}/>经营账目</button>
    {view && <Modal wide title={view==='usage'?'存量资源对账':'套餐经营账目'} onClose={()=>{if(!busy)setView(null)}} actions={<button disabled={busy} onClick={()=>setView(null)}>关闭</button>}><div className="pa-dialog pa-scroll">
      {error && <p role="alert">{error}</p>}
      {view==='usage'?<table><thead><tr><th>会员</th><th>资源</th><th>已配置</th><th>账本占用</th><th>实际占用</th><th>超额</th><th>操作</th></tr></thead><tbody><PagedRows table>{rows.flatMap(row=>row.resources.map((r,i)=><tr key={`${row.id}-${r.key}`}><td>{row.name}</td><td>{labels[r.key]}</td><td>{r.allocated}</td><td>{r.recorded}</td><td>{r.actual}</td><td>{r.overage}</td><td>{i===0&&<button disabled={busy} onClick={()=>void run(async()=>{await accountRequest('/api/admin/members/reconcile',{userId:row.id});await load('usage');await onChange()})}>更新占用</button>}</td></tr>))}</PagedRows></tbody></table>:<table><thead><tr><th>会员／套餐</th><th>供货参考价</th><th>销售登记</th><th>实收登记</th><th>退款登记</th><th>实际成本</th><th>已登记毛利</th><th>操作</th></tr></thead><tbody><PagedRows table>{orders.map(o=><tr key={o.id}><td>{o.customer}<small>{o.snapshot.name}</small><small>{new Date(o.createdAt).toLocaleString()}</small></td><td>{money(o.snapshot.priceCents)}</td><td>{money(o.saleCents)}</td><td>{money(o.settlement.receivedCents)}</td><td>{money(o.settlement.refundedCents)}</td><td>{o.settlement.costCents===null?'未登记':money(o.settlement.costCents)}</td><td>{o.settlement.costCents===null?'待核算':money(o.settlement.receivedCents-o.settlement.refundedCents-o.settlement.costCents)}</td><td><button title="修改收支登记" aria-label={`修改收支${o.customer}`} onClick={()=>{setEditing(o);setReceived(money(o.settlement.receivedCents));setRefund(money(o.settlement.refundedCents));setCost(o.settlement.costCents===null?'':money(o.settlement.costCents));setReason('');setError('')}}><Pencil size={16}/></button><button onClick={()=>void run(async()=>setHistory((await accountRequest<{entries:NonNullable<typeof history>}>('/api/admin/members/commerce/history',{id:o.id})).entries))}>修改记录</button></td></tr>)}</PagedRows></tbody></table>}
      {!busy&&(view==='usage'?!rows.length:!orders.length)&&<p>暂无记录</p>}
    </div></Modal>}
    {editing&&<Modal title="收支登记（元）" onClose={()=>{if(!busy)setEditing(null)}} actions={<><button disabled={busy} onClick={()=>setEditing(null)}>取消</button><button disabled={busy||!reason.trim()} onClick={()=>void run(async()=>{await accountRequest('/api/admin/members/commerce/save',{id:editing.id,revision:editing.settlement.revision,receivedCents:cents(received),refundedCents:cents(refund),costCents:cost===''?null:cents(cost),reason});await load('commerce');setEditing(null)})}>保存登记</button></>}><div className="pa-dialog pa-form"><strong>{editing.customer} · {editing.snapshot.name}</strong><label>累计实收<input value={received} onChange={e=>setReceived(e.target.value)} inputMode="decimal"/></label><label>累计退款<input value={refund} onChange={e=>setRefund(e.target.value)} inputMode="decimal"/></label><label>实际成本<input value={cost} onChange={e=>setCost(e.target.value)} inputMode="decimal" placeholder="未核实时留空"/></label><label>记账依据<textarea maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}</div></Modal>}
    {history&&<Modal title="收支修改记录" onClose={()=>setHistory(null)} actions={<button onClick={()=>setHistory(null)}>关闭</button>}><div className="pa-dialog pa-scroll"><table><thead><tr><th>时间</th><th>版本</th><th>实收</th><th>退款</th><th>成本</th><th>依据</th></tr></thead><tbody><PagedRows table>{history.map(h=><tr key={h.data.revision}><td>{new Date(h.created_at).toLocaleString()}</td><td>{h.data.revision}</td><td>{money(h.data.after.receivedCents)}</td><td>{money(h.data.after.refundedCents)}</td><td>{h.data.after.costCents===null?'未登记':money(h.data.after.costCents)}</td><td>{h.data.after.reason}</td></tr>)}</PagedRows></tbody></table>{!history.length&&<p>暂无修改</p>}</div></Modal>}
  </>
}
