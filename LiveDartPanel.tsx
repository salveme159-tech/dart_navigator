import { metricSourceLinks } from "../lib/metricSources";
import { useState, useEffect } from "react";
import { Check, CircleHelp, FileText, RefreshCw, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { trpc } from "../lib/trpc";

function parseCitation(value: string) {
  const match = value.match(/\((https[^)]+)\)/);
  return { text: match ? value.replace(match[0], "").trim() : value, url: match?.[1] };
}

const metricLabel = (metric: string) => ({ revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익", operatingMargin: "영업이익률", netMargin: "순이익률", freeCashFlow: "FCF", borrowings: "차입금", borrowingsRatio: "차입금의존도", workingCapital: "운전자본", operatingCashFlow: "영업활동현금흐름", investmentCashFlow: "투자활동현금흐름", financingCashFlow: "재무활동현금흐름", capex: "CAPEX", netDebt: "순차입금", debtRatio: "부채비율", currentRatio: "유동비율", interestCoverage: "이자보상배율", roe: "ROE", roa: "ROA", eps: "EPS", ebitda: "EBITDA", per: "PER", pbr: "PBR" } as Record<string, string>)[metric] ?? metric;
const formatValue = (value: number, unit: string) => !Number.isFinite(value) ? "자료 없음" : unit === "%" ? `${value.toFixed(1)}%` : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;

function cleanDisclosureMessage(value: unknown, fallback = "공시 조회 결과를 확인할 수 없습니다.") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  if (/failed to fetch|networkerror|fetch failed|load failed/i.test(value)) {
    return "DART 조회 서버에 연결하지 못했습니다. 서버 실행 상태와 OpenDART 인증키를 확인한 뒤 다시 시도하세요.";
  }
  const cleaned = value
    .replace(/CFS\s*\(연결\)\s*공시가 없으면\s*OFS\s*\(별도\)를\s*확인합니다\.?/gi, "")
    .replace(/조회 실패와 실제 미공시를 구분(?:하며|합니다)[,，。]?/g, "")
    .replace(/실제 수치가 확보되지 않은 구간은 만들어 채우지 않습니다\.?/g, "")
    .trim();
  return cleaned || fallback;
}

export default function LiveDartPanel({ question, onStatusChange }: {
  question: string;
  onStatusChange?: (status: "idle" | "loading" | "live" | "not-found" | "error") => void;
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
  if (q.error) {
    return <div className="live-answer error"><CircleHelp size={17} /><div><strong>실시간 재무 조회 연결 실패</strong><p>{cleanDisclosureMessage(q.error.message, "DART 조회 중 오류가 발생했습니다. 서버 연결과 인증키를 확인한 뒤 다시 시도하세요.")}</p></div></div>;
  }
  const d = q.data;
  if (!d) return null;
  if (!d.found) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회할 수 없습니다</strong><p>{cleanDisclosureMessage(d.message)}</p></div></div>;
  const citation = parseCitation(d.citation);
  const citationRcept = citation.url?.match(/[?&](?:rcpNo|rcept_no)=(\d{14})/i)?.[1] ?? "";
  const isExternalFallback = (d as any).sourceType === "EXTERNAL_FALLBACK" || /네이버 금융|FnGuide|Yahoo Finance/i.test(citation.text);
  const reportUrl = isExternalFallback ? null : citationRcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${citationRcept}` : citation.url?.includes("dart.fss.or.kr") ? citation.url : null;
  const visibleLines = d.lines;
  return <section className="live-answer">
    <div className="live-answer-head"><div><span className="live-tag"><Check size={11} /> 조회 결과</span><h3>{d.metric} <em>{d.headline}</em></h3><p>{d.company} · {d.period} · {d.basis}</p></div></div>
    {d.notice && <div className="live-notice">{cleanDisclosureMessage(d.notice)}</div>}
    <div className="live-lines">{visibleLines.map((line: string) => <div key={line}><span>·</span>{line}</div>)}</div>
    {"series" in d && d.series?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>기준</th><th>값</th><th>상태·출처</th></tr></thead><tbody>{d.series.map((row: { year: number; period: string; mode: string; basis?: string; value: number | null; unit: string; found: boolean; message?: string; citation?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td>{row.basis ?? d.basis}</td><td className="series-value">{row.value === null ? "—" : formatValue(row.value, row.unit)}</td><td>{row.found ? <span className="series-ok">수치 확인</span> : <span className="series-missing">{cleanDisclosureMessage(row.message, "DART 자료 미확인")}</span>}{metricSourceLinks(row.citation).map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-emerald-700 underline">{link.label} ↗</a>)}</td></tr>)}</tbody></table></div> : null}
    {"matrix" in d && d.matrix?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>기준</th>{Object.keys(d.matrix[0].values).map((metric) => <th key={metric}>{metricLabel(metric)}</th>)}</tr></thead><tbody>{d.matrix.map((row: { year: number; period: string; mode: string; basis?: string; values: Record<string, number | null>; units: Record<string, string>; sources?:Record<string,string>; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td>{row.basis ?? d.basis}</td>{Object.keys(row.values).map((metric) => <td key={metric} className="series-value">{row.values[metric] === null ? "—" : formatValue(row.values[metric]!, row.units[metric])}{metricSourceLinks(row.sources?.[metric]).map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="block text-xs text-emerald-700 underline">{link.label} ↗</a>)}</td>)}</tr>)}</tbody></table></div> : null}
    {!reportUrl && metricSourceLinks(d.citation).map(link=><a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="mr-3 text-xs text-emerald-700 underline">{link.label} ↗</a>)}
    {reportUrl && <div className="live-citation"><FileText size={14} /><div><span>공시</span><strong>{citation.text}</strong></div><a href={reportUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 underline"><ExternalLink size={13} /> 공시 원문 열기</a></div>}
    {d.formula && <div className="mt-2"><button type="button" onClick={() => setShowCalculation((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">{showCalculation ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} 계산식 살펴보기</button>{showCalculation && <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm"><div className="font-bold text-slate-800">계산식</div><p className="mt-1 font-medium">{cleanDisclosureMessage(d.formula, "계산식을 확인할 수 없습니다.")}</p>{visibleLines.length > 0 && <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">{visibleLines.map((line: string, i: number) => <div key={`${i}-${line}`} className="text-slate-700">{line}</div>)}</div>}{d.disclaimer && <p className="mt-2 text-xs text-amber-800">{d.disclaimer}</p>}</div>}</div>}
    {"causeAnalysis" in d && d.causeAnalysis ? <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><strong>사업보고서 원문 근거 검색 · {d.causeAnalysis.status === "explicit-evidence" ? "직접 원인 문장 확인" : d.causeAnalysis.status === "related-context-only" ? "관련 설명만 확인" : "원인 입증 문장 미확인"}</strong><p className="mt-1 text-sm">{d.causeAnalysis.summary}</p>{d.causeAnalysis.evidence.map((e: {section:string;excerpt:string;explicitCause:boolean;reportPeriod:string;rceptNo:string}, i:number) => <blockquote key={`${e.rceptNo}-${i}`} className="mt-2 border-l-2 border-slate-300 pl-3 text-sm"><div className="mb-1 text-xs text-slate-500">{e.reportPeriod} · {e.section} · {e.explicitCause ? "원인 직접 명시" : "관련 문장"}</div>{e.excerpt}<div className="mt-1"><a href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${e.rceptNo}`} target="_blank" rel="noreferrer" className="text-emerald-700 underline">공시 원문 보기 (#{e.rceptNo})</a></div></blockquote>)}</div> : null}
    {"citations" in d && Array.isArray(d.citations) ? <div className="mt-2 flex flex-wrap gap-2">{d.citations.map((item: {reportName:string;rceptNo:string;url:string|null}, i:number) => <a key={`${item.rceptNo}-${i}`} href={item.url || `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rceptNo}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">{item.reportName} 공시 #{item.rceptNo}</a>)}</div> : null}
    {d.disclaimer && <div className="live-disclaimer">{cleanDisclosureMessage(d.disclaimer)}</div>}
  </section>;
}
