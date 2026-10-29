import {test} from 'node:test';
import assert from 'node:assert/strict';
import {amountOf,findRowLike,findRevenueRow,metricConfig} from '../server/dart/engine.ts';
import {recoverStatementRows} from '../server/dart/statementRecovery.ts';
const op=rows=>findRowLike(rows,['CIS','IS'],metricConfig.operatingProfit.names);
const net=rows=>findRowLike(rows,['CIS','IS'],metricConfig.netIncome.names);
const scope={year:2025,report:'11011',basis:'CFS',receipt:'20260316000969',corpCode:'00104768'};
const row=(account_nm,thstrm_amount,extra={})=>({sj_div:'IS',account_nm,thstrm_amount,...extra});
const major=(account_nm,value,extra={})=>row(account_nm,value,{fs_div:'CFS',bsns_year:'2025',reprt_code:'11011',rcept_no:scope.receipt,corp_code:scope.corpCode,...extra});
const full=[row('매출액','100000000000'),row('영업이익','8000000000'),row('당기순이익','5000000000')];
test('표준 계정코드로 회사별 다른 영업이익·순이익 표기 인식',()=>{assert.equal(amountOf(op([row('Operating profit','8000000000',{account_id:'dart_OperatingIncomeLoss'})])),80);assert.equal(amountOf(net([row('Profit for the year','5000000000',{account_id:'ifrs-full_ProfitLoss'})])),50);});
test('번호·전각괄호·공백·제로폭 문자가 있는 영업손익과 매출액 인식',()=>{assert.equal(amountOf(op([row('Ⅲ. 영업\u200b손익','8000000000')])),80);assert.ok(findRevenueRow([row('Ⅰ. 수익（매출액）','100000000000')]));});
test('빈 CIS 행 때문에 금액이 있는 IS 행을 놓치지 않음',()=>{const selected=op([row('영업이익','',{sj_div:'CIS'}),row('영업이익','8000000000')]);assert.equal(amountOf(selected),80);});
test('두 표에 값이 있으면 기존 CIS→IS 우선순위 유지',()=>{assert.equal(amountOf(op([row('영업이익','8000000000'),row('영업이익(손실)','7000000000',{sj_div:'CIS'})])),70);});
test('정상 0원은 결측으로 오인하지 않음',()=>{assert.equal(amountOf(op([row('영업이익','0')])),0);});
test('괄호·유니코드 마이너스·삼각형 음수 파싱과 잘못된 금액 차단',()=>{for(const value of ['(1,200,000,000)','−1,200,000,000','△1,200,000,000'])assert.equal(amountOf(row('',value)),-12);for(const value of ['', 'abc','1e8','0x10'])assert.equal(amountOf(row('',value)),null);assert.equal(amountOf(row('','100',{currency:'USD'})),null);});
test('영업외·중단영업·이익률·지배주주 순이익을 합계로 오인하지 않음',()=>{assert.equal(op([row('영업이익률','8'),row('중단영업이익','100')]),undefined);assert.equal(net([row('지배기업의소유주에게귀속되는당기순이익','100',{account_id:'ifrs-full_ProfitLossAttributableToOwnersOfParent'})]),undefined);});
test('현금흐름·유형자산 취득도 정확한 표준 계정코드로 인식',()=>{assert.ok(findRowLike([row('Operating cash flow','100',{sj_div:'CF',account_id:'ifrs-full_CashFlowsFromUsedInOperatingActivities'})],['CF'],metricConfig.operatingCashFlow.names));assert.equal(findRowLike([row('무형자산취득','100',{sj_div:'CF',account_id:'ifrs-full_PurchaseOfIntangibleAssets'})],['CF'],metricConfig.capex.names),undefined);});
test('핵심값이 모두 있으면 추가 API 호출하지 않음',async()=>{let called=0;const result=await recoverStatementRows(full,scope,async()=>{called++;return {status:'000',list:[]}});assert.equal(called,0);assert.equal(result.status,'complete');});
test('손익표 누락시 같은 보고서의 주요계정으로 보완',async()=>{const result=await recoverStatementRows([row('자산총계','100',{sj_div:'BS'})],scope,async()=>({status:'000',list:[major('매출액','100000000000'),major('영업이익','8000000000'),major('당기순이익','5000000000')]}));assert.equal(result.status,'recovered');assert.equal(amountOf(op(result.rows)),80);assert.equal(amountOf(net(result.rows)),50);});
test('다른 기준·연도·보고서·접수번호·기업의 값 혼합 차단',async()=>{for(const patch of [{fs_div:'OFS'},{bsns_year:'2024'},{reprt_code:'11012'},{rcept_no:'20260316000968'},{corp_code:'00111111'}]){const result=await recoverStatementRows([],scope,async()=>({status:'000',list:[major('영업이익','8000000000',patch)]}));assert.equal(op(result.rows),undefined);}});
test('기존 유효값 보존, 빈 중복 행은 주요계정 값으로 보완',async()=>{const result=await recoverStatementRows([full[0],row('영업이익','',{sj_div:'CIS'})],scope,async()=>({status:'000',list:[major('매출액','999'),major('영업이익','8000000000'),major('당기순이익','5000000000')]}));assert.equal(amountOf(findRevenueRow(result.rows)),1000);assert.equal(amountOf(op(result.rows)),80);});
test('재조회 오류는 0원으로 채우지 않고 진단 사유 유지',async()=>{const result=await recoverStatementRows([row('자산총계','100',{sj_div:'BS'})],scope,async()=>{throw new Error('network')});assert.equal(result.status,'failed');assert.equal(op(result.rows),undefined);assert.match(result.rows[0].recovery_note,/추가 조회에 실패/);});
test('부분 보완에도 손익 누락이 남으면 재조회 가능한 상태로 유지',async()=>{const result=await recoverStatementRows([row('자산총계','100',{sj_div:'BS'})],scope,async()=>({status:'000',list:[major('영업이익','8000000000')]}));assert.equal(result.status,'unavailable');assert.match(result.note,/모두 확인하지 못/);});

for (const [label,report] of [['2015 1분기','11013'],['2015 상반기','11012'],['2015 3분기','11014']]) {
 test(label+' 전체 API가 비었어도 같은 분기 주요계정으로 복구',async()=>{
  const scoped={...scope,year:2015,report,receipt:'20151116000969'};
  const values=[major('매출액','100000000000'),major('영업이익','8000000000'),major('당기순이익','5000000000')].map(r=>({...r,bsns_year:'2015',reprt_code:report,rcept_no:scoped.receipt}));
  const result=await recoverStatementRows([],scoped,async()=>({status:'000',list:[...values,major('영업이익','999000000000',{bsns_year:'2015',reprt_code:'11011',rcept_no:scoped.receipt})]}));
  assert.equal(result.status,'recovered');assert.equal(amountOf(op(result.rows)),80);assert.equal(result.rows.length,3);
 });
}
