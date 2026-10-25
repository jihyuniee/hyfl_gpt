import { CURRICULUM } from '/lib/curriculum.mjs';
import { LIMITS, emptyProject, normalizeProject, fitProject, replaceCode, describeDataset, apiResponseNotice, importApiResponse, buildDocument, importHtml, exportRecords, safeFilename, byteLength, uid, now } from '/lib/workspace.mjs';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const text = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
const show = (selector, visible = true) => { const el = $(selector); if (el) el.hidden = !visible; };
const fmtTime = value => { try { return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value)); } catch { return ''; } };
const modeNames = { build: '기능 만들기', edit: '기능 수정', debug: '오류 해결', explain: '코드 이해' };
const workPrompts = [
  {
    label: 'API 응답으로 기능 만들기', mode: 'build', worksheet: 'STEP 2-3 · 2-4',
    prompt: '첨부한 공공 API JSON 응답으로 우리 팀의 최소 기능을 만들어줘. 실제 행 경로와 오류 코드를 확인하고 전체 text를 파싱해줘. 응답 파일의 행 수와 서버 전체 건수, 요청 인자 base_date/base_time과 응답 기준 시각 baseDate/baseTime, 예보 대상 fcstDate/fcstTime을 구분해줘. 관측 obsrValue와 예보 fcstValue를 분리하고, 발표 회차·격자·항목을 선택하게 해줘. 결측과 PCP의 강수없음·1mm 미만을 0이나 숫자로 임의 변환하지 마. 기상 category가 서로 다른 항목은 같은 숫자로 더하지 말고 지역·날짜·시간·항목별로 구분해줘. 첨부 응답은 받아 둔 자료이며 실시간 조회라고 표시하지 마. 인증키를 요청하거나 HTML에 넣지 마. 실시간 연결이 필요하면 공식 문서와 교사가 제공한 안전한 서버 경로가 있는지 먼저 확인해줘. 기존 기능을 유지하고 원자료 대조 방법을 알려줘.',
  },
  {
    label: '실시간 API 연결 점검하기', mode: 'explain', worksheet: 'STEP 2-4 · 3-2',
    prompt: '우리 프로젝트의 실시간 공공 API 연결 방법을 점검해줘. 서비스의 공식 문서 주소: [인증키 없는 문서 주소] / 필요한 요청 조건: [지역·날짜·항목] / 교사가 제공한 서버 경로: [있으면 입력, 없으면 없음]. 인증키는 묻지 마. 파일 기반으로 완성할 기능과 실시간 서버가 필요한 기능을 구분하고, CORS·요청 한도·페이지 누락·오류 응답·갱신 시점 확인 방법을 설명해줘. 없는 프록시를 만들어내거나 이미 연결됐다고 말하지 마. 아직 코드는 바꾸지 마.',
  },
  {
    label: '데이터에서 기능 정하기', mode: 'explain', worksheet: 'STEP 2-2',
    prompt: '현재 프로젝트 맥락과 첨부 데이터의 열 이름·예시 행을 보고, 데이터에서 웹앱 기능으로 연결하는 일을 도와줘.\n1. 자료에서 실제로 확인되는 항목\n2. 사용자가 입력하거나 선택할 값\n3. 그 조건으로 보여줄 결과\n4. 지금 만들 수 있는 작은 기능 하나\n5. 추가로 확인하거나 확보해야 할 정보\n를 구분해서 설명해줘. 없는 항목·수치·이용 조건을 만들어내지 말고, 전체 데이터의 통계나 최신성을 확인한 것처럼 말하지 마. 아직 코드는 바꾸지 마.',
  },
  {
    label: '첫 기능 만들기', mode: 'build', worksheet: 'STEP 2-3 · 2-4',
    prompt: '프로젝트 맥락에 적은 「가장 먼저 작동해야 할 기능 하나」를 구현해줘. 첨부한 전체 데이터를 읽어 사용자의 입력에 맞는 결과를 보여줘. 기존 코드가 있으면 정상 작동하는 기능을 유지해줘. 출처·기준 시점·단위와 결과가 없는 경우의 안내를 표시해줘. 필요한 열이나 조건이 없으면 임의로 만들지 말고 먼저 확인할 점을 알려줘. 적용 후 원자료와 대조할 방법도 설명해줘.',
  },
  {
    label: '잘못 나온 결과 고치기', mode: 'debug', worksheet: 'STEP 2-4',
    prompt: '현재 앱에서 다음 문제를 고쳐줘.\n내가 입력하거나 누른 것: [직접 적기]\n원래 나와야 할 결과: [직접 적기]\n실제로 나온 결과나 오류: [직접 적기]\n원자료에서 확인한 값 또는 행: [직접 적기]\n유지해야 할 기존 기능: [직접 적기]\n현재 코드에서 원인을 살펴보고, 필요한 부분을 수정해줘. 수정 뒤 같은 입력으로 확인할 방법도 알려줘.',
  },
  {
    label: '계산·결과 검증하기', mode: 'explain', worksheet: 'STEP 3-2',
    prompt: '현재 코드가 어떤 데이터 항목을 어떤 조건으로 읽고 계산하는지 설명해줘. 원자료와 비교해 볼 테스트를 정상 입력, 결과 없음, 누락된 값으로 나누어 제안해줘. 각 테스트에서 사용할 입력과 원자료에서 직접 확인할 항목을 알려줘. 확인할 수 없는 기대 수치를 만들어내거나 실행하지 않은 테스트를 통과했다고 쓰지 마. 코드는 바꾸지 마.',
  },
];
const state = { user: null, config: null, usage: null, project: emptyProject(), revision: 0, demo: false, mode: 'build', provider: 'gpt', view: 'work', dirty: false, generation: 0, saving: false, conflict: false, busy: false, pending: null, errors: [], nonce: '', admin: null, recovery: null, aiError: '', saveTimer: null, localTimer: null };
let toastTimer;
function toast(message) { text('#toast', message); $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
function errorMessage(error) { return error?.message || '요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.'; }

async function api(action, payload, path = '/api/studio', timeout = 15000) {
  let response;
  try {
    response = await fetch(payload === undefined ? `${path}?action=${encodeURIComponent(action)}` : path, { method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: payload === undefined ? {} : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(path === '/api/ai' ? payload : { action, ...payload }), signal: AbortSignal.timeout(timeout) });
  } catch (cause) {
    const error = new Error(cause.name === 'TimeoutError' ? '응답이 지연되고 있습니다. 사용 기록을 확인한 뒤 다시 시도해주세요.' : '연결을 확인해주세요. 지금 작업은 이 브라우저에 임시 보관됩니다.');
    error.code = 'NETWORK_ERROR'; throw error;
  }
  let body;
  try { body = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.'); }
  if (!response.ok) { const error = new Error(body.message || body.error || '요청을 완료하지 못했습니다.'); error.status = response.status; error.code = body.code; throw error; }
  return body;
}

function cacheKey() { return `hyfl-studio-v2:${state.demo ? 'demo' : state.user?.id || 'anonymous'}`; }
function cacheProject() {
  if (!state.user && !state.demo) return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ project: fitProject(state.project), revision: state.revision, dirty: state.dirty, savedAt: now() })); }
  catch { text('#save-status', '임시 저장 공간 부족 · 백업을 내려받아 주세요'); }
}
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
  if (state.demo) { state.dirty = false; cacheProject(); text('#save-status', '이 브라우저에 저장됨'); return; }
  if (state.user.role !== 'student') return;
  state.saving = true; const generation = state.generation; text('#save-status', '팀 작업 저장 중…');
  try {
    const result = await api('save', { project, revision: state.revision });
    state.revision = result.revision;
    if (state.generation === generation) { state.dirty = false; state.project.versions = project.versions; state.project.messages = project.messages; }
    cacheProject(); text('#save-status', state.dirty ? '새 변경 저장 대기 중' : '팀 작업 저장됨');
  } catch (error) {
    if (error.status === 409) { state.conflict = true; show('#conflict-banner'); text('#save-status', '다른 기기의 변경을 확인해주세요'); }
    else { text('#save-status', '서버 저장 실패 · 이 기기에 임시 보관'); toast(errorMessage(error)); }
    cacheProject();
  } finally { state.saving = false; if (state.dirty && !state.conflict) state.saveTimer = setTimeout(saveNow, 12000); }
}

function setView(view) {
  if (view === 'admin' && state.user?.role !== 'teacher') return;
  if (state.user?.role === 'teacher' && !['admin', 'guide'].includes(view)) return;
  state.view = view;
  $$('[data-panel]').forEach(el => { el.hidden = el.dataset.panel !== view; });
  $$('[data-view]').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  $('.sidebar')?.classList.remove('is-open');
  $('#mobile-menu-button').setAttribute('aria-expanded', 'false');
  if (view === 'admin') loadAdmin();
}
function setMode(mode) {
  state.mode = mode;
  $$('[data-mode]').forEach(el => { el.classList.toggle('active', el.dataset.mode === mode); el.setAttribute('aria-pressed', String(el.dataset.mode === mode)); });
  const placeholders = { build: '누구에게 필요한 어떤 기능을 만들까요? 예: 첨부한 CSV에서 지역을 고르면 해당 지역의 결과를 보여줘.', edit: '지금 앱에서 바꿀 부분을 구체적으로 적어주세요. 예: 검색 조건을 초기화하는 버튼을 추가해줘.', debug: '어떤 입력에서, 무엇이 나와야 하는데, 실제로 어떻게 되나요?', explain: '이 코드의 어떤 부분이 궁금한가요? 예: 누락된 값이 계산에서 어떻게 처리되는지 설명해줘.' };
  $('#prompt-input').placeholder = placeholders[mode];
}
function renderProviders() {
  const providers = state.config?.providers || [];
  const enabled = providers.filter(p => p.available && p.enabled !== false);
  const select = $('#provider-select');
  select.innerHTML = (enabled.length ? enabled : [{ id: '', label: state.demo ? '둘러보기 · AI 호출 없음' : '사용 가능한 AI가 없습니다' }]).map(p => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.label)}${p.model ? ` · ${escapeHTML(p.model)}` : ''}</option>`).join('');
  if (!enabled.some(p => p.id === state.provider)) state.provider = enabled.find(p => p.id === state.config?.defaultProvider)?.id || enabled[0]?.id || '';
  select.value = state.provider; select.disabled = state.demo || state.busy || !enabled.length;
  updateAiState();
}
function updateAiState() {
  const disabled = state.demo || state.user?.role !== 'student' || state.config?.aiEnabled === false || !state.provider || state.busy || state.conflict;
  $('#ai-submit').disabled = disabled;
  $('#ai-submit').textContent = state.busy ? '코드 검토 중…' : 'AI에게 요청';
  if (state.busy) text('#ai-status', '현재 코드와 데이터 구조를 함께 살펴보고 있습니다. 결과가 나오면 변경 내용을 확인한 뒤 적용하세요.');
  else if (state.aiError) text('#ai-status', state.aiError);
  else if (state.demo) text('#ai-status', '둘러보기에서는 파일 가져오기·실행·내보내기를 사용할 수 있습니다. AI는 팀 로그인 후 이용합니다.');
  else if (state.user?.role === 'teacher') text('#ai-status', '교사 화면에서는 운영 상태를 확인합니다. 학생은 팀 계정으로 작업합니다.');
  else if (state.config?.aiEnabled === false) text('#ai-status', '선생님이 AI 요청을 잠시 멈췄습니다. 코드 편집과 저장은 계속할 수 있습니다.');
  else if (!state.provider) text('#ai-status', 'AI 연결을 준비 중입니다. 선생님에게 알려주세요.');
  else text('#ai-status', '수정 제안은 확인 후 적용합니다. 실행 결과는 팀이 직접 검증해주세요.');
}
function renderUsage() {
  text('#usage-label', state.demo ? '둘러보기' : state.user?.role === 'teacher' ? '교사 관리' : state.usage ? `오늘 ${state.usage.requests ?? 0} / ${state.usage.dailyRequests ?? state.config?.limits?.dailyRequests ?? 12}회` : '사용량 확인 중');
  $('#usage-label').title = '한국 시간 기준. 이 사이트의 사용량이며, API 계정의 실제 잔액은 각 서비스에서 확인합니다.';
}

function renderChat() {
  const container = $('#chat-messages');
  if (!state.project.messages.length) {
    const choices = state.project.code.trim() ? [workPrompts[4], workPrompts[5]] : [workPrompts[2], workPrompts[3]];
    container.innerHTML = `<div class="empty-state chat-welcome"><h3>${state.project.code.trim() ? '이번에 바꿀 부분을 정하세요.' : '자료를 기능으로 연결해요.'}</h3><p>현재 코드와 프로젝트 맥락이 함께 전달됩니다. 필요한 요청을 골라 우리 팀의 상황에 맞게 고쳐 쓰세요.</p><div class="prompt-suggestions">${choices.map(item => `<button type="button" data-prompt="${escapeHTML(item.prompt)}" data-prompt-mode="${item.mode}">${item.label} <span aria-hidden="true">→</span></button>`).join('')}</div><p class="prompt-draft-note">선택하면 요청 초안이 열립니다. AI에게 요청을 눌러야 전송돼요.</p><button type="button" class="button subtle small" data-view="guide">활동지와 연결하는 방법</button></div>`;
    return;
  }
  container.innerHTML = state.project.messages.map(m => {
    const pending = state.pending?.id === m.id;
    const recorded = state.project.records.some(r => r.prompt === m.prompt && r.help === (m.summary || m.text));
    return `<article class="message ${m.role}"><div class="message-meta"><strong>${m.role === 'user' ? '우리 팀' : escapeHTML(m.provider === 'claude' ? 'Claude' : 'GPT')}</strong><span>${escapeHTML(modeNames[m.mode] || '')} · ${fmtTime(m.createdAt)}</span></div><div class="message-text">${escapeHTML(m.text)}</div>${m.role === 'assistant' ? `${m.model ? `<div class="model-caption">${escapeHTML(m.model)}</div>` : ''}${m.warnings?.length ? `<div class="ai-warning"><strong>확인할 한계</strong><ul>${m.warnings.map(v => `<li>${escapeHTML(v)}</li>`).join('')}</ul></div>` : ''}${m.checks?.length ? `<div class="ai-checks"><strong>직접 실행해 볼 것</strong><ul>${m.checks.map(v => `<li>${escapeHTML(v)}</li>`).join('')}</ul></div>` : ''}<div class="proposal-actions">${pending && state.pending.code ? '<button class="button primary small" data-action="apply-proposal" type="button">변경 내용 적용</button><button class="button secondary small" data-action="inspect-proposal" type="button">제안 코드 보기</button>' : ''}<button class="button secondary small" data-action="record-message" data-id="${escapeHTML(m.id)}" type="button" ${recorded ? 'disabled' : ''}>${recorded ? '대표 기록에 담음' : '대표 기록에 담기'}</button></div>` : ''}</article>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}
function renderProjectFields() {
  $('#project-title').value = state.project.title;
  for (const key of Object.keys(state.project.brief)) { const el = $(`#brief-${key}`); if (el) el.value = state.project.brief[key]; }
  $('#app-url').value = state.project.appUrl;
}
function renderDatasets() {
  const list = $('#dataset-list');
  if (!state.project.datasets.length) { list.innerHTML = '<div class="empty-state compact"><p>확보한 CSV·TSV·JSON·TXT를 연결하세요.</p><small>파일 전체가 미리보기와 내려받은 웹앱에 함께 들어갑니다. 합계 320KB · 최대 8개</small></div>'; return; }
  list.innerHTML = state.project.datasets.map(d => {
    let notice = ''; let detail; try { detail = describeDataset(d); if (d.format === 'json') notice = apiResponseNotice(JSON.parse(d.text.replace(/^\uFEFF/, ''))); } catch { detail = { rows: null, columns: [], error: '파일 형식을 다시 확인해주세요.' }; }
    return `<article class="dataset-card"><div class="dataset-heading"><span class="file-badge">${escapeHTML(d.format.toUpperCase())}</span><div><strong>${escapeHTML(d.name)}</strong><p>${(byteLength(d.text) / 1024).toFixed(1)} KB · ${detail.rows === null ? '구조 확인 필요' : `${detail.rows.toLocaleString('ko-KR')}행`}${detail.columns.length ? ` · ${detail.columns.length}열` : ''}</p></div><button class="icon-button" type="button" data-action="remove-dataset" data-id="${escapeHTML(d.id)}" aria-label="${escapeHTML(d.name)} 삭제">×</button></div>${detail.columns.length ? `<p class="dataset-columns">${escapeHTML(detail.columns.slice(0, 12).join(' · '))}${detail.columns.length > 12 ? ' …' : ''}</p>` : ''}${detail.arrayPath ? `<p class="field-help">실제 행: ${escapeHTML(detail.arrayPath)}</p>` : ''}${notice ? `<p role="status">${escapeHTML(notice)}</p>` : ''}${detail.error ? `<p>${detail.error}</p>` : ''}</article>`;
  }).join('');
}
function renderChecks() {
  $('#checklist').innerHTML = CURRICULUM.checklist.map(item => `<label class="check-item"><input type="checkbox" data-check="${item.id}" ${state.project.checks[item.id] ? 'checked' : ''}><span><strong>${escapeHTML(item.label)}</strong><small>${escapeHTML(item.description)}</small></span></label>`).join('');
}
function renderRecords() {
  $('#records-list').innerHTML = state.project.records.length ? state.project.records.map((r, i) => `<article class="record-card"><div class="card-heading"><h3>대표 사례 ${i + 1}</h3><button type="button" class="button secondary small" data-action="remove-record" data-id="${escapeHTML(r.id)}">삭제</button></div><div class="field"><label for="record-stage-${escapeHTML(r.id)}">활용 단계</label><input id="record-stage-${escapeHTML(r.id)}" value="${escapeHTML(r.stage)}" data-record="${escapeHTML(r.id)}" data-field="stage" maxlength="100" placeholder="예: 기능 구현 · 주요 오류 해결"></div>${[{ id: 'prompt', label: '실제 프롬프트', placeholder: '' }, { id: 'help', label: 'AI의 도움', placeholder: '' }, { id: 'verification', label: '팀이 직접 확인한 내용', placeholder: '직접 실행한 입력, 기대한 값, 실제 값과 확인 방법을 적어주세요.' }, { id: 'decision', label: '채택·수정·제외와 이유', placeholder: '무엇을 사용하거나 바꿨나요? 우리 팀의 판단과 이유를 적어주세요.' }].map(field => `<div class="field"><label for="record-${field.id}-${escapeHTML(r.id)}">${field.label}</label><textarea id="record-${field.id}-${escapeHTML(r.id)}" rows="3" maxlength="6000" data-record="${escapeHTML(r.id)}" data-field="${field.id}" placeholder="${escapeHTML(field.placeholder)}">${escapeHTML(r[field.id])}</textarea></div>`).join('')}</article>`).join('') : '<div class="empty-state compact"><h3>활동지에 남길 AI 도움을 가져오세요.</h3><p>AI 답변의 ‘대표 기록에 담기’를 누르면 실제 요청과 도움을 가져옵니다. 확인한 내용과 팀의 판단은 직접 적습니다.</p></div>';
}
function renderVersions() {
  $('#versions-list').innerHTML = state.project.versions.length ? state.project.versions.map(v => `<article class="version-card"><div><span class="eyebrow">${fmtTime(v.createdAt)}</span><h3>${escapeHTML(v.note || '수정 전 버전')}</h3><p>${(byteLength(v.code) / 1024).toFixed(1)} KB · HTML 코드</p></div><button type="button" class="button secondary" data-action="restore-version" data-id="${escapeHTML(v.id)}">이 버전으로 복원</button></article>`).join('') : '<div class="empty-state"><h3>수정 전 코드를 보관합니다.</h3><p>코드를 가져오거나 AI 제안을 적용하면 이전 코드가 여기에 남습니다.<br>최근 6개까지 용량 안에서 보관합니다. 데이터·기록까지 보관하려면 프로젝트 백업을 내려받으세요.</p></div>';
}
function renderGuide() {
  $('#guide-content').innerHTML = `<div class="guide-intro"><p class="eyebrow">인공지능 원리탐구 · 2학기</p><h2>활동지에서 지금 하는 일을 이어가세요.</h2><p>기존 활동지와 데이터, 만들던 HTML을 함께 펼쳐 두세요.<br>이번에 만들 기능 하나를 정하고, 실행한 결과를 원자료와 비교합니다.</p><a class="button secondary" href="${CURRICULUM.textbookUrl}" target="_blank" rel="noopener noreferrer">교과서 프로젝트 안내 ↗</a> <a class="text-link" href="${CURRICULUM.labUrl}" target="_blank" rel="noopener noreferrer">기본 실습 보기 ↗</a></div><section class="guide-task-section" aria-labelledby="guide-task-title"><h3 id="guide-task-title">지금 필요한 도움</h3><p>요청 초안을 열어 우리 팀의 내용으로 수정하세요. 선택만으로 AI를 호출하지 않습니다.</p><div class="guide-tasks">${workPrompts.map(item => `<button type="button" class="guide-task" data-prompt="${escapeHTML(item.prompt)}" data-prompt-mode="${item.mode}" ${state.user?.role === 'teacher' ? 'disabled' : ''}><small>${item.worksheet}</small><strong>${item.label}</strong><span aria-hidden="true">→</span></button>`).join('')}</div>${state.user?.role === 'teacher' ? '<p class="field-help">학생 계정의 수업 가이드에서 요청 초안을 열 수 있습니다.</p>' : ''}</section><div class="guide-steps">${CURRICULUM.stages.map((s, i) => `<article><span class="step-number">0${i + 1}</span><span class="eyebrow">${escapeHTML(s.worksheet)}</span><h3>${escapeHTML(s.label)}</h3><p>${escapeHTML(s.description)}</p></article>`).join('')}</div><section class="guide-boundaries"><h3>급식뿐 아니라 기상·환경·교통 API도 연결해요.</h3><p>공식 문서에서 JSON으로 요청한 뒤 응답 본문을 프로젝트 맥락의 「API 응답 붙여넣기」에 연결하세요. XML은 JSON으로 다시 요청하거나 TXT 파일로 구조를 확인하세요. 가져온 응답은 저장된 시점의 자료이며 실시간으로 갱신되지 않습니다.</p><p>기상 데이터는 요청 인자 base_date/base_time, 응답 기준 시각 baseDate/baseTime, 예보 대상 fcstDate/fcstTime을 구분하세요. 관측값 obsrValue와 예보값 fcstValue, 격자와 위·경도, 항목과 단위를 구분하세요. 같은 시각의 예보도 발표 회차를 선택하고, 결측·강수 범위를 임의로 0으로 계산하지 마세요. 전체 건수보다 파일의 행 수가 작으면 페이지를 추가로 확보하고 중복 기준을 정하세요. 서로 다른 항목·시각의 값을 합산하지 마세요.</p><p>실시간 조회는 별도 연결입니다. 인증키가 없는 공개 API도 CORS·요청 한도를 확인하고, 키가 필요한 API는 교사가 관리하는 서버와 배포 설정이 필요합니다. 키를 대화·출처 주소·HTML·응답 본문에 넣지 마세요.</p></section><section class="guide-boundaries"><h3>시작하기 전에 확인하세요</h3><dl><div><dt>데이터 파일을 함께 올려주세요.</dt><dd>출처 주소만 적으면 자료가 자동으로 연결되지는 않습니다. CSV·TSV·JSON·TXT 파일을 사용하며 합계 320KB, 최대 8개까지 연결할 수 있습니다.</dd></div><div><dt>숫자는 실제 파일로 계산하고 확인해요.</dt><dd>AI에는 데이터 구조와 일부 행이 전달됩니다. 전체 통계를 안다고 가정하지 말고, 전체 데이터를 계산하는 기능을 만든 뒤 원자료와 대조하세요.</dd></div><div><dt>이곳의 AI는 제작을 돕습니다.</dt><dd>완성한 웹앱 안에 유료 AI 기능이나 신청·결제를 넣으려면 별도 서버와 운영 설계가 필요합니다. 원본 API 키를 학생 코드에 넣지 마세요.</dd></div><div><dt>HTML 파일과 작업 백업을 구분해요.</dt><dd>HTML에는 실행할 코드와 연결한 전체 데이터가 들어갑니다. 프로젝트 백업에는 맥락과 기록도 포함됩니다. 내려받은 HTML을 공개 웹주소로 배포하는 일은 별도입니다.</dd></div></dl></section><div class="guide-submission"><h3>최종 제출은 웹앱 + 활동지</h3><ul>${CURRICULUM.submission.guidelines.map(v => `<li>${escapeHTML(v)}</li>`).join('')}</ul><p class="guide-note">한 기기에서 코드를 수정하고, 다른 팀원은 원자료 확인과 사용자 테스트를 맡아 보세요. 기능 하나를 마치면 역할을 바꿉니다. 중요한 AI 도움은 답변의 「대표 기록에 담기」를 눌러 옮기고, 확인한 사실과 판단은 직접 적습니다.</p></div>`;
}

function renderPreview() {
  state.errors = []; state.nonce = uid(); renderErrors();
  const hasCode = Boolean(state.project.code.trim()); show('#workspace-empty', !hasCode); show('#preview-frame', hasCode);
  if (hasCode) $('#preview-frame').srcdoc = buildDocument(state.project.code, state.project.datasets, { preview: true, nonce: state.nonce });
  else $('#preview-frame').srcdoc = '';
  $('#code-editor').value = state.project.code;
  $('#download-html').disabled = !hasCode;
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
function renderAll() { renderProviders(); renderUsage(); renderChat(); renderProjectFields(); renderDatasets(); renderChecks(); renderRecords(); renderVersions(); renderGuide(); renderPreview(); renderRecovery(); text('#project-heading', state.project.title); }

async function enterWorkspace(result, demo = false) {
  state.demo = demo; state.user = result.user || null; state.config = result.config || state.config; state.usage = result.usage || null; state.project = emptyProject(); state.revision = 0; state.pending = null; state.recovery = null; state.aiError = ''; state.dirty = false; state.conflict = false; show('#conflict-banner', false);
  if (!demo && state.user?.role === 'student') {
    const loaded = await api('project'); state.project = normalizeProject(loaded.project || emptyProject()); state.revision = loaded.revision ?? 0;
  }
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if (cached?.project && (demo || (cached.dirty && cached.revision === state.revision))) { state.project = normalizeProject(cached.project); state.dirty = Boolean(cached.dirty); if (!demo) toast('이 기기에 남아 있던 미저장 작업을 복원했습니다.'); }
    else if (cached?.dirty && cached.revision !== state.revision) { localStorage.setItem(cacheKey() + ':recovery', JSON.stringify(cached)); }
    const recovery = JSON.parse(localStorage.getItem(cacheKey() + ':recovery') || 'null');
    if (recovery?.project) state.recovery = normalizeProject(recovery.project);
  } catch { /* A damaged local backup must never prevent server workspace access. */ }
  show('#auth-screen', false); show('#app-screen'); show('#admin-nav', state.user?.role === 'teacher');
  $$('[data-view]').filter(el => !['guide', 'admin'].includes(el.dataset.view)).forEach(el => { el.hidden = state.user?.role === 'teacher'; });
  text('#team-label', demo ? '둘러보기 · 내 기기 작업' : state.user?.role === 'teacher' ? '선생님' : `2학년 ${state.user.cls}반 · ${state.user.name}`);
  text('#save-status', demo ? '이 브라우저에만 저장' : state.user?.role === 'teacher' ? '교사 관리 화면' : '팀 작업 불러옴');
  renderAll(); if (state.user?.role === 'teacher') text('#project-heading', '2학기 수업 운영'); setMode('build'); setView(state.user?.role === 'teacher' ? 'admin' : 'work'); if (state.dirty) markDirty();
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
      const result = await api(kind === 'teacher' ? 'teacherLogin' : 'login', payload); await enterWorkspace(result); event.target.querySelector('input[type="password"]').value = ''; text('#auth-message', '');
    }
  } catch (error) { text('#auth-message', errorMessage(error)); }
  finally { button.disabled = false; }
}

async function requestAI(event) {
  event.preventDefault(); const prompt = $('#prompt-input').value.trim();
  if (!prompt || state.busy || state.demo) return;
  if (state.conflict) { toast('먼저 다른 기기의 저장 내용과 충돌을 해결해주세요.'); return; }
  const codeAtRequest = state.project.code; const dataAtRequest = JSON.stringify(state.project.datasets);
  state.project.messages.push({ id: uid(), role: 'user', text: prompt, createdAt: now(), mode: state.mode, provider: state.provider });
  const mode = state.mode; const provider = state.provider; state.pending = null; state.aiError = ''; state.busy = true; $('#prompt-input').value = ''; markDirty(); renderChat(); renderProviders();
  try {
    const result = await api('', { mode, prompt, provider, project: { title: state.project.title, brief: state.project.brief, code: state.project.code, datasets: state.project.datasets, messages: state.project.messages.slice(-8) }, runtimeErrors: state.errors.slice(-8) }, '/api/ai', 135000);
    const id = uid(); state.project.messages.push({ id, role: 'assistant', text: result.summary, summary: result.summary, prompt, createdAt: now(), mode, provider: result.provider || provider, model: result.model || '', checks: result.checks || [], warnings: result.warnings || [] });
    if (result.code) state.pending = { id, code: result.code, before: codeAtRequest, datasets: dataAtRequest, summary: result.summary };
    if (result.usage) state.usage = result.usage; markDirty(); renderChat(); renderUsage();
    if (result.code) toast('수정 제안이 도착했습니다. 내용을 확인한 뒤 적용해주세요.');
  } catch (error) { state.aiError = errorMessage(error); toast(state.aiError); text('#ai-status', state.aiError); $('#prompt-input').value = prompt; try { const session = await api('session'); state.usage = session.usage; state.config = session.config || state.config; renderUsage(); } catch {} }
  finally { state.busy = false; renderProviders(); }
}
function applyProposal() {
  if (!state.pending) return;
  if (state.project.code !== state.pending.before || JSON.stringify(state.project.datasets) !== state.pending.datasets) { toast('요청 이후 코드나 데이터가 바뀌었습니다. 현재 상태를 기준으로 다시 요청해주세요.'); return; }
  try { state.project = replaceCode(state.project, state.pending.code, `AI 적용 전 · ${state.pending.summary.slice(0, 70)}`); state.pending = null; state.project.checks = {}; markDirty(); renderChat(); renderPreview(); renderVersions(); renderChecks(); toast('제안을 적용했습니다. 입력과 결과를 직접 확인해주세요.'); }
  catch (error) { toast(errorMessage(error)); }
}
function addRecord(id) {
  const message = state.project.messages.find(m => m.id === id); if (!message) return;
  if (state.project.records.length >= LIMITS.records) { toast('대표 기록은 24개까지 담을 수 있습니다. 중요한 사례를 골라주세요.'); return; }
  state.project.records.push({ id: uid(), createdAt: now(), stage: modeNames[message.mode] || '', prompt: message.prompt || '', help: message.summary || message.text, verification: '', decision: '' });
  markDirty(); renderRecords(); renderChat(); toast('대표 기록에 담았습니다. 검증·기록에서 직접 확인한 내용과 판단을 적어주세요.');
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportProject() { download(JSON.stringify({ format: 'hyfl-studio', version: 2, exportedAt: now(), project: fitProject(state.project) }, null, 2), safeFilename(state.project.title + '-백업', 'json'), 'application/json;charset=utf-8'); toast('코드·데이터·대표 기록이 담긴 백업을 내려받았습니다.'); }

async function loadCode(file) {
  if (!file) return;
  try {
    if (file.size > 700000) throw new Error('가져올 HTML 파일은 700KB 이하여야 합니다. 프로젝트 백업은 JSON 가져오기를 이용해주세요.');
    const imported = importHtml(await file.text());
    if (state.project.code && !confirm('현재 코드를 이전 버전에 보관하고 가져온 HTML로 바꿀까요?')) return;
    state.project = replaceCode(state.project, imported.code, 'HTML 가져오기 전');
    if (imported.datasets) state.project.datasets = imported.datasets;
    state.project.checks = {}; state.pending = null; markDirty(); renderPreview(); renderVersions(); renderDatasets(); renderChecks(); renderChat(); setView('work'); toast('HTML을 가져왔습니다. 오른쪽에서 바로 실행해보세요.');
  } catch (error) { toast(errorMessage(error)); }
  finally { $('#code-file').value = ''; }
}
async function loadDatasets(files) {
  try {
    const next = structuredClone(state.project.datasets);
    for (const file of files) {
      if (file.size > LIMITS.datasetBytes) throw new Error('첨부 데이터는 파일 합계 320KB까지 사용할 수 있습니다.');
      const ext = file.name.split('.').pop().toLowerCase(); if (!['csv', 'tsv', 'json', 'txt'].includes(ext)) throw new Error('CSV, TSV, JSON, TXT 파일을 선택해주세요.');
      const content = await file.text(); const existing = next.find(d => d.name === file.name);
      const dataset = { id: existing?.id || uid(), name: file.name, format: ext === 'txt' ? 'text' : ext, text: content }; describeDataset(dataset);
      if (existing) next.splice(next.indexOf(existing), 1, dataset); else next.push(dataset);
    }
    if (next.length > 8) throw new Error('데이터 파일은 최대 8개까지 연결할 수 있습니다.');
    if (next.reduce((sum, d) => sum + byteLength(d.text), 0) > LIMITS.datasetBytes) throw new Error('첨부 데이터 합계가 320KB를 넘습니다. 필요한 열·행을 추려서 가져와 주세요.');
    state.project = normalizeProject({ ...state.project, datasets: next, checks: {} }); markDirty(); renderDatasets(); renderPreview(); renderChecks(); toast('전체 파일을 연결했습니다. AI에 사용할 열과 계산 기준을 알려주세요.');
  } catch (error) { toast(errorMessage(error)); }
  finally { $('#dataset-file').value = ''; }
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
  if (button.dataset.authTab) return authTab(button.dataset.authTab);
  if (button.dataset.view) return setView(button.dataset.view);
  if (button.dataset.mode) return setMode(button.dataset.mode);
  if (button.dataset.prompt) {
    if (state.user?.role === 'teacher') return;
    setView('work'); $('#surface-chat').checked = true;
    setMode(button.dataset.promptMode || 'build'); $('#prompt-input').value = button.dataset.prompt; $('#prompt-input').focus(); return;
  }
  const action = button.dataset.action; const id = button.dataset.id;
  try {
    if (action === 'apply-proposal') applyProposal();
    else if (action === 'inspect-proposal' && state.pending) { download(state.pending.code, 'AI-제안-검토용.html.txt', 'text/plain;charset=utf-8'); toast('검토용 코드입니다. 실행에는 전체 데이터 연결과 적용이 필요합니다.'); }
    else if (action === 'record-message') addRecord(id);
    else if (action === 'remove-record' && confirm('이 대표 기록을 삭제할까요?')) { state.project.records = state.project.records.filter(r => r.id !== id); markDirty(); renderRecords(); renderChat(); }
    else if (action === 'remove-dataset' && confirm('이 데이터 연결을 해제할까요? 사용하는 앱 기능을 다시 확인해주세요.')) { state.project.datasets = state.project.datasets.filter(d => d.id !== id); state.project.checks = {}; markDirty(); renderDatasets(); renderPreview(); renderChecks(); }
    else if (action === 'restore-version') { const version = state.project.versions.find(v => v.id === id); if (version && confirm('현재 코드를 보관하고 이 버전으로 돌아갈까요? 데이터 파일과 대표 기록은 그대로 유지됩니다.')) { state.project = replaceCode(state.project, version.code, '이전 버전 복원 전'); state.pending = null; state.project.checks = {}; markDirty(); renderPreview(); renderVersions(); renderChecks(); renderChat(); setView('work'); toast('코드를 복원했습니다. 데이터 연결과 동작을 다시 확인해주세요.'); } }
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
$('#mobile-menu-button').addEventListener('click', () => { const open = $('.sidebar').classList.toggle('is-open'); $('#mobile-menu-button').setAttribute('aria-expanded', String(open)); });
$('#logout-button').addEventListener('click', async () => {
  if (state.busy) { toast('AI 요청이 끝난 뒤 나가주세요.'); return; }
  await saveNow();
  if (state.dirty && !confirm('아직 서버에 저장되지 않은 작업이 있습니다. 이 기기의 임시 백업을 남기고 나갈까요?')) return;
  try { if (!state.demo) await api('logout', {}); } catch (error) { toast(errorMessage(error)); return; }
  clearTimeout(state.saveTimer); clearTimeout(state.localTimer); state.user = null; state.demo = false; state.project = emptyProject(); state.dirty = false; show('#app-screen', false); show('#auth-screen'); authTab('student'); loadTeams();
});
$('#project-form').addEventListener('submit', event => event.preventDefault());
$('#project-form').addEventListener('input', event => {
  const id = event.target.id;
  if (id === 'project-title') state.project.title = event.target.value.slice(0, 120) || '우리 팀의 데이터 웹앱';
  else if (id.startsWith('brief-')) state.project.brief[id.slice(6)] = event.target.value.slice(0, 5000);
  else return; markDirty();
});
$('#app-url').addEventListener('input', e => { state.project.appUrl = e.target.value.slice(0, 2000); markDirty(); });
$('#checklist').addEventListener('change', e => { if (e.target.dataset.check) { state.project.checks[e.target.dataset.check] = e.target.checked; markDirty(); } });
$('#records-list').addEventListener('input', e => { const r = state.project.records.find(r => r.id === e.target.dataset.record); if (r && ['stage', 'prompt', 'help', 'verification', 'decision'].includes(e.target.dataset.field)) { r[e.target.dataset.field] = e.target.value.slice(0, 6000); markDirty(); } });
$('#import-code-button').addEventListener('click', () => $('#code-file').click());
$('#code-file').addEventListener('change', e => loadCode(e.target.files[0]));
$('#dataset-file').addEventListener('change', e => loadDatasets([...e.target.files]));
$('#import-api-response').addEventListener('click', () => {
  try {
    const dataset = importApiResponse($('#api-response-name').value, $('#api-response-text').value);
    const next = normalizeProject({ ...state.project, datasets: [...state.project.datasets, dataset], checks: {} });
    state.project = next; markDirty(); renderDatasets(); renderPreview(); renderChecks();
    $('#api-response-text').value = ''; text('#api-response-status', '응답을 연결했습니다. 실제 행 경로와 기간·페이지 범위를 확인하세요.');
    toast('API 응답 전체를 데이터로 연결했습니다.');
  } catch (error) { text('#api-response-status', errorMessage(error)); }
});

$('#preview-refresh').addEventListener('click', () => { renderPreview(); toast('현재 코드로 다시 실행했습니다.'); });
$('#code-toggle').addEventListener('click', () => { const visible = $('#code-editor').hidden; show('#code-editor', visible); show('#apply-code-button', visible); $('#code-toggle').classList.toggle('active', visible); $('#code-toggle').setAttribute('aria-pressed', String(visible)); if (visible) $('#code-editor').value = state.project.code; });
$('#apply-code-button').addEventListener('click', () => {
  try { state.project = replaceCode(state.project, $('#code-editor').value, '직접 코드 편집 전'); state.project.checks = {}; state.pending = null; markDirty(); renderPreview(); renderVersions(); renderChecks(); renderChat(); toast('직접 편집한 코드를 적용했습니다.'); }
  catch (error) { toast(errorMessage(error)); }
});
$('#download-html').addEventListener('click', () => { if (state.project.code) { download(buildDocument(state.project.code, state.project.datasets), safeFilename(state.project.title, 'html'), 'text/html;charset=utf-8'); toast('전체 데이터가 포함된 HTML을 내려받았습니다. 파일을 열어 핵심 기능을 다시 확인해주세요.'); } });
$('#export-records').addEventListener('click', () => download(exportRecords(state.project, CURRICULUM.checklist), safeFilename(state.project.title + '-활용기록', 'txt'), 'text/plain;charset=utf-8'));
$('#export-project').addEventListener('click', exportProject);
$('#import-project').addEventListener('click', () => $('#project-file').click());
$('#project-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 3000000) throw new Error('백업 파일은 3MB 이하여야 합니다.');
    const parsed = JSON.parse(await file.text()); if (parsed.format !== 'hyfl-studio' || parsed.version !== 2) throw new Error('이 작업실에서 내려받은 프로젝트 백업 파일을 선택해주세요.');
    const project = normalizeProject(parsed.project);
    if (!confirm('현재 프로젝트 전체를 백업 내용으로 바꿀까요? 현재 작업이 필요하면 취소하고 먼저 백업을 내려받으세요.')) return;
    state.project = project; state.pending = null; markDirty(); renderAll(); setView('work'); toast('프로젝트 백업을 가져왔습니다.');
  } catch (error) { toast(errorMessage(error)); }
  finally { e.target.value = ''; }
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
document.addEventListener('visibilitychange', () => { if (document.hidden) { cacheProject(); saveNow(); } });

async function init() {
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
