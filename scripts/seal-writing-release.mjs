import fs from 'node:fs'
import { contentHash, verifyApprovedSkill } from '../server/writing-release.mjs'
const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Pass an explicit release version')
const approved = verifyApprovedSkill()
const paths = ['writing-engine.mjs', 'writing-release.mjs', 'approved-skill.json', 'skill-editor.mjs', 'batch-editor.mjs', 'job-journal.mjs', 'model-request.mjs', 'agents-workflow.mjs', 'project-understanding.mjs', 'project-scope.mjs', ...['WORKFLOW.md', 'project.md', 'editor.md', 'writer.md', 'examples.json'].map(p => `agents/${p}`), ...Object.keys(approved.files).map(p => `skills/niuge-geo-skill/${p}`)]
paths.push('writing-depth.mjs')
paths.push('model-json.mjs')
paths.push('agents/title-planning.md')
paths.push('agents/selection-direction.md')
paths.push('keyword-distillation.mjs')
paths.push('business-scenes.mjs')
paths.push('writing-scene.mjs')
paths.push('volcengine-images.mjs')
paths.push('provider-research.mjs')
const files = Object.fromEntries(paths.map(path => [path, contentHash(fs.readFileSync(`server/${path}`, 'utf8'))]))
const target = 'server/writing-release.json'
if (fs.existsSync(target)) {
  const old = JSON.parse(fs.readFileSync(target, 'utf8'))
  if (old.version === version && JSON.stringify(old.files) !== JSON.stringify(files)) throw new Error('Sealed version changed: use a new release version')
}
fs.writeFileSync(target, JSON.stringify({ version, files }, null, 2) + '\n')
console.log(`Sealed writing engine ${version}: ${paths.length} files`)
