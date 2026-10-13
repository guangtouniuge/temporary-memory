import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lookupProvider} from './provider-lookup.mjs'
test('research deduplicates requests, persists cache and bounds project cost',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'provider-lookup-'));let calls=0
  const lookup=async input=>{calls++;return {company:input.company,status:'ready',facts:[{text:'业务'}]}}
  try {
    await Promise.all([lookupProvider(dir,{company:'甲'},lookup),lookupProvider(dir,{company:'甲'},lookup)])
    await lookupProvider(dir,{company:'甲'},lookup)
    assert.equal(calls,1)
    for(let i=0;i<39;i++)await lookupProvider(dir,{company:String(i)},lookup)
    await assert.rejects(lookupProvider(dir,{company:'超额'},lookup),{status:429})
    assert.equal(calls,40)
    await lookupProvider(dir,{company:'甲'},lookup)
    assert.equal(calls,40)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
