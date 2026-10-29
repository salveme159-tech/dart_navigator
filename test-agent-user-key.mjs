import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerUserAgentRoutes } from '../server/_core/userAgent.ts';
const secret='test-only-secret-do-not-deploy-0123456789abcdef';
let old;
beforeEach(()=>{old=process.env.AGENT_CONNECTION_SECRET;process.env.AGENT_CONNECTION_SECRET=secret;});
afterEach(()=>{if(old===undefined)delete process.env.AGENT_CONNECTION_SECRET;else process.env.AGENT_CONNECTION_SECRET=old;});
function fixture(ask=async(question,key)=>({found:true,question,keyUsed:key})){
 const routes=new Map();const app={get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h)};
 let current=Date.now();const stop=registerUserAgentRoutes(app,ask,()=>current);
 const invoke=async(method,path,body={},ip='test')=>{
  const out={statusCode:200,headers:{},body:null,status(code){this.statusCode=code;return this;},set(k,v){this.headers[k]=v;return this;},json(data){this.body=data;return this;},type(v){this.headers['Content-Type']=v;return this;},send(data){this.body=data;return this;}};
  await routes.get(method+' '+path)({body,ip,socket:{}},out);return out;
 };
 return {invoke,stop,advance:ms=>{current+=ms;}};
}
const keyA='a'.repeat(40),keyB='b'.repeat(40);
async function connect(f,key=keyA){const r=await f.invoke('POST','/api/agent/session',{dartApiKey:key});assert.equal(r.statusCode,201);assert.equal(r.body.expiresAt,null);return r.body.sessionToken;}
const query=(f,t)=>f.invoke('POST','/api/agent/query',{sessionToken:t,question:'대한전선 매출액'});
test('암호화 비밀값이 없거나 짧으면 발급·조회 차단, health 설정 필요',async()=>{
 const f=fixture();for(const s of ['', 'short']){process.env.AGENT_CONNECTION_SECRET=s;assert.equal((await f.invoke('GET','/api/agent/health')).statusCode,503);assert.equal((await f.invoke('POST','/api/agent/session',{dartApiKey:keyA})).statusCode,503);assert.equal((await query(f,'bad')).statusCode,503);}
});
test('장기 연결 준비 상태, 운영자 DART 키·AGENT_API_KEY 불필요',async()=>{
 const f=fixture();const r=await f.invoke('GET','/api/agent/health');assert.equal(r.statusCode,200);assert.equal(r.body.mode,'user_dart_key_persistent');assert.equal(r.body.connectionExpires,false);assert.equal(r.body.operatorKeyRequired,false);
});
test('사용자별 키 분리 및 원본 키 미반환, 매 발급시 임의 IV',async()=>{
 const used=[];const f=fixture(async(q,k)=>{used.push(k);return {found:true};});
 const a=await connect(f),b=await connect(f,keyB),a2=await connect(f);assert.notEqual(a,a2);assert.match(a,/^dn1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{54}\.[A-Za-z0-9_-]{22}$/);assert.ok(!a.includes(keyA));
 await query(f,a);await query(f,b);await query(f,a2);assert.deepEqual(used,[keyA,keyB,keyA]);
});
test('10년 경과 후에도 같은 연결코드 사용',async()=>{const f=fixture();const t=await connect(f);f.advance(10*366*86400_000);assert.equal((await query(f,t)).statusCode,200);});
test('새 프로세스·다른 인스턴스에서 같은 비밀값이면 이전 코드 사용',async()=>{const old=fixture();const t=await connect(old);old.stop();const fresh=fixture();assert.equal((await query(fresh,t)).statusCode,200);});
test('서버 비밀값 변경 시 기존 코드 거부, 원래 값 복구시 사용',async()=>{const f=fixture();const t=await connect(f);process.env.AGENT_CONNECTION_SECRET='different-long-secret-0123456789abcdef';assert.equal((await query(f,t)).statusCode,401);process.env.AGENT_CONNECTION_SECRET=secret;assert.equal((await query(f,t)).statusCode,200);});
test('암호문·IV·태그 변조, 기존 1시간 토큰, 빈 토큰 모두 거부',async()=>{
 let called=0;const f=fixture(async()=>{called++;return {};});const t=await connect(f);
 const variants=['','a'.repeat(64),keyA,t+'extra'];for(const part of [0,1,2,3]){const p=t.split('.');p[part]=(p[part][0]==='A'?'B':'A')+p[part].slice(1);variants.push(p.join('.'));}
 for(const token of variants)assert.equal((await query(f,token)).statusCode,401);assert.equal(called,0);
});
test('운영자 환경변수로 사용자 코드 우회 불가',async()=>{const old=process.env.OPENDART_API_KEY;process.env.OPENDART_API_KEY=keyB;try{const f=fixture();assert.equal((await f.invoke('POST','/api/agent/query',{question:'매출액 조회',dartApiKey:keyA})).statusCode,401);}finally{if(old===undefined)delete process.env.OPENDART_API_KEY;else process.env.OPENDART_API_KEY=old;}});
test('잘못된 키와 질문 차단',async()=>{const f=fixture();for(const key of ['',123,'abc','DEMO'+'a'.repeat(36)])assert.equal((await f.invoke('POST','/api/agent/session',{dartApiKey:key})).statusCode,400);const t=await connect(f);for(const question of ['',null,'x'.repeat(301)])assert.equal((await f.invoke('POST','/api/agent/query',{sessionToken:t,question})).statusCode,400);});
test('실패시 원본 키를 오류 응답에 노출하지 않음',async()=>{const f=fixture(async()=>{throw new Error(keyA);});const t=await connect(f);const r=await query(f,t);assert.equal(r.statusCode,502);assert.ok(!JSON.stringify(r.body).includes(keyA));assert.equal(r.headers['Cache-Control'],'no-store');});
test('실제 폐기되지 않은 코드를 해제했다고 응답하지 않음',async()=>{const f=fixture();const t=await connect(f);const r=await f.invoke('POST','/api/agent/session/revoke',{sessionToken:t});assert.equal(r.statusCode,410);assert.equal(r.body.revoked,false);assert.equal((await query(f,t)).statusCode,200);});
test('연결창 스크립트 구문·저장소 미사용·기밀 캐시 금지',async()=>{const f=fixture();const r=await f.invoke('GET','/agent-connect');assert.equal(r.headers['Cache-Control'],'no-store');assert.match(r.headers['Content-Security-Policy'],/frame-ancestors 'none'/);assert.ok(!/localStorage|sessionStorage|\?dartApiKey/.test(r.body));assert.doesNotThrow(()=>new Function(r.body.match(/<script>([\s\S]*?)<\/script>/)[1]));assert.match(r.body,/만료 시간 없음/);});
test('발급 제한은 분당20회, 1분 후 재시도 가능',async()=>{const f=fixture();for(let i=0;i<20;i++)await connect(f);assert.equal((await f.invoke('POST','/api/agent/session',{dartApiKey:keyA})).statusCode,429);f.advance(60_001);await connect(f);});
test('조회 제한은 IP별 분당60회, 1분 후 재시도 가능',async()=>{const f=fixture();const t=await connect(f);for(let i=0;i<60;i++)assert.equal((await query(f,t)).statusCode,200);assert.equal((await query(f,t)).statusCode,429);f.advance(60_001);assert.equal((await query(f,t)).statusCode,200);});
