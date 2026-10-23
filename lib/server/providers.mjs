import { AppError, MAX_CODE_CHARS, MAX_CODE_BYTES } from './common.mjs';
import { RESULT_SCHEMA } from './prompts.mjs';

export function providerPayload(provider,settings,prompts) {
  if(provider.id==='gpt') return {
    model:provider.model,store:false,max_output_tokens:settings.maxOutputTokens,reasoning:{effort:'low'},
    input:[{role:'system',content:[{type:'input_text',text:prompts.system}]},{role:'user',content:[{type:'input_text',text:prompts.user}]}],
    text:{format:{type:'json_schema',name:'hyfl_webapp_result',strict:true,schema:RESULT_SCHEMA}},
  };
  return {model:provider.model,max_tokens:settings.maxOutputTokens,system:prompts.system,
    messages:[{role:'user',content:prompts.user}],
    tools:[{name:'submit_webapp',description:'수업용 웹앱 전체 코드와 변경 설명을 반환합니다.',input_schema:RESULT_SCHEMA}],
    tool_choice:{type:'tool',name:'submit_webapp'},
  };
}
export function normalizeResult(value,mode) {
  if(!value||typeof value!=='object'||typeof value.summary!=='string'||typeof value.code!=='string'||!Array.isArray(value.checks)||!Array.isArray(value.warnings)) throw new AppError(502,'INVALID_AI_RESULT','AI 응답 형식이 올바르지 않아 코드를 적용하지 않았습니다. 다시 요청해주세요.');
  if(value.code.length>MAX_CODE_CHARS||Buffer.byteLength(value.code)>MAX_CODE_BYTES||value.summary.length>12000||value.checks.length>30||value.warnings.length>30||[...value.checks,...value.warnings].some(v=>typeof v!=='string'||v.length>3000)) throw new AppError(502,'AI_RESULT_TOO_LARGE','AI 응답이 저장 가능한 크기를 넘어서 적용하지 않았습니다. 더 작은 기능으로 요청해주세요.');
  if(!value.summary.trim()) throw new AppError(502,'EMPTY_AI_RESULT','AI가 변경 내용이나 추가로 필요한 정보를 설명하지 않아 결과를 적용하지 않았습니다.');
  if(mode!=='explain'&&value.code!=='') {
    const code=value.code.trim();
    if(!code||!/<html(?:\s|>)/i.test(code)||!/<\/html\s*>\s*$/i.test(code)||/^```/.test(code)) throw new AppError(502,'INCOMPLETE_CODE','완전한 HTML 파일을 받지 못해 코드를 적용하지 않았습니다. 기능 범위를 줄여 다시 요청해주세요.');
  }
  return {summary:value.summary,code:mode==='explain'?'':value.code,checks:value.checks,warnings:value.warnings};
}
function usageFrom(provider,data) {
  const usage=data?.usage;
  if(!usage) return null;
  if(provider.id==='gpt') return {inputTokens:Number(usage.input_tokens)||0,outputTokens:Number(usage.output_tokens)||0};
  return {inputTokens:(Number(usage.input_tokens)||0)+(Number(usage.cache_creation_input_tokens)||0)+(Number(usage.cache_read_input_tokens)||0),outputTokens:Number(usage.output_tokens)||0};
}
export async function callProvider(ctx,provider,payload,mode) {
  const url=provider.id==='gpt'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages';
  const key=ctx.env[provider.env];
  const headers={'Content-Type':'application/json'};
  if(provider.id==='gpt') headers.Authorization='Bearer '+key;
  else {headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';}
  let response;
  try {
    response=await ctx.fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(ctx.providerTimeoutMs||90000)});
  } catch(error) {
    const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';
    throw new AppError(504,timeout?'PROVIDER_TIMEOUT':'PROVIDER_NETWORK_ERROR',timeout?'AI 응답 시간이 길어 요청을 중단했습니다. 코드는 변경하지 않았습니다.':'AI 연결을 완료하지 못했습니다. 잠시 후 다시 요청해주세요.');
  }
  let data;
  try {data=await response.json();} catch {throw new AppError(502,'INVALID_PROVIDER_RESPONSE','AI 제공사의 응답을 읽지 못했습니다. 코드는 변경하지 않았습니다.');}
  if(!response.ok) {
    const busy=response.status===429;
    const error=new AppError(busy?429:502,busy?'PROVIDER_RATE_LIMIT':'PROVIDER_REJECTED',busy?'AI 제공사의 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.':`${provider.label} 요청이 거절되었습니다. 교사 화면에서 API 키·모델 접근 권한·잔액을 확인해주세요.`);
    if([400,401,403,404,429].includes(response.status)) error.providerUsage={inputTokens:0,outputTokens:0};
    throw error;
  }
  const usage=usageFrom(provider,data);
  try {
    let value;
    if(provider.id==='gpt') {
      if(data.status!=='completed'||data.incomplete_details) throw new AppError(502,'TRUNCATED_AI_RESULT','AI 응답이 끝까지 생성되지 않아 코드를 적용하지 않았습니다. 기능을 나누어 다시 요청해주세요.');
      const parts=(data.output||[]).flatMap(item=>item.content||[]);
      if(parts.some(p=>p.type==='refusal')) throw new AppError(422,'AI_REFUSAL','AI가 이 요청의 결과를 제공하지 않았습니다. 수업 프로젝트의 기능 요청으로 바꾸어주세요.');
      const output=parts.filter(p=>p.type==='output_text').map(p=>p.text).join('');
      try {value=JSON.parse(output);} catch {throw new AppError(502,'INVALID_AI_JSON','AI 응답을 완전한 코드 결과로 읽지 못해 적용하지 않았습니다.');}
    } else {
      if(data.stop_reason==='max_tokens') throw new AppError(502,'TRUNCATED_AI_RESULT','AI 응답이 길이 한도에서 멈춰 코드를 적용하지 않았습니다. 기능을 나누어 다시 요청해주세요.');
      const tool=(data.content||[]).find(c=>c.type==='tool_use'&&c.name==='submit_webapp');
      if(data.stop_reason!=='tool_use'||!tool) throw new AppError(502,'INCOMPLETE_AI_RESULT','AI가 완전한 코드 결과를 반환하지 않아 적용하지 않았습니다.');
      value=tool.input;
    }
    return {...normalizeResult(value,mode),provider:provider.id,model:provider.model,providerUsage:usage};
  } catch(error) {error.providerUsage=usage;throw error;}
}
