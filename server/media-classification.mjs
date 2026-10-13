// These names are listed in the provider's B2B documentation. Keep their
// existing resource IDs and prices; the dedicated B2B API is a separate contract.
const b2bNames = ['黄页88', '博客园', '列举网', '商业新知', '蓝色河畔', '土巴兔']
export function b2bPlatform(resource) {
  const name = String(resource.title || '').trim()
  return b2bNames.find(n => name === n || name.startsWith(n + '（') || name.startsWith(n + '(')) || ''
}
export function mediaDetails(resource, channel, fields) {
  const labels = type => String(resource.fields?.[type] || '').split(',').map(id => fields.find(f => f.type === type && f.id === id)?.title).filter(Boolean).join('、')
  const meta = resource.meta && typeof resource.meta === 'object' ? resource.meta : {}
  if(channel==='news2')return {
    type: labels('field_0') || '新闻源-2',
    platform: labels('field_1') || '未提供',
    region: labels('field_3') || '未提供',
    category: labels('field_2') || '未提供',
    industry: labels('field_1') || labels('field_2') || '未提供',
    publishSpeed: meta.publishSpeed || meta.deadline || '未提供',
    deadline: meta.deadline || '',
    indexing: meta.indexing || meta.aiInclude || '未提供',
    linkType: meta.linkType || '',
    accountType: labels('field_7') || '',
    contact: meta.contact || '',
    weekendActive: meta.weekendActive || '',
    linkPeriod: meta.linkPeriod || '',
    weight: meta.weight || '',
    portal: meta.portal || '',
    aiInclude: meta.aiInclude || '',
    fans: meta.fans || '',
    reads: meta.reads || '',
    likes: meta.likes || '',
    imageFee: meta.imageFee || '',
    translation: meta.translation || '',
    country: meta.country || '',
    language: meta.language || '',
  }
  return channel === 'social' ? {
    platform: labels('field_1') || '未提供',
    industry: labels('field_2') || '未提供',
    region: labels('field_3') || '未提供',
    fans: labels('field_4') || '',
    reads: labels('field_5') || '',
    verification: labels('field_6') || '未提供',
    mediaIdentity: labels('field_7') || '未提供',
    features: labels('field_8'),
    subject: '未提供',
  } : {
    platform: labels('field_2') || b2bPlatform(resource) || '未提供',
    region: labels('field_3') || '未提供',
    industry: labels('field_1') || '未提供',
    pageLevel: labels('field_4') || '',
    indexing: labels('field_5') || '',
    linkType: labels('field_6') || '',
    publishSpeed: labels('field_7') || '',
    specialIndustry: labels('field_8') || '',
    features: labels('field_9') || '',
    mediaType: labels('field_10') || '',
    weight: labels('field_11') || '',
  }
}
