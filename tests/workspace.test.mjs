import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { LIMITS, emptyProject, normalizeProject, fitProject, replaceCode, parseDelimited, describeDataset, buildDocument, importHtml, exportRecords, byteLength } from '../lib/workspace.mjs';
import { CURRICULUM, buildSystemPrompt } from '../lib/curriculum.mjs';
import { neisMealFixture } from './dataset-fixtures.mjs';

test('CSV preserves quoted commas, escaped quotes, CRLF, Korean text, and multiline cells', () => {
  const rows = parseDelimited('\uFEFF지역,설명,값\r\n서울,"가,나",12\r\n부산,"첫 줄\n둘째 ""인용""",0\r\n');
  assert.deepEqual(rows, [['지역', '설명', '값'], ['서울', '가,나', '12'], ['부산', '첫 줄\n둘째 "인용"', '0']]);
  assert.throws(() => parseDelimited('a,b\n"unfinished,b'), /따옴표/);
});

test('dataset row count and JSON metadata describe full data rather than sample size', () => {
  const csv = { format: 'csv', text: '이름,값\n' + Array.from({ length: 27 }, (_, i) => `항목${i},${i}`).join('\n') };
  const result = describeDataset(csv);
  assert.equal(result.rows, 27); assert.equal(result.sample.length, 3);
  assert.deepEqual(describeDataset({ format: 'json', text: '{"items":[{"지역":"서울"},{"지역":"부산"}]}' }).columns, ['지역']);
  assert.deepEqual(describeDataset({ format: 'json', text: '[{"지역":"서울"},{"지역":"부산"}]' }), { rows: 2, columns: ['지역'], sample: [{ 지역: '서울' }, { 지역: '부산' }], arrayPath: '$' });
  assert.throws(() => describeDataset({ format: 'json', text: 'not json' }));
});

test('NEIS description selects actual meal rows and preserves the complete uploaded envelope in exports', () => {
  const { rows, dataset } = neisMealFixture({ bom: true });
  const originalText = dataset.text;
  const result = describeDataset(dataset);
  assert.equal(result.rows, 12); assert.equal(result.arrayPath, '$.mealServiceDietInfo[1].row');
  assert.deepEqual(result.columns, Object.keys(rows[0])); assert.deepEqual(result.sample, rows.slice(0, 3));
  assert(!result.columns.includes('head')); assert(!result.columns.includes('row'));
  const html = buildDocument('<html><head></head><body></body></html>', [dataset]);
  const script = html.match(/<script id="hyfl-dataset-runtime">([\s\S]*?)<\/script>/)[1];
  const sandbox = { window: {} }; vm.runInNewContext(script, sandbox);
  assert.equal(sandbox.window.HYFL_DATASETS[0].text, originalText);
  assert.equal(importHtml(html).datasets[0].text, originalText); assert.equal(dataset.text, originalText);
});

test('empty or missing NEIS row arrays never count response metadata as uploaded data rows', () => {
  const { dataset } = neisMealFixture({ count: 0, declaredTotal: 999 });
  assert.deepEqual(describeDataset(dataset), { rows: 0, columns: [], sample: [], arrayPath: '$.mealServiceDietInfo[1].row' });
  const missingRows = { ...dataset, text: '{"mealServiceDietInfo":[{"head":[{"list_total_count":999}]}]}' };
  assert.equal(describeDataset(missingRows).rows, null);
});

test('single HTML export contains full datasets and safely escapes script-breaking text', () => {
  const dataset = { id: 'data-1', name: '자료.csv', format: 'csv', text: '지역,값\n서울,12\n부산,17\n</script><script>globalThis.pwned=true</script>' };
  const html = buildDocument('<!doctype html><html><head><title>앱</title></head><body>앱</body></html>', [dataset]);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
  const script = html.match(/<script id="hyfl-dataset-runtime">([\s\S]*?)<\/script>/)[1];
  const sandbox = { window: {} }; vm.runInNewContext(script, sandbox);
  assert.equal(sandbox.window.HYFL_DATASETS[0].text, dataset.text); assert.equal(sandbox.pwned, undefined);
  assert(!html.includes('hyfl-runtime-error'));
  const imported = importHtml(html); assert.deepEqual(imported.datasets, [dataset]); assert(!imported.code.includes('hyfl-dataset-runtime'));
  const reopened = buildDocument(imported.code, imported.datasets); assert.equal((reopened.match(/hyfl-dataset-runtime/g) || []).length, 1);
});

test('preview bridge is bounded, nonce scoped, and absent from final downloads', () => {
  const html = buildDocument('<h1>Hello</h1>', [], { preview: true, nonce: 'nonce-for-test' });
  assert(html.includes('hyfl-preview-runtime')); assert(html.includes('nonce-for-test')); assert(html.includes('count++>15'));
  const exported = buildDocument(html, []); assert(!exported.includes('hyfl-preview-runtime')); assert(!exported.includes('nonce-for-test'));
});

test('version restoration retains current code and does not rewrite student verification', () => {
  const p = emptyProject(); p.code = '<html>old</html>'; p.checks = { 'core-function': true }; p.records.push({ id: 'record', verification: '수동 대조' });
  const updated = replaceCode(p, '<html>new</html>', '수정 전');
  assert.equal(p.code, '<html>old</html>'); assert.equal(updated.versions[0].code, p.code);
  const restored = replaceCode(updated, updated.versions[0].code, '복원 전');
  assert.equal(restored.code, p.code); assert.equal(restored.versions[0].code, '<html>new</html>'); assert.equal(restored.records[0].verification, '수동 대조');
});

test('project limits use UTF-8 bytes and history pruning never deletes current data or records', () => {
  const p = emptyProject(); p.code = '<html>안녕</html>'; p.datasets = [{ id: 'd', name: '한글.txt', format: 'text', text: '가'.repeat(90000) }];
  p.records.push({ id: 'r', stage: '구현', prompt: '실제 요청', help: '도움', verification: '', decision: '', createdAt: new Date().toISOString() });
  p.versions = Array.from({ length: 12 }, (_, i) => ({ id: String(i), code: 'x'.repeat(115000), note: '이전' }));
  const fitted = fitProject(p); assert(byteLength(JSON.stringify(fitted)) <= LIMITS.projectBytes); assert(fitted.versions.length < 6); assert.equal(fitted.datasets[0].text.length, 90000); assert.equal(fitted.records[0].prompt, '실제 요청');
  assert.throws(() => normalizeProject({ code: '한'.repeat(50000) }), /120KB/);
  assert.throws(() => normalizeProject({ datasets: [{ text: '한'.repeat(110000) }] }), /320KB/);
});

test('representative records retain the actual prompt but never fabricate verification', () => {
  const p = normalizeProject({ messages: [{ id: 'm', role: 'assistant', text: '고쳤습니다', prompt: '필터 추가', checks: ['서울을 선택하세요'], warnings: ['원자료 대조 필요'] }], records: [{ id: 'r', prompt: '필터 추가', help: '필터 제안' }] });
  assert.equal(p.messages[0].prompt, '필터 추가'); assert.equal(p.messages[0].checks[0], '서울을 선택하세요');
  const record = exportRecords(p, CURRICULUM.checklist); assert(record.includes('확인 내용 작성 필요')); assert(record.includes('팀의 판단 작성 필요')); assert(!record.includes('[x]')); assert(record.includes('3분'));
  for (const mode of ['build', 'edit', 'debug', 'explain']) assert(buildSystemPrompt(mode).includes('window.HYFL_DATASETS'));
});

test('normalization only keeps known fields and true manual check values', () => {
  const p = normalizeProject(JSON.parse('{"__proto__":{"isAdmin":true},"checks":{"core-function":"true","source-comparison":true,"__proto__":true},"password":"do-not-persist"}'));
  assert.equal(p.password, undefined); assert.equal(p.isAdmin, undefined); assert.equal(p.checks['core-function'], false); assert.equal(p.checks['source-comparison'], true); assert(!Object.hasOwn(p.checks, '__proto__'));
});
