import { useState, useEffect } from "react";
import { BookOpen, Check, CircleHelp, FileText, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "../lib/trpc";

function parseCitation(value: string) {
  const match = value.match(/\((https[^)]+)\)/);
  return { text: match ? value.replace(match[0], "").trim() : value, url: match?.[1] };
}

const metricLabel = (metric: string) => ({ revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익", operatingMargin: "영업이익률", netMargin: "순이익률", freeCashFlow: "FCF", borrowings: "차입금", borrowingsRatio: "차입금의존도", workingCapital: "운전자본", operatingCashFlow: "영업활동현금흐름", investmentCashFlow: "투자활동현금흐름", financingCashFlow: "재무활동현금흐름", capex: "CAPEX", netDebt: "순차입금", debtRatio: "부채비율", currentRatio: "유동비율", interestCoverage: "이자보상배율", roe: "ROE", roa: "ROA", eps: "EPS", ebitda: "EBITDA", per: "PER", pbr: "PBR" } as Record<string, string>)[metric] ?? metric;
const formatValue = (value: number, unit: string) => !Number.isFinite(value) ? "자료 없음" : unit === "%" ? `${value.toFixed(1)}%` : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;

export default function LiveDartPanel({ question, onStatusChange, onOpenSource }: {
  question: string;
  onStatusChange?: (status: "idle" | "loading" | "live" | "not-found" | "error") => void;
  onOpenSource?: (term: string, rceptNo: string, basis: "CFS" | "OFS") => void;
}) {
  const [showCalculation, setShowCalculation] = useState(false);
  const q = trpc.dart.ask.useQuery(
    { question },
    { enabled: question.trim().length >= 2, retry: false, staleTime: 0, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    const status = q.isLoading ? "loading" : q.error ? "error" : q.data ? (q.data.found ? "live" : "not-found") : "idle";
    onStatusChange?.(status);
  }, [q.isLoading, q.error, q.data, onStatusChange]);
  if (q.isLoading) return <div className="live-answer loading"><RefreshCw size={15} className="spin" /><span>OpenDART에서 최신 공시를 확인하고 있습니다…</span></div>;
  if (q.error) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>실시간 재무 조회 연결 실패</strong><p>{q.error.message}</p><p>GitHub Pages 정적 화면에는 DART 조회 서버가 포함되지 않습니다. 서버를 실행하고 인증키를 저장한 뒤 다시 조회하거나, 서버 API를 호스팅해야 연도·기간·비교 질의를 처리할 수 있습니다.</p></div></div>;
  const d = q.data;
  if (!d) return null;
  if (!d.found) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회할 수 없습니다</strong><p>{d.message}</p></div></div>;
  const citation = parseCitation(d.citation);
  const citationRcept = citation.url?.match(/[?&](?:rcpNo|rcept_no)=(\d{14})/i)?.[1] ?? "";
  const sourceBasis: "CFS" | "OFS" = /별도|개별/.test(String(d.basis ?? "")) ? "OFS" : "CFS";
  const openSource = (term: string, rceptNo: string) => {
    if (onOpenSource && /^\d{14}$/.test(rceptNo)) onOpenSource(term, rceptNo, sourceBasis);
  };
  return <section className="live-answer">
    <div className="live-answer-head"><div><span className="live-tag"><Check size={11} /> LIVE DART</span><h3>{d.metric} <em>{d.headline}</em></h3><p>{d.company} · {d.period} · {d.basis}</p></div></div>
    {d.notice && <div className="live-notice">{d.notice}</div>}
    <div className="live-lines">{d.lines.map((line: string) => <div key={line}><span>·</span>{line}</div>)}</div>
    {"series" in d && d.series?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>기준</th><th>값</th><th>상태</th></tr></thead><tbody>{d.series.map((row: { year: number; period: string; mode: string; basis?: string; value: number | null; unit: string; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td>{row.basis ?? d.basis}</td><td className="series-value">{row.value === null ? "—" : formatValue(row.value, row.unit)}</td><td>{row.found ? <span className="series-ok">확인됨</span> : <span className="series-missing">{row.message ?? "미확인"}</span>}</td></tr>)}</tbody></table></div> : null}
    {"matrix" in d && d.matrix?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>기준</th>{Object.keys(d.matrix[0].values).map((metric) => <th key={metric}>{metricLabel(metric)}</th>)}</tr></thead><tbody>{d.matrix.map((row: { year: number; period: string; mode: string; basis?: string; values: Record<string, number | null>; units: Record<string, string>; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td>{row.basis ?? d.basis}</td>{Object.keys(row.values).map((metric) => <td key={metric} className="series-value">{row.values[metric] === null ? "—" : formatValue(row.values[metric]!, row.units[metric])}</td>)}</tr>)}</tbody></table></div> : null}
    <div className="live-citation"><FileText size={14} /><div><span>출처</span><strong>{citation.text}</strong></div>{citationRcept && onOpenSource ? <button type="button" onClick={() => openSource(d.metric, citationRcept)} className="inline-flex items-center gap-1 text-emerald-700 underline"><BookOpen size={13} /> 재무제표 본문</button> : <span className="text-xs text-slate-500">접수번호 또는 본문 위치 확인 필요</span>}</div>
    {d.formula && <div className="mt-2"><button type="button" onClick={() => setShowCalculation((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{showCalculation ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} 계산식 살펴보기</button>{showCalculation && <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm"><div className="font-bold text-slate-800">계산식</div><p className="mt-1 font-medium">{d.formula}</p>{Array.isArray(d.lines) && d.lines.length > 0 && <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">{d.lines.map((line: string, i: number) => <div key={`${i}-${line}`} className="text-slate-700">{line}</div>)}</div>}{d.disclaimer && <p className="mt-2 text-xs text-amber-800">{d.disclaimer}</p>}</div>}</div>}
    {"causeAnalysis" in d && d.causeAnalysis ? <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><strong>사업보고서 원문 근거 검색 · {d.causeAnalysis.status === "explicit-evidence" ? "직접 원인 문장 확인" : d.causeAnalysis.status === "related-context-only" ? "관련 설명만 확인" : "원인 입증 문장 미확인"}</strong><p className="mt-1 text-sm">{d.causeAnalysis.summary}</p>{d.causeAnalysis.evidence.map((e: {section:string;excerpt:string;explicitCause:boolean;reportPeriod:string;rceptNo:string}, i:number) => <blockquote key={`${e.rceptNo}-${i}`} className="mt-2 border-l-2 border-slate-300 pl-3 text-sm"><div className="mb-1 text-xs text-slate-500">{e.reportPeriod} · {e.section} · {e.explicitCause ? "원인 직접 명시" : "관련 문장"}</div>{e.excerpt}<div className="mt-1"><button type="button" className="text-emerald-700 underline" onClick={() => openSource(d.metric, e.rceptNo)}>근거 재무제표 본문 보기 (#{e.rceptNo})</button></div></blockquote>)}</div> : null}
    {"citations" in d && Array.isArray(d.citations) ? <div className="mt-2 flex flex-wrap gap-2">{d.citations.map((item: {reportName:string;rceptNo:string;url:string|null}, i:number) => <button key={`${item.rceptNo}-${i}`} type="button" onClick={() => openSource(d.metric, item.rceptNo)} disabled={!/^\d{14}$/.test(item.rceptNo)} className="text-xs text-emerald-700 underline disabled:text-slate-400">{item.reportName} 본문 #{item.rceptNo}</button>)}</div> : null}
    {d.disclaimer && <div className="live-disclaimer">{d.disclaimer}</div>}
  </section>;
}
