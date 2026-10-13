import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { platformAdmin } from './platform-admin.mjs'
import { createMemberLedger } from './member-ledger.mjs'
import { projectUsage } from './resource-capacity.mjs'
import { normalizePricing, validMultiplier } from './billing-pricing.mjs'

export const requestAccount = new AsyncLocalStorage()
export const workspacePath = (...parts) => {
  const user = requestAccount.getStore()
  if (!user) throw new Error('缺少账号上下文')
  return resolve(process.cwd(), 'outputs', 'workspaces', user.workspaceId, ...parts)
}
export const roles = {
  super_admin: ['users:manage', 'system:manage', 'content:write', 'media:publish'],
  agent: ['users:manage', 'content:write', 'media:publish'],
  project_admin: ['users:manage', 'content:write', 'media:publish'],
  project_operator: ['content:write'],
}
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const digest = (token) => createHash('sha256').update(token).digest('hex')
const idPart = (value, fallback = randomUUID()) => {
  const text = String(value || '').trim()
  if (!text) return fallback
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(text)) fail(400, '项目或代理编号只能使用字母、数字、横线和下划线')
  return text
}
const hashPassword = (password) => {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) fail(400, '密码需为10至128个字符')
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
const verify = (password, hash) => {
  if (typeof password !== 'string' || password.length > 128) return false
  const [salt, key] = hash.split(':')
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'))
}
const normalizeUser = (user) => {
  if (!user) return user
  if (user.role === 'super_admin') {
    user.workspaceId ||= user.projectId || 'platform'
    user.agentId ||= ''
    user.projectId ||= user.workspaceId
  } else if (user.role === 'agent') {
    user.agentId ||= user.workspaceId || user.id
    user.workspaceId ||= user.agentId
    user.projectId ||= ''
  } else {
    user.projectId ||= user.workspaceId || user.id
    user.workspaceId ||= user.projectId
    user.agentId ||= user.parentWorkspaceId || ''
  }
  user.projectName ||= user.role === 'agent' ? `${user.displayName || user.username}代理空间` : `${user.displayName || user.username}项目`
  return user
}
const publicUser = ({ passwordHash, ...user }) => ({ ...normalizeUser(user), permissions: roles[user.role] })

export function createAuth({ json, readJson }) {
  const directory = resolve(process.env.GEO_AUTH_DATA_DIR || 'outputs/auth')
  mkdirSync(directory, { recursive: true })
  const memberLedger = createMemberLedger(resolve(directory, 'member-ledger.sqlite'))
  const workerInstance=randomUUID()
  memberLedger.recoverExpiredLeases()
  const sweepStaleNewsOrders=()=>{
    try {
      const expired=memberLedger.news.expireAllStale()
      if(expired.length)console.log(`Stale news orders refunded: ${expired.length}`)
    } catch(error) {
      console.error('Stale news order cleanup failed:',error.message)
    }
  }
  setTimeout(sweepStaleNewsOrders,1000).unref()
  const newsOrderTimer=setInterval(sweepStaleNewsOrders,10*60*1000)
  newsOrderTimer.unref()
  const leaseTimer=setInterval(()=>{
    try {memberLedger.renewLeases(workerInstance);memberLedger.recoverExpiredLeases()}catch(error){console.error('Lease recovery failed:',error.message)}
  },30000)
  leaseTimer.unref()
  const file = resolve(directory, 'accounts.json')
  const db = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, users: [], sessions: [] }
  db.users.forEach(normalizeUser)
  const projectRegistryFile = resolve(process.cwd(), 'outputs/data/project-accounts.json')
  const readProjectRegistry = () => {
    if (!existsSync(projectRegistryFile)) return []
    try {
      const rows = JSON.parse(readFileSync(projectRegistryFile, 'utf8'))
      return Array.isArray(rows) ? rows : []
    } catch {
      return []
    }
  }
  const writeProjectRegistry = (rows) => {
    mkdirSync(resolve(process.cwd(), 'outputs/data'), { recursive: true })
    writeFileSync(`${projectRegistryFile}.tmp`, JSON.stringify(rows, null, 2), 'utf8')
    renameSync(`${projectRegistryFile}.tmp`, projectRegistryFile)
  }
  const syncProjectRegistry = (user) => {
    normalizeUser(user)
    if (!['project_admin', 'project_operator'].includes(user.role) || !user.projectId) return
    const rows = readProjectRegistry()
    const existing = rows.find((row) => row.projectId === user.projectId)
    if (existing && user.role === 'project_operator') return
    const now = new Date().toISOString()
    const next = {
      projectId: user.projectId,
      agentId: user.agentId || '',
      projectName: user.projectName || user.displayName || user.username,
      status: user.status === 'disabled' ? 'DISABLED' : 'ACTIVE',
      ownerUserId: user.id,
      createdAt: existing?.createdAt || user.createdAt || now,
      updatedAt: now,
    }
    if (existing) Object.assign(existing, next)
    else rows.push(next)
    writeProjectRegistry(rows)
  }
  const save = () => {
    writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
  const accountScope = (body, role, actor) => {
    if (role === 'super_admin') return { workspaceId: 'platform', agentId: '', projectId: 'platform', parentId: '', projectName: '总后台' }
    if (role === 'agent') {
      const agentId = idPart(body.agentId || body.workspaceId)
      if(db.users.some(u=>u.agentId===agentId)||readProjectRegistry().some(p=>p.projectId===agentId))fail(409,'代理编号已使用')
      return { workspaceId: agentId, agentId, projectId: '', parentId: actor?.id || '', projectName: String(body.projectName || body.displayName || body.username || '代理空间').slice(0, 80) }
    }
    const actorScope = actor ? normalizeUser(actor) : null
    const projectId = role === 'project_operator' && actorScope?.role === 'project_admin'
      ? actorScope.projectId
      : idPart(body.projectId || body.workspaceId)
    const agentId = actorScope?.role === 'agent'
      ? actorScope.agentId
      : actorScope?.role === 'project_admin'
        ? actorScope.agentId
        : idPart(body.agentId || actorScope?.agentId || '', '')
    const existing = readProjectRegistry().find(p=>p.projectId===projectId)
    const owner = db.users.find(u=>u.role==='project_admin' && u.projectId===projectId && !u.deletedAt)
    if(role==='project_admin' && (existing || db.users.some(u=>u.projectId===projectId || u.agentId===projectId)))fail(409,'项目编号已使用，不能重新开户接管')
    if(role==='project_operator' && actorScope) {
      if(!owner || !existing || owner.status!=='active' || existing.ownerUserId!==owner.id || existing.agentId!==owner.agentId)fail(403,'请选择有效的已有项目')
      if(actorScope.role!=='super_admin' && (actorScope.agentId!==owner.agentId || actorScope.role==='project_admin' && actorScope.projectId!==projectId))fail(403,'项目不属于当前管理范围')
      if(agentId!==owner.agentId)fail(403,'项目与代理归属不匹配')
    }
    if(agentId && !db.users.some(u=>u.role==='agent' && u.agentId===agentId && u.status==='active' && !u.deletedAt))fail(403,'所属代理不存在或已停用')
    if(!actorScope && existing)fail(403,'注册不能绑定已有项目')
    return {
      workspaceId: projectId,
      agentId,
      projectId,
      parentId: actor?.id || '',
      projectName: String(body.projectName || body.displayName || body.username || '客户项目').slice(0, 80),
    }
  }
  const createUser = (body, role, status, scope = accountScope(body, role), staged = false) => {
    const username = String(body.username || '').trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.@-]{2,79}$/.test(username)) fail(400, '账号需为3至80位字母、数字或邮箱格式')
    if (db.users.some((u) => u.username === username)) fail(409, '账号已存在')
    const user = normalizeUser({ id: randomUUID(), username, displayName: String(body.displayName || username).slice(0, 80), passwordHash: hashPassword(body.password), role, status, ...scope, createdAt: new Date().toISOString() })
    if(staged)return user
    db.users.push(user)
    save()
    syncProjectRegistry(user)
    return user
  }
  // Replay committed enrollments after an interruption between ledger commit and the auth-file mirror.
  for(const user of memberLedger.enrolledUsers()) {
    if(db.users.some(u=>u.id===user.id))continue
    if(db.users.some(u=>u.username===user.username))throw new Error('开户恢复存在账号冲突，请检查账户数据')
    db.users.push(user);save();syncProjectRegistry(user)
  }
  if (!db.users.some((u) => u.role === 'super_admin') && process.env.GEO_ADMIN_USERNAME && process.env.GEO_ADMIN_PASSWORD) {
    createUser({ username: process.env.GEO_ADMIN_USERNAME, password: process.env.GEO_ADMIN_PASSWORD }, 'super_admin', 'active')
  }
  const cookie = (req) => String(req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('geo_session='))?.slice(12) || ''
  const setCookie = (res, token, maxAge) => res.setHeader('Set-Cookie', `geo_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.GEO_COOKIE_SECURE === 'true' ? '; Secure' : ''}`)
  const sessionFor = (req) => {
    const session = db.sessions.find((s) => s.tokenHash === digest(cookie(req)) && s.expiresAt > Date.now())
    const user = session && db.users.find((u) => u.id === session.userId && u.status === 'active' && !u.deletedAt)
    if (!user) fail(401, '请先登录，或联系管理员确认账号状态')
    return { session, user }
  }
  const canEnter = (actor, target) => !target.deletedAt && target.status === 'active' && (
    actor.role === 'super_admin' && ['agent', 'project_admin'].includes(target.role)
    || actor.role === 'agent' && target.role === 'project_admin' && target.agentId === actor.agentId
  )
  const authenticate = (req) => {
    const { session, user } = sessionFor(req)
    let current = user
    const trail = [user]
    for (const id of session.managementTrail || []) {
      const target = db.users.find(item => item.id === id)
      if (!target || !canEnter(current, target)) fail(403, '代管对象已变更或停用，请返回上级后台')
      current = target
      trail.push(target)
    }
    if(['project_admin','project_operator'].includes(current.role)) {
      const project=readProjectRegistry().find(p=>p.projectId===current.projectId)
      if(project && project.agentId!==(current.agentId||''))fail(403,'账户与项目代理归属不匹配')
    }
    return { ...current, management: { actorId: user.id, actorName: user.displayName || user.username,
      trail: trail.map(item => ({ id: item.id, name: item.displayName || item.username, role: item.role })) } }
  }
  const assertProjectLoginScope = (user) => {
    normalizeUser(user)
    if(!['project_admin','project_operator'].includes(user.role))return
    const project=readProjectRegistry().find(p=>p.projectId===user.projectId)
    if(project && project.agentId!==(user.agentId||''))fail(403,'账户与项目代理归属不匹配，请联系管理员检查开户归属')
  }
  const recordEntry = (root, from, to, action) => {
    db.managementAudit ||= []
    db.managementAudit.push({ actorId: root.id, fromId: from, targetId: to, action, at: new Date().toISOString() })
    db.managementAudit = db.managementAudit.slice(-10000)
  }
  const canManage = (actor, target) => {
    normalizeUser(actor); normalizeUser(target)
    if (actor.role === 'super_admin') return target.role !== 'super_admin' || actor.id === target.id
    if (actor.role === 'agent') return target.agentId === actor.agentId && ['project_admin', 'project_operator'].includes(target.role)
    if (actor.role === 'project_admin') return target.projectId === actor.projectId && target.role === 'project_operator'
    return false
  }
  const creatableRoles = (actor) => {
    if (actor.role === 'super_admin') return ['agent', 'project_admin', 'project_operator']
    if (actor.role === 'agent') return ['project_admin', 'project_operator']
    if (actor.role === 'project_admin') return ['project_operator']
    return []
  }
  const attempts = new Map()
  const rateLimit = (req) => {
    const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    const key = process.env.GEO_TRUST_PROXY === 'true' && localProxy ? String(req.headers['x-real-ip'] || req.socket.remoteAddress) : req.socket.remoteAddress
    const now = Date.now()
    for (const [ip, item] of attempts) if (item.until < now) attempts.delete(ip)
    const item = attempts.get(key) || { count: 0, until: now + 15 * 60_000 }
    if (++item.count > 30) fail(429, '尝试过于频繁，请15分钟后重试')
    attempts.set(key, item)
    return key
  }
  const checkOrigin = (req) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, '需要JSON请求')
    if (req.headers.origin) {
      const allowed = process.env.GEO_APP_ORIGIN || `http://${req.headers.host}`
      if (req.headers.origin !== allowed) fail(403, '请求来源不允许')
    }
  }
  const handle = async (req, res, path) => {
    if (!path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) return false
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'POST' && path === '/api/auth/register') {
      rateLimit(req)
      const user = createUser(await readJson(req), 'project_operator', 'pending')
      json(res, 201, { ok: true, user: publicUser(user), message: '注册成功，请等待管理员审核' }); return true
    }
    if (req.method === 'POST' && path === '/api/auth/login') {
      const attemptKey = rateLimit(req)
      const body = await readJson(req)
      const user = db.users.find((u) => u.username === String(body.username || '').trim().toLowerCase())
      if (!user || !verify(body.password, user.passwordHash)) fail(401, '账号或密码错误')
      if (user.deletedAt || user.status !== 'active') fail(403, '账号待审核或已停用，请联系管理员')
      const portalRoles = {
        admin: ['super_admin'],
        agents: ['super_admin', 'agent'],
        skill: ['super_admin', 'agent'],
        geo: ['project_admin', 'project_operator'],
      }
      if (body.portal && (!portalRoles[body.portal] || !portalRoles[body.portal].includes(user.role))) fail(403, '账号与登录入口不匹配，请使用对应的后台登录地址')
      assertProjectLoginScope(user)
      const token = randomBytes(32).toString('hex')
      db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now())
      db.sessions.push({ tokenHash: digest(token), userId: user.id, expiresAt: Date.now() + 8 * 3600_000 })
      save(); setCookie(res, token, 8 * 3600)
      attempts.delete(attemptKey)
      json(res, 200, { ok: true, user: publicUser(user) }); return true
    }
    if (req.method === 'POST' && path === '/api/auth/logout') {
      db.sessions = db.sessions.filter((s) => s.tokenHash !== digest(cookie(req)))
      save(); setCookie(res, '', 0); json(res, 200, { ok: true }); return true
    }
    if (req.method === 'POST' && path === '/api/auth/management/leave') {
      const { session, user } = sessionFor(req)
      const from = session.managementTrail?.pop()
      if (!from) fail(400, '当前已是登录账号的后台')
      // An invalidated child can always be left, without restoring unauthorized scope.
      while (session.managementTrail.length) {
        try { authenticate(req); break } catch { session.managementTrail.pop() }
      }
      recordEntry(user, from, session.managementTrail.at(-1) || user.id, 'leave')
      save(); json(res, 200, { ok: true, user: publicUser(authenticate(req)) }); return true
    }
    const actor = authenticate(req)
    if (req.method === 'POST' && path === '/api/auth/management/enter') {
      const body = await readJson(req)
      const target = db.users.find(item => item.id === body.userId)
      if (!target || !canEnter(actor, target)) fail(403, '不能进入此代理或项目后台')
      const { session, user } = sessionFor(req)
      session.managementTrail ||= []
      if (session.managementTrail.length >= 2) fail(403, '不能继续进入下级后台')
      session.managementTrail.push(target.id)
      recordEntry(user, actor.id, target.id, 'enter')
      save(); json(res, 200, { ok: true, user: publicUser(authenticate(req)) }); return true
    }
    if (req.method === 'GET' && path === '/api/auth/me') { json(res, 200, { ok: true, user: publicUser(actor) }); return true }
    if (path.startsWith('/api/admin/members')) {
      for(const u of db.users.filter(u=>u.role==='project_admin'&&!u.deletedAt&&(actor.role==='super_admin'||actor.role==='agent'&&u.agentId===actor.agentId||u.id===actor.id)))memberLedger.flushFiles(u.id,resolve(process.cwd(),'outputs/projects',idPart(u.projectId)))
      if(path==='/api/admin/members/reconcile') {
        if(!['super_admin','agent'].includes(actor.role))fail(403,'无权对账')
        const body=req.method==='POST'?await readJson(req):{}
        const selected=db.users.filter(u=>u.role==='project_admin'&&!u.deletedAt&&(actor.role==='super_admin'||u.agentId===actor.agentId))
        if(req.method==='POST'&&!selected.some(u=>u.id===body.userId))fail(403,'无权对账此账户')
        const rows=selected.filter(u=>req.method!=='POST'||u.id===body.userId).map(u=>{
          const usage=projectUsage(resolve(process.cwd(),'outputs/projects',idPart(u.projectId)))
          if(req.method==='POST')memberLedger.reconcileCapacity(u.id,usage)
          const balances=memberLedger.summary(u.id)
          return {id:u.id,name:u.displayName||u.username,resources:Object.entries(usage).map(([key,actual])=>({key,actual,recorded:balances[key].used,allocated:balances[key].available+balances[key].used,overage:Math.max(0,actual-balances[key].available-balances[key].used)}))}
        })
        json(res,200,{ok:true,rows});return true
      }
      const result = memberLedger.handle({ actor, users: db.users, path, method: req.method, body: req.method === 'POST' ? await readJson(req) : {} })
      json(res, 200, { ok: true, ...result }); return true
    }
    if (path.startsWith('/api/admin/platform')) {
      const result = platformAdmin({ db, save, actor, path, method: req.method, body: req.method === 'POST' ? await readJson(req) : {} })
      json(res, 200, { ok: true, ...result }); return true
    }
    if (req.method === 'POST' && path === '/api/auth/password') {
      if (actor.management.trail.length > 1) fail(403, '请返回自己的后台修改密码')
      const body = await readJson(req)
      rateLimit(req)
      if (!verify(body.currentPassword, actor.passwordHash)) fail(400, '原密码错误')
      db.users.find(user => user.id === actor.id).passwordHash = hashPassword(body.newPassword)
      db.sessions = db.sessions.filter((s) => s.userId !== actor.id)
      save(); setCookie(res, '', 0); json(res, 200, { ok: true }); return true
    }
    if (!roles[actor.role].includes('users:manage')) fail(403, '无账号管理权限')
    if (req.method === 'GET' && path === '/api/admin/users') {
      json(res, 200, { ok: true, users: db.users.filter((u) => !u.deletedAt && canManage(actor, u)).map(publicUser) }); return true
    }
    if (req.method === 'GET' && path === '/api/admin/users/deleted') {
      json(res, 200, { ok: true, users: db.users.filter(u => u.deletedAt && canManage(actor, u)).map(publicUser) }); return true
    }
    if (req.method === 'POST' && ['/api/admin/users/delete', '/api/admin/users/restore'].includes(path)) {
      const body = await readJson(req)
      const target = db.users.find(u => u.id === body.id)
      if (!target || !canManage(actor, target) || target.id === actor.id || target.role === 'super_admin') fail(403, '不能管理此账户')
      const restoring = path.endsWith('/restore')
      if (Boolean(target.deletedAt) !== restoring) fail(409, '账户状态已变化，请刷新')
      if (!restoring) {
        if (Object.values(memberLedger.summary(target.id)).some(b => b.available > 0 || b.held > 0)) fail(409, '账户仍有可用或预占额度，请先结清再删除')
        const dependents = db.users.filter(u => u.id !== target.id && !u.deletedAt && (
          target.role === 'agent' && u.agentId === target.agentId ||
          target.role === 'project_admin' && u.projectId === target.projectId))
        if (dependents.length) fail(409, `仍有${dependents.length}个下属账户，请先处理下属账户`)
        target.deletedAt = new Date().toISOString()
      } else {
        if (target.agentId && target.role !== 'agent' && !db.users.some(u => u.role === 'agent' && u.agentId === target.agentId && !u.deletedAt)) fail(409, '请先恢复所属代理')
        delete target.deletedAt
      }
      target.status = 'disabled'
      db.sessions = db.sessions.filter(s => s.userId !== target.id)
      recordEntry({ id: actor.management.actorId }, actor.id, target.id, restoring ? 'account.restore' : 'account.delete')
      save(); syncProjectRegistry(target)
      json(res, 200, { ok: true }); return true
    }
    if (req.method === 'POST' && path === '/api/admin/users') {
      const body = await readJson(req)
      const target = { ...accountScope(body, body.role || 'project_operator', actor), role: body.role || 'project_operator' }
      normalizeUser(target)
      if (!roles[target.role] || !creatableRoles(actor).includes(target.role) || !canManage(actor, target)) fail(403, '不能创建此角色或项目账号')
      if(actor.role==='agent' && target.role==='project_admin' && !body.packageId && !body.initialAllocation)fail(400,'新增项目账号必须同时配置开户额度')
      if(body.initialAllocation && !['agent','project_admin'].includes(target.role))fail(400,'操作员使用所属项目额度，无需单独分配')
      const funded=Boolean(body.packageId || body.initialAllocation)
      const user = createUser(body, target.role, 'active', target, funded)
      if(funded) {
        memberLedger.handle({actor,users:[...db.users,user],path:'/api/admin/members/packages/apply',method:'POST',enrollment:user,body:{userId:user.id,packageId:body.packageId,revision:Number(body.packageRevision),initialAllocation:body.initialAllocation,requestId:body.requestId,saleCents:Number(body.saleCents),reason:'开户套餐分配'}})
        db.users.push(user);save();syncProjectRegistry(user)
      }
      json(res, 201, { ok: true, user: publicUser(user) }); return true
    }
    if (req.method === 'POST' && path === '/api/admin/users/update') {
      const body = await readJson(req)
      const target = db.users.find((u) => u.id === body.id)
      if (!target || target.deletedAt) fail(404, '账号不存在')
      const next = { ...target, role: body.role ?? target.role, status: body.status ?? target.status }
      if(next.role!==target.role)fail(403,'不能通过账户编辑改变角色，请使用经过审核的账户交接流程')
      if (actor.id === target.id || !roles[next.role] || !['pending', 'active', 'disabled'].includes(next.status) || !canManage(actor, target) || !canManage(actor, next)) fail(403, '不允许此账号变更')
      if (target.role === 'super_admin' && target.status === 'active' && (next.role !== 'super_admin' || next.status !== 'active') && db.users.filter((u) => u.role === 'super_admin' && u.status === 'active').length <= 1) fail(409, '必须保留一个有效总后台管理员')
      const displayName = String(body.displayName ?? target.displayName).trim()
      if (!displayName || displayName.length > 80) fail(400, '名称需为1至80个字符')
      const passwordHash = body.password ? hashPassword(body.password) : target.passwordHash
      Object.assign(target, { role: next.role, status: next.status, displayName, passwordHash })
      recordEntry({ id: actor.management.actorId }, actor.id, target.id, body.password ? 'account.password.reset' : 'account.update')
      db.sessions = db.sessions.filter((s) => s.userId !== target.id)
      save(); syncProjectRegistry(target); json(res, 200, { ok: true, user: publicUser(target) }); return true
    }
    fail(404, '接口不存在')
  }
  return { handle, authenticate, checkOrigin,
    recoverProjectFiles(projectId) {
      const owner=projectId==='platform'?{id:'platform'}:db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt)
      if(owner)memberLedger.flushFiles(owner.id,resolve(process.cwd(),'outputs/projects',idPart(projectId)))
    },
    persistProjectFiles(projectId,usage,writes) {
      const owner=projectId==='platform'?{id:'platform'}:db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      if(!owner)fail(403,'项目缺少有效计费账户，请联系管理员')
      const root=resolve(process.cwd(),'outputs/projects',idPart(projectId))
      memberLedger.flushFiles(owner.id,root)
      memberLedger.stageFiles(owner.id,projectId==='platform'?{}:usage,root,writes.map(w=>({path:w.path,data:Buffer.from(w.data).toString('base64')})))
      memberLedger.flushFiles(owner.id,root)
    },
    withCapacity(projectId, usage, persist) {
      if(projectId==='platform')return persist()
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      if(!owner)fail(403,'项目缺少有效计费账户，请联系管理员')
      return memberLedger.withCapacity(owner.id,usage,persist)
    },
    checkKeywordAccess(projectId,count) {
      if(projectId==='platform')return
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      if(!owner)fail(403,'项目缺少有效计费账户，请联系管理员')
      memberLedger.checkKeywordAccess(owner.id,count)
    },
    checkArticleAccess(projectId) {
      if(projectId==='platform')return
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt)
      if(!owner || owner.status!=='active')fail(403,'项目缺少有效计费账户，请联系管理员')
      memberLedger.checkArticleAccess(owner.id)
    },
    checkImageStorage(projectId) {
      if(projectId==='platform')return
      const owner=db.users.find(u=>u.projectId===projectId&&u.role==='project_admin'&&!u.deletedAt&&u.status==='active')
      if(!owner)fail(403,'项目缺少有效计费账户')
      memberLedger.checkImageStorage(owner.id)
      memberLedger.checkImageMoney(owner.id)
    },
    reserveImages(projectId,jobKey) {
      const owner=db.users.find(u=>u.projectId===projectId&&u.role==='project_admin'&&!u.deletedAt&&u.status==='active')
      if(!owner)fail(403,'AI生图需要有效项目计费账户')
      return memberLedger.reserveImages(owner.id,`${owner.id}:${jobKey}`,workerInstance)
    },
    settleImages:(id,success)=>memberLedger.settleImages(id,success,workerInstance),
    reserveArticle(projectId, jobKey, fingerprint = '') {
      if(projectId==='platform')return null
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt)
      if(!owner || owner.status!=='active')fail(403,'项目缺少有效计费账户，请联系管理员')
      return memberLedger.reserveArticle(owner.id, `${owner.id}:${jobKey}`,{instance:workerInstance,fingerprint})
    },
    articleResult(projectId, jobKey) {
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      return owner ? memberLedger.articleResult(`${owner.id}:${jobKey}`) : null
    },
    releaseArticleJob(projectId, jobId) {
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin')
      if(owner)memberLedger.releaseJob(`${owner.id}:${jobId}:`,workerInstance)
    },
    settleArticle: (id, success, result)=>memberLedger.settleArticle(id,success,result,workerInstance),
    newsAsset(token){return memberLedger.news.publicAsset(token)},
    pricingPolicy(projectId){
      const pricing = normalizePricing(db.platformAdmin?.pricing)
      const owner = db.users.find(u => u.projectId === projectId && u.role === 'project_admin' && !u.deletedAt)
      const agent = owner?.agentId ? db.users.find(u => u.role === 'agent' && u.agentId === owner.agentId && !u.deletedAt) : null
      return {
        platform: pricing.mediaMarkup,
        agentMarkup: validMultiplier(db.platformAdmin?.policies?.[agent?.id]?.mediaMarkup) ?? 1,
        accountMarkup: validMultiplier(db.platformAdmin?.policies?.[owner?.id]?.mediaMarkup) ?? 1,
        articlePointCost: pricing.articlePointCost,
        publicationPointCost: pricing.publicationPointCost,
      }
    },
    providerConfig(projectId, kind = 'textModel') {
      const owner = db.users.find(u => u.projectId === projectId && u.role === 'project_admin' && !u.deletedAt)
      const agent = owner?.agentId ? db.users.find(u => u.role === 'agent' && u.agentId === owner.agentId && !u.deletedAt) : null
      const policy = agent ? db.platformAdmin?.policies?.[agent.id] || {} : {}
      const modeKey = kind === 'imageModel' ? 'imageMode' : kind === 'keywordModel' ? 'keywordMode' : kind === 'xiaoqingwa' ? 'xiaoqingwaMode' : 'modelMode'
      const configs = db.platformAdmin?.providerConfigs || {}
      const row = policy[modeKey] === 'custom' && agent ? configs[agent.id]?.[kind] : configs.platform?.[kind]
      return row?.enabled && row?.baseUrl && row?.model && row?.apiKey ? row : null
    },
    newsOrders(projectId){
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      if(!owner)fail(403,'请进入客户项目后台管理发布订单')
      return {owner:owner.id,store:memberLedger.news}
    },
    newsProjectIds(){
      return [...new Set(db.users.filter(u=>u.projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active').map(u=>u.projectId))]
    },
    diagnosisOrders(projectId){
      const owner=db.users.find(u=>u.projectId===projectId && u.role==='project_admin' && !u.deletedAt && u.status==='active')
      if(!owner)fail(403,'请进入客户项目后台管理诊断服务')
      return {owner:owner.id,store:memberLedger.diagnosis}
    },
  }
}
