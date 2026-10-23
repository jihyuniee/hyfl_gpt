import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, hash, header, text } from './common.mjs';
import { PREFIX, decodeStored } from './store.mjs';

const scrypt=promisify(scryptCallback);
export const COOKIE_NAME='hyfl_studio_session';
export const TEAM_STORE_KEY=PREFIX+'teams';
const SESSION_SECONDS=8*60*60;
export function teamId(team) {
  return 'team_'+hash([String(team.grade || '2'),String(team.cls),String(team.name || '').normalize('NFC').trim()].join('\0')).slice(0,32);
}
export function publicTeam(team) {
  return {id:teamId(team),grade:String(team.grade || '2'),cls:String(team.cls),name:String(team.name || ''),status:team.status || 'pending'};
}
export function studentUser(team) { const {status,...user}=publicTeam(team); return {...user,role:'student'}; }
function parseTeamStore(raw) {
  const teams=raw===null||raw===undefined?[]:decodeStored(raw,null);
  if(!Array.isArray(teams)||teams.some(t=>!t||typeof t!=='object'||Array.isArray(t))) throw new AppError(503,'INVALID_TEAM_STORE','팀 정보 저장소를 확인해야 합니다. 교사에게 알려주세요.');
  return teams;
}
function importLegacyTeams(teams,now) {
  // The old public API could write arbitrary team fields. Import identity only;
  // no old hash/session/approval-bypass field is accepted as authentication.
  return teams.map(t=>{
    const team={grade:String(t.grade || '2'),cls:String(t.cls || ''),name:String(t.name || '').normalize('NFC').trim(),status:['active','pending','inactive'].includes(t.status)?t.status:'pending',passwordResetRequired:true,sessionVersion:0,legacyImportedAt:new Date(now).toISOString()};
    if(typeof t.members==='string')team.members=t.members;
    if(typeof t.createdAt==='string')team.createdAt=t.createdAt;
    if(typeof t.password==='string')team.legacyPasswordDigest=hash(t.password);
    team.id=teamId(team);
    return team;
  });
}
export async function getTeams(ctx) {
  let raw=await ctx.store.get(TEAM_STORE_KEY);
  if(raw===null||raw===undefined) {
    const legacy=parseTeamStore(await ctx.store.get('teams'));
    await ctx.store.cas(TEAM_STORE_KEY,null,importLegacyTeams(legacy,ctx.now()));
    raw=await ctx.store.get(TEAM_STORE_KEY);
    if(raw===null||raw===undefined) throw new AppError(503,'INVALID_TEAM_STORE','새 팀 저장소를 준비하지 못했습니다. 다시 시도해주세요.');
  }
  return {raw,teams:parseTeamStore(raw)};
}
export async function updateTeams(ctx,change) {
  for(let attempt=0;attempt<8;attempt++) {
    const {raw,teams}=await getTeams(ctx);
    const updated=await change(teams.map(t=>({...t})));
    if(await ctx.store.cas(TEAM_STORE_KEY,raw,updated)) return updated;
  }
  throw new AppError(409,'TEAM_CONFLICT','다른 팀 관리 작업이 진행 중입니다. 다시 시도해주세요.');
}
export async function passwordHash(password) {
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}
export function secureEqual(a,b) {
  const x=Buffer.from(hash(String(a))); const y=Buffer.from(hash(String(b)));
  return timingSafeEqual(x,y);
}
export async function verifyPassword(password,team) {
  if(typeof team.passwordHash==='string') {
    const [version,salt,expected]=team.passwordHash.split('$');
    if(version!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(salt || '')||!/^[a-f0-9]{128}$/.test(expected || '')) return false;
    const actual=await scrypt(password,salt,64);
    return timingSafeEqual(actual,Buffer.from(expected,'hex'));
  }
  return false;
}
export function needsPasswordReset(team) { return team.passwordResetRequired===true || !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(team.passwordHash || '') || typeof team.password==='string'; }
function sessionSecret(ctx) {
  if(ctx.env.SESSION_SECRET) return ctx.env.SESSION_SECRET;
  if(ctx.env.KV_REST_API_TOKEN) return createHmac('sha256',ctx.env.KV_REST_API_TOKEN).update('hyfl:studio:session-signing:v2').digest('hex');
  throw new AppError(503,'AUTH_NOT_CONFIGURED','인증 저장소가 연결되지 않았습니다. 교사에게 알려주세요.');
}
function authTag(ctx,credential) { return createHmac('sha256',sessionSecret(ctx)).update('credential:'+String(credential)).digest('base64url'); }
function teamAuthTag(ctx,team) { return authTag(ctx,(team.passwordHash || '')+'|sessionVersion:'+String(team.sessionVersion || 0)); }
export function signSession(ctx,claims) {
  const now=Math.floor(ctx.now()/1000);
  const payload=Buffer.from(JSON.stringify({...claims,iat:now,exp:now+SESSION_SECONDS})).toString('base64url');
  return payload+'.'+createHmac('sha256',sessionSecret(ctx)).update(payload).digest('base64url');
}
export function decodeSession(ctx,token) {
  if(!token||token.length>4096) return null;
  const [payload,signature,extra]=token.split('.');
  if(!payload||!signature||extra) return null;
  const expected=createHmac('sha256',sessionSecret(ctx)).update(payload).digest('base64url');
  if(!secureEqual(signature,expected)) return null;
  try {
    const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    const now=Math.floor(ctx.now()/1000);
    if(!Number.isFinite(claims.exp)||claims.exp<=now||claims.exp>now+SESSION_SECONDS+60||!['student','teacher'].includes(claims.role)) return null;
    return claims;
  } catch { return null; }
}
function cookieValue(req) {
  const item=header(req,'cookie').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE_NAME+'='));
  return item?.slice(COOKIE_NAME.length+1) || '';
}
export function setSessionCookie(ctx,req,res,token) {
  const host=header(req,'host');
  const secure=header(req,'x-forwarded-proto')==='https'||!/^localhost(?::\d+)?$|^127\.0\.0\.1(?::\d+)?$/.test(host);
  res.setHeader('Set-Cookie',`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?SESSION_SECONDS:0}${secure?'; Secure':''}`);
}
export async function currentUser(ctx,req,{required=false,teacher=false}={}) {
  const token=cookieValue(req);
  let claims=null;
  if(token) claims=decodeSession(ctx,token);
  let user=null;
  if(claims?.role==='teacher') {
    const secret=ctx.env.ADMIN_PASSWORD || ctx.env.TEACHER_PASSWORD;
    if(secret&&secureEqual(claims.authTag,authTag(ctx,secret))) user={id:'teacher',name:'교사',cls:'',grade:'',role:'teacher'};
  } else if(claims?.role==='student') {
    const {teams}=await getTeams(ctx);
    const team=teams.find(t=>teamId(t)===claims.sub);
    if(team?.status==='active'&&!needsPasswordReset(team)&&secureEqual(claims.authTag,teamAuthTag(ctx,team))) user=studentUser(team);
  }
  if(required&&!user) throw new AppError(401,'AUTH_REQUIRED','팀으로 로그인한 뒤 이용해주세요.');
  if(teacher&&user?.role!=='teacher') throw new AppError(403,'TEACHER_REQUIRED','교사 계정에서만 사용할 수 있습니다.');
  return user;
}
export async function throttleLogin(ctx,req,account,{teacher=false}={}) {
  const ip=header(req,'x-vercel-forwarded-for')||header(req,'x-real-ip')||header(req,'x-forwarded-for').split(',')[0]||req.socket?.remoteAddress||'unknown';
  const bucket=Math.floor(ctx.now()/(10*60*1000));
  const results=await Promise.all([
    ctx.store.throttle(PREFIX+'login:ip:'+hash(ip)+':'+bucket,660),
    ctx.store.throttle(PREFIX+'login:account:'+hash(account)+':'+bucket,660),
  ]);
  if(Number(results[0])>200||Number(results[1])>(teacher?8:15)) throw new AppError(429,'LOGIN_THROTTLED','로그인 시도가 너무 많습니다. 10분 뒤 다시 시도해주세요.',{retryAfter:600});
}
function validateIdentity(body) {
  const cls=String(body.cls ?? '');
  if(!/^([1-9]|[12]\d|30)$/.test(cls)) throw new AppError(400,'INVALID_CLASS','반을 선택해주세요.');
  const name=text(body.name,60,'팀 이름',{min:1}).normalize('NFC').trim();
  if(!name) throw new AppError(400,'INVALID_TEAM_NAME','팀 이름을 입력해주세요.');
  return {cls,name};
}
export async function login(ctx,req,res,body) {
  const {cls,name}=validateIdentity(body);
  const password=text(body.password,128,'비밀번호',{min:1});
  await throttleLogin(ctx,req,cls+'\0'+name);
  const {teams}=await getTeams(ctx);
  const team=teams.find(t=>String(t.cls)===cls&&String(t.name).normalize('NFC').trim()===name);
  if(team&&needsPasswordReset(team)) throw new AppError(403,'LEGACY_PASSWORD_RESET','기존 팀은 선생님이 비밀번호를 한 번 새로 설정한 뒤 이용할 수 있습니다.');
  const valid=team?await verifyPassword(password,team):false;
  if(!valid) throw new AppError(401,'INVALID_CREDENTIALS','팀 이름과 비밀번호를 확인해주세요.');
  if(team.status!=='active') throw new AppError(403,'TEAM_NOT_ACTIVE',team.status==='pending'?'교사 승인 후 입장할 수 있습니다.':'사용이 중지된 팀입니다. 교사에게 알려주세요.');
  const user=studentUser(team);
  setSessionCookie(ctx,req,res,signSession(ctx,{sub:user.id,role:'student',authTag:teamAuthTag(ctx,team)}));
  return user;
}
export async function teacherLogin(ctx,req,res,body) {
  const secret=ctx.env.ADMIN_PASSWORD || ctx.env.TEACHER_PASSWORD;
  if(!secret) throw new AppError(503,'TEACHER_NOT_CONFIGURED','교사 로그인이 아직 설정되지 않았습니다. 서버에 ADMIN_PASSWORD를 등록해주세요.');
  const password=text(body.password,256,'교사 비밀번호',{min:1});
  await throttleLogin(ctx,req,'teacher',{teacher:true});
  if(!secureEqual(password,secret)) throw new AppError(401,'INVALID_CREDENTIALS','교사 비밀번호를 확인해주세요.');
  setSessionCookie(ctx,req,res,signSession(ctx,{sub:'teacher',role:'teacher',authTag:authTag(ctx,secret)}));
  return {id:'teacher',name:'교사',cls:'',grade:'',role:'teacher'};
}
export async function register(ctx,req,body,settings) {
  const {cls,name}=validateIdentity(body);
  if(!settings.classes.includes(Number(cls))) throw new AppError(400,'INVALID_CLASS','수업에 등록된 반을 선택해주세요.');
  const password=text(body.password,128,'팀 비밀번호',{min:6});
  await throttleLogin(ctx,req,'register:'+cls+'\0'+name);
  const hashed=await passwordHash(password);
  const created={grade:'2',cls,name,passwordHash:hashed,status:'pending',createdAt:new Date(ctx.now()).toISOString()};
  created.id=teamId(created);
  await updateTeams(ctx,items=>{
    if(items.some(t=>String(t.cls)===cls&&String(t.name).normalize('NFC').trim()===name)) throw new AppError(409,'TEAM_EXISTS','같은 반에 등록된 팀 이름입니다. 로그인해주세요.');
    if(items.length>=500) throw new AppError(409,'TEAM_LIMIT','팀 등록 한도에 도달했습니다. 교사에게 알려주세요.');
    return [...items,created];
  });
  return {ok:true,team:publicTeam(created),message:'팀 등록을 신청했습니다. 교사 승인 후 입장할 수 있습니다.'};
}
