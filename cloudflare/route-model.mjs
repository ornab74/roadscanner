import {strictJSON} from './security.mjs';
import {boundedBody} from './internal-auth.mjs';

// One repair attempt for output-format failures only. Reuse the original evidence;
// never substitute a fabricated route or bypass the caller's validation.
export async function routeModelJSON(env,body,fetcher,{maxBytes,incompleteMessage,httpMessage,validate}){
 let repair=false;
 for(let attempt=0;attempt<2;attempt++){
  const request=repair?{...body,max_output_tokens:body.max_output_tokens*2,instructions:body.instructions+' Output repair: the previous response was truncated or failed output validation. Return a concise complete object satisfying the schema. Respect all original endpoint and continuity constraints. If the evidence is insufficient, return needs_context. Keep summaries, instructions, rationales and limitations brief.'}:body;
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(120000),body:JSON.stringify(request)});
  if(!response.ok)throw Error(httpMessage+response.status);
  try{
   const result=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(response.body,maxBytes)));
   if(result.status!=='completed')throw Object.assign(new Error(incompleteMessage),{incomplete_reason:result.incomplete_details?.reason});
   const text=(result.output??[]).flatMap(o=>o.content??[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
   return {result:validate(strictJSON(text)),model:result.model};
  }catch(error){
   const invalid=error instanceof SyntaxError||/^(Invalid JSON$|Duplicate JSON field$|JSON nesting exceeds limit$|Non-finite number$|Invalid visual route|Disconnected visual route|Empty visual route|Visual route endpoints|Incomplete route|Invalid mapped|Mapped direction section count|Rejected mapped candidate)/.test(error?.message??'');
   if(attempt||!(invalid||error?.incomplete_reason==='max_output_tokens'))throw error;
   repair=true;
  }
 }
}
