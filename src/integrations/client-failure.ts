/** Why a client's call failed. A Work stays on its client: the reason decides whether it waits, retries or stops. */
export type ClientFailureReason='auth_expired'|'quota_exhausted'|'rate_limited'|'context_exhausted'|'model_unsupported'|'schema_invalid'|'provider_unavailable'|'invalid_output';
/** The Work, run and stage a call belongs to, from validated IDs in its input. */
export function callProvenance(input:unknown){
  const value=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const id=(name:string)=>typeof value[name]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(value[name])?value[name] as string:null;
  return {work_id:id('work_id'),run_id:id('run_id'),stage_id:id('stage_id')};
}
export function classifyClientFailure(value:unknown):ClientFailureReason{
  if(isInvalidClientOutput(value))return 'invalid_output';
  const message=typeof value==='string'?value:value instanceof Error?value.message:'';
  // A malformed app-owned response schema is not login expiry, quota pressure,
  // or a provider outage. Trying another account cannot repair the request.
  if(message==='CLIENT_OUTPUT_SCHEMA_UNSUPPORTED'||message==='CLIENT_SCHEMA_INVALID'||/\bInvalid schema for response_format\b/iu.test(message))return 'schema_invalid';
  if(message==='CLIENT_MODEL_UNSUPPORTED'||/(?:\bmodel\b[^\r\n]{0,120}\b(?:not supported|unsupported|not found|does not exist)\b|\b(?:unsupported|unknown)\s+model\b)/iu.test(message))return 'model_unsupported';
  // A passing error ("try again", overloaded, 5xx) is an outage to wait out, even when it names a login or a token.
  if(/\b(?:try again|temporarily|overloaded)\b|\b(?:500|502|503|504|529)\b/iu.test(message))return 'provider_unavailable';
  if(/(?:auth(?:entication)?|login|session|credential|token).{0,40}(?:expired|invalid|required|failed)|(?:expired|invalid).{0,40}(?:auth|login|session|credential|token)|\b(?:401|403|unauthorized|signed.out)\b/iu.test(message))return 'auth_expired';
  if(/(?:quota|credit|balance|billing|insufficient|usage limit|weekly limit|monthly limit)/iu.test(message)||/\b402\b/u.test(message))return 'quota_exhausted';
  if(/(?:rate.limit|too many requests|retry.after|\b429\b)/iu.test(message))return 'rate_limited';
  if(/(?:context.window|context.length|context.exhausted|maximum context)/iu.test(message))return 'context_exhausted';
  return 'provider_unavailable';
}
/**
 * The words a failed CLI call gives about its failure: stderr, plain output lines, and only the error fields of its
 * JSON. Claude's JSON result always carries fields such as `fallback_credit` and `total_cost_usd`, and Codex lines
 * carry the agent's own text; read whole, any failure looked like billing (live 2026-10-08).
 */
export function cliFailureText(stdout:string,stderr:string){
  const words:string[]=[stderr];
  const take=(value:unknown)=>{if(typeof value==='string')words.push(value);else if(value&&typeof value==='object'){const v=value as Record<string,unknown>;if(typeof v.message==='string')words.push(v.message);}};
  for(const line of stdout.split(/\r?\n/u)){
    const text=line.trim();if(!text)continue;
    let value:unknown;try{value=JSON.parse(text);}catch{words.push(text);continue;}
    if(!value||typeof value!=='object'||Array.isArray(value))continue;
    const v=value as Record<string,unknown>,item=v.item&&typeof v.item==='object'?v.item as Record<string,unknown>:null;
    if(v.is_error===true||/error|failed/u.test(String(v.type??''))||/^error/u.test(String(v.subtype??''))){
      take(v.result);take(v.error);take(v.message);if(Array.isArray(v.errors))v.errors.forEach(take);
      if(typeof v.api_error_status==='number')words.push(`HTTP ${v.api_error_status}`);
    }
    if(item&&/error/u.test(String(item.type??'')))take(item.message);
  }
  return words.filter(Boolean).join('\n');
}
export function isInvalidClientOutput(value:unknown){
  return value instanceof SyntaxError||value instanceof Error&&['CLIENT_STRUCTURED_OUTPUT_INVALID','MCP_SAMPLING_INVALID','MODEL_PROVIDER_RESPONSE_INVALID'].includes(value.message);
}
export function isNonRetryableClientFailure(value:unknown){
  return isInvalidClientOutput(value)||value instanceof Error&&['CLIENT_OUTPUT_SCHEMA_UNSUPPORTED','CLIENT_SCHEMA_INVALID','CLIENT_CONNECTION_CHANGED','CLIENT_SESSION_BUSY','CLIENT_SESSION_UNSAFE_STORAGE','CLIENT_SESSION_PERSIST_FAILED'].includes(value.message);
}
