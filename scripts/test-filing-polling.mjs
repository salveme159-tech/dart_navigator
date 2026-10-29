// 추가 의존성 없이 조회 주기·화면 복귀·중복 요청·중단을 검증합니다.
import {test,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {startFilingPolling,FILING_POLL_MS} from '../client/src/lib/filingPolling.ts';
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
let timers,seq,stops=[];
const original={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,window:globalThis.window,document:globalThis.document};
beforeEach(()=>{
 timers=new Map();seq=0;
 globalThis.setTimeout=(fn,delay)=>{const id=++seq;timers.set(id,{fn,delay});return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 globalThis.window=new EventTarget();globalThis.document=new EventTarget();document.visibilityState='visible';
});
afterEach(()=>{stops.forEach(stop=>stop());stops=[];Object.assign(globalThis,original);});
const step=async()=>{const next=timers.entries().next().value;assert.ok(next);timers.delete(next[0]);next[1].fn();await flush();};
test('시작 시 즉시 조회하고 완료 후 15초 간격',async()=>{
 let count=0;stops.push(startFilingPolling(async()=>{count++;}));assert.equal(count,1);await flush();assert.equal([...timers.values()][0].delay,FILING_POLL_MS);await step();assert.equal(count,2);
});
test('백그라운드 주기는 60초, 화면 복귀 시 즉시 조회',async()=>{
 document.visibilityState='hidden';let count=0;stops.push(startFilingPolling(async()=>{count++;}));await flush();assert.equal([...timers.values()][0].delay,60000);
 document.visibilityState='visible';document.dispatchEvent(new Event('visibilitychange'));assert.equal(count,2);await flush();assert.equal([...timers.values()][0].delay,15000);
});
test('느린 요청은 focus·online 이벤트와 중첩되지 않음',async()=>{
 let count=0,resolve;stops.push(startFilingPolling(()=>{count++;return new Promise(r=>{resolve=r;});}));
 window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));assert.equal(count,1);assert.equal(timers.size,0);
 resolve();await flush();assert.equal([...timers.values()][0].delay,0);await step();assert.equal(count,2);
});
test('중단 시 요청 취소, 예약·이벤트 제거',async()=>{
 let signal,count=0;const stop=startFilingPolling(async s=>{signal=s;count++;});await flush();stop();assert.equal(signal.aborted,true);assert.equal(timers.size,0);window.dispatchEvent(new Event('focus'));assert.equal(count,1);
});
test('조회 실패 후에도 다음 주기 재시도',async()=>{
 let count=0;stops.push(startFilingPolling(async()=>{count++;throw new Error('simulated timeout');}));await flush();assert.equal(timers.size,1);await step();assert.equal(count,2);
});
