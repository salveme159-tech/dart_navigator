import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { searchLiveDartCompanies } from "@/lib/realDartClient";
import type { CompanyFinancialRecord, QuarterlyOnePagerItem } from "@/lib/realDartClient";

type Props = {
  company: CompanyFinancialRecord;
  companies: CompanyFinancialRecord[];
  selectedCompanyName: string;
  apiKey: string;
  onSelectCompany: (name: string) => void;
  onRegisterCompany: (name: string) => Promise<string | null>;
};
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const fmt = (v: number | null, unit = "억원") => v === null ? "자료 없음" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
const metric = (c: CompanyFinancialRecord, key: string) => {
  const serverValue = num(c.serverMetrics?.[key]?.value);
  if (serverValue !== null) return serverValue;
  const accountKey: Record<string, keyof CompanyFinancialRecord["accounts"]> = {
    revenue: "매출액", operatingProfit: "영업이익", netIncome: "순이익",
    totalAssets: "자산총계", totalLiabilities: "부채총계", equity: "자본총계",
    operatingCashFlow: "영업현금흐름", capex: "유형자산취득_CAPEX", financialCost: "금융원가",
  };
  const rawKey = accountKey[key];
  return rawKey ? num(c.accounts[rawKey]) : null;
};
const pct = (v: number | null) => v === null ? "자료 없음" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
const Input = ({ label, value, onChange, suffix = "%", min = 0, max = 100, step = 1 }: { label: string; value: string; onChange: (value: string) => void; suffix?: string; min?: number; max?: number; step?: number }) => <label className="block text-sm"><span className="font-medium">{label}</span><div className="mt-1 flex items-center gap-2"><input className="w-full rounded-lg border px-3 py-2" type="number" min={min} max={max} step={step} value={value} onChange={e => onChange(e.target.value)} placeholder="직접 입력"/><span className="w-8 text-slate-500">{suffix}</span></div></label>;

export default function AdvancedAnalysisPanel({ company, companies, selectedCompanyName, apiKey, onSelectCompany, onRegisterCompany }: Props) {
  const [companySearch, setCompanySearch] = useState("");
  const [companySuggestions, setCompanySuggestions] = useState<Array<{name:string;code:string;stock:string}>>([]);
  const [costShock, setCostShock] = useState(0);
  const [rateShock, setRateShock] = useState(0);
  const [copperShock, setCopperShock] = useState(0);
  const [fxShock, setFxShock] = useState(0);
  const [taxRate, setTaxRate] = useState("24");
  const [copperExposure, setCopperExposure] = useState("0.0");
  const [fxExposure, setFxExposure] = useState("0.0");
  const [floatingDebtShare, setFloatingDebtShare] = useState("0.0");
  const revenue = metric(company, "revenue");
  const op = metric(company, "operatingProfit");
  const net = metric(company, "netIncome");
  const borrowings = metric(company, "borrowings");
  const financialCost = metric(company, "financialCost") ?? metric(company, "interestExpense");
  const ocf = metric(company, "operatingCashFlow");
  const wc = metric(company, "workingCapital");
  const costRatio = revenue !== null && op !== null && revenue !== 0 ? (revenue - op) / revenue : null;
  const validInput = (s: string, max = Infinity) => s.trim() !== "" && Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= max;

  // Macro shocks only use exposure assumptions explicitly entered by the user. No hidden industry coefficients are applied.
  const periodMonths = /상반기|반기|6개월|1~6월/.test(company.period) ? 6 : /3분기|9개월|1~9월/.test(company.period) ? 9 : /1분기|3개월|1~3월/.test(company.period) ? 3 : 12;
  const result = useMemo(() => {
    if (revenue === null || op === null || net === null) return null;
    const tax = validInput(taxRate, 100) ? Number(taxRate) / 100 : null;
    const deltaOperating = revenue * costShock / 100;
    const copperDelta = validInput(copperExposure, 100) ? revenue * (Number(copperExposure) / 100) * copperShock / 100 : null;
    const fxDelta = validInput(fxExposure, 100) ? revenue * (Number(fxExposure) / 100) * fxShock / 100 : null;
    const floatingDebt = borrowings !== null && validInput(floatingDebtShare, 100) ? borrowings * Number(floatingDebtShare) / 100 : null;
    // 금리 변화는 연율 충격이므로 선택 공시기간의 길이만큼만 반영합니다.
    const interestDelta = rateShock === 0 ? 0 : floatingDebt === null ? null : floatingDebt * rateShock / 100 * (periodMonths / 12);
    const macroDelta = (copperDelta ?? 0) + (fxDelta ?? 0);
    const operating = op - deltaOperating - macroDelta;
    const pretaxDelta = -deltaOperating - macroDelta - (interestDelta ?? 0);
    const netDelta = tax === null ? null : pretaxDelta * (1 - tax);
    return {
      operating, net: netDelta === null || (rateShock !== 0 && interestDelta === null) ? null : net + netDelta,
      interest: financialCost === null || interestDelta === null ? null : Math.abs(financialCost) + interestDelta,
      baseMargin: revenue ? op / revenue * 100 : null,
      shockedMargin: revenue ? operating / revenue * 100 : null,
      copperDelta, fxDelta, interestDelta, tax, deltaOperating, macroDelta,
    };
  }, [revenue, op, net, borrowings, financialCost, costShock, rateShock, copperShock, fxShock, taxRate, copperExposure, fxExposure, floatingDebtShare, periodMonths]);

  const history = useMemo(() => (company.quarterlyHistory ?? [])
    .filter((p): p is QuarterlyOnePagerItem => Number.isFinite(p.revenue) && Number.isFinite(p.operatingProfit))
    .slice(-16), [company.quarterlyHistory]);
  const historyHasCashFlow = ocf !== null;
  const qualityWarnings = [
    op !== null && ocf !== null && op > 0 && ocf < 0 ? "영업이익은 흑자지만 영업활동현금흐름은 음수입니다. 이익과 현금 유입의 괴리를 점검하세요." : null,
    revenue !== null && wc !== null && wc > Math.abs(revenue) * 0.2 ? "영업운전자본이 매출액 대비 큰 편입니다. 매출채권 회수와 재고 회전의 추이를 추가 점검하세요. 20%는 화면 내 참고 기준이며 업종 표준이 아닙니다." : null,
    history.length < 8 ? `과거 분기 비교 데이터가 ${history.length}개뿐입니다. 매출채권·재고자산을 포함한 장기 추세 판단에는 자료가 부족합니다.` : null,
    !historyHasCashFlow ? "현재 기간의 영업활동현금흐름이 확보되지 않아 현금전환 점검을 완료하지 못했습니다." : null,
  ].filter(Boolean) as string[];
  const historyRows = history.map((p, i) => {
    const deltaCost = p.revenue * costShock / 100;
    const deltaCopper = validInput(copperExposure, 100) ? p.revenue * Number(copperExposure) / 100 * copperShock / 100 : 0;
    const deltaFx = validInput(fxExposure, 100) ? p.revenue * Number(fxExposure) / 100 * fxShock / 100 : 0;
    const interestKnown = rateShock === 0 || (borrowings !== null && validInput(floatingDebtShare, 100));
    const deltaInterest = borrowings !== null && validInput(floatingDebtShare, 100) ? borrowings * Number(floatingDebtShare) / 100 * rateShock / 100 / 4 : 0;
    const deltaPreTax = -(deltaCost + deltaCopper + deltaFx) - deltaInterest;
    const tax = validInput(taxRate, 100) ? Number(taxRate) / 100 : null;
    return {
      ...p,
      margin: p.revenue !== 0 ? p.operatingProfit / p.revenue * 100 : null,
      scenarioOperatingProfit: p.operatingProfit - deltaCost - deltaCopper - deltaFx,
      scenarioNetIncome: typeof p.netIncome === "number" && tax !== null && interestKnown ? p.netIncome + deltaPreTax * (1 - tax) : null,
      scenarioMargin: p.revenue !== 0 ? (p.operatingProfit - deltaCost - deltaCopper - deltaFx) / p.revenue * 100 : null,
      prior: i > 0 ? history[i - 1] : null,
    };
  });

  useEffect(() => {
    if (!apiKey || companySearch.trim().length < 1) { setCompanySuggestions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = await searchLiveDartCompanies(companySearch, apiKey, 8).catch(() => []);
      if (!cancelled) setCompanySuggestions(rows);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [companySearch, apiKey]);

  const exposureLabel = (label: string, value: string) => `${label}: ${Number(value || 0).toFixed(1)}%`;

  return <section className="space-y-5 p-4 md:p-6">
    <div><h2 className="text-2xl font-bold">손익 민감도 체크</h2><p className="mt-1 text-sm text-slate-500">{company.corpName} · {company.reportName || company.period} · {company.basisCode === "OFS" ? "별도 기준" : "연결 기준"}. 공시로 확인된 숫자와 사용자가 입력한 가정을 구분합니다.</p></div>
    <div className="rounded-2xl border bg-white p-4"><div className="mb-2 text-sm font-extrabold">분석 기업 선택</div><div className="flex flex-wrap gap-2"><select value={selectedCompanyName} onChange={(e) => onSelectCompany(e.target.value)} className="min-w-[220px] flex-1 rounded-xl border px-3 py-2 text-sm">{companies.map((item) => <option key={item.corpName} value={item.corpName}>{item.corpName} · {item.stockCode}</option>)}</select><div className="relative flex min-w-[260px] flex-1 gap-2"><input value={companySearch} onChange={(e) => setCompanySearch(e.target.value)} placeholder="DART 기업명 검색" className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm"/><button type="button" onClick={async () => { const name = await onRegisterCompany(companySearch); if (name) { onSelectCompany(name); setCompanySearch(""); setCompanySuggestions([]); } }} className="rounded-xl bg-emerald-800 px-3 py-2 text-xs font-bold text-white"><Search className="inline h-3.5 w-3.5"/> 등록</button>{companySuggestions.length > 0 && <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-xl">{companySuggestions.map((item) => <button type="button" key={item.code} onClick={async () => { const name = await onRegisterCompany(item.name); if (name) onSelectCompany(name); setCompanySearch(""); setCompanySuggestions([]); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-emerald-50"><strong>{item.name}</strong><span className="ml-2 text-slate-500">{item.stock || item.code}</span></button>)}</div>}</div></div></div>
    <div className="grid gap-4 xl:grid-cols-1">
      <article className="rounded-2xl border p-5"><h3 className="text-lg font-bold">시나리오 입력</h3><p className="mt-1 text-sm text-slate-500">현재 조회된 손익 기간을 기준으로 한 가정 계산입니다. 구리·환율 노출률과 변동금리 차입 비중은 공시에서 확인된 값이 아니므로 직접 입력 필요.</p>
        <label className="block mt-5 text-sm font-semibold">매출 대비 비용 부담 변화: {costShock > 0 ? "+" : ""}{costShock.toFixed(1)}%p<input className="w-full mt-2" type="range" min="-3" max="3" step="0.5" value={costShock} onChange={e=>setCostShock(Number(e.target.value))}/></label>
        <label className="block mt-4 text-sm font-semibold">금리 변화: {rateShock > 0 ? "+" : ""}{rateShock.toFixed(2)}%p<input className="w-full mt-2" type="range" min="-2" max="2" step="0.25" value={rateShock} onChange={e=>setRateShock(Number(e.target.value))}/></label>
        <label className="block mt-4 text-sm font-semibold">구리 가격 변화: {copperShock > 0 ? "+" : ""}{copperShock.toFixed(1)}%<input className="w-full mt-2" type="range" min="-30" max="30" step="1" value={copperShock} onChange={e=>setCopperShock(Number(e.target.value))}/></label>
        <label className="block mt-4 text-sm font-semibold">환율 변화: {fxShock > 0 ? "+" : ""}{fxShock.toFixed(1)}%<input className="w-full mt-2" type="range" min="-20" max="20" step="1" value={fxShock} onChange={e=>setFxShock(Number(e.target.value))}/></label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><Input label={exposureLabel("구리 가격 민감 원가 비중", copperExposure)} value={copperExposure} onChange={setCopperExposure}/><Input label={exposureLabel("환율 상승 시 손실 민감 순노출 비중", fxExposure)} value={fxExposure} onChange={setFxExposure}/><Input label={exposureLabel("변동금리 차입 비중", floatingDebtShare)} value={floatingDebtShare} onChange={setFloatingDebtShare}/><Input label="한계세율 가정" value={taxRate} onChange={setTaxRate} max={100} step={0.5}/></div>
        <p className="mt-2 text-xs text-slate-500">입력한 노출 비중은 사용자의 가정입니다. 원재료 매입액·외화 순노출액·변동금리 차입 비중을 공시 주석에서 검증한 값으로 대체해야 분석 신뢰도가 높아집니다.</p>
        {result ? <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">시나리오 영업이익</div><strong>{fmt(result.operating)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">시나리오 순이익</div><strong>{fmt(result.net)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">기준 영업이익률</div><strong>{pct(result.baseMargin)}</strong></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">시나리오 영업이익률</div><strong>{pct(result.shockedMargin)}</strong></div><div className="col-span-2 rounded-xl border p-3 text-sm space-y-1"><div>구리 충격 반영: {result.copperDelta === null ? "노출 비중 입력 필요" : fmt(result.copperDelta)}</div><div>환율 충격 반영: {result.fxDelta === null ? "순노출 비중 입력 필요" : fmt(result.fxDelta)}</div><div>금리 충격 반영: {result.interestDelta === null ? (borrowings === null ? "차입금 자료 없음" : "변동금리 차입 비중 입력 필요") : fmt(result.interestDelta)}</div><div>이자보상배율: {result.interest !== null && result.interest > 0 ? `${(result.operating / result.interest).toFixed(2)}배` : "금융원가·금리노출 자료 부족"}</div></div></div> : <p className="mt-5 text-amber-700 text-sm">매출액·영업이익·순이익·총차입금의 실제 공시값이 모두 있어야 기본 시나리오를 계산할 수 있습니다.</p>}
      </article>
    </div>
    <article className="rounded-2xl border bg-white p-5 space-y-4">
      <div><h3 className="text-lg font-extrabold">과거 분기 실적 · 시나리오 변화</h3><p className="mt-1 text-xs text-slate-500">DART에서 확보한 실제 분기 매출액·영업이익·순이익을 기준으로, 위의 슬라이더를 움직이면 시나리오 영업이익과 순이익이 함께 바뀝니다. 과거 분기별 차입금 이력이 없을 때 금리 충격은 최신 조회 차입금을 기준으로 분기 환산해 적용합니다. 실제 과거 실적 자체는 수정하지 않습니다.</p></div>
      {historyRows.length > 0 ? <>
        <div className="h-72 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={historyRows} margin={{ top: 10, right: 18, left: 8, bottom: 5 }}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tick={{ fontSize: 11 }}/><YAxis tick={{ fontSize: 11 }}/><Tooltip formatter={(value) => `${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`}/><Legend/><Line type="monotone" dataKey="operatingProfit" name="실제 영업이익" stroke="#0f766e" dot={false}/><Line type="monotone" dataKey="scenarioOperatingProfit" name="시나리오 영업이익" stroke="#ea580c" strokeDasharray="5 4" dot={false}/></LineChart></ResponsiveContainer></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-slate-50 text-xs text-slate-600"><th className="px-3 py-2 text-left">분기</th><th className="px-3 py-2 text-right">실제 매출액</th><th className="px-3 py-2 text-right">실제 영업이익</th><th className="px-3 py-2 text-right">시나리오 영업이익</th><th className="px-3 py-2 text-right">실제 순이익</th><th className="px-3 py-2 text-right">시나리오 순이익</th><th className="px-3 py-2 text-right">시나리오 영업이익률</th></tr></thead><tbody>{historyRows.map((row) => <tr key={row.period} className="border-b last:border-0"><td className="px-3 py-2 font-bold">{row.period}</td><td className="px-3 py-2 text-right">{fmt(row.revenue)}</td><td className="px-3 py-2 text-right">{fmt(row.operatingProfit)}</td><td className="px-3 py-2 text-right font-bold text-orange-700">{fmt(row.scenarioOperatingProfit)}</td><td className="px-3 py-2 text-right">{typeof row.netIncome === "number" ? fmt(row.netIncome) : "—"}</td><td className="px-3 py-2 text-right font-bold text-orange-700">{row.scenarioNetIncome === null ? "—" : fmt(row.scenarioNetIncome)}</td><td className="px-3 py-2 text-right">{pct(row.scenarioMargin)}</td></tr>)}</tbody></table></div>
      </> : <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">아직 분기 이력이 없습니다. 이 화면을 열면 DART에서 공개된 과거 분기 공시를 조회합니다. 조회 후에도 비어 있으면 기업의 실제 공시 유무와 API 응답을 확인하세요.</div>}
      {qualityWarnings.length > 0 && <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{qualityWarnings.map((warning) => <div key={warning}>• {warning}</div>)}</div>}
    </article>
  </section>;}
