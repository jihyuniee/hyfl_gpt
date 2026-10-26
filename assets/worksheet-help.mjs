import { datasetTable, describeDataset, apiResponseNotice } from '../lib/workspace.mjs';

// These tasks prepare a request. Selecting a task never calls AI or edits work.
export const WORKSHEET_TASKS = [
  {
    id: 'scope', step: 'STEP 1-2 · 1-3', label: '문제 범위 좁히기', mode: 'explain',
    detail: '누구의 어떤 불편함을, 수업 시간 안에 어디까지 도울지 정해요.',
    outputs: ['구체적인 사용자와 사용 상황', '데이터로 확인할 부분과 추가 조사가 필요한 부분', '먼저 만들 기능 하나와 나중에 할 기능'],
    question: '활동지에서 정한 사용자·문제 문장이 있다면 아래에 필요한 부분만 붙여줘.',
    instruction: '현재 목표가 너무 크거나 데이터와 연결되지 않으면 주제의 의미를 살려 범위를 좁혀줘. 사용자·상황·불편함을 구체화하고, 앱이 직접 제공할 결과와 기대하는 사회적 효과를 구분해줘. 지금 만들 기능 하나와 나중에 할 기능을 제안하고, 우리 팀이 선택해야 할 판단 한 가지를 물어봐. 아직 코드는 바꾸지 마.',
  },
  {
    id: 'data', step: 'STEP 2-1', label: '자료 읽기', mode: 'explain',
    detail: '실제 행과 열을 보고, 자료의 의미와 사용할 수 있는 범위를 확인해요.',
    outputs: ['실제 예시 행으로 설명한 한 행의 의미', '주요 열·단위·기간·지역과 확인이 필요한 항목', '이 자료로 알 수 있는 것과 알 수 없는 것'],
    question: '공식 설명에만 있는 단위·지역 코드·수집 방법이 있다면 필요한 부분을 붙여줘.',
    instruction: '첨부한 실제 자료의 파일명과 열 이름, 예시 값을 근거로 한 행의 의미를 설명해줘. 행 수·도서 종수·시설 수·대출 건수·이용자 수처럼 서로 다른 수를 혼동하지 않게 해줘. 자료 제목·제공기관·출처·기간·지역·단위·수집 방법 중 실제로 확인되는 항목과 원문에서 확인해야 할 항목을 구분해줘. 파일명이나 열 이름만으로 출처·단위를 확정하지 마. API의 전체 건수와 실제 받은 행 수, 저장된 응답과 실시간 정보를 구분해줘. 아직 코드는 바꾸지 마.',
  },
  {
    id: 'evidence', step: 'STEP 2-2', label: '근거를 기능으로', mode: 'explain',
    detail: '자료에서 확인한 사실이 어떤 도움과 기능으로 이어지는지 살펴봐요.',
    outputs: ['실제 값이나 집계에 근거한 관찰', '사용자에게 갖는 의미와 해석의 한계', '그 근거로 만들 기능 하나'],
    question: '사용자와 직접 확인한 수치·특징이 있다면 짧게 덧붙여줘.',
    instruction: '활동지의 「데이터에서 확인한 사실 → 사용자에게 갖는 의미 → 웹앱 기능」을 연결하는 일을 도와줘. 확인 가능한 실제 값과 해석·제안을 분리하고, 비교할 때 기간·지역·연령·단위·분모가 맞는지 확인해줘. 전체 행이나 전체 통계가 제공되지 않았다면 수치를 추측하지 말고 먼저 계산해야 할 항목을 알려줘. 상관관계를 원인으로, 설치 여부를 실제 이용 가능성으로, 대출량을 심리 상태로 단정하지 마. 이 자료로 가능한 핵심 기능 하나를 제안하고 아직 코드는 바꾸지 마.',
  },
  {
    id: 'build', step: 'STEP 2-3 · 2-4', label: '기능 만들기·고치기', mode: 'build',
    detail: '입력과 결과가 분명한 기능 하나를 만들고 여기서 실행해요.',
    outputs: ['사용자가 고를 값과 실제 데이터로 보여 줄 결과', '미리보기에서 실행하는 작은 웹앱', '실행 후 직접 확인할 입력과 기대 동작'],
    question: '이번에 만들거나 고칠 기능 하나: [입력·선택 → 결과 형태로 적기]',
    instruction: '이번에 요청한 기능 하나를 실제 실행 가능한 HTML로 만들어줘. 기존 코드가 있으면 정상 기능과 데이터 연결을 유지하며 필요한 부분만 고쳐줘. 첨부 자료 전체를 읽어 필터·계산하고 출처·시점·단위와 자료 없음·오류를 표시해줘. 데이터에 없는 수치·기관·추천 근거를 만들지 마. 입력과 결과가 불분명하면 가장 필요한 질문 한 가지를 먼저 해줘. 기능 제작에 유료 AI 호출을 억지로 넣지 마. 결과를 원자료와 비교할 구체적인 방법도 제시해줘.',
  },
  {
    id: 'verify', step: 'STEP 3-2 · 3-3', label: '결과 검증하기', mode: 'explain',
    detail: '현재 코드와 실제 예시 행으로, 무엇을 눌러 무엇과 비교할지 정해요.',
    outputs: ['현재 코드의 필터·계산 조건 설명', '원자료와 대조할 정상 입력·빈 결과·누락값 테스트', '아직 확인하지 못한 한계와 다음 확인'],
    question: '이미 실행했다면 입력·기대한 값·실제 결과를 적어줘. 실행하지 않았다면 비워도 돼.',
    instruction: '현재 코드와 첨부 자료로 결과를 검증하는 일을 도와줘. 실제 예시 행을 근거로 입력 → 원자료에서 확인할 값 → 앱에서 비교할 결과를 2~3개 제시해줘. 직접 실행한 것처럼 성공이나 일치를 표시하지 마. 같은 입력의 정상 결과, 결과 없음, 누락·오류를 확인할 방법을 구분해줘. 기대 수치를 전체 데이터로 확정할 수 없으면 그 값을 구하는 방법을 설명해줘. 코드가 없다면 검증 완료로 쓰지 말고 먼저 만들 결과를 안내해줘. 아직 코드는 바꾸지 마.',
  },
  {
    id: 'reflect', step: 'STEP 4 · 5', label: 'AI 활용 돌아보기', mode: 'explain',
    detail: '보관된 실제 대화에서 도움받은 부분을 찾고, 팀의 확인과 판단을 정리해요.',
    outputs: ['제공된 실제 요청과 답변에서 고른 활용 사례', '팀이 직접 확인해야 할 내용과 판단 질문', '활동지에 이어 적을 항목 안내'],
    question: '팀이 직접 실행·확인한 것과 채택·수정·제외한 판단이 있다면 적어줘.',
    instruction: '제공된 실제 대화에서 활동지에 남길 만한 AI 활용 사례를 1~2개 골라 실제 요청과 도움받은 부분을 연결해줘. 실제 프롬프트를 원문으로 옮길 때는 제공된 문장만 인용하고, 생략된 대화를 복원하지 마. AI의 제안과 학생이 직접 확인한 사실을 구분해줘. 확인 과정·기여·성찰은 학생이 말한 내용만 사용하고, 아직 없다면 팀이 답할 구체적 질문으로 남겨줘. 활동지를 여기서 다시 작성하거나 새 기록 양식을 채우라고 하지 마. 아직 코드는 바꾸지 마.',
  },
];

const short = (value, limit = 180) => {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return text.length > limit ? text.slice(0, limit) + '… [일부 생략]' : text;
};

export function worksheetFacts(project) {
  return (project.datasets || []).map(dataset => {
    const fact = { id: dataset.id, name: dataset.name, format: dataset.format, rows: null, columns: [], sample: [], notice: '', error: '', excerpt: '' };
    if (dataset.format === 'text') {
      fact.excerpt = short(dataset.text, 600);
      fact.notice = '텍스트 원문 일부입니다. 줄 수를 관측 대상의 수로 세지 않으며, 한 행의 단위는 원문에서 확인해야 합니다.';
      return fact;
    }
    try {
      const detail = describeDataset(dataset);
      if (dataset.format === 'json') fact.notice = apiResponseNotice(JSON.parse(dataset.text.replace(/^\uFEFF/, '')));
      const table = datasetTable(dataset);
      fact.rows = table.rows.length;
      fact.columnCount = table.columns.length;
      fact.columns = table.columns.slice(0, 8).map(value => short(value, 80));
      fact.sample = table.rows.slice(0, 3).map(row => row.slice(0, 8).map(value => short(value)));
      fact.path = detail.arrayPath || '';
      fact.omitted = fact.columnCount > 8 || fact.rows > 3;
    } catch (error) {
      fact.error = error.message;
      fact.excerpt = short(dataset.text, 400);
    }
    return fact;
  });
}

export function worksheetRequest(taskId, project) {
  const task = WORKSHEET_TASKS.find(item => item.id === taskId);
  if (!task) throw new Error('활동지에서 도움받을 단계를 선택해주세요.');
  const names = (project.datasets || []).map(dataset => short(dataset.name, 70));
  const material = names.length ? `현재 연결한 자료: ${names.join(', ')}. 실제 구조와 값은 함께 전달되는 datasets를 기준으로 읽어줘.` : '현재 연결된 데이터 파일은 없어. 대화나 코드에 실제 자료가 있는지 확인하되, 없는 값을 만들지 말고 필요한 자료·항목·얻는 방법을 안내해줘.';
  const code = project.code?.trim() ? '현재 HTML이 함께 전달돼. 그 코드를 기준으로 이어서 도와줘.' : '아직 현재 HTML은 없어. 코드나 실행 결과가 이미 있는 것처럼 설명하지 마.';
  return `활동지 ${task.step}에서 「${task.label}」 도움을 받고 싶어.\n${material}\n${code}\n\n${task.instruction}\n\n답변은 「자료·코드에서 확인한 것 / 우리 팀이 결정하거나 확인할 것 / 바로 해 볼 다음 행동」으로 짧게 정리해줘. 활동지 전체를 대신 완성하거나 학생이 하지 않은 일을 지어내지 마. 공식 사이트를 직접 조회할 수 없다면 주소만 보고 읽었다고 말하지 마.\n\n${task.question}`;
}
