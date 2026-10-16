import { BookOpen, Check, CircleHelp, Download, FileSpreadsheet, RefreshCw, FileText } from "lucide-react";
import { trpc } from "../lib/trpc";
import { getStoredDartKey } from "../lib/dartKey";
import { buildAnalysisXlsx } from "../lib/xlsxExport";
import { verifyFinancialAnswer } from "../lib/financialVerification";

function parseCitation(value: string) {
  const match = value.match(/\((https[^)]+)\)/);
  return { text: match ? value.replace(match[0], "").trim() : value, url: match?.[1] };
}

const metricLabel = (metric: string) => ({ revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익", operatingMargin: "영업이익률", operatingCashFlow: "영업활동현금흐름", investmentCashFlow: "투자활동현금흐름", financingCashFlow: "재무활동현금흐름", capex: "CAPEX", freeCashFlow: "FCF", workingCapital: "운전자본", debt: "차입금", netWorkingCapital: "운전자본", netDebt: "차입금", debtRatio: "부채비율", debtDependency: "차입금 의존도", currentRatio: "유동비율", assetTurnover: "자산회전율", ebitda: "EBITDA", currentAssets: "유동자산", cash: "현금및현금성자산", shortTermFinancial: "단기금융상품", receivables: "매출채권", inventory: "재고자산", payables: "매입채무", totalAssets: "자산총계", totalLiabilities: "부채총계", totalEquity: "자본총계", financialCost: "금융원가" } as Record<string, string>)[metric] ?? metric;
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
  const tableFromMatrix = Array.isArray(data.matrix) && data.matrix.length ? (() => {
    const keys = Object.keys(data.matrix[0].values ?? {});
    return `<table><thead><tr><th>연도</th><th>보고서</th>${keys.map((k: string) => `<th>${escapeXml(metricLabel(k))}</th>`).join("")}</tr></thead><tbody>${data.matrix.map((row: any) => `<tr><td>${row.year}</td><td>${escapeXml(`${row.period} · ${row.mode}`)}</td>${keys.map((k: string) => `<td class="num">${row.values?.[k] == null ? "—" : escapeXml(formatValue(row.values[k], row.units?.[k] ?? "억원"))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  })() : "";
  const tableFromSeries = !tableFromMatrix && Array.isArray(data.series) && data.series.length ? `<table><thead><tr><th>연도</th><th>보고서</th><th>값</th><th>상태</th></tr></thead><tbody>${data.series.map((row: any) => `<tr><td>${row.year}</td><td>${escapeXml(`${row.period} · ${row.mode}`)}</td><td class="num">${row.value == null ? "—" : escapeXml(formatValue(row.value, row.unit))}</td><td>${row.found ? "확인됨" : escapeXml(row.message ?? "미확인")}</td></tr>`).join("")}</tbody></table>` : "";
  const resultTable = tableFromMatrix || tableFromSeries || `<table><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>결과</td><td class="num">${escapeXml(data.headline ?? "—")}</td></tr><tr><td>보고기간</td><td>${escapeXml(data.period ?? "—")}</td></tr><tr><td>기준</td><td>${escapeXml(data.basis ?? "—")}</td></tr></tbody></table>`;
  win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>DART 분석 결과</title><style>@page{size:A4 landscape;margin:14mm}body{font-family:-apple-system,BlinkMacSystemFont,'Noto Sans KR',sans-serif;color:#111827;max-width:1040px;margin:auto;padding:16px}h1{font-size:28px;margin:10px 0}.meta{color:#6b7280;font-size:13px}.value{font-size:32px;font-weight:700;margin:16px 0}.box{border:1px solid #e5e7eb;border-radius:12px;padding:15px;margin:12px 0}li{margin:5px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #e5e7eb;padding:8px 9px;text-align:left}th{background:#f5f7f8}td.num{text-align:right;white-space:nowrap}@media print{button{display:none}}</style></head><body><div class="meta">DART</div><h1>${escapeXml(data.metric ?? "분석 결과")}</h1><div class="meta">${escapeXml(data.company ?? "")} · ${escapeXml(data.period ?? "")} · ${escapeXml(data.basis ?? "")}</div><div class="value">${escapeXml(data.headline ?? "")}</div><div class="box"><b>결과 표</b>${resultTable}</div><div class="box"><b>계산식</b><p>${escapeXml(data.formula ?? "원천 공시값")}</p></div><div class="box"><b>계산 과정</b><ul>${lines}</ul></div><div class="box"><b>출처</b><p>${escapeXml(data.citation ?? "")}</p></div></body></html>`);
  win.document.close(); win.focus(); setTimeout(() => win.print(), 250);
}


function makeOnePager(data: any) {
  const win = window.open("", "_blank");
  if (!win) return;
  const rows: Array<{ label: string; value: number; unit: string }> = [];
  if (Array.isArray(data.series)) for (const r of data.series) if (typeof r.value === "number" && Number.isFinite(r.value)) rows.push({label: String(r.period ?? r.year), value:r.value, unit:r.unit ?? "억원"});
  if (!rows.length && typeof data.value === "number" && Number.isFinite(data.value)) rows.push({label:String(data.period ?? "현재"), value:data.value, unit:data.unit ?? "억원"});
  const max = Math.max(1, ...rows.map(r => Math.abs(r.value)));
  const chart = rows.slice(-10).map((r, i) => {
    const h = Math.max(2, Math.round(Math.abs(r.value)/max*110));
    return `<div class="bar-col"><div class="bar" style="height:${h}px;background:${r.value<0?'#b94b4b':'#366a80'}"></div><small>${escapeHtml(r.label)}</small></div>`;
  }).join("");
  let interpretation = "확인된 공시 수치와 계산 결과를 제시합니다. 수치만으로 사업 원인이나 전망을 확정할 수 없습니다.";
  if (rows.length >= 2) {
    const a=rows[rows.length-2], b=rows[rows.length-1];
    const delta=b.value-a.value;
    interpretation = `${escapeHtml(a.label)} 대비 ${escapeHtml(b.label)}의 ${escapeHtml(data.metric ?? '지표')}는 ${delta>0?'증가':delta<0?'감소':'변동 없음'}했습니다. 비교 차이는 ${escapeHtml(formatValue(Math.abs(delta),b.unit))}입니다. 동일 기준·동일 기간 유형인지 확인한 후 해석해야 합니다. 변화의 원인은 이 자료만으로 단정하지 않습니다.`;
  }
  const items = rows.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(formatValue(r.value,r.unit))}</td></tr>`).join("");
  const src = escapeHtml(String(data.citation ?? "출처 정보 없음"));
  win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>재무분석 1Paper</title><style>@page{size:A4;margin:15mm}body{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:#17212b;padding:8px}h1{font-size:24px;margin:0 0 8px}.sub{color:#64748b;font-size:12px}.kpi{font-size:29px;font-weight:750;margin:22px 0}.section{border-top:2px solid #1e293b;padding-top:12px;margin-top:22px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}.bars{display:flex;align-items:flex-end;gap:12px;height:150px;border-bottom:1px solid #aaa;margin-top:12px}.bar-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1;height:100%;font-size:9px}.bar{width:60%;min-height:2px}.bar-col small{height:25px;overflow:hidden}.foot{font-size:10px;color:#64748b;overflow-wrap:anywhere}p{line-height:1.65}</style></head><body><h1>재무분석 1Paper</h1><div class="sub">${escapeHtml(String(data.company ?? ''))} · ${escapeHtml(String(data.period ?? ''))} · ${escapeHtml(String(data.basis ?? ''))}</div><div class="kpi">${escapeHtml(String(data.metric ?? ''))}　${escapeHtml(String(data.headline ?? ''))}</div><section class="section"><b>핵심 수치 및 추이</b><div class="bars">${chart}</div><table><tbody>${items}</tbody></table></section><section class="section"><b>데이터 기반 해석</b><p>${interpretation}</p><p>산식: ${escapeHtml(String(data.formula ?? '공시 원천값'))}</p></section><section class="section"><b>근거 및 한계</b><p class="foot">${src}</p><p class="foot">기계적 수치 비교이며, 추가적인 원인 분석·투자 판단을 포함하지 않습니다. 공시 원문과 비교기간 정합성을 확인하십시오.</p></section></body></html>`);
  win.document.close(); win.focus(); setTimeout(()=>win.print(),350);
}

export default function LiveDartPanel({ question }: { question: string }) {
  const live = Boolean(getStoredDartKey());
  const DEMO_FIXTURES: Record<string, any> = {
    "대한전선 2026년 반기 매출액": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "매출액", metricId: "revenue", valueKind: "reported", headline: "22,820억원", displayText: "22,820억원", value: 22820.29, unit: "억원", lines: ["원천 공시값: 매출액", "당기누적금액: 22,820억 2,900만원", "2026년 상반기 누적(1~6월)"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액" },
    "대한전선 2026년 반기 영업이익": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익", metricId: "operatingProfit", valueKind: "reported", headline: "1,213억원", displayText: "1,213억원", value: 1212.53, unit: "억원", lines: ["원천 공시값: 영업이익", "당기누적금액: 1,212억 5,300만원", "2026년 상반기 누적(1~6월)"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 영업이익" },
    "대한전선 2026년 반기 영업이익률": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익률", metricId: "operatingMargin", valueKind: "calculated", headline: "5.3%", displayText: "5.3%", value: 5.313385588000854, unit: "%", lines: ["영업이익 1,213억원 ÷ 매출액 22,820억원", "산식에 사용된 원자료는 동일 fixture의 누적값"], formula: "영업이익률 = 영업이익 ÷ 매출액 × 100", citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익", calcInputs: [{label:"영업이익",account:"영업이익",value:1212.53,sign:"+"},{label:"매출액",account:"매출액",value:22820.29,sign:"/"}] },
    "대한전선 2026년 반기 매출과 영업이익": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "매출액 · 영업이익", metricId: "comparison", valueKind: "reported", headline: "22,820억원 / 1,213억원", displayText: "22,820억원 / 1,213억원", value: null, unit: "억원", lines: ["매출액 22,820억 2,900만원", "영업이익 1,212억 5,300만원", "두 값 모두 반기 누적값"], formula: null, citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익" },
    "대한전선 2026년 상반기 영업이익률": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기 누적(1~6월)", basis: "연결 기준", metric: "영업이익률", metricId: "operatingMargin", valueKind: "calculated", headline: "5.3%", displayText: "5.3%", value: 5.313385588000854, unit: "%", lines: ["영업이익 1,213억원 ÷ 매출액 22,820억원", "2026년 상반기 누적(1~6월)"], formula: "영업이익률 = 영업이익 ÷ 매출액 × 100", citation: "사전 저장된 2026년 반기보고서 시연 fixture (https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814003722)", rceptNo: "20260814003722", sourceHeading: "손익계산서 > 매출액·영업이익", calcInputs: [{label:"영업이익",account:"영업이익",value:1212.53,sign:"+"},{label:"매출액",account:"매출액",value:22820.29,sign:"/"}] },
    "대한전선 2026년 반기 차입금": { found: true, demo: true, company: "대한전선", period: "2026 반기보고서 · 상반기말", basis: "연결 기준", metric: "차입금", metricId: "debt", valueKind: "calculated", headline: "11,876억원", displayText: "11,876억원", value: 11876, unit: "억원", lines: ["총차입금: 11,876억원", "리스부채와 현금성자산 차감 없이 차입·사채 계정군을 합산하는 정책"], formula: "차입금 = 단기차입금 + 유동성장기부채 + 장기차입금 + 사채", citation: "사전 저장된 2026년 상반기 검증 fixture (https://www.topdaily.kr/articles/112027)", sourceHeading: "재무상태표 > 차입금 계정" }
  };
  const normalizedQuestion = question.replace(/[?？]/g, "").replace(/\s+/g, " ").trim();
  const demoAnswer = DEMO_FIXTURES[normalizedQuestion] ?? null;
  const q = trpc.dart.ask.useQuery({ question }, { enabled: live && question.trim().length >= 2, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const d = live ? q.data : demoAnswer;
  const evidence = trpc.dart.evidence.useQuery({ rceptNo: d?.rceptNo ?? "00000000000000", heading: d?.sourceHeading ?? "재무제표" }, { enabled: Boolean(live && d?.rceptNo), retry: false, staleTime: 60 * 60 * 1000 });
  if (!live && !d) return <section className="live-answer"><div className="live-notice">체험 모드는 사전 저장된 대표 질문만 재생합니다. 다른 기업이나 기간을 조회하려면 상단의 <b>실시간 연결</b>에서 본인 인증키를 입력하세요.</div></section>;
  if (live && q.isLoading) return <div className="live-answer loading"><RefreshCw size={15} className="spin" /><span>OpenDART에서 최신 공시를 확인하고 있습니다…</span></div>;
  if (live && q.error) return <div className="live-answer error"><CircleHelp size={17} /><div><strong>조회 오류</strong><p>{q.error.message}</p></div></div>;
  if (!d) return null;
  if (d.found === false) return <section className="live-answer error"><div className="live-answer-head"><div><span className="live-tag"><CircleHelp size={11} /> {d.demo ? "DEMO SNAPSHOT · CORRECT REFUSAL" : "QUERY NOT AVAILABLE"}</span><h3>{d.metric ?? "조회 결과"}</h3><p>{d.company ?? ""} · {d.period ?? ""} · {d.basis ?? ""}</p></div></div><div className="live-notice"><strong>계산하지 않았습니다.</strong><p>{d.message ?? "필수 자료가 없거나 현재 지원하지 않는 지표입니다."}</p></div></section>;
  const derived = d.valueKind === "calculated" || Boolean(d.formula);
  const verification = verifyFinancialAnswer(d);
  return <section className="live-answer">
    <div className="live-answer-head"><div><span className="live-tag"><Check size={11} /> {d.demo ? "DEMO SNAPSHOT · PRELOADED" : "LIVE DART · SOURCE FOUND"}</span><h3>{d.metric} <em>{d.headline}</em></h3><p>{d.company} · {d.period} · {d.basis}</p></div><div className="live-actions"><button className="ghost-button" onClick={() => makeOnePager(d)}><FileText size={13} /> 1Paper</button><button className="ghost-button" onClick={() => downloadPdf(d)}><Download size={13} /> PDF</button><button className="ghost-button" onClick={() => downloadExcel(d)}><FileSpreadsheet size={13} /> Excel</button></div></div>
    <div className="live-notice" role="status"><strong>자동 정합성 점검: {verification.status === "passed" ? "통과 (원문 독립 검증 아님)" : verification.status === "failed" ? "불일치 발견" : "부분 검증"}</strong><ul>{verification.checks.map(c => <li key={c.name}>{c.ok === true ? "✓" : c.ok === false ? "✕" : "△"} {c.name}: {c.detail}</li>)}</ul><small>원문 수치와의 독립 대조가 완료되기 전에는 '원문 검증 완료'로 표시하지 않습니다.</small></div>
    {d.notice && <div className="live-notice">{d.notice}</div>}
    {d.demo && <div className="live-notice">시연 모드: 사전 저장된 fixture를 재생합니다. 이 결과는 실시간 API 호출 결과가 아닙니다.</div>}
    <div className="verification-strip"><span>✓ 기준: {d.basis}</span><span>✓ 기간: {d.period}</span><span>{d.demo ? "✓ 저장된 시연 fixture" : "공시 접수번호 확인 (원문 수치 대조 별도)"}</span></div>
    <div className="live-lines">{d.lines.map((line: string) => <div key={line}><span>·</span>{line}</div>)}</div>
    {Array.isArray(d.series) && d.series.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th><th>값</th><th>상태</th></tr></thead><tbody>{d.series.map((row: { year: number; period: string; mode: string; value: number | null; unit: string; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td><td className="series-value">{row.value === null ? "—" : formatValue(row.value, row.unit)}</td><td>{row.found ? <span className="series-ok">확인됨</span> : <span className="series-missing">{row.message ?? "미확인"}</span>}</td></tr>)}</tbody></table></div> : null}
    {Array.isArray(d.matrix) && d.matrix.length ? <div className="live-series"><table><thead><tr><th>연도</th><th>보고서</th>{Object.keys(d.matrix[0].values).map((metric) => <th key={metric}>{metricLabel(metric)}</th>)}</tr></thead><tbody>{d.matrix.map((row: { year: number; period: string; mode: string; values: Record<string, number | null>; units: Record<string, string>; found: boolean; message?: string }) => <tr key={`${row.year}-${row.period}`}><td><strong>{row.year}</strong></td><td>{row.period}<small>{row.mode}</small></td>{Object.keys(row.values).map((metric) => <td key={metric} className="series-value">{row.values[metric] === null ? "—" : formatValue(row.values[metric]!, row.units[metric])}</td>)}</tr>)}</tbody></table></div> : null}
    {d.formula && <div className="live-formula"><span>{derived ? "계산식" : "출처"}</span><strong>{d.formula}</strong></div>}
    {d.rceptNo && <div className="source-footer"><BookOpen size={15} /><div><strong>근거: {d.sourceHeading ?? d.metric}</strong><div>{parseCitation(d.citation).text}</div>{typeof d.value === "number" && <div>결과값: {formatValue(d.value, d.unit ?? "억원")} · {d.basis} · {d.period}</div>}<small>공시 하위문서로 이동할 수 있지만 개별 수치 행으로의 이동은 보장되지 않습니다.</small></div>{(!d.demo && evidence.data?.viewerUrl) ? <a href={evidence.data.viewerUrl} target="_blank" rel="noreferrer">재무제표 하위문서 ↗</a> : parseCitation(d.citation).url ? <a href={parseCitation(d.citation).url} target="_blank" rel="noreferrer">DART 공시 원문 ↗</a> : null}</div>}
  </section>;
}
