import { randomUUID } from 'node:crypto';
import { AppError, text, MAX_CODE_CHARS, MAX_DATASET_CHARS, MAX_PROJECT_BYTES, MAX_CODE_BYTES, MAX_DATASET_BYTES } from './common.mjs';
import { PREFIX, decodeStored } from './store.mjs';

export function emptyProject() {
  return {title:'우리 팀 프로젝트',brief:{user:'',problem:'',evidence:'',sourceUrl:'',dataDate:'',minimumFeature:''},code:'',datasets:[],messages:[],versions:[],records:[],checks:{},appUrl:''};
}
const string=(value,max,label)=>text(value ?? '',max,label);
const items=(value,max,label)=>{
  if(value===undefined) return [];
  if(!Array.isArray(value)||value.length>max) throw new AppError(400,'PROJECT_LIMIT',`${label}은(는) 최대 ${max}개까지 저장할 수 있습니다.`);
  return value;
};
function safeId(value) { return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:randomUUID(); }
function webUrl(value,label) {
  const result=string(value,2000,label).trim();
  if(result&&!/^https?:\/\//i.test(result)) throw new AppError(400,'INVALID_URL',`${label}은(는) http 또는 https 주소를 입력해주세요.`);
  return result;
}
export function sanitizeProject(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new AppError(400,'INVALID_PROJECT','프로젝트 내용을 확인해주세요.');
  const result=emptyProject();
  result.title=string(value.title,120,'프로젝트 이름').trim()||result.title;
  for(const key of ['user','problem','evidence','minimumFeature']) result.brief[key]=string(value.brief?.[key],5000,'프로젝트 설명');
  result.brief.sourceUrl=webUrl(value.brief?.sourceUrl,'데이터 출처');
  result.brief.dataDate=string(value.brief?.dataDate,100,'데이터 기준일');
  result.code=string(value.code,MAX_CODE_CHARS,'현재 코드');
  if(Buffer.byteLength(result.code)>MAX_CODE_BYTES) throw new AppError(413,'CODE_TOO_LARGE','현재 코드는 UTF-8 기준 120KB까지 저장할 수 있습니다.');
  result.appUrl=webUrl(value.appUrl,'완성 웹앱 주소');
  result.datasets=items(value.datasets,8,'데이터 파일').map(d=>{
    if(!d||typeof d!=='object') throw new AppError(400,'INVALID_DATASET','데이터 파일을 확인해주세요.');
    const format=String(d.format||'txt').toLowerCase();
    if(!['csv','tsv','json','txt','text'].includes(format)) throw new AppError(400,'INVALID_DATASET','CSV, TSV, JSON, TXT 데이터를 사용할 수 있습니다.');
    return {id:safeId(d.id),name:string(d.name,160,'데이터 파일명'),format,text:string(d.text,MAX_DATASET_CHARS,'데이터 내용')};
  });
  if(result.datasets.reduce((n,d)=>n+d.text.length,0)>MAX_DATASET_CHARS) throw new AppError(413,'DATASET_TOO_LARGE','데이터 파일의 전체 크기가 너무 큽니다.');
  if(result.datasets.reduce((n,d)=>n+Buffer.byteLength(d.text),0)>MAX_DATASET_BYTES) throw new AppError(413,'DATASET_TOO_LARGE','데이터 파일은 전체 320KB까지 저장할 수 있습니다.');
  result.messages=items(value.messages,100,'대화').map(m=>{
    if(!m||!['user','assistant'].includes(m.role)) throw new AppError(400,'INVALID_MESSAGE','대화 형식이 올바르지 않습니다.');
    return {id:safeId(m.id),role:m.role,text:string(m.text ?? m.content,12000,'대화 내용'),createdAt:string(m.createdAt,50,'대화 시각'),mode:string(m.mode,20,'대화 모드'),provider:string(m.provider,30,'제공사'),model:string(m.model,80,'모델'),summary:string(m.summary,12000,'변경 설명'),prompt:string(m.prompt,12000,'대화 요청'),checks:items(m.checks,30,'검증 안내').map(v=>string(v,3000,'검증 안내')),warnings:items(m.warnings,30,'주의 사항').map(v=>string(v,3000,'주의 사항'))};
  });
  result.versions=items(value.versions,6,'코드 버전').map(v=>{
    const code=string(v.code,MAX_CODE_CHARS,'버전 코드');
    if(Buffer.byteLength(code)>MAX_CODE_BYTES) throw new AppError(413,'CODE_TOO_LARGE','각 코드 버전은 120KB까지 저장할 수 있습니다.');
    return {id:safeId(v.id),createdAt:string(v.createdAt,50,'버전 시각'),note:string(v.note,2000,'버전 설명'),code};
  });
  result.records=items(value.records,100,'AI 활용 기록').map(r=>({id:safeId(r.id),prompt:string(r.prompt,6000,'사용한 요청'),help:string(r.help,6000,'AI 도움 내용'),verification:string(r.verification,6000,'확인 내용'),decision:string(r.decision,6000,'반영 판단'),stage:string(r.stage,100,'활동 단계'),createdAt:string(r.createdAt,50,'활동 시각')}));
  if(value.checks&&typeof value.checks==='object'&&!Array.isArray(value.checks)) {
    const entries=Object.entries(value.checks);
    if(entries.length>50) throw new AppError(400,'PROJECT_LIMIT','점검 항목이 너무 많습니다.');
    result.checks=Object.fromEntries(entries.filter(([key,v])=>/^[a-zA-Z0-9_-]{1,60}$/.test(key)&&!['__proto__','constructor','prototype'].includes(key)&&typeof v==='boolean'));
  }
  if(Buffer.byteLength(JSON.stringify(result))>MAX_PROJECT_BYTES) throw new AppError(413,'PROJECT_TOO_LARGE','프로젝트 저장 용량을 넘었습니다. 오래된 버전을 내려받은 뒤 정리해주세요.');
  return result;
}
function projectKey(user) { return PREFIX+'project:'+user.id; }
export async function loadProject(ctx,user) {
  const raw=await ctx.store.get(projectKey(user));
  const record=decodeStored(raw,null);
  if(raw!==null&&raw!==undefined&&(!record?.project||record.teamId!==user.id)) throw new AppError(503,'INVALID_PROJECT_STORE','저장된 프로젝트를 확인해야 합니다. 교사에게 알려주세요.');
  return {raw,project:record?.project||emptyProject(),revision:record?.revision||0,updatedAt:record?.updatedAt||null};
}
export async function saveProject(ctx,user,body) {
  if(!Number.isSafeInteger(body.revision)||body.revision<0) throw new AppError(400,'REVISION_REQUIRED','먼저 프로젝트를 불러온 뒤 저장해주세요.');
  const project=sanitizeProject(body.project);
  const current=await loadProject(ctx,user);
  if(current.revision!==body.revision) throw new AppError(409,'REVISION_CONFLICT','다른 팀원이 저장한 변경이 있습니다. 현재 작업을 내려받고 최신 프로젝트를 불러와주세요.',{revision:current.revision});
  const record={teamId:user.id,project,revision:current.revision+1,updatedAt:new Date(ctx.now()).toISOString()};
  if(!await ctx.store.cas(projectKey(user),current.raw,record)) {
    const latest=await loadProject(ctx,user);
    throw new AppError(409,'REVISION_CONFLICT','다른 팀원이 먼저 저장했습니다. 최신 프로젝트를 확인해주세요.',{revision:latest.revision});
  }
  return {project,revision:record.revision,updatedAt:record.updatedAt};
}
