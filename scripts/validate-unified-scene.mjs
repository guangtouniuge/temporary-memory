import fs from 'node:fs'
import { prepareAgentBatch, runArticleAgents } from '../server/agents-workflow.mjs'
import { topicHistory } from '../server/batch-editor.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
import { auditArticles } from './audit-article-repetition.mjs'

const record=JSON.parse(fs.readFileSync(0,'utf8'))
const history=topicHistory(fs.existsSync('.tmp/article-audit-20260915.json') ? JSON.parse(fs.readFileSync('.tmp/article-audit-20260915.json','utf8')) : record.job.articles, record.body.project)
const results=[]
const prior=process.env.VALIDATE_REUSE_PLANS==='1' ? JSON.parse(fs.readFileSync('.tmp/unified-scene-validation.json','utf8')) : []
const options={model:process.env.MODEL_NAME,date:'2026年9月',log:stage=>console.error(stage.split(':')[0]),
  callModel:async(messages,temperature,format)=>{
    const r=await fetch(process.env.MODEL_BASE_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MODEL_API_KEY}`},body:JSON.stringify({...modelRequestOptions(process.env,temperature,format),messages}),signal:AbortSignal.timeout(180000)})
    if(!r.ok)return {ok:false,error:`Provider HTTP ${r.status}`}
    const raw=await r.json(),failure=modelResponseFailure(raw)
    return failure?{ok:false,error:failure.error}:{ok:true,content:raw.choices[0].message.content,raw}
  }}
for(const mode of process.env.VALIDATE_MODE ? [process.env.VALIDATE_MODE] : ['手动场景','AI场景']){
  const packet={...record.body.packet,writingSceneMode:mode,sceneCity:mode==='手动场景'?'西安':record.body.project.city,sceneIndustry:mode==='手动场景'?'制造业':'',businessScenes:[],industryScene:undefined}
  const payload={...record.body,packet,task:{...record.body.task,writingSceneMode:mode,writingDepth:'deep'}}
  const draft={writingSceneMode:mode,sceneCity:packet.sceneCity,sceneIndustry:packet.sceneIndustry,articleType:mode==='手动场景'?'选型指南':'深度测评',writingDepth:'deep'}
  const cached=prior.find(a=>a.mode===mode)
  const plans=cached ? [{...draft,sceneIndustry:cached.scene,industryScene:cached.scene,editorialBrief:cached.editorialBrief}] : await prepareAgentBatch(payload,[draft],history,options)
  const checkpoint=`.tmp/unified-scene-checkpoint-${mode==='AI场景'?'ai':'manual'}.json`
  const state=fs.existsSync(checkpoint)?JSON.parse(fs.readFileSync(checkpoint,'utf8')):{stages:{}}
  const article=await runArticleAgents({...payload,plan:plans[0],previousArticles:history},{...options,articleId:`validation-${mode}`,state,save:value=>fs.writeFileSync(checkpoint,JSON.stringify(value))})
  results.push({...article,mode,scene:plans[0].editorialBrief.customerIndustry})
  history.unshift(...topicHistory([{...article,project:record.body.project.name}],record.body.project))
  fs.writeFileSync('.tmp/unified-scene-validation.json',JSON.stringify(results,null,2))
  console.log(JSON.stringify({mode,scene:results.at(-1).scene,title:article.title,chars:article.visibleCharacters,opening:article.body.slice(0,400),headings:article.body.match(/^#{2,3} .+$/gm)},null,2))
}
console.log(JSON.stringify(auditArticles(results),null,2))
