import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function stateCapacity(state) {
  const rows=key=>Array.isArray(state[key])?state[key]:[]
  const words=new Set()
  for(const key of ['geo.keywordRows','geo.keywordLibraryRows','geo.questionRows']) {
    for(const row of rows(key)) {
      if(!Array.isArray(row))continue
      const value=String(row[key==='geo.keywordRows'?1:2] || '').trim()
      if(value)words.add(JSON.stringify([row[0],value]))
    }
  }
  return {projects:rows('geo.projectRows').length,keywords:words.size}
}

export function directoryBytes(root) {
  let entries
  try { entries=readdirSync(root,{withFileTypes:true}) } catch(error) {if(error.code==='ENOENT')return 0;throw error}
  let total=0
  for(const entry of entries) {
    const file=join(root,entry.name),stat=lstatSync(file)
    if(stat.isSymbolicLink())throw new Error('存储目录不能包含链接')
    total+=stat.isDirectory()?directoryBytes(file):stat.size
  }
  return total
}

export function projectUsage(root) {
  const file=join(root,'data','app-state.json')
  const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{}
  return {...stateCapacity(state),storageMB:Math.ceil(directoryBytes(root)/1048576)}
}
