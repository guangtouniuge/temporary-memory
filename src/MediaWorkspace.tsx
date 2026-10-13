import {PagedRows} from './PagedRows'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Eye, Save, RefreshCw, Video, Trash2, Star, RotateCcw } from 'lucide-react'
import { articleHtml } from './article-format'
import { Modal, EmptyState } from './console-ui'
import './media-workspace.css'

export type MediaChannel = 'social' | 'news' | 'news2' | 'b2b' | 'video'
type Article = { id: string; title: string; body?: string; project?: string; status: string; words: string; batchId?: string; taskName?: string; batchLabel?: string }
type Resource = { resource_id: string | number; title: string; price: string; remarks?: string; case_link?: string; details?: {type?:string;platform?:string;category?:string;industry?:string;region?:string;verification?:string;mediaIdentity?:string;features?:string;subject?:string;publishSpeed?:string;deadline?:string;indexing?:string;linkType?:string;contact?:string;weekendActive?:string;linkPeriod?:string;weight?:string;portal?:string;aiInclude?:string;fans?:string;reads?:string;likes?:string;imageFee?:string;translation?:string;country?:string;language?:string;accountType?:string;pageLevel?:string;specialIndustry?:string;mediaType?:string} }
type Catalog = {total:number;totalPages:number;catalogTotal:number;complete:boolean;page:number;updatedAt?:string|null;areas?:{id:string;name:string}[];fields:{id:string;type:string;title:string;count:number}[];sync?:{syncing:boolean;count:number;error?:string}}
type Draft = { id: string; brand: string; channel: string; status: string; createdAt: string; articles: { id: string; title: string; body: string }[]; resources: Resource[]; allocations?: { resourceId: string | number; articleIds: string[] }[]; orders?: { articleId: string; status: string; url?: string }[] }
type Request = <T>(path: string, body?: unknown) => Promise<T>
type Funding={availableCents:number;availablePublications:number;requiredCents:number;requiredPublications:number;reason:string}
type NewsOrder={id:string;channel?:string;providerChannel?:string;providerStatus?:number;providerMessage?:string;articleId:string;title:string;content:string;resourceId?:string|number;mediaTitle:string;priceCents:number;state:string;brand:string;url?:string;orderId?:string;rejection?:string;sourceTask?:string;createdAt?:string;checkedAt?:string;scheduledAt?:string;startedAt?:string;acceptedAt?:string;publishBatchId?:string}
type FavoriteResource={folder:string;channel:MediaChannel;resource:Resource;savedAt:string}
type PublishTask={id:string;title:string;rows:NewsOrder[];state:'scheduled'|'executing'|'completed';createdAt?:string;scheduledAt?:string;articleCount:number;mediaCount:number;totalCents:number;success:number;failed:number;executing:number;scheduled:number;cancelable:boolean}
const orderState:Record<string,string>={quoted:'待确认',scheduled:'已预约',reserved:'待分发',sending:'已提交',uncertain:'结果待核实',submitted:'已提交',linked:'已发稿',refunded:'已退款',cancelled:'已取消'}
const waitingStates=new Set(['reserved','sending'])
const refreshableStates=new Set(['reserved','sending','uncertain','submitted'])
const nonRepeatArticleStates=new Set(['scheduled','reserved','sending','uncertain','submitted','linked'])
const cancellableStates=new Set(['quoted','scheduled','reserved'])
const executingStates=new Set(['reserved','sending','uncertain','submitted'])
const recordStates=new Set(['linked','refunded','cancelled'])
const defaultFavoriteFolder='默认收藏夹'
const brandNamesFromArticles=(articles:Article[],fallback:string)=>[...new Set([fallback,...articles.map(a=>a.project||'')].filter(Boolean))]
function stateLabel(o:NewsOrder){
  if(o.state!=='submitted'||o.providerStatus===undefined)return orderState[o.state]||o.state
  const states:Record<number,string>=o.providerChannel==='news2'?{1001:'已安排',1002:'已发稿',1004:'已退稿',1005:'退单申请',1006:'改稿中',1011:'已提交'}:o.providerChannel==='b2b'?{0:'发布中',1:'已发稿',2:'退款待核实',3:'售后中',4:'已安排'}:{0:'已提交',1:'已安排',2:'已发稿',4:'已退稿，待退款',9:'售后中'}
  return states[o.providerStatus]||'平台状态待核实'
}
export function MediaWorkspace({ channel:inputChannel, articles:initialArticles, brand:initialBrand, initialIds, request, queueOnly=false, initialView, headingTitle, contentReady=true }: {
  channel: MediaChannel; articles: Article[]; brand: string; initialIds: string[]; request: Request; queueOnly?: boolean; initialView?: string; headingTitle?: string; contentReady?: boolean
}) {
  const channel=inputChannel
  const [resourceChannel,setResourceChannel]=useState<MediaChannel>(inputChannel)
  const activeChannel=inputChannel==='news'?resourceChannel:inputChannel
  const channelOrders=(orders:NewsOrder[])=>queueOnly?orders.filter(o=>['news','news2','social','b2b'].includes(o.channel||'news')):orders.filter(o=>inputChannel==='news'?['news','social','b2b'].includes(o.channel||'news'):(o.channel||'news')===inputChannel)
  const [articles,setArticles]=useState(initialArticles)
  const [brand,setBrand]=useState(initialBrand)
  const [brands,setBrands]=useState<string[]>(()=>brandNamesFromArticles(initialArticles,initialBrand))
  const [contentLoading,setContentLoading]=useState(false)
  const [newsOrders,setNewsOrders]=useState<NewsOrder[]>([])
  const [quote,setQuote]=useState<NewsOrder[]>([])
  const [funding,setFunding]=useState<Funding|null>(null)
  const [b2b,setB2b]=useState({author:'',phone:'',from:'',image_url:'',area:''})
  const [browserUrl,setBrowserUrl]=useState('')
  const [view, setView] = useState(initialView||'compose')
  const resourceRequest = useRef(0)
  const [stage, setStage] = useState<'tasks' | 'media'>('tasks')
  const [expanded, setExpanded] = useState<string[]>([])
  const [mediaQuery, setMediaQuery] = useState('')
  const [priceMin, setPriceMin] = useState('')
  const [priceLimit, setPriceLimit] = useState('')
  const [sort, setSort] = useState('default')
  const [ids, setIds] = useState(initialIds)
  const [publishLimit, setPublishLimit] = useState('')
  const [query, setQuery] = useState('')
  const [resources, setResources] = useState<Resource[]>([])
  const [chosen, setChosen] = useState<Resource[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [allocationPreview, setAllocationPreview] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const pageSize=20
  const [jump,setJump]=useState('1')
  const [region,setRegion]=useState('')
  const [industry,setIndustry]=useState('')
  const [kind,setKind]=useState('')
  const [mediaType,setMediaType]=useState('')
  const [platform,setPlatform]=useState('')
  const [portal,setPortal]=useState('')
  const [pageLevel,setPageLevel]=useState('')
  const [indexEffect,setIndexEffect]=useState('')
  const [linkType,setLinkType]=useState('')
  const [publishSpeed,setPublishSpeed]=useState('')
  const [weight,setWeight]=useState('')
  const [fans,setFans]=useState('')
  const [reads,setReads]=useState('')
  const [accountType,setAccountType]=useState('')
  const [verification,setVerification]=useState('')
  const [mediaIdentity,setMediaIdentity]=useState('')
  const [feature,setFeature]=useState('')
  const [catalog,setCatalog]=useState<Catalog|null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [recordsLoaded, setRecordsLoaded] = useState(false)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [preview, setPreview] = useState<Article | null>(null)
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({})
  const [confirmation, setConfirmation] = useState(false)
  const [quoting,setQuoting]=useState(false)
  const [publishMode,setPublishMode]=useState<'now'|'scheduled'>('now')
  const [scheduledDate,setScheduledDate]=useState(()=>new Date(Date.now()+60*60*1000).toISOString().slice(0,10))
  const [scheduledTime,setScheduledTime]=useState(()=>new Date(Date.now()+60*60*1000).toTimeString().slice(0,5))
  const [taskPage,setTaskPage]=useState(1)
  const [taskDetail,setTaskDetail]=useState<PublishTask|null>(null)
  const [favorites,setFavorites]=useState<FavoriteResource[]>([])
  const [favoriteFolder,setFavoriteFolder]=useState('')
  const [newFolder,setNewFolder]=useState('')
  const reloadContent=async()=>{
    setContentLoading(true)
    try {const r=await request<{articles:Article[];brands:string[]}>(`/api/news/content?brand=${encodeURIComponent(brand)}`);setArticles(r.articles);setBrands(r.brands);setBrand(b=>r.brands.includes(b)?b:r.brands[0]||'')}
    catch(e){const text=e instanceof Error?e.message:'';setMessage(text==='Failed to fetch'?'文章加载失败，请刷新页面或重新登录后再试':text||'成品库读取失败')}
    finally{setContentLoading(false)}
  }
  useEffect(()=>{
    setArticles(initialArticles)
    const nextBrands=brandNamesFromArticles(initialArticles,initialBrand)
    setBrands(nextBrands)
    setBrand(b=>nextBrands.includes(b)?b:nextBrands[0]||'')
    if(contentReady&&channel!=='video'&&!initialBrand&&!initialArticles.length)void reloadContent()
  },[initialArticles,initialBrand,contentReady])
  const eligible = articles.filter(a => a.project === brand && a.status === '已生成' && a.body?.trim())
  const selected = eligible.filter(a => ids.includes(a.id))
  const visible = eligible.filter(a => a.title.includes(query))
  const lockedArticle = (id: string) => newsOrders.some(o=>o.articleId===id&&nonRepeatArticleStates.has(o.state))
  const currentOrders = newsOrders.filter(o=>o.brand===brand)
  const scheduledOrders = currentOrders.filter(o=>o.state==='scheduled')
  const executingOrders = currentOrders.filter(o=>executingStates.has(o.state))
  const recordOrders = currentOrders.filter(o=>recordStates.has(o.state))
  const taskTime=(value?:string)=>{
    const time=Date.parse(value||'')
    return Number.isFinite(time)?time:0
  }
  const taskMinute=(value?:string)=>{
    const time=taskTime(value)
    return time?new Date(time).toISOString().slice(0,16):''
  }
  const publishTaskKey=(o:NewsOrder)=>o.publishBatchId||`${o.sourceTask||'历史发布'}:${taskMinute(o.scheduledAt||o.acceptedAt||o.startedAt||o.createdAt)||o.id}`
  const publishTasks:PublishTask[] = Array.from(currentOrders.reduce((map,o)=>{
    const key=publishTaskKey(o)
    map.set(key,[...(map.get(key)||[]),o])
    return map
  },new Map<string,NewsOrder[]>()).entries()).map(([id,rows])=>{
    const byTime=[...rows].sort((a,b)=>taskTime(a.scheduledAt||a.createdAt)-taskTime(b.scheduledAt||b.createdAt))
    const state:PublishTask['state']=rows.some(o=>o.state==='scheduled')?'scheduled':rows.some(o=>executingStates.has(o.state)||o.state==='quoted')?'executing':'completed'
    const articleCount=new Set(rows.map(o=>o.articleId)).size
    const mediaCount=new Set(rows.map(o=>`${o.channel||''}:${o.resourceId||o.mediaTitle}`)).size
    return {
      id,
      title: rows.find(o=>o.sourceTask)?.sourceTask || '媒体投喂任务',
      rows,
      state,
      createdAt: byTime.find(o=>o.createdAt)?.createdAt,
      scheduledAt: byTime.find(o=>o.scheduledAt)?.scheduledAt,
      articleCount,
      mediaCount,
      totalCents: rows.reduce((sum,o)=>sum+o.priceCents,0),
      success: rows.filter(o=>o.state==='linked').length,
      failed: rows.filter(o=>['refunded','cancelled'].includes(o.state)).length,
      executing: rows.filter(o=>executingStates.has(o.state)).length,
      scheduled: rows.filter(o=>o.state==='scheduled').length,
      cancelable: state!=='completed'&&rows.some(o=>cancellableStates.has(o.state)),
    }
  }).sort((a,b)=>Math.max(...b.rows.map(o=>taskTime(o.scheduledAt||o.acceptedAt||o.startedAt||o.createdAt)))-Math.max(...a.rows.map(o=>taskTime(o.scheduledAt||o.acceptedAt||o.startedAt||o.createdAt))))
  const candidateArticles = selected.filter(a => !lockedArticle(a.id))
  const publishCount = Math.min(Math.max(0, Math.trunc(Number(publishLimit)) || candidateArticles.length), candidateArticles.length)
  const publishSelection = candidateArticles.slice(0, publishCount)
  const groups = [...new Set(visible.map(a => a.batchId || a.taskName || 'history'))].map(key => ({
    key, articles: visible.filter(a => (a.batchId || a.taskName || 'history') === key),
    name: visible.find(a => (a.batchId || a.taskName || 'history') === key)?.taskName || '历史成品',
  }))
  const filteredResources = resources
  const favoriteStorageKey=`geo-media-favorites:${brand}:${activeChannel}`
  const favoriteFolders=[defaultFavoriteFolder,...Array.from(new Set(favorites.map(f=>f.folder||defaultFavoriteFolder).filter(Boolean))).filter(f=>f!==defaultFavoriteFolder)]
  const resourceKey=(r:Resource)=>`${activeChannel}:${r.resource_id}`
  const favoriteRows=favorites.filter(f=>!favoriteFolder||f.folder===favoriteFolder)
  const visibleFavoriteCards=favoriteRows.slice(0,12)
  const isFavorite=(r:Resource)=>favorites.some(f=>resourceKey(f.resource)===resourceKey(r))
  const saveFavorites=(rows:FavoriteResource[])=>{
    setFavorites(rows)
    try{localStorage.setItem(favoriteStorageKey,JSON.stringify(rows))}catch{}
  }
  const toggleFavorite=(resource:Resource,folder=defaultFavoriteFolder)=>{
    const key=resourceKey(resource),exists=favorites.find(f=>resourceKey(f.resource)===key)
    saveFavorites(exists?favorites.filter(f=>resourceKey(f.resource)!==key):[{folder:folder||defaultFavoriteFolder,channel:activeChannel,resource,savedAt:new Date().toISOString()},...favorites].slice(0,120))
  }
  const createFolder=()=>{
    const name=newFolder.trim()
    if(!name)return
    if(!favoriteFolders.includes(name))setFavoriteFolder(name)
    setNewFolder('')
  }
  const queuePageSize=20
  const activeTaskState:PublishTask['state']=view==='scheduled'?'scheduled':view==='executing'?'executing':'completed'
  const activeTasks=queueOnly?publishTasks.filter(task=>task.state===activeTaskState):publishTasks
  const taskPages=Math.max(1,Math.ceil(activeTasks.length/queuePageSize))
  const shownTasks=activeTasks.slice((taskPage-1)*queuePageSize,taskPage*queuePageSize)
  const taskLabel=(task:PublishTask)=>{
    if(task.state==='scheduled')return '预约中'
    if(task.state==='executing')return '执行中'
    if(task.failed&&task.success)return '部分完成'
    if(task.failed&&!task.success)return '发布失败'
    return '发布成功'
  }
  const taskStateClass=(task:PublishTask)=>task.state==='completed'&&task.failed?task.success?'partial':'failed':task.state
  const taskTitle=(task:PublishTask)=>task.title.replace(new RegExp(`^${brand}-?`),'').replace(/-\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/,'').replace(/-\d{8,}.*$/,'').replace(/[:：]?\s*$/,'')||'媒体投喂任务'
  const taskCode=(task:PublishTask)=>task.id.length>18?`${task.id.slice(0,8)}…${task.id.slice(-6)}`:task.id
  const formatTime=(value?:string)=>value?new Date(value).toLocaleString('zh-CN'):'-'
  const cancelTask=async(task:PublishTask)=>{
    if(!window.confirm(`确认取消“${taskTitle(task)}”？未执行的预约和预占会退回。`))return
    for(const row of task.rows.filter(o=>cancellableStates.has(o.state)))await orderAction('cancel',row,false)
  }
  const renderOrderActions=(o:NewsOrder, allowRepublish=false)=>{
    const canResolveUncertain=o.state==='uncertain'&&!o.orderId
    return <>
      {o.url&&<button onClick={()=>setBrowserUrl(o.url!)}>查看发布页面</button>}
      <button onClick={()=>setPreview({id:o.articleId,title:o.title,body:o.content,status:'已生成',words:''})}>查看稿件</button>
      {allowRepublish&&recordStates.has(o.state)&&<button disabled={busy} onClick={()=>rePublishFromOrder(o)}><RotateCcw size={14}/>再次发稿</button>}
      {(o.state==='reserved'||canResolveUncertain)&&<button disabled={busy} onClick={()=>void orderAction('resume',o)}>{canResolveUncertain?'重新提交':'继续分发'}</button>}
      {canResolveUncertain&&<button className="danger-button" disabled={busy} onClick={()=>void orderAction('fail',o)}>确认失败退回</button>}
      {cancellableStates.has(o.state)&&<button disabled={busy} onClick={()=>void orderAction('cancel',o)}>{o.state==='scheduled'?'取消预约':'取消待发布'}</button>}
      {recordStates.has(o.state)&&<button aria-label={`删除发布记录${o.title}`} title={['cancelled','linked','refunded'].includes(o.state)?'删除发布记录':'投稿处理中，核实完成后可删除'} disabled={busy||!['cancelled','linked','refunded'].includes(o.state)} onClick={()=>void orderAction('delete',o)}><Trash2 size={16}/></button>}
    </>
  }
  const renderPublishTasks=()=> <section className="media-queue-panel">
    <div className="media-record-summary media-task-summary">
      <div><span>{queueOnly?'发布任务':'全部记录'}</span><strong>{publishTasks.length}</strong></div>
      <div><span>预约中</span><strong>{publishTasks.filter(t=>t.state==='scheduled').length}</strong></div>
      <div><span>执行中</span><strong>{publishTasks.filter(t=>t.state==='executing').length}</strong></div>
      <div><span>{queueOnly?'成功发布':'已完成'}</span><strong>{publishTasks.filter(t=>t.state==='completed').length}</strong></div>
      <button className="ghost-button" disabled={busy} onClick={()=>void refreshOrders()}><RefreshCw size={16}/>更新状态</button>
    </div>
    <div className="media-table-scroll"><table className="media-record-table media-task-log-table"><colgroup><col className="task-col-name"/><col className="task-col-time"/><col className="task-col-scale"/><col className="task-col-status"/><col className="task-col-price"/><col className="task-col-actions"/></colgroup><thead><tr><th>任务信息</th><th>任务时间</th><th>投放内容</th><th>发布进度</th><th>费用</th><th>操作</th></tr></thead><tbody>{shownTasks.map(task=>{
      const mainTime=task.scheduledAt||task.createdAt
      return <tr key={task.id}>
        <td className="media-task-name"><strong>{taskTitle(task)}</strong><small>任务编号 {taskCode(task)}</small></td>
        <td className="media-task-time"><strong>{formatTime(mainTime)}</strong><small>{task.scheduledAt?'预约执行':'提交时间'}</small></td>
        <td className="media-task-scale"><span><b>文章</b><strong>{task.articleCount}篇</strong></span><span><b>媒体</b><strong>{task.mediaCount}家</strong></span></td>
        <td className="media-task-progress"><span className={`media-state media-state-${taskStateClass(task)}`}>{taskLabel(task)}</span><small>成功 {task.success} · 失败 {task.failed} · 执行 {task.executing} · 预约 {task.scheduled}</small></td>
        <td className="media-price media-task-price">¥{(task.totalCents/100).toFixed(2)}</td>
        <td className="media-task-action-cell"><div className="media-task-actions">{task.cancelable&&<button className="danger-button" disabled={busy} onClick={()=>void cancelTask(task)}>取消任务</button>}<button onClick={()=>setTaskDetail(task)}>查看详情</button></div></td>
      </tr>
    })}</tbody></table></div>
    {!shownTasks.length&&<EmptyState title={!queueOnly?'暂无发布记录':view==='scheduled'?'暂无预约发布任务':view==='executing'?'暂无执行发布任务':'暂无成功发布任务'} description="外层只展示发布任务，文章、媒体和失败原因请进入详情查看。" />}
    {activeTasks.length>queuePageSize&&<div className="media-pagination media-queue-pagination"><span>每页20条 · 第 {taskPage} / {taskPages} 页 · 共 {activeTasks.length} 条</span><button disabled={taskPage<=1} onClick={()=>setTaskPage(1)}>首页</button><button disabled={taskPage<=1} onClick={()=>setTaskPage(taskPage-1)}>上一页</button><button disabled={taskPage>=taskPages} onClick={()=>setTaskPage(taskPage+1)}>下一页</button><button disabled={taskPage>=taskPages} onClick={()=>setTaskPage(taskPages)}>末页</button></div>}
  </section>
  const useFavorite=(resource:Resource)=>{
    const current=resources.find(r=>String(r.resource_id)===String(resource.resource_id))
    if(current){setQuantity(current,Math.max(1,quantities[String(current.resource_id)]||1));return}
    setMediaQuery(resource.title)
    setPage(1)
    setMessage(`已定位收藏媒体“${resource.title}”，请在结果中选择后发稿`)
  }
  const selectGroup = (rows: Article[], checked: boolean) => {
    const allowed = recordsLoaded ? rows.filter(a => !lockedArticle(a.id)) : rows
    setIds(checked ? [...new Set([...ids, ...allowed.map(a => a.id)])] : ids.filter(id => !rows.some(a => a.id === id)))
  }
  const enterMediaStage=()=>{
    const fallback=visible.filter(a=>!lockedArticle(a.id))
    if(!candidateArticles.length&&fallback.length)setIds([...new Set([...ids,...fallback.map(a=>a.id)])])
    if(!candidateArticles.length&&!fallback.length){setMessage('当前没有可发布文章');return}
    setMessage('');setView('compose');setStage('media')
  }
  useEffect(() => { if (stage === 'media') void loadResources(1); return () => { resourceRequest.current++ } }, [stage, resourceChannel])
  useEffect(()=>{
    try{
      const rows=JSON.parse(localStorage.getItem(favoriteStorageKey)||'[]')
      setFavorites(Array.isArray(rows)?rows.filter(r=>r?.resource?.resource_id).slice(0,120):[])
    }catch{setFavorites([])}
    setFavoriteFolder('')
    setNewFolder('')
  },[favoriteStorageKey])
  useEffect(()=>{if(stage!=='media')return;const t=window.setTimeout(()=>void loadResources(1),300);return()=>window.clearTimeout(t)},[mediaQuery,priceMin,priceLimit,sort,pageSize,region,industry,kind,mediaType,platform,portal,pageLevel,indexEffect,linkType,publishSpeed,weight,fans,reads,accountType,verification,mediaIdentity,feature,resourceChannel])
  useEffect(()=>{if(stage!=='media'||!catalog?.sync?.syncing)return;const t=window.setTimeout(()=>void loadResources(page),2000);return()=>window.clearTimeout(t)},[catalog,stage])
  const title = headingTitle || (inputChannel==='b2b'?'补充媒体投喂':channel === 'social' ? '自有媒体投喂' : channel === 'news2' ? '核心媒体投喂' : channel === 'news' ? '补充媒体投喂' : '视频')
  const loadDrafts = async () => {
    if(channel==='video')return
    if(!brand){setRecordsLoaded(false);return}
    const channels=queueOnly?'news,news2,social,b2b':inputChannel==='news'?'news,social,b2b':inputChannel
    const params=new URLSearchParams({brand,channels})
    const r=await request<{orders:NewsOrder[]}>(`/api/news/orders?${params}`);setNewsOrders(channelOrders(r.orders));setRecordsLoaded(true)
    if(channel!=='social')return
    const results = await Promise.all(['social'].map(c => request<{ drafts: Draft[] }>(`/api/media/drafts?brand=${encodeURIComponent(brand)}&channel=${c}`)))
    setDrafts(results.flatMap(r => r.drafts)); setRecordsLoaded(true)
  }
  useEffect(() => { void loadDrafts().catch(e => setMessage(e.message)) }, [brand])
  useEffect(()=>{
    if(!['executing','records'].includes(view))return
    const rows=currentOrders.filter(o=>refreshableStates.has(o.state))
    if(!rows.length)return
    const timer=window.setTimeout(()=>void refreshOrders(),rows.some(o=>waitingStates.has(o.state))?2500:8000)
    return ()=>window.clearTimeout(timer)
  },[channel,view,newsOrders,brand])
  const loadResources = async (next: number, refresh = false) => {
    const sequence=++resourceRequest.current
    setBusy(true); setMessage('')
    try {
      const params=new URLSearchParams({channel:resourceChannel,page:String(next),pageSize:String(pageSize),q:mediaQuery,minPrice:priceMin,maxPrice:priceLimit,sort,region,industry,kind,mediaType,platform,portal,pageLevel,indexEffect,linkType,publishSpeed,weight,fans,reads,accountType,verification,mediaIdentity,feature})
      if(refresh)params.set('refresh','1')
      const result = await request<{ resources: Resource[] } & Catalog>(`/api/media/resources?${params}`)
      if(sequence!==resourceRequest.current)return
      setResources(result.resources);setCatalog(result.total===undefined?null:result);setPage(result.page||next);setJump(String(result.page||next));setLoaded(true)
    } catch (e) { if(sequence===resourceRequest.current)setMessage(e instanceof Error ? e.message : '媒体加载失败') }
    finally { if(sequence===resourceRequest.current)setBusy(false) }
  }
  let allocationOffset = 0
  const allocations = chosen.map(resource => {
    const quantity = Math.min(quantities[String(resource.resource_id)] || 0, Math.max(0, publishSelection.length - allocationOffset))
    const assigned = publishSelection.slice(allocationOffset, allocationOffset + quantity)
    allocationOffset += quantity
    return { resource, assigned }
  })
  const assignedCount = allocations.reduce((sum, a) => sum + a.assigned.length, 0)
  const total = allocations.reduce((sum, a) => sum + Math.round(Number(a.resource.price) * 100) * a.assigned.length, 0) / 100
  const setQuantity = (resource: Resource, value: number) => {
    const key = String(resource.resource_id)
    const used = allocations.filter(a => String(a.resource.resource_id) !== key).reduce((sum, a) => sum + a.assigned.length, 0)
    const quantity = Math.min(Math.max(0, Math.trunc(value) || 0), publishSelection.length - used)
    setQuantities({ ...quantities, [key]: quantity })
    setChosen(quantity ? chosen.some(r => String(r.resource_id) === key) ? chosen : [...chosen, resource] : chosen.filter(r => String(r.resource_id) !== key))
  }
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      if(publishMode==='scheduled'){
        const scheduledAt=new Date(`${scheduledDate}T${scheduledTime}:00`)
        if(!Number.isFinite(scheduledAt.getTime())||scheduledAt.getTime()<Date.now()-60000)throw new Error('预约时间无效')
        const result=await request<{orders:NewsOrder[]}>('/api/news/schedule',{ids:quote.map(o=>o.id),scheduledAt:scheduledAt.toISOString(),failurePolicy:{retryWithNewArticle:true,maxRetry:1}})
        setNewsOrders(channelOrders(result.orders));setRecordsLoaded(true);setConfirmation(false);setView('records');setTaskPage(1);setMessage('已加入发布记录，状态为预约中，到点后自动执行');return
      }
        const result=await request<{orders:NewsOrder[]}>('/api/news/dispatch',{ids:quote.map(o=>o.id)})
        setNewsOrders(channelOrders(result.orders));setRecordsLoaded(true);setConfirmation(false);setView('records');setTaskPage(1);setMessage('已进入发布记录，状态为执行中，完成后更新为发布结果');return
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }
  const prepare=async()=>{
    const next=new Date(Date.now()+60*60*1000)
    setPublishMode('now');setScheduledDate(next.toISOString().slice(0,10));setScheduledTime(next.toTimeString().slice(0,5))
    setConfirmation(true);setQuote([]);setFunding(null);setQuoting(true);setBusy(true);setMessage('')
    try {
      const result=await request<{orders:NewsOrder[];funding:Funding}>('/api/news/quote',{brand,channel:activeChannel,b2b:activeChannel==='b2b'?b2b:undefined,requestId:crypto.randomUUID(),edits,allocations:allocations.filter(a=>a.assigned.length).map(a=>({resourceId:a.resource.resource_id,articleIds:a.assigned.map(r=>r.id)}))})
      setQuote(result.orders);setFunding(result.funding||null);setConfirmation(true)
    }catch(e){setMessage(e instanceof Error?e.message:'报价失败')}finally{setBusy(false);setQuoting(false)}
  }
  const refreshOrders=async()=>{
    if(!brand)return
    setBusy(true);setMessage('')
    try{
      const channels=queueOnly?'news,news2,social,b2b':inputChannel==='news'?'news,social,b2b':inputChannel
      const params=new URLSearchParams({brand,channels})
      const latest=await request<{orders:NewsOrder[]}>(`/api/news/orders?${params}`)
      const rows=channelOrders(latest.orders).filter(o=>o.brand===brand)
      const ids=rows.filter(o=>o.orderId&&o.state!=='refunded').slice(0,100).map(o=>o.id)
      if(!ids.length){setNewsOrders(channelOrders(latest.orders));setRecordsLoaded(true);return}
      const r=await request<{orders:NewsOrder[]}>('/api/news/refresh',{ids})
      setNewsOrders(channelOrders(r.orders));setRecordsLoaded(true)
    }catch(e){setMessage(e instanceof Error?e.message:'状态读取失败')}finally{setBusy(false)}
  }
  const checkFunding=async()=>{
    setBusy(true);setMessage('')
    try{const r=await request<{funding:Funding}>('/api/news/check',{ids:quote.map(o=>o.id)});setFunding(r.funding)}catch(e){setMessage(e instanceof Error?e.message:'额度读取失败')}finally{setBusy(false)}
  }
  const orderAction=async(action:string,o:NewsOrder,confirmAction=true)=>{
    if(confirmAction&&action==='delete'&&!window.confirm(`确定删除“${o.title}”的发布记录？未分发的预占费用与篇数将退回；已发布网页不会下架，账目凭据保留。`))return
    if(confirmAction&&action==='fail'&&!window.confirm(`确认“${o.title}”投稿失败并退回预占费用与发布篇数？请先确认平台没有生成订单号。`))return
    setBusy(true);setMessage('')
    try{const payload=action==='fail'?{id:o.id,reason:'人工确认投稿失败，退回预占'}:['cancel','delete'].includes(action)?{id:o.id}:{ids:[o.id]};const r=await request<{orders:NewsOrder[]}>(`/api/news/${action}`,payload);setNewsOrders(channelOrders(r.orders));setTaskDetail(null);if(action==='delete')setMessage('发布记录已删除，账目凭据保留');if(action==='fail')setMessage('已确认失败，预占费用与发布篇数已退回');if(action==='resume')setMessage('已重新提交，请稍后刷新状态')}catch(e){setMessage(e instanceof Error?e.message:'订单操作失败')}finally{setBusy(false)}
  }
  const rePublishFromOrder=(o:NewsOrder)=>{
    const next=(o.channel||inputChannel) as MediaChannel
    if(inputChannel==='news'&&['news','social','b2b'].includes(next))switchResourceChannel(next)
    setMediaQuery(o.mediaTitle)
    if(!candidateArticles.length){
      const fallback=visible.filter(a=>!lockedArticle(a.id))
      if(fallback.length)setIds([...new Set([...ids,...fallback.map(a=>a.id)])])
    }
    setView('compose')
    setStage('media')
    setMessage(`已按“${o.mediaTitle}”定位媒体，可重新选择文章后发稿`)
  }
  const news2Fields=(type:string)=>catalog?.fields.filter(f=>f.type===type&&f.count).slice(0,36)||[]
  const marketFields=(type:string,limit=36)=>catalog?.fields.filter(f=>f.type===type&&f.count).slice(0,limit)||[]
  const chip=(active:boolean,label:string,onClick:()=>void,key=label)=><button key={key} type="button" aria-pressed={active} onClick={onClick}>{label}</button>
  const chipGroup=(label:string,children:ReactNode)=><div className="media-market-filter-row"><strong>{label}</strong><div>{children}</div></div>
  const priceActive=(min:string,max:string)=>priceMin===min&&priceLimit===max
  const setPriceRange=(min:string,max:string)=>{setPriceMin(min);setPriceLimit(max)}
  const news2DetailLines=(r:Resource)=>{
    const d=r.details||{}
    return [
      `时效：${d.publishSpeed||'未提供'}${d.deadline&&d.deadline!==d.publishSpeed?` / 截稿 ${d.deadline}`:''}`,
      `收录：${d.indexing||'未提供'}${d.aiInclude&&d.aiInclude!==d.indexing?` / AI ${d.aiInclude}`:''}`,
      [d.linkType,d.contact,d.linkPeriod].filter(Boolean).join(' / '),
      [d.weekendActive,d.weight?`权重 ${d.weight}`:'',d.portal].filter(Boolean).join(' / '),
      [d.fans?`粉丝 ${d.fans}`:'',d.reads?`阅读 ${d.reads}`:'',d.likes?`点赞 ${d.likes}`:''].filter(Boolean).join(' / '),
      [d.imageFee?`图片 ${d.imageFee}`:'',d.translation?`翻译 ${d.translation}`:'',d.country,d.language].filter(Boolean).join(' / '),
    ].filter(Boolean)
  }
  const newsDetailLines=(r:Resource)=>[
    `收录：${r.details?.indexing||'未提供'}`,
    `链接：${r.details?.linkType||'未提供'}`,
    `时效：${r.details?.publishSpeed||'未提供'}`,
    [r.details?.pageLevel,r.details?.features,r.details?.mediaType,r.details?.weight?`权重 ${r.details.weight}`:''].filter(Boolean).join(' / '),
  ].filter(Boolean)
  const socialDetailLines=(r:Resource)=>[
    `粉丝：${r.details?.fans||'未提供'}`,
    `阅读：${r.details?.reads||'未提供'}`,
    r.details?.features||'',
  ].filter(Boolean)
  const showMediaTab=inputChannel==='news'||inputChannel==='news2'
  const switchResourceChannel=(next:MediaChannel)=>{
    setResourceChannel(next);setChosen([]);setQuantities({});setMediaQuery('');setRegion('');setIndustry('');setKind('');setMediaType('');setPlatform('');setPortal('');setPageLevel('');setIndexEffect('');setLinkType('');setPublishSpeed('');setWeight('');setFans('');setReads('');setAccountType('');setVerification('');setMediaIdentity('');setFeature('')
  }
  if (channel === 'video') return <section className="media-workspace"><h2>视频</h2><EmptyState title="暂未接入视频成品与发布接口" description="暂无可发布视频" action={<Video size={28} />} /></section>
  return <section className={`media-workspace media-channel-${inputChannel}`}>
    <div className="media-section-head"><label>内容品牌<select aria-label="内容品牌" value={brand} onChange={e=>{setBrand(e.target.value);setIds([]);setChosen([]);setStage('tasks')}}>{brands.map(b=><option key={b} value={b}>{b}</option>)}</select></label><button aria-label="刷新成品库" title="刷新成品库" disabled={contentLoading} onClick={()=>void reloadContent()}><RefreshCw size={16}/></button>{contentLoading&&<span role="status">正在读取成品库</span>}</div>
    <header className="media-heading"><div><h2>{title}</h2><span>{brand || '请选择品牌'} · {queueOnly?'预约、执行和发布结果':activeChannel === 'social' ? '第三方自媒体资源投稿' : activeChannel==='b2b'?'B2B网站投稿':'新闻媒体投稿'}</span></div>{!queueOnly&&view === 'compose' && stage === 'tasks' && <button className="primary-button" disabled={!candidateArticles.length || busy} onClick={() => setStage('media')}><Save size={16} />{`发布 · 本次${publishCount || candidateArticles.length}篇`}</button>}</header>
    <nav className="media-tabs" aria-label="发布视图">{!queueOnly&&<button aria-pressed={view === 'compose'&&stage==='tasks'} onClick={() => {setView('compose');setStage('tasks')}}>任务选稿</button>}{!queueOnly&&showMediaTab&&<button aria-pressed={view==='compose'&&stage==='media'} disabled={busy||!visible.some(a=>!lockedArticle(a.id))} onClick={enterMediaStage}>选择媒体</button>}{queueOnly?<><button aria-pressed={view === 'scheduled'} onClick={() => {setView('scheduled');setTaskPage(1);void loadDrafts().catch(e=>setMessage(e.message))}}>预约发布（{publishTasks.filter(t=>t.state==='scheduled').length}）</button><button aria-pressed={view === 'executing'} onClick={() => {setView('executing');setTaskPage(1);void loadDrafts().catch(e=>setMessage(e.message))}}>执行发布（{publishTasks.filter(t=>t.state==='executing').length}）</button><button aria-pressed={view === 'records'} onClick={() => {setView('records');setTaskPage(1);void loadDrafts().catch(e=>setMessage(e.message))}}>成功发布（{publishTasks.filter(t=>t.state==='completed').length}）</button></>:<button aria-pressed={view === 'records'} onClick={() => {setView('records');setTaskPage(1);void loadDrafts().catch(e=>setMessage(e.message))}}>发布记录（{publishTasks.length}）</button>}{!queueOnly&&channel==='social'&&drafts.length>0&&<button aria-pressed={view==='drafts'} onClick={()=>setView('drafts')}>历史待发布稿（{drafts.length}）</button>}</nav>
    {message && <p role="status">{message}</p>}
    {view === 'compose' ? <div>
      <div className="media-steps"><strong className={stage === 'tasks' ? 'active' : ''}>1 选择任务与文章</strong><span>›</span><strong className={stage === 'media' ? 'active' : ''}>2 选择媒体</strong><span>›</span><strong>3 确认发布</strong></div>
      {stage === 'tasks' ? <section>
        <div className="media-section-head"><h3>生成任务 · {groups.length} 个任务 / {eligible.length} 篇文章</h3><span>候选 {candidateArticles.length} 篇 · 本次发布 {publishCount || candidateArticles.length} 篇</span></div>
        <input aria-label="搜索成品文章" placeholder="搜索文章标题" value={query} onChange={e => setQuery(e.target.value)} />
        <label className="media-check">本次发布篇数<input type="number" min="1" max={candidateArticles.length || 1} value={publishLimit} placeholder={`默认${candidateArticles.length || 0}篇`} onChange={e=>setPublishLimit(e.target.value)} /></label>
        <label className="media-check"><input type="checkbox" checked={visible.filter(a=>!lockedArticle(a.id)).length > 0 && visible.filter(a=>!lockedArticle(a.id)).every(a => ids.includes(a.id))} onChange={e => selectGroup(visible, e.target.checked)} />全选任务</label>
        <div className="media-table-scroll"><table className="media-task-table"><thead><tr><th>选择</th><th>生成任务</th><th>文章数</th><th>已锁定</th><th>可发布</th><th>操作</th></tr></thead><tbody>
          <PagedRows table>{groups.map(g => <tr key={g.key}><td><input type="checkbox" aria-label={`选择任务${g.name}`} checked={g.articles.filter(a=>!lockedArticle(a.id)).length>0&&g.articles.filter(a=>!lockedArticle(a.id)).every(a => ids.includes(a.id))} onChange={e => selectGroup(g.articles,e.target.checked)} /></td><td><strong>{g.name}</strong><small>{g.key === 'history' ? '无批次编号' : g.key}</small></td><td>{g.articles.length}</td><td>{recordsLoaded ? g.articles.filter(a=>lockedArticle(a.id)).length : '未加载'}</td><td>{recordsLoaded ? g.articles.filter(a=>!lockedArticle(a.id)).length : '未加载'}</td><td><button className="ghost-button" onClick={() => setExpanded(expanded.includes(g.key) ? expanded.filter(k => k !== g.key) : [...expanded, g.key])}>{expanded.includes(g.key) ? '收起文章' : '查看文章'}</button></td></tr>)}</PagedRows>
        </tbody></table></div>
        {groups.filter(g => expanded.includes(g.key)).map(g => <section className="media-task-detail" key={g.key}><div className="media-section-head"><h3>{g.name}</h3><button className="ghost-button" disabled={!recordsLoaded} onClick={() => selectGroup(g.articles.filter(a=>!lockedArticle(a.id)),true)}>选择可发布文章</button></div>
          <PagedRows>{g.articles.map(a => <div className="media-article" key={a.id}><input type="checkbox" aria-label={`选择${a.title}`} disabled={recordsLoaded&&lockedArticle(a.id)} checked={ids.includes(a.id)&&!lockedArticle(a.id)} onChange={e => selectGroup([a],e.target.checked)} /><div><strong>{edits[a.id]?.title || a.title}</strong><small>{a.words}字 · {recordsLoaded ? lockedArticle(a.id) ? '已进入发布流程或已有发布记录，退回后才能重新发布' : '可发布' : '状态未加载'}{edits[a.id] ? ' · 已编辑发布副本' : ''}</small></div><button title="预览与编辑" aria-label={`预览${a.title}`} onClick={() => setPreview(a)}><Eye size={17} /></button></div>)}</PagedRows>
        </section>)}
        {!visible.length && <EmptyState title="暂无成品文章" description="当前品牌没有匹配的已生成文章" />}
      </section> : <section>
        <div className="media-section-head"><button className="ghost-button" onClick={() => setStage('tasks')}>返回任务选稿</button><span>候选 {candidateArticles.length} 篇 · 本次发布 {publishSelection.length} 篇 · 待分配 {publishSelection.length - assignedCount} 篇</span></div>
        {inputChannel==='news'&&<div className="media-source-switch"><button type="button" aria-pressed={resourceChannel==='news'} onClick={()=>switchResourceChannel('news')}>新闻媒体</button><button type="button" aria-pressed={resourceChannel==='social'} onClick={()=>switchResourceChannel('social')}>自媒体资源</button><button type="button" aria-pressed={resourceChannel==='b2b'} onClick={()=>switchResourceChannel('b2b')}>B2B网站</button></div>}
        {activeChannel==='b2b'&&<div className="media-filters">
          <label>联系人<input aria-label="B2B联系人" value={b2b.author} onChange={e=>setB2b({...b2b,author:e.target.value})}/></label>
          <label>联系电话<input aria-label="B2B联系电话" value={b2b.phone} onChange={e=>setB2b({...b2b,phone:e.target.value})}/></label>
          <label>来源<input aria-label="B2B来源" value={b2b.from} onChange={e=>setB2b({...b2b,from:e.target.value})}/></label>
          <label>封面HTTPS地址<input aria-label="B2B封面" placeholder="留空使用正文首图" type="url" value={b2b.image_url} onChange={e=>setB2b({...b2b,image_url:e.target.value})}/></label>
          <label>列举网发布地区<select aria-label="B2B发布地区" value={b2b.area} onChange={e=>setB2b({...b2b,area:e.target.value})}><option value="">请选择地区</option>{catalog?.areas?.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        </div>}
        {activeChannel==='news2'||activeChannel==='news'||activeChannel==='social'?<div className="media-market-panel">
          <div className="media-market-search">
            <input aria-label="搜索全部媒体" placeholder="请输入资源名称" value={mediaQuery} onChange={e=>setMediaQuery(e.target.value)} />
            <button className="primary-button" disabled={busy} onClick={()=>void loadResources(1)}>查询</button>
            <button className="ghost-button media-refresh-library" disabled={busy||!!catalog?.sync?.syncing} onClick={()=>void loadResources(1,true)}>更新媒体库</button>
          </div>
          <div className="media-market-filters">
            {activeChannel==='news2'&&chipGroup('媒体类型：',<>{chip(!mediaType,'不限',()=>setMediaType(''))}{news2Fields('field_0').map(f=>chip(mediaType===f.id,`${f.title}`,()=>setMediaType(f.id),f.id))}</>)}
            {chipGroup(activeChannel==='social'||activeChannel==='news2'?'平台/频道：':'行业类型：',<>{chip(!platform,'不限',()=>setPlatform(''))}{marketFields('field_1').map(f=>chip(platform===f.id,`${f.title}`,()=>setPlatform(f.id),f.id))}</>)}
            {(activeChannel==='news2'||activeChannel==='social')&&chipGroup('内容分类：',<>{chip(!industry,'不限',()=>setIndustry(''))}{marketFields('field_2').map(f=>chip(industry===f.id,`${f.title}`,()=>setIndustry(f.id),f.id))}</>)}
            {activeChannel==='news'&&chipGroup('综合门户：',<>{chip(!portal,'不限',()=>setPortal(''))}{marketFields('field_2',28).map(f=>chip(portal===f.id,`${f.title}`,()=>setPortal(f.id),f.id))}</>)}
            {activeChannel!=='news2'&&chipGroup('所在地区：',<>{chip(!region,'不限',()=>setRegion(''))}{marketFields('field_3',34).map(f=>chip(region===f.id,`${f.title}`,()=>setRegion(f.id),f.id))}</>)}
            {activeChannel==='news'&&chipGroup('收录效果：',<>{chip(!indexEffect,'不限',()=>setIndexEffect(''))}{marketFields('field_5').map(f=>chip(indexEffect===f.id,`${f.title}`,()=>setIndexEffect(f.id),f.id))}</>)}
            {activeChannel==='news'&&chipGroup('链接类型：',<>{chip(!linkType,'不限',()=>setLinkType(''))}{marketFields('field_6').map(f=>chip(linkType===f.id,`${f.title}`,()=>setLinkType(f.id),f.id))}</>)}
            {activeChannel==='news'&&chipGroup('发稿速度：',<>{chip(!publishSpeed,'不限',()=>setPublishSpeed(''))}{marketFields('field_7').map(f=>chip(publishSpeed===f.id,`${f.title}`,()=>setPublishSpeed(f.id),f.id))}</>)}
            {activeChannel==='news'&&chipGroup('资源特性：',<>{chip(!feature,'不限',()=>setFeature(''))}{marketFields('field_9').map(f=>chip(feature===f.id,`${f.title}`,()=>setFeature(f.id),f.id))}</>)}
            {activeChannel==='social'&&chipGroup('参考粉丝：',<>{chip(!fans,'不限',()=>setFans(''))}{marketFields('field_4').map(f=>chip(fans===f.id,`${f.title}`,()=>setFans(f.id),f.id))}</>)}
            {activeChannel==='social'&&chipGroup('参考阅读：',<>{chip(!reads,'不限',()=>setReads(''))}{marketFields('field_5').map(f=>chip(reads===f.id,`${f.title}`,()=>setReads(f.id),f.id))}</>)}
            {activeChannel==='social'&&chipGroup('认证/身份：',<>{chip(!verification,'认证不限',()=>setVerification(''))}{marketFields('field_6').map(f=>chip(verification===f.id,`${f.title}`,()=>setVerification(f.id),f.id))}{chip(!mediaIdentity,'身份不限',()=>setMediaIdentity(''))}{marketFields('field_7').map(f=>chip(mediaIdentity===f.id,`${f.title}`,()=>setMediaIdentity(f.id),f.id))}</>)}
            {activeChannel==='news2'&&chipGroup('账号属性：',<>{chip(!accountType,'不限',()=>setAccountType(''))}{marketFields('field_7').map(f=>chip(accountType===f.id,`${f.title}`,()=>setAccountType(f.id),f.id))}</>)}
            {chipGroup('价格区间：',<>
              {chip(priceActive('',''),'不限',()=>setPriceRange('',''))}
              {chip(priceActive('0','9'),'0-9',()=>setPriceRange('0','9'))}
              {chip(priceActive('10','20'),'10-20',()=>setPriceRange('10','20'))}
              {chip(priceActive('21','35'),'21-35',()=>setPriceRange('21','35'))}
              {chip(priceActive('36','50'),'36-50',()=>setPriceRange('36','50'))}
              {chip(priceActive('51','80'),'51-80',()=>setPriceRange('51','80'))}
              {chip(priceActive('80','100'),'80-100',()=>setPriceRange('80','100'))}
              {chip(priceActive('200',''),'200以上',()=>setPriceRange('200',''))}
              <input aria-label="价格下限" type="number" min="0" value={priceMin} onChange={e=>setPriceMin(e.target.value)} />
              <span>-</span>
              <input aria-label="价格上限" type="number" min="0" value={priceLimit} onChange={e=>setPriceLimit(e.target.value)} />
            </>)}
          </div>
        </div>:<div className="media-filters">
          <label>媒体名称<input aria-label="搜索全部媒体" placeholder="搜索全部媒体" value={mediaQuery} onChange={e=>setMediaQuery(e.target.value)} /></label>
          {channel==='news'&&<label>范围<select aria-label="媒体范围" value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部媒体</option><option value="local">地方媒体</option></select></label>}
          {channel==='social'&&<>
            <label>所属平台<select aria-label="所属平台" value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">全部平台</option>{catalog?.fields.filter(f=>f.type==='field_1'&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label>
            <label>认证状态<select aria-label="认证状态" value={verification} onChange={e=>setVerification(e.target.value)}><option value="">全部认证</option>{catalog?.fields.filter(f=>f.type==='field_6'&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label>
            <label>媒体身份<select aria-label="媒体身份" value={mediaIdentity} onChange={e=>setMediaIdentity(e.target.value)}><option value="">全部身份</option>{catalog?.fields.filter(f=>f.type==='field_7'&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label>
            <label>资源标签<select aria-label="资源标签" value={feature} onChange={e=>setFeature(e.target.value)}><option value="">全部标签</option>{catalog?.fields.filter(f=>f.type==='field_8'&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label>
          </>}
          {channel!=='b2b'&&<><label>地区<select aria-label="媒体地区" value={region} onChange={e=>setRegion(e.target.value)}><option value="">全部地区</option>{catalog?.fields.filter(f=>f.type==='field_3'&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label>
          <label>行业<select aria-label="媒体行业" value={industry} onChange={e=>setIndustry(e.target.value)}><option value="">全部行业</option>{catalog?.fields.filter(f=>f.type===(channel==='social'?'field_2':'field_1')&&f.count).map(f=><option key={f.id} value={f.id}>{f.title}（{f.count}）</option>)}</select></label></>}
          <label>价格上限<input type="number" min="0" aria-label="价格上限" placeholder="不限" value={priceLimit} onChange={e=>setPriceLimit(e.target.value)} /></label><label>价格排序<select value={sort} onChange={e=>setSort(e.target.value)}><option value="default">默认顺序</option><option value="low">由低到高</option><option value="high">由高到低</option></select></label><button title="查询媒体" aria-label="查询媒体" disabled={busy} onClick={()=>void loadResources(page)}><RefreshCw size={16}/></button>
        </div>
        }
        {(activeChannel==='news2'||activeChannel==='news'||activeChannel==='social')&&<section className="media-favorite-panel" aria-label="媒体收藏夹">
          <div className="media-favorite-head"><strong>我的收藏夹：</strong><div>{chip(!favoriteFolder,'全部收藏',()=>setFavoriteFolder(''))}{favoriteFolders.map(folder=>chip(favoriteFolder===folder,folder,()=>setFavoriteFolder(folder),folder))}</div><label><input aria-label="新建收藏夹名称" placeholder="输入收藏夹名" value={newFolder} onChange={e=>setNewFolder(e.target.value)} /></label><button type="button" onClick={createFolder}>创建</button></div>
          {visibleFavoriteCards.length>0&&<div className="media-favorite-cards">{visibleFavoriteCards.map(({resource,folder})=>{
            const assigned = allocations.find(a => String(a.resource.resource_id) === String(resource.resource_id))?.assigned || []
            return <article className={assigned.length?'media-favorite-card selected':'media-favorite-card'} key={`${folder}:${resource.resource_id}`}>
              <button type="button" className="media-star-button active" title="取消收藏" aria-label={`取消收藏${resource.title}`} onClick={()=>toggleFavorite(resource)}><Star size={15} fill="currentColor"/></button>
              <strong>{resource.title}</strong><small>{folder} · ¥{Number(resource.price).toFixed(2)}</small>
              <span>{resource.details?.platform||resource.details?.industry||resource.details?.category||'常用媒体'}</span>
              <button type="button" onClick={()=>useFavorite(resource)}>{assigned.length?`已选${assigned.length}篇`:'加入本次'}</button>
            </article>
          })}</div>}
        </section>}
        {(activeChannel==='news2'||activeChannel==='news'||activeChannel==='social')&&<div className="media-market-sort"><button type="button" aria-pressed={sort==='default'} onClick={()=>setSort('default')}>默认排序</button><button type="button" aria-pressed={sort==='low'} onClick={()=>setSort('low')}>按价格升序</button><button type="button" aria-pressed={sort==='high'} onClick={()=>setSort('high')}>按价格降序</button><strong>已选 {allocations.filter(a=>a.assigned.length).length} 家媒体 · {assignedCount} 篇</strong></div>}
        {catalog&&<p role="status">{catalog.complete?`媒体库共 ${catalog.catalogTotal} 家 · 当前匹配 ${catalog.total} 家${catalog.updatedAt?` · 上次同步 ${new Date(catalog.updatedAt).toLocaleString('zh-CN')}`:''}`:`正在同步媒体库，已读取 ${catalog.sync?.count||0} 家`}{catalog.sync?.syncing&&catalog.complete?' · 正在后台更新':''}{catalog.sync?.error&&` · 同步失败：${catalog.sync.error}`}</p>}
        {assignedCount > 0 && <div className="media-selected">{allocations.filter(a => a.assigned.length).map(a => <label key={a.resource.resource_id}><input type="checkbox" checked onChange={() => setQuantity(a.resource, 0)} />{a.resource.title} · {a.assigned.length}篇</label>)}</div>}
        {(activeChannel==='news2'||activeChannel==='news'||activeChannel==='social')&&filteredResources.length>0&&<div className="media-resource-cards" aria-label="媒体资源卡片">{filteredResources.slice(0,8).map(r=>{
          const assigned = allocations.find(a => String(a.resource.resource_id) === String(r.resource_id))?.assigned || []
          return <article className={assigned.length?'media-resource-card selected':'media-resource-card'} key={r.resource_id}>
            <button type="button" className={isFavorite(r)?'media-star-button active':'media-star-button'} title={isFavorite(r)?'取消收藏':'加入收藏夹'} aria-label={`${isFavorite(r)?'取消收藏':'收藏'}${r.title}`} onClick={()=>toggleFavorite(r,favoriteFolder||defaultFavoriteFolder)}><Star size={15} fill={isFavorite(r)?'currentColor':'none'}/></button>
            <strong>{r.title}</strong>
            <small>{r.details?.platform||r.details?.industry||r.details?.category||'媒体资源'} · ¥{Number(r.price).toFixed(2)}</small>
            <p>{[r.details?.indexing,r.details?.publishSpeed,r.details?.region].filter(Boolean).slice(0,3).join(' / ')||r.remarks||'可加入本次投放'}</p>
            <div><button type="button" disabled={!assigned.length && assignedCount===publishSelection.length} onClick={()=>setQuantity(r,assigned.length?0:1)}>{assigned.length?'移出本次':'选择媒体'}</button>{r.case_link && /^https?:\/\//i.test(r.case_link)&&<button type="button" onClick={()=>setBrowserUrl(r.case_link!)}>案例</button>}</div>
          </article>
        })}</div>}
        <div className="media-table-scroll"><table className="media-resource-table"><thead><tr><th>选择</th><th>媒体名称</th>{activeChannel==='news2'&&<><th>媒体类型 / 平台</th><th>分类 / 区域</th><th>时效 / 收录 / 规则</th></>}{activeChannel==='news'&&<><th>行业 / 门户</th><th>地区 / 类型</th><th>收录 / 链接 / 时效</th></>}{activeChannel==='social'&&<><th>平台 / 行业</th><th>认证 / 身份</th><th>粉丝 / 阅读 / 特性</th></>}<th>单篇价格</th><th>发布篇数</th><th>小计</th><th>投稿要求</th></tr></thead><tbody>{filteredResources.map(r => {
          const assigned = allocations.find(a => String(a.resource.resource_id) === String(r.resource_id))?.assigned || []
          return <tr key={r.resource_id} className={assigned.length ? 'media-row-selected' : ''}>
            <td><input aria-label={r.title} type="checkbox" checked={assigned.length > 0} disabled={!assigned.length && assignedCount === publishSelection.length} onChange={e=>setQuantity(r, e.target.checked ? 1 : 0)} /></td>
            <td><div className="media-name-cell"><button type="button" className={isFavorite(r)?'media-star-button active':'media-star-button'} title={isFavorite(r)?'取消收藏':'加入收藏夹'} aria-label={`${isFavorite(r)?'取消收藏':'收藏'}${r.title}`} onClick={()=>toggleFavorite(r,favoriteFolder||defaultFavoriteFolder)}><Star size={14} fill={isFavorite(r)?'currentColor':'none'}/></button><span><strong>{r.title}</strong><small>编号 {r.resource_id}</small>{r.case_link && /^https?:\/\//i.test(r.case_link) && <button className="media-text-action" onClick={()=>setBrowserUrl(r.case_link!)}>查看发布案例</button>}</span></div></td>
            {activeChannel==='news2'&&<><td>{r.details?.type||'未提供'}<small>{r.details?.platform||'未提供'}{r.details?.accountType?` · ${r.details.accountType}`:''}</small></td><td>{r.details?.category||'未提供'}<small>{r.details?.region||'未提供'}</small></td><td className="media-detail-lines">{news2DetailLines(r).map(line=><small key={line}>{line}</small>)}</td></>}
            {activeChannel==='news'&&<><td>{r.details?.industry||'未提供'}<small>{r.details?.platform||'未提供'}</small></td><td>{r.details?.region||'未提供'}<small>{r.details?.mediaType||r.details?.pageLevel||'未提供'}</small></td><td className="media-detail-lines">{newsDetailLines(r).map(line=><small key={line}>{line}</small>)}</td></>}
            {activeChannel==='social'&&<><td>{r.details?.platform||'未提供'}<small>{r.details?.industry||'未提供'}</small></td><td>{r.details?.verification||'未提供'} · {r.details?.mediaIdentity||'未提供'}</td><td className="media-detail-lines">{socialDetailLines(r).map(line=><small key={line}>{line}</small>)}</td></>}
            <td className="media-price">¥{Number(r.price).toFixed(2)}</td>
            <td><input className="media-quantity" type="number" min="0" max={publishSelection.length - assignedCount + assigned.length} step="1" aria-label={`${r.title}发布篇数`} value={assigned.length} onChange={e => setQuantity(r, Number(e.target.value))} /><button className="media-text-action" disabled={!assigned.length} onClick={() => setAllocationPreview(String(r.resource_id))}>查看文章</button></td>
            <td className="media-price">¥{(Math.round(Number(r.price) * 100) * assigned.length / 100).toFixed(2)}</td><td>{r.remarks || '暂无投稿要求'}</td>
          </tr>
        })}</tbody></table></div>
        {busy && <p role="status">正在读取媒体资源…</p>}
        {loaded && !filteredResources.length && !catalog?.sync?.syncing && <EmptyState title="没有匹配媒体" description="" />}
        <div className="media-pagination">
          <span>第 {page} 页{catalog&&` / 共 ${catalog.totalPages} 页`} · 本页 {resources.length} 家</span>
          <span>每页20家</span>
          <button disabled={busy||page===1} onClick={()=>void loadResources(1)}>首页</button>
          <button disabled={busy||page===1} onClick={()=>void loadResources(page-1)}>上一页</button>
          <button disabled={busy||(catalog?page>=catalog.totalPages:resources.length<pageSize)} onClick={()=>void loadResources(page+1)}>下一页</button>
          <button disabled={busy||!catalog?.totalPages||page===catalog.totalPages} onClick={()=>void loadResources(catalog!.totalPages)}>末页</button>
          <input aria-label="跳转页码" type="number" min="1" max={catalog?.totalPages||undefined} value={jump} onChange={e=>setJump(e.target.value)} />
          <button disabled={busy||!Number.isSafeInteger(Number(jump))||Number(jump)<1||(!!catalog&&Number(jump)>catalog.totalPages)} onClick={()=>void loadResources(Number(jump))}>跳转</button>
        </div>
        <footer className="media-order-bar"><div><strong>{allocations.filter(a => a.assigned.length).length} 家媒体 · {assignedCount} 篇投稿</strong><small>本次剩余 {publishSelection.length - assignedCount} 篇未分配</small></div><div className="media-order-total">预估合计 <b>¥{total.toFixed(2)}</b></div><button className="primary-button" disabled={!assignedCount || busy} onClick={() => void prepare()}>确认发布稿</button></footer>
      </section>}
    </div> : ['scheduled','executing','records'].includes(view)?renderPublishTasks():<section><PagedRows>{drafts.map(d => <article className="media-record" key={d.id}><strong>{d.articles.map(a => a.title).join('；')}</strong>{d.resources.map(r => { const quantity = d.allocations?.find(a => String(a.resourceId) === String(r.resource_id))?.articleIds.length ?? d.articles.length; return <p key={r.resource_id}>{r.title} · {quantity}篇 · ¥{(Math.round(Number(r.price) * 100) * quantity / 100).toFixed(2)}</p> })}<small>{new Date(d.createdAt).toLocaleString('zh-CN')} · {d.status}{!d.orders?.length ? ' · 未产生投稿订单' : ''}</small></article>)}</PagedRows>{!drafts.length && <EmptyState title="暂无发布记录" description="当前渠道还没有发布稿" />}</section>}
    {preview && <Modal title="发布副本预览与编辑" onClose={() => setPreview(null)} actions={<button className="primary-button" onClick={() => setPreview(null)}>完成</button>}><div className="media-editor"><label>标题<input value={edits[preview.id]?.title ?? preview.title} onChange={e => setEdits({ ...edits, [preview.id]: { title: e.target.value, body: edits[preview.id]?.body ?? preview.body ?? '' } })} /></label><label>正文<textarea value={edits[preview.id]?.body ?? preview.body} onChange={e => setEdits({ ...edits, [preview.id]: { title: edits[preview.id]?.title ?? preview.title, body: e.target.value } })} /></label><article className="article-content-view" dangerouslySetInnerHTML={{ __html: articleHtml(edits[preview.id]?.body ?? preview.body ?? '') }} /></div></Modal>}
    {allocationPreview && <Modal title="已分配文章" onClose={() => setAllocationPreview(null)} actions={<button className="primary-button" onClick={() => setAllocationPreview(null)}>完成</button>}><div className="media-editor">{allocations.find(a => String(a.resource.resource_id) === allocationPreview)?.assigned.map((a, i) => <p key={a.id}>{i + 1}. {edits[a.id]?.title || a.title}</p>)}</div></Modal>}
    {taskDetail && <Modal wide title="发布任务详情" onClose={() => setTaskDetail(null)} actions={<><button disabled={busy} onClick={()=>void refreshOrders()}><RefreshCw size={16}/>更新状态</button><button className="primary-button" onClick={() => setTaskDetail(null)}>关闭</button></>}><div className="media-editor">
      <div className="media-task-detail-meta">
        <div><span>任务状态</span><strong>{taskLabel(taskDetail)}</strong></div>
        <div><span>文章 / 媒体</span><strong>{taskDetail.articleCount}篇 / {taskDetail.mediaCount}家</strong></div>
        <div><span>成功 / 失败</span><strong>{taskDetail.success} / {taskDetail.failed}</strong></div>
        <div><span>费用</span><strong>¥{(taskDetail.totalCents/100).toFixed(2)}</strong></div>
      </div>
      <div className="media-table-scroll"><table className="media-record-table media-task-detail-table"><thead><tr><th>文章</th><th>媒体</th><th>费用</th><th>状态</th><th>后台反馈</th><th>操作</th></tr></thead><tbody>{taskDetail.rows.map(o=><tr key={o.id}>
        <td><strong>{o.title}</strong><small>{o.sourceTask}</small></td>
        <td>{o.mediaTitle}<small>{o.channel||'news'}</small></td>
        <td className="media-price">¥{(o.priceCents/100).toFixed(2)}</td>
        <td><span className={`media-state media-state-${o.state}`}>{stateLabel(o)}</span>{o.rejection&&<small>{o.rejection}</small>}</td>
        <td><span>{o.state==='scheduled'?'到点后自动执行':o.providerMessage||stateLabel(o)}</span>{o.orderId?<small>订单号：{o.orderId}</small>:o.state==='scheduled'?<small>预约发布不提前扣费</small>:<small>等待平台订单号</small>}{o.providerStatus!==undefined&&<small>平台状态码：{o.providerStatus}</small>}{o.checkedAt&&<small>最近同步：{new Date(o.checkedAt).toLocaleString('zh-CN')}</small>}</td>
        <td>{renderOrderActions(o,true)}</td>
      </tr>)}</tbody></table></div>
    </div></Modal>}
    {confirmation && <Modal title="确认发布稿" onClose={() => {if(!busy)setConfirmation(false)}} actions={<div className="media-confirm-actions">
      <div className="media-confirm-notice">
        {funding&&<p>本次 ¥{(funding.requiredCents/100).toFixed(2)} / {funding.requiredPublications}篇 · 可用 ¥{(funding.availableCents/100).toFixed(2)} / {funding.availablePublications}篇</p>}
        {(message||funding?.reason)&&<p role="alert">{message||funding?.reason}</p>}
      </div><div className="media-confirm-buttons">
      <button className="ghost-button" disabled={busy} onClick={() => setConfirmation(false)}>取消</button>
      {quote.length>0&&<button disabled={busy} onClick={()=>void checkFunding()}>刷新额度</button>}
      {!quote.length&&!quoting&&<button disabled={busy} onClick={()=>void prepare()}>重新核价</button>}
      <button className="primary-button" disabled={busy || !assignedCount || !quote.length || !funding || !!funding.reason} onClick={() => void save()}>{quoting?'正在核价…':busy?'正在提交…':publishMode==='scheduled'?'确认预约发布':'确认扣费并分发'}</button>
    </div></div>}><div className="media-editor">
      <p>{assignedCount} 篇投稿 · {allocations.filter(a => a.assigned.length).length} 家媒体</p>
      {quoting?<p role="status">正在核对媒体价格与投稿配图，请稍候…</p>:quote.length>0&&<p>{`确认费用：¥${(quote.reduce((s,o)=>s+o.priceCents,0)/100).toFixed(2)}；${publishMode==='scheduled'?'到点执行时检查额度':'同时预占 '+quote.length+' 篇发布额度'}。`}</p>}
      <section className="media-confirm-schedule">
        <div className="media-mode-toggle" role="group" aria-label="发布时间">
          <button type="button" aria-pressed={publishMode==='now'} onClick={()=>setPublishMode('now')}>立即发布</button>
          <button type="button" aria-pressed={publishMode==='scheduled'} onClick={()=>setPublishMode('scheduled')}>预约发布</button>
        </div>
        {publishMode==='scheduled'&&<div className="media-schedule-fields"><label>发布日期<input type="date" value={scheduledDate} onChange={e=>setScheduledDate(e.target.value)} /></label><label>发布时间<input type="time" value={scheduledTime} onChange={e=>setScheduledTime(e.target.value)} /></label></div>}
        <small>{publishMode==='scheduled'?'提交后进入预约发布，到点再扣费并执行。':'提交后进入执行发布，完成后进入成功发布。'} 发布失败会按同媒体换一篇内容补发一次，仍失败则记录失败。</small>
      </section>
      {allocations.filter(a => a.assigned.length).map(a => <section className="media-confirm-group" key={a.resource.resource_id}><h3>{a.resource.title} · {a.assigned.length}篇</h3>{a.assigned.map(article => <p key={article.id}>{edits[article.id]?.title || article.title}</p>)}</section>)}
    </div></Modal>}
    {browserUrl&&<Modal wide title="发布页面预览" onClose={()=>setBrowserUrl('')} actions={<><a href={browserUrl} target="_blank" rel="noopener noreferrer">独立窗口打开</a><button onClick={()=>setBrowserUrl('')}>关闭</button></>}><iframe title="媒体页面" src={browserUrl} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" style={{width:'100%',height:'65vh',border:0}}/><p>若媒体禁止嵌入，请使用独立窗口打开。</p></Modal>}
  </section>
}
