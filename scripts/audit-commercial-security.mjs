// Isolated reproduction only: no production users, provider keys or paid requests.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'
const directory=mkdtempSync(join(tmpdir(),'geo-security-audit-'))
const listener=createServer()
await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port
await new Promise(r=>listener.close(r))
const child=spawn(process.execPath,[resolve('server/geo-api-server.mjs')],{cwd:directory,env:{...process.env,GEO_JOB_DIR:join(directory,'jobs'),GEO_API_PORT:String(port),GEO_AUTH_DATA_DIR:join(directory,'auth'),GEO_ADMIN_USERNAME:'auditadmin',GEO_ADMIN_PASSWORD:'Audit-only-password-123',GEO_ALLOW_HEADER_IDENTITY:'false',GEO_ALLOW_UNREGISTERED_AUTH_PROJECT:'false',MODEL_API_KEY:'',QWEN_API_KEY:'',PROVIDER_SEARCH_API_KEY:'',XIAOQINGWA_KEY:''},stdio:['ignore','pipe','pipe']})
try {
 await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('exit '+c)))})
 const call=async(path,body,cookie='')=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 const login=async(username)=>call('/api/auth/login',{username,password:'Audit-only-password-123'})
 const root=(await login('auditadmin')).cookie
 const add=async(username,role,cookie,extra={})=>call('/api/admin/users',{username,role,password:'Audit-only-password-123',...extra},cookie)
 const victim=(await add('victim','project_admin',root)).data.user
 const victimSession=(await login('victim')).cookie
 await call('/api/admin/members/adjust',{userId:victim.id,resource:'projects',delta:1,expectedAvailable:0,requestId:'victim-project',reason:'test fixture'},root)
 await call('/api/admin/members/adjust',{userId:victim.id,resource:'storageMB',delta:1,expectedAvailable:0,requestId:'victim-storage',reason:'test fixture'},root)
 await call('/api/state',{key:'geo.projectRows',value:[{name:'AUDIT_PRIVATE_SENTINEL',coreKeyword:'audit'}]},victimSession)
 await call('/api/admin/members/adjust',{userId:victim.id,resource:'keywords',delta:21,expectedAvailable:0,requestId:'victim-keywords',reason:'test fixture'},root)
 const distilled=await call('/api/keywords/distill',{brand:'AUDIT_PRIVATE_SENTINEL',coreKeyword:'audit',count:200},victimSession)
 assert.equal(distilled.status,200)
 assert.equal(distilled.data.terms.length,20)
 const repeated=await call('/api/keywords/distill',{brand:'AUDIT_PRIVATE_SENTINEL',coreKeyword:'audit',count:200},victimSession)
 assert.equal(repeated.status,200)
 assert.deepEqual(repeated.data.terms,[])
 assert.deepEqual(repeated.data.questionRows,distilled.data.questionRows)
 console.log(JSON.stringify({case:'repeated-distillation-with-exhausted-quota',idempotent:true}))
 const agent=(await add('agent','agent',root)).data.user
 const a=(await login('agent')).cookie
 const forged=await add('foreignoperator','project_operator',a,{projectId:victim.projectId})
 assert.equal(forged.status,403)
 console.log(JSON.stringify({case:'cross-project-operator-creation',blocked:true}))
 const duplicate=await add('duplicateagent','agent',root,{agentId:agent.agentId})
 assert.equal(duplicate.status,409)
 assert.equal((await add('missingquota','project_admin',a)).status,400)
 const own=(await add('ownedclient','project_admin',a,{initialAllocation:{days:30,quantities:{articles:0,keywords:0,storageMB:0,projects:0,points:0,money:0,publications:0,publishingAccounts:0}},requestId:'audit-opening',saleCents:0})).data.user
 console.log(JSON.stringify({case:'duplicate-agent-scope',blocked:true}))
 const wallets=await call('/api/admin/members',undefined,a)
 console.log(JSON.stringify({case:'new-unfunded-client',created:true,articlesManaged:wallets.data.members.find(u=>u.id===own.id).resources.articles.managed}))
 const ownSession=(await login('ownedclient')).cookie
 await call('/api/admin/members/adjust',{userId:own.id,resource:'projects',delta:1,expectedAvailable:0,requestId:'owned-project',reason:'test fixture'},root)
 await call('/api/admin/members/adjust',{userId:own.id,resource:'storageMB',delta:1,expectedAvailable:0,requestId:'owned-storage',reason:'test fixture'},root)
 await call('/api/state',{key:'geo.projectRows',value:[{name:'own',coreKeyword:'audit'}]},ownSession)
 const generation=await call('/api/articles/generate',{project:{name:'own'}},ownSession)
 assert.equal(generation.status,409)
 console.log(JSON.stringify({case:'unfunded-generation',blocked:true}))
 const changed=await call('/api/admin/users/update',{id:own.id,role:'project_operator'},a)
 console.log(JSON.stringify({case:'owner-role-downgrade',status:changed.status,newRole:changed.data.user?.role}))
 assert.equal(changed.status,403)
 const fake=await call('/api/state',{key:'geo.distributionTasks',value:[{id:'fake',status:'已发布',price:'0',url:'https://example.invalid'}]},victimSession)
 console.log(JSON.stringify({case:'client-overwrites-publication-records',status:fake.status}))
 assert.equal(fake.status,403)
 assert.equal((await call('/api/admin/members/packages',undefined,victimSession)).status,403)
 for(const route of ['/api/providers/research','/api/keywords/expand'])assert.equal((await call(route,{},victimSession)).status,403)
 const takeover=await add('takeover','project_admin',a,{projectId:victim.projectId})
 assert.equal(takeover.status,409)
 assert.equal((await call('/api/state?key=geo.projectRows',undefined,victimSession)).status,200)
 console.log(JSON.stringify({case:'private-pricing-paid-tools-and-project-takeover',blocked:true}))
} finally {child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));rmSync(directory,{recursive:true,force:true})}
