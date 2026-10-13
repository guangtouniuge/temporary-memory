import {useEffect,useRef,useState} from 'react'
import {ArrowLeft,Check,Copy,Download,ExternalLink,Globe,Monitor,Plus,RefreshCw,Send,Shuffle,X,ListChecks,Clock3,Trash2} from 'lucide-react'
import {PagedRows} from './PagedRows'
import './social-publisher.css'
import {readSocialWeb} from './social-web-reader'

type Platform={id:string;name:string;home:string;automatic:boolean}
type Account={id:string;platform:string;name:string;status:string;avatarUrl?:string;displayName?:string}
type Batch={id:string;name:string;planned:number;completed:number}
type Article={id:string;title:string;assigned:boolean}
type Row={id:string;articleId:string;title:string;accountId:string;accountName:string;platform:string;status:string;message:string}
type Task={id:string;createdAt:string;rows:Row[]}
type Snapshot={identity:string;brand:string;platforms:Platform[];accounts:Account[];batches:Batch[];tasks:Task[];offline?:boolean;offlineMessage?:string}
declare global {interface Window {geoSocialClient?:{request:(action:string,body?:unknown)=>Promise<{ok:boolean;value:any;error?:string}>}}}
const fallback:Platform[]=[['toutiao','头条号','https://mp.toutiao.com/'],['zhihu','知乎','https://www.zhihu.com/signin?next=%2Fcreator'],['douyin','抖音号','https://creator.douyin.com/'],['netease','网易号','https://mp.163.com/'],['baijia','百家号','https://baijiahao.baidu.com/builder/theme/bjh/login'],['penguin','企鹅号','https://om.qq.com/'],['wechat','公众号','https://mp.weixin.qq.com/'],['jianshu','简书','https://www.jianshu.com/sign_in'],['sohu','搜狐号','https://mp.sohu.com/']].map(([id,name,home])=>({id,name,home,automatic:false}))
const retryableMessagePattern=/未识别到平台编辑器|稿件已复制到剪贴板|图片|封面|上传|请重新上传|uri非法|确认|发布按钮|confirm-button|clipboard|writeImage/i
const activePublishStatuses=new Set(['submitting','prepared'])
const canRunRow=(row:{status:string;message?:string})=>['pending','blocked'].includes(row.status)||(row.status==='uncertain'&&retryableMessagePattern.test(row.message||''))
const statusNames:Record<string,string>={pending:'待执行',blocked:'待处理',submitting:'填稿中',prepared:'已填稿',uncertain:'需处理',review:'已发布',published:'已发布',cancelled:'已取消',failed:'失败'}
const clientDownloadUrl='/gongju/downloads/geo-social-publisher-client-v7-complete.zip'
export function SocialPublisher({brand,executionOnly=false}:{brand:string;executionOnly?:boolean}) {
  const native=window.geoSocialClient
  const webOnly=!native
  const [data,setData]=useState<Snapshot>({identity:'',brand,platforms:fallback,accounts:[],batches:[],tasks:[]})
  const [batchIds,setBatchIds]=useState<string[]>([]),[articles,setArticles]=useState<Article[]>([]),[articleIds,setArticleIds]=useState<string[]>([])
  const [counts,setCounts]=useState<Record<string,number>>({}),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [adding,setAdding]=useState(false),[platform,setPlatform]=useState('toutiao'),[name,setName]=useState('')
  const [browser,setBrowser]=useState(''),[browserInfo,setBrowserInfo]=useState({url:'',error:''}),[confirmTask,setConfirmTask]=useState<Task|null>(null)
  const [mode,setMode]=useState<'compose'|'queue'|'status'|'success'|'accounts'>(executionOnly?'queue':'compose')
  const [selectedRows,setSelectedRows]=useState<string[]>([])
  const viewport=useRef<HTMLDivElement>(null)
  const hydrated=useRef(false)
  const autoSelectedKey=useRef('')
  const [openedAccounts,setOpenedAccounts]=useState<string[]>([])
  async function request(action:string,body:Record<string,unknown>={}) {
    if(!native)return readSocialWeb(action,{brand,...body})
    const result=await native.request(action,{identity:data.identity,brand,...body})
    if(!result.ok)throw Error(result.error||'操作失败')
    return result.value
  }
  const load=async()=>{const value=await request('snapshot');setData({...value,platforms:value.platforms||fallback});if(!hydrated.current){hydrated.current=true;if(webOnly){setMode('compose');return}const tasks=value.tasks||[];const hasQueue=tasks.some((task:Task)=>task.rows.some(canRunRow));const hasSuccess=tasks.some((task:Task)=>task.rows.some(row=>['review','published'].includes(row.status)));setMode(hasQueue?'queue':hasSuccess?'success':executionOnly?'queue':'compose')}}
  const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}}
  useEffect(()=>{
    if(!/上一项操作|正在处理上一项/.test(error))return
    const timer=window.setTimeout(()=>void act(load),1800)
    return()=>window.clearTimeout(timer)
  },[error,brand,executionOnly])
  useEffect(()=>{setBrowser('');setOpenedAccounts([]);hydrated.current=false;setMode(executionOnly?'queue':'compose');void act(load);return()=>{void native?.request('closeBrowser')}},[brand,executionOnly])
  useEffect(()=>{
    if(!webOnly||executionOnly)return
    const timer=window.setInterval(()=>void load().catch(()=>undefined),12000)
    return()=>window.clearInterval(timer)
  },[webOnly,executionOnly,brand])
  useEffect(()=>{
    if(!browser||!viewport.current||!native)return
    const element=viewport.current
    const resize=()=>{const r=element.getBoundingClientRect();void native.request('viewport',{identity:data.identity,brand,id:browser,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}})}
    const observer=new ResizeObserver(resize);observer.observe(element);window.addEventListener('scroll',resize,true);window.addEventListener('resize',resize);resize()
    return()=>{observer.disconnect();window.removeEventListener('scroll',resize,true);window.removeEventListener('resize',resize);void native.request('closeBrowser')}
  },[browser,data.identity,brand])
  const toggle=(ids:string[],id:string)=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]
  const selectedAccounts=data.accounts.filter(a=>counts[a.id]>0),total=selectedAccounts.reduce((n,a)=>n+counts[a.id],0)
  const latestTask=data.tasks[0]
  const rows=data.tasks.flatMap(task=>task.rows.map(row=>({...row,taskId:task.id,createdAt:task.createdAt})))
  const pendingCount=rows.filter(canRunRow).length
  const runningCount=rows.filter(row=>activePublishStatuses.has(row.status)).length
  const reviewCount=rows.filter(row=>row.status==='review').length
  const publishedCount=rows.filter(row=>row.status==='published').length
  const unfinishedCount=rows.filter(canRunRow).length
  const statusClass=(status:string)=>['prepared','review','published'].includes(status)?'ok':['uncertain','blocked','failed'].includes(status)?'warn':''
  const accountAuthorized=(status:string)=>['verified','connected','authenticated','active','success','ok'].includes(status)
  const accountStatusLabel=(status:string)=>accountAuthorized(status)?'已授权':status==='blocked'?'需处理':'待授权'
  const accountStatusClass=(status:string)=>accountAuthorized(status)?'ok':status==='blocked'?'warn':''
  const canRun=(row:Row)=>canRunRow(row)
  const canPublish=(task:Task)=>task.rows.some(canRun)&&task.rows.filter(canRun).every(r=>data.platforms.find(p=>p.id===r.platform)?.automatic)
  const platformName=(id:string)=>data.platforms.find(p=>p.id===id)?.name||id
  const accountById=(id:string)=>data.accounts.find(account=>account.id===id)
  const displayAccountName=(account?:Account)=>account?.displayName||account?.name||'账号'
  const RowMeta=({row}:{row:Row})=><small>{platformName(row.platform)} · {row.accountName} · {row.message}</small>
  const AccountAvatar=({account,size='normal'}:{account?:Account;size?:'normal'|'small'})=><span className={`sp-avatar ${size==='small'?'small':''}`}>{account?.avatarUrl?<img src={account.avatarUrl} alt="账号头像"/>:<Globe size={size==='small'?18:21}/>}</span>
  const AccountIdentity=({account,detail}:{account?:Account;detail?:string})=><div className="sp-account-identity"><strong>{account?platformName(account.platform):'媒体账号'}</strong><small>{displayAccountName(account)}{detail?` · ${detail}`:''}</small></div>
  const queueTasks=data.tasks.filter(task=>task.rows.some(canRun))
  const successTasks=data.tasks.filter(task=>task.rows.some(row=>['review','published'].includes(row.status)))
  const taskAccountGroups=(task:Task,onlyRunnable=false)=>{
    const map=new Map<string,{id:string;name:string;platform:string;count:number}>()
    for(const row of task.rows.filter(row=>onlyRunnable?canRun(row):true)){
      const current=map.get(row.accountId)||{id:row.accountId,name:row.accountName,platform:row.platform,count:0}
      current.count+=1
      map.set(row.accountId,current)
    }
    return [...map.values()]
  }
  const taskRows=mode==='success'?successTasks:queueTasks
  const rowKey=(taskId:string,rowId:string)=>`${taskId}:${rowId}`
  const executableRows=queueTasks.flatMap(task=>task.rows.filter(canRun).map(row=>({task,row,key:rowKey(task.id,row.id)})))
  const statusTasks=data.tasks.filter(task=>task.rows.some(row=>activePublishStatuses.has(row.status)))
  const selectedExecutable=executableRows.filter(item=>selectedRows.includes(item.key))
  const executableKeyList=executableRows.map(item=>item.key).join('|')
  const executableAccounts=[...new Map(executableRows.map(item=>[item.row.accountId,{id:item.row.accountId,account:accountById(item.row.accountId),platform:item.row.platform,count:executableRows.filter(row=>row.row.accountId===item.row.accountId).length}])).values()]
  useEffect(()=>{
    if(!executionOnly||browser||!executableRows.length)return
    const keys=executableRows.map(item=>item.key)
    if(autoSelectedKey.current===executableKeyList)return
    setSelectedRows(current=>{
      const kept=current.filter(key=>keys.includes(key))
      autoSelectedKey.current=executableKeyList
      return kept.length?kept:keys
    })
  },[executionOnly,browser,executableKeyList])
  const setAccountRows=(accountId:string,checked:boolean)=>{
    const keys=executableRows.filter(item=>item.row.accountId===accountId).map(item=>item.key)
    setSelectedRows(current=>checked?[...new Set([...current,...keys])]:current.filter(key=>!keys.includes(key)))
  }
  const toggleRow=(key:string)=>setSelectedRows(rows=>rows.includes(key)?rows.filter(id=>id!==key):[...rows,key])
  const setAllExecutable=(checked:boolean)=>setSelectedRows(checked?executableRows.map(item=>item.key):[])
  const markRowsSubmitting=(items:{task:Task;row:Row}[])=>{
    const keys=new Set(items.map(item=>rowKey(item.task.id,item.row.id)))
    setData(current=>({...current,tasks:current.tasks.map(task=>({...task,rows:task.rows.map(row=>keys.has(rowKey(task.id,row.id))?{...row,status:'submitting',message:'等待后台执行'}:row)}))}))
  }
  async function publishSelectedRows() {
    const selected=[...selectedExecutable]
    const accountIds=[...new Set(selected.map(item=>item.row.accountId))]
    markRowsSubmitting(selected)
    setMode('status')
    for(const accountId of accountIds) {
      const account=accountById(accountId)
      const rowsForAccount=selected.filter(item=>item.row.accountId===accountId)
      setNotice(`正在后台使用${displayAccountName(account)}执行${rowsForAccount.length}篇选中稿件，当前页面会保持在执行台`)
      const grouped=new Map<string,string[]>()
      for(const item of rowsForAccount)grouped.set(item.task.id,[...(grouped.get(item.task.id)||[]),item.row.id])
      for(const [id,rowIds] of grouped)await request('publish',{id,rowIds,confirmed:true})
      await load()
    }
    setSelectedRows([])
    await request('closeBrowser').catch(()=>undefined)
    await load()
    setMode('success')
    setNotice(`发布动作已执行：${selected.length}篇，成功后会进入发布记录`)
  }
  async function testFillSelectedRows() {
    const grouped=new Map<string,string[]>()
    for(const item of selectedExecutable)grouped.set(item.task.id,[...(grouped.get(item.task.id)||[]),item.row.id])
    let filled=0,images=0
    for(const [id,rowIds] of grouped) {
      const value=await request('testFill',{id,rowIds})
      const results=Array.isArray(value.results)?value.results:[]
      filled+=results.length
      images+=results.reduce((n:any,row:any)=>n+Number(row.uploadedImages||0),0)
    }
    setNotice(`测试填稿完成：${filled}篇，图片/封面处理${images}张，尚未点击发布`)
    await load()
  }
  async function readSelection() {const value=await request('selection',{batchIds});setArticles(value.articles);setArticleIds(value.articles.filter((a:Article)=>!a.assigned).map((a:Article)=>a.id))}
  async function openAccount(id:string) {if(!native){setError('请在系统客户端内打开账号，浏览器网页版不能承载独立登录会话。');return}await request('openAccount',{id});setOpenedAccounts(ids=>ids.includes(id)?ids:[...ids,id]);setBrowser(id);setBrowserInfo(await request('browserStatus',{id}))}
  async function deleteAccount(id:string) {await request('deleteAccount',{id});setCounts(current=>{const next={...current};delete next[id];return next});await load()}
  async function finishAuthorization() {
    if(!browser)return
    const account=accountById(browser)
    const status=await request('confirmAuthorization',{id:browser})
    await load()
    showWorkspace()
    setNotice(status?.login==='connected'||status?.login==='verified'?`${displayAccountName(account)} 已授权并同步到线上`:'已返回客户端；暂未识别到授权成功，请确认平台页面已经登录')
  }
  function showWorkspace() {setBrowser('');void native?.request('closeBrowser')}
  if(executionOnly)return <section className="social-publisher" aria-label="发布执行客户端">
    <header className="sp-client-title"><div><h2>发布执行客户端</h2><span>{brand || '请选择品牌'} · 账号授权、待执行任务和发布记录</span></div></header>
    {error&&<div className="sp-error" role="alert">{error}</div>}{notice&&<div className="sp-notice" role="status"><Check size={16}/>{notice}</div>}
    <section className="sp-dashboard" aria-label="执行概况"><div className="sp-metric"><span>账号授权</span><strong>{data.accounts.length}</strong><small>客户端登录授权</small></div><div className="sp-metric"><span>待执行</span><strong>{executableRows.length}</strong><small>可选择后批量发布</small></div><div className="sp-metric"><span>发布状态</span><strong>{runningCount}</strong><small>正在执行</small></div><div className="sp-metric"><span>发布记录</span><strong>{reviewCount+publishedCount}</strong><small>发布成功{reviewCount+publishedCount}</small></div></section>
    {browser?<section className="sp-browser"><header><button title="返回执行台" aria-label="返回执行台" onClick={showWorkspace}><ArrowLeft size={17}/></button><strong>{data.accounts.find(a=>a.id===browser)?.name}</strong><span className="sp-address">{browserInfo.url}</span><div className="sp-browser-actions"><button className="primary-button" disabled={busy} onClick={()=>void act(finishAuthorization)}><Check size={15}/>授权完成，返回客户端</button><button disabled={busy} title="刷新平台页面" aria-label="刷新平台页面" onClick={()=>void act(async()=>{await request('reloadAccount',{id:browser});setBrowserInfo(await request('browserStatus',{id:browser}))})}><RefreshCw size={17}/></button></div></header><p className="sp-status">官方平台页面 · 本地独立会话 · 授权完成后请点击右上角按钮同步状态</p>{browserInfo.error&&<p role="alert">{browserInfo.error}</p>}<div ref={viewport} className="sp-native-viewport" aria-label="内置发布浏览器"/></section>:<>
      <nav className="sp-section-tabs" aria-label="执行流程"><button aria-current={mode==='queue'?'page':undefined} onClick={()=>setMode('queue')}><ListChecks size={15}/>待执行任务</button><button aria-current={mode==='status'?'page':undefined} onClick={()=>setMode('status')}><Clock3 size={15}/>发布状态</button><button aria-current={mode==='success'?'page':undefined} onClick={()=>setMode('success')}><Check size={15}/>发布记录</button><button aria-current={mode==='accounts'?'page':undefined} onClick={()=>setMode('accounts')}><Globe size={15}/>账号授权</button></nav>
      {mode==='queue'&&<section className="sp-tasks sp-panel"><header><div><h3>待执行任务</h3><span>{queueTasks.length}个任务 · {executableRows.length}篇可执行 · 已选{selectedExecutable.length}篇</span></div><div className="sp-current-actions"><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新任务</button><button disabled={!executableRows.length||busy} onClick={()=>setAllExecutable(selectedRows.length!==executableRows.length)}>全选待执行</button><button disabled={!selectedExecutable.length||busy} onClick={()=>void act(testFillSelectedRows)}>测试填稿</button><button className="primary-button" disabled={!selectedExecutable.length||busy||selectedExecutable.some(item=>!data.platforms.find(p=>p.id===item.row.platform)?.automatic)} onClick={()=>void act(publishSelectedRows)}><Send size={15}/>发布选中</button></div></header>{!!executableAccounts.length&&<div className="sp-queue-account-strip">{executableAccounts.map(group=><label key={group.id} className="sp-queue-account"><input type="checkbox" aria-label={'选择媒体：'+displayAccountName(group.account)} disabled={busy} checked={executableRows.filter(item=>item.row.accountId===group.id).every(item=>selectedRows.includes(item.key))} onChange={event=>setAccountRows(group.id,event.target.checked)}/><AccountAvatar account={group.account} size="small"/><span><strong>{platformName(group.platform)}</strong><small>{displayAccountName(group.account)} · {group.count}篇待发</small></span><button type="button" disabled={busy} onClick={event=>{event.preventDefault();void act(()=>openAccount(group.id))}}>打开<ExternalLink size={12}/></button></label>)}</div>}<PagedRows>{queueTasks.map(task=><details className="sp-task sp-task-exec" key={task.id} open><summary><strong><Clock3 size={15}/>{new Date(task.createdAt).toLocaleString('zh-CN')}</strong><div className="sp-task-account-summary"><button className="danger-button" disabled={busy||!task.rows.some(r=>['pending','blocked','failed'].includes(r.status))} onClick={event=>{event.preventDefault();event.stopPropagation();void act(async()=>{await request('cancel',{id:task.id});await load()})}}><Trash2 size={14}/>删除待执行</button></div></summary><PagedRows>{task.rows.filter(canRun).map(row=>{const key=rowKey(task.id,row.id);return <div className="sp-exec-row" key={row.id}><input type="checkbox" aria-label={'选择发布：'+row.title} checked={selectedRows.includes(key)} onChange={()=>toggleRow(key)}/><span className={`sp-row-state ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><span className="sp-row-title"><strong>{row.title}</strong><RowMeta row={row}/></span></div>})}</PagedRows></details>)}</PagedRows>{!queueTasks.length&&<p className="sp-empty">暂无待执行任务，请先在线上保存投喂任务。</p>}</section>}
      {mode==='status'&&<section className="sp-tasks sp-panel"><header><div><h3>发布状态</h3><span>正在执行的任务 · {statusTasks.length}个任务</span></div><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新状态</button></header><PagedRows>{statusTasks.map(task=><details className="sp-task" key={task.id} open><summary><strong><Clock3 size={15}/>{new Date(task.createdAt).toLocaleString('zh-CN')}</strong><span>{task.rows.filter(row=>activePublishStatuses.has(row.status)).length}篇执行中</span></summary><PagedRows>{task.rows.filter(row=>activePublishStatuses.has(row.status)).map(row=><div className="sp-result" key={row.id}><span className={`sp-status-pill ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><span><strong>{row.title}</strong><RowMeta row={row}/></span><button disabled={busy} onClick={()=>void act(async()=>{await request('copyArticle',{taskId:task.id,rowId:row.id});setNotice('标题和正文已复制')})}><Copy size={16}/></button><button disabled={busy} onClick={()=>void act(()=>openAccount(row.accountId))}><ExternalLink size={16}/></button></div>)}</PagedRows></details>)}</PagedRows>{!statusTasks.length&&<p className="sp-empty">暂无执行中任务</p>}</section>}
      {mode==='success'&&<section className="sp-tasks sp-panel"><header><div><h3>发布记录</h3><span>已发布成功的文章 · {successTasks.length}个任务</span></div><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新状态</button></header><PagedRows>{successTasks.map(task=><details className="sp-task" key={task.id} open><summary><strong><Clock3 size={15}/>{new Date(task.createdAt).toLocaleString('zh-CN')}</strong><span>发布成功{task.rows.filter(r=>['review','published'].includes(r.status)).length}</span></summary><PagedRows>{task.rows.filter(row=>['review','published'].includes(row.status)).map(row=><div className="sp-result" key={row.id}><span className={`sp-status-pill ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><span><strong>{row.title}</strong><RowMeta row={row}/></span></div>)}</PagedRows></details>)}</PagedRows>{!successTasks.length&&<p className="sp-empty">暂无发布记录</p>}</section>}
      {mode==='accounts'&&<section className="sp-account-board"><header><div><h3>账号授权</h3><span>在客户端添加账号并扫码登录，本地保存独立授权会话。</span></div><div className="sp-current-actions"><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新账号</button><button className="primary-button" disabled={busy} onClick={()=>setAdding(true)}><Plus size={16}/>添加授权账号</button></div></header><div className="sp-platforms">{data.platforms.map(p=><button key={p.id} disabled={busy} title={'添加'+p.name+'授权'} onClick={()=>{setPlatform(p.id);setAdding(true)}}>{p.name}</button>)}</div><div className="sp-account-grid">{data.accounts.map(account=><article className="sp-account-card" key={account.id}><div className="sp-account-card-head"><AccountAvatar account={account}/><AccountIdentity account={account}/><span className={`sp-account-state ${accountStatusClass(account.status)}`}>{accountStatusLabel(account.status)}</span></div><div className="sp-account-meta"><span>{account.avatarUrl?'头像已同步':'待同步头像'}</span><span>发布时使用此账号</span></div><div className="sp-account-card-actions"><button disabled={busy} onClick={()=>void act(()=>openAccount(account.id))}>打开账号授权<ExternalLink size={13}/></button><button className="danger-button" disabled={busy} title="删除本地账号授权" onClick={()=>void act(async()=>{await request('deleteAccount',{id:account.id});await load()})}><Trash2 size={14}/>删除</button></div></article>)}</div>{!data.accounts.length&&<p className="sp-empty">请先在客户端添加要授权的平台账号。</p>}</section>}
    </>}
    {adding&&<div className="sp-overlay"><form className="sp-dialog" onSubmit={e=>{e.preventDefault();void act(async()=>{const account=await request('addAccount',{platform,name});setAdding(false);setName('');await load();await openAccount(account.id);setMode('accounts')})}}><header><h3>添加授权账号</h3><button type="button" aria-label="关闭" title="关闭" onClick={()=>setAdding(false)}><X size={18}/></button></header><label>平台<select value={platform} onChange={e=>setPlatform(e.target.value)}>{data.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>账号备注<input required maxLength={60} value={name} placeholder="例如：曝光率GEO头条号" onChange={e=>setName(e.target.value)}/></label><button className="primary-button" disabled={busy||!name.trim()}>添加并打开扫码登录</button></form></div>}
  </section>
  return <section className="social-publisher" aria-label="自媒体账号发布">
    {!webOnly&&<header className="sp-hero">
      <div>
        <span className="sp-kicker">PUBLISH WORKSPACE</span>
        <h2>{executionOnly?'发布执行客户端':webOnly?'自有媒体投喂':'自媒体发布工作台'}</h2>
        <p>{executionOnly?'只执行线上已保存的投喂任务：登录账号、自动发布、回写状态。':webOnly?'选择文章任务、投喂账号和篇数，保存后由本地客户端执行发布。':'选文章、分账号、执行发布、核对回执，全部在本地客户端完成。'}</p>
      </div>
      <div className="sp-hero-actions">
        <span>{brand||'未选择品牌'}</span>
        {webOnly&&<a className="sp-download-link" href={clientDownloadUrl} target="_blank" rel="noopener noreferrer" download><Download size={16}/>下载客户端</a>}
        <button disabled={busy} title="刷新任务与账号" aria-label="刷新任务与账号" onClick={()=>void act(load)}><RefreshCw size={17}/>刷新</button>
      </div>
    </header>}
    {webOnly&&<header className="sp-plain-heading"><div><h2>自有媒体投喂</h2><p>选择文章任务、投喂账号和篇数，保存后由本地客户端执行发布。</p></div><button disabled={busy} title="刷新任务与账号" aria-label="刷新任务与账号" onClick={()=>void act(load)}><RefreshCw size={17}/>刷新</button></header>}
      {!native&&<div className="sp-notice" role="status"><Monitor size={19}/><span>线上后台只保存投喂任务；请下载客户端完成账号授权和发布执行。客户端授权后，账号状态、头像和发布回执会自动同步到这里。</span></div>}
    {data.offline&&<div className="sp-error" role="status">{data.offlineMessage||'服务器暂不可用，已显示本地保存内容'}</div>}
    {error&&<div className="sp-error" role="alert">{error}</div>}{notice&&<div className="sp-notice" role="status"><Check size={16}/>{notice}</div>}
    {!webOnly&&<section className="sp-dashboard" aria-label="发布概况">
      <div className="sp-metric"><span>账号</span><strong>{data.accounts.length}</strong><small>已接入账号 · 本次选中{selectedAccounts.length}</small></div>
      <div className="sp-metric"><span>{executionOnly?'待执行':'待发布'}</span><strong>{executionOnly?unfinishedCount:pendingCount}</strong><small>{executionOnly?'可选择后执行':'可继续执行的文章'}</small></div>
      <div className="sp-metric"><span>发布状态</span><strong>{runningCount}</strong><small>正在执行</small></div>
      <div className="sp-metric"><span>发布记录</span><strong>{reviewCount+publishedCount}</strong><small>发布成功{reviewCount+publishedCount}</small></div>
    </section>}
    {executionOnly&&<section className="sp-execution-board" aria-label="待执行任务">
      <header><div><h3>待执行任务</h3><span>{queueTasks.length}个任务 · {unfinishedCount}篇未完成</span></div><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新状态</button></header>
      {queueTasks.length?<div className="sp-execution-list">{queueTasks.map(task=><article className="sp-execution-task" key={task.id}>
        <div className="sp-execution-task-head"><div><strong>{new Date(task.createdAt).toLocaleString('zh-CN')}</strong><small>{task.rows.filter(canRun).length}篇待执行</small></div><div className="sp-execution-actions"><button disabled={busy||!canPublish(task)} onClick={()=>setConfirmTask(task)}><Send size={15}/>一键发布</button><button disabled={busy||!task.rows.some(r=>['pending','blocked','failed'].includes(r.status))} onClick={()=>void act(async()=>{await request('cancel',{id:task.id});await load()})}>取消待执行</button></div></div>
        {task.rows.filter(canRun).map(row=><div className="sp-execution-row" key={row.id}><span className={`sp-status-pill ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><div><strong>{row.title}</strong><RowMeta row={row}/></div><button title="复制文章" aria-label={'复制文章：'+row.title} disabled={busy} onClick={()=>void act(async()=>{await request('copyArticle',{taskId:task.id,rowId:row.id});setNotice('标题和正文已复制')})}><Copy size={15}/>复制</button><button title="打开账号发布浏览器" aria-label={'打开账号：'+row.accountName} disabled={busy} onClick={()=>void act(()=>openAccount(row.accountId))}><ExternalLink size={15}/>打开账号</button></div>)}
      </article>)}</div>:<p className="sp-empty">原平台暂无待执行任务；请先在原平台创建发布任务。</p>}
    </section>}
    {!webOnly&&!executionOnly&&latestTask&&<section className="sp-current-task" aria-label="最新发布任务">
      <header><div><h3>{webOnly?'最新投喂任务':'最新发布任务'}</h3><span>{new Date(latestTask.createdAt).toLocaleString('zh-CN')} · 共{latestTask.rows.length}篇</span></div><div className="sp-current-actions">{native&&<button disabled={busy||!canPublish(latestTask)} onClick={()=>setConfirmTask(latestTask)}><Send size={15}/>继续发布</button>}<button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新状态</button></div></header>
      <div className="sp-current-rows">{latestTask.rows.map(row=><div className="sp-current-row" key={row.id}><span className={`sp-status-pill ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><div><strong>{row.title}</strong>{webOnly?<small>{platformName(row.platform)} · {row.accountName} · 后台任务已保存，需在客户端执行</small>:<RowMeta row={row}/>}</div>{native&&<button title="复制文章" aria-label={'复制文章：'+row.title} disabled={busy} onClick={()=>void act(async()=>{await request('copyArticle',{taskId:latestTask.id,rowId:row.id});setNotice('标题和正文已复制；可以到平台发布页粘贴')})}><Copy size={15}/>复制</button>}{native&&<button title="打开账号发布浏览器" aria-label={'打开账号：'+row.accountName} disabled={busy} onClick={()=>void act(()=>openAccount(row.accountId))}><ExternalLink size={15}/>打开账号</button>}</div>)}</div>
    </section>}
    {!webOnly&&!browser&&<nav className="sp-section-tabs" aria-label="发布流程">
      {!executionOnly&&<button aria-current={mode==='compose'?'page':undefined} onClick={()=>setMode('compose')}><Shuffle size={15}/>批量分配</button>}
      <button aria-current={mode==='queue'?'page':undefined} onClick={()=>setMode('queue')}><ListChecks size={15}/>发布列表</button>
      <button aria-current={mode==='success'?'page':undefined} onClick={()=>setMode('success')}><Check size={15}/>发布记录</button>
      <button aria-current={mode==='accounts'?'page':undefined} onClick={()=>setMode('accounts')}><Globe size={15}/>账号状态</button>
    </nav>}
    {native&&<nav className="sp-browser-tabs" aria-label="发布工作区"><button aria-current={!browser?'page':undefined} onClick={showWorkspace}>发布工作台</button>{openedAccounts.map(id=><button key={id} disabled={busy} aria-current={browser===id?'page':undefined} onClick={()=>void act(()=>openAccount(id))}>{data.accounts.find(a=>a.id===id)?.name||'账号'}</button>)}</nav>}
    {browser?<section className="sp-browser">
      <header><button title="返回发布工作台" aria-label="返回发布工作台" onClick={showWorkspace}><ArrowLeft size={17}/></button><strong>{data.accounts.find(a=>a.id===browser)?.name}</strong><span className="sp-address">{browserInfo.url}</span><div className="sp-browser-actions"><button className="primary-button" disabled={busy} onClick={()=>void act(finishAuthorization)}><Check size={15}/>授权完成，返回客户端</button><button disabled={busy} title="刷新平台页面" aria-label="刷新平台页面" onClick={()=>void act(async()=>{await request('reloadAccount',{id:browser});setBrowserInfo(await request('browserStatus',{id:browser}))})}><RefreshCw size={17}/></button></div></header>
      <p className="sp-status">官方平台页面 · 本地独立会话 · 授权完成后请点击右上角按钮同步状态</p>
      {browserInfo.error&&<p role="alert">{browserInfo.error}</p>}
      <div ref={viewport} className="sp-native-viewport" aria-label="内置发布浏览器"/>
    </section>:<>
      {!executionOnly&&mode==='compose'&&<>
      <div className="sp-columns">
        <section className="sp-column"><header><h3>任务批次</h3><span>{batchIds.length}个已选</span></header>
          <div className="sp-batches"><PagedRows>{data.batches.map(batch=><label className="sp-batch" key={batch.id}><input type="checkbox" disabled={busy} checked={batchIds.includes(batch.id)} aria-label={'选择批次：'+batch.name} onChange={()=>{setBatchIds(toggle(batchIds,batch.id));setArticles([]);setArticleIds([])}}/><span><strong>{batch.name}</strong><small>计划{batch.planned}篇 · 已生成{batch.completed}篇</small></span></label>)}</PagedRows>{!data.batches.length&&<p className="sp-empty">暂无生成任务</p>}</div>
          <div className="sp-inline"><button disabled={!batchIds.length||busy} onClick={()=>void act(readSelection)}>读取所选文章</button><span>{articles.length}篇 · 可分配{articles.filter(a=>!a.assigned).length}篇</span></div>
          {!!articles.length&&<div className="sp-articles"><label className="sp-select-all"><input type="checkbox" aria-label="选择全部可用文章" checked={articleIds.length>0&&articleIds.length===articles.filter(a=>!a.assigned).length} onChange={e=>setArticleIds(e.target.checked?articles.filter(a=>!a.assigned).map(a=>a.id):[])}/>全部可用文章</label><PagedRows>{articles.map(a=><label className="sp-article" key={a.id}><input type="checkbox" disabled={a.assigned||busy} checked={articleIds.includes(a.id)} onChange={()=>setArticleIds(toggle(articleIds,a.id))}/><span>{a.title}</span>{a.assigned&&<small>已分配</small>}</label>)}</PagedRows></div>}
        </section>
        <section className="sp-column"><header><h3>{webOnly?'投喂账号':'发布账号'}</h3>{webOnly?<div className="sp-current-actions"><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新同步</button><a className="sp-small-download" href={clientDownloadUrl} target="_blank" rel="noopener noreferrer" download><Download size={15}/>下载客户端</a></div>:<button disabled={busy} onClick={()=>setAdding(true)}><Plus size={16}/>添加账号</button>}</header>
          {webOnly?<div className="sp-client-sync-tip"><strong>账号从客户端同步</strong><span>在客户端添加并扫码授权后，右侧会自动出现媒体号、头像、授权状态和可投喂篇数。</span></div>:<div className="sp-platforms">{data.platforms.map(p=><button key={p.id} disabled={busy} title={'添加'+p.name+'账号'} onClick={()=>{setPlatform(p.id);setAdding(true)}}>{p.name}</button>)}</div>}
          <PagedRows>{data.accounts.map(a=><div className="sp-account" key={a.id}><input type="checkbox" aria-label={'选择账号：'+a.name} disabled={busy} checked={Boolean(counts[a.id])} onChange={e=>setCounts({...counts,[a.id]:e.target.checked?1:0})}/><AccountAvatar account={a}/><div className="sp-account-main"><AccountIdentity account={a} detail={webOnly?'投喂账号':'本地独立会话'}/>{native&&<button className="sp-link" disabled={busy} onClick={()=>void act(()=>openAccount(a.id))}>打开登录 / 发布浏览器<ExternalLink size={13}/></button>}</div><label className="sp-count">{webOnly?'投喂篇数':'发布篇数'}<input type="number" aria-label={a.name+(webOnly?'投喂篇数':'发布篇数')} min="1" max="200" disabled={!counts[a.id]||busy} value={counts[a.id]||1} onChange={e=>setCounts({...counts,[a.id]:Number(e.target.value)})}/></label><button className="danger-button sp-icon-button" disabled={busy} title="删除投喂账号" aria-label={'删除账号：'+displayAccountName(a)} onClick={()=>void act(()=>deleteAccount(a.id))}><Trash2 size={15}/></button></div>)}</PagedRows>
          {!data.accounts.length&&<p className="sp-empty">{webOnly?'尚未同步客户端授权账号，请先下载客户端添加并登录账号。':'尚未添加发布账号'}</p>}
        </section>
      </div>
      <footer className="sp-allocation"><span>已选<strong>{articleIds.length}</strong>篇 · <strong>{selectedAccounts.length}</strong>个账号 · 分配<strong>{total}</strong>篇</span><div><button disabled={!selectedAccounts.length||!articleIds.length||busy} title="平均分配文章" onClick={()=>{if(articleIds.length<selectedAccounts.length){setError('文章数少于账号数');return}setCounts(Object.fromEntries(selectedAccounts.map((a,i)=>[a.id,Math.floor(articleIds.length/selectedAccounts.length)+(i<articleIds.length%selectedAccounts.length?1:0)])))}}><Shuffle size={16}/>平均分配</button><button className="primary-button" disabled={!articleIds.length||!total||total>articleIds.length||busy} onClick={()=>void act(async()=>{await request('plan',{batchIds,articleIds,targets:selectedAccounts.map(a=>({id:a.id,count:counts[a.id]}))});await load();await readSelection();setMode(webOnly?'compose':'queue');setNotice(webOnly?'投喂任务已保存，请打开本地客户端执行发布':'分配任务已保存')})}>{webOnly?'保存投喂任务':'保存分配'}</button></div></footer>
      </>}
      {!webOnly&&mode==='accounts'&&<section className="sp-account-board" aria-label="账号与默认设置">
        <header><div><h3>账号与默认设置</h3><span>先确认账号已登录，再执行队列填稿。每个账号使用独立本地会话。</span></div><button disabled={busy} onClick={()=>setAdding(true)}><Plus size={16}/>添加账号</button></header>
        <div className="sp-platforms">{data.platforms.map(p=><button key={p.id} disabled={busy} title={'添加'+p.name+'账号'} onClick={()=>{setPlatform(p.id);setAdding(true)}}>{p.name}</button>)}</div>
        <div className="sp-account-grid">{data.accounts.map(a=><article className="sp-account-card" key={a.id}>
          <div className="sp-account-card-head"><AccountAvatar account={a}/><AccountIdentity account={a} detail={accountStatusLabel(a.status)}/><span className={`sp-account-state ${accountStatusClass(a.status)}`}>{accountStatusLabel(a.status)}</span></div>
          <div className="sp-account-setting"><span>默认发布篇数</span><input type="number" min="1" max="200" value={counts[a.id]||1} onChange={e=>setCounts({...counts,[a.id]:Number(e.target.value)})}/></div>
          <div className="sp-account-card-actions">{native&&<button disabled={busy} onClick={()=>void act(()=>openAccount(a.id))}>打开登录 / 发布浏览器<ExternalLink size={13}/></button>}<button disabled={busy} onClick={()=>setMode('compose')}>去分配文章</button><button className="danger-button" disabled={busy} onClick={()=>void act(()=>deleteAccount(a.id))}><Trash2 size={14}/>删除</button></div>
        </article>)}</div>
        {!data.accounts.length&&<p className="sp-empty">尚未添加发布账号</p>}
      </section>}
      {!webOnly&&(mode==='queue'||mode==='success')&&<section className="sp-tasks sp-panel"><header><div><h3>{mode==='queue'?'发布列表':'发布记录'}</h3><span>{mode==='queue'?'待执行任务':'已发布成功的文章'} · {taskRows.length}个任务</span></div><button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={15}/>刷新状态</button></header>{mode==='queue'&&<div className="sp-queue-account-strip">{data.accounts.map(a=><label key={a.id} className="sp-queue-account"><input type="checkbox" aria-label={'选择账号：'+a.name} disabled={busy} checked={Boolean(counts[a.id])} onChange={e=>setCounts({...counts,[a.id]:e.target.checked?1:0})}/><AccountAvatar account={a} size="small"/><span><strong>{platformName(a.platform)}</strong><small>{displayAccountName(a)} · {accountStatusLabel(a.status)}</small></span>{native&&<button disabled={busy} onClick={()=>void act(()=>openAccount(a.id))}>打开账号<ExternalLink size={13}/></button>}</label>)}</div>}<PagedRows>{taskRows.map(task=><details className="sp-task" key={task.id} open><summary><strong><Clock3 size={15}/>{new Date(task.createdAt).toLocaleString('zh-CN')}</strong><span>{mode==='queue'?`${task.rows.filter(canRun).length}篇待执行`:`发布成功${task.rows.filter(r=>['review','published'].includes(r.status)).length}`}</span></summary>{mode==='queue'&&<div className="sp-task-actions"><span>{canPublish(task)?'已具备自动执行条件':'请先登录账号，或处理需处理原因'}</span>{native&&<button disabled={busy||!canPublish(task)} onClick={()=>setConfirmTask(task)}><Send size={15}/>一键发布</button>}{native&&<button disabled={busy||!task.rows.some(r=>['pending','blocked','failed'].includes(r.status))} onClick={()=>void act(async()=>{await request('cancel',{id:task.id});await load();if(batchIds.length)await readSelection()})}>取消待执行</button>}</div>}<PagedRows>{task.rows.filter(row=>mode==='queue'?canRun(row):['review','published'].includes(row.status)).map(row=><div className="sp-result" key={row.id}><span className={`sp-status-pill ${statusClass(row.status)}`}>{statusNames[row.status]||row.status}</span><span><strong>{row.title}</strong><RowMeta row={row}/></span>{native&&<button title="复制文章" aria-label={'复制文章：'+row.title} disabled={busy} onClick={()=>void act(async()=>{await request('copyArticle',{taskId:task.id,rowId:row.id});setNotice('标题和正文已复制')})}><Copy size={16}/></button>}{native&&<button title="打开账号发布浏览器" aria-label={'打开账号：'+row.accountName} disabled={busy} onClick={()=>void act(()=>openAccount(row.accountId))}><ExternalLink size={16}/></button>}</div>)}</PagedRows></details>)}</PagedRows>{!taskRows.length&&<p className="sp-empty">{mode==='queue'?'暂无待发布任务':'暂无发布记录'}</p>}</section>}
    </>}
    {adding&&<div className="sp-overlay"><form className="sp-dialog" onSubmit={e=>{e.preventDefault();void act(async()=>{const account=await request('addAccount',{platform,name});setAdding(false);setName('');await load();if(native)await openAccount(account.id);else setNotice('账号已保存，尚未登录。扫码会话和自动发布需客户端接入。')})}}><header><h3>添加发布账号</h3><button type="button" aria-label="关闭" title="关闭" onClick={()=>setAdding(false)}><X size={18}/></button></header><label>平台<select value={platform} onChange={e=>setPlatform(e.target.value)}>{data.platforms.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>账号备注<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label><button className="primary-button" disabled={busy||!name.trim()}>{native?'添加并打开登录':'保存账号'}</button></form></div>}
      {confirmTask&&<div className="sp-overlay"><section className="sp-dialog"><h3>确认发布</h3><p>将把{confirmTask.rows.filter(canRun).length}篇文章填入发布页，自动上传正文图并生成封面，然后点击平台发布按钮。执行中请不要切换账号窗口。</p><button onClick={()=>setConfirmTask(null)}>取消</button><button className="primary-button" disabled={busy} onClick={()=>void act(async()=>{await request('publish',{id:confirmTask.id,confirmed:true});setConfirmTask(null);await load();setNotice('已执行自动发布，成功后会进入发布记录')})}>确认发布</button></section></div>}
  </section>
}

