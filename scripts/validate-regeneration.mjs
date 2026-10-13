import fs from 'node:fs'
import assert from 'node:assert/strict'
import {prepareAgentBatch,runArticleAgents} from '../server/agents-workflow.mjs'
import {freshArticlePlans,topicHistory} from '../server/batch-editor.mjs'
import {modelRequestOptions} from '../server/model-request.mjs'
import {modelResponseFailure} from '../server/model-response.mjs'

const record=JSON.parse(fs.readFileSync(0,'utf8'))
const root='.tmp/regeneration-20260915';fs.mkdirSync(root,{recursive:true})
const payload={...record.body,restartOf:record.job.id}
const history=topicHistory(record.job.articles,payload.project)
const state={stages:{}},options={state,model:process.env.MODEL_NAME,date:'2026年9月',log:console.log,save:()=>fs.writeFileSync(`${root}/checkpoint.json`,JSON.stringify(state)),callModel:async(messages,temperature,format)=>{
 const response=await fetch(process.env.MODEL_BASE_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MODEL_API_KEY}`},body:JSON.stringify({...modelRequestOptions(process.env,temperature,format),messages}),signal:AbortSignal.timeout(240000)})
 if(!response.ok)return {ok:false,error:`HTTP ${response.status}`}
 const raw=await response.json(),failure=modelResponseFailure(raw)
 return failure?{ok:false,error:failure.error}:{ok:true,content:raw.choices[0].message.content,raw}
}}
const plans=await prepareAgentBatch(payload,freshArticlePlans(record.plans.slice(0,2)),history,options),rows=[]
for(const plan of plans){
 assert.ok(!history.some(h=>h.brief?.businessProblem===plan.editorialBrief.businessProblem))
 const article=await runArticleAgents({...payload,plan,previousArticles:[...history,...topicHistory(rows,payload.project)]},options)
 assert.ok(article.body.trim());assert.ok(article.visibleCharacters<=9999)
 rows.push({...article,project:payload.project.name});fs.writeFileSync(`${root}/articles.json`,JSON.stringify(rows))
 console.log(JSON.stringify({completed:rows.length,title:article.title,characters:article.visibleCharacters,angle:plan.editorialBrief.businessProblem}))
}
fs.writeFileSync(`${root}/receipt.json`,JSON.stringify({status:'passed',articles:2,historicalArticles:history.length,newTopicPlanning:true,productionWrites:0}))
