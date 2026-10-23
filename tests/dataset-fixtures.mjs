// Synthetic NEIS-shaped data only; no real school or student records.
export function neisMealFixture({ count = 12, declaredTotal = 999, bom = false } = {}) {
  const rows = Array.from({ length: count }, (_, index) => ({
    ATPT_OFCDC_SC_CODE: 'TEST', SD_SCHUL_CODE: 'SYNTHETIC', SCHUL_NM: '합성 학교',
    MMEAL_SC_CODE: '2', MMEAL_SC_NM: '중식', MLSV_YMD: `202610${String(index + 1).padStart(2, '0')}`,
    DDISH_NM: `합성 메뉴 ${index + 1}`, CAL_INFO: `${600 + index}.0 Kcal`, NTR_INFO: `단백질(g) : ${20 + index}`,
  }));
  const envelope = { mealServiceDietInfo: [
    { head: [{ list_total_count: declaredTotal }, { RESULT: { CODE: 'INFO-000', MESSAGE: 'Synthetic success' } }] },
    { row: rows },
  ] };
  return { rows, dataset: { id: 'synthetic-neis', name: 'synthetic-neis.json', format: 'json', text: (bom ? '\uFEFF' : '') + JSON.stringify(envelope) } };
}
