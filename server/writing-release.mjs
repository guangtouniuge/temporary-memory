import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const contentHash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')

export function canResumeWritingRelease(previous, current) {
  if (previous === current) return true
  if (previous === '8.2.58' && current === '8.2.59') return true
  if (['8.2.58', '8.2.59'].includes(previous) && current === '8.2.60') return true
  if (['8.2.29', '8.2.30'].includes(previous) && current === '8.2.31') return true
  // Explicit compatibility: reliability/error handling only, same writing prompts and Skill.
  return ['8.2.48', '8.2.49', '8.2.50', '8.2.51'].includes(previous) && current === '8.2.52'
}

export function verifyApprovedSkill(root = new URL('./', import.meta.url)) {
  const approved = JSON.parse(readFileSync(new URL('approved-skill.json', root), 'utf8'))
  for (const [path, expected] of Object.entries(approved.files)) {
    if (!/^[\w./-]+$/.test(path) || path.includes('..')) throw new Error('Invalid approved Skill path')
    const actual = contentHash(readFileSync(new URL(`skills/niuge-geo-skill/${path}`, root), 'utf8'))
    if (actual !== expected) throw new Error(`Approved Skill changed: ${path}; explicit user approval required`)
  }
  return approved
}

export function verifyWritingRelease(root = new URL('./', import.meta.url)) {
  verifyApprovedSkill(root)
  const manifest = JSON.parse(readFileSync(new URL('writing-release.json', root), 'utf8'))
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (!/^[\w./-]+$/.test(path) || path.includes('..')) throw new Error('Invalid release file path')
    const actual = contentHash(readFileSync(new URL(path, root), 'utf8'))
    if (actual !== expected) throw new Error(`Writing release ${manifest.version} integrity mismatch: ${path}`)
  }
  return Object.freeze({ version: manifest.version, digest: contentHash(JSON.stringify(manifest.files)) })
}
