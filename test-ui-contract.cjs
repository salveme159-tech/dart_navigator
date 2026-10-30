// Render Home's JSX to an element tree with controlled hook values.
// This verifies content/order and callbacks; it is not a browser or React lifecycle test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require(process.env.TS_COMPILER_PATH||'typescript');
const root=path.resolve(__dirname,'..'),load=require('./production-test-loader.cjs')(root);
const client=load('client/src/lib/realDartClient.ts');
const company={...client.EMPTY_DART_RECORD,corpName:'검증전선',corpCode:'00104768',stockCode:'000500',basisCode:'CFS',period:'2026 반기보고서 · 상반기 누적(1~6월) · 기준일 2026.06.30',reportName:'2026 반기보고서 · 상반기 누적(1~6월) · 기준일 2026.06.30',isLiveApiFetched:true};
const source=fs.readFileSync(path.join(root,'client/src/pages/Home.tsx'),'utf8');
const transformer=context=>{const visit=node=>{if(ts.isVariableDeclaration(node)&&ts.isArrayBindingPattern(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText()==='useState'){
 const name=node.name.elements[0].name.getText(),call=node.initializer;
 const wrapped=ts.factory.createCallExpression(ts.factory.createIdentifier('__state'),undefined,[ts.factory.createStringLiteral(name),call.arguments[0]||ts.factory.createIdentifier('undefined')]);
 return ts.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[wrapped]));
 }return ts.visitEachChild(node,visit,context);};return node=>ts.visitNode(node,visit);};
const code=ts.transpileModule(source,{fileName:'Home.tsx',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true},transformers:{before:[transformer]}}).outputText;
const React={createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'fragment',useState:value=>[typeof value==='function'?value():value,()=>{}],useMemo:fn=>fn(),useEffect:()=>{},useRef:value=>({current:value})};
const dummy=()=>null,req=id=>{if(id==='react')return {__esModule:true,default:React,...React};if(id==='lucide-react')return new Proxy({},{get:(_t,name)=>String(name)});if(id==='@/lib/realDartClient')return client;if(id==='@/lib/apiBase')return {apiBaseUrl:'',apiUrl:x=>x};if(id==='@/lib/metricSources')return load('client/src/lib/metricSources.ts');if(id==='@/lib/xlsxExport')return load('client/src/lib/xlsxExport.ts');return {__esModule:true,default:dummy,startComparisonLoad:dummy,startFilingPolling:dummy};};
let overrides={};const mod={exports:{}};new Function('require','module','exports','__state',code)(req,mod,mod.exports,(name,value)=>Object.hasOwn(overrides,name)?overrides[name]:value);
function render(tab,extra={}){overrides={activeTab:tab,isApiGateOpen:false,apiKey:'a'.repeat(40),companies:[company],selectedCorpName:company.corpName,askCorpName:company.corpName,compareCorpNames:[company.corpName],apiStatusMessage:'✓ 검증전선: 실제 OpenDART 재무자료를 조회했습니다.',...extra};return mod.exports.default();}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join(' ');return (node.children||[]).map(text).join(' ');}
function nodes(node,out=[]){if(node&&typeof node==='object'){if(!Array.isArray(node))out.push(node);for(const x of Array.isArray(node)?node:node.children||[])nodes(x,out);}return out;}
let tree=render('DASHBOARD'),all=text(tree);
assert.ok(all.includes('DART FINDER'));assert.ok(!all.includes('손익 민감도 체크'));assert.ok(!all.includes('추가 기능'));assert.ok(all.includes('주요 실적'));
const main=nodes(tree).find(n=>n.type==='main'),content=text(main);assert.ok(content.indexOf('기업 검색')<content.indexOf('기준 기업'));assert.ok(content.indexOf('기준 기업')<content.indexOf('✓ 검증전선'));assert.ok(content.indexOf('✓ 검증전선')<content.indexOf('등록 종목'));assert.ok(content.includes('최신 데이터 갱신'));
tree=render('ASK');assert.ok(nodes(tree).some(n=>n.type==='input'&&n.props.placeholder==='기업명 검색'));assert.ok(!text(tree).includes('DART 기업명 검색'));
tree=render('COMPARE');all=text(tree);assert.ok(all.includes('최대 10개 비교 가능'));assert.ok(!all.includes('모든 기업을 같은 연도'));assert.ok(!all.includes('기업을 검색해 등록·삭제하고'));assert.ok(!all.includes('조회 상태'));assert.ok(all.includes('결과값 비교'));assert.ok(!all.includes('공시값 비교'));
tree=render('ALERTS');all=text(tree);assert.ok(all.includes('공시 알람 및 최근 공시 현황'));assert.ok(all.includes('관심기업의 신규 공시를 15초 간격으로 확인하며, 브라우저가 열려 있는 동안 동작합니다.'));assert.ok(all.includes('기업 등록하기'));assert.ok(!all.includes('지금 확인'));
tree=render('ONE_PAGER');all=text(tree);assert.equal(all.split('2026 반기보고서 · 상반기 누적(1~6월) · 기준일 2026.06.30').length-1,1);
tree=render('ALERTS',{currentCompanyFilings:[{company:'이전기업',reportName:'다른기업옛공시',rceptNo:'20261029000001',receiptDate:'20261029',url:'https://dart.fss.or.kr/'}]});assert.ok(!text(tree).includes('다른기업옛공시'));
console.log('Home element tree: 5 tab renders and requested content/order contracts passed (controlled hook adapter, no browser).');
