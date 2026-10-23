import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createStudioHandler, createAIHandler, retiredHandler } from '../lib/server/app.mjs';
import { teamId, decodeSession, COOKIE_NAME, TEAM_STORE_KEY } from '../lib/server/accounts.mjs';
import { normalizeSettings, MODELS } from '../lib/server/common.mjs';
import { emptyProject, sanitizeProject } from '../lib/server/projects.mjs';
import { getUsage, reserveUsage, settleUsage, dateKeys } from '../lib/server/usage.mjs';
import { buildPrompt, datasetContext, parseDelimited } from '../lib/server/prompts.mjs';
import { normalizeResult } from '../lib/server/providers.mjs';
import { RedisStore, PREFIX, decodeStored, RESERVE_SCRIPT, SETTLE_SCRIPT } from '../lib/server/store.mjs';
import { MemoryStore, legacyTeams, securedTeams, testEnv, testNow, invoke, loginCookie, cookieOf, providerResponse, validAIResult, validCode } from './server-fixtures.mjs';

function setup(options={}) {
  const store=options.store||new MemoryStore(securedTeams());
  const env=options.env||testEnv();
  const config={store,env,now:testNow,fetchImpl:async()=>{throw new Error('Unexpected network request');},...options};
  return {store,env,config,studio:createStudioHandler(config),ai:createAIHandler(config),ctx:createContext(config)};
}

test('Unicode team identity does not reproduce legacy Korean-name collisions',()=>{
  const [a,b]=legacyTeams();
  assert.notEqual(teamId(a),teamId(b));
  assert.equal(teamId(a),teamId({...a,name:a.name.normalize('NFD')}));
  assert.notEqual(teamId(a),teamId({...a,cls:'8'}));
});
test('public config/session work without storage and never imply connected AI',async()=>{
  const studio=createStudioHandler({env:{},fetchImpl:async()=>{throw new Error('Must not fetch');}});
  const config=await invoke(studio,{action:'config'});
  assert.equal(config.statusCode,200);assert.equal(config.body.storageConfigured,false);
  assert.equal(config.body.teacherConfigured,false);assert.ok(config.body.providers.every(p=>!p.available));assert.ok(config.body.classes.includes(9));
  const session=await invoke(studio,{action:'session'});assert.equal(session.body.user,null);
});
test('previously public legacy passwords are rejected until teacher rotates them',async()=>{
  const {studio,store,ctx}=setup({store:new MemoryStore(legacyTeams(),{legacy:true})});
  const blocked=await invoke(studio,{method:'POST',body:{action:'login',cls:'9',name:'하늘',password:'legacy-short'}});
  assert.equal(blocked.statusCode,403);assert.equal(blocked.body.code,'LEGACY_PASSWORD_RESET');
  const teacher=await invoke(studio,{method:'POST',body:{action:'teacherLogin',password:testEnv().ADMIN_PASSWORD}});const adminCookie=cookieOf(teacher);
  const admin=await invoke(studio,{action:'admin',cookie:adminCookie});assert.ok(admin.body.teams.every(t=>t.needsPasswordReset));
  const same=await invoke(studio,{method:'POST',cookie:adminCookie,body:{action:'teamPassword',teamId:teamId(legacyTeams()[0]),password:'legacy-short'}});
  assert.equal(same.body.code,'PASSWORD_MUST_CHANGE');
  const reset=await invoke(studio,{method:'POST',cookie:adminCookie,body:{action:'teamPassword',teamId:teamId(legacyTeams()[0]),password:'reset-team-password'}});
  assert.equal(reset.statusCode,200);assert.equal(reset.body.team.needsPasswordReset,false);
  const {cookie,response}=await loginCookie(studio,'하늘','reset-team-password');
  assert.match(response.headers['set-cookie'],/HttpOnly/);assert.match(response.headers['set-cookie'],/SameSite=Strict/);assert.match(response.headers['set-cookie'],/Secure/);
  assert.equal(response.body.user.cls,'9');assert.equal(response.body.user.role,'student');
  const stored=decodeStored(await store.get(TEAM_STORE_KEY))[0];
  assert.match(stored.passwordHash,/^scrypt-v1\$/);assert.equal(stored.password,undefined);
  assert.equal(stored.sessionVersion,1);
  const token=cookie.slice(COOKIE_NAME.length+1);assert.equal(decodeSession(ctx,token).sub,teamId(legacyTeams()[0]));
  assert.ok(!JSON.stringify(response.body).includes('legacy-short'));assert.ok(!JSON.stringify(response.body).includes('passwordHash'));
  await invoke(studio,{method:'POST',cookie:adminCookie,body:{action:'teamPassword',teamId:teamId(legacyTeams()[0]),password:'another-new-password'}});
  assert.equal((await invoke(studio,{action:'project',cookie})).statusCode,401);
});
test('public team list includes class 9 but exposes no password, hash, or member list',async()=>{
  const {studio}=setup();
  const result=await invoke(studio,{action:'teams',query:{cls:'9'}});
  assert.equal(result.body.teams.length,2);
  assert.deepEqual(Object.keys(result.body.teams[0]).sort(),['cls','grade','id','name','status']);
  assert.ok(!JSON.stringify(result.body).includes('SYNTHETIC'));
});
test('new registration stores hashes and cannot self-approve',async()=>{
  const {studio,store}=setup();
  const result=await invoke(studio,{method:'POST',body:{action:'register',cls:9,name:'합성 새팀',password:'test-password',status:'active',role:'teacher'}});
  assert.equal(result.statusCode,201);assert.equal(result.body.team.status,'pending');
  const team=decodeStored(await store.get(TEAM_STORE_KEY)).find(t=>t.name==='합성 새팀');assert.ok(team.passwordHash);assert.equal(team.password,undefined);
  const login=await invoke(studio,{method:'POST',body:{action:'login',cls:9,name:'합성 새팀',password:'test-password'}});
  assert.equal(login.statusCode,403);assert.equal(login.body.code,'TEAM_NOT_ACTIVE');
});
test('tampered sessions, anonymous storage access, and student admin calls are rejected',async()=>{
  const {studio,ai}=setup();const {cookie}=await loginCookie(studio);
  assert.equal((await invoke(studio,{action:'project'})).statusCode,401);
  assert.equal((await invoke(studio,{action:'project',cookie:cookie+'x'})).statusCode,401);
  assert.equal((await invoke(studio,{action:'admin',cookie})).statusCode,403);
  assert.equal((await invoke(ai,{method:'POST',body:{prompt:'a'}})).statusCode,401);
});
test('cross-origin state changes fail before provider or store mutation',async()=>{
  const {studio}=setup();
  const result=await invoke(studio,{method:'POST',origin:'https://other.test',body:{action:'register',cls:9,name:'bad',password:'password'}});
  assert.equal(result.statusCode,403);assert.equal(result.body.code,'ORIGIN_REJECTED');
});
test('teacher login fails closed without server secret and never reuses public legacy default',async()=>{
  const env=testEnv();delete env.ADMIN_PASSWORD;const {studio}=setup({env});
  const result=await invoke(studio,{method:'POST',body:{action:'teacherLogin',password:'anything'}});
  assert.equal(result.statusCode,503);assert.equal(result.body.code,'TEACHER_NOT_CONFIGURED');
});
test('teacher can approve teams, change limits, and revocation invalidates existing session',async()=>{
  const {studio}=setup();const {cookie}=await loginCookie(studio);
  const teacher=await invoke(studio,{method:'POST',body:{action:'teacherLogin',password:testEnv().ADMIN_PASSWORD}});const adminCookie=cookieOf(teacher);
  const id=teamId(legacyTeams()[0]);
  const limit=await invoke(studio,{method:'POST',cookie:adminCookie,body:{action:'teamLimit',teamId:id,dailyRequests:3}});
  assert.equal(limit.statusCode,200);assert.equal(limit.body.team.dailyRequests,3);
  const revoke=await invoke(studio,{method:'POST',cookie:adminCookie,body:{action:'teamStatus',teamId:id,status:'inactive'}});
  assert.equal(revoke.statusCode,200);
  assert.equal((await invoke(studio,{action:'session',cookie})).body.user,null);
  assert.equal((await invoke(studio,{action:'project',cookie})).statusCode,401);
  const admin=await invoke(studio,{action:'admin',cookie:adminCookie});assert.equal(admin.statusCode,200);assert.ok(!JSON.stringify(admin.body).includes('passwordHash'));
});
test('legacy team storage corruption fails closed rather than overwriting accounts',async()=>{
  const store=new MemoryStore([],{legacy:true});store.data.set('teams','broken JSON');const {studio}=setup({store});
  const result=await invoke(studio,{method:'POST',body:{action:'register',cls:9,name:'test',password:'password'}});
  assert.equal(result.statusCode,503);assert.equal(await store.get('teams'),'broken JSON');
});
test('login throttling blocks repeated incorrect credentials',async()=>{
  const {studio}=setup();let result;
  for(let i=0;i<16;i++) result=await invoke(studio,{method:'POST',body:{action:'login',cls:9,name:'하늘',password:'wrong'}});
  assert.equal(result.statusCode,429);assert.equal(result.body.code,'LOGIN_THROTTLED');
});
test('project saves are session-scoped and prevent cross-team overwrites',async()=>{
  const {studio}=setup();const {cookie:a}=await loginCookie(studio);const {cookie:b}=await loginCookie(studio,'바다','other-password');
  const project={...emptyProject(),title:'A only',code:validCode};
  const saved=await invoke(studio,{method:'POST',cookie:a,body:{action:'save',teamId:teamId(legacyTeams()[1]),revision:0,project}});
  assert.equal(saved.statusCode,200);assert.equal(saved.body.revision,1);
  const other=await invoke(studio,{action:'project',cookie:b});assert.equal(other.body.revision,0);assert.notEqual(other.body.project.title,'A only');
});
test('concurrent stale saves allow exactly one commit and preserve winner',async()=>{
  const {studio}=setup();const {cookie}=await loginCookie(studio);
  const responses=await Promise.all(['first','second'].map(title=>invoke(studio,{method:'POST',cookie,body:{action:'save',revision:0,project:{...emptyProject(),title}}})));
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,409]);
  const saved=await invoke(studio,{action:'project',cookie});assert.equal(saved.body.revision,1);assert.equal(saved.body.project.title,responses.find(r=>r.statusCode===200).body.project.title);
});
test('project schema preserves frontend records, text datasets, and verification details',()=>{
  const project={...emptyProject(),datasets:[{id:'data',name:'memo.txt',format:'text',text:'내용'}],messages:[{id:'msg',role:'assistant',text:'설명',prompt:'요청',checks:['확인'],warnings:['주의'],summary:'요약'}],records:[{id:'rec',prompt:'요청',help:'도움',verification:'검증',decision:'반영',stage:'STEP 4'}]};
  const sanitized=sanitizeProject(project);assert.equal(sanitized.datasets[0].format,'text');assert.deepEqual(sanitized.messages[0].checks,['확인']);assert.equal(sanitized.records[0].verification,'검증');
  assert.throws(()=>sanitizeProject({...emptyProject(),code:'한'.repeat(50000)}),{code:'CODE_TOO_LARGE'});
});
test('atomic reservations admit one in-flight request per team and release on settlement',async()=>{
  const {ctx}=setup();const settings=normalizeSettings({});const user={id:teamId(legacyTeams()[0]),role:'student'};
  const results=await Promise.allSettled([reserveUsage(ctx,user,settings,100,MODELS.gpt),reserveUsage(ctx,user,settings,100,MODELS.gpt)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'AI_BUSY');
  const reservation=results.find(r=>r.status==='fulfilled').value;
  await settleUsage(ctx,reservation,MODELS.gpt,{inputTokens:100,outputTokens:100});
  const usage=await getUsage(ctx,user,settings);assert.equal(usage.requests,1);assert.equal(usage.reservedCostUsd,0);assert.equal(usage.estimatedCostUsd,0.0012);
  await settleUsage(ctx,reservation,MODELS.gpt,{inputTokens:100,outputTokens:100});
  assert.equal((await getUsage(ctx,user,settings)).estimatedCostUsd,0.0012);
});
test('global quota is shared atomically between different teams',async()=>{
  const {ctx}=setup();const settings=normalizeSettings({globalDailyRequests:1});
  const results=await Promise.allSettled(legacyTeams().map(t=>reserveUsage(ctx,{id:teamId(t),role:'student'},settings,100,MODELS.gpt)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'QUOTA_EXCEEDED');
});
test('cost reservation blocks unaffordable requests before any model call',async()=>{
  const {ctx}=setup();const settings=normalizeSettings({schoolDailyUsd:0.1});
  await assert.rejects(reserveUsage(ctx,{id:teamId(legacyTeams()[0]),role:'student'},settings,100,MODELS.gpt),{code:'QUOTA_EXCEEDED'});
  const usage=await getUsage(ctx,{id:teamId(legacyTeams()[0]),role:'student'},settings);assert.equal(usage.requests,0);
});
test('unknown provider outcome keeps conservative cost instead of enabling free retries',async()=>{
  const {ctx}=setup();const settings=normalizeSettings({});const user={id:teamId(legacyTeams()[0]),role:'student'};
  const reservation=await reserveUsage(ctx,user,settings,100,MODELS.gpt);
  await settleUsage(ctx,reservation,MODELS.gpt,null);const usage=await getUsage(ctx,user,settings);
  assert.equal(usage.reservedCostUsd,0);assert.equal(usage.estimatedCostUsd,reservation.amount/1000000);
});
test('usage day boundaries follow Korea time',()=>{
  assert.equal(dateKeys(Date.parse('2026-10-22T14:59:59Z')).date,'2026-10-22');
  assert.equal(dateKeys(Date.parse('2026-10-22T15:00:00Z')).date,'2026-10-23');
});
test('AI receives the complete current code and explicitly labeled dataset samples',async()=>{
  let payload;const fetchImpl=async(url,init)=>{payload=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/responses');return providerResponse(validAIResult());};
  const {studio,ai}=setup({fetchImpl});const {cookie}=await loginCookie(studio);
  const code='<!DOCTYPE html><html><body>'+(' '.repeat(6000))+'LAST_CODE_MARKER</body></html>';
  const project={...emptyProject(),code,datasets:[{id:'csv',name:'counts.csv',format:'csv',text:'name,value\n'+Array.from({length:20},(_,i)=>`row${i},${i}`).join('\n')}]};
  const result=await invoke(ai,{method:'POST',cookie,body:{mode:'edit',provider:'gpt',prompt:'검색을 추가해줘',project}});
  assert.equal(result.statusCode,200);assert.equal(result.body.code,validCode);assert.equal(payload.store,false);assert.equal(payload.model,'gpt-6.1-sol');
  const context=JSON.parse(payload.input[1].content[0].text);assert.equal(context.project.currentCode,code);assert.equal(context.datasets[0].totalDataRows,20);assert.equal(context.datasets[0].sampleRowsCount,8);assert.equal(context.datasets[0].truncated,true);
  assert.equal(result.body.usage.remaining,11);assert.equal(result.body.usage.lastRequest.inputTokens,100);
});
test('incomplete provider output never becomes usable code and still records reported usage',async()=>{
  const {studio,ai}=setup({fetchImpl:async()=>providerResponse(validAIResult(),{status:'incomplete'})});const {cookie}=await loginCookie(studio);
  const result=await invoke(ai,{method:'POST',cookie,body:{provider:'gpt',prompt:'만들어줘',project:emptyProject()}});
  assert.equal(result.statusCode,502);assert.equal(result.body.code,'TRUNCATED_AI_RESULT');assert.equal(result.body.summary,undefined);assert.equal(result.body.usage.inputTokens,100);assert.equal(result.body.usage.remaining,11);
});
test('Claude uses explicit forced structured tool output with no silent fallback',async()=>{
  let payload;const {studio,ai}=setup({fetchImpl:async(url,init)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');payload=JSON.parse(init.body);return {ok:true,status:200,json:async()=>({stop_reason:'tool_use',usage:{input_tokens:50,output_tokens:100},content:[{type:'tool_use',name:'submit_webapp',input:validAIResult()}]})};}});
  const {cookie}=await loginCookie(studio);const result=await invoke(ai,{method:'POST',cookie,body:{provider:'claude',prompt:'만들어줘',project:emptyProject()}});
  assert.equal(result.statusCode,200);assert.equal(payload.model,'claude-sonnet-5-5');assert.equal(payload.tool_choice.name,'submit_webapp');assert.equal(result.body.provider,'claude');
});
test('explain mode cannot replace project code',async()=>{
  const {studio,ai}=setup({fetchImpl:async()=>providerResponse(validAIResult())});const {cookie}=await loginCookie(studio);
  const result=await invoke(ai,{method:'POST',cookie,body:{mode:'explain',provider:'gpt',prompt:'설명해줘',project:{...emptyProject(),code:validCode}}});assert.equal(result.statusCode,200);assert.equal(result.body.code,'');
});
test('paused AI and disabled providers never call a model',async()=>{
  let calls=0;const {studio,ai,store}=setup({fetchImpl:async()=>{calls++;return providerResponse(validAIResult());}});const {cookie}=await loginCookie(studio);
  await store.set(PREFIX+'settings',normalizeSettings({aiEnabled:false}));
  const result=await invoke(ai,{method:'POST',cookie,body:{provider:'gpt',prompt:'요청',project:emptyProject()}});assert.equal(result.statusCode,403);assert.equal(calls,0);
});
test('CSV context handles quoted commas/newlines and does not invent full-data statistics',()=>{
  const parsed=parseDelimited('\uFEFFname,value\r\n"a,b",1\r\n"line\nbreak",2');assert.equal(parsed.rows.length,3);assert.equal(parsed.rows[1][0],'a,b');assert.equal(parsed.rows[2][0],'line\nbreak');
  const sample=datasetContext({id:'t',name:'t.csv',format:'csv',text:'name,value\na,1\nb,2'});assert.equal(sample.totalDataRows,2);assert.equal(sample.truncated,false);assert.equal(sample.mean,undefined);
});
test('retired endpoints cannot execute old unauthenticated actions',async()=>{
  const result=await invoke(retiredHandler,{method:'POST',body:{action:'approve',model:'gpt'}});assert.equal(result.statusCode,410);assert.equal(result.body.code,'API_RETIRED');
});
test('Redis adapter uses atomic EVAL and sends bearer credentials only to configured storage',async()=>{
  let command;const store=new RedisStore({url:'https://kv.test',token:'synthetic-token',fetchImpl:async(url,init)=>{assert.equal(url,'https://kv.test');assert.equal(init.headers.Authorization,'Bearer synthetic-token');command=JSON.parse(init.body);return {ok:true,json:async()=>({result:JSON.stringify({ok:true})})};}});
  const result=await store.reserve(['a','b','c','d','e'],{teamRequests:1},20,'rid');assert.equal(result.ok,true);assert.equal(command[0],'EVAL');assert.equal(command[1],RESERVE_SCRIPT);assert.equal(command[2],5);assert.ok(SETTLE_SCRIPT.includes("'KEEPTTL'"));
});
test('malformed HTTP 200 KV responses fail closed instead of resetting safety settings',async()=>{
  const samples=[{},[],null,{message:'temporarily unavailable'},{result:undefined}];
  for(const data of samples) {
    const store=new RedisStore({url:'https://kv.test',token:'synthetic-token',fetchImpl:async()=>({ok:true,json:async()=>data})});
    await assert.rejects(store.get(PREFIX+'settings'),{code:'STORAGE_UNAVAILABLE',status:503});
  }
  const invalidJson=new RedisStore({url:'https://kv.test',token:'synthetic-token',fetchImpl:async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}})});
  await assert.rejects(invalidJson.get(PREFIX+'settings'),{code:'STORAGE_UNAVAILABLE'});
  const missingKey=new RedisStore({url:'https://kv.test',token:'synthetic-token',fetchImpl:async()=>({ok:true,json:async()=>({result:null})})});
  assert.equal(await missingKey.get('missing'),null);
  await assert.rejects(missingKey.throttle('login',60),{code:'STORAGE_UNAVAILABLE'});
  await assert.rejects(missingKey.set('settings',{}),{code:'STORAGE_UNAVAILABLE'});
});
test('AI may ask for needed information with empty code, but whitespace and fragments stay rejected',()=>{
  const result=normalizeResult({summary:'현재 코드를 먼저 가져와주세요.',code:'',checks:['현재 코드 불러오기'],warnings:[]},'debug');assert.equal(result.code,'');
  assert.throws(()=>normalizeResult({...result,code:'   '},'debug'),{code:'INCOMPLETE_CODE'});
  assert.throws(()=>normalizeResult({...result,code:'<h1>일부 코드</h1>'},'debug'),{code:'INCOMPLETE_CODE'});
});
test('v2 team store imports once, rejects legacy forged hashes, and ignores later v1 writes',async()=>{
  const forged=securedTeams();forged[0].passwordResetRequired=false;forged[0].sessionVersion=999;
  const store=new MemoryStore(forged,{legacy:true});const {studio}=setup({store});
  const original=await store.get('teams');
  await invoke(studio,{action:'teams',query:{cls:'9'}});
  const imported=decodeStored(await store.get(TEAM_STORE_KEY));
  assert.equal(imported[0].passwordHash,undefined);assert.equal(imported[0].passwordResetRequired,true);assert.equal(imported[0].sessionVersion,0);
  const blocked=await invoke(studio,{method:'POST',body:{action:'login',cls:'9',name:'하늘',password:'legacy-short'}});
  assert.equal(blocked.body.code,'LEGACY_PASSWORD_RESET');assert.equal(await store.get('teams'),original);
  await store.set('teams',[{grade:'2',cls:'9',name:'외부 주입',password:'attacker',status:'active'}]);
  const after=await invoke(studio,{action:'teams',query:{cls:'9'}});
  assert.equal(after.body.teams.length,2);assert.ok(!after.body.teams.some(t=>t.name==='외부 주입'));
  const registered=await invoke(studio,{method:'POST',body:{action:'register',cls:'9',name:'새 계정',password:'new-team-password'}});
  assert.equal(registered.statusCode,201);assert.equal(decodeStored(await store.get('teams')).length,1);assert.equal(decodeStored(await store.get(TEAM_STORE_KEY)).length,3);
});
