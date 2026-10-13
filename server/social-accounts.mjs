import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
const platforms=new Set(['toutiao','zhihu','douyin','netease','baijia','penguin','wechat','jianshu','sohu'])
const invalid=message=>{throw Object.assign(new Error(message),{status:400})}
export function socialAccounts(directory,brand,projects,input) {
  if(typeof brand!=='string'||!projects.some(p=>p.name===brand))invalid('品牌不属于当前项目')
  const file=join(directory,'social-accounts.json')
  let rows=[]
  try{rows=JSON.parse(readFileSync(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!Array.isArray(rows))throw Error('账号记录损坏，请联系管理员')
  if(input!==undefined) {
    if(!platforms.has(input.platform))invalid('不支持的平台')
    const name=typeof input.name==='string'?input.name.trim():''
    if(!name||name.length>60)invalid('请输入1至60字的账号备注')
    const clientId=typeof input.clientId==='string'&&input.clientId.trim()?input.clientId.trim().slice(0,120):''
    const duplicate=clientId
      ? rows.find(r=>r.brand===brand&&r.clientId===clientId)
      : rows.find(r=>r.brand===brand&&r.platform===input.platform&&r.name===name&&!r.clientId)
    if(duplicate)return duplicate
    if(rows.filter(r=>r.brand===brand).length>=100)invalid('每个品牌最多添加100个账号')
    const row={id:randomUUID(),brand,platform:input.platform,name,status:'unverified',createdAt:new Date().toISOString()}
    if(clientId)row.clientId=clientId
    rows.push(row);mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,file)
    return row
  }
  return rows.filter(r=>r.brand===brand)
}

export function deleteSocialAccount(directory,brand,projects,input) {
  if(typeof brand!=='string'||!projects.some(p=>p.name===brand))invalid('品牌不属于当前项目')
  if(!input||typeof input.id!=='string')invalid('账号无效')
  const file=join(directory,'social-accounts.json')
  let rows=[]
  try{rows=JSON.parse(readFileSync(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!Array.isArray(rows))throw Error('账号记录损坏，请联系管理员')
  const before=rows.length
  rows=rows.filter(r=>!(r.brand===brand&&r.id===input.id))
  if(rows.length===before)invalid('账号不存在')
  mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,file)
  return {id:input.id}
}

export function updateSocialAccount(directory,brand,projects,input) {
  if(typeof brand!=='string'||!projects.some(p=>p.name===brand))invalid('品牌不属于当前项目')
  if(!input||typeof input.id!=='string')invalid('账号无效')
  const file=join(directory,'social-accounts.json')
  let rows=[]
  try{rows=JSON.parse(readFileSync(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  if(!Array.isArray(rows))throw Error('账号记录损坏，请联系管理员')
  const row=rows.find(r=>r.brand===brand&&r.id===input.id)
  if(!row)invalid('账号不存在')
  const statuses=new Set(['unverified','verified','connected','blocked'])
  if(typeof input.status==='string'&&statuses.has(input.status))row.status=input.status
  if(typeof input.avatarUrl==='string')row.avatarUrl=input.avatarUrl.slice(0,500)
  if(typeof input.displayName==='string'&&input.displayName.trim())row.displayName=input.displayName.trim().slice(0,80)
  row.updatedAt=new Date().toISOString()
  mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(rows));renameSync(tmp,file)
  return row
}
