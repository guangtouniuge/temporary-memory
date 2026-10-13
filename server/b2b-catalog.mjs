import areas from './b2b-areas.json' with {type:'json'}
// Provider tariff and available type list verified 2026-09-14.
// https://s.apifox.cn/ecc95f5a-3182-406a-aeb5-8930e3a06e65/8594945m0
export const b2bResources=[[1,'黄页88',100],[3,'博客园',300],[4,'列举网',80],[5,'商业新知',300],[6,'蓝色河畔',300]].map(([id,title,priceCents])=>({resource_id:`b2b:${id}`,type:id,title,priceCents,price:(priceCents/100).toFixed(2),remarks:id===4?'必填联系人、电话、发布地区、HTTPS封面':'必填HTTPS封面',fields:{},providerStatus:1}))
export {areas as b2bAreas}
export function b2bOptions(value,type){
  const fail=m=>{throw Object.assign(Error(m),{status:400})}
  const v=value||{},result={}
  for(const key of ['author','phone','from','image_url','area']){if(v[key]!=null&&typeof v[key]!=='string')fail('B2B投稿资料格式无效');result[key]=String(v[key]||'').trim()}
  if(result.author.length>100||result.from.length>200)fail('联系人或来源过长')
  if(type===4&&(!result.author||!/^\d{7,15}$/.test(result.phone)||!areas.some(a=>a.id===result.area)))fail('列举网需要联系人、纯数字电话和有效地区')
  try{const u=new URL(result.image_url);if(u.protocol!=='https:'||u.username||u.password)fail('B2B封面必须是HTTPS图片地址')}catch{fail('请填写B2B封面HTTPS图片地址')}
  return result
}
export function b2bCatalog(params, {priceFor = resource => resource} = {}){
  const q=(params.get('q')||'').trim(),min=params.get('minPrice'),max=params.get('maxPrice'),sort=params.get('sort')
  let rows=b2bResources.map(r=>priceFor(r,'b2b')).filter(r=>r.title.includes(q)&&(!min||r.priceCents>=Number(min)*100)&&(!max||r.priceCents<=Number(max)*100))
  if(sort==='low'||sort==='high')rows=[...rows].sort((a,b)=>(sort==='low'?1:-1)*(a.priceCents-b.priceCents))
  return {resources:rows,total:rows.length,totalPages:rows.length?1:0,page:1,pageSize:20,catalogTotal:b2bResources.length,complete:true,fields:[],areas,priceSource:'小青蛙公开收费明细（2026-09-14）'}
}
