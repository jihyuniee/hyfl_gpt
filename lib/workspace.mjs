// Browser-safe project tools. Shared with the dependency-free test suite.
export const LIMITS = Object.freeze({ codeBytes: 120000, datasetBytes: 320000, projectBytes: 800000, versions: 6, messages: 36, records: 24 });
export const byteLength = value => new TextEncoder().encode(String(value ?? '')).length;
export const uid = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now = () => new Date().toISOString();

// File.text() always assumes UTF-8. Korean public CSVs may instead use CP949
// (the web platform's euc-kr decoder includes its extension characters).
export function decodeDatasetBytes(input) {
  const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  const bomEncoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : null;
  for (const encoding of bomEncoding ? [bomEncoding] : ['utf-8', 'euc-kr']) {
    let text;
    try { text = new TextDecoder(encoding, {fatal:true}).decode(bytes); } catch { continue; }
    // Some non-browser ICU decoders leave legacy lead bytes as C1 controls.
    // Reject those rather than silently accepting still-corrupted Korean text.
    if (encoding === 'euc-kr' && /[\u0080-\u009f]/.test(text)) continue;
    if (text.includes('\uFFFD')) throw new Error('파일에 이미 깨진 문자(�)가 들어 있습니다. 원본 파일을 다시 받거나 한글이 정상인 원본을 UTF-8 CSV로 저장해 연결해주세요.');
    return {text, encoding};
  }
  throw new Error('파일의 문자 인코딩을 읽지 못했습니다. 한글이 정상인 원본을 UTF-8 CSV로 저장해 다시 연결해주세요.');
}

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
function apiEnvelope(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const services = Object.values(parsed).filter(value => value && typeof value === 'object' && !Array.isArray(value) && (Array.isArray(value.row) || value.RESULT));
  const service = services.length === 1 ? services[0] : null;
  const neisHead = Array.isArray(parsed.mealServiceDietInfo) ? parsed.mealServiceDietInfo.find(part => Array.isArray(part?.head))?.head : null;
  const result = parsed.RESULT ?? service?.RESULT ?? neisHead?.find(part => part?.RESULT)?.RESULT;
  const header = parsed.response?.header ?? (parsed.body ? parsed.header : null);
  if (header?.resultCode != null && !['00', '0', 'NORMAL_SERVICE'].includes(String(header.resultCode))) return { errorCode: header.resultCode, errorMessage: header.resultMsg };
  if (result?.CODE != null && String(result.CODE) !== 'INFO-000') return { errorCode: result.CODE, errorMessage: result.MESSAGE };
  const count = value => value !== null && value !== undefined && String(value).trim() !== '' && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const body = parsed.response?.body ?? parsed.body;
  // ODcloud totalCount is the unfiltered population; matchCount describes the
  // current query. Seoul/NEIS totals live beside row, not at the document root.
  const matchCount = Array.isArray(parsed.data) ? count(parsed.matchCount) : null;
  const total = matchCount ?? count(body?.totalCount) ?? count(service?.list_total_count) ?? count(neisHead?.find(part => part?.list_total_count != null)?.list_total_count) ?? count(parsed.totalCount);
  return { total, label: matchCount === null ? '응답 전체 건수' : '조회 조건 일치 건수', originalTotal: matchCount === null ? null : count(parsed.totalCount) };
}

export function selectJsonRows(parsed) {
  if (Array.isArray(parsed)) return { rows: parsed, arrayPath: '$' };
  if (!parsed || typeof parsed !== 'object') return null;
  if (apiEnvelope(parsed).errorCode != null) return null;
  if (Array.isArray(parsed.mealServiceDietInfo)) {
    const envelope = parsed.mealServiceDietInfo;
    const index = envelope.findIndex(part => part && typeof part === 'object' && !Array.isArray(part) && Array.isArray(part.row));
    // An empty row array is valid. A missing row array must not fall back to
    // counting the head/row envelope or its list_total_count as file rows.
    return index < 0 ? null : { rows: envelope[index].row, arrayPath: `$.mealServiceDietInfo[${index}].row` };
  }
  // Common government API envelopes: weather, air quality and portal datasets.
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
  const { errorCode, errorMessage, total, label, originalTotal } = apiEnvelope(parsed);
  if (errorCode != null) return 'API 응답 코드 ' + String(errorCode).slice(0, 40) + ': ' + String(errorMessage || '공식 문서에서 오류·자료 없음 여부를 확인하세요.').slice(0, 200);
  const selected = selectJsonRows(parsed);
  if (total != null) {
    const scope = `${label} ${total}` + (originalTotal != null && originalTotal !== total ? ` (원본 전체 건수 ${originalTotal})` : '');
    if (!selected && total > 0) return `${scope}. 실제 행 배열을 찾지 못했습니다. 응답 구조와 조회 범위를 확인하세요.`;
    if (selected && total > selected.rows.length) return `${scope} / 이 파일 ${selected.rows.length}행. 다음 페이지를 자동 수집하지 않습니다.`;
    if (selected && total < selected.rows.length) return `${scope} / 이 파일 ${selected.rows.length}행. 건수가 일치하지 않습니다. 페이지 중복·병합 범위를 확인하세요.`;
    if (selected && originalTotal != null && originalTotal !== total) return `${scope} / 이 파일 ${selected.rows.length}행.`;
  }
  if (selected?.rows.length === 0) return '응답에 데이터 행이 없습니다. 조회 조건과 자료 없음 코드를 확인하세요.';
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

// Full-row table tools shared by the browser, AI context and dependency-free tests.
export function datasetTable(dataset) {
  if (['csv', 'tsv'].includes(dataset.format)) {
    const rows = parseDelimited(dataset.text, dataset.format === 'tsv' ? '\t' : ',');
    return {columns:(rows[0] || []).map((v,i)=>v || `열 ${i+1}`), rows:rows.slice(1)};
  }
  if (dataset.format !== 'json') throw new Error('표·그래프는 CSV·TSV·JSON 자료를 연결해주세요.');
  const selected = selectJsonRows(JSON.parse(dataset.text.replace(/^\uFEFF/,'')));
  if (!selected) throw new Error('표로 읽을 행을 찾지 못했습니다. API 오류와 자료 구조를 확인하세요.');
  const rows = selected.rows;
  if (rows.every(row=>row && typeof row==='object' && !Array.isArray(row))) {
    const columns = [...new Set(rows.flatMap(Object.keys))];
    return {columns, rows:rows.map(row=>columns.map(key=>row[key] ?? null))};
  }
  if (rows.every(Array.isArray)) {
    const width = rows.reduce((max,row)=>Math.max(max,row.length),0);
    return {columns:Array.from({length:width},(_,i)=>`열 ${i+1}`), rows};
  }
  return {columns:['값'],rows:rows.map(value=>[value])};
}
export function dataNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(source)) return null;
  const number = Number(source.replace(/,/g,''));
  return Number.isFinite(number) ? number : null;
}
export function numericSummary(values) {
  const numbers = values.map(dataNumber).filter(value=>value !== null);
  const sum = numbers.reduce((total,value)=>total+value,0);
  const mean=numbers.reduce((average,value,index)=>average*(index/(index+1))+value/(index+1),0);
  return {valid:numbers.length,excluded:values.length-numbers.length,min:numbers.length?numbers.reduce((a,b)=>Math.min(a,b)):null,max:numbers.length?numbers.reduce((a,b)=>Math.max(a,b)):null,sum:numbers.length&&Number.isFinite(sum)?sum:null,mean:numbers.length&&Number.isFinite(mean)?mean:null};
}
export function datasetProfile(dataset) {
  const table = datasetTable(dataset);
  // Long-form API values may have different categories/units. Do not summarize
  // them across categories; the interactive chart requires explicit filters.
  if (table.columns.includes('category') || ['ITM_NM','UNIT_NM'].some(name=>{const index=table.columns.indexOf(name);return index>=0&&new Set(table.rows.map(row=>row[index])).size>1;})) return {totalRows:table.rows.length,numericColumns:[],notice:'항목·단위·발표 회차·격자별로 나누어 계산해야 합니다.'};
  const numericColumns = table.columns.flatMap((name,index)=>{
    if (/연도|년도|기준일|날짜|코드|(?:^|_)(?:id|year|date|nx|ny)(?:$|_)/i.test(name)) return [];
    const values=table.rows.map(row=>row[index]);
    const summary=numericSummary(values);
    const nonempty=values.filter(v=>v!==null && v!==undefined && String(v).trim()!=='' && String(v).trim()!=='-').length;
    return summary.valid && summary.valid >= nonempty*.8 ? [{column:name,...summary}] : [];
  });
  return {totalRows:table.rows.length,numericColumns:numericColumns.slice(0,12),columnsOmitted:Math.max(0,numericColumns.length-12),notice:'전체 첨부 행으로 계산한 열별 기초 통계입니다. 단위·비교 조건·인과관계는 별도로 확인해야 합니다.'};
}

// Hints apply only to recognized value columns; original values stay intact.
export function seriesInfo(columns, rows, valueColumn) {
  const value = name => { const i=columns.indexOf(name); return i<0?'':String(rows[0]?.[i]??''); };
  if (['fcstValue','obsrValue'].includes(valueColumn) && columns.includes('category')) {
    const code=value('category');
    const weather={TMP:['기온','℃'],T1H:['기온','℃'],TMN:['최저기온','℃'],TMX:['최고기온','℃'],REH:['습도','%'],POP:['강수확률','%'],PCP:['1시간 강수량','mm · 범주·범위 원문 유지'],RN1:['1시간 강수량','mm · 범주·범위 원문 유지'],SNO:['1시간 신적설','cm · 범주·범위 원문 유지'],WSD:['풍속','m/s'],UUU:['동서바람성분','m/s'],VVV:['남북바람성분','m/s'],VEC:['풍향','°'],WAV:['파고','m'],SKY:['하늘상태','분류 코드'],PTY:['강수형태','분류 코드'],LGT:['낙뢰','분류 코드']};
    const [label,unit]=weather[code]||[code,'원자료 단위 확인 필요'];
    const forecast=valueColumn==='fcstValue';
    return {categorical:['SKY','PTY','LGT'].includes(code),unit,note:(forecast?'예보값':'실황 관측값')+' · '+code+' '+label+' ('+unit+') · 발표 '+value('baseDate')+' '+value('baseTime')+(forecast?' · 예보 대상 '+value('fcstDate')+' / 가로축 fcstTime은 대상 시각':' · baseDate/baseTime은 응답의 발표 시점')+' · 기상청 동네예보 시각은 한국시간(KST). nx/ny는 격자 번호입니다. 저장된 응답이며 자동 갱신하지 않습니다.'};
  }
  const air={pm10Value:['미세먼지 PM10','μg/m³'],pm25Value:['초미세먼지 PM2.5','μg/m³'],o3Value:['오존','ppm'],no2Value:['이산화질소','ppm'],coValue:['일산화탄소','ppm'],so2Value:['아황산가스','ppm']};
  if (columns.includes('dataTime') && columns.includes('stationName') && air[valueColumn]) {
    const [label,unit]=air[valueColumn]; return {unit,note:label+' ('+unit+') · dataTime은 측정 시각 '+value('dataTime')+' · 결측·점검 표시는 원문 표에서 확인하세요. 저장된 응답이며 자동 갱신하지 않습니다.'};
  }
  const unit=value('UNIT_NM');
  return {unit,note:unit?'선택 항목 단위: '+unit:'선택 열: '+valueColumn+' · 단위와 시간의 의미는 원자료에서 확인하세요.'};
}

// A real, offline-capable first result: parse the complete attached text at
// runtime, filter long-form API series, plot selected columns, and inspect rows.
export function buildQuickChart(datasetId='') {
  const helpers = [parseDelimited,apiEnvelope,selectJsonRows,apiResponseNotice,datasetTable,dataNumber,numericSummary,seriesInfo].map(fn=>fn.toString()).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>데이터 표·그래프</title><style>
body{font:15px system-ui,sans-serif;color:#25332d;background:#fafbf8;margin:0;padding:24px}main{max-width:1000px;margin:auto}h1{font-size:24px;margin:0 0 8px}p{line-height:1.7;color:#59675e}.controls{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0}label{display:grid;gap:5px;font-size:12px}select{font:inherit;max-width:260px;padding:8px;border:1px solid #bac4b7;border-radius:6px;background:white}#chart{background:white;border:1px solid #d9ddd5;border-radius:8px;padding:10px}svg{width:100%;height:auto}table{border-collapse:collapse;width:100%;background:white;font-size:12px}th,td{text-align:left;border:1px solid #d9ddd5;padding:8px;white-space:pre-wrap;max-width:280px;overflow-wrap:anywhere}.table-wrap{overflow:auto;max-height:340px;margin-top:18px}#summary{font-weight:600;color:#25332d}.note{font-size:12px}button{padding:8px;background:#edf1e9;border:1px solid #bac4b7;cursor:pointer}
</style></head><body><main><h1>데이터 표·그래프</h1><p id="source-note"></p><div class="controls"><label>자료<select id="dataset"></select></label><label>가로축<select id="x"></select></label><label>세로축<select id="y"></select></label><label>그래프<select id="type"><option value="line">꺾은선</option><option value="bar">막대</option></select></label></div><div id="filters" class="controls"></div><p id="series-note" class="note"></p><p id="summary" role="status"></p><div id="chart"></div><p id="scope" class="note"></p><div id="table" class="table-wrap"></div><p class="note">저장된 파일의 값입니다. 출처·기준 시점·단위는 원자료를 확인하세요. 항목과 단위가 다른 값을 합산하지 않으며, 함께 변한다는 사실만으로 원인이라고 단정하지 않습니다.</p></main><script>
${helpers}
const $=id=>document.getElementById(id), datasets=window.HYFL_DATASETS||[], initial=${inlineJSON(datasetId)};
let table={columns:[],rows:[]};
function option(select,value,label=value){const node=document.createElement('option');node.value=value;node.textContent=label;select.append(node)}
function cell(value){return value==null?'':typeof value==='object'?JSON.stringify(value):String(value)}
function filtered(){return table.rows.filter(row=>[...$('filters').querySelectorAll('select')].every(select=>cell(row[Number(select.dataset.column)])===select.value))}
function load(){
 const dataset=datasets.find(d=>d.id===$('dataset').value);if(!dataset){$('summary').textContent='CSV·TSV·JSON 자료를 연결하세요.';return}
 $('source-note').textContent=dataset.name;$('filters').replaceChildren();
 try{table=datasetTable(dataset)}catch(error){$('summary').textContent=error.message;$('chart').replaceChildren();$('table').replaceChildren();return}
 const notice=dataset.format==='json'?apiResponseNotice(JSON.parse(dataset.text.replace(/^\uFEFF/,''))):'';
 $('source-note').textContent=dataset.name+' · 파일 전체 '+table.rows.length+'행'+(notice?' · '+notice:'');
 $('filters').replaceChildren();
 for(const name of ['category','baseDate','baseTime','nx','ny','fcstDate','dataTime','ITM_NM','UNIT_NM','C1_NM']){
  const index=table.columns.indexOf(name);if(index<0)continue;
  const values=[...new Set(table.rows.map(row=>cell(row[index])))];
  const label=document.createElement('label');label.textContent=({category:'항목 category',baseDate:'발표일 baseDate',baseTime:'발표 시각 baseTime',fcstDate:'예보 대상일 fcstDate',dataTime:'측정 시각 dataTime',nx:'격자 X nx',ny:'격자 Y ny'})[name]||name;const select=document.createElement('select');select.dataset.column=index;for(const value of values)option(select,value);select.addEventListener('change',render);label.append(select);$('filters').append(label)
 }
 for(const id of ['x','y']){$(id).replaceChildren();table.columns.forEach((name,i)=>option($(id),String(i),name))}
 let x=table.columns.findIndex(name=>['fcstTime','stationName','PRD_DE'].includes(name));if(x<0)x=0;$('x').value=String(x);
 let y=table.columns.findIndex(name=>['fcstValue','obsrValue','pm10Value','DT'].includes(name));
 if(y<0)y=table.columns.findIndex((name,i)=>i!==x&&!/연도|년도|일자|날짜|코드|(?:^|_)(?:id|year|date|nx|ny)(?:$|_)/i.test(name)&&table.rows.some(row=>dataNumber(row[i])!==null));
 $('y').value=String(y<0?Math.min(1,table.columns.length-1):y);render()
}
function render(){
 const rows=filtered(), x=Number($('x').value),y=Number($('y').value),info=seriesInfo(table.columns,rows,table.columns[y]),values=rows.map(row=>row[y]),stats=numericSummary(info.categorical?[]:values),points=(info.categorical?[]:rows).map(row=>({label:cell(row[x]),value:dataNumber(row[y])})).filter(p=>p.value!==null);
 if(points.every(p=>dataNumber(p.label)!==null))points.sort((a,b)=>dataNumber(a.label)-dataNumber(b.label));const shown=points.slice(0,120);
 const fmt=n=>n===null?'—':new Intl.NumberFormat('ko-KR',{maximumFractionDigits:5}).format(n);
 $('series-note').textContent=info.note;
 $('summary').textContent='선택 '+rows.length+'행 · 숫자 '+stats.valid+'개 / 결측·문자 '+stats.excluded+'개 제외'+(stats.valid?' · 최소 '+fmt(stats.min)+' / 최대 '+fmt(stats.max)+' / 평균 '+fmt(stats.mean)+(info.unit?' ('+info.unit+')':''):info.categorical?' · 분류 코드: 평균·수치 그래프를 계산하지 않습니다.':'');
 $('chart').replaceChildren();
 if(!shown.length){$('chart').textContent=info.categorical?'분류 코드의 뜻과 빈도는 원자료와 아래 표에서 확인하세요.':'선택한 열에 그래프로 표시할 숫자가 없습니다. 범주·범위 값은 아래 표에서 확인하세요.'}
 else{
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 860 360');svg.setAttribute('role','img');svg.setAttribute('aria-label',table.columns[x]+'에 따른 '+table.columns[y]);
  const low=Math.min(0,...shown.map(p=>p.value)),high=Math.max(0,...shown.map(p=>p.value)),scale=Math.max(Math.abs(low),Math.abs(high))||1,span=(high/scale-low/scale)||1,px=i=>60+(i+.5)*760/shown.length,py=v=>300-(v/scale-low/scale)/span*260;
  function shape(tag,attrs){const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));svg.append(node);return node}
  shape('line',{x1:60,y1:py(0),x2:820,y2:py(0),stroke:'#a9b6ad'});
  for(const value of [low,high]){const label=shape('text',{x:4,y:py(value)+4,fill:'#59675e','font-size':12});label.textContent=fmt(value)}
  if($('type').value==='line')shape('polyline',{points:shown.map((p,i)=>px(i)+','+py(p.value)).join(' '),fill:'none',stroke:'#375d48','stroke-width':2});
  shown.forEach((p,i)=>{let node;if($('type').value==='bar')node=shape('rect',{x:px(i)-Math.max(1,600/shown.length)/2,y:Math.min(py(0),py(p.value)),width:Math.max(1,600/shown.length),height:Math.max(1,Math.abs(py(0)-py(p.value))),fill:'#4b785e'});else node=shape('circle',{cx:px(i),cy:py(p.value),r:3,fill:'#375d48'});const title=document.createElementNS(ns,'title');title.textContent=p.label+': '+p.value;node.append(title);if(shown.length<=15||i%Math.ceil(shown.length/10)===0){const label=shape('text',{x:px(i),y:325,'text-anchor':'middle','font-size':11,fill:'#59675e'});label.textContent=p.label.length>18?p.label.slice(0,18)+'…':p.label}});
  $('chart').append(svg)
 }
 const scope=[...$('filters').querySelectorAll('select')].map(s=>table.columns[Number(s.dataset.column)]+'='+s.value).join(' · ');
 $('scope').textContent=(scope?'범위: '+scope+'. ':'')+'통계는 선택한 전체 행으로 계산합니다. 그래프 '+shown.length+'/'+points.length+'개 · 표 '+Math.min(100,rows.length)+'/'+rows.length+'행 표시. 원문 전체는 파일에 보존됩니다. 중복 행은 자동 제거하지 않습니다.';
 const node=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');table.columns.forEach(name=>{const th=document.createElement('th');th.textContent=name;tr.append(th)});head.append(tr);node.append(head);const body=document.createElement('tbody');for(const row of rows.slice(0,100)){const tr=document.createElement('tr');for(let i=0;i<table.columns.length;i++){const td=document.createElement('td');td.textContent=cell(row[i]);tr.append(td)}body.append(tr)}node.append(body);$('table').replaceChildren(node)
}
for(const d of datasets.filter(d=>['csv','tsv','json'].includes(d.format)))option($('dataset'),d.id,d.name);if(datasets.some(d=>d.id===initial))$('dataset').value=initial;
$('dataset').addEventListener('change',load);for(const id of ['x','y','type'])$(id).addEventListener('change',render);load();
<\/script></body></html>`;
}
export function exportConversation(project) {
  return ['# '+project.title,'','이 파일은 보관된 실제 대화입니다. 활동지에는 필요한 내용을 옮겨 적으세요.',''].concat(project.messages.flatMap(message=>['## '+(message.role==='user'?'우리 팀':'AI')+' · '+message.createdAt,message.role==='assistant'&&message.model?'모델: '+message.model:'',message.text,''])).join('\n');
}

export function safeFilename(title, extension) {
  const name = String(title || 'hyfl-webapp').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim().slice(0, 60) || 'hyfl-webapp';
  return `${name}.${extension}`;
}
