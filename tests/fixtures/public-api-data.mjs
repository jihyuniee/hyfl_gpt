// Real service field/envelope shapes; all values below are synthetic, not an
// actual forecast, observation, or student record. No API requests or keys.
// Multiple issue times/grids and air times/stations are combined deliberately
// to test student-side merging. They are not one upstream request's response.
const forecast = [];
for (const [baseDate, baseTime, offset, startHour] of [['20261024', '2300', 0, 3], ['20261025', '0200', 10, 4]]) {
  for (const nx of [60, 61]) for (let hour = startHour; hour < startHour + 4; hour++) {
    for (const category of ['TMP', 'REH', 'PCP']) forecast.push({
      baseDate, baseTime, category, fcstDate: '20261025', fcstTime: `${String(hour).padStart(2, '0')}00`,
      fcstValue: category === 'TMP' ? String(-2 + hour - startHour + offset + (nx - 60) * 20) : category === 'REH' ? String(50 + hour) : (hour - startHour) % 2 === 0 ? '강수없음' : '1mm 미만', nx, ny: 127,
    });
  }
}
const observations = [];
for (const baseTime of ['0100', '0200']) for (const nx of [60, 61]) {
  for (const category of ['T1H', 'REH', 'RN1']) observations.push({baseDate: '20261025', baseTime, category, nx, ny: 127, obsrValue: category === 'T1H' ? '-3' : category === 'REH' ? '70' : '0'});
}
const air = [];
const values = [['10', '-', '0'], ['20', '30', null], ['40', '', '60'], ['70', '80', '90']];
for (let hour = 9; hour <= 12; hour++) for (let station = 0; station < 3; station++) {
  air.push({stationName: `검증-${'ABC'[station]}`, sidoName: '서울', dataTime: `2026-10-25 ${hour.toString().padStart(2, '0')}:00`, pm10Value: values[hour - 9][station], pm25Value: '5', o3Value: '0.025', pm10Flag: station === 1 && hour === 9 ? '점검및보수' : null});
}
export const weather = (items, totalCount = items.length) => ({response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'}, body: {dataType: 'JSON', items: {item: items}, pageNo: 1, numOfRows: items.length, totalCount}}});
export const fixtures = {
  'forecast.json': weather(forecast, 240),
  'observations.json': weather(observations),
  'air.json': {response: {header: {resultCode: '00', resultMsg: 'NORMAL_SERVICE'}, body: {items: air, pageNo: 1, numOfRows: 12, totalCount: 120}}},
  'portal.json': {page: 1, perPage: 12, currentCount: 12, matchCount: 12, totalCount: 999, data: Array.from({length: 12}, (_, i) => ({지역: '검증지역', 값: i}))},
  'seoul.json': {culturalEventInfo: {list_total_count: 999, RESULT: {CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다'}, row: Array.from({length: 12}, (_, i) => ({CODENAME: '검증행사', GUNAME: '검증구', TITLE: `가상행사 ${i + 1}`, DATE: '2026-10-25'}))}},
};
