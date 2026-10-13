export type ProjectIdentity = {
  userId: string
  role: 'super_admin' | 'agent' | 'project_admin' | 'project_operator'
  agentId?: string
  projectId: string
}
declare global {
  interface Window { __geoIdentity?: ProjectIdentity }
}
export function identityKey() {
  const identity = window.__geoIdentity
  return identity ? `${identity.userId}:${identity.projectId}` : 'legacy'
}
export function projectHeaders(): Record<string, string> {
  const identity = window.__geoIdentity
  return identity ? {
    'x-geo-user-id': identity.userId, 'x-geo-role': identity.role,
    'x-geo-agent-id': identity.agentId || '', 'x-geo-project-id': identity.projectId,
  } : {}
}
function cacheKey(key: string) { return `geoskill:${identityKey()}:${key}` }
// Never hydrate a project account from the pre-account browser cache.
export const projectStorage = {
  getItem(key: string) {
    try { return window.localStorage.getItem(cacheKey(key)) } catch { return null }
  },
  setItem(key: string, value: string) {
    // Browser cache is optional; quota/privacy failures must not block server data.
    try {
      if(key==='geo.articleRows')window.localStorage.removeItem(cacheKey(key))
      else window.localStorage.setItem(cacheKey(key), value)
    } catch { /* The server remains the source of truth. */ }
  },
}
export async function fetchProjectFile(url: string) {
  const response = await fetch(url, { headers: projectHeaders(), credentials: 'same-origin' })
  if (!response.ok) throw new Error(`文件访问失败（${response.status}）`)
  return response.blob()
}
