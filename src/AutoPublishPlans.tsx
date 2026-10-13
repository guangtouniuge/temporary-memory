import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, FileCheck2, Play, RefreshCw, Save, Trash2 } from 'lucide-react'
import { EmptyState } from './console-ui'
import { identityKey } from './project-scope'
import './auto-publish-plans.css'

type Request = <T>(path: string, body?: unknown, timeoutMs?: number) => Promise<T>
type ProjectRow = { name: string; coreKeyword?: string; industry?: string }
type PlanDay = {
  date: string
  weekday: number
  enabled: boolean
  plannedArticles: number
  mediaChannels: string[]
  favoriteFolder: string
  estimatedMaxCents: number
  status: string
}
type AutoPlan = {
  id: string
  brand: string
  name: string
  status: 'draft' | 'paused'
  startDate: string
  endDate: string
  weeklyTarget: number
  weekdays: number[]
  perRunCount: number
  generateLeadDays: number
  requireReview: boolean
  mediaPool: { name: string; channels: string[]; favoriteFolder: string; backupFolder: string; maxPriceCents: number }
  failurePolicy: { staleDays: number; action: string; maxRetry: number }
  generationPolicy: { articleType: string; writingDepth: string; allowAutoGenerate: boolean }
  notes: string
  preview: PlanDay[]
  updatedAt: string
}
type RunLog = { id: string; planId: string; brand: string; mode: string; status: string; message: string; taskName?: string; date?: string; createdAt: string }
type PrepareResult = { runs: RunLog[]; stock: { readyCount: number; requiredCount: number; shortage: number }; task?: { name: string }; job?: { id: string } }
type PublishDraft = {
  id: string
  brand: string
  status: string
  date: string
  createdAt: string
  mediaPool?: { channels?: string[]; favoriteFolder?: string }
  articles: { id: string; title: string }[]
}

const weekdays = [
  [1, '周一'],
  [2, '周二'],
  [3, '周三'],
  [4, '周四'],
  [5, '周五'],
  [6, '周六'],
  [7, '周日'],
] as const
const channelLabels: Record<string, string> = { news: '补充新闻', news2: '核心媒体', social: '自媒体', b2b: 'B2B' }
const failureLabels: Record<string, string> = { manual: '人工处理', refund: '自动退款', retry_same: '原媒体重试', retry_backup: '备用媒体补发' }
const emptyForm = {
  name: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  weeklyTarget: 5,
  weekdays: [1, 3, 5],
  perRunCount: 1,
  generateLeadDays: 2,
  requireReview: true,
  mediaPool: { name: '默认媒体池', channels: ['news2'], favoriteFolder: '默认收藏夹', backupFolder: '', maxPriceCents: 0 },
  failurePolicy: { staleDays: 2, action: 'manual', maxRetry: 1 },
  generationPolicy: { articleType: '按项目设置', writingDepth: '精选', allowAutoGenerate: false },
  notes: '',
}

export function AutoPublishPlans({ brand, projectRows, request, notify, navigate }: {
  brand: string
  projectRows: ProjectRow[]
  request: Request
  notify: (message: string) => void
  navigate?: (page: string) => void
}) {
  const [plans, setPlans] = useState<AutoPlan[]>([])
  const [runs, setRuns] = useState<RunLog[]>([])
  const [drafts, setDrafts] = useState<PublishDraft[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ ...emptyForm, brand: brand || projectRows[0]?.name || '' })
  const [busy, setBusy] = useState(false)
  const selected = plans.find(plan => plan.id === selectedId)
  const activeBrand = form.brand || brand || projectRows[0]?.name || ''
  const load = async () => {
    setBusy(true)
    try {
      const result = await request<{ plans: AutoPlan[]; runs: RunLog[] }>('/api/auto-publish/plans')
      const value = result as { plans: AutoPlan[]; runs: RunLog[]; drafts?: PublishDraft[] }
      setPlans(result.plans || [])
      setRuns(result.runs || [])
      setDrafts(value.drafts || [])
      if (!selectedId && result.plans?.[0]) setSelectedId(result.plans[0].id)
    } catch (error) {
      notify(error instanceof Error ? error.message : '自动计划读取失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!selected) return
    setForm({
      name: selected.name,
      brand: selected.brand,
      startDate: selected.startDate,
      endDate: selected.endDate || '',
      weeklyTarget: selected.weeklyTarget,
      weekdays: selected.weekdays,
      perRunCount: selected.perRunCount,
      generateLeadDays: selected.generateLeadDays,
      requireReview: selected.requireReview,
      mediaPool: selected.mediaPool,
      failurePolicy: selected.failurePolicy,
      generationPolicy: selected.generationPolicy,
      notes: selected.notes || '',
    })
  }, [selectedId])
  useEffect(() => {
    if (!selectedId) setForm(current => ({ ...current, brand: brand || current.brand || projectRows[0]?.name || '' }))
  }, [brand, selectedId, projectRows])
  const update = (patch: Partial<typeof form>) => setForm(current => ({ ...current, ...patch }))
  const updateMedia = (patch: Partial<typeof form.mediaPool>) => update({ mediaPool: { ...form.mediaPool, ...patch } })
  const updateFailure = (patch: Partial<typeof form.failurePolicy>) => update({ failurePolicy: { ...form.failurePolicy, ...patch } })
  const toggleWeekday = (day: number) => update({ weekdays: form.weekdays.includes(day) ? form.weekdays.filter(item => item !== day) : [...form.weekdays, day].sort() })
  const toggleChannel = (channel: string) => {
    const channels = form.mediaPool.channels.includes(channel)
      ? form.mediaPool.channels.filter(item => item !== channel)
      : [...form.mediaPool.channels, channel]
    updateMedia({ channels: channels.length ? channels : [channel] })
  }
  const save = async (status = selected?.status || 'draft') => {
    setBusy(true)
    try {
      const result = await request<{ plans: AutoPlan[]; plan: AutoPlan }>('/api/auto-publish/plans', { ...form, id: selectedId || undefined, status }, 30000)
      setPlans(result.plans || [])
      setSelectedId(result.plan.id)
      notify('自动发布计划已保存，暂不会影响现有发稿流程')
    } catch (error) {
      notify(error instanceof Error ? error.message : '计划保存失败')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!selected || !window.confirm(`确定删除“${selected.name}”？已创建的手动任务和订单不会被删除。`)) return
    setBusy(true)
    try {
      const result = await request<{ plans: AutoPlan[] }>('/api/auto-publish/delete', { id: selected.id }, 30000)
      setPlans(result.plans || [])
      setSelectedId('')
      notify('自动发布计划已删除')
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }
  const dryRun = async () => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await request<{ runs: RunLog[] }>('/api/auto-publish/dry-run', { id: selected.id }, 30000)
      setRuns(result.runs || [])
      notify('预演完成：未创建任务、未扣费、未发稿')
    } catch (error) {
      notify(error instanceof Error ? error.message : '预演失败')
    } finally {
      setBusy(false)
    }
  }
  const createTask = async (date?: string) => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await request<{ runs: RunLog[]; task: { name: string } }>('/api/auto-publish/create-task', { id: selected.id, date }, 30000)
      setRuns(result.runs || [])
      notify(`已生成普通文章任务：${result.task.name}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '生成任务失败')
    } finally {
      setBusy(false)
    }
  }
  const prepareDay = async (date?: string) => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await request<PrepareResult>('/api/auto-publish/prepare', { id: selected.id, date }, 30000)
      setRuns(result.runs || [])
      if (result.stock.shortage <= 0) notify(`库存充足：已有${result.stock.readyCount}篇，可满足${result.stock.requiredCount}篇`)
      else if (result.job) notify(`库存不足${result.stock.shortage}篇，已启动补稿任务`)
      else notify(`库存不足${result.stock.shortage}篇，已创建补稿任务：${result.task?.name || ''}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '备稿检查失败')
    } finally {
      setBusy(false)
    }
  }
  const createPublishDraft = async (date?: string) => {
    if (!selected) return
    setBusy(true)
    try {
      const result = await request<{ runs: RunLog[]; drafts: PublishDraft[]; draft: PublishDraft }>('/api/auto-publish/publish-draft', { id: selected.id, date }, 30000)
      setRuns(result.runs || [])
      setDrafts(result.drafts || [])
      notify(`已生成待确认投放包：${result.draft.articles.length}篇`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '生成投放包失败')
    } finally {
      setBusy(false)
    }
  }
  const openDraft = (draft: PublishDraft) => {
    const channels = draft.mediaPool?.channels || []
    const target = channels.includes('news2') ? 'media-news2' : channels.includes('social') ? 'distribution' : 'media-news'
    sessionStorage.setItem(`media-selection:${identityKey()}`, JSON.stringify(draft.articles.map(article => article.id)))
    notify(`已带入${draft.articles.length}篇文章，请选择媒体后确认发布`)
    navigate?.(target)
  }
  const preview = selected?.preview || []
  const estimatedTotal = preview.reduce((sum, day) => sum + day.estimatedMaxCents, 0)
  const plannedTotal = preview.reduce((sum, day) => sum + day.plannedArticles, 0)
  const currentRuns = runs.slice(0, 6)
  return <section className="auto-plan-page">
    <div className="auto-plan-hero">
      <div>
        <span className="auto-plan-eyebrow">发布计划</span>
        <h2>自动发布计划</h2>
        <p>按日期定好生成篇数、发布篇数、媒体和失败补发，后续按核心媒体投喂流程确认发布。</p>
      </div>
      <div className="auto-plan-primary-actions">
        <button className="ghost-button" disabled={busy} onClick={() => void load()}><RefreshCw size={16} />刷新</button>
        <button className="ghost-button" onClick={() => { setSelectedId(''); setForm({ ...emptyForm, brand: brand || projectRows[0]?.name || '' }) }}>新建计划</button>
        <button className="primary-button" disabled={busy || !activeBrand} onClick={() => void save()}><Save size={16} />保存计划</button>
      </div>
    </div>

    <div className="auto-plan-layout">
      <aside className="auto-plan-list panel">
        <div className="auto-plan-list-head"><h3>计划批次</h3><span>{plans.length} 个</span></div>
        {plans.map(plan => <button key={plan.id} className={plan.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(plan.id)}>
          <span className="auto-plan-list-title"><strong>{plan.name}</strong><em>{plan.status === 'paused' ? '暂停' : '草稿'}</em></span>
          <span>{plan.brand}</span>
          <small>生成 {plan.weeklyTarget} 篇 · 发布 {plan.perRunCount} 篇/次</small>
        </button>)}
        {!plans.length && <EmptyState title="暂无计划" description="按右侧流程保存第一条发布计划。" />}
      </aside>

      <div className="auto-plan-main">
        <section className="panel auto-plan-flow">
          <div className="auto-flow-head">
            <div>
              <h3>{selected ? selected.name : '新建发布计划'}</h3>
              <p>{selected ? `${selected.brand} · 最近更新 ${new Date(selected.updatedAt).toLocaleString('zh-CN')}` : '按发布流程填写，保存后再检查备稿和生成投放包。'}</p>
            </div>
            {selected && <button className="danger-button" disabled={busy} onClick={() => void remove()}><Trash2 size={16} />删除</button>}
          </div>
          <ol className="auto-flow-steps">
            <li><span>1</span><strong>日期</strong><small>哪几天执行</small></li>
            <li><span>2</span><strong>篇数</strong><small>生成和发布</small></li>
            <li><span>3</span><strong>媒体</strong><small>发布到哪里</small></li>
            <li><span>4</span><strong>补发</strong><small>失败后怎么补</small></li>
          </ol>

          <div className="auto-simple-section">
            <div className="auto-simple-title"><span>1</span><strong>计划和日期</strong></div>
            <div className="auto-simple-grid">
              <label>计划名称<input value={form.name} placeholder={`${activeBrand || '品牌'}自动发布计划`} onChange={e => update({ name: e.target.value })} /></label>
              <label>内容品牌<select value={form.brand} onChange={e => update({ brand: e.target.value })}><option value="">请选择品牌</option>{projectRows.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}</select></label>
              <label>开始日期<input type="date" value={form.startDate} onChange={e => update({ startDate: e.target.value })} /></label>
              <label>结束日期<input type="date" value={form.endDate} onChange={e => update({ endDate: e.target.value })} /></label>
            </div>
            <div className="auto-chip-row auto-weekdays" aria-label="执行日期">{weekdays.map(([day, label]) => <button type="button" key={day} aria-pressed={form.weekdays.includes(day)} onClick={() => toggleWeekday(day)}>{label}</button>)}</div>
          </div>

          <div className="auto-simple-section">
            <div className="auto-simple-title"><span>2</span><strong>生成和发布篇数</strong></div>
            <div className="auto-simple-grid compact">
              <label>生成篇数/周<input type="number" min="1" max="200" value={form.weeklyTarget} onChange={e => update({ weeklyTarget: Number(e.target.value) })} /></label>
              <label>每次发布篇数<input type="number" min="1" max="100" value={form.perRunCount} onChange={e => update({ perRunCount: Number(e.target.value) })} /></label>
            </div>
          </div>

          <div className="auto-simple-section">
            <div className="auto-simple-title"><span>3</span><strong>发布媒体</strong></div>
            <div className="auto-chip-row" aria-label="媒体渠道">{Object.entries(channelLabels).map(([key, label]) => <button type="button" key={key} aria-pressed={form.mediaPool.channels.includes(key)} onClick={() => toggleChannel(key)}>{label}</button>)}</div>
            <div className="auto-simple-grid compact">
              <label>媒体收藏夹<input value={form.mediaPool.favoriteFolder} onChange={e => updateMedia({ favoriteFolder: e.target.value })} /></label>
              <label>单篇预算上限<input type="number" min="0" value={form.mediaPool.maxPriceCents ? form.mediaPool.maxPriceCents / 100 : ''} placeholder="不限" onChange={e => updateMedia({ maxPriceCents: Math.round(Number(e.target.value || 0) * 100) })} /></label>
            </div>
          </div>

          <div className="auto-simple-section">
            <div className="auto-simple-title"><span>4</span><strong>失败补发</strong></div>
            <div className="auto-simple-grid">
              <label>失败后处理<select value={form.failurePolicy.action} onChange={e => updateFailure({ action: e.target.value })}>{Object.entries(failureLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>补发媒体收藏夹<input value={form.mediaPool.backupFolder} placeholder="可留空" onChange={e => updateMedia({ backupFolder: e.target.value })} /></label>
              <label>几天未成功算失败<input type="number" min="1" max="30" value={form.failurePolicy.staleDays} onChange={e => updateFailure({ staleDays: Number(e.target.value) })} /></label>
              <label>最多补发次数<input type="number" min="0" max="10" value={form.failurePolicy.maxRetry} onChange={e => updateFailure({ maxRetry: Number(e.target.value) })} /></label>
            </div>
          </div>

          <div className="auto-flow-actions">
            <button className="primary-button" disabled={busy || !activeBrand} onClick={() => void save()}><Save size={16} />保存计划</button>
            {selected && <button className="ghost-button" disabled={busy} onClick={() => void dryRun()}><CalendarDays size={16} />预览排期</button>}
            {selected && <button className="ghost-button" disabled={busy} onClick={() => void prepareDay()}><RefreshCw size={16} />检查备稿</button>}
            {selected && <button className="ghost-button" disabled={busy} onClick={() => void createTask()}><Play size={16} />生成任务</button>}
            {selected && <button className="primary-button" disabled={busy} onClick={() => void createPublishDraft()}><FileCheck2 size={16} />生成投放包</button>}
          </div>
        </section>

        <section className="panel auto-plan-preview">
          <div className="auto-plan-section-title"><h3>排期预览</h3><span>{preview.length} 个执行日 · 预计 {plannedTotal} 篇{estimatedTotal ? ` · 预算上限 ¥${(estimatedTotal / 100).toFixed(2)}` : ''}</span></div>
          {preview.length ? <div className="auto-day-table">{preview.map(day => <article key={day.date}>
            <div><strong>{day.date}</strong><small>{weekdays.find(([value]) => value === day.weekday)?.[1]}</small></div>
            <span>{day.plannedArticles}篇</span>
            <em>{day.mediaChannels.map(channel => channelLabels[channel] || channel).join(' / ')} · {day.favoriteFolder}</em>
            <div className="auto-day-actions">
              <button type="button" disabled={busy} onClick={() => void prepareDay(day.date)}>备稿</button>
              <button type="button" disabled={busy} onClick={() => void createPublishDraft(day.date)}>投放包</button>
              <button type="button" disabled={busy} onClick={() => void createTask(day.date)}>任务</button>
            </div>
          </article>)}</div> : <EmptyState title="暂无执行日期" description="请选择开始日期和执行星期。" />}
        </section>

        <section className="panel auto-plan-runs">
          <div className="auto-plan-section-title"><h3>待确认投放池</h3><span>锁定文章后再进入媒体选择。</span></div>
          {drafts.length ? drafts.slice(0, 8).map(draft => <article className="auto-draft-row" key={draft.id}>
            <span><CheckCircle2 size={16} /></span>
            <div><strong>{draft.date} · {draft.articles.length}篇</strong><small>{draft.mediaPool?.channels?.map(channel => channelLabels[channel] || channel).join(' / ') || '待选择渠道'} · {draft.mediaPool?.favoriteFolder || '默认收藏夹'}</small></div>
            <em>{draft.articles.map(article => article.title).slice(0, 2).join('；')}</em>
            <button type="button" onClick={() => openDraft(draft)}>去选择媒体</button>
          </article>) : <EmptyState title="暂无待确认投放包" description="备稿充足后，点击生成投放包。" />}
        </section>

        <section className="panel auto-plan-runs">
          <div className="auto-plan-section-title"><h3>执行记录</h3><span>最近操作会在这里留痕。</span></div>
          {currentRuns.length ? currentRuns.map(run => <div key={run.id} className="auto-run-row"><span><Clock3 size={15} /></span><strong>{run.brand}</strong><em>{run.taskName ? `${run.taskName}：${run.message}` : run.message}</em><small>{new Date(run.createdAt).toLocaleString('zh-CN')}</small></div>) : <EmptyState title="暂无记录" description="保存计划后，可以预览排期或检查备稿。" />}
        </section>
      </div>
    </div>
  </section>
}
