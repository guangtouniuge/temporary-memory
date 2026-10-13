import Database from 'better-sqlite3'
import {createNewsOrders} from './news-orders.mjs'
import { randomUUID } from 'node:crypto'
import {applyFileWrites,validateFileWrites} from './durable-files.mjs'
import {resolve,relative,isAbsolute} from 'node:path'

export const resources = { points: '点数', money: '余额（分）', storageMB: '空间（MB）', articles: '文章篇数', keywords: '关键词数', projects: '项目数', publications: '发布篇数', publishingAccounts: '授权账号数' }
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export function createMemberLedger(file) {
  const sql = new Database(file)
  sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS wallets (owner TEXT, resource TEXT, available INTEGER NOT NULL DEFAULT 0 CHECK(available>=0), used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0), PRIMARY KEY(owner,resource));
    CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, fingerprint TEXT NOT NULL, actor TEXT, effective_actor TEXT, owner TEXT, counterparty TEXT, resource TEXT, delta INTEGER, before_amount INTEGER, after_amount INTEGER, reason TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, owner TEXT, resource TEXT, status TEXT, attempt INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS packages (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS package_orders (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (owner TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS enrollments (owner TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS article_results (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS capacity_audits (owner TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settlement_audit (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, actor TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_leases (id TEXT PRIMARY KEY, instance TEXT NOT NULL, expires INTEGER NOT NULL, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_files (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS image_charges (id TEXT PRIMARY KEY, owner TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS diagnosis_orders (id TEXT PRIMARY KEY, owner TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  const balance = (owner, resource) => sql.prepare('SELECT available,used FROM wallets WHERE owner=? AND resource=?').get(owner, resource) || { available: 0, used: 0 }
  const summary = owner => Object.fromEntries(Object.keys(resources).map(key => {
    let held=sql.prepare("SELECT count(*) AS n FROM holds WHERE owner=? AND resource=? AND status='held'").get(owner,key).n
    if(key==='money')held+=200*sql.prepare("SELECT count(*) AS n FROM image_charges WHERE owner=? AND status='held'").get(owner).n
    if(['money','publications'].includes(key))for(const row of sql.prepare("SELECT data FROM news_orders WHERE owner=? AND state IN ('reserved','sending','uncertain')").all(owner))held+=key==='money'?JSON.parse(row.data).priceCents:1
    if(key==='money')for(const row of sql.prepare("SELECT data FROM diagnosis_orders WHERE owner=? AND state='charging'").all(owner))held+=Number(JSON.parse(row.data).costCents||0)
    return [key,{...balance(owner,key),held,managed:Boolean(sql.prepare('SELECT 1 FROM wallets WHERE owner=? AND resource=?').get(owner,key))}]
  }))
  const transact = fn => { sql.exec('BEGIN IMMEDIATE'); try { const value = fn(); sql.exec('COMMIT'); return value } catch(e) { sql.exec('ROLLBACK'); throw e } }
  const update = (owner, resource, delta) => {
    const before = balance(owner, resource).available
    const after = before + delta
    if (!Number.isSafeInteger(after) || after < 0) fail(409, '可用额度不足，不能继续调整')
    sql.prepare('INSERT INTO wallets(owner,resource,available) VALUES(?,?,?) ON CONFLICT(owner,resource) DO UPDATE SET available=excluded.available').run(owner, resource, after)
    return { before, after }
  }
  const settleImages = (id, success) => {
    const row=sql.prepare('SELECT * FROM image_charges WHERE id=?').get(id)
    if(!row||row.status!=='held')return
    const before=balance(row.owner,'money').available
    if(success)sql.prepare("UPDATE wallets SET used=used+200 WHERE owner=? AND resource='money'").run(row.owner)
    else update(row.owner,'money',200)
    sql.prepare('UPDATE image_charges SET status=? WHERE id=?').run(success?'committed':'released',id)
    sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${id}:image-settle:${row.attempt}`,id,'production','production',row.owner,'','money',success?0:200,before,success?before:before+200,success?'AI配图成功：2张/次，扣费2元':'AI配图未完成，退回2元预占',new Date().toISOString())
  }
  const parseOrder = row => row ? ({ id: row.id, owner: row.owner, type: row.type, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, ...JSON.parse(row.data) }) : null
  const diagnosisOrders = {
    list(owner) {
      return sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? ORDER BY created_at DESC').all(owner).map(parseOrder)
    },
    get(owner, id) {
      return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id))
    },
    start(owner, { type, costCents, data = {} }) {
      return transact(() => {
        const amount = Number(costCents)
        if (!['inclusion', 'report'].includes(type) || !Number.isSafeInteger(amount) || amount <= 0) fail(400, '诊断任务参数无效')
        if (balance(owner, 'money').available < amount) fail(409, `余额不足，本次需要${(amount / 100).toFixed(2)}元`)
        const id = randomUUID()
        const now = new Date().toISOString()
        const moved = update(owner, 'money', -amount)
        const payload = { ...data, costCents: amount, refunded: false, statusLabel: '创建中' }
        sql.prepare('INSERT INTO diagnosis_orders VALUES(?,?,?,?,?,?,?)').run(id, owner, type, 'charging', JSON.stringify(payload), now, now)
        sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), `${id}:diagnosis-hold`, id, 'production', 'production', owner, '', 'money', -amount, moved.before, moved.after, `小青蛙${type === 'report' ? 'PRO报告' : '查收录'}预扣：${(amount / 100).toFixed(2)}元`, now)
        return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE id=?').get(id))
      })
    },
    submit(owner, id, patch = {}) {
      return transact(() => {
        const row = sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id)
        if (!row) fail(404, '诊断任务不存在')
        const data = JSON.parse(row.data)
        const now = new Date().toISOString()
        if (row.state === 'charging') {
          sql.prepare("UPDATE wallets SET used=used+? WHERE owner=? AND resource='money'").run(Number(data.costCents || 0), owner)
          const before = balance(owner, 'money').available
          sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), `${id}:diagnosis-commit`, id, 'production', 'production', owner, '', 'money', 0, before, before, `小青蛙${row.type === 'report' ? 'PRO报告' : '查收录'}已提交，确认扣费`, now)
        }
        sql.prepare('UPDATE diagnosis_orders SET state=?, data=?, updated_at=? WHERE owner=? AND id=?').run('submitted', JSON.stringify({ ...data, ...patch, statusLabel: patch.statusLabel || data.statusLabel || '已提交' }), now, owner, id)
        return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id))
      })
    },
    update(owner, id, patch = {}, state = undefined) {
      return transact(() => {
        const row = sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id)
        if (!row) fail(404, '诊断任务不存在')
        const data = { ...JSON.parse(row.data), ...patch }
        const now = new Date().toISOString()
        sql.prepare('UPDATE diagnosis_orders SET state=?, data=?, updated_at=? WHERE owner=? AND id=?').run(state || row.state, JSON.stringify(data), now, owner, id)
        return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id))
      })
    },
    fail(owner, id, message) {
      return transact(() => {
        const row = sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id)
        if (!row) return null
        const data = JSON.parse(row.data)
        const now = new Date().toISOString()
        if (row.state === 'charging' && !data.refunded) {
          const before = balance(owner, 'money').available
          update(owner, 'money', Number(data.costCents || 0))
          sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), `${id}:diagnosis-release`, id, 'production', 'production', owner, '', 'money', Number(data.costCents || 0), before, before + Number(data.costCents || 0), '小青蛙诊断未创建成功，退回预扣费用', now)
          data.refunded = true
        }
        sql.prepare('UPDATE diagnosis_orders SET state=?, data=?, updated_at=? WHERE owner=? AND id=?').run('failed', JSON.stringify({ ...data, error: String(message || '提交失败'), statusLabel: '失败' }), now, owner, id)
        return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id))
      })
    },
    refund(owner, id, reason = '小青蛙诊断退款') {
      return transact(() => {
        const row = sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id)
        if (!row) fail(404, '诊断任务不存在')
        const data = JSON.parse(row.data)
        if (data.refunded) return parseOrder(row)
        const amount = Number(data.costCents || 0)
        const now = new Date().toISOString()
        const before = balance(owner, 'money').available
        update(owner, 'money', amount)
        sql.prepare("UPDATE wallets SET used=max(used-?,0) WHERE owner=? AND resource='money'").run(amount, owner)
        sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), `${id}:diagnosis-refund`, id, 'production', 'production', owner, '', 'money', amount, before, before + amount, reason, now)
        sql.prepare('UPDATE diagnosis_orders SET state=?, data=?, updated_at=? WHERE owner=? AND id=?').run('refunded', JSON.stringify({ ...data, refunded: true, statusLabel: '已退款' }), now, owner, id)
        return parseOrder(sql.prepare('SELECT * FROM diagnosis_orders WHERE owner=? AND id=?').get(owner, id))
      })
    },
  }
  return {
    checkImageMoney(owner) {
      if(balance(owner,'money').available<200)fail(409,'AI配图余额不足，每篇2元（2张）；请充值或选择自有图库')
    },
    reserveImages(owner,id,instance) {
      return transact(()=>{
        const old=sql.prepare('SELECT * FROM image_charges WHERE id=?').get(id)
        if(old&&old.owner!==owner)fail(403,'图片计费归属冲突')
        const lease=sql.prepare('SELECT * FROM work_leases WHERE id=?').get(id)
        if(!lease||lease.instance!==instance||lease.expires<=Date.now())fail(409,'图片生成任务租约无效')
        if(old&&['held','committed'].includes(old.status))return id
        if(balance(owner,'money').available<200)fail(409,'AI配图余额不足，每篇2元（2张）；请充值或选择自有图库')
        const amount=update(owner,'money',-200),attempt=(old?.attempt||0)+1
        sql.prepare("INSERT INTO image_charges VALUES(?,?,'held',?) ON CONFLICT(id) DO UPDATE SET status='held',attempt=excluded.attempt").run(id,owner,attempt)
        sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${id}:image-hold:${attempt}`,id,'production','production',owner,'','money',-200,amount.before,amount.after,'AI配图预占：2张/次，2元',new Date().toISOString())
        return id
      })
    },
    settleImages(id,success,instance) {
      if(!id)return
      return transact(()=>{
        const lease=sql.prepare('SELECT * FROM work_leases WHERE id=?').get(id)
        if(!lease||lease.instance!==instance||lease.expires<=Date.now())fail(409,'图片结算租约失效')
        settleImages(id,success)
      })
    },
    news:createNewsOrders(sql,{transact,update,balance}),
    diagnosis: diagnosisOrders,
    close: () => sql.close(), summary,
    flushFiles(owner, rootOverride = null) {
      const rows=sql.prepare('SELECT * FROM pending_files WHERE owner=? ORDER BY rowid').all(owner)
      for(const row of rows) {
        const data=JSON.parse(row.data)
        const root=rootOverride||data.root
        const writes=data.writes.map(w=>({...w,path:resolve(root,isAbsolute(w.path)?relative(data.root,w.path):w.path)}))
        applyFileWrites(row.id,root,writes)
        sql.prepare('DELETE FROM pending_files WHERE id=?').run(row.id)
      }
    },
    stageFiles(owner,usage,root,writes) {
      validateFileWrites(root,writes)
      const id=randomUUID(),data=JSON.stringify({root,writes:writes.map(w=>({...w,path:relative(root,w.path)}))})
      this.withCapacity(owner,usage,()=>{
        if(sql.prepare('SELECT 1 FROM pending_files WHERE owner=?').get(owner))fail(503,'前次文件保存尚未恢复，请稍后重试')
        sql.prepare('INSERT INTO pending_files VALUES(?,?,?)').run(id,owner,data)
      })
      return id
    },
    reconcileCapacity(owner, usage) {
      return transact(()=>{
        for(const [resource,amount] of Object.entries(usage)) {
          if(!['projects','keywords','storageMB'].includes(resource)||!Number.isSafeInteger(amount)||amount<0)fail(400,'资源用量无效')
          const row=sql.prepare('SELECT available,used FROM wallets WHERE owner=? AND resource=?').get(owner,resource)
          if(!row)continue
          const limit=row.available+row.used,used=Math.min(limit,amount),available=limit-used
          if(used===row.used)continue
          sql.prepare('UPDATE wallets SET available=?,used=? WHERE owner=? AND resource=?').run(available,used,owner,resource)
          const id=randomUUID()
          sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`reconcile:${id}`,id,'reconciliation','reconciliation',owner,'',resource,available-row.available,row.available,available,'存量用量对账',new Date().toISOString())
        }
        sql.prepare('INSERT INTO capacity_audits VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify({usage,at:new Date().toISOString()}))
      })
    },
    withCapacity(owner, usage, persist) {
      return transact(()=>{
        for(const [resource,amount] of Object.entries(usage)) {
          if(!['projects','keywords','storageMB'].includes(resource) || !Number.isSafeInteger(amount) || amount<0)fail(400,'资源用量无效')
          const row=sql.prepare('SELECT available,used FROM wallets WHERE owner=? AND resource=?').get(owner,resource)
          const audit=sql.prepare('SELECT data FROM capacity_audits WHERE owner=?').get(owner)
          const current=audit ? (JSON.parse(audit.data).usage[resource] ?? row?.used ?? 0) : row?.used || 0
          const limit=(row?.available || 0)+(row?.used || 0)
          if(amount>current) {
            const m=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner)
            if(m && Date.parse(JSON.parse(m.data).expiresAt)<=Date.now())fail(403,'套餐已到期，请联系管理员续期')
            if(!row || amount>limit)fail(409,`${resources[resource]}额度不足，请联系管理员调整`)
          }
          if(row) {
            const available=Math.max(0,limit-amount)
            sql.prepare('UPDATE wallets SET available=?,used=? WHERE owner=? AND resource=?').run(available,Math.min(limit,amount),owner,resource)
            if(amount!==current) {
              const id=randomUUID()
              sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`capacity:${id}`,id,'capacity','capacity',owner,'',resource,available-row.available,row.available,available,amount>current?'资源占用':'资源释放',new Date().toISOString())
            }
          }
        }
        const old=sql.prepare('SELECT data FROM capacity_audits WHERE owner=?').get(owner)
        sql.prepare('INSERT INTO capacity_audits VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify({usage:{...(old?JSON.parse(old.data).usage:{}),...usage},at:new Date().toISOString()}))
        return persist()
      })
    },
    checkKeywordAccess(owner, count) {
      if(!Number.isSafeInteger(count)||count<1||count>201)fail(400,'拓词数量无效')
      const m=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner)
      if(m && Date.parse(JSON.parse(m.data).expiresAt)<=Date.now())fail(403,'套餐已到期，请联系管理员续期')
      const row=sql.prepare("SELECT available FROM wallets WHERE owner=? AND resource='keywords'").get(owner)
      if(!row || row.available<count)fail(409,'关键词额度不足，请联系管理员调整')
    },
    checkArticleAccess(owner) {
      const m=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner)
      if(m && Date.parse(JSON.parse(m.data).expiresAt)<=Date.now())fail(403,'套餐已到期，请联系管理员续期')
      const b=summary(owner).articles
      if(!b.managed)fail(403,'未配置文章额度，请联系管理员分配套餐')
      if(b.available+b.held<1)fail(409,'文章额度不足，请先续充')
    },
    checkImageStorage(owner) {
      if(balance(owner,'storageMB').available<4)fail(409,'AI配图至少需要4MB可用空间，请先调整空间额度')
    },
    membership: owner => {const r=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner);return r?JSON.parse(r.data):null},
    enrolledUsers: () => sql.prepare('SELECT data FROM enrollments').all().map(r=>JSON.parse(r.data)),
    reserveArticle(owner, id, lease = null) {
      const m=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(owner)
      if(m && Date.parse(JSON.parse(m.data).expiresAt)<=Date.now())fail(403,'套餐已到期，请联系管理员续期')
      if (!sql.prepare("SELECT 1 FROM wallets WHERE owner=? AND resource='articles'").get(owner)) fail(403,'未配置文章额度，请联系管理员分配套餐')
      return transact(()=>{
        const hold=sql.prepare('SELECT * FROM holds WHERE id=?').get(id)
        if(hold && hold.owner!==owner) fail(409,'额度预占归属冲突')
        if(lease) {
          const old=sql.prepare('SELECT * FROM work_leases WHERE id=?').get(id)
          if(old && old.fingerprint!==String(lease.fingerprint||''))fail(409,'请求编号已用于其他生成内容')
          if(old && hold?.status==='held' && old.instance!==lease.instance && old.expires>Date.now())fail(409,'该文章正在处理中，请稍后查询')
          sql.prepare('INSERT INTO work_leases VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET instance=excluded.instance,expires=excluded.expires').run(id,lease.instance,Date.now()+120000,String(lease.fingerprint||''))
        }
        if(hold && ['held','committed'].includes(hold.status)) return id
        const amount=update(owner,'articles',-1), attempt=(hold?.attempt || 0)+1
        sql.prepare("INSERT INTO holds VALUES(?,?,'articles','held',?) ON CONFLICT(id) DO UPDATE SET status='held',attempt=excluded.attempt").run(id,owner,attempt)
        sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${id}:hold:${attempt}`,id,'production','production',owner,'','articles',-1,amount.before,amount.after,'文章生成预占',new Date().toISOString())
        return id
      })
    },
    articleResult(id) {
      const row=sql.prepare('SELECT data FROM article_results WHERE id=?').get(id)
      return row ? JSON.parse(row.data) : null
    },
    releaseJob(prefix, instance = null) {
      const ids=sql.prepare("SELECT h.id,l.instance,l.expires FROM holds h LEFT JOIN work_leases l ON l.id=h.id WHERE h.status='held'").all().filter(r=>r.id.startsWith(prefix) && (!instance || !r.instance || r.instance===instance && r.expires>Date.now())).map(r=>r.id)
      for(const id of ids)this.settleArticle(id,false,null,instance)
    },
    renewLeases(instance) {
      sql.prepare("UPDATE work_leases SET expires=? WHERE instance=? AND expires>? AND id IN (SELECT id FROM holds WHERE status='held')").run(Date.now()+120000,instance,Date.now())
    },
    recoverExpiredLeases() {
      return transact(()=>{
        const rows=sql.prepare("SELECT h.* FROM holds h JOIN work_leases l ON l.id=h.id WHERE h.status='held' AND l.expires<=?").all(Date.now())
        for(const hold of rows) {
          settleImages(hold.id,false)
          const amount=update(hold.owner,'articles',1)
          sql.prepare("UPDATE holds SET status='released' WHERE id=?").run(hold.id)
          sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${hold.id}:settle:${hold.attempt}`,hold.id,'recovery','recovery',hold.owner,'','articles',1,amount.before,amount.after,'执行租约过期，退回预占',new Date().toISOString())
        }
        return rows.length
      })
    },
    settleArticle(id, success, result = null, instance = null) {
      if(!id)return
      const data=success && result ? JSON.stringify(result) : null
      transact(()=>{
        const hold=sql.prepare('SELECT * FROM holds WHERE id=?').get(id)
        if(instance) {
          const lease=sql.prepare('SELECT * FROM work_leases WHERE id=?').get(id)
          if(lease && (lease.instance!==instance || lease.expires<=Date.now()))fail(409,'执行租约失效，不能重复结算')
        }
        if(!hold || hold.status!=='held')return
        if(!success)settleImages(id,false)
        // The recoverable result and the charge commit together.
        if(data)sql.prepare('INSERT INTO article_results VALUES(?,?)').run(id,data)
        const before=balance(hold.owner,'articles').available
        if(success) sql.prepare("UPDATE wallets SET used=used+1 WHERE owner=? AND resource='articles'").run(hold.owner)
        else update(hold.owner,'articles',1)
        sql.prepare('UPDATE holds SET status=? WHERE id=?').run(success?'committed':'released',id)
        sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${id}:settle:${hold.attempt}`,id,'production','production',hold.owner,'','articles',success?0:1,before,success?before:before+1,success?'文章完成扣减':'文章失败退回',new Date().toISOString())
      })
    },
    handle({ actor, users, path, method, body = {}, enrollment = null }) {
      const canSee = u => !u.deletedAt && (
        actor.role === 'super_admin' ||
        actor.id === u.id ||
        actor.role === 'agent' && u.role === 'project_admin' && u.agentId === actor.agentId ||
        actor.role === 'project_operator' && u.role === 'project_admin' && u.projectId === actor.projectId
      )
      const visible = users.filter(u => ['agent','project_admin'].includes(u.role) && canSee(u))
      if(path.startsWith('/api/admin/members/commerce')) {
        if(!['super_admin','agent'].includes(actor.role))fail(403,'无权查看经营账目')
        const orders=sql.prepare('SELECT * FROM package_orders ORDER BY rowid DESC').all().map(r=>({...JSON.parse(r.data),id:r.id,owner:r.owner})).filter(r=>actor.role==='super_admin'||r.source===actor.id)
        if(path==='/api/admin/members/commerce' && method==='GET')return {orders:orders.map(r=>{
          const s=sql.prepare('SELECT * FROM settlements WHERE id=?').get(r.id)
          return {...r,customer:users.find(u=>u.id===r.owner)?.displayName||r.owner,settlement:s?{...JSON.parse(s.data),revision:s.revision}:{receivedCents:0,refundedCents:0,costCents:null,revision:0}}
        })}
        const order=orders.find(r=>r.id===body.id)
        if(!order)fail(403,'无权修改此订单')
        if(path==='/api/admin/members/commerce/history' && method==='POST')return {entries:sql.prepare('SELECT actor,data,created_at FROM settlement_audit WHERE order_id=? ORDER BY rowid DESC').all(order.id).map(r=>({...r,data:JSON.parse(r.data)}))}
        if(path!=='/api/admin/members/commerce/save'||method!=='POST')fail(404,'接口不存在')
        const {receivedCents,refundedCents,costCents}=body
        if([receivedCents,refundedCents].some(n=>!Number.isSafeInteger(n)||n<0||n>100000000000)||refundedCents>receivedCents||costCents!==null&&(!Number.isSafeInteger(costCents)||costCents<0||costCents>100000000000))fail(400,'金额无效，退款不能超过实收')
        const reason=String(body.reason||'').trim()
        if(!reason||reason.length>500)fail(400,'请填写调整依据')
        return transact(()=>{
          const old=sql.prepare('SELECT * FROM settlements WHERE id=?').get(order.id)
          if(body.revision!==(old?.revision||0))fail(409,'账目已更新，请刷新')
          const data={receivedCents,refundedCents,costCents,reason},revision=(old?.revision||0)+1
          sql.prepare('INSERT INTO settlements VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(order.id,revision,JSON.stringify(data))
          sql.prepare('INSERT INTO settlement_audit VALUES(?,?,?,?,?)').run(randomUUID(),order.id,actor.management?.actorId||actor.id,JSON.stringify({before:old?JSON.parse(old.data):null,after:data,revision}),new Date().toISOString())
          return {ok:true}
        })
      }
      if(path === '/api/admin/members/packages' && method === 'GET') {
        if(!['super_admin','agent'].includes(actor.role))fail(403,'无权查看供货套餐')
        return { packages:sql.prepare('SELECT * FROM packages WHERE deleted=0').all().map(p=>({...JSON.parse(p.data),id:p.id,revision:p.revision})).filter(p=>actor.role==='super_admin'||p.status==='active'), canEdit:actor.role==='super_admin' }
      }
      if(path === '/api/admin/members/packages/save' && method === 'POST') {
        if(actor.role!=='super_admin')fail(403,'套餐标准仅总后台可修改')
        const name=String(body.name || '').trim()
        if(!name || name.length>80)fail(400,'请填写80字以内套餐名称')
        const quantities=Object.fromEntries(Object.keys(resources).map(k=>[k,body.quantities?.[k]??0]))
        if(Object.values(quantities).some(n=>!Number.isSafeInteger(n)||n<0||n>100000000000))fail(400,'套餐额度需为非负整数')
        if(!Object.values(quantities).some(n=>n>0))fail(400,'套餐至少配置一项额度')
        if(!Number.isSafeInteger(body.priceCents)||body.priceCents<0||body.priceCents>100000000000)fail(400,'价格无效')
        if(!Number.isSafeInteger(body.days)||body.days<1||body.days>3650)fail(400,'有效期需为1至3650天')
        if(!['active','disabled'].includes(body.status))fail(400,'套餐状态无效')
        return transact(()=>{
          const old=body.id?sql.prepare('SELECT * FROM packages WHERE id=? AND deleted=0').get(body.id):null
          if(body.id && !old)fail(404,'套餐不存在')
          if(old && old.revision!==body.revision)fail(409,'套餐已变化，请刷新')
          const id=old?.id||randomUUID(),revision=(old?.revision||0)+1
          const data={name,quantities,priceCents:body.priceCents,days:body.days,status:body.status}
          sql.prepare('INSERT INTO packages(id,revision,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(id,revision,JSON.stringify(data))
          return {package:{...data,id,revision}}
        })
      }
      if(path === '/api/admin/members/packages/delete' && method === 'POST') {
        if(actor.role!=='super_admin')fail(403,'仅总后台可删除套餐')
        const r=sql.prepare('UPDATE packages SET deleted=1,revision=revision+1 WHERE id=? AND revision=? AND deleted=0').run(body.id,body.revision)
        if(!r.changes)fail(409,'套餐已变化，请刷新')
        return {ok:true}
      }
      if(path === '/api/admin/members/packages/apply' && method === 'POST') {
        const target=visible.find(u=>u.id===body.userId)
        if(!target || target.id===actor.id || !['super_admin','agent'].includes(actor.role))fail(403,'不能为此账户分配套餐')
        if(!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId||''))fail(400,'请求编号无效')
        if(!Number.isSafeInteger(body.saleCents)||body.saleCents<0||body.saleCents>100000000000)fail(400,'销售登记金额无效')
        const reason=String(body.reason||'').trim()
        if(!reason || reason.length>500)fail(400,'请填写分配原因')
        return transact(()=>{
          const initial=body.initialAllocation
          if(initial && !enrollment)fail(400,'自定义开户额度只能在新增账户时使用')
          if(initial && (typeof initial!=='object'||!initial.quantities||Object.keys(initial.quantities).length!==Object.keys(resources).length||Object.keys(resources).some(k=>!Number.isSafeInteger(initial.quantities[k])||initial.quantities[k]<0||initial.quantities[k]>100000000000)||!Number.isSafeInteger(initial.days)||initial.days<1||initial.days>3650))fail(400,'请完整填写开户额度和有效天数')
          const id=`${actor.id}:package:${body.requestId}`,fingerprint=JSON.stringify([target.id,body.packageId,body.revision,body.saleCents,reason,...(initial?[initial]:[])])
          const previous=sql.prepare('SELECT * FROM package_orders WHERE id=?').get(id)
          if(previous){if(previous.fingerprint!==fingerprint)fail(409,'请求已用于其他分配');return {ok:true,duplicate:true}}
          const row=initial ? {id:'custom-opening',revision:1,data:JSON.stringify({name:'自定义开户额度',quantities:initial.quantities,days:initial.days,priceCents:0,status:'active'})} : sql.prepare('SELECT * FROM packages WHERE id=? AND deleted=0').get(body.packageId)
          if(!row)fail(404,'套餐不存在')
          const p=JSON.parse(row.data)
          if(!initial && (row.revision!==body.revision || p.status!=='active'))fail(409,'套餐已调整或停用，请刷新')
          const source=actor.role==='agent'?actor.id:'', at=new Date().toISOString()
          const write=(owner,other,key,delta)=>{
            const amounts=update(owner,key,delta)
            sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${id}:${owner}:${key}`,fingerprint,actor.management?.actorId||actor.id,actor.id,owner,other,key,delta,amounts.before,amounts.after,`套餐 ${p.name}：${reason}`,at)
          }
          for(const [key,quantity] of Object.entries(p.quantities)) {
            if(source && quantity>0)write(source,target.id,key,-quantity)
            // Zero article quotas are explicit, not an unlimited trial.
            if(quantity>0 || key==='articles')write(target.id,source,key,quantity)
          }
          const current=sql.prepare('SELECT data FROM memberships WHERE owner=?').get(target.id)
          const from=Math.max(Date.now(),current?Date.parse(JSON.parse(current.data).expiresAt):0)
          const data={packageId:row.id,revision:row.revision,snapshot:p,saleCents:body.saleCents,source,reason,createdAt:at,expiresAt:new Date(from+p.days*86400000).toISOString()}
          sql.prepare('INSERT INTO package_orders VALUES(?,?,?,?)').run(id,fingerprint,target.id,JSON.stringify(data))
          sql.prepare('INSERT INTO memberships VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(target.id,JSON.stringify(data))
          if(enrollment) {
            if(enrollment.id!==target.id)fail(400,'开户账户不匹配')
            sql.prepare('INSERT INTO enrollments VALUES(?,?)').run(enrollment.id,JSON.stringify(enrollment))
          }
          return {ok:true,membership:data}
        })
      }
      if (method === 'GET' && path === '/api/admin/members') return { members: visible.map(u => ({ id:u.id, username:u.username, displayName:u.displayName, role:u.role, agentId:u.agentId, resources:summary(u.id) })), resources, actorId:actor.id, canAdjust:['super_admin','agent'].includes(actor.role) }
      if (method === 'POST' && path === '/api/admin/members/history') {
        const target = users.find(u => u.id === body.userId)
        if (!target || !canSee(target)) fail(403, '不能查看此账户')
        const entries = sql.prepare('SELECT * FROM entries WHERE owner=? ORDER BY rowid DESC LIMIT 200').all(target.id)
        return { entries }
      }
      if(method==='POST'&&path==='/api/admin/members/adjust-many'){
        const target=visible.find(u=>u.id===body.userId)
        if(!target||target.id===actor.id||!['super_admin','agent'].includes(actor.role))fail(403,'不能调整此账户额度')
        const changes=body.changes,reason=String(body.reason||'').trim()
        if(!Array.isArray(changes)||!changes.length||changes.length>8||new Set(changes.map(c=>c.resource)).size!==changes.length||changes.some(c=>!Object.hasOwn(resources,c.resource)||!Number.isSafeInteger(c.delta)||!c.delta||Math.abs(c.delta)>100000000000||!Number.isSafeInteger(c.expectedAvailable)))fail(400,'额度调整数据无效')
        if(!reason||reason.length>500||!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId||''))fail(400,'请填写调整原因和有效请求编号')
        const source=actor.role==='agent'?actor.id:'',key=`${actor.id}:batch:${body.requestId}`,fingerprint=JSON.stringify([target.id,changes,reason,source])
        return transact(()=>{
          const previous=sql.prepare('SELECT * FROM entries WHERE request_key=?').get(key+':0')
          if(previous){if(previous.fingerprint!==fingerprint)fail(409,'请求编号已用于其他调整');return {ok:true,duplicate:true}}
          for(const c of changes){
            const available=balance(target.id,c.resource).available
            if(available!==c.expectedAvailable)fail(409,`${resources[c.resource]}已变化，请刷新额度后修改`)
            if(available+c.delta<0)fail(409,`${resources[c.resource]}不能小于0`)
            if(source&&balance(source,c.resource).available<c.delta)fail(409,`上级代理的${resources[c.resource]}不足，无法分配给客户`)
          }
          const at=new Date().toISOString()
          changes.forEach((c,i)=>{
            const write=(owner,other,delta,suffix)=>{const b=update(owner,c.resource,delta);sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),`${key}:${i}${suffix}`,fingerprint,actor.management?.actorId||actor.id,actor.id,owner,other,c.resource,delta,b.before,b.after,reason,at)}
            if(source)write(source,target.id,-c.delta,':source')
            write(target.id,source,c.delta,'')
          })
          return {ok:true,resources:summary(target.id)}
        })
      }
      if (method !== 'POST' || path !== '/api/admin/members/adjust') fail(404, '接口不存在')
      const target = visible.find(u => u.id === body.userId)
      if (!target || target.id === actor.id || !['super_admin','agent'].includes(actor.role)) fail(403, '不能调整此账户额度')
      if (!Object.hasOwn(resources, body.resource) || !Number.isSafeInteger(body.delta) || body.delta === 0 || Math.abs(body.delta) > 100000000000) fail(400, '请输入有效的额度整数')
      const reason = String(body.reason || '').trim()
      if (!reason || reason.length > 500) fail(400, '请填写500字以内的调整原因')
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId || '')) fail(400, '请求编号无效')
      const source = actor.role === 'agent' ? actor.id : ''
      const fingerprint = JSON.stringify([target.id, body.resource, body.delta, reason, source])
      const key = `${actor.id}:${body.requestId}`
      return transact(() => {
        const existing = sql.prepare('SELECT * FROM entries WHERE request_key=?').get(key)
        if (existing) {
          if (existing.fingerprint !== fingerprint) fail(409, '请求编号已用于其他调整，请刷新')
          return { ok:true, duplicate:true, transactionId:existing.id }
        }
        const ownBalance = balance(target.id, body.resource).available
        if (body.expectedAvailable !== ownBalance) fail(409, '账户额度已变化，请刷新后再调整')
        const at = new Date().toISOString(), id = randomUUID()
        const write = (owner, counterparty, delta, requestKey) => {
          const amount = update(owner, body.resource, delta)
          sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id+(owner===target.id?'':':source'),requestKey,fingerprint,actor.management?.actorId || actor.id,actor.id,owner,counterparty,body.resource,delta,amount.before,amount.after,reason,at)
        }
        if (source) write(source,target.id,-body.delta,`${key}:source`)
        write(target.id,source,body.delta,key)
        return { ok:true, transactionId:id }
      })
    }
  }
}
