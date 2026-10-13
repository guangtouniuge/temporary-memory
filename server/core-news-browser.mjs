import http from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { visibleFields, updateField } from './core-news-fields.mjs'
import { taskBatches, allocateBatch } from './core-news-batches.mjs'
import { selectedMedia } from './core-news-media.mjs'
const require = createRequire(import.meta.url)
const { fillEditor } = require('../desktop-news/fill-editor.cjs')
const { prepareDraft, articlesForBrand } = require('../desktop-news/policy.cjs')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const digest = value => createHash('sha256').update(value).digest('hex')
const WIDTH = 1280, HEIGHT = 800
export function newsURL(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.hostname === 'xinwen.7chacha.com' && !u.port && !u.username && !u.password } catch { return false }
}

export function createBrowserPool({ chromium, directory, max = 2, home = 'http://xinwen.7chacha.com/', allowed = newsURL, launchOptions = {} }) {
  const sessions = new Map()
  async function close(key) {
    const entry = sessions.get(key)
    if (!entry || entry.busy) return
    entry.busy = true
    try { await (await entry.ready).context.close() } catch {} finally { if(sessions.get(key)===entry)sessions.delete(key) }
  }
  const timer = setInterval(() => { for (const [key, entry] of sessions) if (Date.now() - entry.used > 10 * 60_000) void close(key) }, 30_000)
  timer.unref()
  async function open(key) {
    if (sessions.has(key)) return sessions.get(key).ready
    if (sessions.size >= max) fail(429, '新闻浏览器繁忙，请稍后重试')
    const entry = { used: Date.now(), busy: false }
    sessions.set(key, entry)
    entry.ready = (async () => {
      const profile = resolve(directory, digest(key))
      await mkdir(profile, { recursive: true, mode: 0o700 })
      const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: WIDTH, height: HEIGHT }, acceptDownloads: false, serviceWorkers: 'block', ...launchOptions })
      try {
        await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort())
        await context.routeWebSocket('**/*', ws => ws.close())
        const page = context.pages()[0] || await context.newPage()
        page.setDefaultTimeout(5000)
        page.on('dialog', dialog => void dialog.dismiss())
        context.on('page', popup => {
          if (popup === page) return
          popup.on('framenavigated', frame => { if (frame === popup.mainFrame() && allowed(frame.url())) { void page.goto(frame.url()).catch(() => {}); void popup.close().catch(() => {}) } })
        })
        await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 25000 })
        return { context, page }
      } catch (error) { await context.close(); throw error }
    })().catch(error => { sessions.delete(key); throw error })
    return entry.ready
  }
  async function use(key, action) {
    const entry = sessions.get(key)
    if (!entry) fail(409, '请先连接新闻平台')
    if (entry.busy) fail(409, '正在处理上一项操作，请稍后重试')
    entry.busy = true; entry.used = Date.now()
    try { return await action((await entry.ready).page) } finally { entry.busy = false; entry.used = Date.now() }
  }
  return { open, use, close, async shutdown() { clearInterval(timer); for (const entry of sessions.values()) { try { await (await entry.ready).context.close() } catch {} } sessions.clear() } }
}

export function createNewsBrowserServer({ pool, api = 'http://127.0.0.1:8788', origin = 'https://geoskill.7chacha.com', fetcher = fetch }) {
  const catalogs = new Map()
  const apiJSON = async (cookie, path, user) => {
    const response = await fetcher(api + path, { headers: { cookie, ...(user ? { 'x-geo-workspace': user.workspaceId } : {}) }, signal: AbortSignal.timeout(path.startsWith('/api/jobs/') || path.includes('geo.articleRows') ? 60000 : 10000) })
    if (!response.ok) fail(response.status, response.status === 401 ? '登录已失效，请重新登录原系统' : '读取原系统资料失败')
    return response.json()
  }
  const batchData = async (cookie, user, id) => {
    const brand = (await apiJSON(cookie, '/api/state?key=geo.activeBrand', user)).value
    const tasks = (await apiJSON(cookie, '/api/state?key=geo.taskRows', user)).value
    const batches = taskBatches(tasks, [], brand)
    if (!id) return { brand, batches }
    const batch = batches.find(item => item.id === id)
    if (!batch) fail(404, '当前品牌没有这个任务批次，请重新读取')
    const source = batch.jobId ? (await apiJSON(cookie, '/api/jobs/status?id=' + encodeURIComponent(batch.jobId), user)).job?.articles : (await apiJSON(cookie, '/api/state?key=geo.articleRows', user)).value
    const articles = articlesForBrand(source, brand).filter(row => batch.jobId || (batch.batchId ? row.batchId === batch.batchId : !row.batchId && row.taskName === batch.name))
    return { brand, batch: { ...batch, available: articles.length, articles } }
  }
  const selectionData = async (cookie, user, ids) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail(400, '请选择1到50个不同的任务批次')
    const selected = [], articles = new Map()
    let brand
    for (const id of ids) {
      const data = await batchData(cookie, user, id)
      if (brand !== undefined && brand !== data.brand) fail(409, '当前品牌已切换，请重新读取批次')
      brand = data.brand
      selected.push({ ...data.batch, articles: undefined })
      for (const article of data.batch.articles) articles.set(article.id, article)
    }
    return { brand, batches: selected, articles: [...articles.values()] }
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
    try {
      if (req.method !== 'POST') fail(405, '仅接受系统内操作')
      if (req.headers.origin !== origin) fail(403, '请从原系统进入新闻源')
      if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '请求格式错误')
      const cookie = req.headers.cookie || ''
      if (!cookie) fail(401, '请先登录原系统')
      const { user } = await apiJSON(cookie, '/api/auth/me')
      if (!user?.id || !user.workspaceId || !['project_admin', 'project_operator'].includes(user.role)) fail(403, '请进入企业项目后使用新闻源')
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, '请求过大'); chunks.push(chunk) }
      const raw = Buffer.concat(chunks).toString('utf8')
      let body; try { body = JSON.parse(raw || '{}') } catch { fail(400, '请求格式错误') }
      const key = `${user.id}:${user.workspaceId}`
      const action = new URL(req.url, origin).pathname.replace('/api/core-news-browser/', '')
      if (action === 'open') { await pool.open(key); return json(200, { ok: true, width: WIDTH, height: HEIGHT }) }
      if (action === 'close') { await pool.close(key); return json(200, { ok: true }) }
      if (action === 'batches' || action === 'batch') {
        if (action === 'batch' && typeof body.batchId !== 'string') fail(400, '请选择任务批次')
        const data = await batchData(cookie, user, action === 'batch' ? body.batchId : null)
        if (data.batch) data.batch.articles = data.batch.articles.map(({ id, title }) => ({ id, title }))
        return json(200, { ok: true, identity: key, ...data })
      }
      if (action === 'selection') {
        const data = await selectionData(cookie, user, body.batchIds)
        return json(200, { ok: true, identity: key, ...data, articles: data.articles.map(({ id, title }) => ({ id, title })), articleCount: data.articles.length })
      }
      if (action === 'media') {
        const media = await pool.use(key, page => selectedMedia(page))
        for (const [id, catalog] of catalogs) if (Date.now() - catalog.time > 300000) catalogs.delete(id)
        catalogs.set(key, { media, time: Date.now() })
        return json(200, { ok: true, media })
      }
      if (action === 'plan') {
        if (body.identity !== key) fail(409, '账号已切换，请重新读取任务')
        const catalog = catalogs.get(key)
        if (!catalog || Date.now() - catalog.time > 300000) fail(409, '媒体信息已过期，请重新读取平台已选媒体')
        if (!Array.isArray(body.targets) || body.targets.length > 200) fail(400, '媒体数量无效')
        const targets = body.targets.map(target => {
          const media = catalog.media.find(row => row.id === target.id)
          if (!media) fail(400, '只能选择当前新闻平台已核验的媒体')
          return { ...media, count: target.count }
        })
        const selected = await selectionData(cookie, user, body.batchIds || [body.batchId])
        return json(200, { ok: true, batch: selected.batches.map(batch => batch.name).join('、'), ...allocateBatch(selected.articles, targets), canSubmit: false, submissionBlocker: '尚未完成此新闻平台的下单与回执适配，当前仅生成分配清单，不提交订单' })
      }
      if (action === 'articles' || action === 'fill') {
        const brand = (await apiJSON(cookie, '/api/state?key=geo.activeBrand', user)).value
        const rows = body.batchIds ? (await selectionData(cookie, user, body.batchIds)).articles : body.batchId ? (await batchData(cookie, user, body.batchId)).batch.articles : articlesForBrand((await apiJSON(cookie, '/api/state?key=geo.articleRows', user)).value, brand)
        if (action === 'articles') return json(200, { ok: true, brand, identity: key, rows: rows.map(({ id, title }) => ({ id, title })) })
        if (body.identity !== key || body.confirmed !== true) fail(409, '账号已切换或尚未确认，请重新选择文章')
        const article = rows.find(row => row.id === body.id)
        if (!article) fail(404, '当前品牌没有这篇文章')
        const draft = await prepareDraft(article)
        const result = await pool.use(key, async page => {
          if (!newsURL(page.url()) || !new URL(page.url()).pathname.startsWith('/user/')) fail(409, '请先在下方登录新闻平台，并打开空白文章发布页')
          return page.evaluate(fillEditor, draft)
        })
        return json(200, { ok: true, ...result })
      }
      if (action === 'frame') {
        const frame = await pool.use(key, async page => ({ url: page.url(), fields: await visibleFields(page), image: (await page.screenshot({ type: 'jpeg', quality: 75, timeout: 8000 })).toString('base64') }))
        return json(200, { ok: true, ...frame })
      }
      if (action === 'input') {
        await pool.use(key, async page => {
          if (body.type === 'field' || body.type === 'focus') {
            await updateField(page, { id: body.id, text: body.text, focusOnly: body.type === 'focus' })
          } else if (body.type === 'click') {
            if (!Number.isFinite(body.x) || !Number.isFinite(body.y) || body.x < 0 || body.y < 0 || body.x >= WIDTH || body.y >= HEIGHT) fail(400, '点击位置无效')
            await page.mouse.click(body.x, body.y)
          } else if (body.type === 'text') {
            if (typeof body.text !== 'string' || body.text.length > 4000) fail(400, '输入内容过长')
            await page.keyboard.insertText(body.text)
          } else if (body.type === 'key') {
            if (!['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Control+a', 'Escape'].includes(body.key)) fail(400, '不支持该快捷键')
            await page.keyboard.press(body.key)
          } else if (body.type === 'wheel') {
            if (!Number.isFinite(body.y)) fail(400, '滚动参数无效')
            await page.mouse.wheel(0, Math.max(-1500, Math.min(1500, body.y)))
          } else fail(400, '未知操作')
        })
        return json(200, { ok: true })
      }
      if (['reload', 'back', 'home', 'login', 'orders'].includes(action)) {
        const destinations = { home: 'http://xinwen.7chacha.com/', login: 'http://xinwen.7chacha.com/login.html', orders: 'http://xinwen.7chacha.com/user/order/index.html' }
        await pool.use(key, page => action === 'reload' ? page.reload({ waitUntil: 'domcontentloaded' }) : action === 'back' ? page.goBack({ waitUntil: 'domcontentloaded' }) : page.goto(destinations[action], { waitUntil: 'domcontentloaded' }))
        return json(200, { ok: true })
      }
      fail(404, '操作不存在')
    } catch (error) { if (!res.headersSent) json(error.status || 502, { ok: false, error: error.status ? error.message : '新闻平台响应失败，请重试；未自动提交订单' }) }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { chromium } = await import('playwright')
  const pool = createBrowserPool({ chromium, directory: process.env.NEWS_BROWSER_DATA || './outputs/news-browser', max: 2, launchOptions: { chromiumSandbox: true, ...(process.env.NEWS_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NEWS_CHROMIUM_EXECUTABLE } : {}) } })
  const server = createNewsBrowserServer({ pool })
  server.listen(Number(process.env.NEWS_BROWSER_PORT || 8792), '127.0.0.1')
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { server.close(); await pool.shutdown(); process.exit(0) })
}
