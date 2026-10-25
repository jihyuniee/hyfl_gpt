#!/usr/bin/env node
// Optional local classroom verification kit. Never copied into the public build.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fixtures } from '../tests/fixtures/public-api-data.mjs';
import { importApiResponse, buildDocument, normalizeProject } from '../lib/workspace.mjs';

if (!process.argv[2]) throw new Error('검증 자료를 만들 출력 폴더를 지정하세요. 예: node scripts/prepare-public-api-check.mjs /tmp/hyfl-api-check');
const output = resolve(process.argv[2]);
await mkdir(output, {recursive:true});
const code = await readFile(new URL('../tests/fixtures/public-api-app.html', import.meta.url), 'utf8');
const datasets = [];
for (const [name, payload] of Object.entries(fixtures)) {
  const text = JSON.stringify(payload, null, 2);
  await writeFile(join(output,name),text);
  datasets.push(importApiResponse(name,text));
}
const project = normalizeProject({title:'공공 API 구조 검증 · 가상 값',code,datasets});
await writeFile(join(output,'public-api-example.html'),buildDocument(code,datasets));
await writeFile(join(output,'public-api-project.json'),JSON.stringify({format:'hyfl-studio',version:2,project},null,2));
console.log(`가상 값 JSON 5개, 전체 데이터 HTML, 프로젝트 백업 → ${output}`);
