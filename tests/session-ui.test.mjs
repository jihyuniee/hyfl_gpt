import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as workspace from '../lib/workspace.mjs';
import * as studio from '../assets/studio-help.mjs';

// Runs the actual client with an isolated DOM/transport adapter. No real login,
// credentials, storage or provider calls; live layout is checked separately.
const source=readFileSync(new URL('../assets/app.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replace(/\ninit\(\);\s*$/,'');
const A={id:'team_a',name:'A',cls:'1',role:'student'},B={id:'team_b',name:'B',cls:'1',role:'student'};
const project=label=>({...workspace.emptyProject(),title:label,code:'<!doctype html><html><body>'+label+'</body></html>',datasets:[{id:label,name:label+'.csv',format:'csv',text:'항목,値\n'+label+',1'}],messages:[{role:'user',text:label,createdAt:'2026-10-26'}]});
const config={providers:[{id:'gpt',available:true,enabled:true}],defaultProvider:'gpt',aiEnabled:true};
const response=body=>({ok:true,json:async()=>body});
function app(transport) {
  const nodes=new Map(),events=new Map(),documentEvents=new Map(),storage=new Map(),clipboard=[];
  class Element {
    constructor(key=''){this.key=key;this.value='';this.hidden=false;this.innerHTML='';this.textContent='';this.dataset={};this.listeners={};this.attributes={};this.files=[];this.style={setProperty:(key,value)=>this.attributes['style:'+key]=value};this.classList={add(){},remove(){},toggle(){}};}
    addEventListener(name,fn){this.listeners[name]=fn;}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    cloneNode(){const next=new Element(this.key);next.hidden=this.hidden;return next;}
    replaceWith(node){nodes.set(this.key,node);}
    getBoundingClientRect(){return {left:100,width:1000};}setPointerCapture(id){this.pointerId=id;}contains(){return false;}
    prepend(){}focus(){}querySelectorAll(){return [];}querySelector(){return new Element();}
  }
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element(selector));return nodes.get(selector);};
  const context=vm.createContext({...workspace,...studio,console,crypto:webcrypto,structuredClone,TextEncoder,TextDecoder,URL,AbortSignal,Intl,navigator:{clipboard:{writeText:async value=>clipboard.push(value)}},setTimeout:()=>1,clearTimeout(){},confirm:()=>true,fetch:async(url,options)=>transport?transport(url,options):response({teamId:options.headers['x-hyfl-team-id'],project:project(options.headers['x-hyfl-team-id']),revision:0}),localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},document:{querySelector:node,querySelectorAll:()=>[],createElement:()=>new Element(),addEventListener:(name,fn)=>documentEvents.set(name,fn)},window:{addEventListener:(name,fn)=>events.set(name,fn)}});
  vm.runInContext(source,context);
  return {context,node,events,storage,clipboard,click:dataset=>documentEvents.get('click')({target:{closest:()=>({dataset})}}),run:code=>vm.runInContext(code,context),enter:user=>{context.testUser=user;context.testConfig=config;return vm.runInContext('enterWorkspace({user:testUser,config:testConfig})',context);}};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}

test('analysis and code-edit entry points prepare team requests without sending AI or changing work',async()=>{
  let requests=0;
  const ui=app((url,options)=>{requests++;return response({teamId:options.headers['x-hyfl-team-id'],project:project(options.headers['x-hyfl-team-id']),revision:0});});
  await ui.enter(A);requests=0;const before=ui.run('JSON.stringify(state.project)');
  assert.equal(ui.run('state.view'),'work');assert.equal(ui.node('#surface-chat').checked,true);
  for(const [id,mode] of [['analysis','build'],['edit','edit']]){
    await ui.click({action:'studio-open',id});assert.equal(ui.run('state.view'),'studio');
    await ui.click({action:'studio-request',id});assert.equal(ui.run('state.view'),'work');assert.equal(ui.run('state.mode'),mode);
    assert.match(ui.node('#prompt-input').value,/team_a.csv/);
  }
  assert.equal(requests,0);assert.equal(ui.run('JSON.stringify(state.project)'),before);
  await ui.enter(B);assert.doesNotMatch(ui.node('#studio-facts').innerHTML,/team_a/);assert.equal(ui.node('#prompt-input').value,'');
});

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


test('API help opens from the workspace and routes editable questions without calling AI or changing team data',async()=>{
  let requests=0;const ui=app((url,options)=>{requests++;return response({teamId:options.headers['x-hyfl-team-id'],project:project(A.id),revision:0});});
  await ui.enter(A);requests=0;const before=ui.run('JSON.stringify(state.project)');
  await ui.click({action:'api-help'});assert.equal(ui.run('state.view'),'guide');
  const examples=ui.run('apiHelpPrompts');assert.equal(examples.length,4);
  for(const item of examples){
    ui.node('#prompt-input').value='';
    await ui.click({prompt:item.prompt,promptMode:item.mode});
    assert.equal(ui.run('state.view'),'work');assert.equal(ui.run('state.mode'),item.mode);
    assert.equal(ui.node('#prompt-input').value,item.prompt);assert.equal(ui.node('#surface-chat').checked,true);
  }
  assert.equal(requests,0);assert.equal(ui.run('JSON.stringify(state.project)'),before);assert.equal(ui.run('state.dirty'),false);
});

test('declining a prompt replacement or having a request in progress preserves the student draft',async()=>{
  const ui=app();await ui.enter(A);ui.node('#prompt-input').value='우리 팀이 쓰던 요청';ui.context.confirm=()=>false;
  await ui.click({prompt:'다른 예시',promptMode:'explain'});assert.equal(ui.node('#prompt-input').value,'우리 팀이 쓰던 요청');assert.equal(ui.run('state.mode'),'build');
  ui.context.confirm=()=>true;ui.run('state.busy=true');
  await ui.click({prompt:'다른 예시',promptMode:'explain'});assert.equal(ui.node('#prompt-input').value,'우리 팀이 쓰던 요청');assert.equal(ui.run('state.mode'),'build');
});

test('copying an API example copies only the template and preserves the draft and team workspace',async()=>{
  const ui=app();await ui.enter(A);const before=ui.run('JSON.stringify(state.project)');ui.node('#prompt-input').value='우리 팀 초안';
  await ui.click({action:'copy-api-prompt',id:'0'});
  assert.equal(ui.clipboard.length,1);assert.equal(ui.clipboard[0],ui.run('apiHelpPrompts[0].prompt'));assert.match(ui.clipboard[0],/YOUR_API_KEY/);
  assert.equal(ui.node('#prompt-input').value,'우리 팀 초안');assert.equal(ui.run('JSON.stringify(state.project)'),before);
});

test('switching between wide conversation, wide result and split view preserves all student work',async()=>{
  const ui=app();await ui.enter(A);ui.node('#prompt-input').value='동으로 찾는 기능을 만들자';const before=ui.run('JSON.stringify(state.project)');
  for(const surface of ['chat','preview','split']){
    await ui.click({surface});
    for(const name of ['chat','preview','split'])assert.equal(ui.node('#surface-'+name).checked,name===surface);
    assert.equal(ui.node('#prompt-input').value,'동으로 찾는 기능을 만들자');assert.equal(ui.run('JSON.stringify(state.project)'),before);
  }
  await ui.enter(B);assert.equal(ui.node('#surface-split').checked,false);assert.equal(ui.node('#surface-chat').checked,true);assert.equal(ui.node('#prompt-input').value,'');
});

test('an unapplied preview cannot be silently discarded by another AI request; applying preserves the previous result',async()=>{
  let requests=0;const ui=app((url,options)=>{requests++;return response({teamId:options.headers['x-hyfl-team-id'],project:project(A.id),revision:0});});
  await ui.enter(A);requests=0;const previous=ui.run('state.project.code');
  ui.context.nextCode='<!doctype html><html><body>NEW_RESULT</body></html>';
  ui.run('state.pending={id:"pending",code:nextCode,before:state.project.code,datasets:JSON.stringify(state.project.datasets),summary:"동 선택"};renderPreview()');
  ui.node('#prompt-input').value='다음 요청';assert.equal(ui.node('#ai-submit').disabled,true);assert.equal(ui.node('#show-pending').hidden,false);
  await ui.run('requestAI({preventDefault(){}})');assert.equal(requests,0);assert.equal(ui.node('#prompt-input').value,'다음 요청');assert.equal(ui.node('#surface-preview').checked,true);assert.equal(ui.run('state.pending.code'),ui.context.nextCode);
  ui.run('applyProposal()');assert.equal(ui.run('state.project.code'),ui.context.nextCode);assert.equal(ui.run('state.project.versions.at(-1).code'),previous);assert.equal(ui.run('state.pending'),null);assert.equal(ui.node('#ai-submit').disabled,false);
});


test('dragging and keyboard resizing clamp panel width and persist only layout preferences',async()=>{
  const ui=app();await ui.enter(A);const before=ui.run('JSON.stringify(state.project)');ui.node('#prompt-input').value='KEEP_DRAFT';
  ui.run('initializeLayout();startResize({button:0,pointerId:7,preventDefault(){}});moveResize({pointerId:7,clientX:1100})');
  assert.equal(ui.run('layout.share'),68);assert.equal(ui.node('#app-screen').attributes['style:--chat-share'],'68%');
  ui.run('stopResize({pointerId:7})');assert.equal(ui.run('layout.drag'),null);
  ui.node('#workspace-divider').listeners.keydown({key:'Home',preventDefault(){}});assert.equal(ui.run('layout.share'),25);
  ui.node('#workspace-divider').listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(ui.run('layout.share'),60);
  await ui.node('#mobile-menu-button').listeners.click();assert.equal(ui.node('#app-sidebar').inert,true);
  const saved=JSON.parse(ui.storage.get('hyfl-studio-layout-v1'));assert.deepEqual(Object.keys(saved).sort(),['share','sidebarCollapsed']);assert.equal(saved.sidebarCollapsed,true);
  assert.equal(ui.run('JSON.stringify(state.project)'),before);assert.equal(ui.node('#prompt-input').value,'KEEP_DRAFT');
});

test('HTML attachments open the sandboxed result and mixed batches never overwrite existing work',async()=>{
  const ui=app();await ui.enter(A);const before=ui.run('state.project.code');
  ui.context.uploads=[{name:'app.html',size:100,text:async()=>'<h1>IMPORTED_APP</h1>'},{name:'data.csv',size:10,arrayBuffer:async()=>new TextEncoder().encode('a,b\n1,2')}];
  await ui.run('attachFiles(uploads)');assert.equal(ui.run('state.project.code'),before);
  await ui.run('attachFiles([uploads[0]])');assert.match(ui.run('state.project.code'),/IMPORTED_APP/);assert.equal(ui.node('#surface-split').checked,true);
});


test('changing layout recalculates the composer height so wrapped drafts do not stay clipped',async()=>{
  const ui=app();await ui.enter(A);ui.node('#prompt-input').value='KEEP_WRAPPED_DRAFT';
  ui.node('#prompt-input').scrollHeight=140;ui.run('setWorkspaceShare(30)');assert.equal(ui.node('#prompt-input').style.height,'140px');
  ui.node('#prompt-input').scrollHeight=61;ui.run('setSidebarCollapsed(true)');assert.equal(ui.node('#prompt-input').style.height,'61px');
  assert.equal(ui.node('#prompt-input').value,'KEEP_WRAPPED_DRAFT');
});

test('inline guides preserve a draft until insertion and never spend AI quota or change the project',async()=>{
  let requests=0;const ui=app((url,options)=>{requests++;return response({teamId:options.headers['x-hyfl-team-id'],project:project(A.id),revision:0});});
  await ui.enter(A);requests=0;const before=ui.run('JSON.stringify(state.project)');
  ui.node('#request-guide').open=true;
  for(const guide of studio.REQUEST_GUIDES){
    ui.node('#prompt-input').value='작성 중인 요청';
    await ui.click({action:'request-guide',id:guide.id});
    assert.equal(ui.node('#prompt-input').value,'작성 중인 요청');assert.match(ui.node('#request-guide-detail').innerHTML,new RegExp(guide.detail.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    ui.context.confirm=()=>false;await ui.click({action:'guide-draft',id:guide.id});assert.equal(ui.node('#prompt-input').value,'작성 중인 요청');
    ui.context.confirm=()=>true;await ui.click({action:'guide-draft',id:guide.id});assert.equal(ui.node('#prompt-input').value,guide.prompt);assert.equal(ui.run('state.mode'),guide.mode);
  }
  assert.equal(requests,0);assert.equal(ui.run('JSON.stringify(state.project)'),before);
  await ui.enter(B);assert.equal(ui.node('#request-guide').open,false);assert.equal(ui.node('#prompt-input').value,'');assert.equal(ui.run('state.view'),'work');
});

test('preview controls track open state on desktop and narrow screens without losing the request',async()=>{
  const ui=app();await ui.enter(A);ui.node('#prompt-input').value='KEEP_DRAFT';const before=ui.run('JSON.stringify(state.project)');
  await ui.click({surface:'split'});assert.equal(ui.node('#open-result').attributes['aria-expanded'],'true');assert.equal(ui.node('#open-result').dataset.surface,'chat');
  await ui.click({surface:'preview'});assert.equal(ui.node('#surface-preview').checked,true);
  await ui.click(ui.node('#open-result').dataset);assert.equal(ui.node('#surface-chat').checked,true);assert.equal(ui.node('#open-result').attributes['aria-expanded'],'false');
  ui.context.window.matchMedia=()=>({matches:true});await ui.click({surface:'split'});assert.equal(ui.node('#surface-preview').checked,true);
  await ui.click(ui.node('#open-result').dataset);assert.equal(ui.node('#surface-chat').checked,true);
  assert.equal(ui.node('#prompt-input').value,'KEEP_DRAFT');assert.equal(ui.run('JSON.stringify(state.project)'),before);
});
