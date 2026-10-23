import { RedisStore, PREFIX } from './store.mjs';
import { AppError, MODELS, getSettings, normalizeSettings, publicConfig, safeConfigWithoutStore, query, readBody, rejectCrossOrigin, respond, respondError, text, hash } from './common.mjs';
import { currentUser, login, teacherLogin, register, setSessionCookie, getTeams, publicTeam, teamId, updateTeams, needsPasswordReset, passwordHash, secureEqual } from './accounts.mjs';
import { loadProject, saveProject, sanitizeProject } from './projects.mjs';
import { getUsage, reserveUsage, settleUsage, usageKeys, summarizeUsage, dateKeys } from './usage.mjs';
import { buildPrompt } from './prompts.mjs';
import { providerPayload, callProvider } from './providers.mjs';

export function createContext(options={}) {
  const env=options.env || process.env;
  const fetchImpl=options.fetchImpl || globalThis.fetch;
  return {env,fetch:fetchImpl,now:options.now || (()=>Date.now()),store:options.store || new RedisStore({url:env.KV_REST_API_URL,token:env.KV_REST_API_TOKEN,fetchImpl}),providerTimeoutMs:options.providerTimeoutMs};
}
async function sessionResponse(ctx,user,settings) { return {user,config:publicConfig(ctx,settings),usage:user?await getUsage(ctx,user,settings):null}; }
async function adminResponse(ctx,settings) {
  const {teams}=await getTeams(ctx);
  const users=teams.map(t=>({id:teamId(t)}));
  const date=dateKeys(ctx.now()).date;
  const globalKeys=usageKeys(ctx,{id:'teacher'},'unused').slice(1,3);
  const values=await ctx.store.mget([...users.map(u=>usageKeys(ctx,u,'unused')[0]),...globalKeys]);
  const global=values.slice(teams.length);
  const list=teams.map((team,i)=>{
    const dailyRequests=Number.isInteger(team.dailyRequests)?team.dailyRequests:settings.dailyRequests;
    const {school,...usage}=summarizeUsage([values[i],...global],settings,dailyRequests,date);
    return {...publicTeam(team),dailyRequests,needsPasswordReset:needsPasswordReset(team),createdAt:team.createdAt||null,usage};
  });
  return {teams:list,settings,usage:summarizeUsage([null,...global],settings,settings.dailyRequests,date),config:publicConfig(ctx,settings)};
}

export function createStudioHandler(options={}) {
  const ctx=createContext(options);
  return async function studioHandler(req,res) {
    try {
      const method=String(req.method||'GET').toUpperCase();
      if(!['GET','POST'].includes(method)) return respond(res,405,{error:'지원하지 않는 요청 방식입니다.',code:'METHOD_NOT_ALLOWED'});
      if(method==='POST') rejectCrossOrigin(req,ctx.env);
      const body=method==='POST'?await readBody(req):{};
      const params=query(req); const action=method==='POST'?body.action:params.action || 'config';
      if(method==='GET'&&(action==='config'||action==='session')&&ctx.store.configured===false) {
        const config=safeConfigWithoutStore(ctx);
        return respond(res,200,action==='config'?config:{user:null,config,usage:null});
      }
      if(method==='GET'&&action==='config') return respond(res,200,publicConfig(ctx,await getSettings(ctx)));
      if(method==='GET'&&action==='session') {
        const settings=await getSettings(ctx); const user=await currentUser(ctx,req);
        return respond(res,200,await sessionResponse(ctx,user,settings));
      }
      if(method==='GET'&&action==='teams') {
        const {teams}=await getTeams(ctx);
        const cls=params.cls===undefined?'':String(params.cls);
        return respond(res,200,{teams:teams.filter(t=>(!cls||String(t.cls)===cls)&&['active','pending'].includes(t.status)).map(publicTeam)});
      }
      if(method==='POST'&&action==='logout') {setSessionCookie(ctx,req,res,'');return respond(res,200,{ok:true,user:null});}
      if(method==='POST'&&['login','teacherLogin','register'].includes(action)) {
        const settings=await getSettings(ctx);
        if(action==='register') return respond(res,201,await register(ctx,req,body,settings));
        const user=action==='teacherLogin'?await teacherLogin(ctx,req,res,body):await login(ctx,req,res,body);
        return respond(res,200,await sessionResponse(ctx,user,settings));
      }
      const isAdmin=['admin','settings','teamStatus','teamLimit','teamPassword'].includes(action);
      const user=await currentUser(ctx,req,{required:true,teacher:isAdmin});
      if(method==='GET'&&action==='project') {
        const {project,revision,updatedAt}=await loadProject(ctx,user);
        return respond(res,200,{project,revision,updatedAt});
      }
      if(method==='POST'&&action==='save') return respond(res,200,await saveProject(ctx,user,body));
      if(method==='GET'&&action==='admin') return respond(res,200,await adminResponse(ctx,await getSettings(ctx)));
      if(method==='POST'&&action==='settings') {
        if(!body.settings||typeof body.settings!=='object'||Array.isArray(body.settings)) throw new AppError(400,'INVALID_SETTINGS','변경할 설정을 확인해주세요.');
        const settings=normalizeSettings(body.settings,await getSettings(ctx));
        await ctx.store.set(PREFIX+'settings',settings);
        return respond(res,200,{ok:true,settings,config:publicConfig(ctx,settings)});
      }
      if(method==='POST'&&['teamStatus','teamLimit','teamPassword'].includes(action)) {
        if(typeof body.teamId!=='string'||!/^team_[a-f0-9]{32}$/.test(body.teamId)) throw new AppError(400,'INVALID_TEAM','팀을 선택해주세요.');
        if(action==='teamStatus'&&!['active','pending','inactive'].includes(body.status)) throw new AppError(400,'INVALID_STATUS','팀 승인 상태를 확인해주세요.');
        if(action==='teamLimit'&&body.dailyRequests!==null&&(!Number.isInteger(body.dailyRequests)||body.dailyRequests<1||body.dailyRequests>100)) throw new AppError(400,'INVALID_LIMIT','팀별 요청 횟수는 1~100회입니다.');
        const nextPassword=action==='teamPassword'?text(body.password,128,'새 팀 비밀번호',{min:8}):null;
        const nextHash=nextPassword?await passwordHash(nextPassword):null;
        const updated=await updateTeams(ctx,teams=>{
          const team=teams.find(t=>teamId(t)===body.teamId);
          if(!team) throw new AppError(404,'TEAM_NOT_FOUND','팀을 찾을 수 없습니다.');
          if(action==='teamStatus') team.status=body.status;
          else if(action==='teamPassword') {
            if((typeof team.password==='string'&&secureEqual(nextPassword,team.password))||(team.legacyPasswordDigest&&secureEqual(hash(nextPassword),team.legacyPasswordDigest))) throw new AppError(400,'PASSWORD_MUST_CHANGE','이전 비밀번호와 다른 새 비밀번호를 설정해주세요.');
            team.passwordHash=nextHash;delete team.password;delete team.legacyPasswordDigest;team.passwordResetRequired=false;team.sessionVersion=(Number(team.sessionVersion)||0)+1;team.id=teamId(team);
          }
          else if(body.dailyRequests===null) delete team.dailyRequests;
          else team.dailyRequests=body.dailyRequests;
          return teams;
        });
        const team=updated.find(t=>teamId(t)===body.teamId);const settings=await getSettings(ctx);
        return respond(res,200,{ok:true,team:{...publicTeam(team),dailyRequests:team.dailyRequests||settings.dailyRequests,needsPasswordReset:needsPasswordReset(team)}});
      }
      throw new AppError(404,'ACTION_NOT_FOUND','요청한 기능을 찾을 수 없습니다.');
    } catch(error) {return respondError(res,error);}
  };
}

export function createAIHandler(options={}) {
  const ctx=createContext(options);
  return async function aiHandler(req,res) {
    let user,settings,provider,reservation,settled=false;
    try {
      if(req.method!=='POST') return respond(res,405,{error:'POST 요청으로 이용해주세요.',code:'METHOD_NOT_ALLOWED'});
      rejectCrossOrigin(req,ctx.env);
      user=await currentUser(ctx,req,{required:true});
      const body=await readBody(req);
      settings=await getSettings(ctx);
      const mode=body.mode || 'build';
      if(!['build','edit','debug','explain'].includes(mode)) throw new AppError(400,'INVALID_MODE','AI 작업 모드를 선택해주세요.');
      const prompt=text(body.prompt,6000,'AI 요청',{min:1}).trim();
      if(!prompt) throw new AppError(400,'EMPTY_PROMPT','원하는 작업을 입력해주세요.');
      const providerId=body.provider || settings.defaultProvider;
      if(!Object.hasOwn(MODELS,providerId)) throw new AppError(400,'MODEL_NOT_ALLOWED','등록된 AI를 선택해주세요.');
      provider=MODELS[providerId];
      if(!settings.providers[providerId].enabled||!ctx.env[provider.env]) throw new AppError(503,'PROVIDER_NOT_CONFIGURED',`${provider.label}이(가) 연결되지 않았습니다. 연결된 AI를 선택하거나 교사에게 알려주세요.`);
      const project=sanitizeProject(body.project);
      const runtimeErrors=Array.isArray(body.runtimeErrors)?body.runtimeErrors:[];
      const prompts=buildPrompt({mode,prompt,project,runtimeErrors},settings);
      const payload=providerPayload(provider,settings,prompts);
      // UTF-8 bytes bound text tokens; also include schema and framing overhead.
      const inputTokenUpperBound=Buffer.byteLength(JSON.stringify(payload))+2048;
      reservation=await reserveUsage(ctx,user,settings,inputTokenUpperBound,provider);
      const generated=await callProvider(ctx,provider,payload,mode);
      let lastRequest;
      try {lastRequest=await settleUsage(ctx,reservation,provider,generated.providerUsage);settled=true;}
      catch {
        settled=true; // reservation remains held: retries cannot spend it twice
        lastRequest={inputTokens:generated.providerUsage?.inputTokens||0,outputTokens:generated.providerUsage?.outputTokens||0,estimatedCostUsd:reservation.amount/1000000,conservativeEstimate:true,costIsEstimate:true};
        generated.warnings.push('사용량 정산이 지연되어 예상 최대 비용을 보수적으로 유지했습니다. 저장 후 교사에게 알려주세요.');
      }
      let usage;
      try {usage={...await getUsage(ctx,user,settings),lastRequest};}
      catch {usage={unavailable:true,remaining:null,lastRequest,costIsEstimate:true};}
      const {providerUsage,...result}=generated;
      return respond(res,200,{...result,usage});
    } catch(error) {
      if(reservation&&!settled) {try {await settleUsage(ctx,reservation,provider,error.providerUsage ?? null);} catch { /* conservative reservation stays */ }}
      if(user&&settings) {try {error.extra={...(error.extra||{}),usage:await getUsage(ctx,user,settings)};} catch { /* keep original error */ }}
      return respondError(res,error);
    }
  };
}

export function retiredHandler(req,res) {
  return respond(res,410,{error:'이전 API는 종료되었습니다. 새 작업실에서 로그인한 뒤 이용해주세요.',code:'API_RETIRED'});
}
