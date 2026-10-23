// Test-only deterministic KV implementation. Production never imports this file.
import { PREFIX } from '../lib/server/store.mjs';
import { blankUsage } from '../lib/server/usage.mjs';
import { scryptSync } from 'node:crypto';

export class MemoryStore {
  configured=true;
  constructor(teams=[],{legacy=false}={}) {this.data=new Map([[legacy?'teams':PREFIX+'teams',JSON.stringify(JSON.stringify(teams))]]);}
  async get(key) {return this.data.get(key)??null;}
  async mget(keys) {return keys.map(key=>this.data.get(key)??null);}
  async set(key,value) {this.data.set(key,JSON.stringify(value));return 'OK';}
  async cas(key,expected,value) {
    if((this.data.get(key)??null)!==(expected??null)) return false;
    this.data.set(key,JSON.stringify(value));return true;
  }
  async throttle(key) {const n=Number(this.data.get(key)||0)+1;this.data.set(key,String(n));return n;}
  async reserve(keys,limits,amount,id) {
    const states=keys.slice(0,3).map(k=>JSON.parse(this.data.get(k)||JSON.stringify(blankUsage())));
    const [t,d,m]=states;
    if(this.data.has(keys[3])) return {ok:false,reason:'busy'};
    if(t.requests>=limits.teamRequests) return {ok:false,reason:'team_requests'};
    if(d.requests>=limits.schoolRequests) return {ok:false,reason:'school_requests'};
    for(const [state,budget,reason] of [[t,limits.teamMicros,'team_budget'],[d,limits.dayMicros,'school_budget'],[m,limits.monthMicros,'month_budget']]) {
      if(state.spentMicros+state.reservedMicros+amount>budget) return {ok:false,reason};
    }
    states.forEach((state,i)=>{state.requests++;state.reservedMicros+=amount;this.data.set(keys[i],JSON.stringify(state));});
    this.data.set(keys[3],id);this.data.set(keys[4],JSON.stringify({id,amount,settled:false}));
    return {ok:true};
  }
  async settle(keys,id,micros,inputTokens,outputTokens) {
    const raw=this.data.get(keys[4]);if(!raw)return 0;
    const r=JSON.parse(raw);if(r.id!==id||r.settled)return 0;
    keys.slice(0,3).forEach(k=>{
      const state=JSON.parse(this.data.get(k));state.reservedMicros=Math.max(0,state.reservedMicros-r.amount);state.spentMicros+=micros;state.inputTokens+=inputTokens;state.outputTokens+=outputTokens;this.data.set(k,JSON.stringify(state));
    });
    if(this.data.get(keys[3])===id)this.data.delete(keys[3]);r.settled=true;this.data.set(keys[4],JSON.stringify(r));return 1;
  }
}
export const legacyTeams=()=>[
  {grade:'2',cls:'9',name:'하늘',password:'legacy-short',members:'SYNTHETIC STUDENTS ONLY',status:'active'},
  {grade:'2',cls:'9',name:'바다',password:'other-password',status:'active'},
];
export const securedTeams=()=>legacyTeams().map((team,index)=>{
  const salt=String(index+1).repeat(32);
  const {password,...safe}=team;
  return {...safe,passwordHash:`scrypt-v1$${salt}$${scryptSync(password,salt,64).toString('hex')}`,sessionVersion:1};
});
export const testEnv=()=>({KV_REST_API_TOKEN:'test-only-kv-token',SESSION_SECRET:'test-only-session-secret',ADMIN_PASSWORD:'test-only-teacher-password',OPENAI_KEY:'test-only-openai-key',CLAUDE_KEY:'test-only-claude-key'});
export const testNow=()=>Date.parse('2026-10-23T01:00:00.000Z');
export function request({method='GET',action,body,cookie='',origin='https://school.test',query={}}={}) {
  return {method,query:{...(action?{action}:{}),...query},body,headers:{host:'school.test',origin,'x-forwarded-proto':'https',cookie,'x-real-ip':'127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
}
export async function invoke(handler,options={}) {
  const response={statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(value){this.body=value;return this;}};
  await handler(request(options),response);return response;
}
export function cookieOf(response) {return response.headers['set-cookie']?.split(';')[0]||'';}
export async function loginCookie(studio,name='하늘',password='legacy-short') {
  const response=await invoke(studio,{method:'POST',body:{action:'login',cls:'9',name,password}});
  if(response.statusCode!==200)throw new Error('Synthetic login failed: '+JSON.stringify(response.body));
  return {cookie:cookieOf(response),response};
}
export function providerResponse(result,{status='completed',usage={input_tokens:100,output_tokens:200}}={}) {
  return {ok:true,status:200,json:async()=>({status,usage,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};
}
export const validCode='<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>Test</title></head><body><h1>합성 테스트</h1></body></html>';
export const validAIResult=()=>({summary:'검색 기능을 추가했습니다.',code:validCode,checks:['미리보기에서 실제 데이터로 검색하세요.'],warnings:[]});
