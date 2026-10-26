import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {datasetTable,dataNumber,numericSummary,datasetProfile,seriesInfo,buildQuickChart,buildDocument,importHtml,exportConversation,emptyProject} from '../lib/workspace.mjs';
import {datasetContext,buildPrompt} from '../lib/server/prompts.mjs';
import {fixtures} from './fixtures/public-api-data.mjs';

// Logic execution adapter only. Live browser layout and upload use separate QA.
function runChart(datasets) {
  const html=buildDocument(buildQuickChart(datasets[0]?.id),datasets);
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.listeners={};this.attributes={};this.ownText='';}
    append(child){this.children.push(child);}
    replaceChildren(...children){this.children=children;this.ownText='';this.selected=undefined;}
    set textContent(value){this.ownText=String(value);this.children=[];}
    get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
    set value(value){this.selected=String(value);}
    get value(){return this.tag==='select'?(this.selected??this.children[0]?.value??''):(this.selected??'');}
    setAttribute(key,value){this.attributes[key]=String(value);}
    addEventListener(type,fn){this.listeners[type]=fn;}
    querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
  }
  const elements=new Map();
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g))elements.set(match[2],new Element(match[1]));
  for(const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g))for(const option of match[2].matchAll(/<option\s+value="([^"]+)">([^<]*)/g)){const el=new Element('option');el.value=option[1];el.textContent=option[2];elements.get(match[1]).append(el);}
  const document={getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
  const context=vm.createContext({document,console});context.window=context;
  for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))vm.runInContext(script[1],context,{timeout:1500});
  return {html,get:id=>elements.get(id),selectFilter(name,value){const index=datasetTable(datasets[0]).columns.indexOf(name);const select=elements.get('filters').querySelectorAll('select').find(el=>Number(el.dataset.column)===index);assert(select);assert(select.children.some(option=>option.value===value));select.value=value;select.listeners.change();}};
}

test('full-data statistics preserve zero, negatives and Korean quoted CSV; reject ambiguous numeric strings',()=>{
  const data={id:'csv',name:'자료.csv',format:'csv',text:'연도,합계출산율,설명\r\n2020,0,"가,나"\r\n2021,0.6,"두\n줄"\r\n2022,-0.2,비교\r\n2023,-,결측\r\n2024,,결측'};
  assert.equal(datasetTable(data).rows.length,5);
  assert.equal(datasetTable(data).rows[1][2],'두\n줄');
  const profile=datasetProfile(data).numericColumns[0];
  assert.equal(profile.column,'합계출산율');assert.equal(profile.valid,3);assert.equal(profile.excluded,2);assert.equal(profile.min,-0.2);assert.equal(profile.max,0.6);assert(Math.abs(profile.mean-0.4/3)<1e-12);
  assert.equal(dataNumber('1,234.5'),1234.5);for(const value of ['1mm 미만','강수없음','12,34','0.5%',null,''])assert.equal(dataNumber(value),null);
  assert.equal(numericSummary([0,'-',null,'']).valid,1);
});

test('small AI attachments include every row, large attachments include full-data statistics, and input budgets preserve current code',()=>{
  const data={id:'csv',name:'자료.csv',format:'csv',text:'연도,값\n'+Array.from({length:13},(_,i)=>`${2000+i},${i}`).join('\n')};
  const context=datasetContext(data);assert.equal(context.fullDataIncluded,true);assert.equal(context.fullRowsCount,13);assert.equal(context.fullRows.at(-1)[1],'12');
  const large={...data,text:'연도,값\n'+Array.from({length:1000},(_,i)=>`${2000+i},${i}`).join('\n')};
  const big=datasetContext(large);assert.equal(big.fullRows,undefined);assert.equal(big.fullDataStatistics.numericColumns[0].sum,499500);
  const long={...data,text:'항목,값\n'+Array.from({length:100},(_,i)=>`${'가'.repeat(70)}${i},${i}`).join('\n')};
  const project={...emptyProject(),code:'<!doctype html><html><body>'+(' '.repeat(3000))+'COMPLETE_CODE</body></html>',datasets:[long]};
  const full=buildPrompt({mode:'build',prompt:'그래프를 만들어줘',project},{maxInputChars:180000});
  const limited=buildPrompt({mode:'build',prompt:'그래프를 만들어줘',project},{maxInputChars:full.user.length+full.system.length-1000});
  const parsed=JSON.parse(limited.user);assert.equal(parsed.project.currentCode,project.code);assert.equal(parsed.datasets[0].fullDataIncluded,false);assert.equal(parsed.datasets[0].fullRows,undefined);assert.equal(parsed.datasets[0].fullDataStatistics.totalRows,100);
});

test('quick chart executes full data, displays limits, keeps tail rows in exported HTML and uses text for markup',()=>{
  const data={id:'csv',name:'검증.csv',format:'csv',text:'연도,값,설명\n'+Array.from({length:150},(_,i)=>`${2000+i},${i},${i===0?'<img src=x onerror=alert(1)>':'행'+i}`).join('\n')};
  const app=runChart([data]);
  assert.match(app.get('summary').textContent,/선택 150행.*숫자 150개.*평균 74.5/);
  assert.match(app.get('scope').textContent,/그래프 120\/150개.*표 100\/150행/);
  assert.match(app.get('table').textContent,/<img src=x onerror=alert\(1\)>/);
  assert(!app.get('table').querySelectorAll('img').length);
  assert.equal(importHtml(app.html).datasets[0].text,data.text);
  assert(app.get('chart').querySelectorAll('svg').length===1);
});

test('quick chart separates weather categories and forecast issuance; categorical rain never becomes zero',()=>{
  const app=runChart([{id:'weather',name:'기상.json',format:'json',text:JSON.stringify(fixtures['forecast.json'])}]);
  assert.match(app.get('summary').textContent,/선택 4행.*평균 -0.5/);
  assert.match(app.get('series-note').textContent,/예보값.*TMP.*℃.*발표 20261024 2300.*예보 대상 20261025/);
  app.selectFilter('baseDate','20261025');app.selectFilter('baseTime','0200');
  assert.match(app.get('summary').textContent,/선택 4행.*평균 9.5/);
  app.selectFilter('category','PCP');
  assert.match(app.get('summary').textContent,/숫자 0개.*4개 제외/);
  assert.match(app.get('table').textContent,/강수없음.*1mm 미만/);
  assert.match(app.get('chart').textContent,/숫자가 없습니다/);
});

test('weather classification codes are not averaged and observation/air units and times are explicit',()=>{
  const data={id:'code',name:'분류.json',format:'json',text:JSON.stringify({response:{body:{items:{item:[{category:'SKY',baseDate:'20261026',baseTime:'0200',fcstDate:'20261026',fcstTime:'0300',fcstValue:'1'},{category:'SKY',baseDate:'20261026',baseTime:'0200',fcstDate:'20261026',fcstTime:'0400',fcstValue:'4'}]}}}})};
  const app=runChart([data]);assert.match(app.get('summary').textContent,/분류 코드: 평균·수치 그래프를 계산하지 않습니다/);assert.equal(app.get('chart').querySelectorAll('svg').length,0);assert.match(app.get('table').textContent,/0300.*1.*0400.*4/);
  const obs=seriesInfo(['category','baseDate','baseTime','obsrValue'],[['T1H','20261026','0900','12']],'obsrValue');assert.match(obs.note,/실황 관측값.*℃.*발표 20261026 0900/);assert.doesNotMatch(obs.note,/예보 대상/);
  const air=seriesInfo(['stationName','dataTime','pm10Value'],[['검증-A','2026-10-26 09:00','0']],'pm10Value');assert.equal(air.unit,'μg/m³');assert.match(air.note,/측정 시각 2026-10-26 09:00/);
});

test('conversation export uses actual messages and never invents worksheet verification',()=>{
  const text=exportConversation({...emptyProject(),messages:[{role:'user',createdAt:'2026-10-26',text:'실제 요청'},{role:'assistant',createdAt:'2026-10-26',text:'실제 답변',model:'configured-model'}]});
  assert.match(text,/실제 요청.*\n[\s\S]*실제 답변/);assert.match(text,/configured-model/);assert.doesNotMatch(text,/검증 완료|내가 확인한 결과/);
});
