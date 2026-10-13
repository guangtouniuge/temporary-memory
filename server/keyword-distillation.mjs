export function distillationCount(value) {
  const n = Number(value ?? 20)
  if (!Number.isSafeInteger(n) || n < 1 || n > 200) throw Object.assign(new Error('拓展数量须为1至200的整数'), {status:400})
  return n
}

export function cleanSelectionTerms(words, core, industry = '', existing = []) {
  const seen = new Set(existing.map(x=>String(x).replace(/[\s？?。；;]/g,'')))
  const result = []
  for (const raw of Array.isArray(words) ? words : []) {
    if (typeof raw !== 'string') continue
    const term = raw.replace(/[？?。；;]+$/g,'').trim()
    const key = term.replace(/\s/g,'')
    if (!term.includes(core) || term === core || Array.from(term).length > Math.min(50,Array.from(core).length+14)) continue
    if (/[\n，,：:！!]/.test(term) || /是什么|怎么做|教程|发展趋势|什么意思/.test(term)) continue
    if (/厂家|生产厂|源头厂/.test(term) && !/厂家|制造|生产|工厂/.test(core+' '+industry)) continue
    if (!/哪|推荐|排名|排行|口碑|靠谱|专业|性价比|技术强|实力强|服务好|值得|怎么选|如何选|挑选|比较|对比|信誉|可靠|放心|资质|经验|交付|售后/.test(term.slice(term.indexOf(core)+core.length) + term.slice(0,term.indexOf(core)))) continue
    if (!seen.has(key)) { seen.add(key); result.push(term) }
  }
  return result
}

export async function distillSelectionTerms({core,count,existing=[]}) {
  count=distillationCount(count)
  const suffixes=['哪家好','哪家靠谱','怎么选','推荐哪家','哪家值得推荐','哪家专业','哪家口碑好','哪家实力强','哪家服务好','哪家性价比高','哪家值得信赖','如何选择','哪家技术强','哪家经验丰富','哪家信誉好','哪家更可靠','哪家适合我','选择哪家','哪家值得合作','哪家服务有保障']
  const seen=new Set(existing.map(term=>String(term).replace(/[\s？?。；;]/g,'')))
  const terms=suffixes.map(suffix=>core+suffix).filter(term=>!seen.has(term.replace(/\s/g,''))).slice(0,count)
  return {terms,mode:'simple',available:suffixes.length}
}
