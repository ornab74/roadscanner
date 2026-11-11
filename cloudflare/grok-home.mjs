import {originalGrokPrompt} from './grok-home-prompt.mjs';
import {strictJSON,randomToken} from './security.mjs';
import {boundedBody} from './internal-auth.mjs';
const colors={'Clear':'#22d3a6','Light Caution':'#b3f442','Caution':'#ffb300','Elevated':'#ff8f1f','Critical':'#ff3b1f'};
export async function assessWithGrok(secret,model,fetcher=fetch){
 if(typeof secret!=='string'||!secret.trim())throw new Error('Grok key is not configured');
 if(typeof model!=='string'||!/^grok-[A-Za-z0-9._-]{1,100}$/.test(model))throw new Error('Invalid Grok model');
 // Synthetic simulation seed, not quantum measurements or physical sensing.
 const seed=randomToken();
 const prompt=originalGrokPrompt.replace('{{TIMESTAMP}}',new Date().toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC')).replace('{{VISITOR}}','anonymous-simulation').replace('{{QUANTUM_STATE}}','synthetic simulation seed '+seed);
 const response=await fetcher('https://api.x.ai/v1/chat/completions',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},signal:AbortSignal.timeout(60000),body:JSON.stringify({model,messages:[{role:'system',content:'You are Grok, a maximally truth-seeking AI built by xAI. Always respond in strict JSON when requested. The following guess-mode prompt describes a fictional simulation. Its synthetic seed is not physical quantum data. No actual user location, sensors or live observations are available; do not represent the generated scene as measured reality.'},{role:'user',content:prompt}],max_tokens:300,response_format:{type:'json_object'},temperature:.7})});
 if(!response.ok){let code='unknown';try{const e=JSON.parse(new TextDecoder().decode(await boundedBody(response.body,16384))).error;if(typeof e?.code==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(e.code))code=e.code;}catch{}throw new Error('Grok request failed: HTTP '+response.status+' ('+code+')');}
 const body=strictJSON(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(response.body,65536)));
 const choice=body.choices?.[0];if(choice?.finish_reason!=='stop')throw new Error('Grok response did not complete');
 const result=strictJSON(choice.message?.content??'');
 if(!result||Object.keys(result).sort().join(',')!=='blurb,color,confidence,harm_ratio,label,reasons'||typeof result.harm_ratio!=='number'||result.harm_ratio<0||result.harm_ratio>1||typeof result.confidence!=='number'||result.confidence<0||result.confidence>1||typeof result.blurb!=='string'||!result.blurb.trim()||result.blurb.length>120||!Array.isArray(result.reasons)||result.reasons.length<2||result.reasons.length>5||result.reasons.some(r=>typeof r!=='string'||!r.trim()||r.length>80))throw new Error('Invalid Grok reading schema');
 const ratio=result.harm_ratio,label=ratio<=.2?'Clear':ratio<=.4?'Light Caution':ratio<=.6?'Caution':ratio<=.8?'Elevated':'Critical';
 if(result.label!==label||result.color!==colors[label])throw new Error('Grok label/color does not match severity rubric');
 return {...result,summary:result.blurb,harm_level:ratio<=.4?'Low':ratio<=.8?'Medium':'High',provider:'grok',model_requested:model,model_used:typeof body.model==='string'?body.model:model};
}
