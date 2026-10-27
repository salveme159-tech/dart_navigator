// Node 22.18+에서 추가 패키지 없이 실행: node --test scripts/test-article-claims.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractArticleClaims,koreanAmount,applyActual,parseContractAmount} from '../server/dart/articleClaims.ts';
const input=(article,overrides={})=>({article,company:'대한전선',year:2025,period:'annual',mode:'cum',basis:'CFS',articleDate:'2026-10-27',...overrides});
const extract=(article,overrides)=>extractArticleClaims(input(article,overrides),['대한전선','LS전선','LS']);
test('조·억·만·원과 음수 금액을 동일한 억원 단위로 변환',()=>{
 for(const [raw,expected] of [['3조 6,360억원',36360],['1조1,469억원',11469],['114,690,000,000원',1146.9],['2,500만원',.25],['-1억5,000만원',-1.5]]) assert.equal(koreanAmount(raw),expected);
 assert.equal(extract('대한전선 매출액은 114,690,000,000원이다.')[0].value,1146.9);
});
test('여러 지표를 분리하고 정확한 원문 위치를 유지',()=>{
 const article='대한전선의 2025년 연결 매출액은 3조 6,360억원, 영업이익은 1,286억원이다.';
 const c=extract(article); assert.deepEqual(c.map(x=>[x.metric,x.value]),[['revenue',36360],['operatingProfit',1286]]);
 for(const x of c)assert.equal(article.slice(x.start,x.end),x.text);
});
test('제목의 후행 수주 표현과 전압을 구분',()=>{
 const c=extract('대한전선, 독일에서 380kV 전력망 1조1,469억원 수주');
 assert.equal(c[0].unit,'kV'); assert.ok(c[0].message);assert.equal(c[1].metric,'contract');assert.equal(c[1].value,11469);
 applyActual(c[1],1146.9);assert.equal(c[1].status,'MISMATCH');assert.equal(c[1].actual,1146.9);
});
test('반올림 허용과 약 표기 허용, 실제 금액 유지',()=>{
 const a=extract('대한전선 영업이익은 1,286억원이다.')[0];applyActual(a,1286.4);assert.equal(a.status,'MATCH');
 const b=extract('대한전선 영업이익은 약 1,290억원이다.')[0];applyActual(b,1286.4);assert.equal(b.status,'MATCH');
 const c=extract('대한전선 영업이익률은 10.2%다.')[0];applyActual(c,10.26);assert.equal(c.status,'MISMATCH');
});
test('서로 다른 기업과 별도·연결 기준을 구별',()=>{
 const c=extract('대한전선의 연결 영업이익은 100억원이다.\nLS전선의 별도 영업이익은 200억원이다.');
 assert.deepEqual(c.map(x=>[x.company,x.basis]),[['대한전선','CFS'],['LS전선','OFS']]);
});
test('실적 기간·당분기·누계·상대 연도를 식별',()=>{
 const c=extract('대한전선은 올해 2분기 매출액 100억원, 영업이익 10억원이다.\n지난해 상반기 영업이익은 20억원이다.');
 assert.deepEqual(c.map(x=>[x.year,x.period,x.mode]),[[2026,'half','qtr'],[2026,'half','qtr'],[2025,'half','cum']]);
});
test('지원하지 않는 물리량·수주잔고·전망은 확인 필요',()=>{
 for(const article of ['대한전선 수주잔고는 4조원이다.','대한전선 매출액은 100억원으로 예상된다.','대한전선 4분기 매출액은 100억원이다.','대한전선 케이블 길이는 86km다.']) {
  const c=extract(article)[0];assert.equal(c.status,'UNVERIFIED');assert.ok(c.message);
 }
});
test('증감률·퍼센트포인트·손실을 혼동하지 않음',()=>{
 const c=extract('대한전선 영업손실은 100억원이다.\n대한전선 영업이익은 전년 동기 대비 10% 감소했다.\n영업이익률은 1.5%p 상승했다.');
 assert.equal(c[0].value,-100);assert.equal(c[1].growth,'decrease');assert.ok(c[2].message);
});
test('소수점이 문장 분리와 수치 위치를 손상시키지 않음',()=>{
 const c=extract('대한전선 영업이익률은 5.25%다. 대한전선 매출은 100억원이다.');assert.equal(c.length,2);assert.equal(c[0].value,5.25);assert.equal(c[1].metric,'revenue');
});
test('단위가 명확한 계약금액을 추출하고 비율·정정 대비값을 거부',()=>{
 assert.equal(parseContractAmount('<table><tr><td>계약금액(원)</td><td>114,690,000,000</td></tr></table>').value,1146.9);
 for(const row of ['계약금액(백만원) 114,690','계약금액 114,690,000,000','계약금액(원) 114,690,000,000 120,000,000,000','계약금액 대비 비율(원) 114,690,000,000'])assert.equal(parseContractAmount(`<tr><td>${row}</td></tr>`),null);
});
test('각각 나열된 지표와 금액을 순서대로 대응',()=>{
 const c=extract('대한전선 매출액과 영업이익은 각각 1,000억원, 100억원이다.');
 assert.deepEqual(c.map(x=>[x.metric,x.value]),[['revenue',1000],['operatingProfit',100]]);
});
test('대비를 나타내는 지난해를 실적 사업연도로 오인하지 않음',()=>{
 const c=extract('대한전선 2026년 영업이익은 지난해 대비 10% 증가했다.');assert.equal(c[0].year,2026);
});
