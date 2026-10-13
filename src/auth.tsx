import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import './auth.css'
import { accountHome, accountUrl, consoleKindForRole, consolePortalPaths, consoleUrl, hashConsoleKind } from './console-ui'

type User = {
  id: string
  username: string
  displayName: string
  role: string
  status: string
  workspaceId: string
  agentId?: string
  projectId?: string
  projectName?: string
  parentId?: string
  management?: { trail: { id: string; name: string; role: string }[] }
  permissions: string[]
}
declare global {
  interface Window {
    geoSocialClient?: { request: (action: string, body?: unknown) => Promise<{ ok: boolean; value: any; error?: string }> }
  }
}
const labels: Record<string, string> = { super_admin: '总后台管理员', agent: '代理商', project_admin: '项目管理员', project_operator: '项目操作员' }
const portalRoles: Record<string, string[]> = {
  admin: ['super_admin'],
  agents: ['super_admin', 'agent'],
  geo: ['project_admin', 'project_operator'],
}
const portalLabels: Record<string, string> = { admin: '总管理后台', agents: '代理管理后台', geo: '商户管理后台' }
let scope = ''
export const accountStorage = {
  workspaceId: () => scope,
  getItem: (key: string) => window.localStorage.getItem(`account:${scope}:${key}`),
  setItem: (key: string, value: string) => window.localStorage.setItem(`account:${scope}:${key}`, value),
}
async function request(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let result: { error?: string; [key: string]: any } = {}
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    const hint = text.trim().startsWith('<') ? '登录接口返回了页面内容，请检查当前后台地址是否正确。' : '登录接口返回格式异常，请刷新后重试。'
    throw new Error(hint)
  }
  if (!response.ok) throw new Error(result.error || '请求失败')
  return result
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const pathParts = window.location.pathname.split('/').filter(Boolean)
  const pathEntry = pathParts.at(-1) || ''
  const entry = pathEntry === 'admin' || ['agents', 'skill', 'geo'].includes(pathEntry) ? pathEntry : new URLSearchParams(window.location.search).get('portal') || ''
  const socialClientEntry = entry === 'geo' && (Boolean(window.geoSocialClient) || window.location.hash.includes('/project/distribution'))
  const entryNames: Record<string, string> = { admin: '总管理后台', agents: '代理管理后台', skill: '代理管理后台', geo: socialClientEntry ? '文章发布客户端' : '商户管理后台' }
  const hashKind = hashConsoleKind()
  if (hashKind && window.location.pathname !== consolePortalPaths[hashKind]) {
    window.location.replace(consoleUrl(hashKind, window.location.hash))
    return <div className="auth-screen">正在打开正确后台入口…</div>
  }
  const [panel, setPanel] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const accept = (next: User | null) => {
    scope = next?.projectId || next?.workspaceId || ''
    window.__geoIdentity = next ? {
      userId: next.id,
      role: next.role as 'super_admin' | 'agent' | 'project_admin' | 'project_operator',
      agentId: next.agentId || '',
      projectId: next.projectId || next.workspaceId,
    } : undefined
    window.dispatchEvent(new Event('geo:identity-changed'))
    setUser(next)
  }
  useEffect(() => {
    const allowInjectedIdentity = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if (allowInjectedIdentity && window.__geoIdentity) {
      const identity = window.__geoIdentity
      setUser({
        id: identity.userId,
        username: identity.userId,
        displayName: identity.userId,
        role: identity.role,
        status: 'active',
        workspaceId: identity.projectId,
        agentId: identity.agentId || '',
        projectId: identity.projectId,
        permissions: identity.role === 'super_admin'
          ? ['users:manage', 'system:manage', 'media:publish']
          : identity.role === 'project_operator'
            ? []
            : ['users:manage'],
      })
      scope = identity.projectId
      setLoading(false)
      return
    }
    request('/api/auth/me').then((r) => accept(r.user)).catch((error) => {
      accept(null)
      const text = error instanceof Error ? error.message : ''
      if (text && !text.includes('请先登录')) setMessage(text)
    }).finally(() => setLoading(false))
    const expired = () => { accept(null); setMessage('登录已失效，请重新登录') }
    window.addEventListener('geo-auth-expired', expired)
    return () => window.removeEventListener('geo-auth-expired', expired)
  }, [])
  useEffect(() => {
    if (!user) return
    const recheck = () => { void request('/api/auth/me').then((r) => {
      if (r.user.id !== user.id) { window.location.reload(); return }
      accept(r.user)
    }).catch(() => { accept(null); setMessage('请重新登录') }) }
    const timer = window.setInterval(recheck, 60_000)
    window.addEventListener('focus', recheck)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', recheck) }
  }, [user?.id])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false) }
  }
  const submit = (event: FormEvent<HTMLFormElement>, action: (data: Record<string, string>) => Promise<void>) => {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    void run(() => action(data))
  }
  if (loading) return <div className="auth-screen">正在确认登录状态…</div>
  if (!user) return <div className="auth-screen"><form className="auth-card" onSubmit={(e) => submit(e, async (data) => {
    const result = await request('/api/auth/login', { ...data, portal: entry })
    if (socialClientEntry) {
      if (!['project_admin', 'project_operator'].includes(result.user.role)) {
        await request('/api/auth/logout', {})
        throw new Error('文章发布客户端只能使用项目账号登录，请不要使用总后台或代理账号。')
      }
      window.location.replace(consoleUrl('project', '/project/distribution'))
      return
    }
    const target = accountUrl(result.user.role)
    if (new URL(target).pathname === window.location.pathname) {
      window.history.replaceState(null, '', target)
      accept(result.user)
      return
    }
    window.location.replace(target)
  })}><header className="auth-heading"><h1>曝光率GEO自研系统</h1><h2>{entryNames[entry] || '全链路agents内容生产系统'}</h2></header><label>账号<input name="username" required minLength={3} maxLength={80} autoComplete="username" /></label><label>密码<input name="password" type="password" required minLength={10} maxLength={128} autoComplete="current-password" /></label><p role="status">{message}</p><button disabled={busy}>登录</button></form></div>
  if (socialClientEntry && !['project_admin', 'project_operator'].includes(user.role)) return <div className="auth-screen"><section className="auth-card"><header className="auth-heading"><h1>文章发布客户端</h1><h2>当前账号不能用于客户端发布</h2></header><p role="status">当前登录的是「{labels[user.role] || user.role}」。客户端发布需要项目管理员或项目操作员账号。</p><button disabled={busy} onClick={() => void run(async () => { await request('/api/auth/logout', {}); accept(null) })}>退出并使用项目账号登录</button></section></div>
  const requiredRoles = portalRoles[entry]
  if (requiredRoles && !requiredRoles.includes(user.role)) return <div className="auth-screen"><section className="auth-card"><header className="auth-heading"><h1>{portalLabels[entry]}</h1><h2>当前账号不能进入这个入口</h2></header><p role="status">当前登录的是「{labels[user.role] || user.role}」，这个地址固定为「{portalLabels[entry]}」。请退出后使用对应账号登录。</p><button disabled={busy} onClick={() => void run(async () => { await request('/api/auth/logout', {}); accept(null) })}>退出并重新登录</button></section></div>
  const accountEntry = user.role === 'super_admin' ? '代理管理' : user.role === 'agent' ? '项目账户' : ''
  return <><div className="account-bar"><span>{user.displayName} · {labels[user.role]}</span>{accountEntry && <span className="account-hint">账号管理请使用左侧「{accountEntry}」</span>}{(user.management?.trail.length || 0) > 1 ? <><span>{user.management?.trail.map(item => item.name).join(' > ')}</span><button disabled={busy} onClick={() => void run(async () => { const result = await request('/api/auth/management/leave', {}); window.location.replace(consoleUrl(consoleKindForRole(result.user.role), accountHome(result.user.role))) })}>返回上级后台</button></> : <button onClick={() => { setPanel(panel === 'password' ? '' : 'password'); setMessage('') }}>修改密码</button>}<button disabled={busy} onClick={() => void run(async () => { await request('/api/auth/logout', {}); accept(null) })}>退出登录</button></div>
    {panel && <section className="account-panel"><button onClick={() => setPanel('')}>关闭</button><p role="status">{message}</p>
      {panel === 'password' && <form onSubmit={(e) => submit(e, async (data) => { await request('/api/auth/password', data); accept(null); setMessage('密码已修改，请重新登录') })}><h2>修改密码</h2><label>原密码<input name="currentPassword" type="password" required autoComplete="current-password" /></label><label>新密码<input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" /></label><button disabled={busy}>保存密码</button></form>}
    </section>}{!panel && <div key={user.id}>{children}</div>}</>
}
