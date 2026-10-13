import {existsSync,lstatSync,mkdirSync,writeFileSync,renameSync} from 'node:fs'
import {resolve,relative,isAbsolute,dirname,sep} from 'node:path'

export function validateFileWrites(root,writes) {
  const base=resolve(root)
  if(!Array.isArray(writes)||!writes.length)throw Error('没有待保存文件')
  const paths=new Set()
  for(const item of writes) {
    const file=resolve(item.path),rel=relative(base,file)
    if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel)||paths.has(file))throw Error('文件保存范围无效')
    paths.add(file)
    let cursor=file
    while(true) {
      if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw Error('文件保存路径不能包含链接')
      if(cursor===base)break
      cursor=dirname(cursor)
    }
    if(typeof item.data!=='string'||item.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(item.data)||Buffer.from(item.data,'base64').toString('base64')!==item.data)throw Error('文件内容编码无效')
  }
}

export function applyFileWrites(id,root,writes) {
  validateFileWrites(root,writes)
  for(const item of writes) {
    mkdirSync(dirname(item.path),{recursive:true})
    const temporary=resolve(dirname(item.path),`.${id}.pending`)
    writeFileSync(temporary,Buffer.from(item.data,'base64'),{mode:0o600,flush:true})
    renameSync(temporary,item.path)
  }
}
