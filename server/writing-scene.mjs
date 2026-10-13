const modes = new Set(['AI场景', '手动场景'])
export const isUnifiedScene = mode => modes.has(mode)

export function normalizeWritingScene(task = {}, packet = {}, project = {}) {
  const mode = task.writingSceneMode ?? packet.writingSceneMode ?? 'AI场景'
  if (!isUnifiedScene(mode)) {
    if (!['按自己行业写', '按实际场景写'].includes(mode)) throw Object.assign(new Error('请选择AI场景或手动场景'), { status: 400 })
    return { writingSceneMode: mode }
  }
  if (mode === 'AI场景') return { writingSceneMode: mode, sceneCity: String(project.city || '').trim(), sceneIndustry: '' }
  const field = (key, label, max) => {
    const value = task[key] ?? packet[key]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n<>]/.test(value)) {
      throw Object.assign(new Error(`请填写有效的${label}（最多${max}字）`), { status: 400 })
    }
    return value.trim()
  }
  return { writingSceneMode: mode, sceneCity: field('sceneCity', '场景城市', 40), sceneIndustry: field('sceneIndustry', '场景行业', 60) }
}

export function sceneAssignment(plan = {}, packet = {}, project = {}) {
  const mode = plan.writingSceneMode || packet.writingSceneMode
  if (!isUnifiedScene(mode)) return null
  const scene = normalizeWritingScene({ ...plan, writingSceneMode: mode }, packet, project)
  return { ...scene, direction: '先理解项目主营服务，再理解购买这项服务的客户行业。城市是服务需求发生地，不代表品牌在当地有办公室或业绩；行业是买方，不是推荐对象。只选一个连贯场景，依据行业的实际决策细节组织文章，不把场景设想当真实客户案例。',
    source: mode === '手动场景' ? '客户已指定城市和行业，两项原样保留，其他需求由Agent理解，不另换行业。' : '从项目理解、真实服务范围及场景词参考中选择适用客户行业；优先覆盖历史未讲透的场景，不按固定行业名单轮换。没有地域资料时保持全国或未限定，不编造当地经营事实。' }
}
