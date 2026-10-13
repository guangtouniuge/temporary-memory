// Scoped enhancement for the existing core-news page; other routes stay untouched.
const PREFIX = '/api/core-news-browser/'
export function mountCoreNews(host) {
  host.replaceChildren()
  host.dataset.remoteNews = 'true'
  let alive = true, connected = false, rows = [], identity = '', page = 0, timer, busy = false
  let batches = [], activeBatchIds = [], chosenMedia = [], batchPage = 0, selectionVersion = 0
  const selectedBatches = new Set()
  let queue = Promise.resolve()
  const native = window.geoNewsClient
  let tab = 'work'
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node }
  const status = el('p', '', 'cn-status'); status.setAttribute('role', 'status')
  const request = async (action, body = {}) => {
    if (native) {
      const result = await native.request(action, body)
      if (!result.ok) throw Error(result.error || '客户端操作失败')
      return { ok: true, ...result.value }
    }
    const response = await fetch(PREFIX + action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(['batch', 'selection', 'fill', 'plan'].includes(action) ? 180000 : 35000) })
    let data; try { data = await response.json() } catch { throw Error('新闻连接服务尚未就绪，请稍后重试') }
    if (!response.ok || !data.ok) { if (response.status === 401 || response.status === 403) { connected = false; image.removeAttribute('src'); renderFields([]); rows = []; select.replaceChildren() } throw Error(data.error || '新闻平台连接失败') }
    return data
  }
  const run = fn => {
    queue = queue.then(async () => { if (!alive) return; busy = true; try { await fn() } catch (error) { status.textContent = error.message } finally { busy = false } })
    return queue
  }
  const button = (text, action, cls) => { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => run(action); return b }
  const heading = el('div', '', 'cn-heading'); heading.append(el('strong', '核心新闻源'))
  const openPlatform = async () => {
    switchTab('platform')
    platformState.textContent = '正在连接新闻源平台'
    try {
      if (!connected) { await request('open'); connected = true }
      await frame(); reportViewport(); platformState.textContent = '新闻源平台已连接'; status.textContent = ''
    } catch (error) { platformState.textContent = error.message; throw error }
  }
  const connect = button('打开新闻源平台', openPlatform, 'cn-primary')
  heading.append(connect)
  const tools = el('div', '', 'cn-tools')
  const select = el('select'); select.setAttribute('aria-label', '选择当前品牌文章')
  const count = el('span', '0篇')
  const render = () => {
    select.replaceChildren(new Option('选择当前品牌文章', ''))
    for (const row of rows.slice(page * 20, page * 20 + 20)) select.add(new Option(row.title, row.id))
    count.textContent = `${rows.length}篇 · ${page + 1}/${Math.max(1, Math.ceil(rows.length / 20))}页`
    prev.disabled = page === 0; next.disabled = (page + 1) * 20 >= rows.length
  }
  const prev = button('上一页', () => { page--; render() })
  const next = button('下一页', () => { page++; render() })
  tools.append(select, prev, count, next, button('填入文章', async () => {
    if (!connected) throw Error('请先连接新闻平台')
    const id = select.value; if (!id) throw Error('请先选择文章')
    if (!confirm('将所选文章标题和正文填入新闻平台？不会自动提交订单。图片需在平台另行补充。')) return
    const result = await request('fill', { id, identity, batchIds: activeBatchIds, confirmed: true })
    if (result.cancelled) { status.textContent = '已取消填稿'; return }
    status.textContent = '稿件已填入，未提交订单。请核对媒体、图片和费用。'; switchTab('platform'); await frame()
  }, 'cn-primary'))
  const batchTools = el('div', '', 'cn-tools')
  const batchTable = el('table', '', 'cn-batch-table')
  const batchWrap = el('div', '', 'cn-batch-wrap'); batchWrap.append(batchTable)
  const batchDetails = el('details'); batchDetails.open = true
  batchDetails.append(el('summary', '任务批次'), batchWrap)
  const batchPager = el('div', '', 'cn-tools')
  const batchPageLabel = el('span')
  const batchPrevious = button('上一页批次', () => { batchPage--; renderBatches() })
  const batchNext = button('下一页批次', () => { batchPage++; renderBatches() })
  batchPager.append(batchPrevious, batchPageLabel, batchNext); batchDetails.append(batchPager)
  const batchInfo = el('p', '尚未选择任务批次', 'cn-status')
  const mediaPanel = el('div', '', 'cn-media-panel'); mediaPanel.hidden = true
  const mediaRows = el('div', '', 'cn-media-rows')
  const mediaTotal = el('p', '', 'cn-status')
  const planResult = el('div', '', 'cn-plan')
  const clearPlan = () => { planResult.replaceChildren(); chosenMedia = []; mediaRows.replaceChildren(); mediaTotal.textContent = '' }
  const summary = () => {
    const selected = batches.filter(batch => selectedBatches.has(batch.id))
    batchInfo.textContent = `已选${selected.length}个批次 · 记录已生成${selected.reduce((sum, batch) => sum + (Number(batch.completed) || 0), 0)}篇 · ${activeBatchIds.length ? '实际可用' + rows.length + '篇（已去重）' : '实际可用篇数待读取'}`
  }
  const invalidateSelection = () => { selectionVersion++; rows = []; activeBatchIds = []; page = 0; render(); clearPlan(); mediaPanel.hidden = true; summary() }
  const renderBatches = () => {
    batchTable.replaceChildren()
    const thead = el('thead'), head = el('tr')
    for (const title of ['选择', '任务批次', '计划文章', '已生成', '可用文章']) head.append(el('th', title))
    thead.append(head); batchTable.append(thead)
    const tbody = el('tbody')
    for (const batch of batches.slice(batchPage * 20, batchPage * 20 + 20)) {
      const tr = el('tr'), cell = el('td'), checkbox = el('input')
      checkbox.type = 'checkbox'; checkbox.checked = selectedBatches.has(batch.id); checkbox.setAttribute('aria-label', `选择批次：${batch.name}`)
      checkbox.onchange = () => { if (checkbox.checked && selectedBatches.size >= 50) { checkbox.checked = false; status.textContent = '一次最多选择50个批次'; return }; checkbox.checked ? selectedBatches.add(batch.id) : selectedBatches.delete(batch.id); invalidateSelection() }
      cell.append(checkbox); tr.append(cell, el('td', batch.name), el('td', `${batch.planned}篇`), el('td', `${batch.completed}篇`), el('td', Number.isInteger(batch.availableVerified) ? `${batch.availableVerified}篇` : '待读取')); tbody.append(tr)
    }
    if (!batches.length) { const tr = el('tr'), cell = el('td', '暂无任务批次'); cell.colSpan = 5; tr.append(cell); tbody.append(tr) }
    batchTable.append(tbody)
    batchPageLabel.textContent = `共${batches.length}批 · 第${batchPage + 1}/${Math.max(1, Math.ceil(batches.length / 20))}页`
    batchPrevious.disabled = batchPage === 0; batchNext.disabled = (batchPage + 1) * 20 >= batches.length; summary()
  }
  batchTools.append(button('读取任务批次', async () => {
    selectedBatches.clear(); batches = []; batchPage = 0; identity = ''; invalidateSelection(); renderBatches(); batchDetails.open = true
    const data = await request('batches'); batches = data.batches; identity = data.identity
    renderBatches(); status.textContent = ''
  }), button('全选本页', () => {
    const ids = batches.slice(batchPage * 20, batchPage * 20 + 20).map(batch => batch.id)
    if (new Set([...selectedBatches, ...ids]).size > 50) throw Error('一次最多选择50个批次')
    ids.forEach(id => selectedBatches.add(id)); invalidateSelection(); renderBatches()
  }), button('清空选择', () => { selectedBatches.clear(); invalidateSelection(); renderBatches() }), button('读取所选批次文章', async () => {
    if (!selectedBatches.size) throw Error('请勾选一个或多个任务批次')
    invalidateSelection(); const version = selectionVersion; const ids = [...selectedBatches]
    status.textContent = `正在读取${ids.length}个批次的文章`
    const data = await request('selection', { batchIds: ids })
    if (version !== selectionVersion) { status.textContent = '批次勾选已变化，请重新读取'; return }
    rows = data.articles; identity = data.identity; activeBatchIds = ids; page = 0; render()
    for (const verified of data.batches) { const batch = batches.find(item => item.id === verified.id); if (batch) batch.availableVerified = verified.available }
    renderBatches(); mediaPanel.hidden = false
    status.textContent = rows.length ? '文章已合并，请在新闻源平台选择媒体' : '这些批次暂时没有可发布的完整文章'
  }, 'cn-primary'))
  const mediaTools = el('div', '', 'cn-tools')
  const updateTotal = () => { mediaTotal.textContent = `媒体分配${chosenMedia.reduce((sum, row) => sum + (Number(row.input.value) || 0), 0)}篇 / 所选批次可用${rows.length}篇`; planResult.replaceChildren() }
  mediaTools.append(el('strong', '媒体与篇数'), button('读取平台已选媒体', async () => {
    if (!connected) throw Error('请先连接新闻平台并选择媒体')
    const data = await request('media'); clearPlan()
    for (const media of data.media) {
      const row = el('div', '', 'cn-tools')
      const name = el('span', media.name)
      const price = el('span', Number.isInteger(media.priceFen) ? `¥${(media.priceFen / 100).toFixed(2)}/篇` : '价格待核验')
      const input = el('input'); input.type = 'number'; input.min = '1'; input.max = String(Math.min(200, rows.length)); input.step = '1'; input.value = '1'; input.setAttribute('aria-label', `${media.name}发布篇数`); input.oninput = updateTotal
      row.append(name, price, input, el('span', '篇')); mediaRows.append(row); chosenMedia.push({ ...media, input })
    }
    updateTotal(); status.textContent = `读取到${data.media.length}家已选媒体`
  }), button('生成匹配清单', async () => {
    if (!activeBatchIds.length) throw Error('请先读取所选批次文章')
    const data = await request('plan', { identity, batchIds: activeBatchIds, targets: chosenMedia.map(row => ({ id: row.id, count: Number(row.input.value) })) })
    planResult.replaceChildren(el('p', `已分配${data.articleCount}篇，未分配${data.unassignedCount}篇；${data.totalFen === null ? '费用待核验' : '预计费用¥' + (data.totalFen / 100).toFixed(2)}`, 'cn-status'))
    const table = el('table'); const head = el('tr'); head.append(el('th', '文章'), el('th', '媒体'), el('th', '匹配依据')); table.append(head)
    for (const item of data.assignments) { const tr = el('tr'); tr.append(el('td', item.title), el('td', item.mediaName), el('td', item.reason)); table.append(tr) }
    planResult.append(table, el('p', data.submissionBlocker, 'cn-status'))
  }))
  mediaPanel.append(mediaTools, mediaRows, mediaTotal, planResult)
  mediaTools.append(button('平均分配', () => {
    if (!chosenMedia.length || !rows.length) throw Error('请先读取文章并选择媒体')
    if (chosenMedia.length > rows.length) throw Error('媒体数量超过文章数，请减少所选媒体')
    chosenMedia.forEach((media, index) => { media.input.value = String(Math.floor(rows.length / chosenMedia.length) + (index < rows.length % chosenMedia.length ? 1 : 0)) }); updateTotal()
  }))
  const manual = el('details'); manual.append(el('summary', '单篇填稿'), tools)
  const nav = el('div', '', 'cn-tools')
  const address = el('span', 'http://xinwen.7chacha.com/', 'cn-address')
  for (const [label, action] of [['平台登录', 'login'], ['发稿列表', 'orders'], ['返回', 'back'], ['刷新', 'reload'], ['平台首页', 'home']]) nav.append(button(label, async () => { if (!connected) await openPlatform(); await request(action); await frame() }))
  nav.append(address, button('断开', async () => { await request('close'); connected = false; image.removeAttribute('src'); renderFields([]); empty.hidden = false; platformState.textContent = '新闻源平台未连接'; status.textContent = '已断开，登录会话保留' }))
  const platformArea = el('section', '', 'cn-platform')
  const platformState = el('p', '新闻源平台未连接', 'cn-status'); platformState.setAttribute('role', 'status')
  const stage = el('div', '', 'cn-stage')
  const empty = el('div', '未连接新闻平台', 'cn-empty')
  const image = el('img'); image.alt = '新闻平台操作页面'; image.draggable = false
  const keyboard = el('textarea', '', 'cn-keyboard'); keyboard.setAttribute('aria-label', '新闻平台文字输入'); keyboard.autocomplete = 'off'; keyboard.spellcheck = false
  const fieldsLayer = el('div', '', 'cn-fields')
  const nativeFields = new Map()
  const fieldTimers = new Map()
  const flushField = (id, input) => {
    clearTimeout(fieldTimers.get(id)); fieldTimers.delete(id)
    const text = input.value
    return run(async () => { await request('input', { type: 'field', id, text }) })
  }
  const renderFields = fields => {
    const ids = new Set(fields.map(field => field.id))
    for (const [id, input] of nativeFields) if (!ids.has(id)) { clearTimeout(fieldTimers.get(id)); fieldTimers.delete(id); input.value = ''; input.remove(); nativeFields.delete(id) }
    for (const field of fields) {
      let input = nativeFields.get(field.id)
      if (!input) {
        input = el(field.type === 'textarea' ? 'textarea' : 'input')
        if (field.type !== 'textarea') input.type = field.type
        input.setAttribute('aria-label', field.label); input.autocomplete = field.type === 'password' ? 'current-password' : 'off'
        input.onfocus = () => run(() => request('input', { type: 'focus', id: field.id }))
        const schedule = () => { clearTimeout(fieldTimers.get(field.id)); fieldTimers.set(field.id, setTimeout(() => flushField(field.id, input), 120)) }
        input.oninput = event => { if (!event.isComposing) schedule() }
        input.oncompositionend = schedule
        input.onchange = schedule
        input.onblur = () => { if (fieldTimers.has(field.id)) flushField(field.id, input) }
        input.onkeydown = event => {
          if (event.key === 'Enter' && !event.isComposing && field.type !== 'textarea') {
            event.preventDefault(); if (fieldTimers.has(field.id)) flushField(field.id, input)
            run(async () => { await request('input', { type: 'key', key: 'Enter' }); await frame() })
          }
        }
        nativeFields.set(field.id, input); fieldsLayer.append(input)
      }
      input.placeholder = field.type === 'password' && field.filled && !input.value ? '已填写密码，输入可替换' : field.label
      if (field.type !== 'password' && document.activeElement !== input && !fieldTimers.has(field.id)) input.value = field.value || ''
      Object.assign(input.style, { left: `${field.x / 1280 * 100}%`, top: `${field.y / 800 * 100}%`, width: `${field.width / 1280 * 100}%`, height: `${field.height / 800 * 100}%` })
    }
  }
  stage.append(empty, image, fieldsLayer, keyboard)
  image.onload = () => { empty.hidden = true }
  const frame = async () => {
    const data = await request('frame')
    if (!alive || !connected) return
    address.textContent = data.url
    if (native) { empty.hidden = true; return }
    image.src = 'data:image/jpeg;base64,' + data.image
    renderFields(data.fields || [])
  }
  image.onclick = event => {
    if (!connected) return
    const r = image.getBoundingClientRect()
    const x = Math.max(0, Math.min(1279, (event.clientX - r.left) * 1280 / r.width))
    const y = Math.max(0, Math.min(799, (event.clientY - r.top) * 800 / r.height))
    keyboard.focus({ preventScroll: true })
    run(async () => { await request('input', { type: 'click', x, y }); await frame() })
  }
  const sendText = () => { const text = keyboard.value; keyboard.value = ''; if (text) run(async () => { await request('input', { type: 'text', text }); await frame() }) }
  keyboard.oninput = event => { if (!event.isComposing) sendText() }
  keyboard.oncompositionend = sendText
  keyboard.onkeydown = event => {
    if (event.isComposing) return
    const key = event.ctrlKey && event.key.toLowerCase() === 'a' ? 'Control+a' : event.shiftKey && event.key === 'Tab' ? 'Shift+Tab' : event.key
    if (['Tab', 'Shift+Tab', 'Enter', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Control+a', 'Escape'].includes(key)) { event.preventDefault(); run(async () => { await request('input', { type: 'key', key }); await frame() }) }
  }
  let wheel = 0, wheelTimer
  image.addEventListener('wheel', event => {
    if (!connected) return
    event.preventDefault(); wheel += event.deltaY
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { const y = wheel; wheel = 0; run(async () => { await request('input', { type: 'wheel', y }); await frame() }) }, 100)
  }, { passive: false })
  const style = el('style')
  style.textContent = '[data-remote-news]{min-width:0}[data-remote-news] .cn-heading,[data-remote-news] .cn-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}[data-remote-news] .cn-heading{justify-content:space-between}[data-remote-news] button,[data-remote-news] select{font:inherit;min-height:36px;padding:6px 12px;border:1px solid #dce4ef;background:white;border-radius:4px;color:#23405f}[data-remote-news] button{cursor:pointer}[data-remote-news] button:disabled{opacity:.45;cursor:default}[data-remote-news] .cn-primary{background:#2563eb;color:white;border-color:#2563eb}[data-remote-news] select{flex:1;min-width:180px;max-width:560px}[data-remote-news] .cn-status{font-size:13px;color:#53677c;line-height:1.7;overflow-wrap:anywhere;min-height:22px;margin:8px 0}[data-remote-news] .cn-address{flex:1;overflow-wrap:anywhere;font-size:13px;min-width:120px}[data-remote-news] .cn-stage{position:relative;border:1px solid #dce4ef;background:white;min-height:320px;overflow:hidden}[data-remote-news] .cn-stage img{display:block;width:100%;height:auto;aspect-ratio:8/5;cursor:default}[data-remote-news] .cn-stage img:not([src]){display:none}[data-remote-news] .cn-empty{padding:100px 20px;text-align:center;color:#687b93}[data-remote-news] .cn-keyboard{position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:.01;padding:0;border:0}[data-remote-news] strong{font-size:18px}'
  style.textContent += '[data-remote-news] .cn-fields{position:absolute;left:0;top:0;width:100%;aspect-ratio:8/5;pointer-events:none}[data-remote-news] .cn-fields input,[data-remote-news] .cn-fields textarea{position:absolute;pointer-events:auto;box-sizing:border-box;min-width:0;min-height:0;padding:4px 8px;border:1px solid #b6c5d8;border-radius:3px;font:14px "Microsoft YaHei",sans-serif;background:white;color:#172b45}[data-remote-news] .cn-fields input:focus,[data-remote-news] .cn-fields textarea:focus{outline:2px solid #2563eb;outline-offset:-2px}'
  style.textContent += '[data-remote-news] .cn-media-panel{margin:16px 0;padding:14px 0;border-top:1px solid #dce4ef;border-bottom:1px solid #dce4ef}[data-remote-news] .cn-media-panel[hidden]{display:none}[data-remote-news] .cn-media-rows input{width:80px;min-height:34px;border:1px solid #dce4ef;border-radius:4px;padding:4px 8px}[data-remote-news] .cn-plan{overflow:auto}[data-remote-news] .cn-plan table{width:100%;border-collapse:collapse;font-size:13px}[data-remote-news] .cn-plan th,[data-remote-news] .cn-plan td{border-bottom:1px solid #dce4ef;padding:8px;text-align:left}[data-remote-news] details{margin:12px 0}[data-remote-news] summary{cursor:pointer;margin-bottom:12px}'
  const notice = el('p', '新闻平台使用HTTP连接。最终发布由你在平台确认，图片上传暂未接通，审核以平台订单为准。', 'cn-status')
  style.textContent += '[data-remote-news] .cn-batch-wrap{overflow:auto}[data-remote-news] .cn-batch-table{width:100%;border-collapse:collapse;font-size:13px}[data-remote-news] .cn-batch-table td,[data-remote-news] .cn-batch-table th{text-align:left;padding:10px;border-bottom:1px solid #dce4ef}[data-remote-news] .cn-batch-table th{background:#f5f8fc;white-space:nowrap}[data-remote-news] .cn-batch-table input{width:16px;height:16px;min-height:0;margin:0}[data-remote-news] .cn-platform{scroll-margin-top:20px;margin-top:16px}[data-remote-news] .cn-platform h2{font-size:18px;margin:12px 0}'
  const tabs = el('div', '', 'cn-tabs'); tabs.setAttribute('role', 'tablist')
  const workTab = button('发布工作台', () => switchTab('work'))
  const platformTab = button('新闻平台', openPlatform)
  for (const item of [workTab, platformTab]) item.setAttribute('role', 'tab')
  tabs.append(workTab, platformTab)
  const workArea = el('div', '', 'cn-workspace')
  const articleColumn = el('section', '', 'cn-column')
  articleColumn.append(el('h2', '选择文章'), batchTools, batchInfo, batchDetails, manual)
  const platformColumn = el('section', '', 'cn-column')
  const platformActions = el('div', '', 'cn-tools')
  platformActions.append(button('打开平台选择媒体', openPlatform, 'cn-primary'))
  platformColumn.append(el('h2', '分配发布平台'), el('strong', '核心新闻源'), platformActions, mediaPanel)
  workArea.append(articleColumn, platformColumn)
  const reportViewport = () => {
    if (!native) return
    const rect = stage.getBoundingClientRect()
    const visible = alive && connected && tab === 'platform' && !document.hidden
    native.viewport(visible ? { x: rect.x, y: Math.max(0, rect.y), width: rect.width, height: Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.y)) } : null).catch(() => {})
  }
  function switchTab(value) {
    tab = value; workArea.hidden = value !== 'work'; platformArea.hidden = value !== 'platform'
    workTab.setAttribute('aria-selected', String(value === 'work')); platformTab.setAttribute('aria-selected', String(value === 'platform'))
    reportViewport()
  }
  platformArea.append(platformState, nav, stage, notice)
  style.textContent += '[data-remote-news] .cn-tabs{display:flex;gap:8px;border-bottom:1px solid #dce4ef;padding-bottom:12px;margin:12px 0 20px}[data-remote-news] [aria-selected=true]{background:#eaf1ff;color:#174bb6;border-color:#94b5fa}[data-remote-news] .cn-workspace{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px}[data-remote-news] .cn-column{min-width:0}[data-remote-news] .cn-column h2{font-size:18px;margin:0 0 16px}[data-remote-news] .cn-column>strong{display:block;margin-bottom:16px}[data-remote-news] .cn-workspace[hidden],[data-remote-news] .cn-platform[hidden]{display:none}[data-remote-news] .cn-batch-table td{overflow-wrap:anywhere}[data-remote-news] .cn-batch-table th:nth-child(n+3){white-space:normal}[data-remote-news] .cn-platform{margin-top:0}@media(max-width:1000px){[data-remote-news] .cn-workspace{grid-template-columns:minmax(0,1fr)}}'
  if (native) { stage.style.height = 'calc(100vh - 300px)'; stage.dataset.nativeViewport = 'true' }
  style.textContent += '[data-remote-news] .cn-batch-wrap{max-height:420px;overflow:auto}[data-remote-news] .cn-batch-table thead{position:sticky;top:0;z-index:1;background:#f5f8fc}'
  host.append(style, heading, tabs, status, workArea, platformArea); render(); renderBatches(); switchTab('work')
  const observer = new ResizeObserver(reportViewport); observer.observe(stage)
  window.addEventListener('scroll', reportViewport, true); window.addEventListener('resize', reportViewport); document.addEventListener('visibilitychange', reportViewport)
  const tick = async () => { if (!alive) return; if (connected && tab === 'platform' && !busy && !document.hidden) await run(frame); timer = setTimeout(tick, 1000) }
  timer = setTimeout(tick, 1000)
  return () => { alive = false; connected = false; observer.disconnect(); window.removeEventListener('scroll', reportViewport, true); window.removeEventListener('resize', reportViewport); document.removeEventListener('visibilitychange', reportViewport); reportViewport(); clearTimeout(timer); clearTimeout(wheelTimer); for (const pending of fieldTimers.values()) clearTimeout(pending); for (const input of nativeFields.values()) input.value = ''; image.removeAttribute('src'); keyboard.value = '' }
}
let current, dispose
function scan() {
  const host = document.querySelector('.core-news-source')
  if (host === current) return
  dispose?.(); current = host; dispose = host ? mountCoreNews(host) : undefined
}
if (typeof document !== 'undefined') {
  const start = () => { new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); scan() }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
}
