import { BookOpen, Calculator, Check, CircleHelp, FileText, RefreshCw } from "lucide-react";
import { trpc } from "../lib/trpc";

function parseCitation(value: string) {
  const match = value.match(/\((https[^)]+)\)/);
  return { text: match ? value.replace(match[0], "").trim() : value, url: match?.[1] };
}

const metricLabel = (metric: string) => ({ revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익", operatingMargin: "영업이익률", operatingCashFlow: "영업활동현금흐름", investmentCashFlow: "투자활동현금흐름", financingCashFlow: "재무활동현금흐름", capex: "CAPEX", netDebt: "순차입금", debtRatio: "부채비율", currentRatio: "유동비율", interestCoverage: "이자보상배율", roe: "ROE", roa: "ROA", eps: "EPS", ebitda: "EBITDA", per: "PER", pbr: "PBR" } as Record<string, string>)[metric] ?? metric;
const formatValue = (value: number, unit: string) => unit === "%" ? `${value.toFixed(1)}%` : `${Math.round(value).toLocaleString("ko-KR")}${unit}`;

export default function LiveDartPanel({ question }: { question: string }) {
  const q = trpc.dart.ask.useQuery(
    { question },
    { enabled: question.trim().length >= 2, retry: false, staleTime: 0, refetchOnWindowFocus: false },
  );
  if (q.isLoading) return <div className="live-answer loading"><RefreshCw size={15} className="spin" /><span>OpenDART에서 최신 공시를 확인하고 있습니다…</span></div>;
  if (q.error) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회 오류</strong><p>{q.error.message}</p></div></div>;
  const d = q.data;
  if (!d) return null;
  if (!d.found) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회할 수 없습니다</strong><p>{d.message}</p></div></div>;
  const citation = parseCitation(d.citation);
  return <section className="live-answer">
    <div className="live-answer-head"><div><span className="live-tag"><Check size={11} /> LIVE DART</span><h3>{d.metric} <em>{d.headline}</em></h3><p>{d.company} · {d.period} · {d.basis}</p></div><Calculator size={20} className="live-icon" /></div>
    {d.notice && <div className="live-notice">{d.notice}</div>}
    <div className="live-lines">{d.lines.map((line: string) => <div key={line}><span>·</span>{line}</div>)}</div>
    {"series" in d && d.series?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>값</th><th>상태</th></tr></thead><tbody>{d.series.map((row: { year: number; period: string; mode: string; value: number | null; unit: string; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td className="series-value">{row.value === null ? "—" : formatValue(row.value, row.unit)}</td><td>{row.found ? <span className="series-ok">확인됨</span> : <span className="series-missing">{row.message ?? "미확인"}</span>}</td></tr>)}</tbody></table></div> : null}
    {"matrix" in d && d.matrix?.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th>{Object.keys(d.matrix[0].values).map((metric) => <th key={metric}>{metricLabel(metric)}</th>)}</tr></thead><tbody>{d.matrix.map((row: { year: number; period: string; mode: string; values: Record<string, number | null>; units: Record<string, string>; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td>{Object.keys(row.values).map((metric) => <td key={metric} className="series-value">{row.values[metric] === null ? "—" : formatValue(row.values[metric]!, row.units[metric])}</td>)}</tr>)}</tbody></table></div> : null}
    {d.formula && <div className="live-formula"><div><Calculator size={14} /><span>계산식</span></div><strong>{d.formula}</strong></div>}
    <div className="live-citation"><FileText size={14} /><div><span>출처</span><strong>{citation.text}</strong></div>{citation.url && <a href={citation.url} target="_blank" rel="noreferrer"><BookOpen size={13} /> 원문</a>}</div>
    {d.disclaimer && <div className="live-disclaimer">{d.disclaimer}</div>}
  </section>;
}
