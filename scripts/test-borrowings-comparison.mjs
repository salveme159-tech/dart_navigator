import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),createLoader=require('./production-test-loader.cjs');
const root=fileURLToPath(new URL('..',import.meta.url)),key='a'.repeat(40),year=new Date().getFullYear(),receipt=`${year}0814000001`;
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
function fresh(realNotes=false){const load=createLoader(root);const actualNotes=load('server/dart/disclosureNotes.ts');const run=realNotes?createLoader(root,{disclosureNotes:actualNotes}):load;return {load:run,client:run('server/dart/client.ts'),engine:run('server/dart/engine.ts'),notes:actualNotes};}
const row=(name,value,extra={})=>({sj_div:'BS',account_nm:name,thstrm_amount:String(value*1e8),...extra});
function balance(extra={}){return [['자산총계',1500],['부채총계',600],['자본총계',900],['유동자산',500],['유동부채',300],['단기차입금',100],['장기차입금',200],['유동리스부채',10],['비유동리스부채',40],['현금및현금성자산',50],['단기금융상품',25],['재고자산',80],['매입채무',70]].map(([n,v])=>row(n,v,extra));}
function zip(text,name='report.xml'){const data=Buffer.from(text),file=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(file.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt16LE(1,8);end.writeUInt32LE(central.length+file.length,12);end.writeUInt32LE(local.length+file.length+data.length,16);return Buffer.concat([local,file,data,central,file,end]);}
const corpZip=zip('<result><list><corp_name>검증전선</corp_name><corp_code>00104768</corp_code><stock_code>000500</stock_code></list></result>','CORPCODE.xml');
function noteXml({scope='연결',current='1,000',noncurrent='4,000',combined=true}={}){return `<DOCUMENT><TITLE>3. ${scope}재무제표 주석</TITLE><P>(단위: 백만원)</P><TABLE><TR><TH>계정</TH><TH>당반기말</TH><TH>전기말</TH></TR>${combined?'<TR><TU>차입금 및 사채</TU><TE>30,000</TE><TE>27,000</TE></TR>':''}<TR><TU>유동 리스부채</TU><TE>${current}</TE><TE>900</TE></TR><TR><TU>비유동 리스부채</TU><TE>${noncurrent}</TE><TE>3,800</TE></TR></TABLE></DOCUMENT>`;}
function network({notes=false,noteScope='연결'}={}){
 let documents=0;
 globalThis.fetch=async input=>{const u=new URL(String(input));
  if(u.pathname.endsWith('corpCode.xml'))return new Response(corpZip);
  if(u.pathname.endsWith('list.json'))return Response.json({status:'000',total_page:1,list:[{rcept_no:receipt,report_nm:`반기보고서 (${year}.06)`,rcept_dt:`${year}0814`}]});
  if(u.pathname.endsWith('fnlttSinglAcntAll.json')){
   const basis=u.searchParams.get('fs_div'),scope={fs_div:basis,bsns_year:u.searchParams.get('bsns_year'),reprt_code:u.searchParams.get('reprt_code'),corp_code:'00104768',rcept_no:receipt};
   let bs=balance(scope);if(notes)bs=[...bs.filter(r=>!/리스/.test(r.account_nm)),row('기타금융부채',50,scope)];
   const flow=[['매출액',1000],['영업이익',100],['당기순이익',50],['금융원가',20]].map(([n,v])=>row(n,v,{...scope,sj_div:'CIS',thstrm_add_amount:String(v*1e8)}));
   const cf=[['영업활동현금흐름',120],['유형자산취득',50],['감가상각비',10]].map(([n,v])=>row(n,v,{...scope,sj_div:'CF'}));
   return Response.json({status:'000',list:[...bs,...flow,...cf]});
  }
  if(u.pathname.endsWith('fnlttSinglAcnt.json'))return Response.json({status:'013',list:[]});
  if(u.pathname.endsWith('document.xml')){documents++;return new Response(zip(noteXml({scope:noteScope})));}
  throw new Error('Unexpected fixture request: '+u.pathname);
 };
 return ()=>documents;
}

test('완전한 재무상태표에서 미발행 사채·유동성장기부채 행이 없어도 공시 차입금 합산',()=>{const {client:c,engine:e}=fresh();const rows=balance();assert.equal(c.pickMetric(rows,e.P(year,'half'),'borrowings').value,300);assert.ok(Math.abs(c.pickMetric(rows,e.P(year,'half'),'borrowingsRatio').value-300/1500*100)<1e-9);});
test('주요계정만 있거나 차입금 행이 비어 있으면 없는 종류를 0으로 간주하지 않음',()=>{const {client:c,engine:e}=fresh();for(const rows of [balance({source_type:'MAJOR'}),[...balance(),{sj_div:'BS',account_nm:'사채',thstrm_amount:''}]])assert.equal(Number.isFinite(c.pickMetric(rows,e.P(year,'half'),'borrowings').value),false);});
test('기타금융부채 전체를 차입금에 더하거나 그 존재만으로 확인된 합계를 지우지 않음',()=>{const {client:c,engine:e}=fresh();const result=c.pickMetric([...balance(),row('기타금융부채',70)],e.P(year,'half'),'borrowings');assert.equal(result.value,300);});
test('표시 순번과 영문 비유동 계정코드가 유동 차입금·리스부채에 섞이지 않음',()=>{const {client:c,engine:e}=fresh();const rows=balance().map(r=>({...r,account_nm:`1. ${r.account_nm}`}));rows.find(r=>r.account_nm.includes('비유동리스')).account_id='ifrs-full_NoncurrentLeaseLiabilities';rows.find(r=>r.account_nm.endsWith('장기차입금')).account_id='ifrs-full_NoncurrentBorrowings';assert.equal(c.pickMetric(rows,e.P(year,'half'),'borrowings').value,300);});
test('리스부채 합계 한 행은 두 유동성 구분을 중복 요구하지 않고 한 번만 반영',()=>{const {client:c,engine:e}=fresh();const rows=[...balance().filter(r=>!/리스/.test(r.account_nm)),row('리스부채합계',50)];assert.equal(c.pickMetric(rows,e.P(year,'half'),'borrowings').value,300);});
test('영문 표준 합계 계정과 리스부채(유동/비유동) 계정명도 같은 차입금 합계',()=>{const {client:c,engine:e}=fresh();const rows=balance().map(r=>r.account_nm==='자산총계'?{...r,account_nm:'Assets',account_id:'ifrs-full_Assets'}:r.account_nm==='부채총계'?{...r,account_nm:'Liabilities',account_id:'ifrs-full_Liabilities'}:r.account_nm==='자본총계'?{...r,account_nm:'Equity',account_id:'ifrs-full_Equity'}:r.account_nm==='유동리스부채'?{...r,account_nm:'리스부채(유동)'}:r.account_nm==='비유동리스부채'?{...r,account_nm:'리스부채(비유동)'}:r);assert.equal(c.pickMetric(rows,e.P(year,'half'),'borrowings').value,300);});
test('매입채무 비교도 카드와 같은 IFRS 표준 계정 선택기를 사용',()=>{const {client:c,engine:e}=fresh();const result=c.pickMetric([row('Trade and other payables',70,{account_id:'ifrs-full_TradeAndOtherCurrentPayables'})],e.P(year,'half'),'payables');assert.equal(result.value,70);});
test('DART XML의 TU·TE 셀에서 같은 기간·연결 기준 차입금과 리스부채 추출',()=>{const {engine:e,notes:n}=fresh();const entries=[{name:'report.xml',text:noteXml()}],period=e.P(year,'half');assert.equal(n.parseLeaseLiabilitiesFromDisclosure(entries,period,'CFS').total,50);assert.equal(n.parseBorrowingTotalFromDisclosure(entries,period,'CFS').value,300);assert.equal(n.parseLeaseLiabilitiesFromDisclosure(entries,period,'OFS'),null);assert.equal(n.parseBorrowingTotalFromDisclosure(entries,period,'OFS'),null);});
test('공시된 리스부채 대시는 0, 빈 금액과 미확인 회계기준은 누락으로 구분',()=>{const {engine:e,notes:n}=fresh();const period=e.P(year,'half'),parse=opts=>n.parseLeaseLiabilitiesFromDisclosure([{name:'report.xml',text:noteXml(opts)}],period,'CFS');assert.equal(parse({current:'-',noncurrent:'-'}).total,0);assert.equal(parse({current:'',noncurrent:'4,000'}),null);});
test('종목 현황과 비교분석은 유동자산·원천계정·차입금·의존도에 동일 값과 출처 사용',async()=>{
 const {client:c}=fresh();network();const snapshot=await c.snapshotDart('검증전선',false,key,false,'CFS');
 const checks={totalAssets:'자산총계',totalLiabilities:'부채총계',totalEquity:'자본총계',currentAssets:'유동자산',currentLiabilities:'유동부채',cashAndCashEquivalents:'현금및현금성자산',shortTermFinancialAssets:'단기금융상품',inventories:'재고자산',financeCosts:'금융원가'};
 for(const [metric,label] of Object.entries(checks)){const result=await c.compareDart({companies:['검증전선'],metric,year,period:'half',basis:'CFS',includeValidation:false},key);assert.equal(result.rows[0].found,true,metric);assert.equal(result.rows[0].value,snapshot.rawAccountMetrics[label].value,metric);assert.equal(result.rows[0].rceptNo,snapshot.rceptNo);}
 for(const metric of ['borrowings','borrowingsRatio']){const result=await c.compareDart({companies:['검증전선'],metric,year,period:'half',basis:'CFS',includeValidation:false},key);assert.equal(result.rows[0].value,snapshot.metrics[metric].value,metric);assert.equal(result.rows[0].found,true);}
 const turnover=await c.compareDart({companies:['검증전선'],metric:'assetTurnover',year,period:'half',basis:'CFS',includeValidation:false},key);assert.equal(turnover.rows[0].value,1000/1500);assert.equal(turnover.rows[0].unit,'회');
});
test('본문의 기타금융부채로 누락된 차입금은 같은 원문 주석의 합계와 리스로 보완',async()=>{const {client:c}=fresh(true);const calls=network({notes:true});const snapshot=await c.snapshotDart('검증전선',false,key,false,'CFS');assert.equal(snapshot.metrics.borrowings.value,300);assert.ok(Math.abs(snapshot.metrics.borrowingsRatio.value-300/1500*100)<1e-9);const comparison=await c.compareDart({companies:['검증전선'],metric:'borrowings',year,period:'half',basis:'CFS',includeValidation:false},key);assert.equal(comparison.rows[0].value,300);assert.ok(calls()>=0);});
test('다른 연결·별도 주석으로 빈 차입금을 보정하지 않음',async()=>{const {client:c}=fresh(true);network({notes:true,noteScope:'별도'});const result=await c.compareDart({companies:['검증전선'],metric:'borrowings',year,period:'half',basis:'CFS',includeValidation:false},key);assert.equal(result.rows[0].found,true);assert.equal(result.rows[0].value,300);});
test('비교분석의 네 공시 기간과 연결·별도에서 원천계정 조회, 하반기 요청은 거절',async()=>{const {client:c}=fresh();network();for(const basis of ['CFS','OFS'])for(const period of ['q1','half','q3','annual']){const result=await c.compareDart({companies:['검증전선'],metric:'currentAssets',year,period,basis,includeValidation:false},key);assert.equal(result.rows[0].value,500);assert.match(result.rows[0].basis,basis==='CFS'?/연결/:/별도/);}await assert.rejects(c.compareDart({companies:['검증전선'],metric:'revenue',period:'h2',year,basis:'CFS'},key),/1분기·상반기·3분기·연간/);});
