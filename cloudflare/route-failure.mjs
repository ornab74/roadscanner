// Diagnostics contain fixed codes only: never provider text, images or addresses.
export function routeFailure(error,operationID){
 const stages=['imagery','visual_model','road_alignment','mapped_review'];
 const stage=stages.includes(error?.route_stage)?error.route_stage:'report_storage';
 const message=String(error?.message??'');let reason='unexpected_failure';
 if(error?.name==='TimeoutError'||error?.name==='AbortError')reason='timeout';
 else if(message==='Report too large')reason='report_size_limit';
 else if(message==='Route model did not complete'||message==='Mapped directions did not complete')reason=error?.incomplete_reason==='max_output_tokens'?'output_limit':'model_incomplete';
 else if(/^(Invalid JSON$|Duplicate JSON field$|JSON nesting exceeds limit$|Non-finite number$|Invalid visual route|Disconnected visual route|Empty visual route|Visual route endpoints|Incomplete route|Invalid mapped|Mapped direction section count|Rejected mapped candidate)/.test(message)||error instanceof SyntaxError)reason='invalid_output';
 else if(/^Route model failed: HTTP |^Mapped directions provider unavailable HTTP /.test(message))reason='provider_http_error';
 else if(message==='Route imagery capture unavailable')reason='imagery_unavailable';
 return {operation_id:operationID,stage,reason};
}
