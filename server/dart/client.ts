import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import {
  DEFAULT_COMPANY,
  METRIC_LABELS,
  amountOf,
  baseDate,
  citation,
  findCorp,
  findRowLike,
  fsDivFor,
  fsLabel,
  looksLikeCompany,
  metricConfig,
  modeLabel,
  netDebt,
  parseCorps,
  periodCandidates,
  parseDartQuery,
  P,
  periodFromFilters,
  periodLabel,
  searchCorps,
  unzipFirst,
  type Corp,
  type FinancialMetric,
  type Kind,
  type Period,
  type Row,
} from "./engine";

const BASE = "https://opendart.fss.or.kr/api";
const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}억원`;
let corpCache: { at: number; map: Map<string, Corp> } | null = null;
const stmtCache = new Map<string, { at: number; rows: Row[] | null }>();

function key() {
  if (!ENV.opendartApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OPENDART_API_KEY가 설정되지 않았습니다(.env 확인)." });
  }
  return ENV.opendartApiKey;
}

async function corps(force = false) {
  if (!force && corpCache && Date.now() - corpCache.at < 864e5) return corpCache.map;
  const res = await fetch(`${BASE}/corpCode.xml?crtfc_key=${key()}`);
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 기업코드 조회 실패: HTTP ${res.status}` });
  const map = parseCorps(unzipFirst(Buffer.from(await res.arrayBuffer())));
  corpCache = { at: Date.now(), map };
  return map;
}

async function statements(code: string, year: number, reprt: string, fs: "CFS" | "OFS", force = false) {
  const k = `${code}-${year}-${reprt}-${fs}`;
  const hit = stmtCache.get(k);
  if (!force && hit && Date.now() - hit.at < 36e5) return hit.rows;
  const url = `${BASE}/fnlttSinglAcntAll.json?crtfc_key=${key()}&corp_code=${code}&bsns_year=${year}&reprt_code=${reprt}&fs_div=${fs}`;
  const response = await fetch(url);
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 재무제표 조회 실패: HTTP ${response.status}` });
  const j = (await response.json()) as { status: string; message?: string; list?: Row[] };
  if (j.status !== "000" && j.status !== "013") {
    throw new TRPCError({ code: "BAD_GATEWAY", message: `DART ${j.status}: ${j.message ?? "조회 실패"}` });
  }
  const rows = j.status === "000" ? (j.list ?? []) : null;
  stmtCache.set(k, { at: Date.now(), rows });
  return rows;
}

function normAccount(s: string) { return s.replace(/[\s·ㆍ]/g, ""); }

function pickDirectAccount(rows: Row[], period: Period, term: string) {
  const aliases: Record<string, string[]> = {
    유동성장기부채: ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분"],
    유동매출채권: ["유동매출채권"], 비유동매출채권: ["비유동매출채권"],
    이익잉여금: ["이익잉여금", "이익잉여금(결손금)"],
    투자활동현금흐름: ["투자활동으로인한현금흐름", "투자활동현금흐름", "투자활동순현금흐름"],
    재무활동현금흐름: ["재무활동으로인한현금흐름", "재무활동현금흐름", "재무활동순현금흐름"],
  };
  const targets = (aliases[term] ?? [term]).map(normAccount);
  const candidates = rows.filter((r) => {
    const a = normAccount(r.account_nm ?? "");
    return targets.some((t) => a === t) && !a.includes("리스");
  });
  if (!candidates.length) return null;
  const row = candidates[0];
  const isPLCF = ["CIS", "IS", "CF"].includes(row.sj_div ?? "");
  const value = amountOf(row, 0, isPLCF && period.mode === "cum");
  if (value === null) return null;
  return {
    value: term === "기본주당순손익" || term === "희석주당순손익" ? value : value,
    unit: "억원",
    lines: [`원천 계정: ${row.account_nm}`],
    formula: null,
    disclaimer: null,
    sourceHeading: `${row.sj_div === "BS" ? "재무상태표" : row.sj_div === "CF" ? "현금흐름표" : "손익계산서"} > ${row.account_nm}`,
  };
}

function pickMetric(rows: Row[], period: Period, metric: FinancialMetric) {
  if (metric === "netDebt") {
    const result = netDebt(rows);
    if (!result.ok) return null;
    return {
      value: result.value, unit: "억원",
      lines: result.items.map((i) => `${i.sign} ${i.account} ${won(i.amount)}`),
      formula: result.formula, disclaimer: result.disclaimer, sourceHeading: "재무상태표 > 차입금·현금 계정",
    };
  }

  if (metric === "operatingMargin") {
    const revenue = findRowLike(rows, ["CIS", "IS"], metricConfig.revenue.names);
    const operatingProfit = findRowLike(rows, ["CIS", "IS"], metricConfig.operatingProfit.names);
    const rev = revenue ? amountOf(revenue, 0, period.mode === "cum") : null;
    const op = operatingProfit ? amountOf(operatingProfit, 0, period.mode === "cum") : null;
    if (rev === null || op === null || rev === 0) return null;
    return { value: (op / rev) * 100, unit: "%", lines: [`영업이익 ${won(op)} / 매출액 ${won(rev)}`], formula: "영업이익률 = 영업이익 ÷ 매출액 × 100", disclaimer: null, sourceHeading: "손익계산서 > 매출액·영업이익" };
  }

  if (metric === "debtRatio" || metric === "currentRatio") {
    const a = findRowLike(rows, ["BS"], metric === "debtRatio" ? ["부채총계"] : ["유동자산"]);
    const b = findRowLike(rows, ["BS"], metric === "debtRatio" ? ["자본총계"] : ["유동부채"]);
    const av = a ? amountOf(a) : null; const bv = b ? amountOf(b) : null;
    if (av === null || bv === null || bv === 0) return null;
    return { value: (av / bv) * 100, unit: "%", lines: [`${a!.account_nm} ${won(av)} / ${b!.account_nm} ${won(bv)}`], formula: metric === "debtRatio" ? "부채비율 = 부채총계 ÷ 자본총계 × 100" : "유동비율 = 유동자산 ÷ 유동부채 × 100", disclaimer: null, sourceHeading: "재무상태표 > 안정성 지표 원천 계정" };
  }

  if (metric === "interestCoverage") {
    const op = findRowLike(rows, ["CIS", "IS"], metricConfig.operatingProfit.names);
    const interest = findRowLike(rows, ["CIS", "IS"], ["이자비용", "이자비용(금융원가)", "금융원가"]);
    const ov = op ? amountOf(op, 0, period.mode === "cum") : null; const iv = interest ? amountOf(interest, 0, period.mode === "cum") : null;
    if (ov === null || iv === null || iv === 0) return null;
    return { value: ov / Math.abs(iv), unit: "배", lines: [`영업이익 ${won(ov)} / ${interest!.account_nm} ${won(iv)}`], formula: "이자보상배율 = 영업이익 ÷ 이자비용", disclaimer: null, sourceHeading: "손익계산서 > 영업이익·이자비용" };
  }

  if (metric === "roe" || metric === "roa") {
    const profitRow = findRowLike(rows, ["CIS", "IS"], metricConfig.netIncome.names);
    const baseName = metric === "roe" ? "자본총계" : "자산총계";
    const baseRow = findRowLike(rows, ["BS"], [baseName]);
    const profit = profitRow ? amountOf(profitRow, 0, period.mode === "cum") : null;
    const cur = baseRow ? amountOf(baseRow, 0) : null; const prev = baseRow ? amountOf(baseRow, 1) : null;
    if (profit === null || cur === null || prev === null || (cur + prev) === 0) return null;
    const avg = (cur + prev) / 2;
    return { value: profit / avg * 100, unit: "%", lines: [`순이익 ${won(profit)} / 평균${metric === "roe" ? "자본총계" : "자산총계"} ${won(avg)}`], formula: metric === "roe" ? "ROE = 당기순이익 ÷ 평균자기자본 × 100" : "ROA = 당기순이익 ÷ 평균총자산 × 100", disclaimer: null, sourceHeading: `재무제표 > ${metric.toUpperCase()} 원천 계정` };
  }

  if (metric === "eps") {
    const row = findRowLike(rows, ["CIS", "IS"], metricConfig.eps.names);
    const raw = row ? (row.thstrm_amount ?? "").replace(/,/g, "").trim() : "";
    const value = raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
    if (value === null) return null;
    return { value, unit: "원", lines: [`원천 계정: ${row!.account_nm}`], formula: "EPS = 주당순이익 공시값", disclaimer: null, sourceHeading: `손익계산서 > ${row!.account_nm}` };
  }

  if (metric === "ebitda") {
    const op = findRowLike(rows, ["CIS", "IS"], metricConfig.operatingProfit.names);
    const dep = findRowLike(rows, ["CIS", "IS", "CF"], ["감가상각비"]);
    const amort = findRowLike(rows, ["CIS", "IS", "CF"], ["무형자산상각비", "무형자산상각"]);
    const ov = op ? amountOf(op, 0, period.mode === "cum") : null;
    const dv = dep ? amountOf(dep, 0, period.mode === "cum") : 0;
    const av = amort ? amountOf(amort, 0, period.mode === "cum") : 0;
    if (ov === null || (dv === null && av === null)) return null;
    return { value: ov + (dv ?? 0) + (av ?? 0), unit: "억원", lines: [`영업이익 ${won(ov)} + 감가상각·상각 ${won((dv ?? 0) + (av ?? 0))}`], formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비", disclaimer: null, sourceHeading: "손익계산서·현금흐름표 > EBITDA 원천 계정" };
  }

  const config = metricConfig[metric];
  const row = metric === "netIncome"
    ? (findRowLike(rows, ["CIS", "IS"], ["반기순손익", "분기순손익", "당기순이익", "당기순이익(손실)", "연결당기순이익"]) ?? findRowLike(rows, config.sj, config.names))
    : findRowLike(rows, config.sj, config.names);
  const isPL = config.sj.some((s) => s === "IS" || s === "CIS");
  const value = row ? amountOf(row, 0, isPL && period.mode === "cum") : null;
  if (!row || value === null) return null;
  const lines = [`원천 계정: ${row.account_nm}`];
  if (isPL && period.kind !== "annual" && row.thstrm_add_amount) lines.push(`당기 3개월: ${won(amountOf(row, 0, false) ?? 0)} / 누적: ${won(amountOf(row, 0, true) ?? 0)}`);
  return { value: metric === "capex" ? Math.abs(value) : value, unit: "억원", lines, formula: null, disclaimer: null, sourceHeading: `${config.sj.includes("CF") ? "현금흐름표" : "손익계산서"} > ${METRIC_LABELS[metric]}` };
}

async function resolvePeriod(corp: { code: string }, candidates: Period[], fs: "CFS" | "OFS", force = false) {
  for (const p of candidates) {
    const rows = await statements(corp.code, p.year, p.code, fs, force);
    if (rows) return { period: p, rows };
  }
  return null;
}

export async function clearDartCaches() {
  corpCache = null;
  stmtCache.clear();
  return { ok: true as const, refreshedAt: new Date().toISOString() };
}

export async function searchDartCompanies(query: string, limit = 12) {
  const map = await corps();
  return searchCorps(query, map, limit);
}

export async function snapshotDart(companyName: string, force = false) {
  const map = await corps(force);
  const corp = findCorp(companyName, map) ?? findCorp(DEFAULT_COMPANY, map);
  if (!corp) throw new TRPCError({ code: "NOT_FOUND", message: `DART에서 기업을 찾지 못했습니다: ${companyName}` });

  const fs = "CFS" as const;
  const resolved = await resolvePeriod(corp, periodCandidates(""), fs, force);
  if (!resolved) return { found: false as const, company: corp.name, message: "최근 공시된 재무제표를 찾지 못했습니다." };

  const { period, rows } = resolved;
  const metrics = {} as Record<FinancialMetric, { value: number; unit: string; formula: string | null; citation: string } | null>;
  const rcept = rows.find((r) => r.rcept_no)?.rcept_no ?? "";
  (Object.keys(METRIC_LABELS) as FinancialMetric[]).forEach((metric) => {
    const picked = pickMetric(rows, period, metric);
    metrics[metric] = picked
      ? {
          value: picked.value,
          unit: picked.unit,
          formula: picked.formula,
          citation: citation(periodLabel(period), picked.sourceHeading, rcept),
        }
      : null;
  });

  return {
    found: true as const,
    company: corp.name,
    stockCode: corp.stock,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    periodKind: period.kind,
    basis: fsLabel(fs),
    metrics,
    refreshedAt: new Date().toISOString(),
  };
}

export type CompareInput = {
  companies: string[];
  metric: FinancialMetric;
  year?: number;
  period: Kind | "latest";
  basis: "CFS" | "OFS";
  force?: boolean;
};

export async function compareDart(input: CompareInput) {
  const map = await corps(Boolean(input.force));
  const uniqueNames = [...new Set(input.companies)].slice(0, 8);
  const resultRows = [] as Array<{
    company: string;
    found: boolean;
    value: number | null;
    unit: string;
    period: string;
    basis: string;
    citation?: string;
    formula?: string | null;
    message?: string;
  }>;

  for (const requested of uniqueNames) {
    const corp = findCorp(requested, map);
    if (!corp) {
      resultRows.push({ company: requested, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "DART 기업목록에서 찾지 못했습니다." });
      continue;
    }
    const resolved = await resolvePeriod(corp, periodFromFilters(input.year, input.period), input.basis, Boolean(input.force));
    if (!resolved) {
      resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "선택한 기간의 공시가 없습니다." });
      continue;
    }
    const picked = pickMetric(resolved.rows, resolved.period, input.metric);
    const rcept = resolved.rows.find((r) => r.rcept_no)?.rcept_no ?? "";
    if (!picked) {
      resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`, basis: fsLabel(input.basis), message: `${METRIC_LABELS[input.metric]} 계정을 찾지 못했습니다.` });
      continue;
    }
    resultRows.push({
      company: corp.name,
      found: true,
      value: picked.value,
      unit: picked.unit,
      period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`,
      basis: fsLabel(input.basis),
      citation: citation(periodLabel(resolved.period), picked.sourceHeading, rcept),
      formula: picked.formula,
    });
  }

  return {
    metric: input.metric,
    metricLabel: METRIC_LABELS[input.metric],
    rows: resultRows,
    refreshedAt: new Date().toISOString(),
  };
}

const LOOKUPS: Array<[RegExp, FinancialMetric]> = [
  [/영업이익률|영업마진|영업마진율|OPM/i, "operatingMargin"],
  [/영업이익|영업익/i, "operatingProfit"],
  [/당기순이익|순이익|순익|당기순익|반기순손익|분기순손익/i, "netIncome"],
  [/투자활동현금흐름|투자현금흐름/i, "investmentCashFlow"],
  [/재무활동현금흐름|재무현금흐름/i, "financingCashFlow"],
  [/영업활동현금흐름|영업현금흐름|영업현금/i, "operatingCashFlow"],
  [/capex|설비투자|자본적지출|유형자산.?취득/i, "capex"],
  [/순차입금|순부채/i, "netDebt"], [/부채비율/i, "debtRatio"], [/유동비율/i, "currentRatio"],
  [/이자보상배율/i, "interestCoverage"], [/ROE|자기자본이익률/i, "roe"], [/ROA|총자산이익률/i, "roa"], [/EPS|주당순이익/i, "eps"],
  [/매출액|매출|매출실적/i, "revenue"],
];

function metricFromQuestion(question: string): FinancialMetric | null {
  for (const [regex, key] of LOOKUPS) if (regex.test(question)) return key;
  return null;
}

const fail = (message: string) => ({ found: false as const, message });

export async function askDart(question: string) {
  const map = await corps();
  const parsed = parseDartQuery(question);
  let corp = findCorp(question, map);
  let notice: string | null = null;
  if (!corp) {
    if (looksLikeCompany(question)) return fail("질문 속 기업을 DART 목록에서 찾지 못했습니다. 공식 회사명으로 다시 검색해 주세요.");
    corp = findCorp(DEFAULT_COMPANY, map);
    if (!corp) return fail(`기본 기업(${DEFAULT_COMPANY})을 DART 목록에서 찾지 못했습니다.`);
    notice = `질문에 기업명이 없어 기본 기업(${DEFAULT_COMPANY})으로 조회했습니다.`;
  }

  const fs = parsed.basis;
  const metrics = parsed.metrics;
  const requestedYears = parsed.years;
  if (!metrics.length && !parsed.directAccount) return fail(`질문에서 조회할 재무지표를 인식하지 못했습니다. 재무 용어의 정확한 명칭을 사용해 주세요.`);
  if (metrics.includes("per") || metrics.includes("pbr")) return fail(`PER/PBR은 현재 연결된 OpenDART 재무제표만으로는 현재 주가 데이터가 없어 계산하지 않습니다. 주가 데이터 연결 후 제공할 수 있습니다.`);

  // 재무상태표/손익계산서/현금흐름표에 실제 계정명이 존재하는 경우에는
  // 임의의 다른 지표(예: 매출액)로 대체하지 않고 해당 계정만 정확히 찾습니다.
  if (parsed.directAccount && !metrics.length) {
    const candidates = parsed.kind && parsed.kind !== "latest" ? [P(parsed.yearEnd ?? parsed.years.at(-1) ?? new Date().getFullYear(), parsed.kind, parsed.mode ?? "cum")] : periodCandidates(question);
    if (!candidates.length) return fail(`${corp.name}의 요청 기간을 해석할 수 없습니다.`);
    const baseResolved = await resolvePeriod(corp, candidates, fs);
    if (!baseResolved) return fail(`${corp.name}의 ${parsed.directAccount}을(를) 찾을 수 있는 보고서를 찾지 못했습니다.`);
    let periods: Period[] = [baseResolved.period];
    if (parsed.yearStart !== null && parsed.yearEnd !== null) periods = Array.from({ length: parsed.yearEnd - parsed.yearStart + 1 }, (_, i) => P(parsed.yearStart! + i, baseResolved.period.kind, baseResolved.period.mode));
    else if (parsed.recentYears) periods = Array.from({ length: parsed.recentYears }, (_, i) => P(baseResolved.period.year - (parsed.recentYears! - 1 - i), baseResolved.period.kind, baseResolved.period.mode));
    const series: any[] = [];
    for (const period of periods) {
      const rows = await statements(corp.code, period.year, period.code, fs);
      const picked = rows ? pickDirectAccount(rows, period, parsed.directAccount) : null;
      series.push({ year: period.year, period: periodLabel(period), mode: modeLabel(period), value: picked?.value ?? null, unit: picked?.unit ?? "억원", found: !!picked, message: !rows ? "해당 보고서가 없습니다." : !picked ? `${parsed.directAccount} 계정을 찾지 못했습니다.` : undefined });
    }
    const valid = series.filter((x) => x.value !== null);
    if (!valid.length) return fail(`${corp.name}의 요청한 기간에 '${parsed.directAccount}' 계정을 찾지 못했습니다.`);
    const latest = valid[valid.length - 1];
    const latestRows = await statements(corp.code, latest.year, P(latest.year, baseResolved.period.kind, baseResolved.period.mode).code, fs);
    const pickedLatest = latestRows ? pickDirectAccount(latestRows, P(latest.year, baseResolved.period.kind, baseResolved.period.mode), parsed.directAccount) : null;
    const rcept = latestRows?.find((r) => r.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const, company: corp.name,
      period: parsed.recentYears ? `최근 ${parsed.recentYears}개년 · ${modeLabel(baseResolved.period)}` : periods.length > 1 ? `${periodLabel(periods[0])} ~ ${periodLabel(periods.at(-1)!)}` : `${periodLabel(baseResolved.period)} · ${modeLabel(baseResolved.period)} · 기준일 ${baseDate(baseResolved.period)}`,
      basis: fsLabel(fs), notice, metric: parsed.directAccount,
      headline: formatMetricValue(latest.value, latest.unit), lines: [`${parsed.directAccount} 연도별 조회`],
      series, formula: null, citation: citation(periodLabel(baseResolved.period), pickedLatest?.sourceHeading ?? `재무제표 > ${parsed.directAccount}`, rcept), disclaimer: null, query: parsed,
    };
  }

  // 1) 기간이 명시된 다년 질의: 2024~2026 / 최근 4개년 / 최근 3년 등.
  //    각 연도에서 같은 보고기간을 조회하고, 여러 지표가 들어오면 행/열 형태로 함께 반환한다.
  const isHistorical = !!parsed.recentYears || requestedYears.length >= 2 || !!parsed.yearStart;
  if (isHistorical) {
    let base: Period | null = null;
    if (parsed.yearStart !== null && parsed.yearEnd !== null) {
      const anchorYear = parsed.yearEnd;
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : periodCandidates(`${anchorYear}년 최신 보고서`);
      const resolved = await resolvePeriod(corp, anchorCandidates, fs);
      if (!resolved) return fail(`${corp.name}의 ${anchorYear}년 요청 보고기간 자료를 찾지 못했습니다.`);
      base = resolved.period;
    } else if (parsed.recentYears) {
      const candidates = parsed.kind && parsed.kind !== "latest"
        ? [P(new Date().getFullYear(), parsed.kind, parsed.mode ?? "cum")]
        : periodCandidates(question);
      const resolved = await resolvePeriod(corp, candidates, fs);
      if (!resolved) return fail(`${corp.name}의 요청한 최신 보고기간 자료를 찾지 못했습니다.`);
      base = resolved.period;
    } else if (requestedYears.length >= 2) {
      const anchorYear = requestedYears[requestedYears.length - 1];
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : periodCandidates(`${anchorYear}년 최신 보고서`);
      const resolved = await resolvePeriod(corp, anchorCandidates, fs);
      if (!resolved) return fail(`${corp.name}의 ${anchorYear}년 자료를 찾지 못했습니다.`);
      base = resolved.period;
    }
    if (!base) return fail("질문의 기간 범위를 해석하지 못했습니다.");

    const periods = parsed.yearStart !== null && parsed.yearEnd !== null
      ? Array.from({ length: parsed.yearEnd - parsed.yearStart + 1 }, (_, i) => P(parsed.yearStart! + i, base!.kind, base!.mode))
      : parsed.recentYears
        ? Array.from({ length: parsed.recentYears }, (_, i) => P(base!.year - (parsed.recentYears! - 1 - i), base!.kind, base!.mode))
        : requestedYears.map((year) => P(year, base!.kind, base!.mode));

    const matrix: Array<{
      year: number;
      period: string;
      mode: string;
      values: Record<string, number | null>;
      units: Record<string, string>;
      found: boolean;
      message?: string;
    }> = [];

    for (const period of periods) {
      const rows = await statements(corp.code, period.year, period.code, fs);
      const values: Record<string, number | null> = {};
      const units: Record<string, string> = {};
      let found = false;
      for (const metric of metrics) {
        const picked = rows ? pickMetric(rows, period, metric) : null;
        values[metric] = picked?.value ?? null;
        units[metric] = picked?.unit ?? (metric === "operatingMargin" || metric === "debtRatio" ? "%" : "억원");
        if (picked) found = true;
      }
      matrix.push({
        year: period.year,
        period: periodLabel(period),
        mode: modeLabel(period),
        values,
        units,
        found,
        message: !rows ? "해당 보고서가 없습니다." : !found ? `${metrics.map((m) => METRIC_LABELS[m]).join(", ")} 계정을 찾지 못했습니다.` : undefined,
      });
    }

    const valid = matrix.filter((row) => metrics.some((metric) => row.values[metric] !== null));
    if (!valid.length) return fail(`${corp.name}의 요청한 기간에 ${metrics.map((m) => METRIC_LABELS[m]).join(", ")} 자료를 찾지 못했습니다.`);

    const latestRow = valid[valid.length - 1];
    const firstRow = valid[0];
    const primary = metrics[0];
    const firstValue = firstRow.values[primary];
    const latestValue = latestRow.values[primary];
    const unit = latestRow.units[primary];
    const headline = firstValue !== null && latestValue !== null
      ? `${firstRow.year} ${formatMetricValue(firstValue, unit)} → ${latestRow.year} ${formatMetricValue(latestValue, unit)}`
      : `${latestRow.year} ${METRIC_LABELS[primary]}`;
    const latestRows = await statements(corp.code, latestRow.year, P(latestRow.year, base.kind, base.mode).code, fs);
    const rcept = latestRows?.find((r) => r.rcept_no)?.rcept_no ?? "";

    const series = metrics.length === 1
      ? matrix.map((row) => ({ year: row.year, period: row.period, mode: row.mode, value: row.values[primary], unit: row.units[primary], found: row.found, message: row.message }))
      : undefined;

    return {
      found: true as const,
      company: corp.name,
      period: parsed.recentYears
        ? `최근 ${parsed.recentYears}개년 · ${modeLabel(base)} · 기준일 ${baseDate(base)}`
        : `${periodLabel(periods[0])} ~ ${periodLabel(periods[periods.length - 1])} · ${modeLabel(base)}`,
      basis: fsLabel(fs),
      notice,
      metric: metrics.map((m) => METRIC_LABELS[m]).join(" · "),
      headline,
      lines: [
        metrics.length === 1
          ? `${METRIC_LABELS[primary]} ${valid.length}개년 추이`
          : `${metrics.map((m) => METRIC_LABELS[m]).join(" · ")} 연도별 비교`,
        `조회 기간: ${periodLabel(periods[0])} ~ ${periodLabel(periods[periods.length - 1])} · 동일 보고기간 기준`,
        metrics.length > 1 ? "여러 지표를 같은 연도·같은 보고기간으로 비교했습니다." : "",
      ].filter(Boolean),
      series,
      matrix: metrics.length > 1 ? matrix : undefined,
      formula: firstValue !== null && latestValue !== null && firstValue !== 0
        ? `첫해 대비 마지막 해 변화율: ${(((latestValue - firstValue) / Math.abs(firstValue)) * 100).toFixed(1)}%`
        : null,
      citation: citation(periodLabel(base), `손익계산서 > ${METRIC_LABELS[primary]}`, rcept),
      disclaimer: null,
      query: parsed,
    };
  }

  // 2) 올해/작년, 전년 대비, 증가·감소 원인 등 비교 질의.
  //    "올해"는 존재하지 않는 연간보고서를 강제로 만들지 않고 실제 최신 공시를 기준으로 한다.
  const needsComparison = parsed.analysis === "comparison" || parsed.analysis === "cause" || /올해|작년|지난해|전년도/.test(question);
  if (needsComparison) {
    const primary = metrics[0];
    let periods: Period[] = [];
    if (requestedYears.length >= 2) {
      const kind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual";
      periods = requestedYears.slice(0, 2).map((year) => P(year, kind));
    } else {
      const latest = await resolvePeriod(corp, periodCandidates(question), fs);
      if (!latest) return fail(`${corp.name}의 최신 공시 재무제표를 찾을 수 없습니다.`);
      periods = [P(latest.period.year - 1, latest.period.kind, latest.period.mode), latest.period];
    }

    const values: Array<{ year: number; period: Period; value: number; picked: any }> = [];
    for (const period of periods) {
      const rows = await statements(corp.code, period.year, period.code, fs);
      if (!rows) return fail(`${corp.name}의 ${periodLabel(period)} 자료를 찾을 수 없습니다.`);
      const picked = pickMetric(rows, period, primary);
      if (!picked) return fail(`${corp.name}의 ${periodLabel(period)} '${METRIC_LABELS[primary]}'을 찾지 못했습니다.`);
      values.push({ year: period.year, period, value: picked.value, picked });
    }

    const first = values[0];
    const second = values[1];
    const diff = second.value - first.value;
    const pct = first.value === 0 ? null : (diff / Math.abs(first.value)) * 100;
    const direction = diff > 0 ? "증가" : diff < 0 ? "감소" : "변동 없음";
    const rcept = (await statements(corp.code, second.period.year, second.period.code, fs))?.find((r) => r.rcept_no)?.rcept_no ?? "";
    const lines = [
      `${METRIC_LABELS[primary]} ${direction}: ${formatMetricValue(Math.abs(diff), second.picked.unit)}${pct === null ? "" : ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}`,
      `${periodLabel(first.period)} ${formatMetricValue(first.value, first.picked.unit)} → ${periodLabel(second.period)} ${formatMetricValue(second.value, second.picked.unit)}`,
      `비교 기준: 동일 보고기간·${fsLabel(fs)}`,
    ];
    if (parsed.hasCauseIntent) {
      lines.push(`원인 질문으로 해석했습니다. 재무제표 숫자만으로 원인을 단정하지 않고, 해당 보고서의 사업내용·매출 구성·주요 제품/지역별 실적을 근거로 설명해야 합니다.`);
    }
    return {
      found: true as const,
      company: corp.name,
      period: `${periodLabel(first.period)} vs ${periodLabel(second.period)} · ${modeLabel(second.period)}`,
      basis: fsLabel(fs),
      notice,
      metric: METRIC_LABELS[primary],
      headline: `${formatMetricValue(first.value, second.picked.unit)} → ${formatMetricValue(second.value, second.picked.unit)}`,
      lines,
      formula: second.picked.formula,
      citation: citation(periodLabel(second.period), second.picked.sourceHeading, rcept),
      disclaimer: second.picked.disclaimer,
      query: parsed,
    };
  }

  // 3) 단일 숫자 질의.
  const cands = periodCandidates(question);
  if (!cands.length) return fail("하반기만으로는 직접 조회할 수 없습니다. 1분기·반기·3분기·사업보고서 기준으로 질문해 주세요.");
  const resolved = await resolvePeriod(corp, cands, fs);
  if (!resolved) return fail(`해당 자료를 찾을 수 없습니다. (${corp.name} · ${cands.map(periodLabel).join(" / ")} · ${fsLabel(fs)})`);
  const { period, rows } = resolved;
  const metric = metrics[0];
  const picked = pickMetric(rows, period, metric);
  if (!picked) return fail(`${corp.name}의 '${METRIC_LABELS[metric]}' 계정을 ${periodLabel(period)}에서 찾지 못했습니다.`);
  const rcept = rows.find((r) => r.rcept_no)?.rcept_no ?? "";
  return {
    found: true as const,
    company: corp.name,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    basis: fsLabel(fs),
    notice,
    metric: METRIC_LABELS[metric],
    headline: formatMetricValue(picked.value, picked.unit),
    lines: picked.lines,
    formula: picked.formula,
    citation: citation(periodLabel(period), picked.sourceHeading, rcept),
    disclaimer: picked.disclaimer,
    query: parsed,
  };
}

function formatMetricValue(value: number, unit: string) {
  if (unit === "%") return `${value.toFixed(1)}%`;
  return `${Math.round(value).toLocaleString("ko-KR")}${unit}`;
}

