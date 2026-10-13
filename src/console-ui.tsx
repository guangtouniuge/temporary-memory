import {PagedRows} from './PagedRows'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Pencil, Trash2, RotateCcw } from 'lucide-react'
import { InitialPackage } from './MemberPackages'
import {MemberQuotaEditor} from './MemberQuotaEditor'

export type ConsoleKind = 'platform' | 'agency' | 'project'
export const consoleNames = { platform: 'agents 总管理', agency: '尊贵代理后台', project: '企业家商用后台' }
export const consolePortalPaths: Record<ConsoleKind, string> = { platform: '/admin', agency: '/gongju/agents', project: '/gongju/geo' }

export function consoleKindForRole(role: string): ConsoleKind {
  return role === 'super_admin' ? 'platform' : role === 'agent' ? 'agency' : 'project'
}

export function consoleKindForPath(pathname = window.location.pathname): ConsoleKind | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const matched = (Object.entries(consolePortalPaths) as [ConsoleKind, string][]).find(([, path]) => normalized === path)
  return matched?.[0] || null
}

export function hashConsoleKind(hash = window.location.hash): ConsoleKind | '' {
  const kind = hash.replace(/^#\/?/, '').split('/')[0]
  return kind === 'platform' || kind === 'agency' || kind === 'project' ? kind : ''
}

export function accountHome(role: string) {
  const kind = consoleKindForRole(role)
  return `/${kind}/${kind === 'project' ? 'dashboard' : 'overview'}`
}

export function consoleUrl(kind: ConsoleKind, hash: string) {
  return `${window.location.origin}${consolePortalPaths[kind]}${hash.startsWith('#') ? hash : `#${hash}`}`
}

export function accountUrl(role: string) {
  return consoleUrl(consoleKindForRole(role), accountHome(role))
}

export function EnterAccount({ user }: { user: AccountUser }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!['agent', 'project_admin'].includes(user.role)) return null
  return <><button className="ghost-button" disabled={busy || user.status !== 'active'} onClick={async () => {
    setBusy(true); setError('')
    try {
      const result = await accountRequest<{ user: AccountUser }>('/api/auth/management/enter', { userId: user.id })
      window.location.replace(accountUrl(result.user.role))
    } catch (e) { setError(e instanceof Error ? e.message : '进入失败'); setBusy(false) }
  }}>{busy ? '进入中' : user.role === 'agent' ? '进入代理后台' : '进入项目后台'}</button>{error && <span role="alert">{error}</span>}</>
}

export type AccountUser = {
  id: string
  username: string
  displayName: string
  role: 'super_admin' | 'agent' | 'project_admin' | 'project_operator'
  status: 'pending' | 'active' | 'disabled'
  workspaceId: string
  agentId?: string
  projectId?: string
  projectName?: string
  deletedAt?: string
}

export function AccountActions({ user, onChange }: { user: AccountUser; onChange: () => Promise<void> }) {
  const [quotaOpen,setQuotaOpen]=useState(false)
  const [mode, setMode] = useState('')
  const [name, setName] = useState(user.displayName)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (user.role === 'super_admin') return null
  const submit = async () => {
    setBusy(true); setError('')
    try {
      await accountRequest(`/api/admin/users/${mode === 'edit' ? 'update' : mode}`, { id: user.id, ...(mode === 'edit' ? { displayName: name, password } : {}) })
      await onChange(); setMode(''); setPassword('')
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }
  const open = (value: string) => { setMode(value); setError(''); setName(user.displayName); setPassword('') }
  return <>{user.deletedAt ? <button title="恢复账户" aria-label={`恢复${user.username}`} onClick={() => open('restore')}><RotateCcw size={16}/></button> : <><button title="编辑账户资料与密码" aria-label={`修改账户${user.username}`} onClick={() => open('edit')}><Pencil size={16}/></button><button title="删除账户" aria-label={`删除${user.username}`} onClick={() => open('delete')}><Trash2 size={16}/></button></>}
    {mode && <Modal title={mode === 'edit' ? '编辑账户资料' : mode === 'delete' ? '删除账户' : '恢复账户'} onClose={() => { if (!busy) setMode('') }} actions={<><button disabled={busy} onClick={() => setMode('')}>取消</button><button className={mode === 'delete' ? 'danger-button' : 'primary-button'} disabled={busy || mode === 'edit' && !name.trim()} onClick={() => void submit()}>{busy ? '处理中' : '确认'}</button></>}>
      <div className="console-form"><strong>{user.username}</strong>{mode === 'edit' ? <><label>名称<input value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label><label>重置密码<input type="password" autoComplete="new-password" placeholder="留空保持原密码" value={password} onChange={e => setPassword(e.target.value)}/></label></> : <p>{mode === 'delete' ? '账户将移入回收站并停止登录，已有文章和发布记录保留。请先结清可用及预占额度；代理有下属账户时，需先处理下属账户。' : '账户将恢复为停用状态，启用后才能登录。'}</p>}{error && <p role="alert">{error}</p>}</div>
    </Modal>}
    {!user.deletedAt&&<button title="编辑可用额度" aria-label={`额度配置${user.username}`} onClick={()=>setQuotaOpen(true)}>额度</button>}
    {quotaOpen&&<Modal title={`${user.displayName}的额度配置`} onClose={()=>setQuotaOpen(false)} actions={<button onClick={()=>setQuotaOpen(false)}>关闭</button>}><div className="pa-dialog"><MemberQuotaEditor userId={user.id} onSaved={onChange}/></div></Modal>}
  </>
}

export function AccountRecycleBin({ onChange }: { onChange: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<AccountUser[]>([])
  const [error, setError] = useState('')
  const load = async () => { const r = await accountRequest<{ users: AccountUser[] }>('/api/admin/users/deleted'); setRows(r.users) }
  return <><button className="ghost-button" onClick={() => { setOpen(true); setError(''); void load().catch(e => setError(e.message)) }}><Trash2 size={16}/>账户回收站</button>{open && <Modal title="账户回收站" onClose={() => setOpen(false)} actions={<button onClick={() => setOpen(false)}>关闭</button>}><div className="console-form">{error && <p role="alert">{error}</p>}{!rows.length && !error && <p>暂无已删除账户</p>}<PagedRows>{rows.map(u => <div className="row-actions" key={u.id}><span>{u.displayName} · {u.username}</span><AccountActions user={u} onChange={async () => { await load(); await onChange() }}/></div>)}</PagedRows></div></Modal>}</>
}

type ProjectSummary = {
  projectId: string
  agentId?: string
  projectName?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  brands?: number
  articles?: number
  tasks?: number
}

const roleLabels: Record<AccountUser['role'], string> = {
  super_admin: '总后台管理员',
  agent: '代理账号',
  project_admin: '项目管理员',
  project_operator: '项目操作员',
}

const statusLabels: Record<AccountUser['status'], string> = {
  pending: '待审核',
  active: '启用',
  disabled: '停用',
}

export async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="operation-toolbar"><div><strong>{title}</strong><span>{description}</span></div><div className="toolbar-actions">{actions}</div></div>
}

export function EmptyState({ title = '暂无记录', description, action }: { title?: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><span>{description}</span>{action}</div>
}

export function Modal({ title, onClose, children, actions, wide=false }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; wide?:boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className={`form-modal console-dialog${wide?' wide-modal':''}`} onCancel={onClose} aria-label={title}>
    <div className="modal-head"><strong>{title}</strong><button onClick={onClose} aria-label="关闭弹窗">关闭</button></div>
    {children}<div className="modal-actions">{actions}</div>
  </dialog>
}

export function BatchBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null
  return <div className="batch-bar" role="status"><strong>已选 {count} 项</strong><button className="ghost-button" onClick={onClear}>取消选择</button><div className="toolbar-actions">{children}</div></div>
}

function AccountDirectory({ mode }: { mode: 'agents' | 'projects' }) {
  const [newRole,setNewRole]=useState('project_admin')
  const [me, setMe] = useState<AccountUser | null>(null)
  const [rows, setRows] = useState<AccountUser[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [draftOpen, setDraftOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const isAgents = mode === 'agents'
  const load = async () => {
    const [self, users] = await Promise.all([
      accountRequest<{ user: AccountUser }>('/api/auth/me'),
      accountRequest<{ users: AccountUser[] }>('/api/admin/users'),
    ])
    setMe(self.user)
    setRows(users.users)
  }
  useEffect(() => { void load().catch(error => setMessage(error instanceof Error ? error.message : '账号加载失败')) }, [])
  const matched = rows
    .filter(row => isAgents ? row.role === 'agent' : ['project_admin', 'project_operator'].includes(row.role))
    .filter(row => !query.trim() || `${row.username}${row.displayName}${row.projectName || ''}`.includes(query.trim()))
  const pages = Math.max(1, Math.ceil(matched.length / 20))
  const currentPage = Math.min(page, pages)
  const visible = matched.slice((currentPage - 1) * 20, currentPage * 20)
  const title = isAgents ? '代理管理' : '项目账户'
  const description = isAgents
    ? '总后台创建和停用代理账号；代理登录后进入代理后台管理自己的项目账户。'
    : '代理创建客户项目管理员和操作员；项目账号登录后进入独立项目后台。'
  const createRole = isAgents ? 'agent' : 'project_admin'
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false) }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget))
    void run(async () => {
      const role=isAgents ? 'agent' : data.role || createRole
      const initialAllocation=data.initialAllocation?JSON.parse(String(data.initialAllocation)):undefined
      await accountRequest('/api/admin/users', { ...data, initialAllocation:role==='project_operator'?undefined:initialAllocation, role })
      await load()
      setDraftOpen(false)
      setMessage(isAgents ? '代理账号已创建' : '项目账号已创建')
    })
  }
  const toggleStatus = (row: AccountUser) => run(async () => {
    await accountRequest('/api/admin/users/update', { id: row.id, status: row.status === 'active' ? 'disabled' : 'active' })
    await load()
  })
  return <section className="operation-page">
    <PageHeader title={title} description={description} actions={<><AccountRecycleBin onChange={load}/><button className="primary-button" onClick={() => setDraftOpen(true)}>{isAgents ? '添加代理账号' : '添加项目账号'}</button></>} />
    <div className="panel">
      <div className="list-toolbar"><input className="search-input" aria-label={`搜索${title}`} placeholder="搜索账号、名称或项目" value={query} onChange={event => { setQuery(event.target.value); setSelected([]); setPage(1) }} /><span>共 {matched.length} 条</span></div>
      <BatchBar count={selected.length} onClear={() => setSelected([])}><button className="danger-button" disabled={busy} onClick={() => void run(async () => { await Promise.all(selected.map(id => accountRequest('/api/admin/users/update', { id, status: 'disabled' }))); setSelected([]); await load() })}>停用选中</button></BatchBar>
      <div className="table-scroll"><table className="management-table"><thead><tr><th><input type="checkbox" aria-label="全选当前列表" checked={visible.length > 0 && visible.every(row => selected.includes(row.id))} onChange={event => setSelected(event.target.checked ? visible.map(row => row.id) : [])} /></th><th>账号</th><th>角色</th><th>{isAgents ? '代理编号' : '项目'}</th><th>状态</th><th>操作</th></tr></thead><tbody><PagedRows table>{visible.map(row => <tr key={row.id}><td><input type="checkbox" aria-label={`选择${row.username}`} checked={selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} /></td><td><strong>{row.displayName || row.username}</strong><span>{row.username}</span></td><td>{roleLabels[row.role]}</td><td>{isAgents ? row.agentId || row.workspaceId : `${row.projectName || row.projectId || row.workspaceId}`}</td><td><span className="pill">{statusLabels[row.status] || row.status}</span></td><td><div className="row-actions"><EnterAccount user={row} /><AccountActions user={row} onChange={load}/><button className="ghost-button" disabled={busy || row.id === me?.id} onClick={() => void toggleStatus(row)}>{row.status === 'active' ? '停用' : '启用'}</button></div></td></tr>)}</PagedRows></tbody></table></div>
      <div className="list-toolbar"><button className="ghost-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {pages} 页</span><button className="ghost-button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
      {!visible.length && <EmptyState title={query ? '没有匹配账号' : isAgents ? '还没有代理账号' : '还没有项目账号'} description={query ? '换个关键词再试。' : isAgents ? '点击右上角添加代理账号。' : '点击右上角添加项目账号。'} />}
      {message && <p className="table-note" role="status">{message}</p>}
    </div>
    {draftOpen && <Modal wide={!isAgents} title={isAgents ? '添加代理账号' : '添加项目账号'} onClose={() => {if(!busy)setDraftOpen(false)}} actions={<><button className="ghost-button" disabled={busy} onClick={() => setDraftOpen(false)}>取消</button><button className="primary-button" form="account-create-form" disabled={busy}>保存账号</button></>}>
      <form id="account-create-form" className={`console-form ${!isAgents?'account-opening-form':''}`} onSubmit={submit}>
        <label>登录账号<input name="username" required minLength={3} maxLength={80} autoFocus /></label>
        <label>显示名称<input name="displayName" required maxLength={80} /></label>
        <label>初始密码<input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" /></label>
        {!isAgents && <label>账号角色<select name="role" value={newRole} onChange={e=>setNewRole(e.target.value)}><option value="project_admin">项目管理员</option><option value="project_operator">项目操作员</option></select></label>}
        {me?.role !== 'project_admin' && (isAgents||newRole==='project_admin') && <InitialPackage required={!isAgents} />}
        {!isAgents && <label>项目名称<input name="projectName" placeholder="例如：某客户GEO项目" required maxLength={80} /></label>}
        {isAgents && <label>代理编号（可留空自动生成）<input name="agentId" placeholder="只支持字母、数字、横线、下划线" /></label>}
        {message && <p role="alert">{message}</p>}
      </form>
    </Modal>}
  </section>
}

export function AgencyDirectory() {
  return <AccountDirectory mode="agents" />
}

export function ProjectAccountDirectory() {
  return <AccountDirectory mode="projects" />
}

export function ProjectSummaryDirectory({ onAccounts }: { onAccounts?: () => void }) {
  const [rows, setRows] = useState<ProjectSummary[]>([])
  const [owners, setOwners] = useState<AccountUser[]>([])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true); setMessage('')
    try {
      const result = await accountRequest<{ projects: ProjectSummary[] }>('/api/projects/summary')
      const accounts = await accountRequest<{ users: AccountUser[] }>('/api/admin/users')
      setOwners(accounts.users.filter(user => user.role === 'project_admin'))
      setRows(Array.isArray(result.projects) ? result.projects : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目列表加载失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])
  const visible = rows.filter(row => !query.trim() || `${row.projectName || ''}${row.projectId}${row.agentId || ''}`.includes(query.trim()))
  const activeCount = visible.filter(row => row.status !== 'DISABLED').length
  const totalBrands = visible.reduce((sum, row) => sum + (row.brands || 0), 0)
  const totalArticles = visible.reduce((sum, row) => sum + (row.articles || 0), 0)
  const totalTasks = visible.reduce((sum, row) => sum + (row.tasks || 0), 0)
  const shortCode = (value = '') => value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value || '—'
  const ownerFor = (projectId: string) => owners.find(user => user.projectId === projectId)
  const pageTitle = onAccounts ? '客户品牌库' : '客户项目库'
  return <section className="operation-page">
    <PageHeader title={pageTitle} description="按客户品牌查看项目资产、内容规模和后台入口；完整编号弱化展示，避免影响日常查找。" actions={<><button className="ghost-button" onClick={() => void load()}>刷新</button>{onAccounts && <button className="primary-button" onClick={onAccounts}>进入项目账户</button>}</>} />
    <div className="panel">
      <div className="project-library-summary">
        <span><strong>{visible.length}</strong>客户项目</span>
        <span><strong>{activeCount}</strong>启用中</span>
        <span><strong>{totalBrands}</strong>品牌</span>
        <span><strong>{totalArticles}</strong>文章</span>
        <span><strong>{totalTasks}</strong>任务</span>
      </div>
      <div className="list-toolbar"><input className="search-input project-search" aria-label="搜索项目" placeholder="搜索客户名称、项目编号或代理编号" value={query} onChange={event => setQuery(event.target.value)} /><span>{loading ? '加载中…' : `共 ${visible.length} 个项目`}</span></div>
      <div className="table-scroll customer-project-scroll"><table className="management-table customer-project-table"><thead><tr><th>客户品牌</th><th>项目编号</th><th>代理编号</th><th>内容资产</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody><PagedRows table>{visible.map(row => {
        const owner = ownerFor(row.projectId)
        return <tr key={row.projectId}><td><strong>{row.projectName || '未命名客户'}</strong><span>{row.projectName ? '客户品牌项目' : shortCode(row.projectId)}</span></td><td><code title={row.projectId}>{shortCode(row.projectId)}</code></td><td><span title={row.agentId || ''}>{shortCode(row.agentId)}</span></td><td><div className="project-assets"><span>品牌 <b>{row.brands || 0}</b></span><span>文章 <b>{row.articles || 0}</b></span><span>任务 <b>{row.tasks || 0}</b></span></div></td><td><span className={`pill ${row.status === 'DISABLED' ? 'muted' : ''}`}>{row.status === 'DISABLED' ? '停用' : '启用'}</span></td><td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN') : '—'}</td><td>{owner ? <EnterAccount user={owner} /> : onAccounts ? <button className="ghost-button" onClick={onAccounts}>去开户</button> : <span className="muted-text">未开户</span>}</td></tr>
      })}</PagedRows></tbody></table></div>
      {!visible.length && !loading && <EmptyState title={query ? '没有匹配项目' : '还没有客户项目'} description={query ? '换个项目名称或编号再查。' : '先在项目账户中创建客户项目账号，项目会自动出现在这里。'} action={onAccounts && <button className="primary-button" onClick={onAccounts}>进入项目账户</button>} />}
      {message && <p className="table-note" role="status">{message}</p>}
    </div>
  </section>
}

export function ConsoleOverview({ kind, onProjects }: { kind: ConsoleKind; projectCount: number; articleCount: number; onProjects: () => void }) {
  const [rows, setRows] = useState<ProjectSummary[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void accountRequest<{ projects: ProjectSummary[] }>('/api/projects/summary').then(result => {
    setRows(Array.isArray(result.projects) ? result.projects : [])
  }).catch(e => setError(e instanceof Error ? e.message : '加载失败')) }, [])
  const projectCount = rows.length
  const articleCount = rows.reduce((sum, row) => sum + (row.articles || 0), 0)
  const taskCount = rows.reduce((sum, row) => sum + (row.tasks || 0), 0)
  const brandCount = rows.reduce((sum, row) => sum + (row.brands || 0), 0)
  const activeCount = rows.filter(row => row.status !== 'DISABLED').length
  const recentRows = rows.slice(0, 8)
  return <section className="operation-page console-overview-page">
    {error && <p className="form-error" role="alert">{error}</p>}
    <PageHeader title={kind === 'platform' ? '平台概览' : '代理工作台'} description="查看项目、内容、任务和品牌数据，不在首页展示流程说明。" actions={<button className="primary-button" onClick={onProjects}>查看项目库</button>} />
    <div className="console-metrics console-data-metrics">
      <button className="panel" onClick={onProjects}><span>客户项目</span><strong>{projectCount}</strong><small>{activeCount} 个启用</small></button>
      <button className="panel" onClick={onProjects}><span>品牌数量</span><strong>{brandCount}</strong><small>项目内品牌资料</small></button>
      <button className="panel" onClick={onProjects}><span>文章记录</span><strong>{articleCount}</strong><small>累计内容资产</small></button>
      <button className="panel" onClick={onProjects}><span>生成任务</span><strong>{taskCount}</strong><small>历史和当前任务</small></button>
    </div>
    <div className="panel">
      <PageHeader title="项目数据" description="优先看项目规模、内容产出和更新时间。" actions={<button className="ghost-button" onClick={onProjects}>管理项目</button>} />
      <div className="table-scroll"><table className="management-table console-project-table"><thead><tr><th>项目</th><th>代理编号</th><th>数据规模</th><th>状态</th><th>更新时间</th></tr></thead><tbody><PagedRows table>{recentRows.map(row => <tr key={row.projectId}><td><strong>{row.projectName || row.projectId}</strong><span>{row.projectId}</span></td><td>{row.agentId || '—'}</td><td>品牌 {row.brands || 0} · 文章 {row.articles || 0} · 任务 {row.tasks || 0}</td><td><span className="pill">{row.status === 'DISABLED' ? '停用' : '启用'}</span></td><td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</PagedRows></tbody></table></div>
      {!recentRows.length && <EmptyState title="暂无项目数据" description={kind === 'platform' ? '创建代理和项目账号后，数据会汇总到这里。' : '创建客户项目账号后，数据会汇总到这里。'} action={<button className="primary-button" onClick={onProjects}>查看项目库</button>} />}
    </div>
  </section>
}
