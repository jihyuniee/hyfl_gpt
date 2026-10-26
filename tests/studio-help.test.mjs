import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject} from '../lib/workspace.mjs';
import {studioFacts, studioRequest} from '../assets/studio-help.mjs';

test('data preview counts all records while preserving zero, blanks and quoted line breaks',()=>{
  const project={...emptyProject(),datasets:[{id:'data',name:'비교.csv',format:'csv',text:'지역,값\n"첫째\n지역",0\n둘째,\n셋째,3\n넷째,4'}]};
  const before=JSON.stringify(project),[fact]=studioFacts(project);
  assert.equal(fact.rows,4);assert.equal(fact.sample.length,3);
  assert.equal(fact.sample[0][0],'첫째\n지역');assert.equal(fact.sample[0][1],'0');assert.equal(fact.sample[1][1],'');
  assert.equal(JSON.stringify(project),before);
});

test('text and API error envelopes are never represented as measured data rows',()=>{
  const project={...emptyProject(),datasets:[{id:'t',name:'설명.txt',format:'text',text:'제목\n단위 설명'},{id:'j',name:'오류.json',format:'json',text:'{"response":{"header":{"resultCode":"30","resultMsg":"SERVICE KEY IS NOT REGISTERED ERROR."}}}'}]};
  const [text,error]=studioFacts(project);assert.equal(text.rows,null);assert.equal(error.rows,null);assert.ok(error.error);assert.equal(error.sample.length,0);
});

test('requests distinguish missing material from actual team files and preserve current code',()=>{
  const empty=studioRequest('edit',emptyProject());assert.match(empty,/아직 현재 HTML은 없어/);assert.match(empty,/없는 코드를 추측/);
  const project={...emptyProject(),code:'<p>현재 기능</p>',datasets:[{id:'a',name:'학생자료.csv',format:'csv',text:'a\n1'}]};
  const before=JSON.stringify(project),request=studioRequest('analysis',project);
  assert.match(request,/학생자료.csv/);assert.match(request,/현재 HTML이 함께/);assert.match(request,/전체 자료/);assert.match(request,/정상 기능을 보존/);
  assert.equal(JSON.stringify(project),before);assert.throws(()=>studioRequest('unknown',project));
});
