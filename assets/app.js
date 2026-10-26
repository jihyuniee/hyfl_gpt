import { LIMITS, emptyProject, normalizeProject, fitProject, replaceCode, decodeDatasetBytes, describeDataset, apiResponseNotice, importApiResponse, buildDocument, importHtml, buildQuickChart, exportConversation, safeFilename, byteLength, uid, now } from '/lib/workspace.mjs';
import { WORKSHEET_TASKS, worksheetFacts, worksheetRequest } from './worksheet-help.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const text = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
const show = (selector, visible = true) => { const el = $(selector); if (el) el.hidden = !visible; };
const fmtTime = value => { try { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value)); } catch { return ''; } };
const modeNames = { build: '자동 작업', edit: '기능 수정', debug: '오류 해결', explain: '질문·해석' };
const workPrompts = [
  {label:'표·그래프 만들기',mode:'build',prompt:'첨부한 전체 자료를 읽어 데이터에 맞는 표와 그래프를 실제로 만들어줘. 연도·지역·항목을 고르며 살펴볼 수 있게 하고, 결측·단위·범위를 표시해줘. 기획 설명에서 멈추지 말고 실행 가능한 결과를 만들어줘. 없는 수치나 원인을 지어내지 마.'},
  {label:'데이터 비교·분석',mode:'build',prompt:'첨부한 자료에서 비교할 수 있는 항목을 확인하고 실제 전체 데이터로 비교 표와 그래프를 만들어줘. 같은 지역·기간·단위인지 확인하고, 다른 조건은 분리해줘. 상관관계를 원인으로 단정하지 말고, 비교가 가능한 범위와 추가로 필요한 자료를 짧게 알려줘.'},
  {label:'웹앱 만들기',mode:'build',prompt:'첨부 자료와 지금까지의 요청을 바탕으로 사용자가 입력하거나 조건을 골라 결과를 볼 수 있는 작은 웹앱을 실제로 만들어줘. 기존 HTML이 없어도 시작해줘. 필요한 기능은 [여기에 적기]. 전체 데이터를 사용하고, 출처·기준일·단위를 알 수 없으면 확인 필요로 표시해줘.'},
  {label:'현재 결과 고치기',mode:'edit',prompt:'지금 결과에서 [바꿀 부분]을 수정해줘. 나머지 정상 기능과 첨부 데이터 연결은 유지하고, 변경된 전체 HTML을 만들어줘.'},
  {label:'오류 해결',mode:'debug',prompt:'현재 결과에서 다음 오류를 고쳐줘. 내가 한 것: [입력·클릭] / 기대한 결과: [적기] / 실제 결과: [적기]. 현재 기능과 데이터를 보존하고 수정한 전체 HTML을 만들어줘.'},
  {label:'API 데이터 활용',mode:'build',prompt:'첨부한 공공 API 응답의 실제 행을 전체 파싱해 표·그래프 또는 필요한 기능을 만들어줘. 전체 건수와 현재 행 수, 오류를 확인하고 기상 category·단위·발표 회차·관측/예보·대상 시각을 구분해줘. 저장된 응답을 실시간 자료처럼 표시하지 마. 인증키를 요청하거나 코드에 넣지 마.'},
  {label:'데이터 구하기 도움',mode:'explain',prompt:'지금 요청한 프로젝트에 필요한 공공데이터를 구하는 일을 도와줘. 필요한 지역·기간·항목과 공식 기관, 검색어, 파일 또는 API 응답을 얻는 순서를 구체적으로 알려줘. 직접 검색·조회 도구가 연결되지 않았다면 조회했다고 말하거나 정확하지 않은 자료 주소를 만들지 마. 키를 요청하지 마.'},
];
// These examples prepare editable questions, never institution API requests.
const apiHelpPrompts = [
  {label:'인증키를 받았어요 · 첫 요청 준비',detail:'요청 주소와 필수 항목을 읽고, 공식 실행 화면에서 따라 할 순서를 도움받아요.',mode:'explain',prompt:`Open API 인증키를 발급받았는데 첫 데이터를 어떻게 요청해야 할지 모르겠어. 아래 공식 설명을 읽고 내가 실행할 수 있게 도와줘.
서비스 이름: [적기]
공식 문서 주소: [적기]
문서의 요청 주소와 필수·선택 요청인자 표: [인증키를 빼고 붙이기]
조회하고 싶은 지역·기간·항목: [적기]
활용 신청 상태: [승인 완료 / 대기 / 모름]

1. 어떤 조회 기능을 골라야 하는지, 각 필수 항목에 무엇을 넣는지 설명해줘.
2. 실제 키 대신 YOUR_API_KEY를 넣은 요청 예시를 만들어줘. 기관별 키 발급처와 Encoding/Decoding 사용법은 제공한 공식 설명을 따라줘.
3. 공식 사이트의 실행 화면이나 내 브라우저에서 요청하고 응답 본문을 저장하는 순서를 알려줘. JSON/XML 지원 여부와 성공 코드·행 수·다음 페이지 확인 방법도 알려줘.
기상은 관측/예보·발표/대상 시각·격자, 병원은 지역·검색 조건을 확인해줘. 문서가 부족하면 가장 필요한 부분부터 요청해줘. 주소만으로 문서를 읽었다거나 API를 호출했다고 말하지 말고, 실제 인증키는 요구하지 마.`},
  {label:'요청했는데 오류가 나요',detail:'키를 지운 요청 내용과 오류 메시지로 원인과 다음 확인 한 가지를 찾아요.',mode:'explain',prompt:`Open API 요청 오류를 해결하고 싶어.
서비스·조회 기능: [적기]
공식 문서의 요청 주소·인자 설명: [붙이기]
내 요청 주소·인자: [인증키 값을 YOUR_API_KEY로 바꾼 뒤 붙이기]
HTTP 상태와 응답의 오류 코드·메시지: [인증키·개인정보를 지우고 붙이기]
기대한 결과: [적기]

HTTP 상태, 기관의 결과 코드, 실제 데이터 유무를 나누어 읽어줘. 승인 상태·주소·필수 항목·키 인코딩·조회 시각/기간·호출 한도 중 근거가 있는 원인을 좁히고, 내가 다음에 바꿔 볼 한 가지를 알려줘. 기관마다 코드 의미가 다를 수 있으니 제공한 문서를 우선해줘. 실제 인증키나 전체 URL의 비밀 값을 요구하지 말고, 직접 실행하지 않았다면 해결됐다고 단정하지 마.`},
  {label:'응답은 받았어요 · 어떻게 읽나요?',detail:'행의 위치, 값·시간·단위, 전체 건수와 받은 건수를 확인해요.',mode:'explain',prompt:`공공 API 응답을 받았어. 첨부한 전체 자료 또는 아래 본문을 읽는 일을 도와줘.
서비스와 조회 조건: [키 없이 적기]
공식 문서의 응답 항목·코드·단위 설명: [붙이기]
응답 본문: [자료로 첨부했다면 이 줄을 지우기 / 키·개인정보 없는 본문 붙이기]

성공/오류 여부, 실제 데이터 행 경로, 한 행의 의미, 주요 열·단위를 설명해줘. 전체 건수·조회 조건에 맞는 건수·실제 받은 행 수를 구분하고 다음 페이지가 필요한지 확인해줘. 기상 관측값과 예보값, 발표 시각과 대상 시각을 섞지 말고 범주형 코드와 결측을 숫자 0으로 바꾸지 마.
JSON이면 스튜디오의 'API 응답 붙여넣기'로 연결하는 방법을 알려줘. XML이면 JSON 지원 여부를 문서에서 확인하고, 지원하지 않으면 원문을 TXT로 보존해 첨부하는 방법을 알려줘. XML 자동 행 인식이 된다고 말하지 마. 응답을 새로 받기 전에는 최신 정보로 갱신되지 않는다는 점도 짧게 알려줘.`},
  {label:'받은 데이터로 그래프·웹앱 만들기',detail:'전체 응답을 연결한 뒤, 조건을 고르면 결과가 나오는 앱을 실제로 만들어요.',mode:'build',prompt:`첨부한 전체 API 응답으로 실행 가능한 작은 웹앱을 만들어줘.
사용자가 고를 조건: [지역 / 날짜 / 항목 등]
보여줄 결과: [목록 / 그래프 / 지도 등]
공식 출처·응답 항목 설명: [알고 있는 내용 적기]

샘플 몇 행만 사용하지 말고 window.HYFL_DATASETS의 전체 원문을 읽어 필터·집계해줘. 실제 행 수와 전체 건수의 차이, 자료 없음·결측·단위를 표시해줘. 기상 항목·관측/예보·발표 회차·대상 시각은 구분해줘. XML TXT 자료라면 DOMParser로 실제 구조를 확인해 파싱하고, 오류 응답을 행으로 취급하지 마.
이 앱은 저장된 응답을 사용하는 버전으로 만들고 자료 시점을 표시해줘. 실시간 갱신 버튼이나 인증키를 넣지 마. 설명만 제안하지 말고 미리보기에서 실행하고 HTML로 내보낼 수 있는 전체 코드를 만들어줘.`},
];
const firstAppPrompt = {label:'조건을 골라 조회하기',mode:'build',prompt:'첨부 자료에서 지역·연도·항목처럼 조건으로 고를 수 있는 열을 확인해서, 조건을 선택하면 일치하는 행이 나오는 작은 웹앱을 만들어줘. 전체 데이터를 읽고 조건에 맞는 자료가 없으면 없다고 표시해줘. 자료에 없는 정보는 만들지 말고 실제로 실행되는 HTML을 만들어줘.'};
const state = { user: null, config: null, usage: null, project: emptyProject(), revision: 0, demo: false, mode: 'build', provider: 'gpt', view: 'work', worksheetTask: 'scope', dirty: false, generation: 0, workspaceVersion: 0, saving: false, conflict: false, busy: false, pending: null, errors: [], nonce: '', admin: null, recovery: null, aiError: '', saveTimer: null, localTimer: null };
const layout={share:48,sidebarCollapsed:false,drag:null};
const layoutKey="hyfl-studio-layout-v1";
let toastTimer;
function toast(message) { text('#toast', message); $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function errorMessage(error) { return error?.message || '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'; }

async function api(action, payload, path = '/api/studio', timeout = 15000) {
  const version=state.workspaceVersion;
  const owner=!state.demo?state.user?.id:null;
  const headers=payload===undefined?{}:{'Content-Type':'application/json'};
  if(owner&&!['login','teacherLogin','register','teams','config'].includes(action)) headers['x-hyfl-team-id']=owner;
  const bound=path==='/api/ai'||['project','save'].includes(action);
  let response;
  try {
    response = await fetch(payload === undefined ? `${path}?action=${encodeURIComponent(action)}` : path, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers, body: payload === undefined ? undefined : JSON.stringify(path === '/api/ai' ? payload : { action, ...payload }), signal: AbortSignal.timeout(timeout) });
  } catch (cause) {
    if(version!==state.workspaceVersion) throw staleWorkspace();
    const error = new Error(cause.name === 'TimeoutError' ? '응답이 지연되고 있습니다. 사용 기록을 확인한 뒤 다시 시도해주세요.' : '연결을 확인해주세요. 지금 작업은 이 브라우저에 임시 보관됩니다.');
    error.code = 'NETWORK_ERROR'; throw error;
  }
  let body;
  try { body = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
  if(version!==state.workspaceVersion) throw staleWorkspace();
  if (!response.ok) { const error = new Error(body.message || body.error || '요청을 완료하지 못했습니다.'); error.status = response.status; error.code = body.code; if(owner&&['AUTH_REQUIRED','WORKSPACE_CHANGED','WORKSPACE_RELOAD_REQUIRED'].includes(error.code)) leaveWorkspace(error.message); throw error; }
  if(bound&&(!owner||body.teamId!==owner)) { const error=new Error('작업의 팀이 일치하지 않습니다. 우리 팀으로 다시 로그인해주세요.'); error.code='WORKSPACE_CHANGED'; leaveWorkspace(error.message); throw error; }
  return body;
}

function cacheKey() { return `hyfl-studio-v2:${state.demo ? 'demo' : state.user?.id || 'anonymous'}`; }
function cacheProject() {
  if (state.demo||state.user?.role!=='student') return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ ownerId:state.user.id, project: fitProject(state.project), revision: state.revision, dirty: state.dirty, savedAt: now() })); }
  catch { text('#save-status', '임시 저장 공간 부족 · 백업을 내려받아 주세요'); }
}
function staleWorkspace() { const error=new Error('이전 팀의 요청 결과를 적용하지 않았습니다.');error.code='STALE_WORKSPACE';return error; }
function resetWorkspace() {
  clearTimeout(state.saveTimer);clearTimeout(state.localTimer);
  setWorkspaceSurface('chat');
  state.workspaceVersion++;state.user=null;state.demo=false;state.usage=null;state.project=emptyProject();state.revision=0;state.pending=null;state.recovery=null;state.dirty=false;state.saving=false;state.busy=false;state.conflict=false;state.aiError='';state.errors=[];state.admin=null;state.generation=0;
  state.worksheetTask='scope';
  for(const selector of ['#prompt-input','#api-response-name','#api-response-text','#code-file','#chat-dataset-file','#dataset-file','#project-file']) $(selector).value='';
  text('#api-response-status','');show('#conflict-banner',false);
  $('#code-toggle').setAttribute('aria-pressed','false');$('#code-toggle').classList.remove('active');show('#code-editor',false);show('#apply-code-button',false);
  text('#team-label','우리 팀');text('#project-heading',state.project.title);text('#save-status','팀 로그인 필요');
  renderAll();
}
function leaveWorkspace(message) {
  cacheProject();resetWorkspace();show('#app-screen',false);show('#auth-screen');authTab('student');text('#auth-message',message);
}
const sessionNoticeKey='hyfl-studio-session-change';
function announceSession() {try{localStorage.setItem(sessionNoticeKey,JSON.stringify({ownerId:state.user?.id||null,nonce:uid()}));}catch{}}
function markDirty() {
  state.dirty = true; state.generation++; text('#save-status', state.demo ? '이 브라우저에 저장 중' : '저장 대기 중');
  clearTimeout(state.localTimer); state.localTimer = setTimeout(cacheProject, 250);
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveNow, 1000);
  text('#project-heading', state.project.title);
}
async function saveNow() {
  clearTimeout(state.saveTimer);
  if (!state.dirty || state.saving || state.conflict || (!state.user && !state.demo)) return;
  let project;
  try { project = fitProject(state.project); } catch (error) { text('#save-status', errorMessage(error)); return; }
  if (state.demo) { state.dirty = false; text('#save-status', '둘러보기 · 이 화면에서만 유지'); return; }
  if (state.user.role !== 'student') return;
  state.saving = true; const generation = state.generation; const version=state.workspaceVersion; text('#save-status', '팀 작업 저장 중…');
  try {
    const result = await api('save', { project, revision: state.revision });
    state.revision = result.revision;
    if (state.generation === generation) { state.dirty = false; state.project.versions = project.versions; state.project.messages = project.messages; }
    cacheProject(); text('#save-status', state.dirty ? '새 변경 저장 대기 중' : '팀 작업 저장됨');
  } catch (error) {
    if(version!==state.workspaceVersion) return;
    if (error.status === 409) { state.conflict = true; show('#conflict-banner'); text('#save-status', '다른 기기의 변경을 확인해주세요'); }
    else { text('#save-status', '서버 저장 실패 · 이 기기에 임시 보관'); toast(errorMessage(error)); }
    cacheProject();
  } finally { if(version===state.workspaceVersion){state.saving = false; if (state.dirty && !state.conflict) state.saveTimer = setTimeout(saveNow, 12000);} }
}

function setView(view) {
  if (view === 'admin' && state.user?.role !== 'teacher') return;
  if (state.user?.role === 'teacher' && !['admin', 'guide'].includes(view)) return;
  state.view = view;
  $$('[data-panel]').forEach(el => { el.hidden = el.dataset.panel !== view; });
  $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('.sidebar')?.classList.remove('is-open');
  $('#mobile-menu-button').setAttribute('aria-expanded',String(!layout.sidebarCollapsed));
  if (view === 'admin') loadAdmin();
  if (view === 'worksheet') renderWorksheet();
}
function setWorkspaceSurface(surface) {
  if(!['split','chat','preview'].includes(surface))return;
  if(surface==='split'&&window.matchMedia?.('(max-width: 760px)').matches)surface='preview';
  for(const name of ['split','chat','preview'])$('#surface-'+name).checked=name===surface;
  resizePrompt();
}
function saveLayout(){try{localStorage.setItem(layoutKey,JSON.stringify({share:layout.share,sidebarCollapsed:layout.sidebarCollapsed}));}catch{}}
function setWorkspaceShare(value,{save=true}={}){
  if(!Number.isFinite(Number(value)))return;
  layout.share=Math.max(25,Math.min(75,Number(value)));
  $('#app-screen').style.setProperty('--chat-share',layout.share+'%');
  $('#workspace-divider').setAttribute('aria-valuenow',String(Math.round(layout.share)));
  resizePrompt();if(save)saveLayout();
}
function setSidebarCollapsed(collapsed,{save=true}={}){
  layout.sidebarCollapsed=Boolean(collapsed);$('#app-screen').dataset.sidebar=collapsed?'collapsed':'expanded';
  $('#app-sidebar').inert=Boolean(collapsed);$('#app-sidebar').setAttribute('aria-hidden',String(Boolean(collapsed)));
  $('#mobile-menu-button').setAttribute('aria-expanded',String(!collapsed));
  $('#mobile-menu-button').setAttribute('aria-label',collapsed?'사이드바 펼치기':'사이드바 접기');
  resizePrompt();if(save)saveLayout();
}
function resizePrompt(){
  const input=$('#prompt-input');input.style.height='0px';input.style.height=Math.max(44,Math.min(180,input.scrollHeight||44))+'px';
}
function startResize(event){
  if(event.button!==0&&event.pointerType!=='touch')return;
  const rect=$('.studio-grid').getBoundingClientRect();if(rect.width<650)return;
  event.preventDefault();layout.drag={left:rect.left,width:rect.width,pointerId:event.pointerId};
  $('#workspace-divider').setPointerCapture(event.pointerId);$('#app-screen').classList.add('is-resizing');
}
function moveResize(event){
  if(!layout.drag||event.pointerId!==layout.drag.pointerId)return;
  const {left,width}=layout.drag,min=Math.max(25,320/width*100);
  setWorkspaceShare(Math.max(min,Math.min(100-min,(event.clientX-left)/width*100)),{save:false});
}
function stopResize(event){
  if(!layout.drag||event.pointerId!==layout.drag.pointerId)return;
  layout.drag=null;$('#app-screen').classList.remove('is-resizing');saveLayout();
}
function initializeLayout(){
  let prefs;try{prefs=JSON.parse(localStorage.getItem(layoutKey)||'null');}catch{}
  setWorkspaceShare(prefs?.share??48,{save:false});
  setSidebarCollapsed(typeof prefs?.sidebarCollapsed==='boolean'?prefs.sidebarCollapsed:Boolean(window.matchMedia?.('(max-width: 760px)').matches),{save:false});
  resizePrompt();
}

function setMode(mode) {
  state.mode = mode;$('#mode-select').value=mode;
  $$('[data-mode]').forEach(el => { el.classList.toggle('active', el.dataset.mode === mode); el.setAttribute('aria-pressed', String(el.dataset.mode === mode)); });
  const placeholders = { build: '무엇을 만들거나 고칠까요? 파일을 함께 넣어도 됩니다.', edit: '예: 동을 바꾸면 이전 검색 결과가 지워지게 고쳐 줘.', debug: '예: 2020년을 골랐는데 결과가 비어 있어. 원자료에는 값이 있으니 고쳐 줘.', explain: '자료나 실행 결과에서 궁금한 점을 물어보세요.' };
  $('#prompt-input').placeholder = placeholders[mode];
  updateAiState();
}
function renderProviders() {
  const providers = state.config?.providers || [];
  const enabled = providers.filter(p => p.available && p.enabled !== false);
  const select = $('#provider-select');
  select.innerHTML = (enabled.length ? enabled : [{ id: '', label: state.demo ? '둘러보기 · AI 호출 없음' : '사용 가능한 AI가 없습니다' }]).map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.id === 'gpt' ? 'GPT' : p.id === 'claude' ? 'Claude' : p.label)}${p.model ? ` · ${escapeHTML(p.model)}` : ''}</option>`).join('');
  if (!enabled.some(p => p.id === state.provider)) state.provider = enabled.find(p => p.id === state.config?.defaultProvider)?.id || enabled[0]?.id || '';
  select.value = state.provider; select.disabled = state.demo || state.busy || !enabled.length;
  updateAiState();
}
function updateAiState() {
  const disabled = state.demo || state.user?.role !== 'student' || state.config?.aiEnabled === false || !state.provider || state.busy || state.conflict || Boolean(state.pending);
  $('#ai-submit').disabled = disabled;
  $('#ai-submit').textContent=state.busy?'…':'↑';$('#ai-submit').setAttribute('aria-label',state.busy?'AI 작업 중':state.mode==='explain'?'AI에게 물어보기':'요청 보내기');
  resizePrompt();
  if(state.busy)text('#ai-status',state.mode==='explain'?'답변을 준비하고 있습니다…':'웹앱을 만들고 있습니다. 결과가 준비되면 오른쪽에서 열립니다.');
  else if (state.aiError) text('#ai-status', state.aiError);
  else if(state.pending)text('#ai-status','수정안을 먼저 실행해 보세요. 적용하거나 원래 결과로 돌아온 뒤 다음 요청을 보낼 수 있습니다.');
  else if (state.demo) text('#ai-status', '둘러보기는 팀 자료를 불러오거나 저장하지 않습니다. 새로고침하면 초기화됩니다. AI는 팀 로그인 후 이용합니다.');
  else if (state.user?.role === 'teacher') text('#ai-status', '교사 화면에서는 운영 상태를 확인합니다. 학생은 팀 계정으로 작업합니다.');
  else if (state.config?.aiEnabled === false) text('#ai-status', '선생님이 AI 요청을 잠시 멈췄습니다. 코드 편집과 저장은 계속할 수 있습니다.');
  else if (!state.provider) text('#ai-status', 'AI 연결을 준비 중입니다. 선생님에게 알려주세요.');
  else text('#ai-status','Enter로 보내기 · Shift+Enter로 줄바꿈 · API 키·개인정보는 넣지 마세요.');
}
function renderUsage() {
  text('#usage-label', state.demo ? '둘러보기' : state.user?.role === 'teacher' ? '교사 관리' : state.usage ? `오늘 ${state.usage.requests ?? 0} / ${state.usage.dailyRequests ?? state.config?.limits?.dailyRequests ?? 12}회` : '사용량 확인 중');
  $('#usage-label').title = '한국 시간 기준. 이 사이트의 사용량이며, API 계정의 실제 잔액은 각 서비스에서 확인합니다.';
}

function renderChat() {
  const container = $('#chat-messages');
  if (!state.project.messages.length) {
    const hasData=state.project.datasets.length>0;
    const hasCode=Boolean(state.project.code.trim());
    const choices=[{label:'파일로 표·그래프 만들기',...workPrompts[0]},workPrompts[2]];
    container.innerHTML=`<div class="chat-welcome"><h3>${hasData?'이 자료로 무엇을 해볼까요?':hasCode?'만들던 작업을 이어가세요.':'지금 필요한 작업을 말해보세요.'}</h3><p>${hasData?'자료를 살펴보거나, 원하는 웹앱 기능을 요청하세요.':hasCode?'앱을 실행해 보고 고칠 부분이나 추가할 기능을 말하면 됩니다.':'파일을 넣고 분석하거나, 만들던 HTML을 가져와 고칠 수 있어요.'}</p><div class="prompt-suggestions">${choices.map(item=>`<button type="button" data-prompt="${escapeHTML(item.prompt)}" data-prompt-mode="${item.mode}">${item.label}<span aria-hidden="true">↗</span></button>`).join('')}<button type="button" data-action="import-app">만들던 앱 이어서 고치기<span aria-hidden="true">↗</span></button></div></div>`;
    return;
  }
  container.innerHTML=state.project.messages.map(m=>{
    const pending=state.pending?.id===m.id;
    return `<article class="message ${m.role}"><div class="message-meta"><strong>${m.role==='user'?'우리 팀':escapeHTML(m.provider==='claude'?'Claude':'GPT')}</strong><span>${escapeHTML(modeNames[m.mode]||'')}</span></div><div class="message-text">${escapeHTML(m.text)}</div>${m.role==='assistant'?`${m.model?`<div class="model-caption">${escapeHTML(m.model)}</div>`:''}${m.warnings?.length?`<details class="ai-warning"><summary>데이터·실행 확인</summary><ul>${m.warnings.map(v=>`<li>${escapeHTML(v)}</li>`).join('')}</ul></details>`:''}${m.checks?.length?`<details class="ai-checks"><summary>결과 확인 방법</summary><ul>${m.checks.map(v=>`<li>${escapeHTML(v)}</li>`).join('')}</ul></details>`:''}${pending?'<div class="proposal-actions"><button type="button" class="button primary small" data-action="apply-proposal">이 수정 적용</button><button type="button" class="button secondary small" data-action="inspect-proposal">코드 보기</button></div>':''}`:''}</article>`;
  }).join('');
  container.scrollTop=container.scrollHeight;
}
function renderProjectFields() {
  $('#project-title').value = state.project.title;
  for (const key of Object.keys(state.project.brief)) { const el = $(`#brief-${key}`); if (el) el.value = state.project.brief[key]; }
}
function renderDatasets() {
  renderWorksheet();
  const list = $('#dataset-list');
  const owner=state.demo?'둘러보기 자료 · 팀에 저장되지 않습니다.':state.user?.role==='student'?`2학년 ${state.user.cls}반 · ${state.user.name}의 자료 · 같은 팀원과 공유`:'팀 로그인 후 우리 팀 자료만 불러옵니다.';
  text('#data-owner-label',owner);text('#project-data-owner-label',owner);
  show('#composer-attachments',state.project.datasets.length>0);
  text('#attachment-count', state.project.datasets.length ? `${state.project.datasets.length}개 자료 연결 · 원문 전체 사용` : 'CSV · TSV · JSON · TXT');
  $('#chat-datasets').innerHTML=state.project.datasets.map(d=>`<button type="button" class="attachment-chip" data-view="project" title="연결된 자료 정보 보기">${escapeHTML(d.name)}</button>`).join('');
  if (!state.project.datasets.length) { list.innerHTML = '<div class="empty-state compact"><p>파일을 연결하면 바로 표·그래프를 볼 수 있어요.</p><small>파일 전체가 미리보기와 내려받은 웹앱에 함께 들어갑니다. 합계 320KB · 최대 8개</small></div>'; return; }
  list.innerHTML = state.project.datasets.map(d => {
    let notice = ''; let detail; try { detail = describeDataset(d); if (d.format === 'json') notice = apiResponseNotice(JSON.parse(d.text.replace(/^\uFEFF/, ''))); } catch { detail = { rows: null, columns: [], error: '파일 형식을 다시 확인해주세요.' }; }
    return `<article class="dataset-card"><div class="dataset-heading"><span class="file-badge">${escapeHTML(d.format.toUpperCase())}</span><div><strong>${escapeHTML(d.name)}</strong><p>${(byteLength(d.text) / 1024).toFixed(1)} KB · ${detail.rows === null ? '구조 확인 필요' : `${detail.rows.toLocaleString('ko-KR')}행`}${detail.columns.length ? ` · ${detail.columns.length}열` : ''}</p></div><button class="icon-button" type="button" data-action="remove-dataset" data-id="${escapeHTML(d.id)}" aria-label="${escapeHTML(d.name)} 삭제">×</button></div>${detail.columns.length ? `<p class="dataset-columns">${escapeHTML(detail.columns.slice(0, 12).join(' · '))}${detail.columns.length > 12 ? ' …' : ''}</p>` : ''}${detail.arrayPath ? `<p class="field-help">실제 행: ${escapeHTML(detail.arrayPath)}</p>` : ''}${notice ? `<p role="status">${escapeHTML(notice)}</p>` : ''}${detail.error ? `<p>${escapeHTML(detail.error)}</p>` : ''}<button type="button" class="button secondary small" data-action="quick-chart" data-id="${escapeHTML(d.id)}">표·그래프 바로 만들기</button></article>`;
  }).join('');
}
function renderVersions() {
  $('#versions-list').innerHTML = state.project.versions.length ? state.project.versions.map(v => `<article class="version-card"><div><span class="eyebrow">${fmtTime(v.createdAt)}</span><h3>${escapeHTML(v.note || '수정 전 버전')}</h3><p>${(byteLength(v.code) / 1024).toFixed(1)} KB · HTML 코드</p></div><button type="button" class="button secondary" data-action="restore-version" data-id="${escapeHTML(v.id)}">이 버전으로 복원</button></article>`).join('') : '<div class="empty-state"><h3>수정 전 코드를 보관합니다.</h3><p>코드를 가져오거나 AI 제안을 적용하면 이전 코드가 여기에 남습니다.<br>최근 6개까지 용량 안에서 보관합니다. 데이터·기록까지 보관하려면 프로젝트 백업을 내려받으세요.</p></div>';
}
function renderWorksheet() {
  const task=WORKSHEET_TASKS.find(t=>t.id===state.worksheetTask)||WORKSHEET_TASKS[0];
  text('#worksheet-materials',`연결 자료 ${state.project.datasets.length}개 · ${state.project.code.trim()?'현재 HTML 있음':'HTML 없이도 시작할 수 있어요'}`);
  $('#worksheet-tasks').innerHTML=WORKSHEET_TASKS.map(t=>`<button type="button" class="worksheet-task" data-action="worksheet-task" data-id="${t.id}" aria-pressed="${t.id===task.id}"><small>${t.step}</small><strong>${t.label}</strong></button>`).join('');
  $('#worksheet-detail').innerHTML=`<span class="worksheet-step-label">${task.step}</span><h3>${task.label}</h3><p>${task.detail}</p><ul class="worksheet-outputs">${task.outputs.map(v=>`<li>${v}</li>`).join('')}</ul><p class="worksheet-next">${task.question}</p><button type="button" class="button primary" data-action="worksheet-request" data-id="${task.id}">우리 팀 자료로 질문 준비</button><p class="worksheet-note">초안을 확인하고 전송하세요. 활동지 내용을 다시 입력할 필요는 없습니다.</p>`;
  $('#worksheet-facts').innerHTML=worksheetFacts(state.project).map(f=>`<details class="worksheet-file" open><summary>${escapeHTML(f.name)} <span>${f.rows===null?'행 단위 확인 필요':f.rows+'행'}</span></summary><p>${escapeHTML(f.notice||f.error||'첨부 파일의 실제 값입니다. 최대 3행·8열을 보여줍니다.')}</p>${f.columns.length?`<div class="worksheet-table-wrap"><table class="worksheet-table"><thead><tr>${f.columns.map(c=>`<th>${escapeHTML(c)}</th>`).join('')}</tr></thead><tbody>${f.sample.map(r=>`<tr>${r.map(v=>`<td>${escapeHTML(v===''?'(빈 값)':v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<pre>${escapeHTML(f.excerpt)}</pre>`}</details>`).join('')||'<div class="worksheet-empty">자료를 연결하면 실제 행과 열이 여기에 표시됩니다. 파일 없이도 문제 범위를 좁히는 도움을 받을 수 있어요.<div class="button-row"><button class="button secondary small" type="button" data-view="project">자료 연결하기</button><button class="button subtle small" type="button" data-action="api-help">API 도움</button></div></div>';
}
function renderGuide() {
  const teacher=state.user?.role==='teacher';
  const disabled=teacher?'disabled':'';
  $('#guide-content').innerHTML=`<section class="surface-card api-coach" aria-labelledby="api-help-title"><h3 id="api-help-title" tabindex="-1">API에서 막힌 부분을 고르세요.</h3><p>질문 초안을 넣고 [대괄호]를 우리 팀 내용으로 고치세요. 전송할 때 학교가 제공하는 AI로 도움받습니다. 예시 복사는 다른 생성형 AI에서도 쓸 수 있어요.</p><div class="api-help-tasks">${apiHelpPrompts.map((item,index)=>`<article class="api-help-task"><h4>${escapeHTML(item.label)}</h4><p>${escapeHTML(item.detail)}</p><div class="button-row"><button class="button secondary small" type="button" data-prompt="${escapeHTML(item.prompt)}" data-prompt-mode="${item.mode}" ${disabled}>질문 초안 넣기<span class="sr-only"> · ${escapeHTML(item.label)}</span></button><button class="button subtle small" type="button" data-action="copy-api-prompt" data-id="${index}">예시 복사<span class="sr-only"> · ${escapeHTML(item.label)}</span></button></div></article>`).join('')}</div><div class="api-help-boundary"><p><strong>데이터를 받기 전</strong> · 이곳의 AI는 요청 방법·오류를 설명합니다. 실제 요청은 공식 사이트의 실행 화면 등에서 합니다. 스튜디오가 인증키로 기관 API를 직접 호출하지는 않습니다.</p><p><strong>데이터를 받은 뒤</strong> · CSV·JSON 파일이나 JSON 응답을 연결해 표·그래프·웹앱을 만들고 실행·수정·HTML 내보내기를 합니다. 저장된 응답은 새로고침해도 최신 자료로 바뀌지 않습니다.</p><p>실제 인증키·개인정보는 입력하지 마세요. 요청 URL 속 키 값도 YOUR_API_KEY로 바꾸세요. 문서 주소만으로 내용을 읽을 수 없으니 요청 주소·인자 표의 필요한 부분을 함께 붙이세요. XML 자동 행 인식은 지원하지 않습니다.</p></div><details class="api-official-help"><summary>공식 설명에서 무엇을 가져오나요?</summary><p>기상: 관측/예보 기능, 발표·대상 시각, 격자 좌표와 단위. 병원: 지역·기관/진료 검색 조건, 응답 형식(JSON/XML). API마다 필수 항목과 키 사용법이 다릅니다.</p><p>키는 공식 실행 환경에만 넣으세요. Encoding/Decoding 중 무엇을 쓰는지는 실행 도구의 설명을 따르며 이미 인코딩된 키를 다시 인코딩하지 않도록 확인하세요. 전체 건수보다 받은 행이 적으면 페이지별 응답을 더 받아야 할 수 있습니다.</p><div class="source-links"><a href="https://www.data.go.kr/data/15084084/openapi.do" target="_blank" rel="noopener noreferrer">기상청 단기예보 조회 설명 ↗</a><a href="https://www.data.go.kr/data/15000736/openapi.do" target="_blank" rel="noopener noreferrer">전국 병·의원 찾기 설명 ↗</a></div></details></section><section class="surface-card"><h3 id="work-help-title" tabindex="-1">자료와 요청으로 바로 시작하세요.</h3><p>① 자료 첨부 → ② 원하는 작업 요청 → ③ 결과 실행·수정. 기록은 기존 활동지에 남깁니다.</p><div class="guide-tasks">${workPrompts.map(item=>`<button class="guide-task" type="button" data-prompt="${escapeHTML(item.prompt)}" data-prompt-mode="${item.mode}" ${disabled}><strong>${item.label}</strong><span>→</span></button>`).join('')}</div></section><section class="surface-card guide-boundaries"><h3>자료와 결과</h3><p>CSV·TSV·JSON을 첨부하면 AI 호출 없이 전체 파일로 표·그래프를 먼저 만듭니다. 작은 자료는 AI에도 전체 행을 전달하며 큰 자료는 기초 통계와 구조를 전달합니다. 실행 코드는 연결한 전체 데이터를 읽습니다.</p><p>데이터가 없으면 AI가 실제 수치를 만들어낼 수 없습니다. 공식 자료를 찾는 방법을 물어보거나 파일·응답을 연결하세요. KOSIS MCP 자동 조회와 실시간 API 호출은 현재 연결되어 있지 않습니다.</p><p>대화는 저장·내보내기에서 내려받을 수 있습니다. 활동지와 최종 제출은 기존 구글 클래스룸에서 진행하세요.</p></section>`;
}
function usePromptDraft(prompt,mode='build') {
  if(state.user?.role==='teacher')return;
  if(state.busy){toast('진행 중인 AI 요청이 끝난 뒤 초안을 넣어주세요.');return;}
  const previous=$('#prompt-input').value.trim();
  if(previous&&previous!==prompt.trim()&&!confirm('작성 중인 요청을 이 예시로 바꿀까요?'))return;
  setView('work');setWorkspaceSurface('chat');setMode(mode);
  $('#prompt-input').value=prompt;resizePrompt();$('#prompt-input').focus();
  toast('초안을 넣었습니다. 대괄호 내용을 고친 뒤 전송하세요. 아직 AI 사용량은 차감되지 않았습니다.');
}

function renderPreview() {
  state.errors = []; state.nonce = uid(); renderErrors();
  const code = state.pending?.code || state.project.code;
  show('#proposal-banner', Boolean(state.pending));show('#show-pending',Boolean(state.pending));updateAiState();
  const hasCode = Boolean(code.trim()); show('#workspace-empty', !hasCode); show('#preview-frame', hasCode);
  // A fresh browsing context also paints reliably after the workspace was
  // hidden. Reusing an opaque srcdoc frame left a calculated but blank result
  // in deployed Chromium. Preserve all sandbox/referrer attributes.
  const previousFrame = $('#preview-frame');
  const frame = previousFrame.cloneNode(false);
  frame.removeAttribute('srcdoc');
  previousFrame.replaceWith(frame);
  if (hasCode) frame.srcdoc = buildDocument(code, state.project.datasets, { preview: true, nonce: state.nonce });
  $('#code-editor').value = code;
  $('#download-html').disabled = !hasCode;$('#open-result').disabled=!hasCode;
}
function renderErrors() {
  $('#runtime-errors').innerHTML = state.errors.length ? `<div class="error-heading"><strong>실행 중 확인된 오류 ${state.errors.length}개</strong><button class="button secondary small" type="button" data-action="debug-errors">이 오류를 AI와 해결</button></div>${state.errors.slice(-4).map(e => `<p>${escapeHTML(e.message)}${e.where ? `<small>${escapeHTML(e.where)}</small>` : ''}</p>`).join('')}` : '';
  $('#runtime-errors').hidden = !state.errors.length;
}
function renderRecovery() {
  let banner = $('#local-recovery-banner');
  if (!banner) { banner = document.createElement('div'); banner.id = 'local-recovery-banner'; banner.className = 'conflict-banner local-recovery-banner'; banner.setAttribute('role', 'status'); $('#workspace-main').prepend(banner); }
  banner.hidden = !state.recovery;
  if (state.recovery) banner.innerHTML = '<div><strong>이 기기에 별도 임시 작업이 남아 있습니다.</strong><p>현재 화면은 서버의 최신 작업입니다. 이전 임시 작업은 백업으로 내려받아 비교할 수 있습니다.</p></div><button type="button" class="button secondary small" data-action="download-recovery">임시 작업 백업</button>';
}
function renderAll() { renderProviders(); renderUsage(); renderChat(); renderProjectFields(); renderDatasets(); renderVersions(); renderGuide(); renderPreview(); renderRecovery(); text('#project-heading', state.project.title); }

async function enterWorkspace(result, demo = false) {
  resetWorkspace();
  state.demo = demo; state.user = result.user || null; state.config = result.config || state.config; state.usage = result.usage || null; state.project = emptyProject(); state.revision = 0; state.pending = null; state.recovery = null; state.aiError = ''; state.dirty = false; state.conflict = false; show('#conflict-banner', false);
  if (!demo && state.user?.role === 'student') {
    const loaded = await api('project'); state.project = normalizeProject(loaded.project || emptyProject()); state.revision = loaded.revision ?? 0;
  }
  try {
    const owner=state.user?.role==='student'?state.user.id:null;
    const cached = owner?JSON.parse(localStorage.getItem(cacheKey()) || 'null'):null;
    if (cached?.ownerId===owner && owner && cached.project && cached.dirty && cached.revision === state.revision) { state.project = normalizeProject(cached.project); state.dirty = true; toast('우리 팀의 미저장 작업을 복원했습니다.'); }
    else if (owner&&cached?.ownerId===owner&&cached.dirty&&cached.revision!==state.revision) { localStorage.setItem(cacheKey() + ':recovery', JSON.stringify(cached)); }
    const recovery = owner?JSON.parse(localStorage.getItem(cacheKey() + ':recovery') || 'null'):null;
    if (owner&&recovery?.ownerId===owner&&recovery.project) state.recovery = normalizeProject(recovery.project);
  } catch { /* A damaged local backup must never prevent server workspace access. */ }
  show('#auth-screen', false); show('#app-screen'); show('#admin-nav', state.user?.role === 'teacher');
  $$('[data-view]').filter(el => !['guide', 'admin'].includes(el.dataset.view)).forEach(el => { el.hidden = state.user?.role === 'teacher'; });
  text('#team-label', demo ? '둘러보기 · 내 기기 작업' : state.user?.role === 'teacher' ? '선생님' : `2학년 ${state.user.cls}반 · ${state.user.name}`);
  text('#save-status', demo ? '둘러보기 · 이 화면에서만 유지' : state.user?.role === 'teacher' ? '교사 관리 화면' : '우리 팀 작업 불러옴');
  renderAll(); if (state.user?.role === 'teacher') text('#project-heading', '2학기 수업 운영'); setMode('build'); setView(state.user?.role === 'teacher' ? 'admin' : 'worksheet'); if (state.dirty) markDirty();
}
async function loadTeams() {
  const cls = $('#login-class').value;
  if (!cls) { $('#login-team').innerHTML = '<option value="">반을 먼저 선택해주세요</option>'; return; }
  $('#login-team').innerHTML = '<option value="">팀 목록 불러오는 중…</option>';
  try {
    const response = await fetch(`/api/studio?action=teams&cls=${encodeURIComponent(cls)}`, { credentials: 'same-origin' }); const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || '팀 목록을 불러오지 못했습니다.');
    if ($('#login-class').value !== cls) return;
    const teams = (data.teams || []).filter(t => t.status !== 'inactive');
    $('#login-team').innerHTML = '<option value="">우리 팀을 선택하세요</option>' + teams.map(t => `<option value="${escapeHTML(t.name)}" ${t.status === 'pending' ? 'disabled' : ''}>${escapeHTML(t.name)}${t.status === 'pending' ? ' · 승인 대기' : ''}</option>`).join('');
    if (!teams.length) $('#login-team').innerHTML = '<option value="">등록된 팀이 없습니다 · 팀 등록</option>';
  } catch (error) { $('#login-team').innerHTML = '<option value="">팀 목록을 불러오지 못했습니다</option>'; text('#auth-message', errorMessage(error)); }
}
function authTab(tab) {
  $$('[data-auth-tab]').forEach(el => { el.classList.toggle('active', el.dataset.authTab === tab); el.setAttribute('aria-selected', String(el.dataset.authTab === tab)); });
  for (const name of ['student', 'register', 'teacher']) show(`#auth-${name}-form`, name === tab);
  text('#auth-message', tab === 'teacher' && state.config?.teacherConfigured === false ? '교사 로그인을 사용하려면 Vercel 환경 변수에 ADMIN_PASSWORD를 설정해주세요. 설정 후 교사 화면에서 기존 팀의 비밀번호를 한 번 새로 지정해주세요.' : '');
}
async function submitAuth(event, kind) {
  event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true; text('#auth-message', '확인 중…');
  try {
    if (kind === 'register') {
      const password = $('#register-password').value;
      if (password.length < 6) throw new Error('팀 비밀번호는 6자 이상으로 설정해주세요.');
      await api('register', { cls: $('#register-class').value, name: $('#register-name').value.trim(), password });
      $('#login-class').value = $('#register-class').value; authTab('student'); await loadTeams(); text('#auth-message', '팀 등록을 요청했습니다. 선생님이 승인한 뒤 로그인할 수 있습니다.'); event.target.reset();
    } else {
      const payload = kind === 'teacher' ? { password: $('#teacher-password').value } : { cls: $('#login-class').value, name: $('#login-team').value, password: $('#login-password').value };
      if (kind === 'student' && !payload.name) throw new Error('반과 팀을 선택해주세요.');
      const result = await api(kind === 'teacher' ? 'teacherLogin' : 'login', payload); await enterWorkspace(result); announceSession(); event.target.querySelector('input[type="password"]').value = ''; text('#auth-message', '');
    }
  } catch (error) { text('#auth-message', errorMessage(error)); }
  finally { button.disabled = false; }
}

async function requestAI(event) {
  event.preventDefault(); const prompt = $('#prompt-input').value.trim();
  if (!prompt || state.busy || state.demo) return;
  if(state.pending){toast('먼저 현재 수정안을 적용하거나 원래 결과로 돌아가세요.');setWorkspaceSurface('preview');return;}
  if (state.conflict) { toast('먼저 다른 기기의 저장 내용과 충돌을 해결해주세요.'); return; }
  const codeAtRequest = state.project.code; const dataAtRequest = JSON.stringify(state.project.datasets);
  const version=state.workspaceVersion;
  state.project.messages.push({ id: uid(), role: 'user', text: prompt, createdAt: now(), mode: state.mode, provider: state.provider });
  const mode = state.mode; const provider = state.provider; state.pending = null; renderPreview(); state.aiError = ''; state.busy = true; $('#prompt-input').value = ''; markDirty(); renderChat(); renderProviders();
  try {
    const result = await api('', { mode, prompt, provider, project: { title: state.project.title, brief: state.project.brief, code: state.project.code, datasets: state.project.datasets, messages: state.project.messages.slice(-8) }, runtimeErrors: state.errors.slice(-8) }, '/api/ai', 135000);
    const id = uid(); state.project.messages.push({ id, role: 'assistant', text: result.summary, summary: result.summary, prompt, createdAt: now(), mode, provider: result.provider || provider, model: result.model || '', checks: result.checks || [], warnings: result.warnings || [] });
    if (result.code && state.project.code === codeAtRequest && JSON.stringify(state.project.datasets) === dataAtRequest) state.pending = { id, code: result.code, before: codeAtRequest, datasets: dataAtRequest, summary: result.summary };
    else if(result.code) toast('요청 중 코드나 자료가 바뀌어 제안을 적용하지 않았습니다. 현재 자료로 다시 요청하세요.');
    if (result.usage) state.usage = result.usage; markDirty();
    if (result.code && !codeAtRequest.trim() && state.project.code === codeAtRequest && JSON.stringify(state.project.datasets) === dataAtRequest) { state.project=replaceCode(state.project,result.code,'AI 첫 결과'); state.pending=null; markDirty(); toast('AI가 만든 첫 결과를 실행했습니다.'); }
    renderChat(); renderUsage(); renderPreview(); renderVersions();
    if(result.code){setWorkspaceSurface('split');}
    if (state.pending) toast('수정 제안을 오른쪽에서 미리 볼 수 있습니다.');
  } catch (error) { if(version!==state.workspaceVersion)return;state.aiError = errorMessage(error); toast(state.aiError); text('#ai-status', state.aiError); $('#prompt-input').value = prompt; try { const session = await api('session'); state.usage = session.usage; state.config = session.config || state.config; renderUsage(); } catch {} }
  finally { if(version===state.workspaceVersion){state.busy = false; renderProviders();} }
}
function applyProposal() {
  if (!state.pending) return;
  if (state.project.code !== state.pending.before || JSON.stringify(state.project.datasets) !== state.pending.datasets) { toast('요청 이후 코드나 데이터가 바뀌었습니다. 현재 상태를 기준으로 다시 요청해주세요.'); return; }
  try { state.project = replaceCode(state.project, state.pending.code, `AI 적용 전 · ${state.pending.summary.slice(0, 70)}`); state.pending = null; state.project.checks = {}; markDirty(); renderChat(); renderPreview(); renderVersions(); toast('제안을 적용했습니다. 입력과 결과를 직접 확인해주세요.'); }
  catch (error) { toast(errorMessage(error)); }
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportProject() { download(JSON.stringify({ format: 'hyfl-studio', version: 2, exportedAt: now(), project: fitProject(state.project) }, null, 2), safeFilename(state.project.title + '-백업', 'json'), 'application/json;charset=utf-8'); toast('코드·데이터·대화가 담긴 백업을 내려받았습니다.'); }

async function loadCode(file) {
  if (!file) return;
  const version=state.workspaceVersion;
  try {
    if (file.size > 700000) throw new Error('가져올 HTML 파일은 700KB 이하여야 합니다. 프로젝트 백업은 JSON 가져오기를 이용해주세요.');
    const imported = importHtml(await file.text());
    if(version!==state.workspaceVersion)return;
    if (state.project.code && !confirm('현재 코드를 이전 버전에 보관하고 가져온 HTML로 바꿀까요?')) return;
    state.project = replaceCode(state.project, imported.code, 'HTML 가져오기 전');
    if (imported.datasets) state.project.datasets = imported.datasets;
    state.project.checks = {}; state.pending = null; markDirty(); renderPreview(); renderVersions(); renderDatasets(); renderChat(); setView('work');setWorkspaceSurface('split'); toast('HTML을 가져왔습니다. 오른쪽에서 바로 실행해보세요.');
  } catch (error) { toast(errorMessage(error)); }
  finally { if(version===state.workspaceVersion)$('#code-file').value = ''; }
}
async function loadDatasets(files) {
  const version=state.workspaceVersion;
  try {
    const next = structuredClone(state.project.datasets);
    const converted = [];
    for (const file of files) {
      if (file.size > LIMITS.datasetBytes) throw new Error('첨부 데이터는 파일 합계 320KB까지 사용할 수 있습니다.');
      const ext = file.name.split('.').pop().toLowerCase(); if (!['csv', 'tsv', 'json', 'txt'].includes(ext)) throw new Error('CSV, TSV, JSON, TXT 파일을 선택해주세요.');
      const decoded = decodeDatasetBytes(await file.arrayBuffer());
      if(version!==state.workspaceVersion)return;
      const content = decoded.text; if (decoded.encoding !== 'utf-8') converted.push(file.name);
      const existing = next.find(d => d.name === file.name);
      const dataset = { id: existing?.id || uid(), name: file.name, format: ext === 'txt' ? 'text' : ext, text: content }; describeDataset(dataset);
      if (existing) next.splice(next.indexOf(existing), 1, dataset); else next.push(dataset);
    }
    if (next.length > 8) throw new Error('데이터 파일은 최대 8개까지 연결할 수 있습니다.');
    if (next.reduce((sum, d) => sum + byteLength(d.text), 0) > LIMITS.datasetBytes) throw new Error('첨부 데이터 합계가 320KB를 넘습니다. 필요한 열·행을 추려서 가져와 주세요.');
    state.project = normalizeProject({ ...state.project, datasets: next, checks: {} }); state.pending=null;
    if (!state.project.code.trim()) { const first=next.find(d=>['csv','tsv','json'].includes(d.format)); if(first) state.project=replaceCode(state.project,buildQuickChart(first.id),'첫 자료 표·그래프'); }
    markDirty(); renderDatasets(); renderPreview(); renderChat(); toast(converted.length ? '한글 파일의 인코딩을 변환해 연결했습니다. 표시된 열 이름과 원자료를 확인하세요.' : '자료를 넣었습니다. 이제 만들 기능을 쓰고 결과 만들기를 누르세요.');
  } catch (error) { toast(errorMessage(error)); }
  finally { if(version===state.workspaceVersion)$('#dataset-file').value = ''; }
}

function renderTeamRow(team, settings) {
  return `<tr><td><strong>${escapeHTML(team.cls)}반 · ${escapeHTML(team.name)}</strong>${team.needsPasswordReset ? '<p class="help-text">새 비밀번호 설정 필요</p>' : ''}</td><td><span class="pill ${team.status === 'active' ? 'positive' : ''}">${{ active: '사용 중', pending: '승인 대기', inactive: '중지됨' }[team.status] || escapeHTML(team.status)}</span></td><td><div class="inline-field"><input type="number" min="1" max="100" value="${Number(team.dailyRequests || settings.dailyRequests)}" data-team-limit="${escapeHTML(team.id)}" aria-label="${escapeHTML(team.name)} 하루 요청 한도"><button type="button" class="button secondary small" data-action="team-limit" data-id="${escapeHTML(team.id)}">저장</button></div></td><td><button type="button" class="button ${team.status === 'active' ? 'secondary' : 'primary'} small" data-action="team-status" data-id="${escapeHTML(team.id)}" data-status="${team.status === 'active' ? 'inactive' : 'active'}">${team.status === 'active' ? '사용 중지' : '승인·활성화'}</button><details class="password-reset"><summary>비밀번호 새로 설정</summary><form data-password-team="${escapeHTML(team.id)}"><label class="sr-only" for="password-${escapeHTML(team.id)}">${escapeHTML(team.name)} 새 팀 비밀번호</label><input id="password-${escapeHTML(team.id)}" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="새 비밀번호 8자 이상" required><button type="submit" class="button secondary small">새 비밀번호 적용</button><small>기존 로그인은 종료됩니다. 새 비밀번호는 해당 팀에 직접 알려주세요.</small></form></details></td></tr>`;
}
async function resetTeamPassword(event) {
  event.preventDefault(); const form = event.target; const button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const password = form.querySelector('input[name="password"]').value;
    if (password.length < 8) throw new Error('새 팀 비밀번호를 8자 이상 입력해주세요.');
    await api('teamPassword', { teamId: form.dataset.passwordTeam, password }); form.reset(); await loadAdmin(); toast('새 비밀번호를 적용하고 이전 로그인을 종료했습니다. 해당 팀에 새 비밀번호를 알려주세요.');
  } catch (error) { button.disabled = false; toast(errorMessage(error)); }
}
async function loadAdmin() {
  const container = $('#admin-content'); container.innerHTML = '<div class="empty-state">운영 상태를 불러오는 중…</div>';
  try {
    const data = await api('admin'); state.admin = data; const s = data.settings; const usage = data.usage?.school || data.usage || {};
    container.innerHTML = `<div class="stat-grid"><div><span>오늘 요청</span><strong>${Number(usage.requests || 0)}<small> / ${Number(s.globalDailyRequests)}</small></strong></div><div><span>오늘 추정 비용</span><strong>$${Number(usage.estimatedCostUsd || 0).toFixed(2)}</strong></div><div><span>이번 달 추정 비용</span><strong>$${Number(usage.monthlyEstimatedCostUsd || 0).toFixed(2)}</strong></div><div><span>등록 팀</span><strong>${data.teams.length}<small>팀</small></strong></div></div><p class="help-text">이 사이트의 요청·토큰으로 계산한 추정치입니다. 실제 잔액·크레딧 만료·전체 청구는 <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer">OpenAI</a>와 <a href="https://platform.claude.com/settings/billing" target="_blank" rel="noopener noreferrer">Anthropic</a>에서 확인해주세요.</p><form id="admin-settings-form" class="settings-card"><div class="card-heading"><h3>공통 AI와 사용 한도</h3><label class="toggle-label"><input name="aiEnabled" type="checkbox" ${s.aiEnabled ? 'checked' : ''}> AI 요청 허용</label></div><div class="settings-grid">${['gpt', 'claude'].map(id => `<label class="check-item"><input type="checkbox" name="provider-${id}" ${s.providers[id].enabled ? 'checked' : ''}><span><strong>${id === 'gpt' ? 'GPT' : 'Claude'}</strong><small>${escapeHTML(s.providers[id].model)} · ${state.config.providers.find(p => p.id === id)?.available ? 'API 연결 설정됨' : 'API 키 설정 필요'}</small></span></label>`).join('')}<div class="field"><label for="admin-default">기본 AI</label><select id="admin-default" name="defaultProvider"><option value="gpt" ${s.defaultProvider === 'gpt' ? 'selected' : ''}>GPT</option><option value="claude" ${s.defaultProvider === 'claude' ? 'selected' : ''}>Claude</option></select></div>${[{ key: 'dailyRequests', label: '팀별 하루 요청 수', min: 1, max: 100, step: 1 }, { key: 'globalDailyRequests', label: '전체 하루 요청 수', min: 1, max: 5000, step: 1 }, { key: 'teamDailyUsd', label: '팀별 하루 추정 비용 한도 (USD)', min: 0.1, max: 100, step: 0.1 }, { key: 'schoolDailyUsd', label: '전체 하루 추정 비용 한도 (USD)', min: 0.1, max: 1000, step: 0.1 }, { key: 'schoolMonthlyUsd', label: '전체 월 추정 비용 한도 (USD)', min: 1, max: 10000, step: 1 }].map(f => `<div class="field"><label for="admin-${f.key}">${f.label}</label><input id="admin-${f.key}" type="number" name="${f.key}" value="${Number(s[f.key])}" min="${f.min}" max="${f.max}" step="${f.step}" required></div>`).join('')}</div><p class="help-text">요청 전에 최대 사용 예상액을 예약합니다. 한도에 가까우면 남은 표시 금액이 있어도 새 요청이 제한될 수 있습니다. 매일·매월 한국 시간 기준으로 집계합니다.</p><button class="button primary" type="submit">운영 설정 저장</button><span id="admin-message" role="status"></span></form><div class="team-management"><div class="card-heading"><h3>팀 승인과 개별 한도</h3><button type="button" class="button secondary small" data-action="refresh-admin">새로고침</button></div><div class="team-table-wrap"><table class="team-table"><thead><tr><th>팀</th><th>상태</th><th>하루 요청 한도</th><th>관리</th></tr></thead><tbody>${data.teams.map(t => renderTeamRow(t, s)).join('') || '<tr><td colspan="4">등록된 팀이 없습니다.</td></tr>'}</tbody></table></div></div>`;
  } catch (error) { container.innerHTML = `<div class="empty-state"><h3>운영 정보를 불러오지 못했습니다.</h3><p>${escapeHTML(errorMessage(error))}</p><button class="button secondary" type="button" data-action="refresh-admin">다시 확인</button></div>`; }
}
async function saveAdmin(event) {
  event.preventDefault(); const form = event.target; const button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const fields = new FormData(form); const settings = structuredClone(state.admin.settings);
    settings.aiEnabled = fields.has('aiEnabled'); settings.defaultProvider = fields.get('defaultProvider');
    for (const id of ['gpt', 'claude']) settings.providers[id].enabled = fields.has(`provider-${id}`);
    for (const key of ['dailyRequests', 'globalDailyRequests', 'teamDailyUsd', 'schoolDailyUsd', 'schoolMonthlyUsd']) settings[key] = Number(fields.get(key));
    const result = await api('settings', { settings }); state.config = result.config; state.admin.settings = result.settings; renderProviders(); text('#admin-message', '운영 설정을 저장했습니다.'); toast('운영 설정이 적용되었습니다.');
  } catch (error) { text('#admin-message', errorMessage(error)); }
  finally { button.disabled = false; }
}

document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  $('#attach-menu').open=false;
  if (button.dataset.authTab) return authTab(button.dataset.authTab);
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.dataset.mode) return setMode(button.dataset.mode);
  if(button.dataset.surface)return setWorkspaceSurface(button.dataset.surface);
  if (button.dataset.prompt) {
    return usePromptDraft(button.dataset.prompt,button.dataset.promptMode||'build');
  }
  const action = button.dataset.action; const id = button.dataset.id;
  try {
    if(action==='worksheet-task'){state.worksheetTask=id;renderWorksheet();}
    else if(action==='worksheet-request'){usePromptDraft(worksheetRequest(id,state.project),WORKSHEET_TASKS.find(t=>t.id===id)?.mode||'explain');}
    else if(action==='api-help'){setView('guide');$('#api-help-title').focus();}
    else if(action==='import-app')$('#code-file').click();
    else if(action==='request-help'){setView('guide');$('#work-help-title').focus();}
    else if(action==='copy-api-prompt'){
      const item=apiHelpPrompts[Number(id)];if(!item)return;
      try{await navigator.clipboard.writeText(item.prompt);toast('예시를 복사했습니다. 대괄호 내용을 고치고 실제 키는 넣지 마세요.');}
      catch{toast('복사하지 못했습니다. 질문 초안 넣기를 누른 뒤 입력창에서 직접 복사해주세요.');}
    }
    else if (action === 'paste-response') { setView('project'); $('.api-response-panel').open=true; $('#api-response-text').focus(); }
    else if (action === 'apply-proposal') applyProposal();
    else if (action === 'discard-proposal') { state.pending=null; renderChat(); renderPreview(); }
    else if (action === 'quick-chart') { const dataset=state.project.datasets.find(d=>d.id===id); if(!dataset)return; if(state.project.code.trim()&&!confirm('현재 결과를 이전 버전에 보관하고 이 자료의 표·그래프를 만들까요?'))return; state.project=replaceCode(state.project,buildQuickChart(id),'표·그래프 만들기 전'); state.pending=null; markDirty(); renderAll(); setView('work'); }
    else if (action === 'inspect-proposal' && state.pending) { download(state.pending.code, 'AI-제안-검토용.html.txt', 'text/plain;charset=utf-8'); toast('검토용 코드입니다. 실행에는 전체 데이터 연결과 적용이 필요합니다.'); }
    else if (action === 'remove-dataset' && confirm('이 데이터 연결을 해제할까요? 사용하는 앱 기능을 다시 확인해주세요.')) { state.project.datasets = state.project.datasets.filter(d => d.id !== id); state.project.checks = {}; markDirty(); renderDatasets(); renderPreview(); }
    else if (action === 'restore-version') { const version = state.project.versions.find(v => v.id === id); if (version && confirm('현재 코드를 보관하고 이 버전으로 돌아갈까요? 데이터 파일과 대표 기록은 그대로 유지됩니다.')) { state.project = replaceCode(state.project, version.code, '이전 버전 복원 전'); state.pending = null; state.project.checks = {}; markDirty(); renderPreview(); renderVersions(); renderChat(); setView('work'); toast('코드를 복원했습니다. 데이터 연결과 동작을 다시 확인해주세요.'); } }
    else if (action === 'debug-errors') { setMode('debug'); $('#prompt-input').value = `실행 중 다음 오류가 나와. 현재 기능을 유지하면서 원인을 설명하고 수정해줘.\n\n${state.errors.map(e => e.message).join('\n')}\n\n내가 기대한 결과: `; $('#prompt-input').focus(); }
    else if (action === 'download-recovery' && state.recovery) { download(JSON.stringify({ format: 'hyfl-studio', version: 2, exportedAt: now(), project: state.recovery }, null, 2), safeFilename(state.recovery.title + '-이전임시작업', 'json'), 'application/json;charset=utf-8'); toast('이전 임시 작업을 백업으로 내려받았습니다.'); }
    else if (action === 'refresh-admin') await loadAdmin();
    else if (action === 'team-status') { button.disabled = true; await api('teamStatus', { teamId: id, status: button.dataset.status }); await loadAdmin(); toast('팀 사용 상태를 변경했습니다.'); }
    else if (action === 'team-limit') { button.disabled = true; const input = $$('[data-team-limit]').find(el => el.dataset.teamLimit === id); await api('teamLimit', { teamId: id, dailyRequests: Number(input.value) }); toast('팀별 한도를 저장했습니다.'); button.disabled = false; }
  } catch (error) { button.disabled = false; toast(errorMessage(error)); }
});

$('#auth-student-form').addEventListener('submit', e => submitAuth(e, 'student'));
$('#auth-register-form').addEventListener('submit', e => submitAuth(e, 'register'));
$('#auth-teacher-form').addEventListener('submit', e => submitAuth(e, 'teacher'));
$('#login-class').addEventListener('change', loadTeams);
$('#demo-button').addEventListener('click', () => enterWorkspace({}, true));
$('#ai-form').addEventListener('submit', requestAI);
$('#provider-select').addEventListener('change', e => { state.provider = e.target.value; updateAiState(); });
$('#mobile-menu-button').addEventListener('click',()=>setSidebarCollapsed(!layout.sidebarCollapsed));
$('#logout-button').addEventListener('click', async () => {
  const version=state.workspaceVersion;
  if (state.busy) { toast('AI 요청이 끝난 뒤 나가주세요.'); return; }
  await saveNow();
  if(version!==state.workspaceVersion)return;
  if (state.dirty && !confirm('아직 서버에 저장되지 않은 작업이 있습니다. 이 기기의 임시 백업을 남기고 나갈까요?')) return;
  try { if (!state.demo) await api('logout', {}); } catch (error) { toast(errorMessage(error)); return; }
  resetWorkspace();announceSession();show('#app-screen', false); show('#auth-screen'); authTab('student'); loadTeams();
});
$('#project-form').addEventListener('submit', event => event.preventDefault());
$('#project-form').addEventListener('input', event => {
  const id = event.target.id;
  if (id === 'project-title') state.project.title = event.target.value.slice(0, 120) || '우리 팀의 데이터 웹앱';
  else if (id.startsWith('brief-')) state.project.brief[id.slice(6)] = event.target.value.slice(0, 5000);
  else return; markDirty();
});
$('#import-code-button').addEventListener('click', () => $('#code-file').click());
$('#code-file').addEventListener('change', e => loadCode(e.target.files[0]));
$('#dataset-file').addEventListener('change', e => loadDatasets([...e.target.files]));
$('#attach-data').addEventListener('click',()=>$('#chat-dataset-file').click());
$('#chat-dataset-file').addEventListener('change',async e=>{const version=state.workspaceVersion;await attachFiles([...e.target.files]);if(version===state.workspaceVersion){e.target.value='';setView('work');}});
async function attachFiles(files){
  if(!files.length)return;const version=state.workspaceVersion;
  const html=files.filter(file=>/\.html?$/i.test(file.name));
  if(html.length&&files.length!==1){toast('HTML은 한 개씩 가져오세요. 데이터 파일은 그다음에 추가할 수 있습니다.');return;}
  if(html.length)await loadCode(html[0]);else await loadDatasets(files);
  if(version===state.workspaceVersion){setView('work');$('#attach-menu').open=false;}
}
$('#mode-select').addEventListener('change',event=>setMode(event.target.value));
$('#prompt-input').addEventListener('input',resizePrompt);
$$('input[name="workspace-surface"]').forEach(input=>input.addEventListener('change',resizePrompt));
window.addEventListener('resize',resizePrompt);
$('#prompt-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!$('#ai-submit').disabled&&$('#prompt-input').value.trim()){event.preventDefault();requestAI(event);}});
$('#workspace-divider').addEventListener('pointerdown',startResize);
window.addEventListener('pointermove',moveResize);window.addEventListener('pointerup',stopResize);window.addEventListener('pointercancel',stopResize);
$('#workspace-divider').addEventListener('dblclick',()=>setWorkspaceShare(48));
$('#workspace-divider').addEventListener('keydown',event=>{const values={ArrowLeft:layout.share-3,ArrowRight:layout.share+3,Home:25,End:75,Enter:48};if(values[event.key]!==undefined){event.preventDefault();setWorkspaceShare(values[event.key]);}});
$('#workspace-main').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();show('#file-drop-hint');}});
$('#workspace-main').addEventListener('dragleave',event=>{if(!event.currentTarget.contains(event.relatedTarget))show('#file-drop-hint',false);});
$('#workspace-main').addEventListener('drop',async event=>{event.preventDefault();show('#file-drop-hint',false);await attachFiles([...event.dataTransfer.files]);});
$('#import-api-response').addEventListener('click', () => {
  try {
    const dataset = importApiResponse($('#api-response-name').value, $('#api-response-text').value);
    const next = normalizeProject({ ...state.project, datasets: [...state.project.datasets, dataset], checks: {} });
    state.project = next; state.pending=null; if(!state.project.code.trim()) state.project=replaceCode(state.project,buildQuickChart(dataset.id),'API 응답 표·그래프'); markDirty(); renderDatasets(); renderPreview();renderChat();setView('work');setWorkspaceSurface('split');
    $('#api-response-text').value = ''; text('#api-response-status', '응답을 연결했습니다. 실제 행 경로와 기간·페이지 범위를 확인하세요.');
    toast('API 응답 전체를 데이터로 연결했습니다.');
  } catch (error) { text('#api-response-status', errorMessage(error)); }
});

$('#preview-refresh').addEventListener('click', () => { renderPreview(); toast('현재 코드로 다시 실행했습니다.'); });
$('#code-toggle').addEventListener('click', () => { const visible = $('#code-editor').hidden; show('#code-editor', visible); show('#apply-code-button', visible); $('#code-toggle').classList.toggle('active', visible); $('#code-toggle').setAttribute('aria-pressed', String(visible)); if (visible) $('#code-editor').value = state.project.code; });
$('#apply-code-button').addEventListener('click', () => {
  try { state.project = replaceCode(state.project, $('#code-editor').value, '직접 코드 편집 전'); state.project.checks = {}; state.pending = null; markDirty(); renderPreview(); renderVersions(); renderChat(); toast('직접 편집한 코드를 적용했습니다.'); }
  catch (error) { toast(errorMessage(error)); }
});
$('#download-html').addEventListener('click', () => { if (state.project.code) { download(buildDocument(state.pending?.code || state.project.code, state.project.datasets), safeFilename(state.project.title, 'html'), 'text/html;charset=utf-8'); toast('전체 데이터가 포함된 HTML을 내려받았습니다. 파일을 열어 핵심 기능을 다시 확인해주세요.'); } });
$('#export-conversation').addEventListener('click',()=>download(exportConversation(state.project),safeFilename(state.project.title+'-대화','txt'),'text/plain;charset=utf-8'));
$('#export-project').addEventListener('click', exportProject);
$('#import-project').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  const version=state.workspaceVersion;
  try {
    if (file.size > 3000000) throw new Error('백업 파일은 3MB 이하여야 합니다.');
    const parsed = JSON.parse(await file.text()); if (parsed.format !== 'hyfl-studio' || parsed.version !== 2) throw new Error('이 작업실에서 내려받은 프로젝트 백업 파일을 선택해주세요.');
    if(version!==state.workspaceVersion)return;
    const project = normalizeProject(parsed.project);
    if (!confirm('현재 프로젝트 전체를 백업 내용으로 바꿀까요? 현재 작업이 필요하면 취소하고 먼저 백업을 내려받으세요.')) return;
    state.project = project; state.pending = null; markDirty(); renderAll(); setView('work'); toast('프로젝트 백업을 가져왔습니다.');
  } catch (error) { toast(errorMessage(error)); }
  finally { if(version===state.workspaceVersion)e.target.value = ''; }
});
$('#conflict-reload').addEventListener('click', async () => {
  if (!confirm('현재 기기의 작업을 백업 파일로 내려받고, 다른 기기에서 저장한 최신 작업을 불러올까요?')) return;
  try { exportProject(); const loaded = await api('project'); state.project = normalizeProject(loaded.project || emptyProject()); state.revision = loaded.revision; state.dirty = false; state.conflict = false; state.pending = null; cacheProject(); show('#conflict-banner', false); renderAll(); text('#save-status', '최신 팀 작업 불러옴'); }
  catch (error) { toast(errorMessage(error)); }
});
$('#admin-content').addEventListener('submit', e => { if (e.target.id === 'admin-settings-form') saveAdmin(e); else if (e.target.dataset.passwordTeam) resetTeamPassword(e); });
window.addEventListener('message', event => {
  if (event.source !== $('#preview-frame').contentWindow || event.data?.type !== 'hyfl-runtime-error' || event.data.nonce !== state.nonce || state.errors.length >= 16) return;
  const message = String(event.data.message || '').slice(0, 1800); const where = String(event.data.where || '').slice(0, 240);
  if (message && !state.errors.some(e => e.message === message && e.where === where)) { state.errors.push({ message, where }); renderErrors(); }
});
window.addEventListener('beforeunload', event => { if (state.dirty || state.busy) { cacheProject(); event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('storage',event=>{
  if(event.key!==sessionNoticeKey||!state.user||state.demo)return;
  try{if(JSON.parse(event.newValue||'null')?.ownerId===state.user.id)return;}catch{}
  leaveWorkspace('다른 탭에서 로그인한 팀이 바뀌었습니다. 우리 팀으로 다시 로그인해주세요.');
});
window.addEventListener('focus',()=>{if(state.user&&!state.demo)api('session').catch(()=>{});});
document.addEventListener('visibilitychange', () => { if (document.hidden) { cacheProject(); saveNow(); } });

async function init() {
  initializeLayout();
  try {
    const session = await api('session'); state.config = session.config; state.provider = session.config?.defaultProvider || 'gpt';
    if (session.user) { await enterWorkspace(session); return; }
  } catch (error) {
    try { state.config = await api('config'); } catch {}
    text('#auth-message', errorMessage(error));
  }
  await loadTeams();
}
init();
