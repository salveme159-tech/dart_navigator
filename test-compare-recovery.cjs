const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require(process.env.TYPESCRIPT_PATH || 'typescript');
const root=path.resolve(process.argv[2] || path.join(__dirname,'..'));
const tests=[];
function expect(value,neg=false){const check=fn=>{let error;try{fn()}catch(e){error=e}if(neg){assert.ok(error,'expected negated assertion to fail')}else if(error)throw error};const out={toBe:x=>check(()=>assert.equal(value,x)),toEqual:x=>check(()=>assert.deepEqual(value,x)),toBeNull:()=>check(()=>assert.equal(value,null)),toContain:x=>check(()=>assert.ok(value?.includes(x))),toBeCloseTo:(x,d=2)=>check(()=>assert.ok(typeof value==='number' && Math.abs(value-x)<0.5*10**-d,`${value} != ${x}`))};Object.defineProperty(out,'not',{get:()=>expect(value,!neg)});return out;}
const unavailable=async()=>null;
let validationCalls=0;
const stubs={
 './apiBase':{apiUrl:path=>path,apiBaseUrl:''},
 'vitest':{describe:(_name,fn)=>fn(),it:(name,fn)=>tests.push({name,fn}),expect},
 '@trpc/server':{TRPCError:class extends Error{constructor(o){super(o.message);this.code=o.code;}}},
 'env':{ENV:{opendartApiKey:'a'.repeat(40)}},
 'crossValidation':{crossValidateMetric:async()=>{validationCalls++;return {providers:[],status:'UNAVAILABLE'}},crossValidateMetrics:async()=>({}),clearCrossValidationCache:()=>{},fetchNaverDebtFallback:unavailable},
 'fnGuideFallback':{fetchFnGuideFallback:unavailable,fetchFnGuideLeaseLiabilities:unavailable},
 'disclosureNotes':{parseDepreciationFromDisclosure:()=>null,parseLeaseLiabilitiesFromDisclosure:()=>null,parseBorrowingTotalFromDisclosure:()=>null,parseRevenueFromDisclosure:()=>null},
};
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=id=>{if(stubs[id])return stubs[id];if(id.endsWith('/env'))return stubs.env;if(id.endsWith('/crossValidation'))return stubs.crossValidation;if(id.endsWith('/fnGuideFallback'))return stubs.fnGuideFallback;if(id.endsWith('/disclosureNotes'))return stubs.disclosureNotes;if(!id.startsWith('.'))return require(id);let target=path.resolve(path.dirname(file),id);if(!target.endsWith('.ts'))target+='.ts';return load(target);};
 new Function('require','module','exports',code)(req,module,module.exports);return module.exports;
}
load(path.join(root,'server/dart.test.ts'));
(async()=>{let failures=0;for(const test of tests){try{await test.fn()}catch(e){failures++;console.log('FAIL:',test.name,e.message)}}console.log(JSON.stringify({existingEngineTests:tests.length,passed:tests.length-failures,failures}));if(failures)process.exitCode=1;
if(process.env.SKIP_RECOVERY_INTEGRATION)return;
const client=load(path.join(root,'server/dart/client.ts'));
// A minimal stored ZIP of corpCode.xml, using the production ZIP reader.
function zip(xml){const data=Buffer.from(xml),name=Buffer.from('CORPCODE.xml'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);return Buffer.concat([local,name,data,central,name,end]);}
const receipt='20260316000969';let corpDownloads=0;let all=0,major=0;let bothEmpty=false;
const majorRows=[['매출액','100000000000'],['영업이익','8000000000'],['당기순이익','5000000000']].map(([account_nm,thstrm_amount])=>({account_nm,thstrm_amount,sj_div:'IS',fs_div:'CFS',bsns_year:'2025',reprt_code:'11011',rcept_no:receipt,corp_code:'00104768'}));
const oldFetch=global.fetch;global.fetch=async input=>{const url=new URL(String(input));if(url.pathname.endsWith('corpCode.xml')){corpDownloads++;return new Response(zip('<result><list><corp_name>가상전선</corp_name><corp_code>00104768</corp_code><stock_code>000500</stock_code></list></result>'));}
 if(url.pathname.endsWith('/list.json'))return Response.json({status:'000',list:[{rcept_no:receipt,report_nm:'사업보고서 (2025.12)',rcept_dt:'20260316'}]});
 if(url.pathname.endsWith('fnlttSinglAcntAll.json')){all++;if(url.searchParams.get('bsns_year')==='2015')return Response.json({status:'013',list:[]});return Response.json({status:'000',list:[{sj_div:'BS',account_nm:'자산총계',thstrm_amount:'1000000000000',bsns_year:'2025',reprt_code:'11011',rcept_no:receipt}]});}
 if(url.pathname.endsWith('fnlttSinglAcnt.json')){major++;if(bothEmpty)return Response.json({status:'013',list:[]});const rows=majorRows.map(row=>({...row,bsns_year:url.searchParams.get('bsns_year'),reprt_code:url.searchParams.get('reprt_code'),thstrm_dt:url.searchParams.get('bsns_year')+'.01.01 ~ '+url.searchParams.get('bsns_year')+'.'+({'11011':'12.31','11012':'06.30','11013':'03.31','11014':'09.30'}[url.searchParams.get('reprt_code')])}));return Response.json({status:'000',list:[...rows,...rows.map(row=>({...row,fs_div:'OFS',thstrm_amount:'999000000000'}))]});}
 throw new Error('Unexpected network call: '+url.pathname);
};
try{
 await client.clearDartCaches();const metrics=['operatingProfit','operatingMargin','netMargin'];const results=await Promise.all(metrics.map(metric=>client.compareDart({companies:['가상전선'],metric,year:2025,period:'annual',basis:'CFS'},'a'.repeat(40))));
 const values=results.map(r=>r.rows[0].value);assert.deepEqual(values,[80,8,5]);assert.equal(all,1);assert.equal(major,1);assert.equal(corpDownloads,1);
 const before=validationCalls;await client.compareDart({companies:['가상전선'],metric:'operatingProfit',year:2025,period:'annual',basis:'CFS',includeValidation:false},'a'.repeat(40));assert.equal(validationCalls,before);console.log('Comparison fast path: no secondary validation calls; first-cell requests share one corporation download.');
 assert.ok(results.every(r=>r.rows[0].found && r.rows[0].rceptNo===receipt));
 console.log(JSON.stringify({productionCompareIntegration:'passed',recoveredValues:values,allApiCalls:all,majorApiCalls:major,description:'Mocked HTTP responses; actual client.compareDart and engine; external validation stubbed'}));
 for(const period of ['q1','half','q3']){
   await client.clearDartCaches();
   const result=await client.compareDart({companies:['가상전선'],metric:'operatingProfit',year:2015,period,basis:'CFS'},'a'.repeat(40));
   assert.equal(result.rows[0].value,80);assert.equal(result.rows[0].found,true);
 }
 bothEmpty=true;await client.clearDartCaches();
 const absent=await client.compareDart({companies:['가상전선'],metric:'operatingProfit',year:2015,period:'q1',basis:'CFS'},'a'.repeat(40));
 assert.equal(absent.rows[0].found,false);assert.match(absent.rows[0].message,/API/);
 console.log('2015 production comparison path: q1/half/q3 013-to-major recovery passed; both APIs unavailable stays unconfirmed.');

}finally{global.fetch=oldFetch;}
// Browser transport uses the same force/basis flags as the refresh button.
const browserClient=load(path.join(root,'client/src/lib/realDartClient.ts'));
let snapshotInput;
global.fetch=async input=>{const u=new URL(String(input),'https://fixture.invalid');snapshotInput=JSON.parse(u.searchParams.get('input')).json;return Response.json({result:{data:{json:{found:true,company:'가상전선',corpCode:'00104768',stockCode:'000500',rceptNo:receipt,reportName:'사업보고서 (2025.12)',period:'2025 사업보고서 · 연간 · 기준일 2025.12.31',periodYear:2025,periodKind:'annual',periodMode:'cum',basisCode:'OFS',rawRows:majorRows,metrics:{revenue:{value:1000,unit:'억원'}}}}}});};
const browserRecord=await browserClient.fetchLiveDartCompanyRecord('가상전선','a'.repeat(40),false,'OFS',true);
assert.equal(snapshotInput.force,true);assert.equal(snapshotInput.basis,'OFS');assert.equal(browserRecord.record.reportName,'사업보고서 (2025.12)');assert.equal(browserRecord.record.basisCode,'OFS');
console.log('Browser snapshot transport: forced refresh, basis and distinct report/period metadata passed (fixture HTTP).');
global.fetch=oldFetch;

// Latest-report and forced-refresh regression: real production functions, fixture HTTP only.
let refreshPhase=0,statementCalls=0,lists=0;
const liveYear=new Date().getFullYear();
const rcp=()=>`${liveYear}102900000${refreshPhase+1}`;
const fullRows=(url)=>{
 const receipt=refreshPhase===2 ? `${liveYear}1029000002` : rcp();
 const basis=url.searchParams.get('fs_div');
 const scope={fs_div:basis,bsns_year:url.searchParams.get('bsns_year'),reprt_code:url.searchParams.get('reprt_code'),rcept_no:receipt,corp_code:'00104768'};
 const balance=[['자산총계',1000],['부채총계',400],['자본총계',600],['유동자산',300],['유동부채',200],['단기차입금',100],['유동성장기부채',0],['장기차입금',0],['사채',0],['유동리스부채',0],['비유동리스부채',0]];
 const flow=[['매출액',1000+refreshPhase*100],['영업이익',100],['당기순이익',50]];
 return [...balance.map(([account_nm,v])=>({...scope,sj_div:'BS',account_nm,thstrm_amount:String(v*1e8)})),...flow.map(([account_nm,v])=>({...scope,sj_div:basis==='OFS'?'IS':'CIS',account_nm,thstrm_amount:String(v*1e8),thstrm_add_amount:String(v*1e8)})),{...scope,sj_div:'CF',account_nm:'감가상각비및무형자산상각비',account_id:'ifrs-full_DepreciationAndAmortisationExpense',thstrm_amount:'1000000000',thstrm_add_amount:'1000000000'}];
};
global.fetch=async input=>{
 const url=new URL(String(input));
 if(url.pathname.endsWith('corpCode.xml'))return new Response(zip('<result><list><corp_name>가상전선</corp_name><corp_code>00104768</corp_code><stock_code>000500</stock_code></list></result>'));
 if(url.pathname.endsWith('/list.json')){lists++;return Response.json({status:'000',total_page:1,list:[{report_nm:`${refreshPhase?'[기재정정]':''}분기보고서 (${liveYear}.09)`,rcept_no:rcp(),rcept_dt:`${liveYear}1029`}]});}
 if(url.pathname.endsWith('fnlttSinglAcntAll.json')){statementCalls++;return Response.json({status:'000',list:fullRows(url)});}
 if(url.pathname.endsWith('fnlttSinglAcnt.json'))return Response.json({status:'013',list:[]});
 throw new Error('Unexpected request '+url.pathname);
};
try{
 await client.clearDartCaches();
 const initial=await client.snapshotDart('가상전선',false,'a'.repeat(40));
 assert.equal(initial.periodKind,'q3');assert.equal(initial.rceptNo,`${liveYear}1029000001`);assert.equal(initial.metrics.revenue.value,1000);
 refreshPhase=1;
 const refreshed=await client.snapshotDart('가상전선',true,'a'.repeat(40));
 assert.equal(refreshed.rceptNo,`${liveYear}1029000002`);assert.equal(refreshed.metrics.revenue.value,1100);assert.match(refreshed.reportName,/정정/);assert.equal(statementCalls,2);
 refreshPhase=2;
 const delayed=await client.snapshotDart('가상전선',true,'a'.repeat(40));
 assert.equal(delayed.amendmentPending,true);assert.match(delayed.dataNotice,/아직 반영되지/);
 const history=await client.historyDart('가상전선','a'.repeat(40),'OFS');
 assert.ok(history.quarterlyHistory.length);assert.ok(history.quarterlyHistory.every(p=>p.basisCode==='OFS'));
 let pageCalls=[];
 global.fetch=async input=>{const url=new URL(String(input));if(url.pathname.endsWith('/list.json')){const page=Number(url.searchParams.get('page_no'));pageCalls.push(page);return Response.json({status:'000',total_page:2,list:[{report_nm:'주요사항보고서',rcept_no:`${liveYear}102900000${page}`,rcept_dt:`${liveYear}1029`}]});}throw new Error(url.pathname);};
 const filings=await client.recentFilingsDart(['가상전선'],`${liveYear}0101`,'a'.repeat(40),`${liveYear}1231`);
 assert.deepEqual(pageCalls,[1,2]);assert.equal(filings.rows.length,2);assert.equal(filings.warnings.length,0);
 await assert.rejects(client.compareDart({companies:Array.from({length:11},(_,i)=>'기업'+i),metric:'revenue',period:'annual',year:2025,basis:'CFS'},'a'.repeat(40)),/최대 10개/);
 console.log(JSON.stringify({latestRefreshIntegration:'passed',checks:['early published quarterly filing','forced cache bypass','amended receipt and values','API amendment delay disclosed','OFS history isolation','all filing pages','11th comparison rejected'],network:'fixture HTTP; no actual user API key'}));
}finally{global.fetch=oldFetch;}

})().catch(e=>{console.error(e);process.exitCode=1});
