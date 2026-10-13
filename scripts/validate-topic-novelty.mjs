// Replans two independent batches in memory, using a read-only project snapshot.
import { planBatchTopics, freshArticlePlans } from '../server/batch-editor.mjs'
import { modelRequestOptions } from '../server/model-request.mjs'
import { modelResponseFailure } from '../server/model-response.mjs'
let source=''
for await(const chunk of process.stdin) source+=chunk
const {record,history}=JSON.parse(source)
const previous=[...history]
async function callModel(messages,temperature,format) {
  const response=await fetch(process.env.MODEL_BASE_URL||process.env.QWEN_BASE_URL,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.MODEL_API_KEY||process.env.QWEN_API_KEY}`},
    body:JSON.stringify({...modelRequestOptions(process.env,temperature,format),messages}),signal:AbortSignal.timeout(180000),
  })
  if(!response.ok)return {ok:false,error:`Provider HTTP ${response.status}`}
  const raw=await response.json(),failure=modelResponseFailure(raw)
  return failure?{ok:false,error:failure.error}:{ok:true,content:raw.choices[0].message.content,raw}
}
for(let round=1;round<=2;round++) {
  const plans=await planBatchTopics(record.body,freshArticlePlans(record.plans.slice(0,2)),previous,callModel,message=>console.error(message))
  console.log(JSON.stringify({round,historyCount:previous.length,topics:plans.map(p=>({angle:p.editorialBrief.titleBrief?.choiceAngle,contribution:p.editorialBrief.articleContribution,difference:p.editorialBrief.topicDifference}))},null,2))
  previous.unshift(...plans.map(p=>({title:'前一批已分配选题',brief:p.editorialBrief})))
}
