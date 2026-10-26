import { datasetTable, describeDataset, apiResponseNotice } from '../lib/workspace.mjs';

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
