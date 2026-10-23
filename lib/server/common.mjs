import { createHash } from 'node:crypto';
import { PREFIX, decodeStored } from './store.mjs';

export class AppError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status=status; this.code=code; this.extra=extra; }
}
export const MODELS = Object.freeze({
  gpt: Object.freeze({ id:'gpt', label:'GPT 6.1 Sol', model:'gpt-6.1-sol', env:'OPENAI_KEY', inputRate:2, outputRate:10 }),
  claude: Object.freeze({ id:'claude', label:'Claude Sonnet 5.5', model:'claude-sonnet-5-5', env:'CLAUDE_KEY', inputRate:2, outputRate:10 }),
});
export const DEFAULT_SETTINGS = Object.freeze({
  aiEnabled:true, defaultProvider:'gpt', classes:[1,2,3,4,5,6,7,8,9,10],
  dailyRequests:12, globalDailyRequests:250, teamDailyUsd:2, schoolDailyUsd:25, schoolMonthlyUsd:150,
  maxOutputTokens:12000, maxInputChars:180000,
  providers:{gpt:{enabled:true,model:MODELS.gpt.model},claude:{enabled:true,model:MODELS.claude.model}},
});
export const MAX_BODY_BYTES = 3 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 800 * 1024;
export const MAX_CODE_CHARS = 200000;
export const MAX_DATASET_CHARS = 500000;
export const MAX_CODE_BYTES = 120 * 1024;
export const MAX_DATASET_BYTES = 320 * 1024;

export function header(req, name) {
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name];
  return Array.isArray(value) ? value[0] : String(value ?? '');
}
export function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
export function text(value, max, label, {min=0} = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new AppError(400,'INVALID_INPUT',`${label}을(를) 확인해주세요. (${min}~${max.toLocaleString()}자)`);
  }
  return value;
}
export function boundedNumber(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
export function rejectCrossOrigin(req, env = {}) {
  const origin = header(req,'origin');
  const host = header(req,'host');
  if (!origin && header(req,'sec-fetch-site') === 'same-origin') return;
  let allowed = false;
  try {
    const parsed = new URL(origin);
    allowed = ['http:','https:'].includes(parsed.protocol) && parsed.host === host;
    if (env.APP_ORIGIN) allowed = allowed && parsed.origin === new URL(env.APP_ORIGIN).origin;
  } catch { allowed = false; }
  if (!allowed) throw new AppError(403,'ORIGIN_REJECTED','이 사이트에서 다시 로그인한 뒤 요청해주세요.');
}
export async function readBody(req) {
  let body = req.body;
  if (body === undefined) {
    const chunks=[]; let length=0;
    for await (const chunk of req) {
      length += Buffer.byteLength(chunk);
      if(length>MAX_BODY_BYTES) throw new AppError(413,'PAYLOAD_TOO_LARGE','한 번에 전송할 수 있는 프로젝트 크기를 넘었습니다.');
      chunks.push(Buffer.from(chunk));
    }
    body=Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body=body.toString('utf8');
  if (typeof body === 'string') {
    if(Buffer.byteLength(body)>MAX_BODY_BYTES) throw new AppError(413,'PAYLOAD_TOO_LARGE','프로젝트 크기가 너무 큽니다.');
    try { body=JSON.parse(body); } catch { throw new AppError(400,'INVALID_JSON','요청 내용을 읽을 수 없습니다. 다시 시도해주세요.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400,'INVALID_JSON','요청 형식이 올바르지 않습니다.');
  if(Buffer.byteLength(JSON.stringify(body))>MAX_BODY_BYTES) throw new AppError(413,'PAYLOAD_TOO_LARGE','프로젝트 크기가 너무 큽니다.');
  return body;
}
export function query(req) {
  return req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
}
export function respond(res, status, data) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, private');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Vary','Cookie, Origin');
  return res.status(status).json(data);
}
export function respondError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const message = status < 500 || error?.code ? error.message : '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.';
  return respond(res,status,{error:message,message,code:error?.code || 'INTERNAL_ERROR',...(error?.extra || {})});
}
export async function getSettings(ctx) {
  const raw=await ctx.store.get(PREFIX+'settings');
  const stored=raw===null||raw===undefined?{}:decodeStored(raw,null);
  if(!stored||typeof stored!=='object'||Array.isArray(stored)) throw new AppError(503,'INVALID_SETTINGS_STORE','수업 설정을 확인해야 합니다. 교사에게 알려주세요.');
  return normalizeSettings(stored || {});
}
export function normalizeSettings(input = {}, previous = DEFAULT_SETTINGS) {
  const s={...previous,providers:{...previous.providers}};
  if(typeof input.aiEnabled==='boolean') s.aiEnabled=input.aiEnabled;
  if(Object.hasOwn(MODELS,input.defaultProvider)) s.defaultProvider=input.defaultProvider;
  const ranges={dailyRequests:[1,100],globalDailyRequests:[1,5000],teamDailyUsd:[0.1,100],schoolDailyUsd:[0.1,1000],schoolMonthlyUsd:[0.1,10000],maxOutputTokens:[2000,20000],maxInputChars:[20000,400000]};
  for(const [key,[min,max]] of Object.entries(ranges)) {
    if(input[key]!==undefined) {
      if(typeof input[key]!=='number'||!Number.isFinite(input[key])||input[key]<min||input[key]>max) throw new AppError(400,'INVALID_SETTINGS',`${key} 설정 범위는 ${min}~${max}입니다.`);
      s[key]=['dailyRequests','globalDailyRequests','maxOutputTokens','maxInputChars'].includes(key)?Math.floor(input[key]):input[key];
    }
  }
  if(Array.isArray(input.classes)) {
    const classes=[...new Set(input.classes.map(Number))].filter(n=>Number.isInteger(n)&&n>=1&&n<=30).sort((a,b)=>a-b);
    if(!classes.length) throw new AppError(400,'INVALID_SETTINGS','수업 반을 하나 이상 선택해주세요.');
    s.classes=classes;
  }
  for(const id of Object.keys(MODELS)) {
    const requested=input.providers?.[id];
    s.providers[id]={enabled:previous.providers[id]?.enabled!==false,model:MODELS[id].model};
    if(requested&&typeof requested.enabled==='boolean') s.providers[id].enabled=requested.enabled;
    if(requested?.model&&requested.model!==MODELS[id].model) throw new AppError(400,'MODEL_NOT_ALLOWED','등록된 모델만 사용할 수 있습니다.');
  }
  return s;
}
export function publicConfig(ctx,settings) {
  const providers=Object.values(MODELS).map(p=>({id:p.id,label:p.label,model:p.model,available:Boolean(ctx.env[p.env])&&settings.providers[p.id].enabled,enabled:settings.providers[p.id].enabled}));
  const preferred=providers.find(p=>p.id===settings.defaultProvider&&p.available);
  return {
    version:'2.0.0',providers,defaultProvider:preferred?.id || providers.find(p=>p.available)?.id || settings.defaultProvider,
    teacherConfigured:Boolean(ctx.env.ADMIN_PASSWORD || ctx.env.TEACHER_PASSWORD), storageConfigured:ctx.store.configured!==false,
    aiEnabled:settings.aiEnabled,classes:settings.classes,
    limits:{dailyRequests:settings.dailyRequests,globalDailyRequests:settings.globalDailyRequests,teamDailyUsd:settings.teamDailyUsd,schoolDailyUsd:settings.schoolDailyUsd,schoolMonthlyUsd:settings.schoolMonthlyUsd,maxOutputTokens:settings.maxOutputTokens,maxInputChars:settings.maxInputChars,maxCodeChars:MAX_CODE_CHARS,maxDatasetChars:MAX_DATASET_CHARS,maxCodeBytes:MAX_CODE_BYTES,maxDatasetBytes:MAX_DATASET_BYTES,maxProjectBytes:MAX_PROJECT_BYTES,maxFiles:8},
    billingNote:'사용량과 비용은 이 수업 도구의 추정치입니다. API 계정의 실제 잔액이 아닙니다.',
  };
}
export function safeConfigWithoutStore(ctx) { return publicConfig(ctx,normalizeSettings({})); }
