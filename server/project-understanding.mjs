import { contentHash } from './writing-release.mjs'
import { projectInput, projectUnderstandingVersion } from './agents-workflow.mjs'

export const understandingKey = payload => contentHash(JSON.stringify({ input: projectInput(payload), projectUnderstandingVersion }))
export function getUnderstanding(payload, rows) {
  const sourceHash = understandingKey(payload)
  const scope = payload.packet?.knowledgeName || ''
  const row = rows.find(row => row.project === payload.project.name && row.knowledgeName === scope && row.sourceHash === sourceHash)
  const prior = rows.find(row => row.project === payload.project.name && row.knowledgeName === scope)
  return { sourceHash, record: row || null, stale: !row && Boolean(prior), previous: prior || null }
}

export function storeUnderstanding(payload, value, rows, notes = '') {
  const row = { project: payload.project.name, knowledgeName: payload.packet?.knowledgeName || '', sourceHash: understandingKey(payload), value, notes, updatedAt: new Date().toISOString() }
  return [row, ...rows.filter(item => !(item.project === row.project && item.knowledgeName === row.knowledgeName))]
}
