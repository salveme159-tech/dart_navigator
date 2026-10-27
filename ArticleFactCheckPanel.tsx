import React, {useRef, useState} from 'react';
import {apiUrl,apiBaseUrl} from '@/lib/apiBase';
import type {FactCheckInput,FactCheckResult} from '../../../shared/articleFactCheck';

export default function ArticleFactCheckPanel({apiKey,company,companies}:{apiKey:string;company:string;companies:string[]}) {
  const [article,setArticle]=useState('');
  const [target,setTarget]=useState(company==='DART 조회 대기'?'대한전선':company);
  const [year,setYear]=useState(new Date().getFullYear()-1);
  const [period,setPeriod]=useState<FactCheckInput['period']>('annual');
  const [mode,setMode]=useState<'cum'|'qtr'>('cum');
  const [basis,setBasis]=useState<'CFS'|'OFS'>('CFS');
  const [date,setDate]=useState(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
  const [receipt,setReceipt]=useState('');
  const [result,setResult]=useState<FactCheckResult|null>(null);
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  const inputClass='mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
  const invalidate=()=>{setResult(null);setReceipt('');};
  const check=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try {
      const input:FactCheckInput={article,company:target,year,period,mode,basis,articleDate:date,...(receipt?{contractReceipt:receipt}:{})};
      const response=await fetch(apiUrl('/api/trpc/dart.articleFactCheck'),{method:'POST',headers:{'Content-Type':'application/json','X-OpenDART-Key':apiKey},credentials:apiBaseUrl?'omit':'same-origin',body:JSON.stringify({json:input}),signal:AbortSignal.timeout(180_000),cache:'no-store'});
      const payload=await response.json();
      if(!response.ok || payload.error)throw new Error(payload?.error?.json?.message??payload?.error?.message??'기사 확인에 실패했습니다.');
      const data=payload?.result?.data?.json??payload?.result?.data;
      if(!data || !Array.isArray(data.claims))throw new Error('올바른 확인 결과를 받지 못했습니다.');
      setResult(data);
    }catch(e){setResult(null);setError(e instanceof Error?e.message:'확인에 실패했습니다.');}
    finally{lock.current=false;setBusy(false);}
  };
  const labels={MATCH:'일치',MISMATCH:'불일치',UNVERIFIED:'확인 필요'};
  const colors={MATCH:'bg-emerald-100 text-emerald-900',MISMATCH:'bg-rose-100 text-rose-900',UNVERIFIED:'bg-amber-100 text-amber-900'};
  const highlights=()=>{
    if(!result)return null;
    const nodes:React.ReactNode[]=[];let cursor=0;
    for(const c of result.claims){nodes.push(result.article.slice(cursor,c.start));nodes.push(<a key={c.id} href={`#fact-${c.id}`} title={`${labels[c.status]} · ${c.label} · 공시값 ${c.actualText}`} className={`rounded px-0.5 font-semibold ${colors[c.status]}`}>{result.article.slice(c.start,c.end)}</a>);cursor=c.end;}
    nodes.push(result.article.slice(cursor));return nodes;
  };
  return <section className="space-y-5">
    <div><h1 className="text-2xl font-extrabold">기사 팩트 체크</h1><p className="mt-2 text-sm text-slate-500">기사 원문을 붙여 넣으면 수치를 DART API와 공시 원문으로 대조합니다. 불일치한 수치와 실제 공시값, 근거를 함께 확인하세요.</p></div>
    <div className="rounded-2xl border bg-white p-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs font-semibold">기준 기업<input aria-label="기준 기업" list="fact-companies" value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);invalidate();}} className={inputClass}/><datalist id="fact-companies">{companies.map(c=><option key={c} value={c}/>)}</datalist></label>
        <label className="text-xs font-semibold">기사 기준일<input aria-label="기사 기준일" type="date" value={date} disabled={busy} onChange={e=>{setDate(e.target.value);invalidate();}} className={inputClass}/></label>
        <label className="text-xs font-semibold">기본 사업연도<input aria-label="기본 사업연도" type="number" min={2015} max={2100} value={year} disabled={busy} onChange={e=>{setYear(Number(e.target.value));invalidate();}} className={inputClass}/></label>
        <label className="text-xs font-semibold">기본 기간<select aria-label="기본 기간" value={period} disabled={busy} onChange={e=>{setPeriod(e.target.value as FactCheckInput['period']);invalidate();}} className={inputClass}><option value="annual">연간</option><option value="q1">1분기</option><option value="half">상반기 / 2분기</option><option value="q3">3분기</option></select></label>
        <label className="text-xs font-semibold">손익 집계<select aria-label="손익 집계" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as 'cum'|'qtr');invalidate();}} className={inputClass}><option value="cum">누계</option><option value="qtr">당분기</option></select></label>
        <label className="text-xs font-semibold">기본 회계 기준<select aria-label="기본 회계 기준" value={basis} disabled={busy} onChange={e=>{setBasis(e.target.value as 'CFS'|'OFS');invalidate();}} className={inputClass}><option value="CFS">연결</option><option value="OFS">별도</option></select></label>
      </div>
      <p className="text-xs text-slate-500">기사에 기업·연도·기간·연결/별도 기준이 명시되면 우선 적용합니다. 생략된 기준은 위 설정을 사용하므로 확인해 주세요. 전망·추정치와 전압·거리 등은 확인 필요로 표시합니다.</p>
      <textarea aria-label="기사 원문" value={article} maxLength={30000} disabled={busy} onChange={e=>{setArticle(e.target.value);invalidate();}} rows={11} placeholder="제목과 기사 원문을 입력하세요. 예: 대한전선의 2025년 연결 매출액은 3조 6,360억원, 영업이익은 1,286억원이다." className="w-full rounded-xl border border-slate-200 p-4 text-sm leading-7"/>
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-400">{article.length.toLocaleString()} / 30,000자 · 최대 100개 수치</span><button type="button" disabled={busy||!apiKey||article.trim().length<10||!target.trim()||!date||year<2015||year>2100} onClick={()=>void check()} className="rounded-xl bg-emerald-800 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{busy?'API·공시 원문 대조 중…':'기사 팩트 체크'}</button></div>
      {busy&&<p role="status" className="text-xs text-slate-500">여러 기간·계약 원문을 확인하면 시간이 걸릴 수 있습니다.</p>}
      {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    </div>
    {result&&<>
      <div role="status" className="flex flex-wrap gap-3 text-sm font-bold"><span className="rounded-xl bg-rose-50 px-4 py-3 text-rose-700">불일치 {result.summary.mismatched}건</span><span className="rounded-xl bg-emerald-50 px-4 py-3 text-emerald-700">일치 {result.summary.matched}건</span><span className="rounded-xl bg-amber-50 px-4 py-3 text-amber-800">확인 필요 {result.summary.unverified}건</span><span className="self-center text-xs font-normal text-slate-500">{new Date(result.checkedAt).toLocaleString('ko-KR')} 확인</span></div>
      {result.contractCandidates.length>0&&<div className="rounded-2xl border bg-white p-4"><label className="text-sm font-bold">계약 공시 선택<select aria-label="계약 공시 선택" value={receipt} disabled={busy} onChange={e=>setReceipt(e.target.value)} className={inputClass}><option value="">자동 식별(지역·전압이 유일하게 일치할 때)</option>{result.contractCandidates.map(c=><option key={c.rceptNo} value={c.rceptNo}>{c.company} · {c.receiptDate} · {c.reportName} · {c.rceptNo}</option>)}</select></label><p className="mt-2 text-xs text-slate-500">사업이 여러 개라면 해당 공시를 선택하고 ‘기사 팩트 체크’를 다시 실행하세요. 기준일 이전 90일 공시를 조회합니다.</p></div>}
      {result.warnings.map((w,i)=><p key={i} className="text-xs text-amber-800">{w}</p>)}
      <div className="rounded-2xl border bg-white p-5"><h2 className="mb-4 font-bold">원문 수치 표시</h2><p className="whitespace-pre-wrap text-sm leading-8">{highlights()}</p></div>
      {!result.claims.length&&<p className="text-sm text-slate-500">금액·백분율·전압·거리 등 확인할 수치를 찾지 못했습니다.</p>}
      <div className="space-y-3">{result.claims.map(c=><article key={c.id} id={`fact-${c.id}`} className="scroll-mt-6 rounded-2xl border bg-white p-5 space-y-2"><div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-1 text-xs font-bold ${colors[c.status]}`}>{labels[c.status]}</span><h3 className="text-sm font-bold">{c.id}. {c.company} · {c.label}</h3></div><p className="text-xs text-slate-500">{c.basisLabel}</p><p className="text-sm">기사: <strong className={c.status==='MISMATCH'?'text-rose-700':''}>{c.text}</strong> → 공시값: <strong>{c.actualText}</strong></p><p className="text-xs leading-5 text-slate-600">{c.message}</p>{c.sourceUrl&&<a href={c.sourceUrl} target="_blank" rel="noreferrer" className="block break-words text-xs leading-5 text-emerald-700 underline">{c.sourceLabel} · 공시 원문 ↗</a>}</article>)}</div>
    </>}
  </section>;
}
