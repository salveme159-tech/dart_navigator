import { BookOpen, Calculator, Check, CircleHelp, Download, FileSpreadsheet, FileText, RefreshCw } from "lucide-react";
import { trpc } from "../lib/trpc";
import { getStoredDartKey } from "../lib/dartKey";
import { buildAnalysisXlsx } from "../lib/xlsxExport";

function parseCitation(value: string) {
  const match = value.match(/\((https[^)]+)\)/);
  return { text: match ? value.replace(match[0], "").trim() : value, url: match?.[1] };
}

const metricLabel = (metric: string) => ({ revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익", operatingMargin: "영업이익률", operatingCashFlow: "영업활동현금흐름", investmentCashFlow: "투자활동현금흐름", financingCashFlow: "재무활동현금흐름", capex: "CAPEX", freeCashFlow: "FCF", netWorkingCapital: "순운전자본", assetTurnover: "자산회전율", netDebt: "순차입금", debtRatio: "부채비율", currentRatio: "유동비율", interestCoverage: "이자보상배율", roe: "ROE", roa: "ROA", eps: "EPS", ebitda: "EBITDA", per: "PER", pbr: "PBR" } as Record<string, string>)[metric] ?? metric;
const formatValue = (value: number, unit: string) => unit === "%" ? `${value.toFixed(1)}%` : `${Math.round(value).toLocaleString("ko-KR")}${unit}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[m]!));

function escapeXml(value: string) {
  return value.replace(/[&<>"\']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\'": "&apos;" }[m]!));
}

function downloadExcel(data: any) {
  const bytes = buildAnalysisXlsx(data);
  const blob = new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `DisclosureNavigator_${String(data.company ?? "result").replace(/\s+/g, "_")}.xlsx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadPdf(data: any) {
  const win = window.open("", "_blank"); if (!win) return;
  const lines = (data.lines ?? []).map((x: string) => `<li>${escapeXml(x)}</li>`).join("");
  win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Disclosure Navigator</title><style>@page{size:A4;margin:16mm}body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;color:#111827;max-width:820px;margin:auto;padding:20px}h1{font-size:28px}.meta{color:#6b7280;font-size:13px}.value{font-size:34px;font-weight:700;margin:20px 0}.box{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0}li{margin:5px 0}@media print{button{display:none}}</style></head><body><div class="meta">DISCLOSURE NAVIGATOR</div><h1>${escapeXml(data.metric ?? "분석 결과")}</h1><div class="meta">${escapeXml(data.company ?? "")} · ${escapeXml(data.period ?? "")} · ${escapeXml(data.basis ?? "")}</div><div class="value">${escapeXml(data.headline ?? "")}</div><div class="box"><b>계산식</b><p>${escapeXml(data.formula ?? "원천 공시값")}</p></div><div class="box"><b>계산 과정</b><ul>${lines}</ul></div><div class="box"><b>출처</b><p>${escapeXml(data.citation ?? "")}</p></div></body></html>`);
  win.document.close(); win.focus(); setTimeout(() => win.print(), 250);
}

export default function LiveDartPanel({ question }: { question: string }) {
  const live = Boolean(getStoredDartKey());
  const DEMO_FIXTURES: Record<string, any> = {
    "대한전선 2026년 반기 매출액": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "매출액", metricId: "revenue", valueKind: "reported", headline: "22,820억원", displayText: "22,820억원", value: 22820.29, unit: "억원", lines: ["원천 공시값: 매출액", "당기누적금액: 22,820억 2,900만원", "2026년 상반기 누적(1~6월)"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액" },
    "대한전선 2026년 반기 영업이익": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익", metricId: "operatingProfit", valueKind: "reported", headline: "1,213억원", displayText: "1,213억원", value: 1212.53, unit: "억원", lines: ["원천 공시값: 영업이익", "당기누적금액: 1,212억 5,300만원", "2026년 상반기 누적(1~6월)"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 영업이익" },
    "대한전선 2026년 반기 영업이익률": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익률", metricId: "operatingMargin", valueKind: "calculated", headline: "5.3%", displayText: "5.3%", value: 5.313385588000854, unit: "%", lines: ["영업이익 1,213억원 ÷ 매출액 22,820억원", "산식에 사용된 원자료는 동일 fixture의 누적값"], formula: "영업이익률 = 영업이익 ÷ 매출액 × 100", citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익", calcInputs: [{label:"영업이익",account:"영업이익",value:1212.53,sign:"+"},{label:"매출액",account:"매출액",value:22820.29,sign:"/"}] },
    "대한전선 2026년 반기 매출과 영업이익": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "매출액 · 영업이익", metricId: "comparison", valueKind: "reported", headline: "22,820억원 / 1,213억원", displayText: "22,820억원 / 1,213억원", value: null, unit: "억원", lines: ["매출액 22,820억 2,900만원", "영업이익 1,212억 5,300만원", "두 값 모두 반기 누적값"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익" },
    "대한전선 2026년 상반기 영업이익률": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익률", metricId: "operatingMargin", valueKind: "calculated", headline: "5.3%", displayText: "5.3%", value: 5.313385588000854, unit: "%", lines: ["영업이익 1,213억원 ÷ 매출액 22,820억원", "2026년 상반기 누적(1~6월)"], formula: "영업이익률 = 영업이익 ÷ 매출액 × 100", citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익", calcInputs: [{label:"영업이익",account:"영업이익",value:1212.53,sign:"+"},{label:"매출액",account:"매출액",value:22820.29,sign:"/"}] },
    "대한전선 2026년 반기 순차입금": { found: false, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적", basis: "연결 기준", metric: "순차입금", metricId: "netDebt", valueKind: "calculated", message: "체험 모드에서는 순차입금 계정군과 완전성 검증을 라이브로 재현하지 않습니다. 실시간 연결에서 본인 OpenDART 인증키로 조회하세요." }
  };
  const normalizedQuestion = question.replace(/[?？]/g, "").replace(/\s+/g, " ").trim();
  const demoAnswer = DEMO_FIXTURES[normalizedQuestion] ?? null;
  const q = trpc.dart.ask.useQuery({ question }, { enabled: live && question.trim().length >= 2, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const d = live ? q.data : demoAnswer;
  const evidence = trpc.dart.evidence.useQuery({ rceptNo: d?.rceptNo ?? "00000000000000", heading: d?.sourceHeading ?? "재무제표" }, { enabled: Boolean(d?.rceptNo), retry: false, staleTime: 60 * 60 * 1000 });
  if (!live && !d) return <section className="live-answer"><div className="live-notice">체험 모드는 사전 저장된 대표 질문만 재생합니다. 다른 기업이나 기간을 조회하려면 상단의 <b>실시간 연결</b>에서 본인 인증키를 입력하세요.</div></section>;
  if (live && q.isLoading) return <div className="live-answer loading"><RefreshCw size={15} className="spin" /><span>OpenDART에서 최신 공시를 확인하고 있습니다…</span></div>;
  if (live && q.error) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회 오류</strong><p>{q.error.message}</p></div></div>;
  if (!d) return null;
  if (d.found === false) return <section className="live-answer error"><div className="live-answer-head"><div><span className="live-tag"><CircleHelp size={11} /> {d.demo ? "DEMO SNAPSHOT · CORRECT REFUSAL" : "QUERY NOT AVAILABLE"}</span><h3>{d.metric ?? "조회 결과"}</h3><p>{d.company ?? ""} · {d.period ?? ""} · {d.basis ?? ""}</p></div></div><div className="live-notice"><strong>계산하지 않았습니다.</strong><p>{d.message ?? "필수 자료가 없거나 현재 지원하지 않는 지표입니다."}</p></div></section>;
  const derived = d.valueKind === "calculated" || Boolean(d.formula);
  return <section className="live-answer">
    <div className="live-answer-head"><div><span className="live-tag"><Check size={11} /> {d.demo ? "DEMO SNAPSHOT · PRELOADED" : "LIVE DART · SOURCE FOUND"}</span><h3>{d.metric} <em>{d.headline}</em></h3><p>{d.company} · {d.period} · {d.basis}</p></div><div className="live-actions"><button className="ghost-button" onClick={() => downloadPdf(d)}><Download size={13} /> PDF</button><button className="ghost-button" onClick={() => downloadExcel(d)}><FileSpreadsheet size={13} /> Excel</button><Calculator size={20} className="live-icon" /></div></div>
    {d.notice && <div className="live-notice">{d.notice}</div>}
    {d.demo && <div className="live-notice">시연 모드: 사전 저장된 fixture를 재생합니다. 이 결과는 실시간 API 호출 결과가 아닙니다.</div>}
    <div className="verification-strip"><span>✓ 기준: {d.basis}</span><span>✓ 기간: {d.period}</span><span>{d.demo ? "✓ 저장된 시연 fixture" : "✓ 원문 근거 확보"}</span></div>
    <div className="live-lines">{d.lines.map((line: string) => <div key={line}><span>·</span>{line}</div>)}</div>
    {Array.isArray(d.series) && d.series.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>값</th><th>상태</th></tr></thead><tbody>{d.series.map((row: { year: number; period: string; mode: string; value: number | null; unit: string; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td className="series-value">{row.value === null ? "—" : formatValue(row.value, row.unit)}</td><td>{row.found ? <span className="series-ok">확인됨</span> : <span className="series-missing">{row.message ?? "미확인"}</span>}</td></tr>)}</tbody></table></div> : null}
    {Array.isArray(d.matrix) && d.matrix.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th>{Object.keys(d.matrix[0].values).map((metric) => <th key={metric}>{metricLabel(metric)}</th>)}</tr></thead><tbody>{d.matrix.map((row: { year: number; period: string; mode: string; values: Record<string, number | null>; units: Record<string, string>; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td>{Object.keys(row.values).map((metric) => <td key={metric} className="series-value">{row.values[metric] === null ? "—" : formatValue(row.values[metric]!, row.units[metric])}</td>)}</tr>)}</tbody></table></div> : null}
    {d.formula && <div className="live-formula"><span>{derived ? "계산식" : "출처"}</span><strong>{d.formula}</strong></div>}
    {d.rceptNo && <div className="source-footer"><BookOpen size={15} /><span>{parseCitation(d.citation).text}</span>{(!d.demo && evidence.data?.viewerUrl) ? <a href={evidence.data.viewerUrl} target="_blank" rel="noreferrer">해당 문서 위치 ↗</a> : parseCitation(d.citation).url ? <a href={parseCitation(d.citation).url} target="_blank" rel="noreferrer">DART 원문 ↗</a> : null}</div>}
  </section>;
}
