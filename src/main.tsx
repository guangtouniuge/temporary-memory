import {PagedRows} from './PagedRows'
import { identityKey, projectHeaders, projectStorage, fetchProjectFile } from './project-scope'
import { articleHtml } from './article-format'
import { AuthGate } from './auth'
import { MediaWorkspace } from './MediaWorkspace'
import { SocialChannel } from './SocialChannel'
import { ProjectUnderstandingPanel, TaskWorkflowDetails } from './WorkflowPanels'
import { StrictMode, type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  BarChart3,
  ArrowLeft,
  CalendarDays,
  Eye,
  Trash2,
  Download,
  BookOpenText,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileText,
  GalleryHorizontal,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  Library,
  ListChecks,
  MessageSquareText,
  Newspaper,
  PenLine,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  SearchCheck,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  UploadCloud,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import './styles.css'
import { AgencyDirectory, ConsoleOverview, EmptyState, Modal, ProjectAccountDirectory, ProjectSummaryDirectory, accountRequest, consoleKindForPath, consoleNames, type ConsoleKind } from './console-ui'
import { PlatformAdmin } from './PlatformAdmin'
import { MemberAccounts, MyQuota } from './MemberAccounts'
import './console.css'

type NavItem = {
  id: string
  label: string
  icon: LucideIcon
  children?: { id: string; label: string; icon: LucideIcon }[]
}

type Article = {
  writingDepth?: string
  id: string
  title: string
  angle: string
  keyword: string
  score?: number
  status: '已生成' | '生成异常'
  words: string
  body?: string
  project?: string
  brand?: string
  duplicateNote?: string
  apiIssues?: string[]
  batchId?: string
  taskName?: string
  batchLabel?: string
  imagePaths?: string[]
  generationSource?: 'API成稿' | 'API资料调用自由写作' | 'API资料调用未返回'
}

type ArticleJobStatus = {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  total: number
  completed: number
  passed: number
  failed: number
  articles: Article[]
  logs: { time: string; message: string }[]
  error?: string
  promptVersion?: string
  project?: string
  workflowStage?: string
  workflowSteps?: unknown[]
  materialScope?: { knowledgeName: string; sources: unknown[] }
  plans?: unknown[]
}

type ArticleStateProps = {
  articleRows: Article[]
  setArticleRows: Dispatch<SetStateAction<Article[]>>
}

type ProjectRow = {
  name: string
  brand: string
  recommendWord: string
  coreKeyword: string
  industry: string
  city: string
  keywords: string
  assets: string
  status: string
}

type ProjectStateProps = {
  projectRows: ProjectRow[]
  setProjectRows: Dispatch<SetStateAction<ProjectRow[]>>
}

type ActiveBrandProps = {
  activeBrand: string
  setActiveBrand: Dispatch<SetStateAction<string>>
}

type ActiveKeywordProps = {
  activeKeyword: string
  setActiveKeyword: Dispatch<SetStateAction<string>>
}

type ActiveBatchProps = {
  activeBatchId: string
  setActiveBatchId: Dispatch<SetStateAction<string>>
}

const nav: NavItem[] = [
  { id: 'dashboard', label: '首页大屏', icon: LayoutDashboard },
  { id: 'projects', label: '企业品牌库', icon: Boxes },
  {
    id: 'prep',
    label: '品牌资料库',
    icon: UploadCloud,
    children: [
      { id: 'keywords', label: '关键词', icon: KeyRound },
      { id: 'questions', label: '扩展行业词', icon: ListChecks },
      { id: 'candidates', label: '榜单服务商', icon: ClipboardCheck },
      { id: 'knowledge', label: '品牌知识库', icon: BookOpenText },
      { id: 'gallery', label: '品牌图库', icon: GalleryHorizontal },
    ],
  },
  {
    id: 'article-system',
    label: '品牌文章系统',
    icon: PenLine,
    children: [
      { id: 'tasks', label: '生成任务', icon: Workflow },
      { id: 'task-history', label: '任务列表', icon: ListChecks },
      { id: 'library', label: '成品文章库', icon: Library },
    ],
  },
  { id: 'media', label: '媒体投喂', icon: Send, children: [{ id: 'media-news', label: '补充媒体投喂', icon: Newspaper }, { id: 'media-news2', label: '核心媒体投喂', icon: Newspaper }, { id: 'distribution', label: '自有媒体投喂', icon: MessageSquareText }, { id: 'auto-publish', label: '发布队列', icon: CalendarDays }] },
  { id: 'diagnosis', label: 'AI诊断', icon: Gauge, children: [{ id: 'visibility-pro', label: 'AI诊断Pro版', icon: SearchCheck }, { id: 'visibility', label: 'AI可见度诊断', icon: BarChart3 }, { id: 'reports', label: '诊断报告', icon: Download }] },
  { id: 'my-quota', label: '我的额度', icon: Database },
  { id: 'data', label: '数据中心', icon: BarChart3 },
]

const consoleNav: Record<ConsoleKind, NavItem[]> = {
  project: nav,
  platform: [
    { id: 'overview', label: '平台概览', icon: LayoutDashboard },
    { id: 'settings', label: '系统配置', icon: Settings },
    { id: 'enterprises', label: '企业管理', icon: Library },
    { id: 'verification', label: '实名审核', icon: ShieldCheck },
    { id: 'agencies', label: '代理管理', icon: Boxes },
    { id: 'members', label: '会员额度', icon: Database },
    { id: 'projects', label: '企业品牌库', icon: Library },
    { id: 'model', label: '模型配置', icon: Database },
  ],
  agency: [
    { id: 'overview', label: '代理工作台', icon: LayoutDashboard },
    { id: 'model', label: '模型接口', icon: Database },
    { id: 'accounts', label: '项目账户', icon: ShieldCheck },
    { id: 'members', label: '会员额度', icon: Database },
    { id: 'projects', label: '客户品牌库', icon: Boxes },
  ],
}
function readConsoleRoute() {
  const [, candidate, page] = window.location.hash.split('/')
  const kind: ConsoleKind = candidate === 'platform' || candidate === 'agency' ? candidate : 'project'
  const items = consoleNav[kind].flatMap(item => item.children || [item])
  return { kind, page: kind==='project'&&page==='media-b2b'?'media-news':kind === 'project' && page === 'audit' ? 'library' : items.some(item => item.id === page) ? page : items[0].id }
}

const workflow = [
  ['项目管理', '确定项目名称、推荐名称、公司名称、项目行业和城市。'],
  ['关键词意图', '添加核心词，蒸馏用户问题，再拓展语义关键词库。'],
  ['榜单服务商', '维护主推品牌和可比较服务商，给榜单、测评、对比稿调用。'],
  ['品牌资料', '给品牌导入品牌事实和权威依据，并按资料方向使用。'],
  ['文章生成', '选择行业模式和类型偏好，依次完成项目理解、选题、编辑稿单和Skill写作。'],
  ['图文成稿', '生成文章时自动插入1-2张项目图片，成品库可查看、编辑和下载。'],
]

const projects: ProjectRow[] = []

const articles: Article[] = []

type TaskRow = {
  sceneCity?: string
  sceneIndustry?: string
  imageSource?: 'ai' | 'imported'
  businessScenes?: string[]
  writingDepth?: string
  coreKeyword?: string
  jobId?: string
  project: string
  name: string
  question: string
  limit: string
  created: string
  knowledge: string
  detail: string
  error: string
  status: string
  latest: string
  time: string
  batchId: string
  articleType?: string
  writingSceneMode?: string
  industryScene?: string
  userQuestions?: string
  providerList?: string
  mainReason?: string
  unfitScenario?: string
  selectedPains?: string
  selectedDimensions?: string
  selectedCandidates?: string
  titlePreference?: string
  forbiddenContent?: string
}

const taskRows: TaskRow[] = []

const articleTypeOptions = [
  '榜单推荐',
  '选型指南',
  '深度测评',
  '口碑核查',
  '避坑指南',
  '服务商对比',
  '资质实力解析',
  '行业场景解决方案',
  '实战案例',
  '趋势白皮书',
  '技术解析',
  '问答解释',
]

function parseArticleTypes(value?: string) {
  const items = String(value || '')
    .split(/[、,，;；/|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length ? Array.from(new Set(items)) : [...articleTypeOptions]
}

function needsRankingMaterials(value?: string) {
  return parseArticleTypes(value).some((type) => /榜单|测评|口碑|对比|实力/.test(type))
}

function formatCandidateLine(row: string[]) {
  const name = row[1]?.trim()
  if (!name) return ''
  const details = [
    row[2]?.trim(),
    row[3]?.trim() ? `适合${row[3].trim()}` : '',
    row[4]?.trim() ? `优势${row[4].trim()}` : '',
    row[5]?.trim() ? `核验${row[5].trim()}` : '',
  ].filter(Boolean)
  return details.length ? `${name}：${details.join('；')}` : name
}

function titleMatchesGeoCore(title: string, coreKeyword: string) {
  const text = String(title || '')
  const core = String(coreKeyword || '')
  if (!core) return true
  if (text.includes(core)) return true
  const hasGeoProviderTerm = /(GEO公司|GEO服务商|GEO优化公司|豆包排名公司|豆包排名服务商|AI搜索优化公司)/i.test(text)
  const coreIsGeoProvider = /(GEO公司|GEO服务商|GEO优化公司|豆包排名公司|AI搜索排名公司|AI获客公司)/i.test(core)
  const city = core.match(/^(西安|北京|上海|广州|深圳|成都|郑州|武汉|杭州|全国)/)?.[1]
  return Boolean(coreIsGeoProvider && hasGeoProviderTerm && (!city || text.includes(city)))
}

function isGeoProviderSceneText(value: string) {
  return /(GEO公司|GEO服务商|GEO优化公司|豆包排名公司|豆包排名服务商|AI搜索优化公司|AI获客公司|GEO内容公司|GEO新闻优化公司)/i.test(String(value || ''))
}

type GeoRulePhase = '资料准备' | '生成调用'

const geoDataRules: {
  id: string
  phase: GeoRulePhase
  title: string
  detail: string
  hard?: boolean
}[] = [
  {
    id: 'project-isolation',
    phase: '资料准备',
    title: '品牌项目隔离',
    detail: '一个品牌一套核心词、关键词库、蒸馏词、品牌资料和可信资料，生成时不能串库。',
    hard: true,
  },
  {
    id: 'core-keyword',
    phase: '资料准备',
    title: '核心词',
    detail: '核心词作为当前文章主题资料传给API。',
    hard: true,
  },
  {
    id: 'distilled-question',
    phase: '资料准备',
    title: '蒸馏问题',
    detail: '蒸馏问题只作为用户意图参考，不强制进入标题或正文。',
    hard: true,
  },
  {
    id: 'keyword-library',
    phase: '资料准备',
    title: '关键词库',
    detail: '关键词库只作为行业、语义、场景和区域语境参考。',
    hard: true,
  },
  {
    id: 'brand-data',
    phase: '资料准备',
    title: '品牌资料',
    detail: '品牌资产和权威引证作为资料包传给API，由模型自由吸收。',
    hard: true,
  },
  {
    id: 'single-article',
    phase: '生成调用',
    title: '单篇调用',
    detail: '批量任务拆成单篇请求，避免多篇文章混在一个返回里。',
    hard: true,
  },
  {
    id: 'skill-brief-writing',
    phase: '生成调用',
    title: 'skill稿单写作',
    detail: '标题、结构和段落任务按当前文章类型、行业和项目资料组装后交给API生成。',
    hard: true,
  },
  {
    id: 'fact-source',
    phase: '生成调用',
    title: '事实来源',
    detail: '没有资料支撑的具体数据、案例、联系方式、资质和媒体来源不编造。',
    hard: true,
  },
]

const taskPrecheckRules = geoDataRules

const auditRules = geoDataRules.map((rule) => [
  rule.title,
  `${rule.detail}${rule.hard ? '（保留）' : ''}`,
])

const articlePlans = [
  {
    title: '西安GEO公司怎么选？企业先看AI答案复盘',
    question: '企业主搜索“西安GEO公司怎么选”时，最需要什么答案？',
    angle: '企业采购现场调查',
    keywords: '西安GEO公司 / 西安GEO优化公司 / 西安AI搜索排名公司',
    evidence: '调用服务边界、交付流程、实体一致性和答案回看依据',
    image: '咨询现场图 + AI答案回看截图',
    status: '可生成',
  },
  {
    title: '西安豆包GEO公司靠谱吗？验收标准开始前置',
    question: '豆包推荐结果变化后，企业怎么验收服务商？',
    angle: '平台问答验收观察',
    keywords: '西安豆包GEO公司 / 西安豆包排名公司',
    evidence: '调用平台适配、复盘机制和验收边界依据',
    image: '交付表单图 + 月度复盘图',
    status: '待补图',
  },
  {
    title: '曲江商家问西安AI获客公司，为什么不只看发稿',
    question: '区域门店想被AI推荐，内容应该怎么组织？',
    angle: '区县经营场景报道',
    keywords: '西安AI获客公司 / 曲江GEO公司 / 西安GEO公司',
    evidence: '调用本地问题库、多平台内容适配和风险边界依据',
    image: '商圈场景图 + 问题库截图',
    status: '可生成',
  },
]


function buildArticlePlans(
  _project: ProjectRow,
  packet: { coreKeyword: string; questions: string[]; keywords: string[]; galleries: string[] },
) {
  return Array.from({ length: 100 }, () => ({
    title: '', question: '', direction: '', angle: '', scene: '', region: '',
    role: '', sectionHeads: [], keywords: packet.keywords.join(' / '),
    evidence: '', image: '', status: '可生成',
  }))
}

type LocalImageUpload = {
  name: string
  type: string
  dataUrl: string
}

function readFileAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readFilesAsDataUrls(files: FileList | null): Promise<LocalImageUpload[]> {
  const selectedFiles = Array.from(files ?? [])
  return Promise.all(selectedFiles.map(async (file) => ({
    name: file.name,
    type: file.type,
    dataUrl: await readFileAsDataUrl(file),
  })))
}

async function compressGalleryImage(file: File): Promise<{ name: string; dataUrl: string; compressed: boolean }> {
  if (!file.type.startsWith('image/')) throw new Error(`“${file.name}”不是图片文件。`)
  if (file.type === 'image/gif') {
    if (file.size > 8 * 1024 * 1024) throw new Error(`“${file.name}”超过8MB，GIF动图请先压缩后上传。`)
    return { name: file.name, dataUrl: await readFileAsDataUrl(file), compressed: false }
  }
  if (file.size <= 2.5 * 1024 * 1024) return { name: file.name, dataUrl: await readFileAsDataUrl(file), compressed: false }
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    if (file.size > 12 * 1024 * 1024) throw new Error(`“${file.name}”图片过大且无法自动压缩，请先另存为JPG后上传。`)
    return { name: file.name, dataUrl: await readFileAsDataUrl(file), compressed: false }
  }
  try {
    const limit = 1920
    const scale = Math.min(1, limit / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片压缩失败，请重试。')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片压缩失败，请重试。')), 'image/jpeg', 0.86))
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
    return { name: `${baseName}.jpg`, dataUrl: await readFileAsDataUrl(blob), compressed: true }
  } finally {
    bitmap.close()
  }
}

function parseGalleryPaths(value?: string) {
  if (!value) return []
  return value.split('|').map((item) => item.trim()).filter(Boolean)
}


function chineseCount(text: string) {
  return Array.from(text).filter((char) => char >= '\u4e00' && char <= '\u9fff').length
}


function localDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).replace(/\//g, '-')
}

function localChineseDate() {
  const [year, month, day] = localDate().split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function currentIdentityRole() {
  return window.__geoIdentity?.role || 'project_operator'
}

function portalConsoleKind(): ConsoleKind | null {
  return consoleKindForPath()
}

function allowedConsoleKinds(role = currentIdentityRole()): ConsoleKind[] {
  const portalKind = portalConsoleKind()
  if (portalKind) return [portalKind]
  if (role === 'super_admin') return ['platform']
  if (role === 'agent') return ['agency']
  return ['project']
}


function localDateTime() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(/\//g, '-')
}

function runBatchId(projectName: string, taskName: string) {
  const stamp = localDateTime().replace(/[^\d]/g, '')
  const random = Math.random().toString(36).slice(2, 6)
  return `${projectName || 'GEO'}-${taskName || '生成任务'}-${stamp}-${random}`
}

function classifyKeyword(word: string) {
  if (word.includes('哪家') || word.includes('推荐') || word.includes('靠谱')) return '推荐类'
  if (word.includes('豆包') || word.includes('AI搜索') || word.includes('排名')) return '平台类'
  if (word.includes('获客') || word.includes('转化')) return '获客类'
  if (word.includes('区') || word.includes('曲江') || word.includes('浐灞') || word.includes('未央')) return '区域类'
  if (word.includes('口腔') || word.includes('财务') || word.includes('咨询') || word.includes('超市') || word.includes('医院')) return '行业场景类'
  if (word.includes('服务商') || word.includes('优化公司')) return '服务商类'
  if (word.includes('费用') || word.includes('价格') || word.includes('预算')) return '价格类'
  return '长尾类'
}

function normalizeKeywordLibraryWords(words: string[]) {
  return Array.from(new Set(words
    .flatMap(word => String(word).split(/[\n,，、;；/|]+/))
    .map(word => word.trim())
    .filter(Boolean)))
}

type WorkflowPacket = {
  project: ProjectRow
  coreKeyword: string
  keywords: string[]
  questions: string[]
  brandAssets: string[]
  authorityEvidence: string[]
  galleries: string[]
  articleType?: string
  writingSceneMode?: string
  industryScene?: string
  userQuestions?: string
  providerList?: string
  mainReason?: string
  unfitScenario?: string
  titlePreference?: string
  forbiddenContent?: string
}

function readStoredRows(key: string, fallback: string[][]) {
  if (typeof window === 'undefined') return fallback
  const saved = projectStorage.getItem(key)
  if (!saved) return fallback
  try {
    return JSON.parse(saved) as string[][]
  } catch {
    return fallback
  }
}

function createEmptyProject(activeBrand = ''): ProjectRow {
  return {
    name: activeBrand,
    brand: activeBrand,
    recommendWord: '',
    coreKeyword: '',
    industry: '',
    city: '',
    keywords: '待导入',
    assets: '待导入品牌资料',
    status: '新建',
  }
}

function questionBelongsToBrand(row: string[], brand: string, core: string) {
  return row.length >= 5 && row[0] === brand && row[1] === core
}

function readQuestionText(row: string[]) {
  return row.length >= 5 ? row[2] : row[1]
}

async function apiJson<T>(path: string, payload?: unknown, timeoutMs = 30000): Promise<T> {
  const scope = identityKey()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { ...projectHeaders(), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    })
    const contentType = response.headers.get('content-type') || ''
    const text = await response.text()
    let data: T & { error?: string }
    if (!contentType.includes('application/json')) {
      if (response.status === 401 || response.status === 403 || /^\s*</.test(text)) window.dispatchEvent(new Event('geo-auth-expired'))
      throw new Error(response.status === 401 || response.status === 403 || /^\s*</.test(text) ? '登录状态已失效，请重新登录后刷新页面。' : `接口返回异常：${response.status || '非JSON响应'}`)
    }
    try {
      data = JSON.parse(text) as T & { error?: string }
    } catch {
      throw new Error('接口返回格式异常，请刷新页面后重试。')
    }
    if (scope !== identityKey()) throw new Error('项目已切换，请在当前项目重新操作。')
    if (response.status === 401 || (response.status === 409 && data.error === '账号已切换，请刷新页面重新登录')) window.dispatchEvent(new Event('geo-auth-expired'))
    if (!response.ok) {
      throw new Error(data.error || `接口返回${response.status}`)
    }
    return data
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function normalizeEvidenceForGeoPrompt(value: string) {
  return value
    .replace(/西安AI答案可见度网络科技有限公司/g, '西安曝光率网络科技有限公司')
    .replace(/全域流量运营/g, '多平台内容分发、公开资料一致性维护和AI答案回看')
    .replace(/全域流量/g, '多平台内容')
    .replace(/流量/g, 'AI答案可见度')
    .replace(/点击率/g, '答案点击前的信息完整度')
    .replace(/转化率/g, '后续咨询链路')
    .replace(/提升品牌的在线可见度和影响力/g, '让AI答案更准确地理解企业信息和推荐依据')
    .replace(/市场竞争力/g, '信息识别稳定性')
}

function buildWorkflowPacket(project: ProjectRow): WorkflowPacket {
  const keywordRows = readStoredRows('geo.keywordRows', [])
  const keywordLibraryRows = readStoredRows('geo.keywordLibraryRows', [])
  const questionRows = readStoredRows('geo.questionRows', [])
  const knowledgeRows = readStoredRows('geo.knowledgeRows', [])
  const knowledgeContentRows = readStoredRows('geo.knowledgeContentRows', [])
  const galleryRows = readStoredRows('geo.galleryRows', [])
  const coreKeywords = keywordRows
    .filter((row) => row[0] === project.name)
    .map((row) => row[1])
  const coreKeyword = coreKeywords[0] || project.coreKeyword
  const auxiliaryKeywords = normalizeKeywordLibraryWords(keywordLibraryRows
    .filter((row) => row[0] === project.name && row[1] === coreKeyword)
    .map((row) => row[2]))
  const keywords = Array.from(new Set([coreKeyword, ...auxiliaryKeywords]))
  const questions = questionRows
    .filter((row) => questionBelongsToBrand(row, project.name, coreKeyword))
    .map(readQuestionText)
  const knowledgeFallback = knowledgeRows
    .filter((row) => row[0] === project.name)
    .map((row) => `${row[1]}（${row[3]}，完整度${row[4]}）`)
  const brandAssets = knowledgeContentRows
    .filter((row) => row[0] === project.name)
    .map((row) => `${row[2]}：${row[3]}`)
  const authorityEvidence = knowledgeContentRows
    .filter((row) => row[0] === project.name)
    .map((row) => `${row[2]}：${row[4]}`)
  const galleries = galleryRows
    .filter((row) => row[0] === project.name)
    .map((row) => `${row[1]}（${row[2]}，${row[3]}${row[5] ? `，文件：${row[5]}` : ''}）`)

  return {
    project,
    coreKeyword,
    keywords: keywords.length ? keywords : [coreKeyword],
    questions: questions.length ? questions : [`${coreKeyword}怎么选`, `${coreKeyword}哪家靠谱`],
    brandAssets,
    authorityEvidence,
    galleries,
  }
}

const auditChecks = [
  ['品牌项目', '已归属', '文章来自当前品牌项目。'],
  ['核心词', '已带入', '核心词作为写作主线交给API。'],
  ['蒸馏问题', '已带入', '蒸馏问题作为用户意图参考。'],
  ['关键词库', '已带入', '关键词库只做语境参考，不强制堆词。'],
  ['品牌知识库', '已带入', '品牌资料和可信资料转成写作依据。'],
  ['成品出口', '已生成', 'API返回正文后直接进入成品文章库。'],
]

function getArticleAuditChecks(article: Article) {
  return [
    ['接口正文', article.body?.trim() ? '已返回' : '生成异常', article.body?.trim() ? '模型已返回正文。' : '接口没有返回正文，需要重新调用。'],
    ['标题', article.title ? '已生成' : '生成异常', article.title ? '标题来自API或计划卡。' : '接口没有返回标题。'],
    ['核心词', article.keyword ? '已带入' : '未设置', article.keyword ? `本篇核心词：${article.keyword}` : '当前文章缺少核心词。'],
    ['推荐品牌', article.brand ? '已带入' : '未设置', article.brand ? `本篇推荐品牌：${article.brand}` : '当前文章缺少推荐品牌。'],
    ['人工复盘', article.duplicateNote ? '有提示' : '无提示', article.duplicateNote || '系统不再按旧评分规则拦截文章。'],
  ]
}

function canArticleEnterLibrary(article: Article) {
  return Boolean(article.body?.trim()) && !article.apiIssues?.length
}

function makeApiFailedArticle({
  project,
  index,
  plan,
  coreKeyword,
  batchId,
  taskName,
  reason,
  rawBody = '',
}: {
  project: ProjectRow
  index: number
  plan: { title: string; angle: string }
  coreKeyword: string
  batchId: string
  taskName: string
  reason: string
  rawBody?: string
}): Article {
  return {
    id: `API-FAIL-${Date.now().toString().slice(-5)}-${index + 1}`,
    title: plan.title || coreKeyword,
    angle: plan.angle,
    keyword: coreKeyword,
    status: '生成异常',
    words: chineseCount(rawBody).toLocaleString('zh-CN'),
    body: rawBody || `接口未返回可用正文。\n\n失败原因：${reason}`,
    project: project.name,
    brand: project.recommendWord,
    duplicateNote: reason,
    batchId,
    taskName,
    generationSource: 'API资料调用未返回',
  }
}

function displayGenerationSource(source?: Article['generationSource']) {
  if (source === 'API资料调用未返回') return '生成异常'
  return source ? '已生成' : '未记录'
}

function imageSrcForDisplay(src: string) {
  if (/^[A-Za-z]:[\\/]/.test(src)) return `/api/gallery/file?file=${encodeURIComponent(src)}`
  return src
}

function markdownImageParts(block: string) {
  const match = block.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
  return match ? { alt: match[1] || '文章配图', src: imageSrcForDisplay(match[2]) } : null
}

function ProjectImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    if (src.startsWith('/api/gallery/file')) {
      void fetchProjectFile(src).then(blob => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      }).catch(() => setUrl(''))
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src])
  return url ? <img src={url} alt={alt} /> : <span>{alt}（图片暂不可用）</span>
}

function renderArticleBody(body = '') {
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  return blocks.map((block, index) => {
    const image = markdownImageParts(block)
    if (image) {
      return <figure className="article-image-block" key={`${image.src}-${index}`}><ProjectImage src={image.src} alt={/AI.*(?:场景|示意)/i.test(image.alt) ? '文章配图' : image.alt} /></figure>
    }
    const summary = index <= 1 && /^(?:#{1,6}\s*)?(?:\*\*)?摘要(?:\*\*)?\s*[:：]/.test(block)
    return <div className={`article-formatted-block${summary ? ' article-summary' : ''}`} key={index} dangerouslySetInnerHTML={{ __html: articleHtml(block) }} />
  })
}

function displayTaskStatus(status: string) {
  if (status === '待审核') return '已生成'
  if (status === '审核中') return '生成中'
  if (status === '审核失败') return '生成异常'
  return status
}

function getAuditedArticleScore(article: Article) {
  return canArticleEnterLibrary(article) ? 0 : 0
}

function getArticleAuditFailures(article: Article) {
  return getArticleAuditChecks(article).filter(([, result]) => result === '生成异常')
}

function useStoredState<T>(key: string, initialValue: T) {
  const mountedScope = useRef(identityKey()).current
  const localWriteVersion = useRef(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue
    const saved = projectStorage.getItem(key)
    if (!saved) return initialValue
    try {
      return JSON.parse(saved) as T
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    const requestedAtVersion = localWriteVersion.current
    apiJson<{ ok: boolean; value: T | null }>(`/api/state?key=${encodeURIComponent(key)}`, undefined, key === 'geo.articleRows' ? 60000 : 30000)
      .then((result) => {
        if (!active) return
        if (localWriteVersion.current !== requestedAtVersion) return
        const loaded = result.value ?? initialValue
        setValue(loaded)
        projectStorage.setItem(key, JSON.stringify(loaded))
      })
      .catch(() => { if (active) setLoadError('资料加载失败，请重试。') })
      .finally(() => { if (active) setLoading(false) })
    return () => {
      active = false
    }
  }, [key, loadAttempt])

  const setStoredValue: Dispatch<SetStateAction<T>> = (nextValue) => {
    if (mountedScope !== identityKey()) return
    localWriteVersion.current += 1
    setValue((currentValue) => {
      const resolvedValue = typeof nextValue === 'function'
        ? (nextValue as (previous: T) => T)(currentValue)
        : nextValue
      projectStorage.setItem(key, JSON.stringify(resolvedValue))
      void apiJson('/api/state', { key, value: resolvedValue }, 5000).catch(() => undefined)
      return resolvedValue
    })
  }

  return [value, setStoredValue, { loading, error: loadError, retry: () => setLoadAttempt(value => value + 1) }] as const
}

type ActionProps = {
  notify: (message: string) => void
  navigate: (id: string) => void
}

function App() {
  const [route, setRoute] = useState(readConsoleRoute)
  const [identityRole, setIdentityRole] = useState(currentIdentityRole)
  const allowedKinds = allowedConsoleKinds(identityRole)
  const active = route.page
  const currentNav = consoleNav[route.kind]
  const changeRoute = (kind: ConsoleKind, page: string) => {
    window.location.hash = `/${kind}/${page}`
    setRoute({ kind, page })
  }
  const setActive = (page: string) => {
    if (page === 'audit') page = 'library'
    const belongs = currentNav.some(item => item.id === page || item.children?.some(child => child.id === page))
    changeRoute(belongs ? route.kind : 'project', page)
  }
  useEffect(() => {
    const sync = () => setRoute(readConsoleRoute())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  useEffect(() => {
    const syncIdentity = () => setIdentityRole(currentIdentityRole())
    window.addEventListener('geo:identity-changed', syncIdentity)
    window.addEventListener('focus', syncIdentity)
    syncIdentity()
    return () => {
      window.removeEventListener('geo:identity-changed', syncIdentity)
      window.removeEventListener('focus', syncIdentity)
    }
  }, [])
  useEffect(() => {
    if (!allowedKinds.includes(route.kind)) {
      const nextKind = allowedKinds[0] || 'project'
      changeRoute(nextKind, nextKind === 'project' ? 'dashboard' : 'overview')
    }
  }, [identityRole, route.kind])
  const [expandedNav, setExpandedNav] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [articleRows, setArticleRows, articleLoad] = useStoredState<Article[]>('geo.articleRows', articles)
  const [projectRows, setProjectRows] = useStoredState<ProjectRow[]>('geo.projectRows', projects)
  const [activeBrand, setActiveBrand] = useStoredState('geo.activeBrand', '')
  const [activeKeyword, setActiveKeyword] = useStoredState('geo.activeKeyword', '')
  const [activeBatchId, setActiveBatchId] = useStoredState('geo.activeBatchId', '')
  const selectActiveBrand: Dispatch<SetStateAction<string>> = (value) => {
    const nextBrand = typeof value === 'function' ? value(activeBrand) : value
    const nextProject = projectRows.find((project) => project.name === nextBrand)
    setActiveBrand(nextBrand)
    setActiveKeyword(nextProject?.coreKeyword ?? '')
    setActiveBatchId('')
  }
  const notify = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }
  const isNavActive = (item: NavItem) => item.id === active || item.children?.some((child) => child.id === active)
  const toggleNav = (item: NavItem) => {
    if (!item.children) {
      setActive(item.id)
      return
    }
    if (!item.children.some((child) => child.id === active)) {
      setActive(item.children[0].id)
    }
    setExpandedNav((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    )
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">G</div>
          <div>
          <strong>{consoleNames[allowedKinds[0]]}</strong>
          <span>GEO 内容生产系统</span>
          </div>
        </div>
        <nav className="nav" aria-label={`${consoleNames[route.kind]}导航`}>
          {currentNav.map((item) => {
            const hasActiveChild = Boolean(item.children?.some((child) => child.id === active))
            const expanded = Boolean(item.children && (expandedNav.includes(item.id) || hasActiveChild))
            return (
              <div className="nav-block" key={item.id}>
                <button
                  className={`nav-item ${isNavActive(item) ? 'active' : ''}`}
                  aria-current={!item.children && active === item.id ? 'page' : undefined}
                  aria-expanded={item.children ? expanded : undefined}
                  onClick={() => toggleNav(item)}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {item.children && <ChevronRight size={15} className={`nav-arrow ${expanded ? 'expanded' : ''}`} />}
                </button>
              {item.children && expanded && (
                <div className="nav-children">
                  {item.children.map((child) => (
                    <button
                      className={`nav-child ${active === child.id ? 'active' : ''}`}
                      aria-current={active === child.id ? 'page' : undefined}
                      key={child.id}
                      onClick={() => setActive(child.id)}
                    >
                      <child.icon size={15} />
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
              </div>
            )
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="console-topbar"><div><span>{consoleNames[route.kind]}</span><ChevronRight size={14} /><strong>{currentNav.flatMap(item => item.children || [item]).find(item => item.id === active)?.label}</strong></div>{route.kind === 'project' && <label>当前品牌<select aria-label="当前品牌" value={activeBrand} onChange={e => selectActiveBrand(e.target.value)}><option value="">请选择品牌</option>{projectRows.map(project => <option key={project.name} value={project.name}>{project.name}</option>)}</select></label>}</header>
        {active === 'overview' && <ConsoleOverview kind={route.kind} projectCount={projectRows.length} articleCount={articleRows.length} onProjects={() => setActive('projects')} />}
        {active === 'agencies' && route.kind !== 'platform' && <AgencyDirectory />}
        {route.kind === 'platform' && ['settings','agencies','enterprises','verification'].includes(active) && <PlatformAdmin key={active} page={active as 'settings'|'agencies'|'enterprises'|'verification'} onModel={() => setActive('model')} />}
        {active === 'accounts' && <ProjectAccountDirectory />}
        {active === 'members' && <MemberAccounts />}
        {active === 'my-quota' && <MyQuota />}
        {active === 'dashboard' && <Dashboard navigate={setActive} notify={notify} articleRows={articleRows} projectRows={projectRows} />}
        {active === 'projects' && route.kind !== 'project' && <ProjectSummaryDirectory onAccounts={route.kind === 'agency' ? () => setActive('accounts') : undefined} />}
        {active === 'projects' && route.kind === 'project' && <Projects navigate={setActive} notify={notify} projectRows={projectRows} setProjectRows={setProjectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} setActiveKeyword={setActiveKeyword} setArticleRows={setArticleRows} />}
        {active === 'visibility' && <Diagnosis navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} initialView="standard" />}
        {active === 'visibility-pro' && <Diagnosis navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} initialView="pro" />}
        {active === 'reports' && <Reports navigate={setActive} notify={notify} />}
        {active === 'keywords' && <Keywords navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} activeKeyword={activeKeyword} setActiveKeyword={setActiveKeyword} />}
        {active === 'questions' && <KeywordLibrary navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} activeKeyword={activeKeyword} setActiveKeyword={setActiveKeyword} />}
        {active === 'candidates' && <RankingCandidates navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} />}
        {active === 'knowledge' && <Knowledge navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} />}
        {active === 'gallery' && <Gallery notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} />}
        {(active === 'tasks' || active === 'task-history') && <Tasks articleReady={!articleLoad.loading&&!articleLoad.error} historyView={active==='task-history'} navigate={setActive} notify={notify} projectRows={projectRows} activeBrand={activeBrand} setActiveBrand={selectActiveBrand} articleRows={articleRows} setArticleRows={setArticleRows} activeBatchId={activeBatchId} setActiveBatchId={setActiveBatchId} />}
        {active === 'library' && <LibraryPage navigate={setActive} notify={notify} articleRows={articleRows} setArticleRows={setArticleRows} activeBrand={activeBrand} articleLoad={articleLoad} />}
        {active === 'distribution' && <SocialChannel key={`${active}:${activeBrand}:${identityKey()}`} channel="social" articles={articleRows} brand={activeBrand} initialIds={JSON.parse(sessionStorage.getItem(`media-selection:${identityKey()}`) || '[]')} request={apiJson} />}
        {['media-news', 'media-news2'].includes(active) && <MediaWorkspace key={`${active}:${activeBrand}:${identityKey()}`} channel={active === 'media-news' ? 'news' : 'news2'} articles={articleRows} brand={activeBrand} initialIds={JSON.parse(sessionStorage.getItem(`media-selection:${identityKey()}`) || '[]')} request={apiJson} />}
        {active === 'auto-publish' && <MediaWorkspace key={`${active}:${activeBrand}:${identityKey()}`} channel="news" articles={articleRows} brand={activeBrand} initialIds={[]} request={apiJson} queueOnly initialView="scheduled" headingTitle="发布队列" />}
        {active === 'data' && <DataCenter navigate={setActive} notify={notify} />}
        {active === 'model' && <ModelConfig navigate={setActive} notify={notify} />}
        {active === 'settings' && route.kind !== 'platform' && <SettingsPage navigate={setActive} notify={notify} />}
      </main>

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  )
}

function Dashboard({ navigate, notify, articleRows, projectRows }: ActionProps & { articleRows: Article[]; projectRows: ProjectRow[] }) {
  const [taskStateRows] = useStoredState<TaskRow[]>('geo.taskRows', taskRows)
  const [keywordRows] = useStoredState<string[][]>('geo.keywordRows', [])
  const [questionRows] = useStoredState<string[][]>('geo.questionRows', [])
  const [knowledgeRows] = useStoredState<string[][]>('geo.knowledgeRows', [])
  const [galleryRows] = useStoredState<string[][]>('geo.galleryRows', [])
  const passedArticles = articleRows.filter((article) => article.status === '已生成').length
  const pendingArticles = articleRows.filter((article) => article.status === '生成异常').length
  const totalArticles = articleRows.length
  const activeTasks = taskStateRows.filter((task) => task.status === '生成中' || task.status === '待生成').length
  const readyTasks = taskStateRows.filter((task) => task.status === '已生成').length
  const articleCountByProject = articleRows.reduce<Record<string, number>>((result, article) => {
    if (article.project) result[article.project] = (result[article.project] || 0) + 1
    return result
  }, {})
  const latestArticleByProject = articleRows.reduce<Record<string, Article>>((result, article) => {
    if (article.project && !result[article.project]) result[article.project] = article
    return result
  }, {})
  const recentArticles = articleRows.slice(0, 6)
  const projectHealth = projectRows.slice(0, 6).map((project) => ({
    ...project,
    articles: articleCountByProject[project.name] || 0,
    keywords: keywordRows.filter((row) => row[0] === project.name).length,
    questions: questionRows.filter((row) => row[0] === project.name).length,
    knowledge: knowledgeRows.filter((row) => row[0] === project.name).length,
    images: galleryRows.filter((row) => row[0] === project.name).length,
    latestArticle: latestArticleByProject[project.name]?.title || '暂无成稿',
  }))
  const attentionItems = [
    projectRows.length ? null : ['品牌项目', '还没有品牌项目', 'projects'],
    keywordRows.length ? null : ['关键词', '核心词和语义词还需要补充', 'keywords'],
    knowledgeRows.length ? null : ['品牌资料', '知识库资料偏少，生成前建议补齐', 'knowledge'],
    galleryRows.length ? null : ['图库', '缺少可用于文章和封面的图片', 'gallery'],
    pendingArticles ? ['接口异常', `${pendingArticles} 篇文章需要复查`, 'library'] : null,
  ].filter(Boolean) as [string, string, string][]
  const statusCards = [
    ['品牌项目', projectRows.length.toLocaleString('zh-CN'), '正在运营的客户项目', Boxes, 'projects'],
    ['成品文章', passedArticles.toLocaleString('zh-CN'), `全部 ${totalArticles.toLocaleString('zh-CN')} 篇`, Library, 'library'],
    ['生成任务', taskStateRows.length.toLocaleString('zh-CN'), `${activeTasks} 个待处理，${readyTasks} 个已完成`, Sparkles, 'tasks'],
    ['待处理', String(attentionItems.length + pendingArticles), pendingArticles ? `${pendingArticles} 篇生成异常` : '资料完整度提醒', Gauge, pendingArticles ? 'library' : 'knowledge'],
  ] as const
  const shortcuts: [string, string, string, LucideIcon][] = [
    ['品牌库', '项目基础信息和推荐名称', 'projects', Boxes],
    ['关键词', '核心词、疑问词和语义词', 'keywords', KeyRound],
    ['知识库', '品牌事实和权威资料', 'knowledge', UploadCloud],
    ['图库', '封面图和正文配图', 'gallery', ImageIcon],
    ['生成任务', '选题、稿单和批量生成', 'tasks', Sparkles],
    ['媒体投喂', '文章发布和账号分发', 'distribution', Send],
  ]

  return (
    <section className="dashboard-page ops-home">
      <div className="operation-toolbar workbench-toolbar">
        <div>
          <strong>数据总览</strong>
          <span>按品牌项目、成品文章、生成任务和资料完整度查看当前运营状态。</span>
        </div>
        <div className="toolbar-actions">
          <button className="ghost-button" onClick={() => navigate('library')}>查看文章库</button>
          <button className="primary-button" onClick={() => navigate('tasks')}>创建生成任务</button>
        </div>
      </div>

      <div className="metric-row compact-metrics dashboard-kpis">
        {statusCards.map(([title, value, note, Icon, target]) => (
          <button className="metric-card action-metric" key={title} onClick={() => navigate(target)}>
            <Icon size={18} />
            <span>{title}</span>
            <strong>{value}</strong>
            <p>{note}</p>
          </button>
        ))}
      </div>

      <div className="dashboard-data-grid">
        <div className="panel dashboard-table-panel">
          <SectionTitle icon={BarChart3} title="项目表现" desc="按当前已加载资料汇总品牌项目状态。" />
          <div className="ops-table dashboard-project-table">
            <div className="ops-head"><span>品牌项目</span><span>行业/城市</span><span>资料</span><span>成稿</span><span>最近文章</span><span>操作</span></div>
            {projectHealth.map((project) => (
              <div className="ops-row" key={project.name}>
                <strong>{project.name}</strong>
                <span>{project.industry || '未填'} / {project.city || '未填'}</span>
                <span>{project.keywords}词 · {project.knowledge}资料 · {project.images}图</span>
                <span>{project.articles}篇</span>
                <span title={project.latestArticle}>{project.latestArticle}</span>
                <span className="row-actions"><button className="ghost-button" onClick={() => navigate('projects')}>查看</button></span>
              </div>
            ))}
            {!projectHealth.length && <EmptyState title="暂无品牌项目" description="添加品牌项目后，首页会显示项目资料、成稿和任务数据。" action={<button className="primary-button" onClick={() => navigate('projects')}>添加品牌</button>} />}
          </div>
        </div>

        <div className="panel dashboard-side-panel">
          <SectionTitle icon={ClipboardCheck} title="待处理事项" desc="只列出会影响生成和发布的关键项。" />
          <div className="dashboard-attention-list">
            {attentionItems.map(([label, text, target]) => (
              <button key={`${label}-${text}`} onClick={() => navigate(target)}>
                <strong>{label}</strong>
                <span>{text}</span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!attentionItems.length && <p className="dashboard-empty-note">当前资料状态正常。</p>}
          </div>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={FileText} title="最近文章" desc="最新成稿和异常文章集中查看，便于直接进入文章库处理。" />
        <div className="dashboard-article-list">
          {recentArticles.map((article) => (
            <button key={article.id} onClick={() => navigate('library')}>
              <strong title={article.title}>{article.title}</strong>
              <span>{article.project || '未归属项目'} · {article.words || '未统计字数'}</span>
              <em className={article.status === '已生成' ? 'ok' : 'warn'}>{article.status}</em>
            </button>
          ))}
          {!recentArticles.length && <EmptyState title="暂无文章记录" description="创建生成任务后，文章状态会出现在这里。" action={<button className="primary-button" onClick={() => navigate('tasks')}>创建生成任务</button>} />}
        </div>
      </div>

      <div className="dashboard-shortcuts">
        {shortcuts.map(([title, desc, target, Icon]) => (
          <button key={title} onClick={() => navigate(target)}>
            <Icon size={16} />
            <span>
              <strong>{title}</strong>
              <small>{desc}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function Projects({
  notify,
  navigate,
  projectRows,
  setProjectRows,
  activeBrand,
  setActiveBrand,
  setActiveKeyword,
  setArticleRows,
}: ActionProps & ProjectStateProps & ActiveBrandProps & Pick<ActiveKeywordProps, 'setActiveKeyword'> & Pick<ArticleStateProps, 'setArticleRows'>) {
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [understandingProject, setUnderstandingProject] = useState<ProjectRow | null>(null)
  const [draft, setDraft] = useState({
    name: '',
    brand: '',
    recommendWord: '',
    industry: '',
    city: '西安',
  })
  const updateDraft = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const createProject = () => {
    if (!draft.name.trim() || !draft.recommendWord.trim() || !draft.industry.trim() || !draft.city.trim()) {
      notify('请填写项目名称、推荐名称、行业和城市。')
      return
    }
    const now = `${localDate()} 现在`
    const nextProject: ProjectRow = {
      name: draft.name,
      brand: draft.brand.trim() || draft.recommendWord,
      recommendWord: draft.recommendWord,
      coreKeyword: '',
      industry: draft.industry,
      city: draft.city,
      keywords: '待导入',
      assets: '待导入品牌资料',
      status: '新建',
    }
    setProjectRows((current) => [nextProject, ...current.filter((item) => item.name !== draft.name)])
    setActiveBrand(draft.name)
    setActiveKeyword('')
    setShowProjectModal(false)
    notify(`${draft.name}已添加，下一步到关键词页添加核心词并一键蒸馏。`)
  }
  const deleteProject = async (projectName: string) => {
    const keys = ['geo.keywordRows', 'geo.keywordLibraryRows', 'geo.questionRows', 'geo.knowledgeRows', 'geo.knowledgeContentRows', 'geo.galleryRows', 'geo.industrySceneRows', 'geo.rankingCandidateRows', 'geo.taskRows', 'geo.projectUnderstandingRows']
    let sourceState: Record<string, unknown>
    try {
      sourceState = Object.fromEntries(await Promise.all(keys.map(async key => {
        const result = await apiJson<{ value: unknown }>(`/api/state?key=${encodeURIComponent(key)}`, undefined, 5000)
        return [key, result.value ?? []]
      })))
    } catch (error) {
      notify(error instanceof Error ? error.message : '无法读取品牌资料，未执行删除。')
      return
    }
    const updateRows = (key: string, predicate: (row: string[]) => boolean) => {
      const rows = sourceState[key] as string[][]
      const nextRows = rows.filter((row) => !predicate(row))
      projectStorage.setItem(key, JSON.stringify(nextRows))
      void apiJson('/api/state', { key, value: nextRows }, 5000).catch(() => undefined)
    }
    updateRows('geo.keywordRows', (row) => row[0] === projectName)
    updateRows('geo.keywordLibraryRows', (row) => row[0] === projectName)
    updateRows('geo.questionRows', (row) => row.length >= 5 && row[0] === projectName)
    updateRows('geo.knowledgeRows', (row) => row[0] === projectName)
    updateRows('geo.knowledgeContentRows', (row) => row[0] === projectName)
    updateRows('geo.galleryRows', (row) => row[0] === projectName)
    updateRows('geo.industrySceneRows', (row) => row[0] === projectName)
    updateRows('geo.rankingCandidateRows', (row) => row[0] === projectName)
    const savedTasks = sourceState['geo.taskRows'] as Array<Record<string, string>>
    const nextTaskRows = savedTasks.filter((row) => row.project !== projectName)
    projectStorage.setItem('geo.taskRows', JSON.stringify(nextTaskRows))
    void apiJson('/api/state', { key: 'geo.taskRows', value: nextTaskRows }, 5000).catch(() => undefined)
    const profiles = sourceState['geo.projectUnderstandingRows'] as Array<{ project: string }>
    const remainingProfiles = profiles.filter(row => row.project !== projectName)
    projectStorage.setItem('geo.projectUnderstandingRows', JSON.stringify(remainingProfiles))
    void apiJson('/api/state', { key: 'geo.projectUnderstandingRows', value: remainingProfiles }, 5000).catch(() => undefined)
    setArticleRows((current) =>
      current.filter((article) => article.project !== projectName),
    )
    setProjectRows((current) => {
      const nextRows = current.filter((item) => item.name !== projectName)
      const nextActive = nextRows[0]
      if (activeBrand === projectName && nextActive) {
        setActiveBrand(nextActive.name)
        setActiveKeyword(nextActive.coreKeyword)
      }
      if (activeBrand === projectName && !nextActive) {
        setActiveBrand('')
        setActiveKeyword('')
      }
      return nextRows
    })
    notify(`${projectName}已删除，核心词、蒸馏词、关键词库、资料、任务和文章已同步清理。`)
  }
  return (
    <section className="operation-page diagnosis-page">
      <div className="operation-toolbar">
        <div>
          <strong>品牌库</strong>
          <span>先建品牌项目，只保留生成必须用到的基础信息。</span>
        </div>
        <div className="toolbar-actions">
          <button className="primary-button" onClick={() => setShowProjectModal(true)}>添加品牌</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={Workflow} title="品牌列表" desc="先添加品牌，再按品牌进入关键词、知识库和生成任务。" />
        <div className="ops-table project-table">
          <div className="ops-head"><span>项目名称</span><span>推荐名称</span><span>行业</span><span>城市</span><span>资料</span><span>状态</span><span>操作</span></div>
          {!projectRows.length && <EmptyState title="还没有品牌项目" description="点击右上角添加品牌，保存后即可进入项目。" />}
          <PagedRows>{projectRows.map((project) => (
            <div className="ops-row" key={project.name}>
              <strong>{project.name}</strong>
              <span>{project.recommendWord}</span>
              <span>{project.industry}</span>
              <span>{project.city}</span>
              <span>{project.assets}</span>
              <span className="pill">{project.status}</span>
              <span className="row-actions">
                <button onClick={() => {
                  setActiveBrand(project.name)
                  setActiveKeyword(project.coreKeyword)
                  notify(`${project.name}已设为当前项目，请添加核心词。`)
                  navigate('keywords')
                }}>进入</button>
                <button onClick={() => setUnderstandingProject(project)}>项目理解</button>
                <button className="danger-button" onClick={() => deleteProject(project.name)}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      {understandingProject && <ProjectUnderstandingPanel project={understandingProject.name} core={understandingProject.coreKeyword} request={apiJson} canAnalyze={window.__geoIdentity?.role === 'super_admin'} onClose={() => setUnderstandingProject(null)} />}
      {showProjectModal && (
        <div className="modal-backdrop">
          <div className="form-modal">
            <div className="modal-head">
              <strong>添加品牌</strong>
              <button onClick={() => setShowProjectModal(false)}>关闭</button>
            </div>
            <div className="create-grid">
              <EditableField label="项目名称" value={draft.name} onChange={(value) => updateDraft('name', value)} />
              <EditableField label="推荐名称" value={draft.recommendWord} onChange={(value) => updateDraft('recommendWord', value)} />
              <EditableField label="行业" value={draft.industry} onChange={(value) => updateDraft('industry', value)} />
              <EditableField label="城市" value={draft.city} onChange={(value) => updateDraft('city', value)} />
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowProjectModal(false)}>取消</button>
              <button className="primary-button" onClick={createProject}>确定</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type DiagnosisTask = {
  id: string
  type: 'inclusion' | 'report'
  state: string
  brand?: string
  platformNames?: string[]
  platformName?: string
  keywords?: string
  question?: string
  input?: string
  costCents?: number
  statusLabel?: string
  providerRequestId?: string
  reportId?: string
  error?: string
  createdAt?: string
  updatedAt?: string
}

const aiDiagnosisPlatforms = [
  ['1', 'DeepSeek'],
  ['2', '豆包'],
  ['5', '元宝'],
  ['7', '通义'],
  ['3', '文心'],
  ['6', '纳米'],
  ['8', 'Kimi'],
  ['4', '智谱'],
]
const allDiagnosisPlatformIds = aiDiagnosisPlatforms.map((item) => item[0])

function Diagnosis({ notify, projectRows, activeBrand, initialView }: ActionProps & { projectRows: ProjectRow[]; activeBrand: string; initialView: 'standard' | 'pro' }) {
  const [brand, setBrand] = useState(activeBrand || projectRows[0]?.name || '')
  const project = projectRows.find((row) => row.name === brand)
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(allDiagnosisPlatformIds)
  const [keywords, setKeywords] = useState('')
  const [question, setQuestion] = useState('')
  const [optimize, setOptimize] = useState(false)
  const [tasks, setTasks] = useState<DiagnosisTask[]>([])
  const [busy, setBusy] = useState('')
  const diagnosisView = initialView
  const load = async () => {
    const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/tasks', undefined, 20000)
    setTasks(result.tasks || [])
  }
  useEffect(() => { void load().catch((error) => notify(error.message || '诊断记录加载失败')) }, [])
  useEffect(() => {
    const next = activeBrand || projectRows[0]?.name || ''
    if (next && !brand) setBrand(next)
  }, [activeBrand, projectRows])
  useEffect(() => {
    if (!project) return
    const base = project.industry || project.coreKeyword || project.recommendWord || project.name
    setKeywords((current) => current || base)
    const platformName = selectedPlatforms.length === allDiagnosisPlatformIds.length
      ? '主流AI平台'
      : aiDiagnosisPlatforms.find(item => item[0] === selectedPlatforms[0])?.[1] || 'AI平台'
    setQuestion((current) => current || `在${platformName}里搜索${base}，是否能推荐${project.recommendWord || project.name}？`)
  }, [project?.name, selectedPlatforms.join(',')])
  const selectPlatform = (id: string) => setSelectedPlatforms((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const selectAllPlatforms = () => setSelectedPlatforms(allDiagnosisPlatformIds)
  const createInclusion = async () => {
    if (!brand || !keywords.trim()) return notify('请选择品牌并填写查询词')
    if (!selectedPlatforms.length) return notify('请至少选择一个诊断模型')
    setBusy('inclusion')
    try {
      const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/create', { brand, platforms: selectedPlatforms, keywords, question, optimize }, 120000)
      setTasks(result.tasks || tasks)
      notify(`查收录已提交，${selectedPlatforms.length}个模型，共11元`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '查收录提交失败')
    } finally {
      setBusy('')
    }
  }
  const createReport = async () => {
    if (!brand) return notify('请选择品牌')
    setBusy('report')
    try {
      const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/report', { brand, brandName: project?.recommendWord || brand, input: project?.recommendWord || brand, requirement: 'PRO版品牌全网分析报告' }, 120000)
      setTasks(result.tasks || [])
      notify('PRO版品牌全网分析已提交，费用13元')
    } catch (error) {
      notify(error instanceof Error ? error.message : '报告提交失败')
    } finally {
      setBusy('')
    }
  }
  const refresh = async (silent = false) => {
    setBusy('refresh')
    try {
      const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/refresh', {}, 120000)
      setTasks(result.tasks || [])
      if (!silent) notify('诊断状态已刷新')
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setBusy('')
    }
  }
  const download = async (task: DiagnosisTask) => {
    setBusy(`download:${task.id}`)
    try {
      const result = await apiJson<unknown>('/api/diagnosis/download', { id: task.id }, 120000)
      openDiagnosisDownload(result, notify)
      await load()
    } catch (error) {
      notify(error instanceof Error ? error.message : '报告取回失败')
    } finally {
      setBusy('')
    }
  }
  const taskStats = {
    total: tasks.length,
    running: tasks.filter((task) => ['pending', 'running', 'submitted', 'charging'].includes(task.state)).length,
    finished: tasks.filter((task) => task.state === 'finished').length,
    failed: tasks.filter((task) => ['failed', 'refunded'].includes(task.state)).length,
  }
  const standardTasks = tasks.filter((task) => task.type === 'inclusion')
  const reportTasks = tasks.filter((task) => task.type === 'report')
  const hasRunningReport = reportTasks.some((task) => !['finished', 'failed', 'refunded'].includes(task.state))
  useEffect(() => {
    if (!hasRunningReport || busy) return
    const timer = window.setInterval(() => { void refresh(true) }, 60000)
    return () => window.clearInterval(timer)
  }, [hasRunningReport, busy])
  return (
    <section className="operation-page diagnosis-workbench">
      <div className="diagnosis-stage">
        <div className="diagnosis-topbar">
          <div>
            <strong>{diagnosisView === 'pro' ? 'AI诊断Pro版' : 'AI可见度诊断'}</strong>
            <span>{diagnosisView === 'pro' ? '单品牌全网分析，生成PRO诊断报告。' : '选择AI平台、品牌和行业词，提交标准版可见度诊断。'}</span>
          </div>
          <button className="ghost-button" onClick={() => void refresh(false)} disabled={Boolean(busy)}>{busy === 'refresh' ? '刷新中' : '刷新状态'}</button>
        </div>

        <div className="diagnosis-summary-row diagnosis-summary-compact">
          <div><span>诊断记录</span><strong>{taskStats.total}</strong></div>
          <div><span>执行中</span><strong>{taskStats.running}</strong></div>
          <div><span>已完成</span><strong>{taskStats.finished}</strong></div>
          <div><span>失败/退回</span><strong>{taskStats.failed}</strong></div>
        </div>

        {diagnosisView === 'standard' ? (
          <>
            <div className="diagnosis-form-card">
              <div className="diagnosis-form-title">诊断AI大模型平台</div>
              <div className="diagnosis-models diagnosis-models-line">
                <button className={`diagnosis-model all ${selectedPlatforms.length === allDiagnosisPlatformIds.length ? 'active' : ''}`} onClick={selectAllPlatforms}>
                  <span>全</span>全部模型
                </button>
                {aiDiagnosisPlatforms.map((item) => (
                  <button className={`diagnosis-model ${selectedPlatforms.includes(item[0]) ? 'active' : ''}`} key={item[0]} onClick={() => selectPlatform(item[0])}>
                    <span>{item[1].slice(0, 1)}</span>{item[1]}
                  </button>
                ))}
              </div>
              <div className="diagnosis-old-form">
                <div className="diagnosis-step-row">
                  <h3>一、品牌名称</h3>
                  <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                    <option value="">请选择品牌</option>
                    {projectRows.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
                  </select>
                  <p>选择当前要诊断的客户品牌，诊断记录会归属到该品牌。</p>
                </div>
                <div className="diagnosis-step-row">
                  <h3>二、行业词</h3>
                  <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="如：喷墨打印机、AI诊断软件" />
                  <p>多个品牌关键词请按回车键，一次性最多支持输入0/3个词。</p>
                </div>
                <div className="diagnosis-step-row">
                  <h3>三、是否需要优化建议</h3>
                  <div className="diagnosis-choice">
                    <button className={!optimize ? 'active' : ''} onClick={() => setOptimize(false)}>无需优化建议</button>
                    <button className={optimize ? 'active' : ''} onClick={() => setOptimize(true)}>需生成建议报告</button>
                  </div>
                  <p>{optimize ? '生成诊断时同步输出优化建议。' : '仅生成可见度诊断，不输出优化建议。'}</p>
                </div>
                <details className="diagnosis-advanced">
                  <summary>高级问题设置</summary>
                  <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：西安GEO服务公司哪家值得推荐？" />
                </details>
              </div>
              <button className="diagnosis-submit diagnosis-submit-wide" onClick={createInclusion} disabled={Boolean(busy)}>{busy === 'inclusion' ? '提交中' : '创建AI诊断任务（消耗 11.00 元）'}</button>
            </div>
            <DiagnosisRecordBlock title="标准版诊断记录" tasks={standardTasks} empty="暂无标准版诊断记录" onRefresh={() => void refresh(false)} busy={busy} onDownload={(task) => void download(task)} />
          </>
        ) : (
          <>
            <div className="diagnosis-form-card diagnosis-pro-entry">
              <div className="diagnosis-form-title">AI可见度诊断【PRO版】</div>
              <div className="diagnosis-old-form">
                <div className="diagnosis-step-row">
                  <h3>一、品牌名称</h3>
                  <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                    <option value="">请选择品牌</option>
                    {projectRows.map((row) => <option key={row.name} value={row.name}>{row.name}</option>)}
                  </select>
                  <p>可填写公司简称、公司全称或产品品牌名，仅可填写一个。</p>
                </div>
                <div className="diagnosis-pro-callout">
                  <span>品牌全网分析</span>
                  <strong>￥13.00</strong>
                  <small>提交后等待平台生成PRO诊断报告，耗时较长时保持生成中。</small>
                </div>
              </div>
              <button className="diagnosis-submit diagnosis-submit-wide secondary" onClick={createReport} disabled={Boolean(busy)}>{busy === 'report' ? '提交中' : '创建AI诊断任务（消耗 13.00 元）'}</button>
            </div>
            <DiagnosisRecordBlock title="PRO版诊断记录" tasks={reportTasks} empty="暂无PRO版诊断记录" onRefresh={() => void refresh(false)} busy={busy} onDownload={(task) => void download(task)} />
          </>
        )}
      </div>
    </section>
  )
}

function DiagnosisRecordBlock({
  title,
  tasks,
  empty,
  onRefresh,
  busy,
  onDownload,
}: {
  title: string
  tasks: DiagnosisTask[]
  empty: string
  onRefresh: () => void
  busy: string
  onDownload?: (task: DiagnosisTask) => void
}) {
  return (
    <div className="diagnosis-record-card">
      <div className="diagnosis-record-toolbar diagnosis-record-toolbar-modern">
        <div>
          <strong>{title}</strong>
          <span>按老系统报告字段展示：版本、品牌、行业词、分析结果、状态、创建时间。</span>
        </div>
        <button className="ghost-button" onClick={onRefresh} disabled={Boolean(busy)}>{busy === 'refresh' ? '刷新中' : '刷新'}</button>
      </div>
      <DiagnosisTable tasks={tasks} empty={empty} onDownload={onDownload} />
    </div>
  )
}

function diagnosisVersionLabel(task: DiagnosisTask) {
  return task.type === 'report' ? 'PRO版' : '标准版'
}

function diagnosisResultLabel(task: DiagnosisTask) {
  if (task.type === 'report') return task.state === 'finished' ? '查看结果' : '生成中'
  if (task.state === 'finished') return '查看反馈'
  return '等待结果'
}

function diagnosisStateLabel(task: DiagnosisTask) {
  if (task.state === 'refunded') return '已退回'
  if (task.state === 'failed') return '失败'
  if (task.type === 'report') {
    if (task.state === 'finished') return '分析成功'
    if (task.reportId) return '生成中'
    return task.statusLabel?.includes('超时') ? '创建异常' : '生成中'
  }
  if (task.state === 'finished') return '分析成功'
  if (task.statusLabel?.includes('退款')) return '查询完成'
  return '查询中'
}

function diagnosisIndustryText(task: DiagnosisTask) {
  if (task.type === 'report') return task.input || task.question || '-'
  return task.keywords || task.question || '-'
}

function diagnosisFeedbackText(task: DiagnosisTask) {
  if (task.type === 'report') {
    if (task.reportId) return `报告编号：${task.reportId}`
    return task.error || task.statusLabel || '已提交平台，等待报告生成'
  }
  if (task.statusLabel) return task.statusLabel
  if (task.platformNames?.length) return `平台：${task.platformNames.join('、')}`
  return task.providerRequestId ? `请求编号：${task.providerRequestId}` : '-'
}

function diagnosisOperationText(task: DiagnosisTask) {
  if (task.reportId) return `报告编号：${task.reportId}`
  if (task.providerRequestId) return `请求编号：${task.providerRequestId}`
  if (task.type === 'report') return '等待平台返回报告编号'
  return '-'
}

function diagnosisReportViewUrl(task: DiagnosisTask) {
  return `/api/diagnosis/report-view?id=${encodeURIComponent(task.id)}`
}

function DiagnosisTable({ tasks, empty }: { tasks: DiagnosisTask[]; empty: string; onDownload?: (task: DiagnosisTask) => void }) {
  if (!tasks.length) return <div className="empty-state">{empty}</div>
  return (
    <div className="diagnosis-table-wrap">
      <table className="diagnosis-table">
        <thead><tr><th>版本</th><th>品牌</th><th>行业词</th><th>分析结果</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              <td><span className={`diagnosis-version ${task.type}`}>{diagnosisVersionLabel(task)}</span></td>
              <td><strong className="diagnosis-brand-name">{task.brand || task.input || '-'}</strong></td>
              <td><span className="diagnosis-keyword-text">{diagnosisIndustryText(task)}</span></td>
              <td>
                {task.state === 'finished' && (task.type === 'inclusion' || task.reportId)
                  ? <a className="diagnosis-result-button" href={diagnosisReportViewUrl(task)} target="_blank" rel="noopener noreferrer">{diagnosisResultLabel(task)}</a>
                  : <span className="diagnosis-result-muted">{diagnosisResultLabel(task)}</span>}
              </td>
              <td className="diagnosis-status-cell"><span className={`diagnosis-state ${task.state}`}>{diagnosisStateLabel(task)}</span><small>{diagnosisFeedbackText(task)}</small></td>
              <td><small>{task.createdAt ? new Date(task.createdAt).toLocaleString() : task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '-'}</small></td>
              <td><small>{diagnosisOperationText(task)}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function openDiagnosisDownload(payload: unknown, notify: (message: string) => void, popup?: Window | null) {
  const openReport = (link: string) => {
    if (popup && !popup.closed) {
      popup.location.href = link
      return true
    }
    return Boolean(window.open(link, '_blank', 'noopener'))
  }
  const data = payload as Record<string, unknown>
  const raw = (data.download || data.data || data) as Record<string, unknown>
  const url = String(raw.url || raw.download_url || raw.downloadUrl || '')
  if (url) {
    if (!openReport(url)) notify('浏览器拦截了新窗口，请允许弹窗后重试')
    return
  }
  const html = String(raw.html || raw.reportHtml || '')
  if (html.trim().length > 100) {
    if (popup && !popup.closed) {
      popup.document.open()
      popup.document.write(html)
      popup.document.close()
      return
    }
    const link = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const opened = window.open(link, '_blank')
    window.setTimeout(() => URL.revokeObjectURL(link), 120000)
    if (!opened) notify('浏览器拦截了报告页面，请允许弹窗后重试')
    return
  }
  const base64 = String(raw.pdf || raw.pdf_base64 || raw.pdfBase64 || raw.file || '')
  if (base64.length > 100) {
    const bytes = Uint8Array.from(atob(base64.replace(/^data:application\/pdf;base64,/, '')), char => char.charCodeAt(0))
    const link = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    const opened = openReport(link)
    window.setTimeout(() => URL.revokeObjectURL(link), 60000)
    if (!opened) notify('浏览器拦截了PDF报告，请允许弹窗后重试')
    return
  }
  notify('报告已取回，但供应商没有返回可直接打开的下载地址')
}

function Reports({ notify }: ActionProps) {
  const [tasks, setTasks] = useState<DiagnosisTask[]>([])
  const [busy, setBusy] = useState('')
  const load = async () => {
    const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/tasks', undefined, 20000)
    setTasks(result.tasks || [])
  }
  useEffect(() => { void load().catch((error) => notify(error.message || '报告记录加载失败')) }, [])
  const refresh = async (silent = false) => {
    setBusy('refresh')
    try {
      const result = await apiJson<{ tasks: DiagnosisTask[] }>('/api/diagnosis/refresh', {}, 120000)
      setTasks(result.tasks || [])
      if (!silent) notify('报告状态已刷新')
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setBusy('')
    }
  }
  const download = async (task: DiagnosisTask) => {
    setBusy(task.id)
    const popup = window.open('', '_blank')
    if (popup) {
      popup.document.title = '诊断报告加载中'
      popup.document.body.innerHTML = '<p style="font-family:system-ui;padding:24px;color:#334155">诊断报告加载中...</p>'
      popup.opener = null
    }
    try {
      const result = await apiJson<unknown>('/api/diagnosis/download', { id: task.id }, 120000)
      openDiagnosisDownload(result, notify, popup)
      await load()
    } catch (error) {
      if (popup && !popup.closed) popup.close()
      notify(error instanceof Error ? error.message : '报告取回失败')
    } finally {
      setBusy('')
    }
  }
  const reportStats = {
    total: tasks.length,
    finished: tasks.filter((task) => task.state === 'finished').length,
    running: tasks.filter((task) => !['finished', 'failed', 'refunded'].includes(task.state)).length,
    failed: tasks.filter((task) => ['failed', 'refunded'].includes(task.state)).length,
  }
  useEffect(() => {
    if (!reportStats.running || busy) return
    const timer = window.setInterval(() => { void refresh(true) }, 60000)
    return () => window.clearInterval(timer)
  }, [reportStats.running, busy])
  return (
    <section className="operation-page diagnosis-report-page">
      <div className="diagnosis-stage">
        <div className="diagnosis-topbar">
          <div><strong>诊断报告</strong><span>标准版反馈和PRO报告统一管理，完成后可打开查看。</span></div>
          <button className="ghost-button" onClick={() => void refresh(false)} disabled={Boolean(busy)}>{busy === 'refresh' ? '刷新中' : '刷新状态'}</button>
        </div>
        <div className="diagnosis-summary-row diagnosis-summary-compact">
          <div><span>报告总数</span><strong>{reportStats.total}</strong></div>
          <div><span>已完成</span><strong>{reportStats.finished}</strong></div>
          <div><span>生成中</span><strong>{reportStats.running}</strong></div>
          <div><span>失败/退回</span><strong>{reportStats.failed}</strong></div>
        </div>
        <DiagnosisRecordBlock title="诊断报告" tasks={tasks} empty="暂无诊断报告" onRefresh={() => void refresh(false)} busy={busy} onDownload={(task) => void download(task)} />
      </div>
    </section>
  )
}

const defaultPainSeeds = ['报价差异看不懂', '服务边界说不清', '案例真实性难判断', '样稿不能回答客户问题', '后续复查没有记录', '低价承诺难核验']
const defaultDimensionSeeds = ['样稿是否回答真实问题', '服务清单是否对应动作', '案例资料是否可核验', '报价是否写清边界', 'AI回答是否能复查', '后续更新是否有记录']
const defaultFaqSeeds = ['这类企业怎么选GEO公司？', '合作前要看哪些材料？', '报价差异为什么这么大？', '样稿怎么看是否有效？', '做完后怎么复查AI回答？']
const defaultPitSeeds = ['只看低价套餐', '只听固定排名承诺', '不看样稿和服务清单', '不问复查周期', '把GEO当成单次发稿']

function splitInputList(value: string) {
  return String(value || '')
    .split(/\r?\n|[；;、|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinInputList(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean))).join('\n')
}

const writingSceneModes = ['AI场景', '手动场景']

const applicationScenePool = [
  '高新软件外包企业',
  '曲江口腔门诊',
  '未央餐饮加盟品牌',
  '雁塔留学机构',
  '经开区物流企业',
  '航天基地新能源配套企业',
  '碑林心理咨询机构',
  '长安装修公司',
  '浐灞文旅商户',
  '莲湖财税服务公司',
]

function isGeoScene(industry: string) {
  return /(GEO|生成式引擎|AI搜索|AI答案|豆包排名|DeepSeek|文心一言|通义千问)/i.test(String(industry || ''))
}

function projectOwnWritingScene(project: ProjectRow) {
  const city = project.city || '西安'
  const industry = String(project.industry || '').trim()
  if (!industry || isGeoScene(industry)) return `${city}本地企业`
  if (/(企业|公司|机构|品牌|门诊|医院|学校|工厂|门店|商户|老板|团队|客户)$/.test(industry)) return industry
  return `${industry}企业`
}

function sceneForMode(project: ProjectRow, mode: string, index = 0) {
  if (mode === '按实际场景写') return `${project.industry || project.coreKeyword}客户行业自动拓展（第${index + 1}篇）`
  return projectOwnWritingScene(project)
}

function deriveSceneDefaults(industry: string) {
  const text = String(industry || '')
  if (isGeoProviderSceneText(text)) {
    return {
      pains: defaultPainSeeds,
      dimensions: defaultDimensionSeeds,
      faqs: defaultFaqSeeds,
      pitfalls: defaultPitSeeds,
    }
  }
  if (/软件|外包|小程序|系统|开发/.test(text)) {
    return {
      pains: ['项目烂尾风险', '需求边界说不清', '报价后期追加', '源码归属不清', '验收标准模糊', '上线后维护断档'],
      dimensions: ['能否写清项目案例', '能否解释报价边界', '能否沉淀需求评审问题', '能否说明源码和数据权限', '能否把验收售后写进FAQ', '能否复查AI回答是否说准'],
      faqs: ['软件外包企业怎么选GEO公司？', '客户担心项目烂尾时内容怎么写？', '报价和源码边界怎么提前说清？', 'GEO服务商怎么帮软件外包企业被推荐？', '合作前要看哪些样稿？'],
      pitfalls: ['只写技术实力不写交付边界', '只发公司简介不回答烂尾问题', '不说明源码和售后责任', '用固定排名代替内容复查', '样稿脱离真实客户问题'],
    }
  }
  if (/餐饮|加盟|连锁|招商/.test(text)) {
    return {
      pains: ['门店真实性难判断', '供应链能力说不清', '培训扶持边界模糊', '合同费用容易遗漏', '回本周期不能夸大', '加盟后督导缺少说明'],
      dimensions: ['真实门店资料是否清楚', '供应链和培训是否有边界', '合同费用是否写清', '风险问题是否主动回答', '适合加盟商类型是否明确', 'AI回答是否能复查'],
      faqs: ['餐饮加盟品牌怎么选GEO服务商？', '门店真实性怎么写进内容？', '加盟合同风险怎么避坑？', '能不能承诺回本周期？', '合作前要看哪些样稿？'],
      pitfalls: ['夸大收益承诺', '虚构门店和加盟案例', '只写品牌热度不写扶持边界', '不解释合同费用', '不回答加盟商真实顾虑'],
    }
  }
  if (/咨询|民企|管理|股权|绩效|薪酬|组织/.test(text)) {
    return {
      pains: ['老板依赖经验管理', '组织职责拆不清', '薪酬绩效难落地', '股权激励有后患', '干部培养断层', '方案听完没人执行'],
      dimensions: ['是否能讲清咨询方法', '是否能说明落地陪跑边界', '是否覆盖老板真实问题', '是否有阶段复盘路径', '是否能把案例边界讲清', '是否适合当前企业阶段'],
      faqs: ['民企咨询公司怎么做GEO内容？', '客户问薪酬绩效时怎么回答？', '咨询方案落地边界怎么说清？', '怎么判断GEO服务商懂管理咨询？', '哪些企业适合优先做GEO？'],
      pitfalls: ['只写老师名气不写落地方式', '把咨询结果说得过满', '不区分企业阶段', '不解释陪跑边界', '用案例堆砌代替选型判断'],
    }
  }
  return {
    pains: defaultPainSeeds,
    dimensions: defaultDimensionSeeds,
    faqs: defaultFaqSeeds,
    pitfalls: defaultPitSeeds,
  }
}

function buildDefaultSceneRow(activeBrand: string, project?: ProjectRow) {
  const city = project?.city || '西安'
  const industry = project?.industry || '本地企业'
  const scene = `${city}${industry}`.replace(/企业企业$/, '企业')
  const defaults = deriveSceneDefaults(industry)
  return [
    activeBrand,
    scene,
    joinInputList(defaults.pains),
    joinInputList(defaults.dimensions),
    joinInputList(defaults.faqs),
    joinInputList(defaults.pitfalls),
    localDate(),
  ]
}

function IndustryScenes({
  notify,
  navigate,
  projectRows,
  activeBrand,
  setActiveBrand,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps) {
  const [sceneRows, setSceneRows] = useStoredState<string[][]>('geo.industrySceneRows', [])
  const [showSceneModal, setShowSceneModal] = useState(false)
  const [editingScene, setEditingScene] = useState('')
  const activeProject = projectRows.find((project) => project.name === activeBrand)
  const visibleRows = sceneRows.filter((row) => row[0] === activeBrand)
  const [draft, setDraft] = useState({
    scene: '',
    pains: '',
    dimensions: '',
    faqs: '',
    pitfalls: '',
  })
  const updateDraft = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const openSceneModal = (scene?: string) => {
    if (!activeBrand) {
      notify('请先添加项目。')
      return
    }
    const current = sceneRows.find((row) => row[0] === activeBrand && row[1] === scene)
    const defaults = deriveSceneDefaults(activeProject?.industry || '')
    setEditingScene(scene ?? '')
    setDraft({
      scene: current?.[1] ?? `${activeProject?.city || '西安'}${activeProject?.industry || '本地企业'}`,
      pains: current?.[2] ?? joinInputList(defaults.pains),
      dimensions: current?.[3] ?? joinInputList(defaults.dimensions),
      faqs: current?.[4] ?? joinInputList(defaults.faqs),
      pitfalls: current?.[5] ?? joinInputList(defaults.pitfalls),
    })
    setShowSceneModal(true)
  }
  const saveScene = () => {
    if (!draft.scene.trim()) {
      notify('请填写客户场景。')
      return
    }
    const row = [
      activeBrand,
      draft.scene.trim(),
      joinInputList(splitInputList(draft.pains)),
      joinInputList(splitInputList(draft.dimensions)),
      joinInputList(splitInputList(draft.faqs)),
      joinInputList(splitInputList(draft.pitfalls)),
      localDate(),
    ]
    setSceneRows((current) => [row, ...current.filter((item) => !(item[0] === activeBrand && item[1] === (editingScene || draft.scene.trim())))])
    setShowSceneModal(false)
    notify(`${draft.scene}已保存，文章生成时可直接选择这个实景稿料。`)
  }
  const deleteScene = (scene: string) => {
    setSceneRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === scene)))
    notify(`${scene}已删除。`)
  }
  const createDefaultScene = () => {
    if (!activeBrand) {
      notify('请先添加项目。')
      return
    }
    const row = buildDefaultSceneRow(activeBrand, activeProject)
    setSceneRows((current) => [row, ...current.filter((item) => !(item[0] === activeBrand && item[1] === row[1]))])
    notify(`${row[1]}默认稿料已生成，可直接编辑或去创建文章任务。`)
  }
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>客户场景稿料</strong>
          <span>这里准备文章开头要进入的真实客户场景，以及后面要展开的痛点、选型维度和FAQ。</span>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => <option key={project.name}>{project.name}</option>)}
          </select>
          <button className="ghost-button" onClick={createDefaultScene}>一键生成默认稿料</button>
          <button className="primary-button" onClick={() => openSceneModal()}>添加场景</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={SearchCheck} title="场景稿料列表" desc="新项目可以先一键生成默认稿料，再按真实客户行业微调。" />
        <div className="ops-table scene-table">
          <div className="ops-head"><span>客户场景</span><span>客户痛点</span><span>选型维度</span><span>常见问题</span><span>操作</span></div>
          <PagedRows>{visibleRows.map((row) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}`}>
              <strong>{row[1]}</strong>
              <span>{splitInputList(row[2]).slice(0, 3).join('、') || '待补'}</span>
              <span>{splitInputList(row[3]).slice(0, 3).join('、') || '待补'}</span>
              <span>{splitInputList(row[4]).slice(0, 2).join('、') || '待补'}</span>
              <span className="row-actions">
                <button onClick={() => openSceneModal(row[1])}>编辑</button>
                <button onClick={() => navigate('tasks')}>去生成</button>
                <button className="danger-button" onClick={() => deleteScene(row[1])}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
        {!visibleRows.length && (
          <div className="empty-card">
            <strong>还没有客户场景稿料</strong>
            <div className="empty-actions">
              <button className="primary-button" onClick={createDefaultScene}>一键生成默认稿料</button>
              <button className="ghost-button" onClick={() => openSceneModal()}>手动添加</button>
            </div>
          </div>
        )}
      </div>

      {showSceneModal && (
        <div className="modal-backdrop">
          <div className="form-modal wide-modal">
            <div className="modal-head">
              <strong>{editingScene ? '编辑客户场景' : '添加客户场景'}</strong>
              <button onClick={() => setShowSceneModal(false)}>关闭</button>
            </div>
            <div className="create-grid single">
              <EditableField label="客户场景" value={draft.scene} onChange={(value) => updateDraft('scene', value)} />
            </div>
            <label className="textarea-field"><span>客户痛点，一行一个</span><textarea value={draft.pains} onChange={(event) => updateDraft('pains', event.target.value)} /></label>
            <label className="textarea-field"><span>选型维度，一行一个</span><textarea value={draft.dimensions} onChange={(event) => updateDraft('dimensions', event.target.value)} /></label>
            <label className="textarea-field"><span>常见问题，一行一个</span><textarea value={draft.faqs} onChange={(event) => updateDraft('faqs', event.target.value)} /></label>
            <label className="textarea-field"><span>避坑问题，一行一个</span><textarea value={draft.pitfalls} onChange={(event) => updateDraft('pitfalls', event.target.value)} /></label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowSceneModal(false)}>取消</button>
              <button className="primary-button" onClick={saveScene}>保存场景</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

type ProviderResearch = { company: string; status: string; researchedAt?: string; note: string; facts: { text: string; category: string; sourceType: string; source: { title: string; url: string } }[] }
function providerResearch(row: string[]): ProviderResearch | null {
  try { return row[8] ? JSON.parse(row[8]) as ProviderResearch : null } catch { return null }
}

function RankingCandidates({
  notify,
  navigate,
  projectRows,
  activeBrand,
  setActiveBrand,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps) {
  const [candidateRows, setCandidateRows, candidateState] = useStoredState<string[][]>('geo.rankingCandidateRows', [])
  const autoQueried = useRef(new Set<string>())
  const [showCandidateModal, setShowCandidateModal] = useState(false)
  const activeProject = projectRows.find((project) => project.name === activeBrand)
  const mainBrandName = activeProject?.recommendWord || activeProject?.brand || activeProject?.name || ''
  const visibleRows = candidateRows.filter((row) => row[0] === activeBrand && row[1] !== mainBrandName && row[6] !== '是')
  const [companyDraft, setCompanyDraft] = useState(['', '', '', ''])
  const [researching, setResearching] = useState('')
  const [savingCompanies, setSavingCompanies] = useState(false)
  const [companySaveError, setCompanySaveError] = useState('')
  const [researchDetail, setResearchDetail] = useState<ProviderResearch | null>(null)
  const canResearch = ['super_admin','project_admin','project_operator'].includes(window.__geoIdentity?.role || '')
  const updateResearch = async (names: string[]) => {
    if (!canResearch) return
    const brand = activeBrand
    const scope = identityKey()
    for (const company of names) {
      if (scope !== identityKey()) break
      setResearching(company)
      let research: ProviderResearch
      try {
        const result = await apiJson<{ research: ProviderResearch }>('/api/providers/research', { brand, company }, 165000)
        research = result.research
      } catch (error) {
        if (scope !== identityKey()) break
        research = { company, status: 'failed', facts: [], note: error instanceof Error ? error.message : '联网查询失败，请重试' }
      }
      if (scope !== identityKey()) break
      setCandidateRows(current => current.map(row => {
        if (row[0] !== brand || row[1] !== company) return row
        const previous = providerResearch(row)
        const next = [...row]
        next[8] = JSON.stringify(research.status === 'failed' && previous?.facts.length ? { ...previous, note: `本次更新失败，保留上次资料：${research.note}` } : research)
        return next
      }))
    }
    setResearching('')
  }
  const openCandidateModal = () => {
    if (!activeBrand) {
      notify('请先添加项目。')
      return
    }
    const names = visibleRows.slice(0, 4).map((row) => row[1])
    setCompanyDraft([...names, '', '', '', ''].slice(0, 4))
    setCompanySaveError('')
    setShowCandidateModal(true)
  }
  const updateCompanyDraft = (index: number, value: string) => {
    setCompanyDraft((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))
  }
  const saveCompanies = async () => {
    if (savingCompanies) return
    const names = Array.from(new Set(companyDraft.map((item) => item.trim()).filter(Boolean))).slice(0, 4)
    if (!names.length) {
      notify('请至少填写1家对比公司。')
      return
    }
    setSavingCompanies(true)
    setCompanySaveError('')
    const rows = names.map((name) => visibleRows.find(row => row[1] === name) || [activeBrand, name, '对比公司', '', '', '', '否', localDate()])
    const savedRows = [
      ...rows,
      ...candidateRows.filter((row) => row[0] !== activeBrand || row[6] === '是'),
    ]
    try {
      const result = await apiJson<{ value: string[][] }>('/api/state', {key:'geo.rankingCandidateRows', value:savedRows}, 30000)
      setCandidateRows(result.value || savedRows)
      setShowCandidateModal(false)
      notify(`已保存${rows.length}家对比公司${canResearch ? '，开始联网补充资料。' : '。'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '公司保存失败，请重试'
      setCompanySaveError(message)
      notify(message)
    } finally {
      setSavingCompanies(false)
    }
  }
  const deleteCandidate = (name: string) => {
    setCandidateRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === name)))
    notify(`${name}已删除。`)
  }
  useEffect(() => {
    if (candidateState.loading || candidateState.error || researching || !canResearch) return
    const names = visibleRows.filter(row => !providerResearch(row)?.facts.length && !autoQueried.current.has(`${identityKey()}:${activeBrand}:${row[1]}`)).map(row => row[1])
    for (const name of names) autoQueried.current.add(`${identityKey()}:${activeBrand}:${name}`)
    if (names.length) void updateResearch(names)
  }, [candidateState.loading, candidateState.error, candidateRows, activeBrand, researching, canResearch])
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>榜单服务商</strong>
          <span>对比公司资料 · 主推企业：{mainBrandName}</span>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => <option key={project.name}>{project.name}</option>)}
          </select>
          <button className="primary-button" disabled={Boolean(researching)} onClick={openCandidateModal}>{visibleRows.length ? '编辑4家公司' : '添加4家公司'}</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={ClipboardCheck} title="对比公司列表" desc="榜单、测评、口碑、对比类文章会调用这里；非榜单文章不用管。" />
        <div className="ops-table candidate-table simple-candidate-table">
          <div className="ops-head"><span>公司名称与业务介绍</span><span>状态</span><span>操作</span></div>
          <PagedRows>{visibleRows.map((row) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}`}>
              <div className="provider-summary"><strong>{row[1]}</strong><p>{providerResearch(row)?.facts.slice(0, 3).map(fact => fact.text).join('；') || (researching === row[1] ? '正在检索业务介绍…' : providerResearch(row)?.status === 'failed' ? '业务介绍查询失败，可重新查询。' : '尚无已核实的业务介绍')}</p></div>
              <span>{researching === row[1] ? '正在联网查询…' : providerResearch(row)?.facts.length ? `${providerResearch(row)?.facts.length}条资料` : providerResearch(row)?.status === 'failed' ? '查询失败' : providerResearch(row) ? '待确认' : '待查询'}</span>
              <span className="row-actions">
                <button disabled={!providerResearch(row)} onClick={() => setResearchDetail(providerResearch(row))}>业务介绍</button>
                <button onClick={() => navigate('tasks')}>去生成</button>
                <button className="danger-button" onClick={() => deleteCandidate(row[1])}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
        {!visibleRows.length && (
          <div className="empty-card">
            <strong>还没有对比公司</strong>
            <div className="empty-actions">
              <button className="primary-button" onClick={openCandidateModal}>添加4家公司</button>
            </div>
          </div>
        )}
      </div>

      {researchDetail && <div className="modal-backdrop"><div className="form-modal wide-modal">
        <div className="modal-head"><strong>{researchDetail.company} · 业务介绍</strong><button onClick={() => setResearchDetail(null)}>关闭</button></div>
        <div style={{ maxHeight: '55vh', overflowY: 'auto', overflowWrap: 'anywhere' }}>
          {researchDetail.facts.map((fact, index) => <section key={index} style={{ padding: '12px 0', borderBottom: '1px solid #e2e8f0' }}>
            <p>{fact.text}</p>
          </section>)}
        </div>
      </div></div>}

      {showCandidateModal && (
        <div className="modal-backdrop">
          <div className="form-modal compact-modal">
            <div className="modal-head">
              <strong>添加4家对比公司</strong>
              <button onClick={() => setShowCandidateModal(false)}>关闭</button>
            </div>
            <div className="company-name-grid">
              {companyDraft.map((name, index) => (
                <EditableField key={index} label={`公司${index + 1}`} value={name} onChange={(value) => updateCompanyDraft(index, value)} />
              ))}
            </div>
            {companySaveError && <p className="form-error" role="alert">{companySaveError}</p>}
            <div className="modal-actions">
              <button className="ghost-button" disabled={savingCompanies} onClick={() => setShowCandidateModal(false)}>取消</button>
              <button className="primary-button" disabled={savingCompanies || Boolean(researching)} onClick={saveCompanies}>{savingCompanies ? '正在保存…' : canResearch ? '保存并查询资料' : '保存公司'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Keywords({
  notify,
  navigate,
  projectRows,
  activeBrand,
  setActiveBrand,
  activeKeyword,
  setActiveKeyword,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps & ActiveKeywordProps) {
  const [showKeywordModal, setShowKeywordModal] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const [hitWord, setHitWord] = useState('')
  const [distillCount, setDistillCount] = useState('20')
  const [distilling, setDistilling] = useState(false)
  const [distillError, setDistillError] = useState('')
  const distillScope = useRef(activeBrand)
  useEffect(() => { distillScope.current=activeBrand; setShowKeywordModal(false); return ()=>{distillScope.current=''} }, [activeBrand])
  const [keywordRows, setKeywordRows, keywordState] = useStoredState<string[][]>('geo.keywordRows', [])
  const [questionRows, setQuestionRows, questionState] = useStoredState<string[][]>('geo.questionRows', [])
  const [, setKeywordLibraryRows] = useStoredState<string[][]>('geo.keywordLibraryRows', [])
  const projectKeywords = keywordRows.filter((row) => row[0] === activeBrand)
  const activeCoreKeyword = projectKeywords.some((row) => row[1] === activeKeyword)
    ? activeKeyword
    : projectKeywords[0]?.[1] ?? ''
  const createKeyword = async () => {
    if(distilling)return
    if (!activeBrand) {
      notify('请先在企业品牌库添加品牌。')
      return
    }
    if (!keywordInput.trim()) {
      notify('请填写核心词。')
      return
    }
    const count=Number(distillCount),core=keywordInput.trim(),brand=activeBrand
    if(!Number.isInteger(count)||count<1||count>20){setDistillError('生成数量须为1至20的整数');return}
    setDistilling(true);setDistillError('')
    try {
      const r=await apiJson<{terms:string[];keywordRows:string[][];questionRows:string[][]}>('/api/keywords/distill',{brand,coreKeyword:core,count},600000)
      if(distillScope.current!==brand)return
      keywordState.retry();questionState.retry()
      setActiveKeyword(core);setShowKeywordModal(false)
      notify(r.terms.length?`已新增${r.terms.length}个简短选择意图词，历史词已保留。`:'常用蒸馏词已齐全，无重复添加。')
    } catch(error) {if(distillScope.current===brand)setDistillError(error instanceof Error?error.message:'蒸馏失败，已有词库未改动')}
    finally {setDistilling(false)}
  }
  const deleteKeyword = (core: string) => {
    setKeywordRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === core)))
    setQuestionRows((current) => current.filter((row) => !questionBelongsToBrand(row, activeBrand, core)))
    setKeywordLibraryRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === core)))
    if (activeKeyword === core) {
      const nextCore = projectKeywords.find((row) => row[1] !== core)?.[1] ?? ''
      setActiveKeyword(nextCore)
    }
    notify(`${core}已删除，对应蒸馏词和关键词库已同步移除。`)
  }
  const visibleQuestionRows = questionRows.filter((row) => questionBelongsToBrand(row, activeBrand, activeCoreKeyword))
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>关键词</strong>
          <span>选择项目，添加核心词，一键蒸馏推荐型搜索问题。</span>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" disabled={distilling} value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => (
              <option key={project.name}>{project.name}</option>
            ))}
          </select>
          <button className="primary-button" disabled={distilling} onClick={() => {
            if (!activeBrand) {
              notify('请先在企业品牌库添加品牌。')
              return
            }
            const currentProject = projectRows.find((project) => project.name === activeBrand)
            setKeywordInput(currentProject?.coreKeyword ?? '')
            setHitWord(currentProject?.recommendWord ?? '')
            setDistillError('')
            setShowKeywordModal(true)
          }}>添加核心词</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={KeyRound} title="核心词列表" desc="只显示当前品牌的核心词和蒸馏词数量。" />
        <div className="ops-table keyword-table">
          <div className="ops-head">
            <span>核心词</span><span>蒸馏词</span><span>状态</span><span>创建时间</span><span>操作</span>
          </div>
          <PagedRows>{projectKeywords.map((row, index) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}-${index}`}>
              <strong>{row[1]}</strong>
              <span>{row[2]}</span>
              <span className="pill">{row[3]}</span>
              <span>{row[4]}</span>
              <span className="row-actions">
                <button disabled={distilling} onClick={()=>{setKeywordInput(row[1]);setHitWord(row[5]||'');setDistillError('');setShowKeywordModal(true)}}>拓展</button>
                <button onClick={() => {
                  setActiveKeyword(row[1])
                }}>查看</button>
                <button className="danger-button" disabled={distilling} onClick={() => deleteKeyword(row[1])}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={MessageSquareText} title="蒸馏词列表" desc="这里展示当前核心词自动生成的推荐型搜索问题，用来生成标题和文章主问题。" />
        <div className="ops-table question-table">
          <div className="ops-head">
            <span>主词</span><span>蒸馏疑问词</span><span>收录状态</span><span>创建时间</span><span>操作</span>
          </div>
          <PagedRows>{visibleQuestionRows.map((row, index) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}-${readQuestionText(row)}-${index}`}>
              <strong>{row.length >= 5 ? row[1] : row[0]}</strong>
              <span>{readQuestionText(row)}</span>
              <span className="pill muted">{row.length >= 5 ? row[3] : row[2]}</span>
              <span>{row.length >= 5 ? row[4] : row[3]}</span>
              <button onClick={() => {
                setActiveKeyword(row.length >= 5 ? row[1] : row[0])
                navigate('tasks')
              }}>创建任务</button>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      {showKeywordModal && (
        <div className="modal-backdrop">
          <div className="form-modal">
            <div className="modal-head">
              <strong>蒸馏选择意图词</strong>
              <button disabled={distilling} onClick={() => setShowKeywordModal(false)}>关闭</button>
            </div>
            <div className="create-grid single">
              <Field label="归属项目" value={activeBrand} />
              <Field label="推荐名称" value={hitWord || projectRows.find((project) => project.name === activeBrand)?.recommendWord || ''} />
              <label className="field"><span>核心词</span><input aria-label="核心词" value={keywordInput} disabled={distilling} maxLength={40} onChange={e=>setKeywordInput(e.target.value)} /></label>
              <label className="field"><span>生成数量</span><input aria-label="拓展数量" type="number" min="1" max="20" step="1" value={distillCount} disabled={distilling} onChange={e=>setDistillCount(e.target.value)} /></label>
              {distillError && <p role="alert">{distillError}</p>}
            </div>
            <div className="modal-actions">
              <button className="primary-button" disabled={distilling} onClick={()=>void createKeyword()}>{distilling?'正在生成…':'一键蒸馏'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function KeywordLibrary({
  notify,
  navigate,
  projectRows,
  activeBrand,
  setActiveBrand,
  activeKeyword,
  setActiveKeyword,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps & ActiveKeywordProps) {
  const [showExpandModal, setShowExpandModal] = useState(false)
  const [expanding, setExpanding] = useState(false)
  const [expandError, setExpandError] = useState('')
  const [manualWords, setManualWords] = useState('')
  const [industrySeed, setIndustrySeed] = useState('')
  const [expandCount, setExpandCount] = useState('50')
  const [intentFilter, setIntentFilter] = useState('全部')
  const [editingWord, setEditingWord] = useState('')
  const [savingScenes, setSavingScenes] = useState(false)
  const sceneScope=useRef('')
  useEffect(()=>{sceneScope.current=activeBrand+'|'+activeKeyword;setShowExpandModal(false);setManualWords('');setEditingWord('');return()=>{sceneScope.current=''}},[activeBrand,activeKeyword])
  const [wordFilter, setWordFilter] = useState('')
  const [keywordRows] = useStoredState<string[][]>('geo.keywordRows', [])
  const [keywordLibraryRows, , libraryState] = useStoredState<string[][]>('geo.keywordLibraryRows', [])
  const activeProject = projectRows.find((project) => project.name === activeBrand) ?? projectRows[0] ?? createEmptyProject(activeBrand)
  const projectCoreRows = keywordRows.filter((row) => row[0] === activeBrand)
  const currentKeyword = projectCoreRows.some((row) => row[1] === activeKeyword)
    ? activeKeyword
    : projectCoreRows[0]?.[1] ?? activeProject.coreKeyword ?? ''
  const baseRows = keywordLibraryRows
    .filter((row) => row[0] === activeBrand && row[1] === currentKeyword)
    .map((row) => {
      const normalizedWord = normalizeKeywordLibraryWords([row[2]])[0] ?? row[2]
      return [row[0], row[1], normalizedWord, row[3]==='场景业务词'?'场景业务词':'历史拓展词', row[4]]
    })
    .filter((row) => row[2] !== currentKeyword)
  const visibleRows = baseRows.filter((row) => {
    const intentMatched = intentFilter === '全部' || row[3] === intentFilter
    const wordMatched = !wordFilter.trim() || row[2].includes(wordFilter.trim()) || row[1].includes(wordFilter.trim())
    return intentMatched && wordMatched
  })
  const generateCandidates = async () => {
    if (expanding) return
    if(!Number.isInteger(Number(expandCount))||Number(expandCount)<1||Number(expandCount)>200){setExpandError('拓展数量须为1至200的整数');return}
    if (!activeBrand || !currentKeyword) {
      notify('请先选择品牌和核心词。')
      return
    }
    setExpanding(true)
    setExpandError('')
    const scope=sceneScope.current
    try {
      const result = await apiJson<{ ok: boolean; words?: string[] }>('/api/keywords/scenes', {
        brand: activeBrand,
        recommendWord: activeProject.recommendWord,
        coreKeyword: currentKeyword,
        city: activeProject.city,
        direction: industrySeed,
        count: Number(expandCount),
      },600000)
      if(scope!==sceneScope.current)return
      const apiWords = result.words ?? []
      if (apiWords.length) {
        const limit = Math.min(Math.max(Number.parseInt(expandCount, 10) || 20, 1), 200)
        const cleanWords = normalizeKeywordLibraryWords(apiWords).slice(0, limit)
        setManualWords(current=>[...new Set([...current.split('\n').filter(Boolean),...cleanWords])].join('\n'))
        notify(`已返回${cleanWords.length}个行业词${cleanWords.length<Number(expandCount)?`（目标${expandCount}个）`:''}，可编辑或补充后保存。`)
        return
      }
      setExpandError('接口未返回拓展词，已保留当前内容。')
    } catch (error) {
      const reason = error instanceof Error ? error.message : '请求失败'
      if(scope===sceneScope.current)setExpandError(`场景拓展失败：${reason}`)
    } finally {
      setExpanding(false)
    }
  }
  const saveCandidates = async () => {
    if(expanding||savingScenes)return
    if (!activeBrand || !currentKeyword) {
      notify('请先选择品牌和核心词。')
      return
    }
    const savedWords = normalizeKeywordLibraryWords(manualWords.split(/[\n,，、;；/|]+/))
      .filter((word) => word !== currentKeyword)
    if (!savedWords.length) {
      notify('请手动填写或AI拓展场景业务词。')
      return
    }
    if(savedWords.some(w=>w.length>40||/[?？。！!]|哪家|怎么选|如何选|推荐|排名/.test(w))){setExpandError('请填写40字以内的场景业务词，不要填写选择问句。');return}
    setSavingScenes(true);setExpandError('')
    try {
      const fresh=await apiJson<{value:string[][]}>('/api/state?key=geo.keywordLibraryRows')
      const value=[...savedWords.map(word=>[activeBrand,currentKeyword,word,'场景业务词','已启用']),...(fresh.value||[]).filter(r=>!(r[0]===activeBrand&&r[1]===currentKeyword&&(savedWords.includes(r[2])||r[2]===editingWord)))]
      await apiJson('/api/state',{key:'geo.keywordLibraryRows',value})
      libraryState.retry();setShowExpandModal(false);notify(`已保存${savedWords.length}个场景业务词。`)
    }catch(e){setExpandError(e instanceof Error?e.message:'保存失败，请重试')}
    finally{setSavingScenes(false)}
  }
  const deleteKeywordLibraryWord = async (row: string[]) => {
    if(savingScenes||!window.confirm(`确定删除“${row[2]}”？`))return
    setSavingScenes(true)
    try{
      const fresh=await apiJson<{value:string[][]}>('/api/state?key=geo.keywordLibraryRows')
      await apiJson('/api/state',{key:'geo.keywordLibraryRows',value:(fresh.value||[]).filter(item=>!(item[0]===row[0]&&item[1]===row[1]&&item[2]===row[2]))})
      libraryState.retry();notify('场景业务词已删除。')
    }catch(e){notify(e instanceof Error?e.message:'删除失败')}
    finally{setSavingScenes(false)}
  }
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>扩展行业词</strong>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => (
              <option key={project.name}>{project.name}</option>
            ))}
          </select>
          <select className="search-input" value={currentKeyword} onChange={(event) => setActiveKeyword(event.target.value)}>
            {projectCoreRows.length ? projectCoreRows.map((row) => <option key={row[1]}>{row[1]}</option>) : <option>{currentKeyword}</option>}
          </select>
          <button className="primary-button" onClick={() => {
            if (!activeBrand || !currentKeyword) {
              notify('请先在核心词页面添加核心词。')
              return
            }
            setEditingWord('');setManualWords('');setExpandError('');setShowExpandModal(true)
          }}>添加行业词</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={ListChecks} title="行业词列表" desc="" />
        <div className="filter-row">
          <input className="search-input" value={wordFilter} onChange={(event) => setWordFilter(event.target.value)} placeholder="筛选关键词" />
          <select className="search-input" value={intentFilter} onChange={(event) => setIntentFilter(event.target.value)}>
            <option>全部</option>
            <option>场景业务词</option>
            <option>历史拓展词</option>
          </select>
          <span className="table-note">当前显示 {visibleRows.length} / {baseRows.length} 个词</span>
        </div>
        <div className="ops-table keyword-library-table">
          <div className="ops-head">
            <span>核心词</span><span>场景业务词</span><span>分类</span><span>状态</span><span>操作</span>
          </div>
          <PagedRows>{visibleRows.map((row) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}-${row[2]}`}>
              <strong>{row[1]}</strong>
              <span>{row[2]}</span>
              <span>{row[3]}</span>
              <span className="pill">{row[4]}</span>
              <span className="row-actions">
                <button onClick={()=>{setEditingWord(row[2]);setManualWords(row[2]);setExpandError('');setShowExpandModal(true)}}>编辑</button>
                <button className="danger-button" disabled={savingScenes} onClick={() => void deleteKeywordLibraryWord(row)}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      {showExpandModal && (
        <div className="modal-backdrop">
          <div className="form-modal wide-modal">
            <div className="modal-head">
              <strong>{editingWord?'编辑行业词':'添加行业词'}</strong>
              <button disabled={expanding||savingScenes} onClick={() => setShowExpandModal(false)}>关闭</button>
            </div>
            <div className="create-grid">
              <Field label="项目名称" value={activeBrand} />
              <Field label="项目推荐词" value={activeProject.recommendWord} />
              <Field label="核心词" value={currentKeyword} />
              <EditableField label="业务方向（选填）" value={industrySeed} onChange={setIndustrySeed} />
              <label className="field"><span>拓展数量</span><input aria-label="拓展数量" type="number" min="1" max="200" value={expandCount} disabled={expanding||savingScenes} onChange={e=>setExpandCount(e.target.value)} /></label>
            </div>
            <label className="textarea-field">
              <span>场景业务词（每行一个）</span>
              <textarea aria-label="场景业务词（每行一个）" value={manualWords} disabled={savingScenes} onChange={(event) => setManualWords(event.target.value)} />
            </label>
            <div className="modal-actions">
              {expandError && <p role="alert" style={{ color: '#b42318', flex: 1 }}>{expandError}</p>}
              <button className="ghost-button" disabled={expanding||savingScenes||Boolean(editingWord)} onClick={generateCandidates}>{expanding ? '正在理解业务并拓展…' : 'AI拓展'}</button>
              <button className="primary-button" disabled={expanding||savingScenes} onClick={()=>void saveCandidates()}>{savingScenes?'正在保存…':'保存场景业务词'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Knowledge({
  notify,
  projectRows,
  activeBrand,
  setActiveBrand,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps) {
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false)
  const [editingKnowledge, setEditingKnowledge] = useState('')
  const [knowledgeRows, setKnowledgeRows] = useStoredState<string[][]>('geo.knowledgeRows', [])
  const [knowledgeContentRows, setKnowledgeContentRows] = useStoredState<string[][]>('geo.knowledgeContentRows', [])
  const visibleKnowledgeRows = knowledgeRows.filter((row) => row[0] === activeBrand)
  const activeProject = projectRows.find((project) => project.name === activeBrand)
  const [knowledgeDraft, setKnowledgeDraft] = useState({
    name: '新建项目知识库',
    brandAssets: '',
    authorityEvidence: '',
  })
  const updateKnowledgeDraft = (key: keyof typeof knowledgeDraft, value: string) => {
    setKnowledgeDraft((current) => ({ ...current, [key]: value }))
  }
  const openKnowledgeModal = (name?: string) => {
    if (!activeBrand) {
      notify('请先在企业品牌库添加品牌。')
      return
    }
    const current = knowledgeRows.find((row) => row[0] === activeBrand && row[1] === name)
    const currentContent = knowledgeContentRows.find((row) => row[0] === activeBrand && row[1] === name)
    setEditingKnowledge(name ?? '')
    setKnowledgeDraft({
      name: current?.[1] ?? `${activeBrand}知识库`,
      brandAssets: currentContent?.[3] ?? '',
      authorityEvidence: currentContent?.[4] ?? '',
    })
    setShowKnowledgeModal(true)
  }
  const createKnowledge = () => {
    if (!activeBrand) {
      notify('请先在企业品牌库添加品牌。')
      return
    }
    const assetScore = knowledgeDraft.brandAssets.length > 30 ? 45 : 25
    const evidenceScore = knowledgeDraft.authorityEvidence.length > 30 ? 45 : 20
    const displayName = activeProject?.recommendWord || activeProject?.brand || activeBrand
    setKnowledgeRows((current) => [
      [activeBrand, knowledgeDraft.name, displayName, `品牌资产${assetScore >= 45 ? '已填' : '待补'} / 权威引证${evidenceScore >= 45 ? '已填' : '待补'}`, `${Math.min(assetScore + evidenceScore, 96)}%`, localDate()],
      ...current.filter((row) => !(row[0] === activeBrand && row[1] === knowledgeDraft.name)),
    ])
    setKnowledgeContentRows((current) => [
      [activeBrand, knowledgeDraft.name, displayName, knowledgeDraft.brandAssets, knowledgeDraft.authorityEvidence, localDate()],
      ...current.filter((row) => !(row[0] === activeBrand && row[1] === knowledgeDraft.name)),
    ])
    setShowKnowledgeModal(false)
    notify(`${knowledgeDraft.name}已创建，品牌资产和权威引证已分区保存。`)
  }
  const deleteKnowledge = (name: string) => {
    setKnowledgeRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === name)))
    setKnowledgeContentRows((current) => current.filter((row) => !(row[0] === activeBrand && row[1] === name)))
    notify(`${name}已删除，品牌资产和权威引证内容已同步移除。`)
  }
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>品牌知识库</strong>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => (
              <option key={project.name}>{project.name}</option>
            ))}
          </select>
          <button className="primary-button" onClick={() => openKnowledgeModal()}>添加资料</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={BookOpenText} title="知识库列表" desc="一个项目可维护一套或多套资料，生成时按当前项目调用。" />
        <div className="ops-table kb-table">
          <div className="ops-head"><span>知识库名称</span><span>推荐名称</span><span>资料状态</span><span>完整度</span><span>创建时间</span><span>操作</span></div>
          <PagedRows>{visibleKnowledgeRows.map((row) => (
            <div className="ops-row" key={`${row[0]}-${row[1]}`}>
              <strong>{row[1]}</strong>
              <span>{row[2]}</span>
              <span className={row[3] === '待完善' ? 'pill muted' : 'pill'}>{row[3]}</span>
              <span>{row[4]}</span>
              <span>{row[5]}</span>
              <span className="row-actions">
                <button onClick={() => openKnowledgeModal(row[1])}>编辑</button>
                <button className="danger-button" onClick={() => deleteKnowledge(row[1])}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      {showKnowledgeModal && (
        <div className="modal-backdrop">
          <div className="form-modal">
            <div className="modal-head">
              <strong>{editingKnowledge ? '编辑品牌资料' : '添加品牌资料'}</strong>
              <button onClick={() => setShowKnowledgeModal(false)}>关闭</button>
            </div>
            <div className="create-grid single">
              <EditableField label="知识库名称" value={knowledgeDraft.name} onChange={(value) => updateKnowledgeDraft('name', value)} />
            </div>
            <label className="textarea-field">
              <span>品牌资产</span>
              <textarea value={knowledgeDraft.brandAssets} onChange={(event) => updateKnowledgeDraft('brandAssets', event.target.value)} />
            </label>
            <label className="textarea-field">
              <span>权威引证</span>
              <textarea value={knowledgeDraft.authorityEvidence} onChange={(event) => updateKnowledgeDraft('authorityEvidence', event.target.value)} />
            </label>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowKnowledgeModal(false)}>取消</button>
              <button className="primary-button" onClick={createKnowledge}>保存资料</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function GalleryImage({src,alt}:{src:string;alt:string}) {
  const [url,setUrl]=useState('')
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    let cancelled=false,objectUrl=''
    setUrl('');setFailed(false)
    if(src.startsWith('/api/gallery/')) {
      void fetchProjectFile(src).then(blob=>{
        if(cancelled)return
        objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)
      }).catch(()=>{if(!cancelled)setFailed(true)})
    } else setUrl(src)
    return()=>{cancelled=true;if(objectUrl)URL.revokeObjectURL(objectUrl)}
  },[src])
  if(failed)return <span className="gallery-image-placeholder" role="img" aria-label={`${alt}，图片加载失败`}><ImageIcon size={22}/><small>暂不可用</small></span>
  return url?<img src={url} alt={alt} loading="lazy" onError={()=>setFailed(true)}/>:<span className="gallery-image-placeholder" aria-label="图片加载中"><ImageIcon size={22}/></span>
}

function Gallery({
  notify,
  projectRows,
  activeBrand,
  setActiveBrand,
}: Pick<ActionProps, 'notify'> & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps) {
  const [galleryRows, setGalleryRows] = useStoredState<string[][]>('geo.galleryRows', [])
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [gallerySource,setGallerySource]=useState<'imported'|'ai'|null>(null)
  const [galleryPage,setGalleryPage]=useState(1)
  useEffect(()=>{setGallerySource(null);setGalleryPage(1);setShowGalleryModal(false);setPreviewImage('');setFiles([])},[activeBrand])
  const [previewImage,setPreviewImage]=useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const visibleRows = galleryRows.filter((row) => row[0] === activeBrand && (row[7]==='ai'?'ai':'imported')===gallerySource)
  const projectImages = galleryRows.filter(row=>row[0]===activeBrand)
  const pageCount = Math.max(1, Math.ceil(visibleRows.length/20))
  const currentPage = Math.min(galleryPage,pageCount)
  const galleryUploadMessage = (error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return '图片上传超时，请先减少单次张数或压缩后重试。'
    if (error instanceof TypeError && /fetch|network|failed/i.test(error.message)) return '图片上传连接中断，请检查网络后重试。'
    return error instanceof Error ? error.message : '图片上传失败。'
  }
  const uploadImages = async () => {
    if (!activeBrand) {
      notify('请先在企业品牌库添加品牌。')
      return
    }
    if (!files.length) {
      notify('请选择要上传的图片。')
      return
    }
    setUploading(true)
    setUploadProgress('')
    try {
      const uploaded: { name: string; path: string; localPath?: string }[] = []
      let compressedCount = 0
      for (const [index, file] of files.entries()) {
        setUploadProgress(`正在处理第${index + 1}/${files.length}张：${file.name}`)
        const prepared = await compressGalleryImage(file)
        if (prepared.compressed) compressedCount += 1
        setUploadProgress(`正在上传第${index + 1}/${files.length}张：${prepared.name}`)
        const result = await apiJson<{ ok: boolean; files: { name: string; path: string; localPath?: string }[] }>('/api/gallery/upload', {
          brand: activeBrand,
          category: '自有图片',
          files: [{ name: prepared.name, dataUrl: prepared.dataUrl }],
        }, 60000)
        uploaded.push(...result.files)
      }
      const now = localDate()
      setGalleryRows((current) => [
        ...uploaded.map((file) => [activeBrand, '自有图片', '正文配图', '', now, file.path, file.name,'imported']),
        ...current,
      ])
      setShowGalleryModal(false)
      setFiles([])
      setGallerySource('imported');setGalleryPage(1)
      notify(`已添加${uploaded.length}张图片到品牌图库${compressedCount ? `，其中${compressedCount}张已自动压缩` : ''}。`)
    } catch (error) {
      notify(galleryUploadMessage(error))
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }
  const deleteImage = (row: string[]) => {
    setGalleryRows((current) => current.filter((item) => item !== row))
    notify('图片素材已从列表移除。')
  }
  return (
    <section className="operation-page gallery-workspace">
      <div className="operation-toolbar">
        <div>
          <strong>品牌图库</strong>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => setActiveBrand(event.target.value)}>
            {projectRows.map((project) => (
              <option key={project.name}>{project.name}</option>
            ))}
          </select>
          {gallerySource===null&&<button className="primary-button" disabled={!activeBrand} onClick={()=>{setFiles([]);setShowGalleryModal(true)}}><UploadCloud size={16}/>添加图库</button>}
        </div>
      </div>

      <div className="gallery-browser">
        {gallerySource===null ? <div className="gallery-folders" aria-label="图库分类">
          <div className="gallery-folder-head"><span>图库名称</span><span>图片数量</span></div>
          {(['imported','ai'] as const).map(source=>{
            const Icon=source==='ai'?Sparkles:UploadCloud
            const count=projectImages.filter(row=>(row[7]==='ai'?'ai':'imported')===source).length
            return <button key={source} aria-label={`${source==='ai'?'AI图库':'品牌图库'} ${count}张`} className={`gallery-folder gallery-folder-${source}`} onClick={()=>{setGallerySource(source);setGalleryPage(1)}}>
              <span className="gallery-folder-icon"><Icon size={22}/></span><strong>{source==='ai'?'AI图库':'品牌图库'}</strong><span className="gallery-folder-count">{count}<small>张图片</small></span><ChevronRight size={18}/>
            </button>
          })}
        </div> : <>
          <div className="gallery-list-toolbar">
            <button className="gallery-icon" title="返回图库" aria-label="返回图库" onClick={()=>setGallerySource(null)}><ArrowLeft size={18}/></button>
            <h2>{gallerySource==='ai'?'AI图库':'品牌图库'}</h2><span>{visibleRows.length}张</span>
            {gallerySource==='imported'&&<button className="primary-button" onClick={()=>setShowGalleryModal(true)}><UploadCloud size={16}/>上传图片</button>}
          </div>
          <div className="gallery-list" aria-label="图片列表">
            {visibleRows.slice((currentPage-1)*20,currentPage*20).map((row,index)=><div className="gallery-image-row" key={`${row[5]}-${index}`}>
              <button className="gallery-thumbnail" title="预览图片" onClick={()=>setPreviewImage(row[5])}><GalleryImage src={row[5]} alt={row[6]||row[1]}/></button>
              <div className="gallery-image-info"><strong title={row[6]||row[1]}>{row[6]||row[1]}</strong><span>{gallerySource==='ai'?'AI生成':'品牌上传'}</span></div>
              <time>{row[4]?.slice(0,10)}</time>
              <div className="gallery-image-actions">
                <button className="gallery-icon" title="预览" aria-label="预览" onClick={()=>setPreviewImage(row[5])}><Eye size={17}/></button>
                <button className="gallery-icon danger-button" title="删除" aria-label="删除" onClick={()=>deleteImage(row)}><Trash2 size={17}/></button>
              </div>
            </div>)}
            {!visibleRows.length&&<p className="gallery-empty">{gallerySource==='ai'?'暂无AI生成图片':'暂无自有图片'}</p>}
          </div>
          {pageCount>1&&<div className="gallery-pagination"><button disabled={currentPage===1} onClick={()=>setGalleryPage(currentPage-1)}>上一页</button><span>第{currentPage}页 / 共{pageCount}页</span><button disabled={currentPage===pageCount} onClick={()=>setGalleryPage(currentPage+1)}>下一页</button></div>}
        </>}
      </div>

      {previewImage&&<div className="modal-backdrop"><div className="form-modal gallery-preview"><div className="modal-head"><strong>图片预览</strong><button onClick={()=>setPreviewImage('')}>关闭</button></div><GalleryImage src={previewImage} alt={gallerySource==='ai'?'AI生成场景示意图':'品牌图片'}/></div></div>}
      {showGalleryModal && (
        <div className="modal-backdrop">
          <div className="form-modal">
            <div className="modal-head">
              <strong>添加到品牌图库</strong>
              <button onClick={() => setShowGalleryModal(false)}>关闭</button>
            </div>
            <div className="create-grid single">
              <label className="file-field">
                <span>选择图片</span>
                <input type="file" accept="image/*" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? []))} />
              </label>
              {files.length ? <p className="table-note">已选择{files.length}张。大图会自动压缩后逐张上传，上传期间请不要关闭窗口。</p> : null}
              {uploadProgress ? <p role="status" className="table-note">{uploadProgress}</p> : null}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowGalleryModal(false)}>取消</button>
              <button className="primary-button" disabled={uploading} onClick={uploadImages}>{uploading ? '上传中' : '保存图片'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Tasks({
  articleReady = true,
  historyView = false,
  notify,
  navigate,
  projectRows,
  activeBrand,
  setActiveBrand,
  setArticleRows,
  activeBatchId,
  setActiveBatchId,
}: ActionProps & Pick<ProjectStateProps, 'projectRows'> & ActiveBrandProps & ArticleStateProps & ActiveBatchProps & {historyView?: boolean;articleReady?:boolean}) {
  const [selectedTaskName,setSelectedTaskName]=useState('')
  const [previewArticle,setPreviewArticle]=useState<Article|null>(null)
  const [selectedResults,setSelectedResults]=useState<string[]>([])
  const [downloadingResults,setDownloadingResults]=useState(false)
  const [readingTask,setReadingTask]=useState('')
  const readingTaskRef=useRef('')
  const [showResultsRequested,setShowResultsRequested]=useState(false)
  const resultsRef=useRef<HTMLDivElement>(null)
  const [rows, setRows, taskLoad] = useStoredState('geo.taskRows', taskRows)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [activeJob, setActiveJob] = useState<ArticleJobStatus | null>(null)
  useEffect(()=>setSelectedResults([]),[activeJob?.id,activeBrand])
  useEffect(()=>{if(showResultsRequested&&activeJob){resultsRef.current?.scrollIntoView({behavior:'smooth',block:'start'});setShowResultsRequested(false)}},[showResultsRequested,activeJob])
  const downloadTaskResults=async(targets:Article[],job=activeJob)=>{
    if(downloadingResults||!job)return
    const allowed=targets.filter(a=>a.status==='已生成'&&a.project===activeBrand&&job.articles.some(row=>row.id===a.id))
    if(!allowed.length){notify('当前没有可下载的文章。');return}
    setDownloadingResults(true)
    try{
      const result=await apiJson<{downloadUrl:string;filePath:string;count:number}>('/api/articles/export',{brand:activeBrand,filePrefix:`${activeBrand}_任务结果`,format:'doc',articles:allowed.map(a=>({id:a.id}))})
      const url=URL.createObjectURL(await fetchProjectFile(result.downloadUrl)),link=document.createElement('a')
      link.href=url;link.download=result.filePath.split(/[\\/]/).pop()||'任务结果.doc';document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
      notify(`已下载${result.count}篇文章。`)
    }catch(error){notify(error instanceof Error?error.message:'下载失败，请重试。')}finally{setDownloadingResults(false)}
  }
  const downloadHistoryTask=async(task:TaskRow)=>{
    if(!task.jobId||downloadingResults||readingTaskRef.current)return
    readingTaskRef.current=task.jobId;setReadingTask(task.jobId)
    try{
      const {job}=await apiJson<{job:ArticleJobStatus}>(`/api/jobs/status?id=${encodeURIComponent(task.jobId)}`,undefined,90000)
      if(job.project!==task.project)throw new Error('任务项目不匹配')
      readingTaskRef.current='';setReadingTask('')
      await downloadTaskResults(job.articles,job)
    }catch(error){notify(error instanceof Error?error.message:'任务文章读取失败，请重试。')}
    finally{if(readingTaskRef.current===task.jobId){readingTaskRef.current='';setReadingTask('')}}
  }
  const [keywordRows] = useStoredState<string[][]>('geo.keywordRows', [])
  const [keywordLibraryRows] = useStoredState<string[][]>('geo.keywordLibraryRows', [])
  const [questionRows] = useStoredState<string[][]>('geo.questionRows', [])
  const [knowledgeRows] = useStoredState<string[][]>('geo.knowledgeRows', [])
  const [knowledgeContentRows] = useStoredState<string[][]>('geo.knowledgeContentRows', [])
  const [candidateRows] = useStoredState<string[][]>('geo.rankingCandidateRows', [])
  const [draft, setDraft] = useState({
    name: '',
    project: '',
    coreKeyword: '',
    limit: '10篇',
    knowledge: '',
    articleType: '',
    writingSceneMode: 'AI场景',
    sceneCity: '',
    sceneIndustry: '',
    writingDepth: 'deep',
    businessScenes: [] as string[],
    imageSource: 'ai' as 'ai'|'imported',
  })
  const updateDraft = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value, ...(key==='coreKeyword'?{businessScenes:[]}: {}) }))
  }
  const toggleArticleType = (type: string) => {
    setDraft((current) => {
      const selected = current.articleType ? parseArticleTypes(current.articleType) : []
      const next = selected.includes(type)
        ? selected.filter((item) => item !== type)
        : [...selected, type]
      return { ...current, articleType: next.join('、') }
    })
  }
  const activeProject = projectRows.find((project) => project.name === activeBrand) ?? projectRows[0] ?? createEmptyProject(activeBrand)
  const activeWritingSceneMode = writingSceneModes.includes(draft.writingSceneMode) ? draft.writingSceneMode : 'AI场景'
  const mainBrandName = activeProject.recommendWord || activeProject.brand || activeProject.name
  const projectCandidateRows = candidateRows.filter(row => row[0] === activeBrand && row[1] !== mainBrandName && row[6] !== '是')
  const updateWritingSceneMode = (mode: string) => setDraft(current => ({ ...current, writingSceneMode: mode }))
  useEffect(() => { setDraft(current => ({ ...current, writingSceneMode: 'AI场景', sceneCity: '', sceneIndustry: '', businessScenes: [] })) }, [activeBrand])
  const projectCoreRows = keywordRows.filter((row) => row[0] === activeBrand)
  const coreOptions = projectCoreRows.length ? projectCoreRows.map((row) => row[1]) : activeProject.coreKeyword ? [activeProject.coreKeyword] : []
  const selectedCoreKeyword = coreOptions.includes(draft.coreKeyword) ? draft.coreKeyword : coreOptions[0] ?? ''
  const projectQuestions = questionRows.filter((row) => questionBelongsToBrand(row, activeBrand, selectedCoreKeyword)).map(readQuestionText)
  const questionOptions = projectQuestions
  const questionPoolLabel = selectedCoreKeyword ? `${selectedCoreKeyword}蒸馏词（${questionOptions.length}个）` : '待生成蒸馏词'
  const projectKeywordLibrary = keywordLibraryRows
    .filter((row) => row[0] === activeBrand && row[1] === selectedCoreKeyword)
    .map((row) => {
      const normalizedWord = normalizeKeywordLibraryWords([row[2]])[0] ?? row[2]
      return [row[0], row[1], normalizedWord, classifyKeyword(normalizedWord), row[4]]
    })
    .filter((row) => row[2] !== selectedCoreKeyword)
  const keywordPackOptions = [`${selectedCoreKeyword}关键词库（${projectKeywordLibrary.length}个）`]
  const keywordPackLabel = `${selectedCoreKeyword}关键词库（${projectKeywordLibrary.length}个）`
  const projectKnowledgeRows = knowledgeRows.filter((row) => row[0] === activeBrand)
  const knowledgeOptions = projectKnowledgeRows.length ? projectKnowledgeRows.map((row) => row[1]) : []
  const missingTaskItems = [
    !activeBrand || !activeProject.name ? '企业品牌' : '',
    !selectedCoreKeyword ? '核心词' : '',
  ].filter(Boolean)
  const currentTaskRows = rows.filter((row) => row.project === activeBrand)
  const selectedTask = currentTaskRows.find(row=>row.name===selectedTaskName) || currentTaskRows[0]
  const displayedTasks = historyView ? currentTaskRows : selectedTask ? [selectedTask] : []
  const taskRun = useRef(0)
  const autoOpened = useRef('')
  useEffect(() => { taskRun.current++; autoOpened.current=''; setSelectedTaskName('');setPreviewArticle(null);setActiveJob(null); setIsGenerating(false); return () => { taskRun.current++ } }, [activeBrand])
  useEffect(()=>{
    if(historyView || taskLoad.loading || taskLoad.error || !selectedTask?.jobId || autoOpened.current===`${activeBrand}:${selectedTask.jobId}`)return
    autoOpened.current=`${activeBrand}:${selectedTask.jobId}`
    void openTaskDetails(selectedTask)
  },[historyView,activeBrand,selectedTask?.jobId,taskLoad.loading,taskLoad.error,articleReady])
  const prepareTaskDraft = () => {
    if (!activeBrand || !coreOptions.length) { notify('请先添加品牌和核心词。'); return }
    setDraft(current => ({ ...current, name: `${selectedCoreKeyword}文章任务-${localDateTime()}`, project: activeBrand, coreKeyword: selectedCoreKeyword, knowledge: '', articleType: '' }))
    setShowTaskModal(true)
  }
  const createTask = () => {
    if (!activeBrand || !selectedCoreKeyword || !draft.name.trim()) { notify('请填写任务名并选择核心词。'); return }
    if (draft.knowledge && !knowledgeOptions.includes(draft.knowledge)) { notify('所选知识库已变化，请重新选择。'); return }
    if(activeWritingSceneMode==='手动场景'&&(!draft.sceneCity.trim()||!draft.sceneIndustry.trim())){notify('请填写场景城市和行业。');return}
    if(activeWritingSceneMode==='手动场景'&&(draft.sceneCity.trim().length>40||draft.sceneIndustry.trim().length>60)){notify('城市最多40字，行业最多60字。');return}
    const task: TaskRow = { project: activeBrand, name: draft.name.trim(), coreKeyword: selectedCoreKeyword,
      question: selectedCoreKeyword, limit: draft.limit.replace('篇', ''), created: '0', knowledge: draft.knowledge,
      detail: `${activeWritingSceneMode} / ${draft.articleType || '根据选题自动匹配'} / ${draft.knowledge || '全部知识库'}`,
      error: '-', status: '待生成', latest: '待生成', time: localDateTime(), batchId: '',
      articleType: draft.articleType, writingSceneMode: activeWritingSceneMode, writingDepth: draft.writingDepth,
      sceneCity: activeWritingSceneMode==='手动场景'?draft.sceneCity.trim():'',
      sceneIndustry: activeWritingSceneMode==='手动场景'?draft.sceneIndustry.trim():'',
      businessScenes: [],imageSource:draft.imageSource }
    setRows(current => [task, ...current.filter(row => !(row.project === activeBrand && row.name === task.name))])
    taskRun.current++;setActiveJob(null);setIsGenerating(false);setSelectedTaskName(task.name);navigate('tasks')
    setShowTaskModal(false)
    notify('任务已保存，开始后由工作流理解项目并安排选题。')
  }
  const syncJob = (job: ArticleJobStatus, task: TaskRow) => {
    setActiveJob(job)
    if (articleReady && job.articles.length) setArticleRows(current => [...job.articles, ...current.filter(article => !job.articles.some(next => next.id === article.id))])
    setRows(current => current.map(row => row.project === task.project && row.name === task.name ? {
      ...row, jobId: job.id, created: String(job.completed), latest: job.articles[0]?.id || '后台任务',
      status: job.status === 'done' ? '已生成' : job.status === 'failed' ? '待生成' : '生成中',
      detail: job.logs.at(-1)?.message || '工作流处理中', error: job.error || '-',
    } : row))
  }
  const watchJob = async (first: ArticleJobStatus, task: TaskRow) => {
    const token = ++taskRun.current
    setIsGenerating(true)
    let job = first
    try {
      for (let poll = 0; poll < 720; poll++) {
        if (token !== taskRun.current) return
        syncJob(job, task)
        if (job.status === 'done' || job.status === 'failed') return
        await new Promise(resolve => window.setTimeout(resolve, 3000))
        const result = await apiJson<{ job: ArticleJobStatus }>(`/api/jobs/status?id=${encodeURIComponent(job.id)}`, undefined, 90000)
        job = result.job
      }
      notify('任务仍在后台执行，可在任务详情继续查看。')
    } catch (error) { if (token === taskRun.current) notify(error instanceof Error ? error.message : '暂时无法读取进度，后台任务未停止。') }
    finally { if (token === taskRun.current) setIsGenerating(false) }
  }
  const openTaskDetails = async (task: TaskRow,showResults=false) => {
    if (!task.jobId) { notify('这条任务尚无生产记录，开始后可查看。'); return }
    if(readingTaskRef.current===task.jobId)return
    readingTaskRef.current=task.jobId;setReadingTask(task.jobId)
    setSelectedTaskName(task.name);setActiveJob(null)
    autoOpened.current=`${activeBrand}:${task.jobId}`
    const token = ++taskRun.current
    try {
      const result = await apiJson<{ job: ArticleJobStatus }>(`/api/jobs/status?id=${encodeURIComponent(task.jobId)}`, undefined, 90000)
      if (token !== taskRun.current) return
      if (result.job.project && result.job.project !== task.project) throw new Error('任务项目不匹配')
      if(showResults)setShowResultsRequested(true)
      readingTaskRef.current='';setReadingTask('')
      await watchJob(result.job, task)
    } catch (error) { if(token===taskRun.current){autoOpened.current='';notify(error instanceof Error ? error.message : '无法读取任务')} }
    finally{if(readingTaskRef.current===task.jobId){readingTaskRef.current='';setReadingTask('')}}
  }
  const resumeJob = async () => {
    if (!activeJob || activeJob.status !== 'failed') return
    const task = currentTaskRows.find(row => row.jobId === activeJob.id)
    if (!task) { notify('未找到当前任务记录。'); return }
    const token = ++taskRun.current
    setIsGenerating(true)
    try {
      const result = await apiJson<{ job: ArticleJobStatus }>('/api/jobs/resume', { id: activeJob.id }, 15000)
      if (token !== taskRun.current) return
      await watchJob(result.job, task)
    } catch (error) { notify(error instanceof Error ? error.message : '续跑失败'); setIsGenerating(false) }
  }
  const stopJob = async () => {
    if(!activeJob)return
    try {
      await apiJson('/api/jobs/stop',{id:activeJob.id},15000)
      notify('已请求停止，当前篇结束后停止后续生成。')
    } catch(error) {notify(error instanceof Error?error.message:'停止失败')}
  }
  const startSystemJob = async (taskOverride?: TaskRow) => {
    if(taskLoad.loading||taskLoad.error){notify(taskLoad.error?'任务列表加载失败，请刷新后重试。':'任务列表正在加载，请稍后再试。');return}
    if (isGenerating) return
    const originalTask = taskOverride || selectedTask
    if (!originalTask) { prepareTaskDraft(); return }
    if(originalTask.jobId&&!window.confirm('重新生成将创建新批次，重新分配选题角度。原任务和文章保留，新批次正常消耗文章额度及配图费用。是否继续？'))return
    const task = originalTask.jobId ? {...originalTask,name:`${originalTask.coreKeyword||'文章'}新批次-${localDateTime()}-${crypto.randomUUID().slice(0,4)}`,jobId:undefined,batchId:'',created:'0',status:'待生成',error:'-',latest:'待生成'} : originalTask
    const project = projectRows.find(row => row.name === task.project)
    if (!project) { notify('项目已不存在。'); return }
    const core = task.coreKeyword || project.coreKeyword || selectedCoreKeyword
    if (!core) { notify('请先选择核心词。'); return }
    const batchLabel = localDateTime()
    const batchId = runBatchId(task.project, task.name)
    const count = Math.min(Math.max(Number.parseInt(task.limit, 10) || 1, 1), 100)
    const token = ++taskRun.current
    setIsGenerating(true)
    try {
      const result = await apiJson<{ job: ArticleJobStatus }>('/api/jobs/start', {
        project, packet: { coreKeyword: core, knowledgeName: task.knowledge || '' },
        task: { name: task.name, knowledge: task.knowledge || '', articleType: task.articleType || '', writingSceneMode: writingSceneModes.includes(task.writingSceneMode || '') ? task.writingSceneMode : 'AI场景', sceneCity:task.sceneCity,sceneIndustry:task.sceneIndustry, writingDepth: task.writingDepth || 'deep',businessScenes:task.businessScenes,imageSource:task.imageSource },
        count, taskName: task.name, batchId, batchLabel,
        restartOf: originalTask.jobId || undefined,
      }, 15000)
      if (token !== taskRun.current) return
      setActiveBatchId(batchId)
      setSelectedTaskName(task.name);autoOpened.current=`${activeBrand}:${result.job.id}`;navigate('tasks')
      setRows(current => [{ ...task, jobId: result.job.id, batchId, time: batchLabel }, ...current.filter(row=>!(row.project===task.project&&row.name===task.name))])
      await watchJob(result.job, task)
    } catch (error) { notify(error instanceof Error ? error.message : '启动失败'); setIsGenerating(false) }
  }
  const deleteTask = async (name: string) => {
    if(!window.confirm(`确定删除任务“${name}”？已生成文章和账目保留。运行中的任务需先停止。`))return
    try {
      await apiJson('/api/jobs/delete',{name,brand:activeBrand},15000)
      setRows((current) => current.filter((row) => row.project !== activeBrand || row.name !== name))
      if(selectedTask?.name===name){taskRun.current++;setActiveJob(null);setSelectedTaskName('');setIsGenerating(false)}
      notify(`${name}已删除，成品文章保留。`)
    }catch(error){notify(error instanceof Error?error.message:'删除失败，任务未移除。')}
  }
  return (
    <section className="operation-page task-workspace">
      <div className="operation-toolbar">
        <div>
          <strong>{historyView?'任务列表':'文章生成'}</strong>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={activeBrand} onChange={(event) => {
            setActiveBrand(event.target.value)
            updateDraft('project', event.target.value)
          }}>
            {projectRows.map((project) => (
              <option key={project.name}>{project.name}</option>
            ))}
          </select>
          <button className="primary-button" onClick={prepareTaskDraft}>创建生成任务</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={ListChecks} title={historyView?'历史任务':'当前任务'} desc="" />
        <div className={missingTaskItems.length ? 'workflow-warning' : 'workflow-ready'}>
          {missingTaskItems.length
            ? `当前品牌还缺：${missingTaskItems.join('、')}。补齐后才能创建和启动生成任务。`
            : `当前品牌资料已就绪：${questionPoolLabel}，${keywordPackLabel}，${projectKnowledgeRows.length}个知识库，可启动单篇队列生成。`}
        </div>
        <div className="ops-scroll">
          <div className="ops-table task-table mature-task-table">
            <div className="ops-head">
              <span>任务名</span><span>文章类型</span><span>生成篇数</span><span>已生成</span><span>稿单资料</span><span>状态</span><span>创建时间</span><span>操作</span>
            </div>
            <PagedRows>{displayedTasks.map((row) => (
              <div className="ops-row" key={row.name}>
                <strong>{row.name}</strong>
                <span title={row.articleType || '根据选题匹配'}>{row.writingDepth === 'concise' ? '精选好文' : '深度好文'}</span>
                <span>{row.limit}</span>
                <span>{row.created}</span>
                <span>{row.knowledge || '全部知识库'}</span>
                <span className="pill">{displayTaskStatus(row.status)}</span>
                <span>{row.time}</span>
                <span className="row-actions task-action-grid">
                  <button disabled={!row.jobId||readingTask===row.jobId} onClick={()=>void openTaskDetails(row,true)}>{readingTask===row.jobId?'读取中…':'查看结果'}</button>
                  <button disabled={!row.jobId||downloadingResults||readingTask===row.jobId} onClick={() => historyView?void downloadHistoryTask(row):void openTaskDetails(row)}>{historyView?(downloadingResults?'下载中…':'文章下载'):'刷新进度'}</button>
                  <button disabled={isGenerating||displayTaskStatus(row.status)==='生成中'} onClick={() => startSystemJob(row)}>{row.jobId?'新生成一批':'开始生成'}</button>
                  <button disabled={row.status === '生成中'} className="danger-button" onClick={() => deleteTask(row.name)}>删除</button>
                </span>
              </div>
            ))}</PagedRows>
          </div>
        </div>
        {!currentTaskRows.length && (
          <div className="empty-state">
            <strong>当前品牌还没有生成任务</strong>
            <span>先确认核心词、关键词库和品牌知识库，再创建一条编辑稿单开始生成。</span>
            <button className="primary-button" onClick={prepareTaskDraft}>创建生成任务</button>
          </div>
        )}
      </div>

      {!historyView && activeJob && (
        <div className="panel">
          <SectionTitle icon={Gauge} title="生成进度" desc="系统按单篇队列生成，完成后进入成品文章库。" />
          <div className="job-status-strip">
            <span>状态：{{queued:'排队中',running:'生成中',done:'已完成',failed:'待续跑'}[activeJob.status]}</span>
            <span>进度：{activeJob.completed}/{activeJob.total}</span>
            <span>已生成：{activeJob.passed}</span>
            <span>中断：{activeJob.failed}</span>
            {['queued','running'].includes(activeJob.status) && <button title="当前篇结束后停止" aria-label="停止任务" onClick={()=>void stopJob()}><Square size={16}/></button>}
          </div>
          <progress className="task-progress-bar" aria-label="文章生成进度" value={activeJob.completed} max={activeJob.total||1}/>
          <TaskWorkflowDetails job={activeJob} onResume={resumeJob} busy={isGenerating} />
        </div>
      )}

      {readingTask&&<p role="status">正在读取任务文章，请稍候…</p>}
      {(!historyView||activeJob)&&<div className="panel current-task-articles" ref={resultsRef}>
        <div className="task-results-toolbar"><SectionTitle icon={FileText} title="本次生成文章" desc="" /><span role="status">共{activeJob?.articles.length||0}篇 · 已选{selectedResults.length}篇</span><button className="primary-button" disabled={downloadingResults||!activeJob?.articles.length} onClick={()=>void downloadTaskResults(activeJob?.articles.filter(a=>!selectedResults.length||selectedResults.includes(a.id))||[])}><Download size={16}/>{downloadingResults?'下载中':selectedResults.length?'下载选中文章':'下载本批文章'}</button></div>
        {!!activeJob?.articles.length&&<label className="task-select-all"><input type="checkbox" checked={activeJob.articles.every(a=>selectedResults.includes(a.id))} onChange={e=>setSelectedResults(e.target.checked?activeJob.articles.map(a=>a.id):[])}/>全选本批文章</label>}
        {activeJob?.articles.length ? <PagedRows resetKey={activeJob.id}>{activeJob.articles.map(article=><div className="current-task-article" key={article.id}><input type="checkbox" aria-label={`选择${article.title}`} checked={selectedResults.includes(article.id)} onChange={e=>setSelectedResults(ids=>e.target.checked?[...ids,article.id]:ids.filter(id=>id!==article.id))}/><strong>{article.title}</strong><span>{article.words}字</span><div className="task-result-actions"><button className="ghost-button" onClick={()=>setPreviewArticle(article)}>查看文章</button><button className="gallery-icon" title="下载文章" aria-label={`下载${article.title}`} disabled={downloadingResults} onClick={()=>void downloadTaskResults([article])}><Download size={17}/></button></div></div>)}</PagedRows> : <p>暂无生成文章</p>}
      </div>}
      {previewArticle&&<div className="modal-backdrop"><div className="form-modal wide-modal article-reader-modal"><div className="modal-head"><strong>全文查看</strong><button onClick={()=>setPreviewArticle(null)}>关闭</button></div><div className="article-reader"><article className="article-page-view"><h1>{previewArticle.title}</h1><div className="article-content-view">{previewArticle.body?renderArticleBody(previewArticle.body):<p>当前文章暂无完整正文。</p>}</div></article></div><div className="modal-actions"><button className="primary-button" onClick={()=>setPreviewArticle(null)}>完成</button></div></div></div>}

      {showTaskModal && (
        <div className="modal-backdrop">
          <div className="form-modal wide-modal">
            <div className="modal-head">
              <strong>创建生成任务</strong>
              <button onClick={() => setShowTaskModal(false)}>关闭</button>
            </div>
            <div className="create-grid">
              <Field label="任务名称" value={draft.name} />
              <SelectField label="归属品牌" value={draft.project} options={projectRows.map((project) => project.name)} onChange={(value) => {
                setActiveBrand(value)
                updateDraft('project', value)
              }} />
              <SelectField label="核心词" value={selectedCoreKeyword} options={coreOptions} onChange={(value) => {
                updateDraft('coreKeyword', value)
              }} />
              <Field label="蒸馏词总数" value={questionPoolLabel} />
              <Field label="关键词库总数" value={keywordPackOptions[0] || keywordPackLabel} />
              <SelectField label="品牌知识库" value={draft.knowledge || '全部知识库'} options={['全部知识库', ...knowledgeOptions]} onChange={(value) => updateDraft('knowledge', value === '全部知识库' ? '' : value)} />
              <SelectField label="生成篇数" value={draft.limit} options={['1篇', '2篇', '5篇', '10篇', '20篇', '50篇', '100篇']} onChange={(value) => updateDraft('limit', value)} />
            </div>
            <div className="type-selector">
              <div>
                <strong>写作场景</strong>
              </div>
              <div className="type-chip-grid">
                {writingSceneModes.map((mode) => (
                  <button
                    type="button"
                    className={activeWritingSceneMode === mode ? 'type-chip active' : 'type-chip'}
                    key={mode}
                    aria-pressed={activeWritingSceneMode === mode}
                    onClick={() => updateWritingSceneMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {activeWritingSceneMode==='手动场景'&&<div className="form-grid">
                <Field label="场景城市" value={draft.sceneCity} onChange={value=>updateDraft('sceneCity',value)} />
                <Field label="场景行业" value={draft.sceneIndustry} onChange={value=>updateDraft('sceneIndustry',value)} />
              </div>}
            </div>
            <div className="type-selector">
              <div>
                <strong>图片来源 · 每篇两张</strong>
              </div>
              <div className="type-chip-grid" role="group" aria-label="文章图片来源">
                {(['ai','imported'] as const).map(source=><button type="button" key={source} className={draft.imageSource===source?'type-chip active':'type-chip'} aria-pressed={draft.imageSource===source} onClick={()=>setDraft(d=>({...d,imageSource:source}))}>{source==='ai'?'AI配图 · 2元/篇（2张，成功扣费）':'自有图库 · 不收生图费'}</button>)}
              </div>
            </div>
            <div className="type-selector">
              <div>
                <strong>文章深度</strong>
              </div>
              <div className="type-chip-grid" role="group" aria-label="文章深度">
                {[['deep', '深度好文 · 1万字以下'], ['concise', '精选好文 · 2000字以内']].map(([value, label]) => (
                  <button type="button" key={value} aria-pressed={draft.writingDepth === value}
                    className={draft.writingDepth === value ? 'type-chip active' : 'type-chip'}
                    onClick={() => updateDraft('writingDepth', value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="type-selector">
              <div>
                <strong>文章类型</strong>
                <span>可多选；不选时根据选题匹配。具体写法由对应Skill决定。</span>
              </div>
              <div className="type-chip-grid">
                {articleTypeOptions.map((type) => (
                  <button
                    type="button"
                    className={draft.articleType && parseArticleTypes(draft.articleType).includes(type) ? 'type-chip active' : 'type-chip'}
                    key={type}
                    onClick={() => toggleArticleType(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="task-material-preview">
              <strong>本次调用内容</strong>
              <span>写作场景：{activeWritingSceneMode}</span>
              <span>核心词：{selectedCoreKeyword}</span>
              <span>同行资料：{projectCandidateRows.length}家，按稿单需要使用</span>
              <span>蒸馏词：{questionOptions.length} 个</span>
              <span>关键词库：{projectKeywordLibrary.length} 个</span>
              <span>知识库：{draft.knowledge || '全部知识库'}</span>
              <span>资料条目：{knowledgeContentRows.filter(row => row[0] === activeBrand && (!draft.knowledge || row[1] === draft.knowledge) && (row[3]?.trim() || row[4]?.trim())).length}条</span>
            </div>
            <div className={missingTaskItems.length ? 'workflow-warning' : 'workflow-ready'}>
              {missingTaskItems.length
                ? `当前还不能生成，缺少：${missingTaskItems.join('、')}。`
                : '项目资料已就绪，启动后生成项目理解、选题和单篇稿单。'}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowTaskModal(false)}>取消</button>
              <button className="primary-button" onClick={createTask}>确定</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Audit({ notify, navigate, articleRows, setArticleRows, activeBrand, activeBatchId }: ActionProps & ArticleStateProps & Pick<ActiveBrandProps, 'activeBrand'> & Pick<ActiveBatchProps, 'activeBatchId'>) {
  const [selectedArticle, setSelectedArticle] = useState('')
  const [statusFilter, setStatusFilter] = useState('全部文章')
  const visibleArticles = articleRows.filter((article) => {
    if (article.project !== activeBrand) return false
    if (activeBatchId && article.batchId !== activeBatchId) return false
    if (statusFilter === '已生成') return article.status === '已生成'
    if (statusFilter === '生成异常') return article.status === '生成异常'
    return true
  })
  const currentArticle = visibleArticles.find((article) => article.id === selectedArticle) ?? visibleArticles[0]
  const approveArticle = () => {
    if (!currentArticle) return
    setArticleRows((current) =>
      current.map((article) =>
        article.id === currentArticle.id ? { ...article, status: '已生成' } : article,
      ),
    )
    setSelectedArticle('')
    notify(`${currentArticle.title}已进入成品文章库。`)
    navigate('library')
  }
  const rejectArticle = () => {
    if (!currentArticle) return
    setArticleRows((current) =>
      current.map((article) =>
        article.id === currentArticle.id ? { ...article, status: '生成异常' } : article,
      ),
    )
    setSelectedArticle('')
    notify(`${currentArticle.title}已退回生产层，需重新生成。`)
  }
  const auditBatch = () => {
    setArticleRows((current) =>
      current.map((article) => {
        if (article.project !== activeBrand) return article
        if (activeBatchId && article.batchId !== activeBatchId) return article
        return article.apiIssues?.length ? { ...article, status: '生成异常' } : { ...article, status: '已生成' }
      }),
    )
    notify('当前批次已整理。')
  }
  const deleteArticle = (id: string) => {
    const target = visibleArticles.find((article) => article.id === id)
    if (!target) return
    setArticleRows((current) => current.filter((article) => article.id !== id || article.project !== activeBrand))
    notify(`${target?.title ?? '文章'}已删除。`)
  }
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>文章查看</strong>
          <span>{activeBatchId ? `只查看当前任务批次：${activeBatchId}` : '这里查看系统生成文章。'}</span>
        </div>
        <div className="toolbar-actions">
          <select className="search-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>全部文章</option>
            <option>已生成</option>
            <option>生成异常</option>
          </select>
          <button className="primary-button" onClick={auditBatch}>整理当前批次</button>
        </div>
      </div>

      <div className="panel">
        <SectionTitle icon={Newspaper} title="文章列表" desc="列表为主体，点击查看完整正文。" />
        <div className="ops-table audit-table">
          <div className="ops-head"><span>标题</span><span>文章方向</span><span>核心词</span><span>字数</span><span>来源</span><span>状态</span><span>操作</span></div>
          <PagedRows>{visibleArticles.map((article) => (
            <div className="ops-row" key={article.id}>
              <strong>{article.title}</strong>
              <span>{article.angle}</span>
              <span>{article.keyword}</span>
              <span>{article.words}字</span>
              <span>{displayGenerationSource(article.generationSource)}</span>
              <span className={article.status === '生成异常' ? 'pill danger-pill' : 'pill'}>{article.status}</span>
              <span className="row-actions">
                <button onClick={() => setSelectedArticle(article.id)}>查看</button>
                <button className="danger-button" onClick={() => deleteArticle(article.id)}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
      </div>

      {selectedArticle && currentArticle && (
        <div className="modal-backdrop">
          <div className="form-modal wide-modal">
            <div className="modal-head">
              <strong>文章详情</strong>
              <button onClick={() => setSelectedArticle('')}>关闭</button>
            </div>
            <SectionTitle icon={ShieldCheck} title={currentArticle.title} desc="仅查看系统生成内容。" />
          {Boolean(currentArticle.apiIssues?.length || currentArticle.duplicateNote) && (
            <div className="article-body-preview system-issues">
              <strong>接口提示</strong>
              {currentArticle.duplicateNote && <p>{currentArticle.duplicateNote}</p>}
              {currentArticle.apiIssues?.map((issue) => <p key={issue}>{issue}</p>)}
            </div>
          )}
          {currentArticle.body && (
            <div className="article-body-preview">
              <strong>生成正文</strong>
              {renderArticleBody(currentArticle.body)}
            </div>
          )}
          <div className="audit-actions">
            <button className="primary-button" onClick={() => setSelectedArticle('')}>完成</button>
          </div>
          </div>
        </div>
      )}
    </section>
  )
}

function LibraryPage({ notify, navigate, articleRows, setArticleRows, activeBrand, articleLoad }: ActionProps & ArticleStateProps & Pick<ActiveBrandProps, 'activeBrand'> & { articleLoad: { loading: boolean; error: string; retry: () => void } }) {
  const [previewId, setPreviewId] = useState('')
  const [selectedArticles, setSelectedArticles] = useState<string[]>([])
  const [isEditingArticle, setIsEditingArticle] = useState(false)
  const [editArticleTitle, setEditArticleTitle] = useState('')
  const [editArticleBody, setEditArticleBody] = useState('')
  const [galleryRows] = useStoredState<string[][]>('geo.galleryRows', [])
  const scopedArticles = articleRows.filter((article) => article.project === activeBrand)
  useEffect(() => { setPreviewId(''); setSelectedArticles([]); setIsEditingArticle(false) }, [activeBrand])
  const previewArticle = scopedArticles.find((article) => article.id === previewId)
  const passedArticles = scopedArticles.filter((article) => article.status === '已生成')
  const selectedPassedArticles = passedArticles.filter((article) => selectedArticles.includes(article.id))
  const imageCountForArticle = (article: Article) => [...(article.body || '').matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length
  const bodyEditorRef = useRef<HTMLTextAreaElement>(null)
  const editorImages = galleryRows.filter(row => row[0] === previewArticle?.project && row[5])
  const insertImage = (row: string[]) => {
    if (!previewArticle || row[0] !== previewArticle.project) return
    const editor = bodyEditorRef.current
    const start = editor?.selectionStart ?? editArticleBody.length
    const end = editor?.selectionEnd ?? start
    const alt = (row[6] || row[1] || '正文配图').replace(/[\[\]\r\n]/g, '')
    const inserted = `\n\n![${alt}](${row[5]})\n\n`
    setEditArticleBody(editArticleBody.slice(0, start) + inserted + editArticleBody.slice(end))
    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + inserted.length, start + inserted.length) })
  }
  const openArticleReader = (article: Article) => {
    setPreviewId(article.id)
    setEditArticleTitle(article.title)
    setEditArticleBody(article.body || '')
    setIsEditingArticle(false)
  }
  const savePreviewArticle = async () => {
    if (!previewArticle) return
    const nextBody = editArticleBody.trim()
    const updated = articleRows.map((article) => (
      article.id === previewArticle.id && article.project === activeBrand
        ? { ...article, title: editArticleTitle.trim() || article.title, body: nextBody, imagePaths: [...nextBody.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]), words: String(chineseCount(nextBody)) }
        : article
    ))
    try {
      const result = await apiJson<{ value: Article[] }>('/api/state', { key: 'geo.articleRows', value: updated }, 5000)
      setArticleRows(result.value)
    } catch (error) {
      notify(error instanceof Error ? error.message : '文章保存失败，请重试。')
      return
    }
    setIsEditingArticle(false)
    notify('文章已保存，下载会使用当前编辑后的版本。')
  }
  const toggleSelectedArticle = (id: string) => {
    setSelectedArticles((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }
  const toggleAllPassedArticles = () => {
    setSelectedArticles((current) => {
      const currentVisible = current.filter((id) => passedArticles.some((article) => article.id === id))
      return currentVisible.length === passedArticles.length ? [] : passedArticles.map((article) => article.id)
    })
  }
  const downloadArticles = async (targets: Article[], filePrefix = 'GEO成品文章') => {
    targets = targets.filter(article => scopedArticles.some(row => row.id === article.id && row.project === article.project))
    if (!targets.length) {
      notify('当前没有可下载的成品文章。')
      return
    }
    try {
      const result = await apiJson<{ ok: boolean; downloadUrl: string; filePath: string; count: number }>('/api/articles/export', {
        brand: activeBrand,
        filePrefix,
        format: 'doc',
        articles: targets,
      })
      const link = document.createElement('a')
      const fileUrl = URL.createObjectURL(await fetchProjectFile(result.downloadUrl))
      link.href = fileUrl
      link.download = result.filePath.split(/[\\/]/).pop() || ''
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000)
      notify(`已导出${result.count}篇文章。`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '下载失败，请重试。')
    }
  }
  const deleteLibraryArticle = (id: string) => {
    const target = scopedArticles.find((article) => article.id === id)
    if (!target) return
    setArticleRows((current) => current.filter((article) => article.id !== id || article.project !== activeBrand))
    setSelectedArticles((current) => current.filter((item) => item !== id))
    notify(`${target?.title ?? '文章'}已从成品文章库删除。`)
  }
  const downloadSelectedArticles = () => {
    const targets = selectedPassedArticles.length ? selectedPassedArticles : passedArticles
    downloadArticles(targets, `${activeBrand}_成品文章`)
  }
  return (
    <section className="operation-page">
      <div className="operation-toolbar library-toolbar">
        <div>
          <strong>成品文章库</strong>
          <span>{activeBrand} · 共{passedArticles.length}篇成品文章</span>
        </div>
        <div className="toolbar-actions">
          <div className="toolbar-group">
            <button className="ghost-button" disabled={!passedArticles.length} onClick={toggleAllPassedArticles}>
              {selectedPassedArticles.length === passedArticles.length && passedArticles.length > 0 ? '取消全选' : '全选'}
            </button>
          </div>
          <div className="toolbar-group primary-group">
            <button className="ghost-button" disabled={!passedArticles.length} onClick={downloadSelectedArticles}>{selectedPassedArticles.length ? `下载选中${selectedPassedArticles.length}篇` : '下载全部Word'}</button>
            <button
              className="primary-button"
              data-testid="select-distribution"
              onClick={() => {
                sessionStorage.setItem(`media-selection:${identityKey()}`, JSON.stringify(selectedPassedArticles.map(a => a.id)))
                navigate('distribution')
              }}
            >
              选择分发
            </button>
          </div>
        </div>
      </div>
      {articleLoad.loading && <p role="status">正在加载文章库，请稍候…</p>}
      {articleLoad.error && <div role="alert"><span>文章库加载失败，已有文章未删除。</span> <button className="ghost-button" onClick={articleLoad.retry}>重新加载</button></div>}
      <div className="panel">
        <SectionTitle icon={Newspaper} title="成品文章列表" desc="" />
        <div className="ops-table library-table">
          <div className="ops-head"><span>选择</span><span>文章标题</span><span>字数</span><span>配图</span><span>状态</span><span>操作</span></div>
          <PagedRows>{passedArticles.map((article) => (
            <div className="ops-row" key={article.id}>
              <label className="row-check">
                <input type="checkbox" checked={selectedArticles.includes(article.id)} onChange={() => toggleSelectedArticle(article.id)} />
              </label>
              <div className="table-main-cell">
                <strong>{article.title}</strong>
              </div>
              <span className="table-metric-line">{article.words}字{article.writingDepth ? ` · ${article.writingDepth === 'concise' ? '精选好文' : '深度好文'}` : ''}</span>
              <span>{imageCountForArticle(article) ? `${imageCountForArticle(article)}张可用` : '待上传'}</span>
              <span className="pill">{article.status}</span>
              <span className="row-actions">
                <button onClick={() => openArticleReader(article)}>全文查看</button>
                <button onClick={() => downloadArticles([article], article.title)}>下载</button>
                <button className="danger-button" onClick={() => deleteLibraryArticle(article.id)}>删除</button>
              </span>
            </div>
          ))}</PagedRows>
        </div>
        {!passedArticles.length && (
          <div className="empty-state">
            <strong>当前视图没有成品文章</strong>
            <span>生成完成的文章会自动显示在这里。</span>
            <button className="primary-button" onClick={() => navigate('tasks')}>回到写作任务</button>
          </div>
        )}
        <p className="table-note">共{passedArticles.length}篇成品文章，已选{selectedPassedArticles.length}篇。</p>
      </div>
      {previewArticle && (
        <div className="modal-backdrop">
          <div className="form-modal wide-modal article-reader-modal">
            <div className="modal-head">
              <strong>{isEditingArticle ? '编辑文章' : '全文查看'}</strong>
              <button onClick={() => {
                setPreviewId('')
                setIsEditingArticle(false)
              }}>关闭</button>
            </div>
            <div className="article-reader">
              {isEditingArticle ? (
                <div className="article-editor-layout">
                  <div className="article-editor">
                    <label>
                      <span>文章标题</span>
                      <input value={editArticleTitle} onChange={(event) => setEditArticleTitle(event.target.value)} />
                    </label>
                    <label>
                      <span>文章正文</span>
                      <textarea aria-label="文章正文" ref={bodyEditorRef} value={editArticleBody} onChange={(event) => setEditArticleBody(event.target.value)} />
                    </label>
                    <label>
                      <span>插入当前品牌图片</span>
                      <select aria-label="插入当前品牌图片" value="" disabled={!editorImages.length} onChange={event => {
                        const row = editorImages.find(image => image[5] === event.target.value)
                        if (row) insertImage(row)
                      }}>
                        <option value="">{editorImages.length ? '选择图片插入光标位置' : '当前项目图库暂无图片'}</option>
                        {editorImages.map(row => <option key={row[5]} value={row[5]}>{row[6] || row[1]}</option>)}
                      </select>
                    </label>
                  </div>
                  <article className="article-page-view editor-preview">
                    <h1>{editArticleTitle || previewArticle.title}</h1>
                    <div className="article-content-view">
                      {editArticleBody ? renderArticleBody(editArticleBody) : <p>当前文章暂无完整正文。</p>}
                    </div>
                  </article>
                </div>
              ) : (
                <article className="article-page-view">
                  <h1>{previewArticle.title}</h1>
                  <div className="article-content-view">
                    {previewArticle.body ? renderArticleBody(previewArticle.body) : <p>当前文章暂无完整正文。</p>}
                  </div>
                </article>
              )}
            </div>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => downloadArticles([previewArticle], previewArticle.title)}>下载本文</button>
              <button className="ghost-button" onClick={() => setIsEditingArticle((current) => !current)}>{isEditingArticle ? '取消编辑' : '编辑文章'}</button>
              {isEditingArticle && <button className="primary-button" onClick={savePreviewArticle}>保存修改</button>}
              {!isEditingArticle && <button className="primary-button" onClick={() => setPreviewId('')}>完成</button>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}


function DataCenter({ navigate }: ActionProps) {
  return (
    <section className="operation-page">
      <div className="operation-toolbar"><strong>数据中心</strong></div>
      <div className="empty-state">统计服务暂未接入，暂无统计报表。</div>
      <div className="toolbar-actions">
        <button className="ghost-button" onClick={() => navigate('task-history')}>任务列表</button>
        <button className="ghost-button" onClick={() => navigate('library')}>成品文章库</button>
      </div>
    </section>
  )
}

function ModelConfig({ notify }: ActionProps) {
  type ProviderRow = { enabled: boolean; name: string; baseUrl: string; model: string; apiKey: string; hasKey?: boolean; notes: string; label?: string }
  type ProviderConfigState = { revision: number; targetId: string; providerConfig: Record<string, ProviderRow>; inherited?: Record<string, ProviderRow> | null }
  const [configStatus, setConfigStatus] = useState<{
    qwen?: { configured: boolean; baseUrl?: string; model?: string }
    activeModel?: { configured: boolean; baseUrl?: string; model?: string; source?: string }
    xiaoqingwa?: { installed?: boolean; configured: boolean; missing?: string[] }
    oss?: { configured: boolean }
  }>({})
  const providerLabels: Record<string, string> = { textModel: '文字模型', imageModel: '图片模型', keywordModel: '关键词模型', xiaoqingwa: '小青蛙接口' }
  const providerUse: Record<string, string> = { textModel: '文章生成 / 项目理解', imageModel: 'AI配图', keywordModel: '关键词与场景拓展', xiaoqingwa: '诊断 / 报告 / 补充媒体' }
  const platformName: Record<string, string> = { textModel: 'OpenAI兼容', imageModel: '生图接口', keywordModel: 'OpenAI兼容', xiaoqingwa: '小青蛙' }
  const [providerState, setProviderState] = useState<ProviderConfigState | null>(null)
  const [testing, setTesting] = useState('')
  const [editingKey, setEditingKey] = useState('')
  const [draft, setDraft] = useState<ProviderRow | null>(null)
  const blankProvider = (label = ''): ProviderRow => ({ enabled: false, name: '', baseUrl: '', model: '', apiKey: '', notes: '', label })
  const loadStatus = async () => {
    try {
      const status = await apiJson<typeof configStatus>('/api/config/status')
      setConfigStatus(status)
      const provider = await accountRequest<ProviderConfigState>('/api/admin/platform/provider-config')
      setProviderState(provider)
    } catch {
      notify('接口服务未启动，请先运行本机API服务。')
    }
  }
  useEffect(() => { void loadStatus() }, [])
  const providerRows = Object.keys(providerLabels).map(key => [key, providerState?.providerConfig?.[key] || blankProvider(providerLabels[key])] as const)
  const saveRows = async (rows: Record<string, ProviderRow>) => {
    if (!providerState) return
    setTesting('providers')
    try {
      const providerConfig = Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, { ...row, apiKey: row.apiKey === '已保存' ? '__KEEP__' : row.apiKey }]))
      const next = await accountRequest<ProviderConfigState>('/api/admin/platform/provider-config', { revision: providerState.revision, providerConfig })
      setProviderState(next)
      notify('接口配置已保存。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '接口配置保存失败。')
    } finally {
      setTesting('')
    }
  }
  const openEditor = (key: string) => {
    const row = providerState?.providerConfig?.[key] || blankProvider(providerLabels[key])
    setEditingKey(key)
    setDraft({ ...row, apiKey: '' })
  }
  const saveEditor = async () => {
    if (!providerState || !editingKey || !draft) return
    const current = providerState.providerConfig[editingKey] || blankProvider(providerLabels[editingKey])
    const nextRow = { ...draft, apiKey: draft.apiKey.trim() ? draft.apiKey : current.hasKey ? '__KEEP__' : '' }
    await saveRows({ ...providerState.providerConfig, [editingKey]: nextRow })
    setEditingKey('')
    setDraft(null)
  }
  const deleteProvider = async (key: string) => {
    if (!providerState) return
    await saveRows({ ...providerState.providerConfig, [key]: blankProvider(providerLabels[key]) })
  }
  const testModel = async () => {
    setTesting('model')
    try {
      const result = await apiJson<{ ok: boolean; content?: string }>('/api/model/test', {})
      notify(result.content || '模型连接正常。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '模型测试失败。')
    } finally {
      setTesting('')
    }
  }
  const testMedia = async () => {
    setTesting('media')
    try {
      await apiJson('/api/media/publish', { dryRun: true, title: '接口测试', body: '接口测试' })
      notify('小青蛙发布接口已连通。')
    } catch (error) {
      notify(error instanceof Error ? error.message : '小青蛙测试失败。')
    } finally {
      setTesting('')
    }
  }
  const configuredCount = providerRows.filter(([, row]) => row.enabled && row.baseUrl && row.model && row.hasKey).length
  const inheritedCount = providerRows.filter(([key]) => providerState?.inherited?.[key]?.hasKey || providerState?.inherited?.[key]?.model).length
  const systemRows = [
    ['写作模型', configStatus.activeModel?.configured ? `已接通 ${configStatus.activeModel.model || ''}` : '未接通', configStatus.activeModel?.configured ? 'ready' : 'warn', testModel, testing === 'model' ? '测试中' : '测试模型'],
    ['小青蛙', configStatus.xiaoqingwa?.configured ? '已接通发布接口' : (configStatus.xiaoqingwa?.missing?.join('、') || '未接通'), configStatus.xiaoqingwa?.configured ? 'ready' : 'warn', testMedia, testing === 'media' ? '测试中' : '测试发布'],
    ['图片存储', configStatus.oss?.configured ? 'OSS 已配置' : '未配置', configStatus.oss?.configured ? 'ready' : 'warn', null, '—'],
  ] as const
  return (
    <section className="platform-admin model-admin-page">
      <header className="pa-heading model-admin-heading">
        <div>
          <h2>模型接口</h2>
          <p>按接口类型统一管理模型、小青蛙和图片能力；密钥只保存到服务端。</p>
        </div>
        <div>
          <button className="pa-icon-button" title="刷新配置" aria-label="刷新配置" onClick={loadStatus}><RefreshCw size={16}/></button>
          <button className="primary-button" onClick={() => openEditor('textModel')}><Plus size={16}/>添加</button>
          <button className="danger-button" disabled title="请选择接口后删除"><Trash2 size={16}/>删除</button>
        </div>
      </header>
      <div className="model-admin-summary">
        <span><strong>{providerRows.length}</strong>接口类型</span>
        <span><strong>{configuredCount}</strong>已启用</span>
        <span><strong>{inheritedCount}</strong>继承上级</span>
        <span><strong>{providerState ? '已同步' : '加载中'}</strong>配置状态</span>
      </div>
      <div className="pa-scroll model-table-wrap">
        <table className="pa-provider-table model-provider-table">
          <thead><tr><th><input type="checkbox" aria-label="选择全部接口" disabled /></th><th>序号</th><th>别名</th><th>接口类型</th><th>接口地址</th><th>模型名称</th><th>API-KEY</th><th>创作用途</th><th>上级配置</th><th>状态</th><th>操作</th></tr></thead>
          <tbody><PagedRows table>{providerRows.map(([key, row], index) => {
            const inherited = providerState?.inherited?.[key]
            const enabled = Boolean(row.enabled && row.baseUrl && row.model && row.hasKey)
            return <tr key={key}>
              <td><input type="checkbox" aria-label={`选择${providerLabels[key]}`} disabled /></td>
              <td>{index + 1}</td>
              <td><strong>{row.name || providerLabels[key]}</strong><small>{providerLabels[key]}</small></td>
              <td><span className="pill">{platformName[key]}</span></td>
              <td className="mono-cell">{row.baseUrl || '—'}</td>
              <td>{row.model || '—'}</td>
              <td>{row.hasKey ? '已保存' : '未填写'}</td>
              <td>{providerUse[key]}</td>
              <td>{inherited?.hasKey || inherited?.model ? `${inherited.name || providerLabels[key]} ${inherited.model || ''}` : '—'}</td>
              <td><span className={`pa-status-dot ${enabled ? 'ready' : ''}`}>{enabled ? '已启用' : '未启用'}</span></td>
              <td><div className="pa-actions"><button title="编辑接口" aria-label={`编辑${providerLabels[key]}`} onClick={() => openEditor(key)}><Pencil size={16}/></button><button className="danger-button" title="清空接口" aria-label={`清空${providerLabels[key]}`} disabled={testing === 'providers'} onClick={() => void deleteProvider(key)}><Trash2 size={16}/></button></div></td>
            </tr>
          })}</PagedRows></tbody>
        </table>
      </div>
      <div className="model-admin-footer">
        {systemRows.map(([name, value, state, action, label]) => (
          <div className="model-system-item" key={name}>
            <span>{name}</span>
            <strong className={state}>{value}</strong>
            {action ? <button onClick={action}>{label}</button> : <em>{label}</em>}
          </div>
        ))}
      </div>
      {editingKey && draft && <Modal title={providerState?.providerConfig?.[editingKey]?.hasKey ? '编辑接口' : '添加接口'} onClose={() => { setEditingKey(''); setDraft(null) }} actions={<><button className="ghost-button" onClick={() => { setEditingKey(''); setDraft(null) }}>取消</button><button className="primary-button" disabled={testing === 'providers'} onClick={() => void saveEditor()}>确定</button></>}>
        <div className="pa-dialog pa-form model-edit-form">
          <label>接口类型<input value={providerLabels[editingKey]} disabled /></label>
          <label>状态<select value={draft.enabled ? 'enabled' : 'disabled'} onChange={event => setDraft({ ...draft, enabled: event.target.value === 'enabled' })}><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>
          <label>自定义别名<input value={draft.name} placeholder={`${providerLabels[editingKey]}名称`} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label>
          <label>请求接口<input value={draft.baseUrl} placeholder="https://api.example.com/v1/chat/completions" onChange={event => setDraft({ ...draft, baseUrl: event.target.value })}/></label>
          <label>模型 / 接口标识<input value={draft.model} placeholder={editingKey === 'xiaoqingwa' ? '接口版本或账号标识' : 'qwen-max / deepseek-chat'} onChange={event => setDraft({ ...draft, model: event.target.value })}/></label>
          <label>API-KEY<input type="password" value={draft.apiKey} placeholder={providerState?.providerConfig?.[editingKey]?.hasKey ? '已保存，留空不变' : '填写API Key'} onChange={event => setDraft({ ...draft, apiKey: event.target.value })}/></label>
          <label className="model-edit-wide">备注<textarea value={draft.notes || ''} placeholder="仅后台可见" onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label>
        </div>
      </Modal>}
    </section>
  )
}

function SettingsPage({ notify }: ActionProps) {
  const [savedAt, setSavedAt] = useState('尚未保存')
  return (
    <section className="operation-page">
      <div className="operation-toolbar">
        <div>
          <strong>系统设置</strong>
          <span>管理资料调用、接口和分发频控。</span>
        </div>
        <button className="primary-button" onClick={() => {
          setSavedAt('刚刚保存')
          notify('系统设置已保存。')
        }}>保存设置</button>
      </div>
      <div className="settings-layout">
        <div className="panel">
          <SectionTitle icon={ShieldCheck} title="资料调用规则" desc="当前只保留品牌资料、关键词和可信资料调用。" />
          <div className="rule-list">
            <div className="rule-item">
              <strong>品牌归属</strong>
              <p>生成文章只调用当前品牌项目的数据。</p>
            </div>
            <div className="rule-item">
              <strong>资料来源</strong>
              <p>核心词、蒸馏问题、关键词库、品牌资料和可信资料作为写作参考。</p>
            </div>
            <div className="rule-item">
              <strong>skill稿单写作</strong>
              <p>系统按文章类型、客户场景和项目资料组装稿单，再交给API逐篇生成。</p>
            </div>
          </div>
        </div>
        <div className="panel form-panel">
          <SectionTitle icon={Settings} title="当前写作模式" desc="旧审核和固定写作规则已关闭。" />
          <Field label="提示词版本" value="niuge-geo-skill-api-v2" />
          <Field label="文章结构" value="按skill稿单生成" />
          <Field label="标题生成" value="按核心词、行业和文章类型生成" />
          <Field label="入库方式" value="生成后进入成品文章库" />
          <div className="status-line">
            <span>保存状态</span>
            <strong>{savedAt}</strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function ArticleTable({
  articleRows,
  compact = false,
  title = '近期成品稿',
  desc = '展示系统调用资料生成的文章。',
}: {
  articleRows: Article[]
  compact?: boolean
  title?: string
  desc?: string
}) {
  return (
    <div className="panel">
      <SectionTitle icon={Newspaper} title={title} desc={desc} />
      <div className="article-list">
        <PagedRows>{articleRows.slice(0, compact ? 3 : articleRows.length).map((article) => (
          <article className="article-row" key={article.id}>
            <div>
              <strong>{article.title}</strong>
              <p>{article.angle} · {article.keyword} · {article.words}字</p>
            </div>
            <div className="article-score">
              <span>{article.words}</span>
              <em className={article.status === '生成异常' ? 'danger' : ''}>{article.status}</em>
            </div>
          </article>
        ))}</PagedRows>
      </div>
    </div>
  )
}

function Inspector({ articleRows }: { articleRows: Article[] }) {
  const passedCount = articleRows.filter((article) => article.status === '已生成').length
  const failedCount = articleRows.filter((article) => article.status === '生成异常').length
  return (
    <>
      <div className="inspector-card live-card">
        <p className="eyebrow">当前品牌</p>
        <h3>曝光率GEO · 西安GEO公司</h3>
        <p>核心词锁定，关键词库按语义辅助，已生成文章{passedCount}篇。</p>
        <div className="live-score">
          <span>{passedCount}</span>
          <div>
            <strong>成品文章</strong>
            <p>接口异常 {failedCount} 篇</p>
          </div>
        </div>
      </div>

      <div className="inspector-card">
        <SectionTitle icon={ListChecks} title="写作资料链" desc="这些在生成前就参与稿单。" />
        <div className="mini-list">
          <span>核心词优先</span>
          <span>蒸馏问题定意图</span>
          <span>关键词库补语境</span>
          <span>标题问题化</span>
          <span>品牌资产按需调用</span>
          <span>权威引证转理由</span>
        </div>
      </div>

      <div className="inspector-card">
        <SectionTitle icon={ShieldCheck} title="成品出口" desc="生成完成后直接进入成品库。" />
        <div className="check-stack">
          {['API单篇生成', '无正文才标异常', '成品库查看下载', '分发队列预留'].map((title) => (
            <div key={title}>
              <CheckCircle2 size={15} />
              <span>{title}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function RuleList({ max }: { max?: number }) {
  return (
    <div className="rule-list">
      {auditRules.slice(0, max).map(([title, desc]) => (
        <div className="rule-item" key={title}>
          <CheckCircle2 size={17} />
          <div>
            <strong>{title}</strong>
            <p>{desc}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder = '',
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        readOnly={!onChange}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value)}
      />
    </label>
  )
}

function EditableField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const safeOptions = options.length ? options : ['暂无可选项']
  const safeValue = safeOptions.includes(value) ? value : safeOptions[0]
  return (
    <label className="field">
      <span>{label}</span>
      <select value={safeValue} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}>
        {safeOptions.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function ReportRow({ name, words, status, score }: { name: string; words: string; status: string; score: string }) {
  return (
    <div className="panel report-row">
      <div>
        <strong>{name}</strong>
        <p>{words}</p>
      </div>
      <span className="pill">{status}</span>
      <em>{score}分</em>
    </div>
  )
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="section-title">
      <Icon size={18} />
      <div>
        <h2>{title}</h2>
      </div>
    </div>
  )
}

function ProjectApp() {
  const [scope, setScope] = useState(identityKey)
  useEffect(() => {
    const changed = () => setScope(identityKey())
    window.addEventListener('geo:identity-changed', changed)
    return () => window.removeEventListener('geo:identity-changed', changed)
  }, [])
  return <App key={scope} />
}

const rootElement = document.getElementById('root')!
const windowWithRoot = window as typeof window & { __geoContentRoot?: ReturnType<typeof ReactDOM.createRoot> }
windowWithRoot.__geoContentRoot ??= ReactDOM.createRoot(rootElement)
windowWithRoot.__geoContentRoot.render(
  <StrictMode>
    <AuthGate><ProjectApp /></AuthGate>
  </StrictMode>,
)

