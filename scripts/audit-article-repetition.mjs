import fs from 'node:fs'

// Internal text similarity, not a plagiarism score or a publication gate.
export function auditArticles(articles) {
  const plain = text => String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]*>/g, '')
  const normalize = text => plain(text).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const grams = text => new Set(Array.from({ length: Math.max(0, text.length - 4) }, (_, i) => text.slice(i, i + 5)))
  const docs = articles.map(a => {
    const body = plain(a.body)
    const sentences = body.split(/[。！？\n]+/).map(normalize).filter(s => s.length >= 25)
    const repeated = [...new Set(sentences.filter((s, i) => sentences.indexOf(s) !== i))]
    return { title: a.title, text: normalize(body), grams: grams(normalize(body)), sentences: new Set(sentences), repeated }
  })
  const pairs = []
  docs.forEach((a, i) => docs.slice(i + 1).forEach((b, j) => {
    const shared = [...a.grams].filter(g => b.grams.has(g)).length
    pairs.push({ a: i + 1, b: i + j + 2, dicePercent: +(200 * shared / Math.max(1, a.grams.size + b.grams.size)).toFixed(2), sharedSentences: [...a.sentences].filter(s => b.sentences.has(s)) })
  }))
  return { method: '去图片及标点后，连续5字符集合Dice相似度；另列至少25字符的相同句段。不是外部查重率，不能衡量全部语义重复。', articles: docs.map(a => ({ title: a.title, chars: a.text.length, repeatedSentences: a.repeated })), pairs: pairs.sort((a,b) => b.dicePercent-a.dicePercent) }
}

if (process.argv[1]?.endsWith('audit-article-repetition.mjs')) {
  const articles = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''))
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(articles, null, 2))
  console.log(JSON.stringify(auditArticles(articles), null, 2))
}
