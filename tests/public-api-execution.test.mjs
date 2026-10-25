import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fixtures } from './fixtures/public-api-data.mjs';
import { importApiResponse, describeDataset, buildDocument, importHtml, normalizeProject, byteLength } from '../lib/workspace.mjs';
import { datasetContext } from '../lib/server/prompts.mjs';

const code = await readFile(new URL('./fixtures/public-api-app.html', import.meta.url), 'utf8');
const datasets = Object.entries(fixtures).map(([name, json]) => importApiResponse(name, JSON.stringify(json)));

// Execute the actual exported scripts, without a browser or network. This small
// DOM adapter exercises consumer event handlers and text results only; it does
// not claim layout, iframe, download, CSP or deployed-browser verification.
function runDocument(html) {
  const elements = new Map();
  const element = () => ({value:'', textContent:'', children:[], listeners:{}, append(child){this.children.push(child);}, replaceChildren(){this.children=[];}, addEventListener(type, fn){this.listeners[type]=fn;}});
  const document = {getElementById(id){if(!elements.has(id)) elements.set(id,element());return elements.get(id);}, createElement:element};
  const context = vm.createContext({document, console, addEventListener(){}, parent:{postMessage(){}}});
  context.window = context;
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) vm.runInContext(script[1], context, {timeout:1000});
  return {
    get: id => elements.get(id).textContent,
    select(id,value){const el=elements.get(id);assert(el.children.some(option=>option.value===value), `Missing option ${id}: ${value}`);el.value=value;el.listeners.change();},
    data: JSON.parse(JSON.stringify(context.HYFL_DATASETS)),
  };
}

function checkResults(app) {
  assert.match(app.get('status'), /48행.*선택 4행.*예보.*20261024 2300/);
  assert.match(app.get('result'), /평균 -0.5 ℃/);
  app.select('base','20261025 0200');
  assert.match(app.get('result'), /평균 9.5 ℃/);
  app.select('target','20261025 0700');
  assert.match(app.get('status'), /선택 1행.*20261025 0700/);
  assert.match(app.get('result'), /평균 11 ℃/);
  app.select('place','61,127');
  assert.match(app.get('result'), /평균 31 ℃/);
  app.select('place','60,127');
  app.select('metric','REH');
  assert.match(app.get('result'), /평균 57 %/);
  app.select('metric','PCP');
  assert.match(app.get('result'), /1mm 미만/);
  assert.doesNotMatch(app.get('result'), /평균/);
  app.select('base','20261024 2300');
  assert.equal(app.get('result'), '결과 없음');
  app.select('source','observations.json');
  assert.match(app.get('status'), /12행.*선택 1행.*관측/);
  assert.match(app.get('result'), /평균 -3 ℃/);
  app.select('source','air.json');
  assert.match(app.get('status'), /12행.*선택 3행.*2026-10-25 09:00/);
  assert.match(app.get('result'), /유효 2 \/ 제외 1\n평균 5 ㎍\/㎥/);
  app.select('target','2026-10-25 10:00');
  assert.match(app.get('result'), /평균 25 ㎍\/㎥/);
  app.select('target','2026-10-25 11:00');
  assert.match(app.get('result'), /평균 50 ㎍\/㎥/);
  app.select('target','2026-10-25 12:00');
  assert.match(app.get('result'), /평균 80 ㎍\/㎥/);
  app.select('place','검증-C');
  assert.match(app.get('result'), /평균 90 ㎍\/㎥/);
  app.select('metric','o3Value');
  assert.match(app.get('result'), /평균 0.025 ppm/);
  app.select('source','portal.json');
  assert.match(app.get('status'), /12행.*선택 12행/);
  assert.match(app.get('result'), /"값": 11/);
  app.select('source','seoul.json');
  assert.match(app.get('result'), /가상행사 12/);
}

test('real-shape synthetic responses preserve all 96 rows and tail fields through preview, HTML export and re-import execution', () => {
  assert.deepEqual(datasets.map(d=>describeDataset(d).rows), [48,12,12,12,12]);
  for (const d of datasets) {const c=datasetContext(d);assert.equal(c.sampleRowsCount,8);assert.equal(c.truncated,true);}
  assert(byteLength(JSON.stringify(normalizeProject({code,datasets}))) < 800000);
  const preview = runDocument(buildDocument(code,datasets,{preview:true,nonce:'synthetic-preview'}));
  checkResults(preview);
  const exported = buildDocument(code,datasets);
  assert(!exported.includes('hyfl-preview-runtime'));
  const reopened = importHtml(exported);
  assert.deepEqual(reopened.datasets,datasets);
  const rerun = runDocument(buildDocument(reopened.code,reopened.datasets));
  checkResults(rerun);
  assert.deepEqual(rerun.data,datasets);
});

test('consumer fixture displays an empty state instead of fabricated measurements without datasets', () => {
  assert.equal(runDocument(buildDocument(code)).get('status'), '데이터 파일을 연결하세요.');
});
