import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAccount } from '../shared/financialAccounts.ts';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const loader=require('./production-test-loader.cjs');
const pickMetric=loader(fileURLToPath(new URL('..',import.meta.url)))('server/dart/client.ts').pickMetric;
const base = {fs_div:'CFS', bsns_year:'2025', reprt_code:'11012', rcept_no:'20250814000001',source_type:'ALL'};
const bs=(name,value)=>({...base,sj_div:'BS',account_nm:name,account_id:'-표준계정코드 미사용-',thstrm_amount:String(value*1e8)});
const half={year:2025,kind:'half',mode:'cum',code:'11012'};
const q1={year:2025,kind:'q1',mode:'cum',code:'11013'};
test('nonstandard consolidated half-year profit account uses cumulative amount',()=>{
 const row={...base,sj_div:'CIS',account_nm:'당반기연결순손익',account_id:'-표준계정코드 미사용-',thstrm_amount:String(70e8),thstrm_add_amount:String(110e8)};
 assert.equal(selectAccount([row],'순이익',half,'CFS')?.value,110);
});
test('half-year profit must not use quarterly amount if cumulative is unknown',()=>{
 const row={...base,sj_div:'CIS',account_nm:'당반기연결순손익',account_id:'-표준계정코드 미사용-',thstrm_amount:String(70e8)};
 assert.equal(selectAccount([row],'순이익',half,'CFS'),null);
});
test('first quarter profit with alternate name',()=>{
 const row={...base,reprt_code:'11013',sj_div:'CIS',account_nm:'당분기연결순손익',account_id:'-표준계정코드 미사용-',thstrm_amount:String(35e8)};
 assert.equal(selectAccount([row],'순이익',q1,'CFS')?.value,35);
});
test('trade-and-other receivable/payable working capital',()=>{
 const rows=[bs('매출채권 및 기타수취채권',120),bs('재고자산',80),bs('매입채무 및 기타지급채무',50)];
 assert.equal(pickMetric(rows,half,'workingCapital')?.value,150);
});
test('missing payable cannot be treated as zero',()=>{
 assert.equal(pickMetric([bs('매출채권',120),bs('재고자산',80)],half,'workingCapital'),null);
});
test('net income uses a consolidated total from a nonstandard quarterly row',()=>{
 const row={...base,reprt_code:'11013',sj_div:'CIS',account_nm:'연결총분기순손익',account_id:'-표준계정코드 미사용-',thstrm_amount:String(46e8)};
 assert.equal(pickMetric([row],q1,'netIncome')?.value,46);
});
test('net income never substitutes owners attributable profit',()=>{
 const row={...base,reprt_code:'11013',sj_div:'CIS',account_nm:'지배기업소유주귀속분기순이익',account_id:'ifrs-full_ProfitLossAttributableToOwnersOfParent',thstrm_amount:String(46e8)};
 assert.equal(pickMetric([row],q1,'netIncome'),null);
});
test('half-year net income cannot use a three-month value without cumulative proof',()=>{
 const row={...base,sj_div:'CIS',account_nm:'연결총반기순손익',account_id:'-표준계정코드 미사용-',thstrm_amount:String(46e8)};
 assert.equal(pickMetric([row],half,'netIncome'),null);
});
