import { datasetTable, describeDataset, apiResponseNotice } from '../lib/workspace.mjs';

// Small, optional guides next to the composer. Selecting a guide only explains
// what to share; inserting its draft still requires the student's own send.
export const REQUEST_GUIDES = [
  {
    id: 'read', label: '자료 읽기', mode: 'explain',
    detail: '데이터 파일을 넣고, 뜻을 모르겠는 열이나 값을 알려주세요.',
    example: '“이 자료에서 한 줄은 무엇을 뜻하고, 어떤 열을 비교할 수 있어?”',
    prompt: '첨부한 데이터에서 한 행이 무엇을 뜻하는지, 주요 열과 단위를 쉽게 설명해줘. 특히 [이해가 안 되는 열·값]이 궁금해. 출처 설명이 없어서 확인할 수 없는 것은 구분하고, 비교할 수 있는 항목과 먼저 확인할 점을 알려줘.',
  },
  {
    id: 'compare', label: '비교·그래프', mode: 'build',
    detail: '데이터 파일과 비교할 항목·지역·기간을 알려주세요.',
    example: '“연도별 값을 그래프로 보고 싶어. 빈 값은 어떻게 처리해야 해?”',
    prompt: '첨부한 전체 데이터로 [비교할 항목·지역·기간]을 비교하는 표와 그래프를 만들어줘. 같은 조건과 단위인지 먼저 확인하고, 빈 값 처리와 실제 계산 방법을 설명해줘. 상관관계를 원인으로 단정하지 말고, 원자료의 값과 직접 대조할 방법도 알려줘. 현재 코드가 있으면 정상 기능을 유지해줘.',
  },
  {
    id: 'feature', label: '기능 수정', mode: 'edit',
    detail: '만들던 HTML을 넣고, 어느 부분을 어떻게 바꾸고 싶은지 알려주세요.',
    example: '“동을 선택하면 그 동의 위치 목록만 나오게 고쳐줘.”',
    prompt: '현재 HTML의 [바꾸고 싶은 화면·기능]을 [원하는 동작]으로 수정해줘. 현재 정상 기능과 데이터 연결은 유지하고, 바뀐 부분과 직접 확인할 방법을 설명해줘. 현재 HTML이 없으면 먼저 가져올 파일이나 필요한 코드를 알려줘.',
  },
  {
    id: 'error', label: '오류 해결', mode: 'debug',
    detail: '만들던 HTML과 함께, 누른 것 → 기대한 결과 → 실제 결과를 적어주세요.',
    example: '“2020년을 골랐는데 빈 화면이 나와. 원자료에는 값이 있어.”',
    prompt: '현재 HTML의 오류를 해결해줘.\n내가 입력하거나 누른 것: [적기]\n기대한 결과: [적기]\n실제 결과·오류 메시지: [적기]\n\n현재 코드와 데이터를 근거로 원인을 설명하고, 정상 기능을 유지하면서 고쳐줘. 코드가 없으면 먼저 필요한 부분을 알려주고, 수정 후 같은 입력으로 확인할 방법을 제안해줘.',
  },
  {
    id: 'api', label: 'API 요청', mode: 'explain',
    detail: '서비스 이름·요청 항목·오류 메시지를 알려주세요. 인증키는 지우세요.',
    example: '“기상 API 키는 받았는데 날짜와 지역에 무엇을 넣어야 해?”',
    prompt: 'Open API에서 막혔어.\n서비스 이름: [적기]\n막힌 단계: [첫 요청 / 오류 / 응답 읽기]\n공식 문서의 요청 주소·인자 설명: [필요한 부분 붙이기]\n내 요청 조건·오류 메시지: [인증키를 YOUR_API_KEY로 바꾸고 붙이기]\n\n다음에 할 일 한 가지부터 쉽게 설명해줘. 실제 인증키는 요구하지 말고, 직접 API를 호출하거나 문서를 읽지 않았다면 그 사실을 구분해줘.',
  },
];

// Preparing a request never calls AI or changes the current code or dataset.
export const STUDIO_TASKS = [
  {
    id: 'analysis', step: '파일 · API 응답', label: '데이터 분석', mode: 'build',
    detail: '자료를 넣고 비교할 내용을 말하세요. 전체 데이터로 계산한 표와 그래프를 만들고 결과를 해석합니다.',
    outputs: ['열·단위·기간·결측값 확인', '조건별 비교·집계와 표·그래프', '자료에서 확인한 사실과 해석의 한계'],
    question: '분석하고 싶은 것: [비교할 항목·지역·기간 또는 궁금한 질문을 적기]',
    instruction: '첨부된 실제 데이터로 요청한 분석을 수행하는 실행 가능한 HTML을 만들어줘. 전체 자료를 읽어 필터·집계·계산하고 결과와 표·그래프, 출처·기간·단위·제외한 값과 해석의 한계를 표시해줘. 숫자처럼 생긴 지역 코드나 좌표를 측정값으로 평균내지 마. 기간·단위·분모가 다른 항목은 분리하고 상관관계를 원인으로 단정하지 마. 코드가 이미 있으면 정상 기능을 보존하고 필요한 분석 영역을 추가해줘. 실제 계산은 미리보기에서 수행되므로 아직 실행하지 않은 분석 수치나 성공 결과를 요약에 만들어 쓰지 마. 자료가 없으면 분석값을 만들거나 코드를 임의 데이터로 채우지 말고 필요한 자료를 먼저 안내해줘.',
  },
  {
    id: 'edit', step: '기존 HTML · 실행 오류', label: '코드 수정', mode: 'edit',
    detail: '만들던 HTML을 가져와 바꿀 기능이나 오류를 말하세요. 수정한 결과를 바로 실행하고 비교합니다.',
    outputs: ['현재 코드에서 문제 원인과 변경 내용 설명', '정상 기능을 유지한 수정 HTML', '수정 전후에 직접 확인할 입력과 결과'],
    question: '바꿀 기능 또는 오류: [내가 한 입력·원하는 결과·실제 결과를 적기]',
    instruction: '현재 HTML과 연결된 데이터를 기준으로 요청한 코드 수정을 수행해줘. 정상 작동하던 기능과 데이터 연결을 유지하고 필요한 부분만 고쳐서 실행 가능한 전체 HTML을 반환해줘. 오류가 있으면 근거와 추정을 구분해 설명하고, 수정 후 같은 입력으로 직접 확인할 방법을 알려줘. 현재 코드가 없다면 없는 코드를 추측해서 앱을 다시 만들지 말고 만들던 HTML 가져오기 또는 관련 코드 붙여넣기를 안내해줘. 실제 인증키를 요구하거나 공개 코드에 넣지 마.',
  },
];

const short = (value, limit = 180) => {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return text.length > limit ? text.slice(0, limit) + '… [일부 생략]' : text;
};

export function studioFacts(project) {
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

export function studioRequest(taskId, project) {
  const task = STUDIO_TASKS.find(item => item.id === taskId);
  if (!task) throw new Error('데이터 분석 또는 코드 수정을 선택해주세요.');
  const names = (project.datasets || []).map(dataset => short(dataset.name, 70));
  const material = names.length ? `현재 연결한 자료: ${names.join(', ')}. 실제 구조와 값은 함께 전달되는 datasets를 기준으로 읽어줘.` : '현재 연결된 데이터 파일은 없어. 대화나 코드에 실제 자료가 있는지 확인하되, 없는 값을 만들지 말고 필요한 자료·항목·얻는 방법을 안내해줘.';
  const code = project.code?.trim() ? '현재 HTML이 함께 전달돼. 그 코드를 기준으로 이어서 도와줘.' : '아직 현재 HTML은 없어. 코드나 실행 결과가 이미 있는 것처럼 설명하지 마.';
  return `${task.label}을 도와줘.\n${material}\n${code}\n\n${task.instruction}\n\n${task.question}\n\n현재 자료와 코드를 함께 사용하고, 기록은 기존 활동지에 남길 수 있게 변경 이유와 확인할 점을 짧게 설명해줘. 활동지를 여기서 다시 작성하라고 요구하지 마.`;
}
