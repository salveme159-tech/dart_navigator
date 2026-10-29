import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDartQuery,periodCandidates,P} from '../server/dart/engine.ts';
import {periodAmount,pairedIncome,selectAccount} from '../shared/financialAccounts.ts';
import {metricSourceLinks} from '../client/src/lib/metricSources.ts';
import {escapeHtml} from '../client/src/lib/xlsxExport.ts';
const now=new Date('2026-10-29T00:00:00Z');
for(const [term,year] of [['작년',2025],['지난해',2025],['전년도',2025],['재작년',2024],['올해',2026],['금년',2026]]){
 test(term+' 상반기를 공통 상대연도로 해석',()=>{assert.equal(periodCandidates(term+' 상반기 매출액',now)[0].year,year);assert.deepEqual(parseDartQuery(term+' 상반기 매출액',now).years,[year]);});
}
test('명시 연도를 상대연도보다 우선',()=>assert.equal(periodCandidates('2024년 작년 상반기 매출액',now)[0].year,2024));
test('분기와 누계 질의를 구분',()=>{assert.equal(parseDartQuery('3분기 영업이익',now).mode,'qtr');assert.equal(parseDartQuery('3분기 누계 영업이익',now).mode,'cum');});
test('반기 3개월 수치를 누계로 추정하지 않음',()=>{const r={sj_div:'CIS',thstrm_amount:'100000000'};assert.equal(periodAmount(r,P(2026,'half')),null);assert.equal(periodAmount(r,P(2026,'half','qtr')),null);});
test('반기 두 필드를 각각의 기간으로 선택',()=>{const r={sj_div:'CIS',thstrm_amount:'100000000',thstrm_add_amount:'300000000'};assert.equal(periodAmount(r,P(2026,'half')),3);assert.equal(periodAmount(r,P(2026,'half','qtr')),1);});
test('일자가 검증된 주요계정 누계만 허용',()=>{const r={sj_div:'IS',thstrm_amount:'300000000',thstrm_dt:'2026.01.01 ~ 2026.06.30'};assert.equal(periodAmount(r,P(2026,'half')),3);assert.equal(periodAmount(r,P(2026,'half','qtr')),null);});
test('현금흐름 누계는 읽되 3개월로 재표기하지 않음',()=>{const r={sj_div:'CF',thstrm_amount:'300000000'};assert.equal(periodAmount(r,P(2026,'half')),3);assert.equal(periodAmount(r,P(2026,'half','qtr')),null);});
test('서로 다른 손익표의 매출과 이익을 섞지 않음',()=>{const rows=[{sj_div:'CIS',account_nm:'매출액',thstrm_amount:'1000000000'},{sj_div:'IS',account_nm:'영업이익',thstrm_amount:'100000000'}];assert.equal(pairedIncome(rows,P(2025,'annual'),['영업이익']),null);});
test('같은 표여도 접수번호·회계기준이 다르면 비율 산출 중단',()=>{for(const key of ['rcept_no','fs_div','corp_code','bsns_year','reprt_code']){const rows=[{sj_div:'CIS',account_nm:'매출액',thstrm_amount:'1000000000',[key]:'A'},{sj_div:'CIS',account_nm:'영업이익',thstrm_amount:'100000000',[key]:'B'}];assert.equal(pairedIncome(rows,P(2025,'annual'),['영업이익']),null);}});
test('외화금액을 억원으로 바꾸지 않음',()=>assert.equal(selectAccount([{sj_div:'BS',account_nm:'자산총계',currency:'USD',thstrm_amount:'100'}],'자산총계',P(2025,'annual')),null));
test('금융원가를 이자비용으로 대체하지 않음',()=>assert.equal(selectAccount([{sj_div:'CIS',account_nm:'금융원가',account_id:'ifrs-full_FinanceCosts',thstrm_amount:'100'}],'이자비용',P(2025,'annual')),null));
test('지배주주 순이익을 전체 순이익으로 읽지 않음',()=>assert.equal(selectAccount([{sj_div:'CIS',account_nm:'지배주주 귀속 당기순이익',thstrm_amount:'100'}],'순이익',P(2025,'annual')),null));
test('연결과 별도 선택은 공유 계정 추출기에서도 동일',()=>{const rows=[{sj_div:'IS',fs_div:'OFS',account_nm:'영업이익',thstrm_amount:'100000000'},{sj_div:'CIS',fs_div:'CFS',account_nm:'영업이익',thstrm_amount:'200000000'}];assert.equal(selectAccount(rows,'영업이익',P(2025,'annual'),'CFS').value,2);assert.equal(selectAccount(rows,'영업이익',P(2025,'annual'),'OFS').value,1);});
test('하반기 계산의 양쪽 접수번호 출처를 보존',()=>assert.equal(metricSourceLinks('연간 접수번호 20260316000969; 상반기 접수번호 20250814000001').length,2));
test('외부 보조값의 실제 URL을 보존',()=>{const a=metricSourceLinks('FnGuide (https://comp.fnguide.com/SVO2/ASP/SVD_Main.asp?pGB=1)','20260316000969');assert.equal(a.length,1);assert.equal(a[0].label,'FnGuide');});
test('혼합 산식은 DART와 외부 양쪽 출처 보존',()=>assert.equal(metricSourceLinks('네이버 금융 총차입금 + DART 자산총계 · https://finance.naver.com/item/main.naver?code=001440','20260316000969').length,2));
test('인쇄용 보고서의 태그·인용부호를 HTML로 실행하지 않음',()=>{assert.equal(escapeHtml('<img src=x onerror="alert(1)">&'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;');});

test('주석도 연결·별도 구간을 분리하고 미확인 기준은 사용하지 않음',async()=>{
 const {disclosureEntriesForBasis}=await import('../server/dart/disclosureNotes.ts');
 const entries=[{name:'report.xml',text:'<TITLE>3. 연결재무제표 주석</TITLE><table>CFS</table><TITLE>5. 재무제표 주석</TITLE><table>OFS</table>'}];
 assert.ok(disclosureEntriesForBasis(entries,'CFS')[0].text.includes('CFS'));
 assert.ok(!disclosureEntriesForBasis(entries,'CFS')[0].text.includes('<table>OFS'));
 assert.ok(disclosureEntriesForBasis(entries,'OFS')[0].text.includes('OFS'));
 assert.deepEqual(disclosureEntriesForBasis([{name:'unknown.xml',text:'<table>123</table>'}],'OFS'),[]);
});
