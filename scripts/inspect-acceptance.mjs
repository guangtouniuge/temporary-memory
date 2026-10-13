import fs from 'node:fs/promises'
import path from 'node:path'
const dir = path.resolve(process.argv[2])
const count = s => (s.match(/[\u3400-\u9fff]/g) || []).length
const results = []
for (const name of (await fs.readdir(dir)).filter(n => /^\d\d-.+\.md$/.test(n)).sort()) {
  const text = await fs.readFile(path.join(dir, name), 'utf8')
  const paragraphs = text.split(/\n\s*\n/).filter(p => !p.startsWith('#'))
  const frequency = new Map()
  for (const p of paragraphs) frequency.set(p, (frequency.get(p) || 0) + 1)
  const rankings = [...text.matchAll(/^## 第[1-5]名：[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(m => count(m[1]))
  const headings = text.split('\n').filter(line => /^#{2,3} /.test(line))
  results.push({ file: name, title: text.split('\n')[0].slice(2), chars: count(text), paragraphs: paragraphs.length,
    longestParagraph: Math.max(...paragraphs.map(count)), rankings,
    largestFirstRatio: rankings.length > 1 ? Math.round(rankings[0] / Math.min(...rankings.slice(1)) * 100) / 100 : null,
    repeatedParagraphs: [...frequency].filter(([p, n]) => n > 1 && p.length > 30).map(([p, n]) => ({ text: p, count: n })),
    repeatedHeadings: headings.filter((h, i) => headings.indexOf(h) !== i), headings,
  })
}
await fs.writeFile(path.join(dir, 'inspection.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results.map(({ headings, repeatedParagraphs, ...r }) => ({ ...r, repeatedParagraphs: repeatedParagraphs.length })), null, 2))
