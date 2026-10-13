import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Save, X } from 'lucide-react'
import './workflow-panels.css'

type Request = (path: string, body?: unknown, timeout?: number) => Promise<any>
type Profile = { sourceHash: string; stale: boolean; record?: { value: any; notes: string; updatedAt: string } | null; previous?: { value: any; notes: string } | null }
const display = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(display).join('；') : value && typeof value === 'object' ? Object.values(value).map(display).join('；') : ''

export function UnderstandingView({ value }: { value: any }) {
  if (!value) return <p className="table-note">尚未形成项目理解</p>
  return <div className="workflow-reading">
    <h3>项目定位</h3><p>{display(value.positioning)}</p>
    <h3>服务购买者</h3><p>{display(value.buyers)}</p>
    <h3>客户场景</h3><p>{display(value.scenarios)}</p>
    <h3>优势与依据</h3>
    {(value.advantages || []).map((item: any, i: number) => <div className="workflow-evidence" key={i}>
      <strong>{display(item.capability)}</strong><p>{display(item.customerValue)}</p>
      <details><summary>查看事实出处</summary><blockquote>{display(item.quote)}</blockquote><span>{item.source === 'evidence' ? '引证资料' : '品牌资料'}</span></details>
    </div>)}
    <h3>推荐逻辑</h3><p>{display(value.recommendationLogic)}</p>
    {value.projectClarifications && <><h3>项目修正说明</h3><p>{value.projectClarifications}</p></>}
  </div>
}

export function ProjectUnderstandingPanel({ project, core, request, onClose, canAnalyze = false }: { project: string; core: string; request: Request; onClose: () => void; canAnalyze?: boolean }) {
  const [libraries, setLibraries] = useState<string[]>([])
  const [knowledge, setKnowledge] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    let active = true
    request('/api/state?key=geo.knowledgeRows').then(result => { if (active) setLibraries((result.value || []).filter((row: string[]) => row[0] === project).map((row: string[]) => row[1])) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [project])
  useEffect(() => {
    const current = ++revision.current
    setProfile(null); setError(''); setNotes(''); setBusy(true)
    request(`/api/projects/understanding?project=${encodeURIComponent(project)}&knowledge=${encodeURIComponent(knowledge)}&core=${encodeURIComponent(core)}`).then(result => {
      if (current !== revision.current) return
      setProfile(result); setNotes(result.record?.notes || result.previous?.notes || '')
    }).catch(error => { if (current === revision.current) setError(error.message) }).finally(() => { if (current === revision.current) setBusy(false) })
    return () => { revision.current++ }
  }, [project, knowledge, core])
  const update = async (action: 'notes' | 'analyze') => {
    if (action === 'analyze' && !canAnalyze) return
    const current = ++revision.current
    setBusy(true); setError('')
    try {
      const result = await request('/api/projects/understanding', { projectName: project, coreKeyword: core || undefined, knowledgeName: knowledge, action, notes, sourceHash: profile?.sourceHash }, 300000)
      if (current === revision.current) { setProfile(result); setNotes(result.record?.notes || '') }
    } catch (error) { if (current === revision.current) setError(error instanceof Error ? error.message : '保存失败') }
    finally { if (current === revision.current) setBusy(false) }
  }
  return <div className="modal-backdrop"><section className="form-modal workflow-modal" role="dialog" aria-modal="true" aria-label="项目理解">
    <header className="modal-head"><strong>{project} · 项目理解</strong><button title="关闭" aria-label="关闭项目理解" onClick={onClose}><X size={18} /></button></header>
    <div className="workflow-panel-toolbar"><label>资料范围<select aria-label="项目理解资料范围" value={knowledge} disabled={busy} onChange={event => setKnowledge(event.target.value)}><option value="">全部知识库</option>{libraries.map(name => <option key={name}>{name}</option>)}</select></label>
      {canAnalyze && <button className="primary-button" disabled={busy} onClick={() => update('analyze')}><RefreshCw size={16} />{busy ? '处理中' : '更新项目理解'}</button>}</div>
    {error && <p role="alert">{error}</p>}
    {profile?.stale && <p className="workflow-warning">资料已变更，下方是历史理解；新任务将重新理解最新资料。</p>}
    {!profile?.record && !profile?.previous && !busy && <p>{canAnalyze ? '尚未生成项目理解' : '待首次生成任务完成项目理解'}</p>}
    <UnderstandingView value={profile?.record?.value || profile?.previous?.value} />
    <label className="workflow-notes">修正说明<textarea aria-label="项目理解修正说明" value={notes} onChange={event => setNotes(event.target.value)} rows={4} /></label>
    <footer className="modal-actions"><button className="primary-button" disabled={busy || !profile?.record} onClick={() => update('notes')}><Save size={16} />保存修正</button></footer>
  </section></div>
}

export function TaskWorkflowDetails({ job, onResume, busy }: { job: any; onResume: (options?: { resetImageSlots?: boolean }) => void; busy: boolean }) {
  const labels: Record<string,string> = { '项目理解':'项目理解', '批量选题':'分配选题角度', '选题交接':'分配选题角度', '单篇编辑':'文章策划', 'Skill写作':'正文生成', '篇幅收束':'正文生成', '成品':'文章完成' }
  const statuses: Record<string,string> = { complete:'已完成', running:'进行中', recovered:'已恢复', failed:'待重试', queued:'待开始' }
  const steps = new Map<string,string>()
  for(const step of job.workflowSteps || []) {
    const label=labels[step.label] || step.label
    steps.set(label,step.status)
  }
  const hasPendingImage = /图片结果待确认|配图.*待确认|AI配图/.test(String(job.error || '')) && (job.workflowSteps || []).some((step: any) => step.label === 'AI配图' && step.status === 'failed')
  const resume = () => {
    if (!hasPendingImage) return onResume()
    if (!window.confirm('当前任务卡在待确认AI配图。请先确认火山引擎没有生成对应图片；确认后系统会释放待确认图片槽，并在续跑时重新生成该图片。是否继续？')) return
    onResume({ resetImageSlots: true })
  }
  if(!steps.size)steps.set('等待生成',job.status==='running'?'running':'queued')
  return <div className="workflow-details workflow-summary">
    <div className="workflow-panel-toolbar"><strong>生成流程</strong>{job.status==='failed'&&<button className="primary-button" disabled={busy} onClick={resume}>{hasPendingImage?'确认配图失败并续跑':'继续本次任务'}</button>}</div>
    <ol>{[...steps].map(([label,status])=><li key={label}><strong>{label}</strong><span>{job.status==='done'?'已完成':statuses[status]||status}</span></li>)}</ol>
    {job.error&&<p role="alert">{job.error}</p>}
  </div>
}
