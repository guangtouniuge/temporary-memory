// This runs only in a disposable workspace or explicitly isolated restore directory.
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {randomUUID,randomBytes,scryptSync} from 'node:crypto'
import {spawn} from 'node:child_process'
import {createServer} from 'node:net'
import {createMemberLedger} from '../server/member-ledger.mjs'

const code=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const temporary=!process.env.GEO_ACCEPTANCE_ROOT
const workspace=process.env.GEO_ACCEPTANCE_ROOT||mkdtempSync(join(tmpdir(),'geo-business-'))
if(!temporary&&!workspace.replaceAll('\\','/').includes('/restore-business/'))throw Error('Refusing non-isolated acceptance workspace')
const authDir=process.env.GEO_ACCEPTANCE_AUTH||join(workspace,'auth')
if(!temporary&&!authDir.replaceAll('\\','/').includes('/restore-business/'))throw Error('Refusing live auth directory')
mkdirSync(authDir,{recursive:true})
const accountFile=join(authDir,'accounts.json')
const db=existsSync(accountFile)?JSON.parse(readFileSync(accountFile,'utf8')):{version:1,users:[],sessions:[]}
const restoredUsers=db.users.length
const tag=randomUUID().slice(0,8),password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex')
const rootName=`accept-${tag}`
db.users.push({id:randomUUID(),username:rootName,displayName:'Acceptance root',passwordHash:`${salt}:${scryptSync(password,salt,64).toString('hex')}`,role:'super_admin',status:'active',projectId:'platform',workspaceId:'platform',agentId:''})
writeFileSync(accountFile,JSON.stringify(db),{mode:0o600})
const jobs=join(workspace,'acceptance-jobs')
mkdirSync(jobs,{recursive:true})
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const child=spawn(process.execPath,[join(code,'server/geo-api-server.mjs')],{cwd:workspace,env:{PATH:process.env.PATH,HOME:workspace,USERPROFILE:workspace,SYSTEMROOT:process.env.SYSTEMROOT,GEO_API_PORT:String(port),GEO_AUTH_DATA_DIR:authDir,GEO_JOB_DIR:jobs,GEO_ALLOW_HEADER_IDENTITY:'false',GEO_ALLOW_UNREGISTERED_AUTH_PROJECT:'false',MODEL_API_KEY:'',QWEN_API_KEY:'',DASHSCOPE_API_KEY:'',PROVIDER_SEARCH_API_KEY:'',XIAOQINGWA_KEY:''},stdio:['ignore','pipe','pipe']})
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b)
const call=async(path,body,cookie='')=>{
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)})
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
const login=async(username)=>{const r=await call('/api/auth/login',{username,password});assert.equal(r.status,200);return r.cookie}
const good=async(path,body,cookie)=>{const r=await call(path,body,cookie);assert.ok(r.status>=200&&r.status<300,`${path}: ${JSON.stringify(r.data)}`);return r.data}
try {
  for(let i=0;i<100&&!output.includes('GEO API server running');i++){if(child.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,100))}
  assert.ok(output.includes('GEO API server running'),output)
  const root=await login(rootName)
  assert.equal((await call('/api/admin/members')).status,401)
  const wholesale=(await good('/api/admin/members/packages/save',{name:'Acceptance wholesale',quantities:{articles:20,projects:4,keywords:40,storageMB:100},days:30,priceCents:10000,status:'active'},root)).package
  const retail=(await good('/api/admin/members/packages/save',{name:'Acceptance retail',quantities:{articles:5,projects:1,keywords:5,storageMB:10},days:30,priceCents:3000,status:'active'},root)).package
  const agents=[],clients=[]
  for(let i=0;i<2;i++) {
    const username=`agent-${tag}-${i}`,agent=(await good('/api/admin/users',{username,password,role:'agent'},root)).user
    const cookie=await login(username);agents.push({agent,cookie})
    await good('/api/admin/members/packages/apply',{userId:agent.id,packageId:wholesale.id,revision:wholesale.revision,requestId:`wholesale-${tag}-${i}`,saleCents:10000,reason:'isolated acceptance'},root)
    for(let j=0;j<2;j++) {
      const name=`client-${tag}-${i}-${j}`
      const u=(await good('/api/admin/users',{username:name,password,role:'project_admin',packageId:retail.id,packageRevision:retail.revision,requestId:`retail-${tag}-${i}-${j}`,saleCents:5000},cookie)).user
      const session=await login(name),brand=`Acceptance brand ${i}-${j}`
      await good('/api/state',{key:'geo.projectRows',value:[{name:brand,coreKeyword:'acceptance',industry:'test'}]},session)
      await good('/api/state',{key:'geo.keywordRows',value:[[brand,'acceptance']]},session)
      clients.push({u,session,brand,agent:i})
    }
  }
  for(let i=0;i<2;i++) {
    const rows=(await good('/api/admin/members',undefined,agents[i].cookie)).members
    assert.equal(rows.length,3)
    const foreign=clients.find(c=>c.agent!==i)
    assert.equal((await call('/api/admin/members/history',{userId:foreign.u.id},agents[i].cookie)).status,403)
    assert.equal((await call('/api/admin/members/reconcile',{userId:foreign.u.id},agents[i].cookie)).status,403)
  }
  const client=clients[0],agent=agents[0]
  const quotas=async()=> (await good('/api/admin/members',undefined,agent.cookie)).members.find(u=>u.id===client.u.id).resources.articles
  assert.equal((await quotas()).available,5)
  const failed=await call('/api/articles/generate',{project:{name:client.brand},plan:{question:'Acceptance test'},requestId:`failure-${tag}`},client.session)
  assert.equal(failed.status,503,JSON.stringify(failed.data))
  assert.equal((await quotas()).available,5)
  assert.equal((await quotas()).held,0)
  const history=(await good('/api/admin/members/history',{userId:client.u.id},agent.cookie)).entries
  assert.ok(history.some(e=>e.reason==='文章失败退回'))
  const batch={project:{name:client.brand},plan:{question:'Batch acceptance'},batchId:`batch-${tag}`}
  const first=(await good('/api/jobs/start',batch,client.session)).job
  const second=(await good('/api/jobs/start',batch,client.session)).job
  assert.equal(first.id,second.id)
  assert.equal((await call('/api/jobs/start',{...batch,plan:{question:'changed'}},client.session)).status,409)
  for(let i=0;i<100;i++){const j=(await good(`/api/jobs/status?id=${first.id}`,undefined,client.session)).job;if(j.status==='failed')break;await new Promise(r=>setTimeout(r,100))}
  assert.equal((await quotas()).held,0)

  // Simulate a completed model result whose final task checkpoint was interrupted.
  const id=`JOB-accept-${tag}`,ledger=createMemberLedger(join(authDir,'member-ledger.sqlite'))
  try {
    const hold=ledger.reserveArticle(client.u.id,`${client.u.id}:${id}:0`)
    ledger.settleArticle(hold,true,{ok:true,articles:[{id:`article-${tag}`,title:'隔离恢复验收稿',body:'仅供恢复验收，不用于发布。',words:'14',project:client.brand}]})
  } finally {ledger.close()}
  const release=JSON.parse(readFileSync(join(code,'server/writing-release.json'),'utf8'))
  const plan={title:'隔离恢复验收稿',editorialBrief:{purpose:'restore-test'}}
  const scope={projectId:client.u.projectId,agentId:client.u.agentId,ownerUserId:client.u.id,currentUser:{userId:client.u.id,role:'project_admin',projectId:client.u.projectId,agentId:client.u.agentId}}
  writeFileSync(join(jobs,`${id}.json`),JSON.stringify({version:release.version,plans:[plan],body:{project:{name:client.brand},plans:[plan],taskName:'恢复验收',batchId:'restore-test'},job:{id,projectId:client.u.projectId,legacyScope:false,executionScope:scope,storageScope:`${client.u.projectId}:${client.brand}`,status:'failed',total:1,completed:0,passed:0,failed:0,articles:[],logs:[],error:'simulated interrupted checkpoint'}}))
  assert.equal((await call('/api/jobs/resume',{id},clients[2].session)).status,404)
  await good('/api/jobs/resume',{id},client.session)
  let restored
  for(let i=0;i<100;i++){restored=(await good(`/api/jobs/status?id=${id}`,undefined,client.session)).job;if(['done','failed'].includes(restored.status))break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(restored.status,'done',JSON.stringify(restored))
  assert.equal(restored.articles[0].id,`article-${tag}`)
  assert.equal((await quotas()).available,4);assert.equal((await quotas()).used,1)
  assert.equal((await good('/api/state?key=geo.articleRows',undefined,client.session)).value[0].id,`article-${tag}`)
  const orders=(await good('/api/admin/members/commerce',undefined,agent.cookie)).orders
  assert.equal(orders.length,2)
  const entry={id:orders[0].id,revision:0,receivedCents:5000,refundedCents:500,costCents:2000,reason:'isolated receipt test'}
  await good('/api/admin/members/commerce/save',entry,agent.cookie)
  assert.equal((await call('/api/admin/members/commerce/save',entry,agent.cookie)).status,409)
  assert.equal((await call('/api/admin/members/commerce/save',{...entry,revision:1},agents[1].cookie)).status,403)
  console.log(JSON.stringify({status:'passed',restoredUsers,agents:2,clients:4,failedGenerationRefund:true,completedArticleRecovery:true,duplicateCharge:false,scopeIsolation:true,accounting:true,externalModelCalls:0}))
} finally {
  child.kill()
  if(child.exitCode===null)await new Promise(r=>child.once('exit',r))
  if(temporary)rmSync(workspace,{recursive:true,force:true})
}
