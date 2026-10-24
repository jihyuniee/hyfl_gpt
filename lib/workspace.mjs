// Browser-safe project tools. Shared with the dependency-free test suite.
export const LIMITS = Object.freeze({ codeBytes: 120000, datasetBytes: 320000, projectBytes: 800000, versions: 6, messages: 36, records: 24 });
export const byteLength = value => new TextEncoder().encode(String(value ?? '')).length;
export const uid = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now = () => new Date().toISOString();

export function emptyProject() {
  return { title: '우리 팀의 데이터 웹앱', brief: { user: '', problem: '', evidence: '', sourceUrl: '', dataDate: '', minimumFeature: '' }, code: '', datasets: [], messages: [], versions: [], records: [], checks: {}, appUrl: '' };
}

const str = (value, max = 12000) => typeof value === 'string' ? value.slice(0, max) : '';
const array = value => Array.isArray(value) ? value : [];
export function normalizeProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('프로젝트 파일 형식을 확인해주세요.');
  const p = emptyProject();
  p.title = str(input.title, 120) || p.title;
  for (const key of Object.keys(p.brief)) p.brief[key] = str(input.brief?.[key], key === 'sourceUrl' ? 2000 : key === 'dataDate' ? 100 : 5000);
  p.code = str(input.code, 200000);
  if (byteLength(p.code) > LIMITS.codeBytes) throw new Error('HTML은 120KB 이하로 가져와 주세요. 큰 데이터는 CSV·JSON 파일로 따로 연결할 수 있습니다.');
  if (array(input.datasets).length > 8) throw new Error('데이터 파일은 최대 8개까지 연결할 수 있습니다.');
  p.datasets = array(input.datasets).map(d => ({ id: str(d?.id, 100) || uid(), name: str(d?.name, 160) || '데이터', format: ['csv', 'tsv', 'json', 'text'].includes(d?.format) ? d.format : 'text', text: str(d?.text, 500000) }));
  if (p.datasets.reduce((sum, d) => sum + byteLength(d.text), 0) > LIMITS.datasetBytes) throw new Error('첨부 데이터는 합계 320KB까지 저장할 수 있습니다. 필요한 열·행을 추려서 다시 가져와 주세요.');
  p.messages = array(input.messages).slice(-LIMITS.messages).filter(m => ['user', 'assistant'].includes(m?.role)).map(m => ({ id: str(m.id, 100) || uid(), role: m.role, text: str(m.text, 12000), createdAt: str(m.createdAt, 40) || now(), mode: str(m.mode, 20), provider: str(m.provider, 30), model: str(m.model, 100), summary: str(m.summary, 12000), prompt: str(m.prompt, 6000), checks: array(m.checks).slice(0, 8).map(v => str(v, 1000)), warnings: array(m.warnings).slice(0, 8).map(v => str(v, 1000)) }));
  p.versions = array(input.versions).slice(0, LIMITS.versions).filter(v => typeof v?.code === 'string' && byteLength(v.code) <= LIMITS.codeBytes).map(v => ({ id: str(v.id, 100) || uid(), createdAt: str(v.createdAt, 40) || now(), note: str(v.note, 180), code: v.code }));
  p.records = array(input.records).slice(0, LIMITS.records).map(r => ({ id: str(r?.id, 100) || uid(), createdAt: str(r?.createdAt, 40) || now(), stage: str(r?.stage, 100), prompt: str(r?.prompt, 6000), help: str(r?.help ?? r?.assistance, 6000), verification: str(r?.verification, 6000), decision: str(r?.decision, 6000) }));
  for (const key of ['core-function', 'source-comparison', 'source-context', 'empty-and-errors', 'regression', 'user-test', 'export']) p.checks[key] = input.checks?.[key] === true;
  p.appUrl = str(input.appUrl, 2000);
  return fitProject(p);
}

export function fitProject(project) {
  const p = structuredClone(project);
  p.messages = p.messages.slice(-LIMITS.messages);
  p.versions = p.versions.slice(0, LIMITS.versions);
  // Keep student records and current data intact. Only old code/chat may expire.
  while (byteLength(JSON.stringify(p)) > LIMITS.projectBytes && p.versions.length) p.versions.pop();
  while (byteLength(JSON.stringify(p)) > LIMITS.projectBytes && p.messages.length > 2) p.messages.shift();
  if (byteLength(JSON.stringify(p)) > LIMITS.projectBytes) throw new Error('프로젝트 저장 용량(800KB)을 넘었습니다. 백업을 내려받고 첨부 데이터 크기를 줄여주세요.');
  return p;
}

export function replaceCode(project, code, note) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('적용할 HTML 코드가 없습니다.');
  if (byteLength(code) > LIMITS.codeBytes) throw new Error('HTML 코드가 120KB를 넘습니다. 기능을 나누거나 데이터를 별도 파일로 연결해주세요.');
  const next = structuredClone(project);
  if (next.code && next.code !== code) next.versions.unshift({ id: uid(), createdAt: now(), note: str(note, 180) || '수정 전 버전', code: next.code });
  next.code = code;
  return fitProject(next);
}

export function parseDelimited(text, separator = ',') {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell.length === 0) quoted = !quoted;
      else cell += ch;
    } else if (!quoted && ch === separator) { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('닫히지 않은 따옴표가 있습니다. CSV 파일 형식을 확인해주세요.');
  row.push(cell); if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

// Select a supported row array without changing the uploaded JSON. NEIS wraps
// meal rows beside response metadata; that wrapper is not a two-row dataset.
export function selectJsonRows(parsed) {
  if (Array.isArray(parsed)) return { rows: parsed, arrayPath: '$' };
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.mealServiceDietInfo)) {
    const envelope = parsed.mealServiceDietInfo;
    const index = envelope.findIndex(part => part && typeof part === 'object' && !Array.isArray(part) && Array.isArray(part.row));
    // An empty row array is valid. A missing row array must not fall back to
    // counting the head/row envelope or its list_total_count as file rows.
    return index < 0 ? null : { rows: envelope[index].row, arrayPath: `$.mealServiceDietInfo[${index}].row` };
  }
  // Common government API envelopes: weather, air quality and portal datasets.
  if (parsed.response?.header?.resultCode != null && !['00', '0', 'NORMAL_SERVICE'].includes(String(parsed.response.header.resultCode))) return null;
  const body = parsed.response?.body ?? parsed.body;
  if (body && typeof body === 'object') {
    const prefix = parsed.response?.body ? '$.response.body' : '$.body';
    if (Array.isArray(body.items?.item)) return { rows: body.items.item, arrayPath: prefix + '.items.item' };
    if (body.items?.item && typeof body.items.item === 'object') return { rows: [body.items.item], arrayPath: prefix + '.items.item' };
    if (Array.isArray(body.items)) return { rows: body.items, arrayPath: prefix + '.items' };
    if (Array.isArray(body.rows)) return { rows: body.rows, arrayPath: prefix + '.rows' };
    // Empty/error envelopes are not rows of metadata.
    return null;
  }
  const nested = Object.entries(parsed).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.row));
  if (nested.length === 1) return { rows: nested[0][1].row, arrayPath: '$[' + JSON.stringify(nested[0][0]) + '].row' };
  const entry = Object.entries(parsed).find(([, value]) => Array.isArray(value));
  return entry ? { rows: entry[1], arrayPath: '$.' + entry[0] } : null;
}

export function apiResponseNotice(parsed) {
  const body = parsed?.response?.body ?? parsed?.body;
  const header = parsed?.response?.header;
  if (header?.resultCode != null && !['00', '0', 'NORMAL_SERVICE'].includes(String(header.resultCode))) return 'API 응답 코드 ' + String(header.resultCode).slice(0, 40) + ': ' + String(header.resultMsg || '공식 문서에서 오류·자료 없음 여부를 확인하세요.').slice(0, 200);
  const selected = selectJsonRows(parsed);
  const total = body?.totalCount ?? parsed?.totalCount ?? parsed?.matchCount;
  if (selected && total != null && Number.isFinite(Number(total)) && Number(total) > selected.rows.length) return `응답 전체 건수 ${Number(total)} / 이 파일 ${selected.rows.length}행. 다음 페이지를 자동 수집하지 않습니다.`;
  return '';
}

export function importApiResponse(name, source) {
  const text = String(source).replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('인증키나 요청 주소가 아닌 JSON 응답 본문을 붙여넣어주세요.');
  if (byteLength(text) > LIMITS.datasetBytes) throw new Error('API 응답은 320KB 이하여야 합니다. 필요한 범위를 나누어 요청해주세요.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSON 응답을 읽지 못했습니다. 요청 옵션을 JSON으로 지정하세요. XML 응답은 JSON으로 다시 요청하거나 TXT 파일로 가져와 구조를 확인할 수 있습니다.'); }
  // Refuse credential fields rather than quietly retaining them in exported apps.
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (/^(service[_-]?key|api[_-]?key|auth[_-]?key|access[_-]?token|authorization|password)$/i.test(key) && entry) throw new Error('응답에 인증 정보 항목이 있습니다. 인증키·토큰을 제거한 응답 본문만 가져와주세요.');
      visit(entry);
    }
  };
  visit(parsed);
  const filename = String(name || 'api-response').trim().replace(/\.json$/i, '') + '.json';
  return { id: uid(), name: filename.slice(0, 155) + (filename.length > 155 ? '.json' : ''), format: 'json', text };
}

export function describeDataset(dataset) {
  if (dataset.format === 'csv' || dataset.format === 'tsv') {
    const rows = parseDelimited(dataset.text, dataset.format === 'tsv' ? '\t' : ',');
    return { rows: Math.max(0, rows.length - 1), columns: rows[0] || [], sample: rows.slice(1, 4) };
  }
  if (dataset.format === 'json') {
    const parsed = JSON.parse(dataset.text.replace(/^\uFEFF/, ''));
    const selected = selectJsonRows(parsed);
    if (selected) {
      const data = selected.rows;
      return { rows: data.length, columns: data[0] && typeof data[0] === 'object' && !Array.isArray(data[0]) ? Object.keys(data[0]) : [], sample: data.slice(0, 3), arrayPath: selected.arrayPath };
    }
    return { rows: null, columns: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [], sample: parsed };
  }
  return { rows: dataset.text.trim() ? dataset.text.trim().split(/\r?\n/).length : 0, columns: [], sample: dataset.text.slice(0, 240) };
}

function inlineJSON(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }

export function buildDocument(code, datasets = [], { nonce = '', preview = false } = {}) {
  // Only remove our own earlier export wrapper when a downloaded file is imported.
  const clean = String(code).replace(/<script\b[^>]*\bid=["']hyfl-dataset-runtime["'][^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\bid=["']hyfl-preview-runtime["'][^>]*>[\s\S]*?<\/script\s*>/gi, '');
  const data = datasets.map(({ id, name, format, text }) => ({ id, name, format, text }));
  let injection = `<script id="hyfl-dataset-runtime">window.HYFL_DATASETS=${inlineJSON(data)};<\/script>`;
  if (preview) {
    // The opaque sandbox cannot read parent cookies/storage. Only bounded errors
    // are sent; parent additionally checks the exact WindowProxy and nonce.
    const bridge = `(function(){const token=${inlineJSON(nonce)};let count=0;const send=(message,where)=>{if(count++>15)return;parent.postMessage({type:'hyfl-runtime-error',nonce:token,message:String(message).slice(0,1800),where:String(where||'').slice(0,240)},'*')};addEventListener('error',e=>send(e.message,e.filename?e.filename+':'+e.lineno:''));addEventListener('unhandledrejection',e=>send(e.reason&&e.reason.message||e.reason||'처리되지 않은 오류','Promise'));const original=console.error;console.error=function(...args){send(args.map(v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}}).join(' '),'console.error');original.apply(console,args)}})();`;
    injection += `<script id="hyfl-preview-runtime">${bridge}<\/script>`;
  }
  if (/<head\b[^>]*>/i.test(clean)) return clean.replace(/<head\b[^>]*>/i, match => `${match}\n${injection}\n`);
  if (/<html\b[^>]*>/i.test(clean)) return clean.replace(/<html\b[^>]*>/i, match => `${match}\n<head><meta charset="utf-8">${injection}</head>\n`);
  const withoutDoctype = clean.replace(/^\s*<!doctype[^>]*>/i, '');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${injection}</head><body>${withoutDoctype}</body></html>`;
}

export function importHtml(source) {
  // Re-open an exported app without losing the full attached dataset. Parse the
  // JSON assignment only; never execute the HTML or its JavaScript here.
  const match = String(source).match(/<script\b[^>]*\bid=["']hyfl-dataset-runtime["'][^>]*>\s*window\.HYFL_DATASETS\s*=([\s\S]*?);\s*<\/script\s*>/i);
  let datasets = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) datasets = normalizeProject({ datasets: parsed }).datasets;
    } catch { throw new Error('이 HTML에 포함된 데이터 정보를 읽지 못했습니다. 프로젝트 백업 파일로 복원해주세요.'); }
  }
  const code = String(source).replace(/<script\b[^>]*\bid=["']hyfl-dataset-runtime["'][^>]*>[\s\S]*?<\/script\s*>/gi, '');
  if (byteLength(code) > LIMITS.codeBytes) throw new Error('HTML 코드는 120KB까지 가져올 수 있습니다.');
  return { code, datasets };
}

export function exportRecords(project, checklist = []) {
  const lines = [`# ${project.title}`, '', '구글 클래스룸 활동지에 필요한 부분을 골라 옮겨 적으세요.', '아래 확인·판단은 팀이 직접 작성한 내용입니다. 빈 칸은 수행 사실을 뜻하지 않습니다.', '', '## 웹앱', project.appUrl || '주소 미입력 · 내려받은 HTML 파일로 제출 가능', '', '## 직접 확인한 항목'];
  for (const item of checklist) lines.push(`- [${project.checks[item.id] ? 'x' : ' '}] ${item.label}`);
  lines.push('', '## 대표 AI 활용 기록 · STEP 4');
  if (!project.records.length) lines.push('아직 선택한 대표 사례가 없습니다.');
  for (const [i, record] of project.records.entries()) {
    lines.push('', `### 사례 ${i + 1}`, `활용 단계: ${record.stage || '작성 필요'}`, '', '**실제 프롬프트**', record.prompt || '작성 필요', '', '**AI의 도움**', record.help || '작성 필요', '', '**팀이 직접 확인한 내용**', record.verification || '확인 내용 작성 필요', '', '**채택·수정·제외와 이유**', record.decision || '팀의 판단 작성 필요');
  }
  lines.push('', '## 제출 전', '- 활동지 STEP 0~5와 진행 기록을 기존 구글 클래스룸 과제에서 완성합니다.', '- 실행 가능한 웹앱 주소 또는 파일을 제출하고 STEP 3-1에 적습니다.', '- 3분 발표에서 실제 입력·결과를 시연합니다. 슬라이드는 선택입니다.', '- 개인 기여와 배운 점은 각자가 실제로 한 일을 바탕으로 작성합니다.', '');
  return lines.join('\n');
}

export function safeFilename(title, extension) {
  const name = String(title || 'hyfl-webapp').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim().slice(0, 60) || 'hyfl-webapp';
  return `${name}.${extension}`;
}
