import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {deleteSocialAccount,socialAccounts} from './social-accounts.mjs'
test('server accounts persist, deduplicate and remain isolated without trusting login flags',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'geo-social-accounts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const projects=[{name:'A'},{name:'B'}]
  const input={platform:'toutiao',name:'账号',status:'authenticated',password:'not-stored'}
  const a=socialAccounts(root,'A',projects,input)
  assert.equal(a.status,'unverified');assert.equal(a.password,undefined)
  assert.equal(socialAccounts(root,'A',projects,input).id,a.id)
  assert.equal(socialAccounts(root,'A',projects).length,1)
  assert.deepEqual(socialAccounts(root,'B',projects),[])
  assert.deepEqual(socialAccounts(path.join(root,'other'),'A',projects),[])
  assert.throws(()=>socialAccounts(root,'foreign',projects,input),/不属于/)
  assert.throws(()=>socialAccounts(root,'A',projects,{platform:'arbitrary',name:'x'}),/不支持/)
})

test('client linked accounts keep same platform and name separate',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'geo-social-accounts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const projects=[{name:'A'}]
  const one=socialAccounts(root,'A',projects,{platform:'toutiao',name:'曝光率GEO',clientId:'local-one'})
  const two=socialAccounts(root,'A',projects,{platform:'toutiao',name:'曝光率GEO',clientId:'local-two'})
  assert.notEqual(one.id,two.id)
  assert.equal(socialAccounts(root,'A',projects,{platform:'toutiao',name:'曝光率GEO',clientId:'local-one'}).id,one.id)
  assert.equal(socialAccounts(root,'A',projects).length,2)
  deleteSocialAccount(root,'A',projects,{id:one.id})
  assert.deepEqual(socialAccounts(root,'A',projects).map(row=>row.id),[two.id])
})
