import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as workspace from '../lib/workspace.mjs';

// Runs the actual client with an isolated DOM/transport adapter. No real login,
// credentials, storage or provider calls; live layout is checked separately.
const source=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace(/\ninit\(\);\s*$/,'');
const A={id:'team_a',name:'A',cls:'1',role:'student'},B={id:'team_b',name:'B',cls:'1',role:'student'};
const project=label=>({...workspace.emptyProject(),title:label,code:'<!doctype html><html><body>'+label+'</body></html>',datasets:[{id:label,name:label+'.csv',format:'csv',text:'항목,値\n'+label+',1'}],messages:[{role:'user',text:label,createdAt:'2026-10-26'}]});
const config={providers:[{id:'gpt',available:true,enabled:true}],defaultProvider:'gpt',aiEnabled:true};
const response=body=>({ok:true,json:async()=>body});
function app(transport) {
  const nodes=new Map(),events=new Map(),storage=new Map();
  class Element {
    constructor(key=''){this.key=key;this.value='';this.hidden=false;this.innerHTML='';this.textContent='';this.dataset={};this.listeners={};this.attributes={};this.files=[];this.classList={add(){},remove(){},toggle(){}};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    cloneNode(){const next=new Element(this.key);next.hidden=this.hidden;return next;}
    replaceWith(node){nodes.set(this.key,node);}
    prepend(){}focus(){}querySelectorAll(){return [];}querySelector(){return new Element();}
  }
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element(selector));return nodes.get(selector);};
  const context=vm.createContext({...workspace,console,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,URL,AbortSignal,Intl,setTimeout:()=>1,clearTimeout(){},confirm:()=>true,fetch:async(url,options)=>transport?transport(url,options):response({teamId:options.headers['x-hyfl-team-id'],project:project(options.headers['x-hyfl-team-id']),revision:0}),localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener(){}},window:{addEventListener:(name,fn)=>events.set(name,fn)}});
  vm.runInContext(source,context);
  return {context,node,events,storage,run:code=>vm.runInContext(code,context),enter:user=>{context.testUser=user;context.testConfig=config;return vm.runInContext('enterWorkspace({user:testUser,config:testConfig})',context);}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test('team switching clears drafts, API paste, preview, history and pending results; caches restore only their owner',async()=>{
  const ui=app();ui.storage.set('hyfl-studio-v2:team_b',JSON.stringify({ownerId:A.id,project:project('WRONG_OWNER'),dirty:true,revision:0}));
  await ui.enter(A);ui.run('state.pending={code:"A_PENDING"};state.recovery={title:"A_RECOVERY"};state.dirty=true;cacheProject()');
  ui.node('#prompt-input').value='A_DRAFT';ui.node('#api-response-text').value='A_PASTE';ui.node('#code-editor').hidden=false;
  await ui.enter(B);
  assert.equal(ui.node('#prompt-input').value,'');assert.equal(ui.node('#api-response-text').value,'');assert.equal(ui.node('#code-editor').hidden,true);
  assert.equal(ui.run('state.pending'),null);assert.equal(ui.run('state.recovery'),null);assert.equal(ui.run('state.project.title'),B.id);
  for(const key of ['#chat-messages','#dataset-list','#versions-list','#code-editor','#preview-frame'])assert.doesNotMatch(ui.node(key).innerHTML+ui.node(key).value+(ui.node(key).srcdoc||''),/team_a|WRONG_OWNER|A_PENDING|A_RECOVERY/);
  const saved=JSON.parse(ui.storage.get('hyfl-studio-v2:team_a'));assert.equal(saved.ownerId,A.id);assert.equal(saved.project.title,A.id);
  await ui.enter(A);assert.equal(ui.run('state.project.title'),A.id);assert.equal(ui.run('state.dirty'),true);
  ui.run('state.dirty=false');await ui.node('#logout-button').listeners.click();assert.equal(ui.run('state.user'),null);assert.equal(ui.run('state.project.datasets.length'),0);assert.equal(ui.node('#app-screen').hidden,true);
});

test('late file upload cannot install the previous team dataset after a team switch',async()=>{
  const ui=app();await ui.enter(A);const bytes=deferred();ui.context.file={name:'A_SECRET.csv',size:12,arrayBuffer:()=>bytes.promise};
  const loading=ui.run('loadDatasets([file])');await ui.enter(B);bytes.resolve(new TextEncoder().encode('항목,값\nA_SECRET,9'));
  await loading;assert.equal(ui.run('state.project.datasets[0].name'),B.id+'.csv');assert.doesNotMatch(ui.node('#dataset-list').innerHTML,/A_SECRET/);
});

for(const operation of ['AI','save'])test('late '+operation+' response cannot change the newly opened team',async()=>{
  const pending=deferred();const ui=app((url,options)=>url==='/api/ai'||JSON.parse(options.body||'{}').action==='save'?pending.promise:response({teamId:options.headers['x-hyfl-team-id'],project:project(options.headers['x-hyfl-team-id']),revision:0}));
  await ui.enter(A);let request;
  if(operation==='AI'){ui.node('#prompt-input').value='A_REQUEST';request=ui.run('requestAI({preventDefault(){}})');}
  else{ui.run('state.dirty=true');request=ui.run('saveNow()');}
  await ui.enter(B);pending.resolve(response({teamId:A.id,revision:99,summary:'A_RESPONSE',code:project('A_RESPONSE').code,usage:{requests:99}}));await request;
  assert.equal(ui.run('state.user.id'),B.id);assert.equal(ui.run('state.project.title'),B.id);assert.equal(ui.run('state.revision'),0);assert.equal(ui.run('state.busy'),false);assert.equal(ui.run('state.saving'),false);assert.doesNotMatch(JSON.stringify(ui.run('state.project')),/A_REQUEST|A_RESPONSE/);
});

test('a different tab login immediately hides the old workspace; same-team tabs keep their own project',async()=>{
  const ui=app();await ui.enter(A);ui.node('#prompt-input').value='A_PRIVATE';
  ui.events.get('storage')({key:'hyfl-studio-session-change',newValue:JSON.stringify({ownerId:A.id})});assert.equal(ui.run('state.user.id'),A.id);
  ui.events.get('storage')({key:'hyfl-studio-session-change',newValue:JSON.stringify({ownerId:B.id})});assert.equal(ui.run('state.user'),null);assert.equal(ui.node('#app-screen').hidden,true);assert.equal(ui.node('#prompt-input').value,'');assert.doesNotMatch(ui.node('#dataset-list').innerHTML,/team_a/);
});

test('unowned legacy and demo caches never appear as another team project',async()=>{
  const ui=app();ui.storage.set('hyfl-studio-v2:team_a',JSON.stringify({project:project('LEGACY_PRIVATE'),dirty:true,revision:0}));ui.storage.set('hyfl-studio-v2:demo',JSON.stringify({project:project('OLD_DEMO')}));
  await ui.enter(A);assert.equal(ui.run('state.project.title'),A.id);
  ui.run('enterWorkspace({},true)');assert.equal(ui.run('state.project.datasets.length'),0);
  ui.run('state.project.title="NEW_DEMO";cacheProject();enterWorkspace({},true)');assert.notEqual(ui.run('state.project.title'),'NEW_DEMO');assert.equal(JSON.parse(ui.storage.get('hyfl-studio-v2:demo')).project.title,'OLD_DEMO');
});

test('a response tagged for a different team clears the workspace before its data is displayed',async()=>{
  let wrong=false;
  const ui=app((url,options)=>response({teamId:wrong?B.id:options.headers['x-hyfl-team-id'],project:project(wrong?'B_SECRET':A.id),revision:0}));
  await ui.enter(A);wrong=true;
  await assert.rejects(ui.run('api("project")'),{code:'WORKSPACE_CHANGED'});
  assert.equal(ui.run('state.user'),null);assert.equal(ui.node('#app-screen').hidden,true);assert.equal(ui.run('state.project.datasets.length'),0);assert.doesNotMatch(ui.node('#dataset-list').innerHTML,/B_SECRET|team_a/);
});
