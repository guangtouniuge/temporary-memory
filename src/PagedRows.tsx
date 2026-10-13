import {Children, useEffect, useState, type ReactNode} from 'react'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import './pagination.css'

export function PagedRows({children,table=false,resetKey=''}:{children:ReactNode;table?:boolean;resetKey?:string}) {
  const rows=Children.toArray(children),[page,setPage]=useState(1)
  const identity=rows.map(row=>typeof row==='object'&&row!==null&&'key' in row?row.key:'').join('|')
  useEffect(()=>setPage(1),[resetKey,identity])
  const total=Math.max(1,Math.ceil(rows.length/20)),current=Math.min(page,total)
  const controls=rows.length>20?<nav className="list-pagination" aria-label="列表分页">
    <span>共{rows.length}条 · 每页20条</span>
    <button aria-label="上一页" title="上一页" disabled={current===1} onClick={()=>setPage(current-1)}><ChevronLeft size={17}/></button>
    <label>第<select aria-label="页码" value={current} onChange={e=>setPage(Number(e.target.value))}>{Array.from({length:total},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select> / {total}页</label>
    <button aria-label="下一页" title="下一页" disabled={current===total} onClick={()=>setPage(current+1)}><ChevronRight size={17}/></button>
  </nav>:null
  return <>{rows.slice((current-1)*20,current*20)}{controls&&(table?<tr className="pagination-row"><td colSpan={30}>{controls}</td></tr>:controls)}</>
}
