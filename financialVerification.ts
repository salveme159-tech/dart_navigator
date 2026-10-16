/** Independent presentation-side consistency checks. Not a substitute for checking the original filing. */
export type Verification = { status: 'passed'|'partial'|'failed'; checks: {name:string; ok:boolean|null; detail:string}[] };
export function verifyFinancialAnswer(d: any): Verification {
  const checks: Verification['checks'] = [];
  const val = typeof d?.value === 'number' && Number.isFinite(d.value) ? d.value : null;
  checks.push({name:'결과값 유효성',ok:val!==null,detail:val===null?'유한한 숫자 결과가 없습니다.':'유한한 숫자입니다.'});
  checks.push({name:'기간·기준 표시',ok:Boolean(d?.period && d?.basis),detail:d?.period && d?.basis?`${d.period} / ${d.basis}`:'기간 또는 연결·별도 기준 누락'});
  checks.push({name:'출처 식별',ok:d?.demo ? null : Boolean(d?.rceptNo && /^\d{14}$/.test(String(d.rceptNo))),detail:d?.demo?'시연 fixture: 원문 독립 대조 미실시':d?.rceptNo?'공시 접수번호 형식 점검':'공시 접수번호 누락'});
  const id = String(d?.metricId ?? '');
  const inputs = Array.isArray(d?.calcInputs)?d.calcInputs:[];
  if(id==='operatingMargin') {
    const profit=inputs.find((x:any)=>/영업이익/.test(x.label??x.account??''))?.value;
    const revenue=inputs.find((x:any)=>/매출액/.test(x.label??x.account??''))?.value;
    const valid=typeof profit==='number' && typeof revenue==='number' && revenue!==0 && val!==null;
    const delta=valid?Math.abs(profit/revenue*100-val):Infinity;
    checks.push({name:'영업이익률 독립 재계산',ok:valid?delta<=0.051:null,detail:valid?`재계산 ${((profit/revenue)*100).toFixed(4)}%, 차이 ${delta.toFixed(5)}%p`:'계산에 필요한 원천 입력값 미제공'});
  } else if(d?.valueKind==='calculated') {
    checks.push({name:'파생지표 독립 재계산',ok:null,detail:'산식별 입력 데이터와 독립 계산 규칙을 추가 검증해야 합니다.'});
  }
  const status=checks.some(c=>c.ok===false)?'failed':checks.some(c=>c.ok===null)?'partial':'passed';
  return {status,checks};
}
