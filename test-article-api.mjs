// 실제 API 대신 고정된 OpenDART 형식의 응답을 주입하여 전체 검증 경로를 실행합니다.
// Node 22.18+ : node --test scripts/test-article-api.mjs
import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
const hooks=registerHooks({
 resolve(specifier,context,next){
   if(specifier==='@trpc/server')return {url:'mock:trpc',shortCircuit:true};
   try{return next(specifier,context);}catch(e){if(specifier.startsWith('.')&&context.parentURL){const u=new URL(specifier+'.ts',context.parentURL);if(existsSync(u))return next(u.href,context);}throw e;}
 },
 load(url,context,next){if(url==='mock:trpc')return {source:'export class TRPCError extends Error {constructor(o){super(o.message);this.code=o.code;}}',format:'module',shortCircuit:true};return next(url,context);}
});
const {factCheckArticle}=await import('../server/dart/articleFactCheck.ts');
const {clearDartCaches,recentFilingsDart}=await import('../server/dart/client.ts');
const originalFetch=globalThis.fetch;
let fail=false,missingCfs=false,calls=[];
const receipt='20261027000001';
const baseInput={company:'대한전선',year:2025,period:'annual',mode:'cum',basis:'CFS',articleDate:'2026-10-27'};
const fakeKey='a'.repeat(40);
beforeEach(()=>{
 clearDartCaches();fail=false;missingCfs=false;calls=[];
 globalThis.fetch=async (url,init)=>{
  const u=new URL(url);calls.push({u,init});
  if(fail)throw new Error('simulated timeout');
  if(u.pathname.endsWith('corpCode.xml'))return new Response(readFileSync(new URL('./fixtures/corps.zip',import.meta.url)));
  if(u.pathname.endsWith('document.xml'))return new Response(readFileSync(new URL('./fixtures/contract.zip',import.meta.url)));
  if(u.pathname.endsWith('list.json'))return Response.json({status:'000',total_page:1,list:[{corp_name:'대한전선',corp_code:'00111111',rcept_no:receipt,rcept_dt:'20261027',report_nm:'단일판매ㆍ공급계약체결'}]});
  if(u.pathname.endsWith('fnlttSinglAcntAll.json')){
   if(missingCfs&&u.searchParams.get('fs_div')==='CFS')return Response.json({status:'013'});
   const y=Number(u.searchParams.get('bsns_year'));
   return Response.json({status:'000',list:[
    {rcept_no:receipt,sj_div:'IS',account_nm:'매출액',account_id:'ifrs-full_Revenue',thstrm_amount:String((y===2025?1000:800)*1e8),thstrm_add_amount:String((y===2025?2000:1600)*1e8)},
    {rcept_no:receipt,sj_div:'IS',account_nm:'영업이익',account_id:'dart_OperatingIncomeLoss',thstrm_amount:String((y===2025?100:80)*1e8),thstrm_add_amount:String((y===2025?200:160)*1e8)},
   ]});
  }
  throw new Error('unexpected network request: '+u.pathname);
 };
});
after(()=>{globalThis.fetch=originalFetch;hooks.deregister();});
test('실제 DART 클라이언트 경로에서 복수 지표 불일치와 공시값 반환',async()=>{
 const r=await factCheckArticle({...baseInput,article:'대한전선 2025년 연결 매출액은 2,000억원, 영업이익은 999억원이다.'},fakeKey);
 assert.equal(r.summary.matched,1);assert.equal(r.summary.mismatched,1);assert.equal(r.claims[1].actual,200);assert.ok(r.claims[1].sourceUrl.endsWith(receipt));
});
test('당분기 설정은 누계 수치와 구분',async()=>{
 const r=await factCheckArticle({...baseInput,period:'half',mode:'qtr',article:'대한전선 2025년 2분기 매출액은 1,000억원이다.'},fakeKey);
 assert.equal(r.claims[0].actual,1000);assert.equal(r.summary.matched,1);
});
test('연결 데이터 부재 시 별도로 바꾸어 오류 판정하지 않음',async()=>{
 missingCfs=true;
 const r=await factCheckArticle({...baseInput,article:'대한전선 2025년 연결 매출액은 2,000억원이다.'},fakeKey);
 assert.equal(r.summary.unverified,1);assert.equal(r.claims[0].actual,null);
 assert.equal(calls.some(c=>c.u.searchParams.get('fs_div')==='OFS'),false);
});
test('전년 동기 증감률을 양쪽 공시로 산출',async()=>{
 const r=await factCheckArticle({...baseInput,article:'대한전선 2025년 영업이익은 전년 동기 대비 25% 증가했다.'},fakeKey);
 assert.equal(r.claims[0].actual,25);assert.equal(r.summary.matched,1);
});
test('독일 수주 기사 10배 금액 오류를 실제 원문 ZIP에서 확인',async()=>{
 const r=await factCheckArticle({...baseInput,article:'대한전선, 독일 380kV 전력망 1조1,469억원 수주'},fakeKey);
 assert.equal(r.summary.mismatched,1);const c=r.claims.find(c=>c.metric==='contract');assert.equal(c.actual,1146.9);assert.equal(c.status,'MISMATCH');assert.equal(r.contractCandidates.length,1);
});
test('특정할 수 없는 계약을 금액 유사성으로 잘못 연결하지 않음',async()=>{
 const r=await factCheckArticle({...baseInput,article:'대한전선은 1,146억원 규모의 수주를 확보했다.'},fakeKey);
 assert.equal(r.summary.unverified,1);assert.equal(r.claims[0].actual,null);assert.equal(r.contractCandidates.length,1);
});
test('사용자가 선택한 동일 기업 공시로 계약금액 확인',async()=>{
 const r=await factCheckArticle({...baseInput,article:'대한전선은 1,146.9억원 규모의 수주를 확보했다.',contractReceipt:receipt},fakeKey);
 assert.equal(r.summary.matched,1);
});
test('공시 목록 연속 조회는 캐시를 우회해 매번 원천 요청',async()=>{
 await recentFilingsDart(['대한전선'],'20261027',fakeKey);await recentFilingsDart(['대한전선'],'20261027',fakeKey);
 const listCalls=calls.filter(c=>c.u.pathname.endsWith('list.json'));assert.equal(listCalls.length,2);assert.ok(listCalls.every(c=>c.init.cache==='no-store'));
});
test('API 장애는 틀린 금액으로 단정하지 않고 확인 필요',async()=>{
 // 기업 코드만 먼저 성공한 뒤 재무 API 오류를 주입
 const old=globalThis.fetch;globalThis.fetch=async(u,init)=>new URL(u).pathname.endsWith('corpCode.xml')?old(u,init):Promise.reject(new Error('offline'));
 const r=await factCheckArticle({...baseInput,article:'대한전선 2025년 영업이익은 100억원이다.'},fakeKey);
 assert.equal(r.summary.unverified,1);assert.equal(r.summary.mismatched,0);
});
