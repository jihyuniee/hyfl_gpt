import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDataset, importApiResponse, apiResponseNotice, selectJsonRows, buildDocument, importHtml, normalizeProject } from '../lib/workspace.mjs';
import { datasetContext } from '../lib/server/prompts.mjs';
const weather = (item, totalCount = 999) => ({ response: { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: { pageNo: 1, numOfRows: 30, totalCount, items: { item } } } });
const rows = Array.from({length: 30}, (_, i) => ({category: i % 2 ? 'REH' : 'TMP', fcstDate: '20261025', fcstTime: String(i).padStart(4, '0'), fcstValue: String(i), nx: 60, ny: 127}));
test('weather envelope uses all response rows, retains categories, and warns about pagination in UI and AI context', () => {
  const raw = JSON.stringify(weather(rows)); const dataset = importApiResponse('weather', raw);
  assert.equal(describeDataset(dataset).rows, 30);
  assert.equal(describeDataset(dataset).arrayPath, '$.response.body.items.item');
  assert.match(apiResponseNotice(JSON.parse(raw)), /999.*30行|999.*30행/);
  const context = datasetContext(dataset); assert.equal(context.totalDataRows, 30); assert.equal(context.sampleRowsCount, 8); assert.match(context.apiNotice, /다음 페이지/);
  const reopened = importHtml(buildDocument('<!doctype html><html><head></head><body></body></html>', [dataset]));
  assert.equal(reopened.datasets[0].text, raw);
  const full = selectJsonRows(JSON.parse(reopened.datasets[0].text)).rows;
  assert.equal(full.filter(r => r.category === 'TMP').reduce((sum,r) => sum + Number(r.fcstValue), 0), 210);
  assert.equal(full.at(-1).fcstValue, '29');
});
test('weather single item, empty array and error responses cannot count metadata as observations', () => {
  assert.equal(describeDataset(importApiResponse('', JSON.stringify(weather(rows[0],1)))).rows, 1);
  assert.equal(describeDataset(importApiResponse('', JSON.stringify(weather([],0)))).rows, 0);
  const error = {response:{header:{resultCode:'03', resultMsg:'NO_DATA'}, body:{items:{item:rows}}}};
  assert.equal(selectJsonRows(error), null); assert.match(apiResponseNotice(error), /03.*NO_DATA/);
  assert.equal(selectJsonRows({response:{body:{totalCount:999,items:''}}}), null);
});
test('other portal and city JSON shapes share full-row parsing without changing source', () => {
  for (const payload of [{response:{body:{items:rows}}}, {data:rows,totalCount:30}, {CityService:{row:rows,list_total_count:999}}, rows]) {
    const d=importApiResponse('other',JSON.stringify(payload)); assert.equal(describeDataset(d).rows,30); assert.equal(d.text,JSON.stringify(payload));
  }
});
test('API paste rejects credential fields, malformed XML and oversize payloads before project mutation', () => {
  for (const key of ['serviceKey','service_key','API_KEY','authKey','access_token','Authorization','password']) assert.throws(()=>importApiResponse('bad',JSON.stringify({response:{[key]:'secret-test-only'}})),/인증/);
  assert.throws(()=>importApiResponse('', '<response/>'),/JSON/);
  assert.throws(()=>importApiResponse('', ' '),/본문/);
  assert.throws(()=>importApiResponse('', JSON.stringify({data:'x'.repeat(320001)})),/320KB/);
  const d=importApiResponse('empty', '{"data":[]}'); assert.equal(d.name,'empty.json');
  assert.throws(()=>normalizeProject({datasets:Array(9).fill(d)}),/8개/);
});
