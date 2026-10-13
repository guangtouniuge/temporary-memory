import fs from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {createMemberLedger} from '../server/member-ledger.mjs'
import {articleSceneImages} from '../server/volcengine-images.mjs'

const root=fs.mkdtempSync(join(tmpdir(),'geo-images-billing-')),ledger=createMemberLedger(join(root,'ledger.sqlite'))
const actor={id:'root',role:'super_admin'},client={id:'client',role:'project_admin'},saved=new Map(),state={}
const timer=setInterval(()=>ledger.renewLeases('isolated'),30000)
try {
  for(const [resource,delta] of [['money',200],['articles',1]])ledger.handle({actor,users:[actor,client],path:'/api/admin/members/adjust',method:'POST',body:{userId:client.id,resource,delta,expectedAvailable:0,requestId:`opening-${resource}`,reason:'isolated validation'}})
  ledger.reserveArticle(client.id,'isolated:0',{instance:'isolated'})
  const opts={project:{name:'隔离配图验收',industry:'企业管理咨询'},title:'企业服务',body:'企业管理咨询服务场景',scene:'团队办公',articleId:'isolated:0',state,
    saveState:()=>fs.writeFileSync(join(root,'state.json'),JSON.stringify(state)),findSaved:key=>saved.get(key),saveImage:(key,file)=>{
      const path=join(root,`${key}.${file.ext}`);fs.writeFileSync(path,file.data);const row={path};saved.set(key,row);return row
    },billing:{reserve:()=>ledger.reserveImages(client.id,'isolated:0','isolated'),settle:(id,ok)=>ledger.settleImages(id,ok,'isolated')},log:console.log}
  const images=await articleSceneImages(opts)
  assert.equal(images.length,2);assert.equal(ledger.summary(client.id).money.used,200);assert.equal(ledger.summary(client.id).money.available,0)
  await articleSceneImages({...opts,generate:()=>{throw new Error('duplicate provider call')}})
  assert.equal(ledger.summary(client.id).money.used,200)
  console.log(JSON.stringify({status:'passed',realImages:2,chargedCents:200,cachedReplay:true,productionWrites:0}))
}finally{clearInterval(timer);ledger.close();fs.rmSync(root,{recursive:true,force:true})}
