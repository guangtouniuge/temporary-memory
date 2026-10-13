import fs from 'node:fs/promises'

// Mechanical extraction from recovered, user-reviewed conversation artifacts.
const root = 'outputs/context-recovery-20260912'
const examples = {}
for (const [file, type] of [['01-original.md', 'A'], ['02-original.md', 'B'], ['03-original.md', 'C']]) {
  const source = await fs.readFile(`${root}/${file}`, 'utf8')
  const block = source.match(/:::writing[^\n]*\n([\s\S]*?)\n:::/)?.[1]
  if (!block) throw new Error(`Missing example ${type}`)
  examples[type] = { source: `${root}/${file}`, role: '历史用户评阅范文，仅示范写法，不作为当前项目事实', text: block.trim() }
}
const source = await fs.readFile(`${root}/04-original.md`, 'utf8')
const blocks = [...source.matchAll(/^# 模板类型：([D-L])类[^\n]*\n([\s\S]*?)(?=^# 模板类型：|\n:::(?:\n|$))/gm)]
for (const match of blocks) examples[match[1]] = { source: `${root}/04-original.md`, role: '历史用户评阅范文，仅示范写法，不作为当前项目事实', text: match[2].trim() }
if (Object.keys(examples).length !== 12) throw new Error(`Expected twelve examples, got ${Object.keys(examples).join(',')}`)
await fs.writeFile('server/agents/examples.json', JSON.stringify(examples, null, 2))
console.log('Extracted twelve historical examples without rewriting them')
