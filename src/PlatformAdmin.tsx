import {PagedRows} from './PagedRows'
import { useEffect, useState } from 'react'
import { Settings, RefreshCw, SlidersHorizontal, Plus, History } from 'lucide-react'
import { accountRequest, EnterAccount, AccountActions, AccountRecycleBin, Modal, type AccountUser } from './console-ui'
import './platform-admin.css'
import { InitialPackage } from './MemberPackages'
import {MemberQuotaEditor,type QuotaMember} from './MemberQuotaEditor'

type Policy = { limits: Record<string, number | null>; mediaMarkup: number; modelMode: string; providerMode: string; keywordMode?: string; imageMode?: string; xiaoqingwaMode?: string; manualCheck: boolean; expiresAt: string; notes: string }
type Application = { id: string; projectId: string; company: string; administrator: string; status: string; submittedAt: string; reason?: string }
type Pricing = { mediaMarkup: Record<string, number>; articlePointCost: number; publicationPointCost: number }
type State = { revision: number; settings: { siteName: string; filing: string; seoTitle: string; seoKeywords: string; seoDescription: string; retentionDays: number | null; taskSize: number | null }; rates: { key: string; currency: string; amount: number }[]; pricing: Pricing; policies: Record<string, Policy>; applications: Application[]; audit: { id: string; action: string; target: string; at: string }[] }
const limits: Record<string, string> = { agents: '可开代理数', projects: '可开企业项目数', storageMB: '存储空间（MB）', publishingAccounts: '投喂账号数', keywords: '主词数量', questionsPerKeyword: '每个主词的问题数量', articles: '创作篇数', publications: '发布篇数', verificationCalls: '实名接口次数' }
const rateLabels: Record<string, string> = { distill: 'AI蒸馏 / 次', write: '文章创作 / 篇', publish: '文章投喂 / 篇', research: '联网资料查询 / 次', diagnose: 'AI诊断 / 次', video: '视频发布 / 条' }
const mediaMarkupLabels: Record<string, string> = { news: '补充媒体投喂（小青蛙）', news2: '核心媒体投喂（媒体采购网）', social: '自有媒体资源库', b2b: 'B2B媒体资源' }
const emptyPolicy = (): Policy => ({ limits: Object.fromEntries(Object.keys(limits).map(k => [k, null])), mediaMarkup: 1, modelMode: 'inherit', providerMode: 'inherit', keywordMode: 'inherit', imageMode: 'inherit', xiaoqingwaMode: 'inherit', manualCheck: false, expiresAt: '', notes: '' })

export function PlatformAdmin({ page, onModel }: { page: 'settings' | 'agencies' | 'enterprises' | 'verification'; onModel: () => void }) {
  const [data, setData] = useState<State | null>(null)
  const [users, setUsers] = useState<AccountUser[]>([])
  const [members,setMembers]=useState<QuotaMember[]>([])
  const [tab, setTab] = useState('base')
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('')
  const [status, setStatus] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<AccountUser | null>(null)
  const [policy, setPolicy] = useState<Policy>(emptyPolicy)
  const [editTab, setEditTab] = useState('base')
  const [creating, setCreating] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', displayName: '', agentId: '' })
  const [history, setHistory] = useState(false)
  const [review, setReview] = useState<Application | null>(null)
  const [reason, setReason] = useState('')
  const load = async () => {
    const d = await accountRequest<State>('/api/admin/platform')
    const u = await accountRequest<{ users: AccountUser[] }>('/api/admin/users')
    setData(d); setUsers(u.users)
    if(page==='agencies'||page==='enterprises')setMembers((await accountRequest<{members:QuotaMember[]}>('/api/admin/members')).members||[])
  }
  useEffect(() => { void load().catch(e => setMessage(e.message)) }, [])
  const act = async (run: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await run() } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }
  const save = (suffix: string, body: object) => act(async () => {
    setData(await accountRequest<State>(`/api/admin/platform/${suffix}`, { ...body, revision: data?.revision }))
    setEditing(null); setMessage('配置已保存'); await load()
  })
  const titles = { settings: '系统配置', agencies: '代理管理', enterprises: '企业管理', verification: '实名审核' }
  const openEdit = (u: AccountUser) => { setEditing({ ...u }); setPolicy(data?.policies[u.id] || emptyPolicy()); setEditTab('base') }
  const accounts = users.filter(u => page === 'agencies' ? u.role === 'agent' : u.role === 'project_admin')
    .filter(u => (!query || `${u.displayName} ${u.username} ${u.projectName}`.includes(query)) && (!agent || u.agentId === agent) && (!status || u.status === status))
  const agencies = users.filter(u => u.role === 'agent')
  const shownLimit = (u: AccountUser, key: string) => members.find(m=>m.id===u.id)?.resources[key]?.available??'加载中'
  return <section className="platform-admin">
    <header className="pa-heading"><h2>{titles[page]}</h2><div>{['agencies', 'enterprises'].includes(page) && <AccountRecycleBin onChange={load}/>}<button title="刷新" aria-label="刷新管理数据" disabled={busy} onClick={() => void load().catch(e => setMessage(e.message))}><RefreshCw size={16}/></button><button className="ghost-button" onClick={() => setHistory(true)}><History size={16}/>配置记录</button>{['agencies', 'enterprises'].includes(page) && <button className="primary-button" onClick={() => { setNewUser({ username: '', password: '', displayName: '', agentId: '' }); setCreating(true) }}><Plus size={16}/>{page === 'agencies' ? '添加代理' : '添加企业'}</button>}</div></header>
    {message && <p role="status" className="pa-notice">{message}</p>}
    {!data ? <p>正在加载管理数据…</p> : page === 'settings' ? <>
      <nav className="pa-tabs">{[['base','基础配置'],['pricing','价格调控'],['rates','功能计费'],['connections','平台接口']].map(([id,label]) => <button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
      {tab === 'base' && <form className="pa-form" onSubmit={e => { e.preventDefault(); void save('settings', { settings: data.settings }) }}>
        {([['siteName','站点名称'],['filing','备案信息'],['seoTitle','网站SEO标题'],['seoKeywords','网站SEO关键词'],['seoDescription','网站SEO描述']] as const).map(([k,label]) => <label key={k}>{label}<input value={data.settings[k]} onChange={e => setData({ ...data, settings: { ...data.settings, [k]: e.target.value } })}/></label>)}
        <label>单任务篇数配置<input type="number" min="0" value={data.settings.taskSize ?? ''} onChange={e => setData({ ...data, settings: { ...data.settings, taskSize: e.target.value === '' ? null : Number(e.target.value) } })}/></label>
        <label>文章保留天数<input type="number" min="0" placeholder="永久保留" value={data.settings.retentionDays ?? ''} onChange={e => setData({ ...data, settings: { ...data.settings, retentionDays: e.target.value === '' ? null : Number(e.target.value) } })}/></label>
        <p className="pa-notice">参数登记阶段：尚未启用自动清理或任务限额，不影响现有文章。</p><button className="primary-button" disabled={busy}>保存基础配置</button>
      </form>}
      {tab === 'rates' && <><p className="pa-notice">计费标准待启用 · 保存不会扣点或扣款</p><div className="pa-scroll"><table><thead><tr><th>功能 / 单位</th><th>计费资源</th><th>单价</th></tr></thead><tbody><PagedRows table>{Object.entries(rateLabels).map(([key,label]) => {
        const rate = data.rates.find(r=>r.key===key) || { key, currency: 'points', amount: 0 }
        const update = (changes: object) => setData({ ...data, rates: [...data.rates.filter(r=>r.key!==key), { ...rate, ...changes }] })
        return <tr key={key}><td>{label}</td><td><select aria-label={`${label}计费资源`} value={rate.currency} onChange={e=>update({currency:e.target.value})}><option value="points">点数</option><option value="money">金额（元）</option></select></td><td><input aria-label={`${label}单价`} type="number" min="0" step="0.01" value={rate.amount} onChange={e=>update({amount:Number(e.target.value)})}/></td></tr>
      })}</PagedRows></tbody></table></div><button className="primary-button" disabled={busy} onClick={()=>void save('rates',{rates:data.rates})}>保存计费标准</button></>}
      {tab === 'pricing' && <div className="pa-form"><p className="pa-notice">媒体价格=供应商价格 × 平台倍数 × 代理/企业倍数，并向上取整到整元；例如2元×1.1显示和扣费为3元。</p><div className="pa-scroll"><table><thead><tr><th>项目</th><th>平台倍数</th></tr></thead><tbody><PagedRows table>{Object.entries(mediaMarkupLabels).map(([key,label]) => <tr key={key}><td>{label}</td><td><input aria-label={`${label}平台倍数`} type="number" min="1" max="100" step="0.001" value={data.pricing.mediaMarkup[key] ?? 1} onChange={e=>setData({...data,pricing:{...data.pricing,mediaMarkup:{...data.pricing.mediaMarkup,[key]:Number(e.target.value)}}})}/></td></tr>)}</PagedRows></tbody></table></div><label>文章创作点数 / 篇<input type="number" min="0" step="0.01" value={data.pricing.articlePointCost ?? 1} onChange={e=>setData({...data,pricing:{...data.pricing,articlePointCost:Number(e.target.value)}})}/></label><label>发布点数 / 篇<input type="number" min="0" step="0.01" value={data.pricing.publicationPointCost ?? 0} onChange={e=>setData({...data,pricing:{...data.pricing,publicationPointCost:Number(e.target.value)}})}/></label><button className="primary-button" disabled={busy} onClick={()=>void save('pricing',{pricing:data.pricing})}>保存价格调控</button></div>}
      {tab === 'connections' && <><div className="pa-connection"><Settings size={20}/><div><h3>模型与平台服务</h3><p>查看现有连接配置</p></div><button className="primary-button" onClick={onModel}>打开模型配置</button></div><div className="pa-scroll"><table><thead><tr><th>接口</th><th>管理方式</th></tr></thead><tbody><PagedRows table>{['小青蛙媒体','关键词查询','云存储'].map(name=><tr key={name}><td>{name}</td><td>服务端配置；本页不读取或显示密钥</td></tr>)}</PagedRows></tbody></table></div></>}
    </> : page === 'verification' ? <>
      <div className="pa-filters"><select aria-label="认证状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option><option value="pending">待审核</option><option value="approved">已认证</option><option value="returned">已退回</option></select></div>
      <div className="pa-scroll"><table><thead><tr><th>企业主体</th><th>管理员</th><th>项目</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody><PagedRows table>{data.applications.filter(a=>!status || a.status===status).map(a=><tr key={a.id}><td>{a.company}</td><td>{a.administrator}</td><td>{a.projectId}</td><td>{{pending:'待审核',approved:'已认证',returned:'已退回'}[a.status]}</td><td>{a.submittedAt}</td><td><button disabled={a.status!=='pending'} onClick={()=>{setReview(a);setReason('')}}>审核</button></td></tr>)}</PagedRows></tbody></table></div>
      {!data.applications.length && <p className="pa-empty">暂无认证申请</p>}<p className="pa-notice">证件上传与实名接口尚未接入，不影响现有账户使用。</p>
    </> : <>
      <div className="pa-filters"><input aria-label="搜索账户" placeholder="搜索公司、姓名或账号" value={query} onChange={e=>setQuery(e.target.value)}/>{page==='enterprises' && <select aria-label="所属代理" value={agent} onChange={e=>setAgent(e.target.value)}><option value="">全部代理</option>{agencies.map(a=><option key={a.id} value={a.agentId}>{a.displayName}</option>)}</select>}<select aria-label="账户状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option><option value="active">正常</option><option value="disabled">停用</option><option value="pending">待审核</option></select><span>{accounts.length}个账户</span></div>
      <div className="pa-scroll"><table className="pa-account-table"><thead><tr><th>名称 / 账号</th><th>所属代理</th><th>项目额度</th><th>创作 / 发布额度</th><th>空间 / 主词</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead><tbody><PagedRows table>{accounts.map(u=><tr key={u.id}><td><strong>{u.displayName}</strong><small>{u.username}</small></td><td>{agencies.find(a=>a.agentId===u.agentId && a.id!==u.id)?.displayName || '平台直属'}</td><td>{shownLimit(u,'projects')}</td><td>{shownLimit(u,'articles')} / {shownLimit(u,'publications')}</td><td>{shownLimit(u,'storageMB')} MB / {shownLimit(u,'keywords')}</td><td>{data.policies[u.id]?.expiresAt || '未配置'}</td><td>{u.status==='active'?'正常':u.status==='pending'?'待审核':'停用'}</td><td><div className="pa-actions"><EnterAccount user={u}/><AccountActions user={u} onChange={load}/><button title="套餐额度与有效期" aria-label={`编辑${u.username}`} onClick={()=>openEdit(u)}><SlidersHorizontal size={16}/></button><button disabled={busy} onClick={()=>void act(async()=>{await accountRequest('/api/admin/users/update',{id:u.id,status:u.status==='active'?'disabled':'active'});await load()})}>{u.status==='active'?'停用':'启用'}</button></div></td></tr>)}</PagedRows></tbody></table></div>
      {!accounts.length && <p className="pa-empty">暂无匹配账户</p>}
    </>}
    {editing && <Modal title={page==='agencies'?'编辑代理':'编辑企业'} onClose={()=>setEditing(null)} actions={<><button className="ghost-button" onClick={()=>setEditing(null)}>关闭</button>{editTab!=='limits'&&<button className="primary-button" disabled={busy} onClick={()=>void save('policy',{userId:editing.id,displayName:editing.displayName,policy})}>保存配置</button>}</>}>
      <div className="pa-dialog">{message && <p role="alert">{message}</p>}<nav className="pa-tabs">{[['base','基本信息'],['limits','额度配置'],['provider','接口与定价'],['expiry','有效期']].map(([id,label])=><button key={id} aria-pressed={editTab===id} onClick={()=>setEditTab(id)}>{label}</button>)}</nav>
      {editTab==='base' && <div className="pa-form"><label>账号<input value={editing.username} readOnly/></label><label>名称<input value={editing.displayName} onChange={e=>setEditing({...editing,displayName:e.target.value})}/></label><label>备注<textarea value={policy.notes} onChange={e=>setPolicy({...policy,notes:e.target.value})}/></label></div>}
      {editTab==='limits' && <MemberQuotaEditor userId={editing.id} onSaved={load}/>}
      {editTab==='provider' && <div className="pa-form"><label>媒体加价倍数<input type="number" min="1" max="100" step="0.001" value={policy.mediaMarkup} onChange={e=>setPolicy({...policy,mediaMarkup:Number(e.target.value)})}/></label>{([['modelMode','文字模型来源'],['imageMode','图片模型来源'],['keywordMode','关键词模型来源'],['xiaoqingwaMode','小青蛙接口来源'],['providerMode','官媒与媒体采购来源']] as const).map(([key,label])=><label key={key}>{label}<select value={policy[key] || 'inherit'} onChange={e=>setPolicy({...policy,[key]:e.target.value})}><option value="inherit">使用上级配置</option><option value="custom">使用代理自有配置</option></select></label>)}<label className="pa-inline"><input type="checkbox" checked={policy.manualCheck} onChange={e=>setPolicy({...policy,manualCheck:e.target.checked})}/>手动查询收录</label><p className="pa-notice">代理选择自有配置后，可在代理后台“模型接口”里维护自己的文字模型、图片模型、关键词模型和小青蛙接口；未切换的项目继续走总后台配置。</p></div>}
      {editTab==='expiry' && <div className="pa-form"><label>到期日期<input type="date" value={policy.expiresAt} onChange={e=>setPolicy({...policy,expiresAt:e.target.value})}/></label><p className="pa-notice">日期用于登记；自动到期停用尚未启用。</p></div>}</div>
    </Modal>}
    {creating && <Modal title={page==='agencies'?'添加代理':'添加企业'} onClose={()=>setCreating(false)} actions={<><button onClick={()=>setCreating(false)}>取消</button><button className="primary-button" form="pa-create" disabled={busy}>创建账户</button></>}><form id="pa-create" className="pa-dialog pa-form" onSubmit={e=>{e.preventDefault();const initial=Object.fromEntries(new FormData(e.currentTarget));void act(async()=>{const r=await accountRequest<{user:AccountUser}>('/api/admin/users',{...newUser,...initial,role:page==='agencies'?'agent':'project_admin'});await load();setCreating(false);openEdit(r.user)})}}>{([['username','登录账号'],['displayName','名称'],['password','初始密码']] as const).map(([k,label])=><label key={k}>{label}<input required autoComplete="off" type={k==='password'?'password':'text'} minLength={k==='password'?10:undefined} value={newUser[k]} onChange={e=>setNewUser({...newUser,[k]:e.target.value})}/></label>)}{page==='enterprises' && <label>所属代理<select value={newUser.agentId} onChange={e=>setNewUser({...newUser,agentId:e.target.value})}><option value="">平台直属</option>{agencies.map(a=><option key={a.id} value={a.agentId}>{a.displayName}</option>)}</select></label>}<InitialPackage/>{message && <p role="alert">{message}</p>}</form></Modal>}
    {history && <Modal title="配置操作记录" onClose={()=>setHistory(false)} actions={<button onClick={()=>setHistory(false)}>关闭</button>}><div className="pa-dialog">{data?.audit.slice().reverse().map(a=><p key={a.id}>{a.at} · {a.action} · {users.find(u=>u.id===a.target)?.displayName || a.target}</p>)}{!data?.audit.length && <p>暂无配置变更</p>}</div></Modal>}
    {review && <Modal title="认证审核" onClose={()=>setReview(null)} actions={<>{[['returned','退回补充'],['approved','通过认证']].map(([status,label])=><button disabled={busy||!reason.trim()} key={status} onClick={()=>void act(async()=>{await accountRequest('/api/admin/platform/verification',{id:review.id,status,reason});setReview(null);await load()})}>{label}</button>)}</>}><div className="pa-dialog pa-form"><p>{review.company} · {review.administrator}</p><label>审核意见<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label></div></Modal>}
  </section>
}
