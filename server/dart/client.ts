import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import { extractInitialViewerArgs, parseViewerDeepLinkHtml } from "./viewerLink";
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
  unzipAll,
  type Corp,
  type FinancialMetric,
  type Kind,
  type Period,
  type Row,
} from "./engine";

const BASE = "https://opendart.fss.or.kr/api";
const won = (v: number) => !Number.isFinite(v) ? "자료 없음" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
let corpCache: { at: number; map: Map<string, Corp> } | null = null;
const stmtCache = new Map<string, { at: number; rows: Row[] | null }>();
const filingCache = new Map<string, { at: number; filing: { rceptNo: string; reportName: string; receiptDate: string } | null }>();
const documentCache = new Map<string, { at: number; text: string }>();
const documentEntriesCache = new Map<string, { at: number; entries: Array<{ name: string; text: string }> }>();
const filingInFlight = new Map<string, Promise<{ rceptNo: string; reportName: string; receiptDate: string } | null>>();
const historyInFlight = new Map<string, Promise<ReturnType<typeof historyResponseShape>>>();
const historyCache = new Map<string, { at: number; value: ReturnType<typeof historyResponseShape> }>();
const deepLinkCache = new Map<string, { at: number; value: { url: string; deepLinked: boolean; sectionTitle: string; message: string } }>();

function historyResponseShape(points: Array<{ period: string; rceptNo?: string; basisCode: "CFS" | "OFS"; revenue: number; operatingProfit: number; netIncome?: number; separateOperatingProfit?: number; subsidiaryAndAdjProfit?: number; isFourthQuarterDerived?: boolean }>, failures: string[]) {
  return { points, failures };
}

async function dartFetch(input: string | URL, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/** DART 본문 응답의 charset을 존중해 목차 제목이 깨져 링크 추출에 실패하지 않도록 합니다. */
async function readDartHtml(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const declared = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() ?? "";
  const decode = (label: string) => {
    try { return new TextDecoder(label).decode(bytes); } catch { return ""; }
  };
  const declaredLabel = /euc-kr|ks_c_5601|949/.test(declared) ? "euc-kr" : /utf-?8/.test(declared) ? "utf-8" : declared;
  const candidates = [...new Set([declaredLabel, "utf-8", "euc-kr"].filter(Boolean))]
    .map((label) => ({ label, text: decode(label) }))
    .filter((item) => item.text.length > 0);
  const score = (text: string) => {
    const keyPhrases = (text.match(/연결재무제표|별도재무제표|재무상태표|손익계산서|현금흐름표|viewDoc|TreeNode/g) ?? []).length;
    const replacements = (text.match(/�/g) ?? []).length;
    const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
    return keyPhrases * 100 + Math.min(500, (text.match(/[가-힣]/g) ?? []).length) - replacements * 25 - controls * 5;
  };
  // 응답의 charset 선언이 틀린 DART 페이지도 있어, 한글 재무제표 제목과 뷰어 호출을 가장 잘 복원하는 디코딩을 사용합니다.
  return candidates.sort((a, b) => score(b.text) - score(a.text))[0]?.text ?? "";
}

type DartFiling = { corp_code: string; corp_name: string; report_nm: string; rcept_no: string; rcept_dt: string };

function key(requestKey?: string) {
  const candidate = requestKey?.trim();
  // 요청에 키가 전달되었으면 유효하지 않은/데모용 문자열로 서버 키에 우회하지 않습니다.
  if (candidate) {
    if (!/^[A-Za-z0-9]{40}$/.test(candidate) || /^(DEMO|VERIFIED)/i.test(candidate)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "실제 OpenDART 인증키 40자리가 필요합니다. 데모 키로 우회 조회하지 않습니다." });
    }
    return candidate;
  }
  if (!ENV.opendartApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OpenDART 인증키가 없습니다. 화면에서 발급받은 인증키를 저장하거나 서버 .env에 OPENDART_API_KEY를 설정하세요." });
  }
  return ENV.opendartApiKey;
}

async function corps(force = false, requestKey?: string) {
  if (!force && corpCache && Date.now() - corpCache.at < 864e5) return corpCache.map;
  const res = await dartFetch(`${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key(requestKey))}`, {}, 15_000);
  if (!res.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 기업코드 조회 실패: HTTP ${res.status}` });
  const map = parseCorps(unzipFirst(Buffer.from(await res.arrayBuffer())));
  corpCache = { at: Date.now(), map };
  return map;
}

function expectedReportPattern(year: number, reprt: string): RegExp {
  const month = reprt === "11011" ? "12" : reprt === "11012" ? "06" : reprt === "11013" ? "03" : "09";
  const type = reprt === "11011" ? "사업보고서" : reprt === "11012" ? "반기보고서" : "분기보고서";
  return new RegExp(`${type}.*${year}[.\-/]?${month}`);
}

async function lookupFilingForPeriod(code: string, year: number, reprt: string, requestKey?: string) {
  const cacheKey = `${code}-${year}-${reprt}`;
  const cached = filingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.filing;
  const nowYear = new Date().getFullYear();
  // 해당 회계기간에 맞는 공시 접수연도만 검색합니다. 여러 해를 한꺼번에 검색해
  // 최신 100건에 밀려 과거 분기 접수번호를 놓치는 일을 줄입니다.
  const startYear = reprt === "11011" ? year + 1 : year;
  if (startYear > nowYear) { filingCache.set(cacheKey, { at: Date.now(), filing: null }); return null; }
  const endYear = Math.min(nowYear, startYear);
  const params = new URLSearchParams({
    crtfc_key: key(requestKey), corp_code: code,
    bgn_de: `${startYear}0101`, end_de: `${Math.max(startYear, endYear)}1231`,
    last_reprt_at: "Y", pblntf_ty: "A", page_no: "1", page_count: "100",
    sort: "date", sort_mth: "desc",
  });
  const response = await dartFetch(`${BASE}/list.json?${params}`, {}, 8_000);
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 공시목록 조회 실패: HTTP ${response.status}` });
  const json = await response.json() as { status: string; message?: string; list?: DartFiling[] };
  if (json.status !== "000" && json.status !== "013") {
    throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 공시목록 ${json.status}: ${json.message ?? "조회 실패"}` });
  }
  const pattern = expectedReportPattern(year, reprt);
  const typeOnly = reprt === "11011" ? /사업보고서/ : reprt === "11012" ? /반기보고서/ : /분기보고서/;
  const matching = (json.list ?? []).filter((item) => {
    if (!/^\d{14}$/.test(item.rcept_no ?? "")) return false;
    if (!typeOnly.test(item.report_nm ?? "")) return false;
    return pattern.test(item.report_nm ?? "");
  }).sort((a, b) => (b.rcept_dt ?? "").localeCompare(a.rcept_dt ?? ""));
  const filing = matching[0] ? { rceptNo: matching[0].rcept_no, reportName: matching[0].report_nm, receiptDate: matching[0].rcept_dt } : null;
  filingCache.set(cacheKey, { at: Date.now(), filing });
  return filing;
}

async function filingForPeriod(code: string, year: number, reprt: string, requestKey?: string) {
  const cacheKey = `${code}-${year}-${reprt}`;
  const cached = filingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.filing;
  const inflight = filingInFlight.get(cacheKey);
  if (inflight) return inflight;
  const pending = lookupFilingForPeriod(code, year, reprt, requestKey);
  filingInFlight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    if (filingInFlight.get(cacheKey) === pending) filingInFlight.delete(cacheKey);
  }
}

async function statements(code: string, year: number, reprt: string, fs: "CFS" | "OFS", force = false, requestKey?: string): Promise<Row[] | null> {
  const k = `${code}-${year}-${reprt}-${fs}`;
  const hit = stmtCache.get(k);
  if (!force && hit && Date.now() - hit.at < 36e5) return hit.rows;
  const currentKey = key(requestKey);
  const url = `${BASE}/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(currentKey)}&corp_code=${encodeURIComponent(code)}&bsns_year=${year}&reprt_code=${reprt}&fs_div=${fs}`;
  // 재무제표와 접수번호를 병렬 조회합니다. 과거 4개년 시계열에서 각 요청을 순차 대기하면
  // 40건 이상이 연쇄 대기해 화면이 장시간 로딩 상태에 머물 수 있습니다.
  const [response, filing] = await Promise.all([
    dartFetch(url, {}, 8_000),
    filingForPeriod(code, year, reprt, requestKey),
  ]);
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `DART 재무제표 조회 실패: HTTP ${response.status}` });
  const json = await response.json() as { status: string; message?: string; list?: Row[] };
  if (json.status !== "000" && json.status !== "013") {
    throw new TRPCError({ code: "BAD_GATEWAY", message: `DART ${json.status}: ${json.message ?? "조회 실패"}` });
  }
  if (json.status === "013" || !(json.list?.length)) {
    stmtCache.set(k, { at: Date.now(), rows: null });
    return null;
  }
  // 재무제표 본문 API 응답만 믿고 가짜 접수번호를 만들지 않습니다. 공시검색 API에 실재하는 접수번호가 있어야 합니다.
  if (!filing) {
    stmtCache.set(k, { at: Date.now(), rows: null });
    return null;
  }
  const rows = (json.list ?? []).map((row) => ({ ...row, rcept_no: filing.rceptNo }));
  stmtCache.set(k, { at: Date.now(), rows });
  return rows;
}

function normAccount(s: string) { return s.replace(/[\s·ㆍ]/g, ""); }

const DIRECT_ACCOUNT_SPECS: Record<string, { sj: string[]; names: string[]; ids?: RegExp[]; exclude?: RegExp[] }> = {
  자산총계: { sj: ["BS"], names: ["자산총계", "총자산"], ids: [/^ifrs-full_Assets$/i, /^(?:dart_)?TotalAssets$/i] },
  부채총계: { sj: ["BS"], names: ["부채총계", "총부채"], ids: [/^ifrs-full_Liabilities$/i, /^(?:dart_)?TotalLiabilities$/i] },
  자본총계: { sj: ["BS"], names: ["자본총계", "총자본", "자본총계(지배기업의소유주에게귀속되는자본포함)"], ids: [/^ifrs-full_Equity$/i, /^(?:dart_)?TotalEquity$/i], exclude: [/지배기업소유주에게귀속되는자본$/] },
  유동자산: { sj: ["BS"], names: ["유동자산", "유동자산합계"], ids: [/^ifrs-full_CurrentAssets$/i] },
  유동부채: { sj: ["BS"], names: ["유동부채", "유동부채합계"], ids: [/^ifrs-full_CurrentLiabilities$/i] },
  현금및현금성자산: { sj: ["BS"], names: ["현금및현금성자산", "현금과현금성자산", "현금및현금성자산합계"], ids: [/^ifrs-full_CashAndCashEquivalents$/i] },
  단기금융상품: { sj: ["BS"], names: ["단기금융상품", "단기투자자산", "단기예치금", "단기금융자산"], ids: [/ShortTermDepositsNotClassifiedAsCashEquivalents/i] },
  매출채권: { sj: ["BS"], names: ["매출채권", "매출채권및기타채권", "매출채권및기타유동채권", "유동매출채권"], ids: [/TradeAndOtherCurrentReceivables/i], exclude: [/대손충당금|손상차손누계|기대신용손실충당금/] },
  재고자산: { sj: ["BS"], names: ["재고자산", "유동재고자산", "재고자산합계"], ids: [/^ifrs-full_Inventories$/i] },
  매입채무: { sj: ["BS"], names: ["매입채무", "매입채무및기타채무", "매입채무및기타유동채무", "유동매입채무", "매입채무합계"], ids: [/TradeAndOtherCurrentPayables/i], exclude: [/미지급금|충당부채|리스부채/] },
  단기차입금: { sj: ["BS"], names: ["단기차입금", "단기차입금및회사채", "단기대출금", "단기금융부채"], ids: [/ShorttermBorrowings|CurrentFinancialInstitutionBorrowings/i], exclude: [/리스부채/] },
  유동성장기부채: { sj: ["BS"], names: ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분", "유동성장기부채및사채"], ids: [/CurrentPortionOfLongtermBorrowings|CurrentPortionOfLongtermFinancialLiabilities/i], exclude: [/리스부채/] },
  사채: { sj: ["BS"], names: ["사채", "회사채", "비유동사채"], ids: [/^ifrs-full_BondsIssued$/i], exclude: [/유동성|리스|할인발행차금/] },
  장기차입금: { sj: ["BS"], names: ["장기차입금", "장기대출금", "비유동차입금", "장기차입부채"], ids: [/LongtermBorrowings|LongTermBorrowings|LongtermLoansAndBorrowings|LongTermLoansAndBorrowings|NoncurrentBorrowings|NoncurrentLoansAndBorrowings/i], exclude: [/리스부채|유동성|사채할인발행차금|차입금할인발행차금/] },
  금융원가: { sj: ["IS", "CIS"], names: ["금융원가", "금융비용", "이자비용"], ids: [/^ifrs-full_FinanceCosts$/i], exclude: [/금융수익/] },
};

export function pickDirectAccount(rows: Row[], period: Period, term: string) {
  const legacyAliases: Record<string, string[]> = {
    유동성장기부채: ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분", "유동성장기부채및사채"],
    유동매출채권: ["유동매출채권"], 비유동매출채권: ["비유동매출채권"],
    이익잉여금: ["이익잉여금", "이익잉여금(결손금)"],
    투자활동현금흐름: ["투자활동으로인한현금흐름", "투자활동현금흐름", "투자활동순현금흐름"],
    재무활동현금흐름: ["재무활동으로인한현금흐름", "재무활동현금흐름", "재무활동순현금흐름"],
    영업현금흐름: ["영업활동으로인한현금흐름", "영업활동현금흐름", "영업활동순현금흐름"],
    매출액: ["매출액", "수익(매출액)", "영업수익"],
    영업이익: ["영업이익", "영업손익"],
    순이익: ["당기순이익", "당기순이익(손실)", "당기순손익", "반기순이익", "분기순이익"],
  };
  const spec = DIRECT_ACCOUNT_SPECS[term];
  const targetNames = (spec?.names ?? legacyAliases[term] ?? [term]).map(normAccount);
  const eligible = rows.filter((row) => {
    if (spec && !spec.sj.includes(row.sj_div ?? "")) return false;
    if (!spec && term === "영업현금흐름" && row.sj_div !== "CF") return false;
    if (!spec && term === "투자활동현금흐름" && row.sj_div !== "CF") return false;
    if (!spec && term === "재무활동현금흐름" && row.sj_div !== "CF") return false;
    if (!spec && (term === "매출액" || term === "영업이익" || term === "순이익") && !["IS", "CIS"].includes(row.sj_div ?? "")) return false;
    const name = normAccount(row.account_nm ?? "");
    const id = row.account_id ?? "";
    if (spec?.exclude?.some((pattern) => pattern.test(name))) return false;
    return targetNames.some((target) => name === target || name.startsWith(target)) || Boolean(spec?.ids?.some((pattern) => pattern.test(id)));
  });
  const ranked = eligible.map((row) => {
    const name = normAccount(row.account_nm ?? "");
    const id = row.account_id ?? "";
    const exact = targetNames.some((target) => name === target);
    const idMatch = Boolean(spec?.ids?.some((pattern) => pattern.test(id)));
    const prefix = targetNames.some((target) => name.startsWith(target));
    const score = exact ? 0 : idMatch ? 1 : prefix ? 2 : 3;
    const isFlow = ["IS", "CIS", "CF"].includes(row.sj_div ?? "");
    const raw = isFlow && period.mode === "cum" ? (row.thstrm_add_amount || row.thstrm_amount || "") : (row.thstrm_amount || row.thstrm_add_amount || "");
    const cleaned = raw.replace(/,/g, "").trim();
    let value: number | null = null;
    if (/^(?:-|—|–|－|−)$/.test(cleaned)) value = 0; // 원문에 명시된 대시만 0
    else if (cleaned) {
      const parenthesized = /^\(.*\)$/.test(cleaned);
      const numeric = Number(parenthesized ? `-${cleaned.slice(1, -1)}` : cleaned);
      if (Number.isFinite(numeric)) value = numeric / 1e8;
    }
    return { row, score, value };
  }).sort((a, b) => a.score - b.score || normAccount(a.row.account_nm ?? "").length - normAccount(b.row.account_nm ?? "").length);
  const selected = ranked.find((item) => item.value !== null && Number.isFinite(item.value));
  if (!selected) return null;
  const { row, value } = selected;
  return {
    value: value!, unit: "억원",
    lines: [`원천 계정: ${row.account_nm}`, `계정코드: ${row.account_id || "DART 응답에 계정코드 없음"}`, `회계기준: ${row.sj_div === "BS" ? "재무상태표 기말 잔액" : row.sj_div === "CF" ? "현금흐름표" : "손익계산서"}`, `공시 금액: ${row.thstrm_add_amount || row.thstrm_amount || "공시 금액 미기재"}원`],
    formula: null, disclaimer: null,
    sourceHeading: `${row.sj_div === "BS" ? "재무상태표" : row.sj_div === "CF" ? "현금흐름표" : "손익계산서"} > ${row.account_nm}`,
  };
}

function pickRawAccountMetrics(rows: Row[], period: Period, rceptNo: string) {
  return Object.fromEntries(Object.keys(DIRECT_ACCOUNT_SPECS).map((label) => {
    const picked = pickDirectAccount(rows, period, label);
    return [label, picked ? { ...picked, citation: citation(periodLabel(period), picked.sourceHeading, rceptNo), available: Number.isFinite(picked.value) } : null];
  }));
}


type GrossBorrowingComponent = { group: string; account: string; value: number; row: Row };

/**
 * 총차입금/차입금의존도용 차입성 부채 집계.
 * 순차입금(netDebt)의 기존 정책(리스부채 제외)은 이 함수에 영향을 받지 않습니다.
 * 완전한 BS 응답에서 확인된 구성 계정만 합산하고, 애매한 '차입금및사채' 단일 행은 총계로 간주하지 않습니다.
 */
function grossBorrowingComponents(rows: Row[]): { items: GrossBorrowingComponent[]; coreFound: number; coreComplete: boolean; fullBalanceSheet: boolean; total: number; missing: string[]; combinedRow: Row | null } {
  const bsRows = rows.filter((row) => row.sj_div === "BS");
  const normalize = (value?: string) => (value ?? "").replace(/[\s·ㆍ]/g, "");
  const excluded = /사채할인발행차금|차입금할인발행차금|미상각할인차금|할인발행차금|상환할증금|사채발행비|총차입금|차입금총계|차입금합계|총차입부채|차입금및사채|차입금및회사채|차입금과사채/;
  const groups: Array<{ group: string; aliases: string[]; ids: RegExp[]; lease?: boolean; preferAggregate?: string[]; preferSingle?: string[] }> = [
    { group: "단기차입금", aliases: ["단기차입금", "단기차입부채", "단기금융기관차입금", "단기은행차입금", "단기대출금", "유동차입금"], ids: [/ShorttermBorrowings|ShortTermBorrowings|ShorttermLoansAndBorrowings|ShortTermLoansAndBorrowings|CurrentBorrowings|BorrowingsCurrent|CurrentLoansAndBorrowings|LoansAndBorrowingsCurrent/i], preferSingle: ["단기차입금", "단기차입부채"] },
    { group: "유동성장기부채", aliases: ["유동성장기부채", "유동성장기차입금", "유동성장기차입부채", "유동성장기금융부채", "유동성금융기관차입금", "유동성차입부채", "유동성차입금", "비유동차입금의유동성대체부분", "유동성장기부채및사채", "유동성사채", "유동성장기사채", "유동성전환사채", "유동성신주인수권부사채", "유동성교환사채"], ids: [/CurrentPortionOfLongtermBorrowings|CurrentPortionOfLongTermBorrowings|CurrentPortionOfLongtermFinancialLiabilities|CurrentMaturitiesOfLongtermBorrowings|CurrentFinancialInstitutionBorrowings/i], preferAggregate: ["유동성장기부채", "유동성장기부채및사채"] },
    { group: "장기차입금", aliases: ["장기차입금", "장기차입부채", "장기금융기관차입금", "장기금융부채", "장기대출금", "비유동차입금", "비유동차입부채"], ids: [/LongtermBorrowings|LongTermBorrowings|LongtermLoansAndBorrowings|LongTermLoansAndBorrowings|NoncurrentBorrowings|NoncurrentLoansAndBorrowings|LongTermDebtNoncurrent/i], preferAggregate: ["장기차입금", "장기차입부채", "장기금융부채", "비유동차입금", "비유동차입부채"] },
    { group: "사채", aliases: ["사채", "회사채", "비유동사채", "전환사채", "신주인수권부사채", "교환사채", "단기사채"], ids: [/^ifrs-full_BondsIssued$|ConvertibleBondsIssued|DebenturesIssued|BondsPayable/i], preferSingle: ["사채", "회사채"] },
    { group: "유동리스부채", aliases: ["유동리스부채", "유동성리스부채", "유동리스부채합계", "유동성리스부채합계"], ids: [/CurrentLeaseLiabilities|LeaseLiabilitiesCurrent/i], lease: true, preferSingle: ["유동리스부채", "유동성리스부채"] },
    { group: "비유동리스부채", aliases: ["비유동리스부채", "장기리스부채", "비유동리스부채합계"], ids: [/NoncurrentLeaseLiabilities|LeaseLiabilitiesNoncurrent/i], lease: true, preferSingle: ["비유동리스부채", "장기리스부채"] },
  ];
  const candidatesFor = (spec: typeof groups[number]) => bsRows.flatMap((row) => {
    const account = normalize(row.account_nm);
    const id = row.account_id ?? "";
    if (!account && !spec.ids.some((pattern) => pattern.test(id))) return [];
    if (!spec.lease && account.includes("리스")) return [];
    if (excluded.test(account)) return [];
    if (spec.group === "사채" && account.startsWith("유동성")) return [];
    if (spec.group === "장기차입금" && (account.startsWith("유동성") || /CurrentPortion/i.test(id))) return [];
    if (spec.lease && !/리스/i.test(account) && !spec.ids.some((pattern) => pattern.test(id))) return [];
    const aliasIndex = spec.aliases.findIndex((alias) => account === alias || account.startsWith(alias));
    const idMatch = spec.ids.some((pattern) => pattern.test(id));
    if (aliasIndex < 0 && !idMatch) return [];
    const raw = (row.thstrm_amount ?? "").replace(/,/g, "").trim();
    const value = /^[-—–－−]$/.test(raw) ? 0 : amountOf(row);
    if (value === null || !Number.isFinite(value)) return [];
    return [{ row, value, account, aliasIndex, idMatch, accountLength: account.length }];
  }).sort((a, b) => a.aliasIndex - b.aliasIndex || a.accountLength - b.accountLength);

  const selectGroupRows = (spec: typeof groups[number]) => {
    const candidates = candidatesFor(spec);
    if (!candidates.length) return [] as typeof candidates;
    // 공시가 범용 합계 행을 주면 그것을 사용하고 세부 계정을 더하지 않아 중복 합산을 막습니다.
    if (spec.preferAggregate?.length) {
      for (const alias of spec.preferAggregate) {
        const found = candidates.filter((item) => item.account === alias || item.account.startsWith(alias)).sort((a, b) => a.accountLength - b.accountLength)[0];
        if (found) return [found];
      }
    }
    // 이름이 같은 계정코드 변형이 여러 개 있으면 하나만 고르되, 상이한 세부 계정은 함께 합산합니다.
    if (spec.preferSingle?.length) {
      for (const alias of spec.preferSingle) {
        const found = candidates.filter((item) => item.account === alias || item.account.startsWith(alias)).sort((a, b) => a.accountLength - b.accountLength)[0];
        if (found) {
          if (spec.group === "사채" || spec.lease || (spec.group === "단기차입금" && ["단기차입금", "단기차입부채"].includes(alias))) return [found];
          // 유동성 금융기관 차입금(사채 제외)과 유동성 사채처럼 별도 계정인 항목은 같이 집계합니다.
          if (spec.group === "단기차입금") return [found, ...candidates.filter((item) => item.row !== found.row && !["단기차입금", "단기차입부채"].includes(item.account))];
        }
      }
    }
    const uniqueRows = new Set<Row>();
    return candidates.filter((item) => {
      if (uniqueRows.has(item.row)) return false;
      uniqueRows.add(item.row);
      return true;
    });
  };

  const coreSpecs = groups.filter((spec) => !spec.lease);
  const selectedCore = coreSpecs.map((spec) => ({ spec, selected: selectGroupRows(spec) }));
  const coreItems: GrossBorrowingComponent[] = selectedCore.flatMap(({ spec, selected }) => selected.map((found) => ({ group: spec.group, account: (found.row.account_nm ?? spec.group).trim(), value: found.value, row: found.row })));
  // 장기차입금 계정에 사채가 포함됐다고 명시되면 별도 사채 계정을 중복으로 더하지 않습니다.
  const longTermIncludesBonds = coreItems.some((item) => item.group === "장기차입금" && /(?:장기차입금|비유동차입금|장기차입부채).*사채.*포함|(?:장기차입금|비유동차입금|장기차입부채).*포함.*사채/.test(normalize(item.account)));
  const filteredCore = longTermIncludesBonds ? coreItems.filter((item) => item.group !== "사채") : coreItems;

  const leaseSpecs = groups.filter((spec) => spec.lease);
  let leaseItems: GrossBorrowingComponent[] = leaseSpecs.flatMap((spec) => selectGroupRows(spec).map((found) => ({ group: spec.group, account: (found.row.account_nm ?? spec.group).trim(), value: found.value, row: found.row })));
  // '리스부채'만 단독 계정으로 제공하는 공시도 지원하되 구성 행이 있으면 합계 행을 더하지 않습니다.
  if (!leaseItems.length) {
    const genericLease = bsRows.flatMap((row) => {
      const name = normalize(row.account_nm);
      if (!/^(?:리스부채|리스부채합계|리스부채총계)$/.test(name)) return [];
      const value = amountOf(row);
      return value === null || !Number.isFinite(value) ? [] : [{ group: "리스부채", account: (row.account_nm ?? "리스부채").trim(), value, row }];
    })[0];
    if (genericLease) leaseItems = [genericLease];
  }
  const usedRows = new Set<Row>();
  const items = [...filteredCore, ...leaseItems].filter((item) => {
    if (usedRows.has(item.row)) return false;
    usedRows.add(item.row);
    return true;
  });
  const normalizeTotals = (value?: string) => normalize(value);
  const hasTotal = (names: string[]) => bsRows.some((row) => names.includes(normalizeTotals(row.account_nm)) && amountOf(row) !== null);
  const fullBalanceSheet = hasTotal(["자산총계", "총자산"]) && hasTotal(["부채총계", "총부채"]) && hasTotal(["자본총계", "총자본", "자본과부채총계"]) && bsRows.length >= 6;
  const coreFound = selectedCore.filter((item) => item.selected.length > 0).length;
  // '차입금및사채'처럼 차입금과 사채를 한 줄로 묶어 공시하는 계정(구성 계정이 따로 없을 때만 합계로 사용).
  const combinedRow = bsRows.find((row) => /^(?:차입금및사채|차입금및회사채|차입금과사채|차입금및사채합계)$/.test(normalize(row.account_nm)) && (() => { const v = amountOf(row); return v !== null && Number.isFinite(v); })()) ?? null;
  return {
    items, coreFound, coreComplete: selectedCore.every((item) => item.selected.length > 0), fullBalanceSheet,
    total: items.reduce((sum, item) => sum + item.value, 0),
    missing: selectedCore.filter((item) => item.selected.length === 0).map((item) => item.spec.group),
    combinedRow,
  };
}

function pickGrossBorrowingMetric(rows: Row[], metric: "borrowings" | "borrowingsRatio"): PickedMetric | null {
  const bsRows = rows.filter((row) => row.sj_div === "BS");
  const normalize = (value?: string) => (value ?? "").replace(/[\s·ㆍ]/g, "");
  const aggregateNames = new Set(["총차입금", "차입금총계", "차입금합계", "총차입부채", "총이자부부채", "이자부부채합계"]);
  const aggregateRow = bsRows.find((row) => aggregateNames.has(normalize(row.account_nm)) && !normalize(row.account_nm).includes("리스"));
  const aggregateValue = aggregateRow ? amountOf(aggregateRow) : null;
  const components = grossBorrowingComponents(rows);
  let totalBorrowings = Number.NaN;
  let lines: string[] = [];
  let formula = "총차입금 = 공시된 차입성 부채 계정 합계(유동·비유동 리스부채 포함)";
  let disclaimer: string | null = null;
  let sourceHeading = "재무상태표 > 차입금 구성 계정";

  if (aggregateRow && aggregateValue !== null && Number.isFinite(aggregateValue) && aggregateValue >= 0) {
    // 공시가 총차입금 합계 계정을 직접 제공하면 그 값을 사용합니다.
    totalBorrowings = aggregateValue;
    lines = [`분자 · DART 공시 합계 계정 ${aggregateRow.account_nm}: ${won(aggregateValue)}`];
    sourceHeading = `재무상태표 > ${aggregateRow.account_nm}`;
    if (components.coreComplete) {
      const difference = Math.abs(components.total - aggregateValue);
      lines.push(`구성 계정 합계(리스부채 포함): ${won(components.total)}`, `차이: ${won(difference)}`);
      // 값을 숨기지 않고 공시 합계로 계산하되, 범위(리스부채 포함 여부 등) 차이 가능성을 안내합니다.
      if (difference > Math.max(1, Math.abs(aggregateValue) * 0.01)) {
        disclaimer = "공시 총차입금 합계와 구성 계정 합계가 1% 또는 1억원을 초과해 불일치합니다(범위 차이·리스부채 포함 여부 가능). 공시 합계 계정 기준으로 표시했으며 원문 확인을 권장합니다.";
      }
    }
  } else if (components.coreFound > 0) {
    // 확인된 차입금 계정들을 그대로 합산합니다. 확인되지 않은 계정은 0으로 넣지 않고 합계에서 제외하며 안내만 남깁니다.
    totalBorrowings = components.total;
    lines = components.items.map((item) => `구성 · ${item.account}: ${won(item.value)}`);
    lines.push(`분자 · 확인된 차입성 부채 합계(리스부채 포함): ${won(totalBorrowings)}`);
    if (components.missing.length) {
      lines.push(`공시에서 별도 행이 확인되지 않은 계정(합계에서 제외): ${components.missing.join(", ")}`);
      disclaimer = `공시에 별도 행이 없거나 누락된 계정(${components.missing.join(", ")})은 합계에서 제외했습니다. 확인된 계정만 합산한 값입니다.`;
    }
    if (components.combinedRow) lines.push(`참고 · '${components.combinedRow.account_nm}' 행은 구성 계정과의 중복 합산을 막기 위해 제외`);
    sourceHeading = "재무상태표 > 차입금·사채·리스부채 구성 계정";
  } else if (components.combinedRow) {
    const combined = amountOf(components.combinedRow) as number;
    totalBorrowings = combined;
    lines = [`분자 · 공시 계정 ${components.combinedRow.account_nm}: ${won(combined)}`];
    disclaimer = `별도 구성 계정이 없어 '${components.combinedRow.account_nm}' 행 전체를 총차입금으로 사용했습니다. 리스부채는 포함되지 않았을 수 있습니다.`;
    sourceHeading = `재무상태표 > ${components.combinedRow.account_nm}`;
  } else {
    const missing = components.missing.join(", ") || "차입금 구성 계정";
    return {
      value: Number.NaN, unit: metric === "borrowingsRatio" ? "%" : "억원",
      lines: ["재무상태표에서 차입금·사채 계정을 찾지 못했습니다.", `누락 계정: ${missing}`],
      formula: metric === "borrowingsRatio" ? "차입금의존도 = 총차입금 ÷ 자산총계 × 100" : formula,
      disclaimer: `재무상태표에서 차입금 관련 계정이 확인되지 않아(누락: ${missing}) 계산하지 않았습니다. 임의로 0원 처리하지 않았습니다.`,
      sourceHeading,
    };
  }

  if (metric === "borrowings") return { value: totalBorrowings, unit: "억원", lines, formula, disclaimer, sourceHeading };
  const assetsRow = findRowLike(rows, ["BS"], ["자산총계", "총자산"]);
  const assets = assetsRow ? amountOf(assetsRow) : null;
  if (assets === null || !Number.isFinite(assets) || assets <= 0 || !Number.isFinite(totalBorrowings)) {
    return { value: Number.NaN, unit: "%", lines: [...lines, "분모 · 자산총계 확인 실패"], formula: "차입금의존도 = 총차입금 ÷ 자산총계 × 100", disclaimer: "자산총계가 확인되지 않아 차입금 의존도를 계산하지 않았습니다.", sourceHeading };
  }
  const ratio = totalBorrowings / assets * 100;
  lines.push(`분모 · 자산총계: ${won(assets)}`, `계산 · ${won(totalBorrowings)} ÷ ${won(assets)} × 100 = ${ratio.toFixed(2)}%`);
  return { value: ratio, unit: "%", lines, formula: "차입금의존도 = (차입금 + 사채 + 유동·비유동 리스부채) ÷ 자산총계 × 100", disclaimer, sourceHeading: `${sourceHeading}·자산총계` };
}

type PickedMetric = { value: number; unit: string; lines: string[]; formula: string | null; disclaimer: string | null; sourceHeading: string };

export function pickMetric(rows: Row[], period: Period, metric: FinancialMetric): PickedMetric | null {
  if (metric === "borrowings" || metric === "borrowingsRatio") {
    return pickGrossBorrowingMetric(rows, metric);
  }

  if (metric === "netDebt") {
    const result = netDebt(rows);
    if (!result.ok) return {
      value: Number.NaN,
      unit: "억원",
      lines: [`확인된 계정: ${result.items.map((item) => `${item.sign} ${item.account} ${won(item.amount)}`).join(" · ") || "없음"}`, `누락 계정: ${result.missing.join(", ")}`],
      formula: "순차입금 = 총차입금(리스부채 제외) − 현금성 자산·단기금융상품",
      disclaimer: `순차입금 계산에 필요한 계정이 누락되었습니다: ${result.missing.join(", ")}. 누락값을 0으로 간주하지 않습니다.`,
      sourceHeading: "재무상태표 > 차입금·현금 계정",
    };
    return {
      value: result.value, unit: "억원",
      lines: result.items.map((item) => `${item.sign} ${item.account} ${won(item.amount)}`),
      formula: result.formula, disclaimer: result.disclaimer, sourceHeading: "재무상태표 > 차입금·현금 계정",
    };
  }

  if (metric === "workingCapital") {
    const receivable = findRowLike(rows, ["BS"], ["매출채권", "매출채권및기타채권", "유동매출채권"]);
    const inventory = findRowLike(rows, ["BS"], ["재고자산", "유동재고자산"]);
    const payable = findRowLike(rows, ["BS"], ["매입채무", "매입채무및기타채무", "유동매입채무"]);
    const receivablesValue = receivable ? amountOf(receivable) : null;
    const inventoryValue = inventory ? amountOf(inventory) : null;
    const payableValue = payable ? amountOf(payable) : null;
    if (receivablesValue === null || inventoryValue === null || payableValue === null) return null;
    return {
      value: receivablesValue + inventoryValue - payableValue,
      unit: "억원",
      lines: [`매출채권 ${won(receivablesValue)} + 재고자산 ${won(inventoryValue)} − 매입채무 ${won(payableValue)}`],
      formula: "운전자본 = 매출채권 + 재고자산 − 매입채무",
      disclaimer: "기업별 계정 분류에 따라 구성 계정이 달라질 수 있으며, 본 화면은 프로젝트에 정의된 운전자본 공식을 적용합니다.",
      sourceHeading: "재무상태표 > 매출채권·재고자산·매입채무",
    };
  }

  if (metric === "payables") {
    const row = findRowLike(rows, ["BS"], ["매입채무", "매입채무및기타채무", "유동매입채무"]);
    const value = row ? amountOf(row) : null;
    if (value === null || !row) return null;
    return { value, unit: "억원", lines: [`원천 계정: ${row.account_nm} ${won(value)}`], formula: null, disclaimer: null, sourceHeading: `재무상태표 > ${row.account_nm}` };
  }

  if (metric === "capex") {
    const row = findRowLike(rows, ["CF"], metricConfig.capex.names);
    const rawValue = row ? amountOf(row, 0, period.mode === "cum") : null;
    if (!row || rawValue === null || !Number.isFinite(rawValue)) return null;
    // 현금흐름표의 유형자산 취득은 일반적으로 현금 유출(음수)입니다. CAPEX는 지출 규모로 양수화하여 FCF 계산과 맞춥니다.
    const value = Math.abs(rawValue);
    return { value, unit: "억원", lines: [`원천 계정: ${row.account_nm} ${won(rawValue)}`, `CAPEX 지출 규모: ${won(value)}`], formula: "CAPEX = 현금흐름표의 유형자산 취득 현금유출 절댓값", disclaimer: null, sourceHeading: "현금흐름표 > 유형자산 취득" };
  }

  if (metric === "freeCashFlow") {
    const cashFlow = pickMetric(rows, period, "operatingCashFlow");
    const capex = pickMetric(rows, period, "capex");
    if (!cashFlow || !capex) return null;
    return {
      value: cashFlow.value - capex.value,
      unit: "억원",
      lines: [`영업활동현금흐름 ${won(cashFlow.value)} − CAPEX ${won(capex.value)}`],
      formula: "FCF = 영업활동현금흐름 − CAPEX",
      disclaimer: null,
      sourceHeading: "현금흐름표 > 영업활동현금흐름·유형자산 취득",
    };
  }

  if (metric === "debtRatio" || metric === "currentRatio") {
    const numerator = metric === "debtRatio"
      ? findRowLike(rows, ["BS"], ["부채총계"])
      : findRowLike(rows, ["BS"], ["유동자산"]);
    const denominator = metric === "debtRatio"
      ? findRowLike(rows, ["BS"], ["자본총계"])
      : findRowLike(rows, ["BS"], ["유동부채"]);
    const top = numerator ? amountOf(numerator) : null;
    const bottom = denominator ? amountOf(denominator) : null;
    if (top === null || bottom === null || bottom === 0) return null;
    const label = metric === "debtRatio" ? "부채비율" : "유동비율";
    const topLabel = metric === "debtRatio" ? "부채총계" : "유동자산";
    const bottomLabel = metric === "debtRatio" ? "자본총계" : "유동부채";
    return {
      value: top / bottom * 100,
      unit: "%",
      lines: [`${topLabel} ${won(top)} ÷ ${bottomLabel} ${won(bottom)} × 100`],
      formula: `${label} = ${topLabel} ÷ ${bottomLabel} × 100`,
      disclaimer: null,
      sourceHeading: `재무상태표 > ${topLabel}·${bottomLabel}`,
    };
  }

  if (metric === "operatingMargin" || metric === "netMargin") {
    const revenue = findRowLike(rows, ["CIS", "IS"], metricConfig.revenue.names);
    const profitNames = metric === "operatingMargin"
      ? metricConfig.operatingProfit.names
      : metricConfig.netIncome.names;
    const profit = findRowLike(rows, ["CIS", "IS"], profitNames);
    const rev = revenue ? amountOf(revenue, 0, period.mode === "cum") : null;
    const profitValue = profit ? amountOf(profit, 0, period.mode === "cum") : null;
    if (rev === null || profitValue === null || rev === 0) return null;
    const label = METRIC_LABELS[metric];
    const profitLabel = metric === "operatingMargin" ? "영업이익" : "순이익";
    return {
      value: (profitValue / rev) * 100,
      unit: "%",
      lines: [`${profitLabel} ${won(profitValue)} / 매출액 ${won(rev)}`],
      formula: `${label} = ${profitLabel} ÷ 매출액 × 100`,
      disclaimer: null,
      sourceHeading: `손익계산서 > 매출액·${profitLabel}`,
    };
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
    const ov = op ? amountOf(op, 0, period.mode === "cum") : null;
    if (ov === null || !Number.isFinite(ov)) return null;

    const statementPriority = ["CF", "CIS", "IS"] as const;
    const normalize = (value: string) => value.replace(/[\s·ㆍ()（）]/g, "").toLowerCase();
    const expenseAmountOf = (row: Row) => {
      const raw = ((period.mode === "cum" && row.thstrm_add_amount) ? row.thstrm_add_amount : row.thstrm_amount ?? "").replace(/,/g, "").trim();
      // 재무제표에 명시적으로 기재된 대시만 0으로 인정하며, 공란은 미확인으로 유지합니다.
      if (/^(?:-|—|–|－|−)$/.test(raw)) return 0;
      const parenthesized = /^\(.*\)$/.test(raw);
      if (parenthesized) {
        const numeric = Number(`-${raw.slice(1, -1).replace(/,/g, "")}`);
        return Number.isFinite(numeric) ? numeric / 1e8 : null;
      }
      return amountOf(row, 0, period.mode === "cum");
    };
    const aggregateName = /(감가상각비.*무형자산상각비|무형자산상각비.*감가상각비|유무형자산.*상각|유형자산.*상각비.*무형자산.*상각|감가상각및상각비|감가상각비와상각비|감가상각비및무형자산상각비|감가상각비와무형자산상각비|감가상각및무형자산상각비|유형자산감가상각비및무형자산상각비|유형자산및무형자산상각비|감가상각비및상각비|감가상각및무형자산상각)/;
    const aggregateId = /DepreciationDepletionAndAmortisationExpense|DepreciationDepletionAndAmortizationExpense|DepreciationAndAmortisationExpense|DepreciationAmortisationExpense|DepreciationAndAmortizationExpense|DepreciationAmortizationExpense|AdjustmentsForDepreciationAndAmortisationExpense|AdjustmentsForDepreciationAndAmortizationExpense/i;
    const aggregateRows = rows.filter((row) => {
      if (!statementPriority.includes(row.sj_div as any)) return false;
      if (!(aggregateName.test(normalize(row.account_nm ?? "")) || aggregateId.test(row.account_id ?? ""))) return false;
      const value = expenseAmountOf(row);
      return value !== null && Number.isFinite(value);
    });
    // 공시가 유형·무형 상각비 합계를 하나의 계정으로 제공하면 이를 우선 사용합니다.
    const aggregate = aggregateRows.sort((a, b) => statementPriority.indexOf(a.sj_div as any) - statementPriority.indexOf(b.sj_div as any))[0];
    if (aggregate) {
      const da = expenseAmountOf(aggregate);
      if (da !== null && Number.isFinite(da)) {
        return {
          value: ov + Math.abs(da), unit: "억원",
          lines: [`영업이익 ${won(ov)}`, `${aggregate.account_nm} ${won(Math.abs(da))}`],
          formula: "EBITDA = 영업이익 + 공시된 유형·무형자산 감가상각/상각비 합계",
          disclaimer: null, sourceHeading: "손익계산서·현금흐름표 > EBITDA 원천 계정",
        };
      }
    }

    const daName = /(감가상각비|상각비)/;
    const normalizedName = (row: Row) => normalize(row.account_nm ?? "");
    const sumRows = (items: Row[]) => {
      const unique = new Map<string, Row>();
      for (const row of items) unique.set(row.account_id || `${row.sj_div}:${row.account_nm}`, row);
      const vals = [...unique.values()].map((row) => ({ row, value: expenseAmountOf(row) }));
      return vals.length && vals.every((item) => item.value !== null && Number.isFinite(item.value))
        ? { value: vals.reduce((sum, item) => sum + Math.abs(item.value!), 0), rows: vals }
        : null;
    };
    const sectionComponents = (section: string) => {
      const candidates = rows.filter((row) => {
        if (row.sj_div !== section || /상각누계액|감가상각누계액/.test(normalizedName(row))) return false;
        const id = row.account_id ?? "";
        const isDaTaxonomy = /AdjustmentsForDepreciationExpense|DepreciationExpense|DepreciationOfPropertyPlantAndEquipment|DepreciationOfInvestmentProperty|DepreciationOfRightOfUseAsset/i.test(id) && !/AccumulatedDepreciation|DepreciationAccumulated/i.test(id);
        const isAmortTaxonomy = /AdjustmentsForAmortisationExpense|AdjustmentsForAmortizationExpense|AmortisationExpense|AmortizationExpense|AmortisationOfIntangibleAssets|AmortizationOfIntangibleAssets/i.test(id) && !/AccumulatedAmort/i.test(id);
        return daName.test(row.account_nm ?? "") || isDaTaxonomy || isAmortTaxonomy;
      });
      const names = candidates.map((row) => ({
        row,
        name: normalizedName(row),
        id: row.account_id ?? "",
      }));
      const depreciationSpecific = names.filter(({ name, id }) =>
        /유형자산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*유형자산|사용권자산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*사용권자산|투자부동산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*투자부동산/.test(name) || /AdjustmentsForDepreciationExpense|DepreciationExpense|DepreciationOfPropertyPlantAndEquipment|DepreciationOfInvestmentProperty|DepreciationOfRightOfUseAsset/i.test(id) && !/AccumulatedDepreciation|DepreciationAccumulated/i.test(id)
      ).map(({ row }) => row);
      const depreciationGeneric = names.filter(({ name }) => /^감가상각비$/.test(name)).map(({ row }) => row);
      const amortizationSpecific = names.filter(({ name, id }) =>
        /무형자산.*상각(?:비)?|상각(?:비)?.*무형자산|개발비상각비|소프트웨어상각비/.test(name) || /AdjustmentsForAmortisationExpense|AdjustmentsForAmortizationExpense|AmortisationExpense|AmortizationExpense|AmortisationOfIntangibleAssets|AmortizationOfIntangibleAssets/i.test(id) && !/AccumulatedAmort/i.test(id)
      ).map(({ row }) => row);
      const amortizationGeneric = names.filter(({ name }) => /^(무형자산상각비|무형자산상각|상각비)$/.test(name)).map(({ row }) => row);
      // 상세 계정이 있으면 같은 비용을 포함할 수 있는 포괄 계정 '감가상각비'와 중복 합산하지 않습니다.
      return {
        dep: sumRows(depreciationSpecific.length ? depreciationSpecific : depreciationGeneric),
        amort: sumRows(amortizationSpecific.length ? amortizationSpecific : amortizationGeneric),
      };
    };
    const bySection = statementPriority.map((section) => ({ section, ...sectionComponents(section) }));
    const complete = bySection.find((item) => item.dep && item.amort);
    // 일부 공시는 유형자산 감가상각비와 무형자산 상각비를 다른 표에 제공합니다.
    // 이 경우 각 구성요소를 우선순위가 가장 높은 표에서 각각 1회만 가져옵니다.
    const dep = complete?.dep ?? bySection.find((item) => item.dep)?.dep ?? null;
    const amort = complete?.amort ?? bySection.find((item) => item.amort)?.amort ?? null;
    if (!dep || !amort) {
      return {
        value: Number.NaN, unit: "억원",
        lines: [
          `영업이익 ${won(ov)}`,
          ...(dep?.rows ?? []).map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`),
          ...(amort?.rows ?? []).map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`),
          "공시 본문 미기재 (주석 확인 필요)",
        ],
        formula: "EBITDA = 영업이익 + 유형자산 감가상각비 + 무형자산 상각비",
        disclaimer: `EBITDA는 영업이익 ${won(ov)}에 공시된 감가상각비를 더해 계산합니다. ${!dep ? "유형자산 감가상각비" : "무형자산 상각비"}를 재무제표 본문에서 확인하지 못했습니다. 미공시 항목을 0 또는 CAPEX 비율로 추정하지 않았습니다. 해당 보고서 주석 확인이 필요합니다.`,
        sourceHeading: "현금흐름표·손익계산서 > 감가상각비·상각비",
      };
    }
    const da = dep.value + amort.value;
    const parts = [...dep.rows, ...amort.rows].map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`);
    return {
      value: ov + da, unit: "억원", lines: [`영업이익 ${won(ov)}`, ...parts],
      formula: "EBITDA = 영업이익 + 유형자산 감가상각비 + 무형자산 상각비",
      disclaimer: null, sourceHeading: "손익계산서·현금흐름표 > EBITDA 원천 계정",
    };
  }

  const config = metricConfig[metric];
  const row = metric === "netIncome"
    ? (findRowLike(rows, ["CIS", "IS"], ["반기순손익", "분기순손익", "당기순이익", "당기순이익(손실)", "연결당기순이익"]) ?? findRowLike(rows, config.sj, config.names))
    : findRowLike(rows, config.sj, config.names);
  const isFlowStatement = config.sj.some((statement) => ["IS", "CIS", "CF"].includes(statement));
  const value = row ? amountOf(row, 0, isFlowStatement && period.mode === "cum") : null;
  if (!row || value === null) return null;
  const lines = [`원천 계정: ${row.account_nm}`];
  if (isFlowStatement && period.kind !== "annual" && row.thstrm_add_amount) lines.push(`당기 3개월: ${won(amountOf(row, 0, false) ?? 0)} / 누적: ${won(amountOf(row, 0, true) ?? 0)}`);
  return { value, unit: "억원", lines, formula: null, disclaimer: null, sourceHeading: `${config.sj.includes("CF") ? "현금흐름표" : "손익계산서"} > ${METRIC_LABELS[metric]}` };
}

async function resolvePeriod(corp: { code: string }, candidates: Period[], fs: "CFS" | "OFS", force = false, requestKey?: string) {
  for (const period of candidates) {
    const primary = await statements(corp.code, period.year, period.code, fs, force, requestKey);
    if (primary) return { period, rows: primary, fs };
    if (fs === "CFS") {
      const fallback = await statements(corp.code, period.year, period.code, "OFS", force, requestKey);
      if (fallback) return { period, rows: fallback, fs: "OFS" as const };
    }
  }
  return null;
}

export async function validateDartKey(requestKey?: string) {
  if (!requestKey || !/^[A-Za-z0-9]{40}$/.test(requestKey.trim()) || /^(DEMO|VERIFIED)/i.test(requestKey.trim())) {
    return { valid: false as const, companyCount: 0, message: "실제 40자리 OpenDART 인증키를 입력하세요." };
  }
  try {
    const map = await corps(true, requestKey);
    if (!map.size) return { valid: false as const, companyCount: 0, message: "DART 기업목록을 받지 못했습니다. 인증키를 확인하세요." };
    return { valid: true as const, companyCount: map.size, message: "OpenDART 인증키 검증 성공" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenDART 인증키 검증 실패";
    return { valid: false as const, companyCount: 0, message: `인증키 검증 실패: ${message}` };
  }
}

function stripMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|tr|td|th|li|h[1-6]|table|section|article|title)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/[\t\u00a0]+/g, " ")
    .split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

async function disclosureEntries(rceptNo: string, requestKey?: string): Promise<Array<{ name: string; text: string }>> {
  const cached = documentEntriesCache.get(rceptNo);
  if (cached && Date.now() - cached.at < (cached.entries.length ? 24 * 3600_000 : 60_000)) return cached.entries;
  let response: Response;
  try {
    response = await dartFetch(`${BASE}/document.xml?crtfc_key=${encodeURIComponent(key(requestKey))}&rcept_no=${encodeURIComponent(rceptNo)}`, {}, 10_000);
  } catch {
    documentEntriesCache.set(rceptNo, { at: Date.now(), entries: [] });
    return [];
  }
  if (!response.ok) {
    // 일시 실패가 반복될 때 매 화면 갱신마다 10초씩 대기하지 않도록 짧게 음성 캐시합니다.
    documentEntriesCache.set(rceptNo, { at: Date.now(), entries: [] });
    return [];
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const entries = unzipAll(bytes).filter((entry) => /\.(xml|html?|xhtml)$/i.test(entry.name));
  documentEntriesCache.set(rceptNo, { at: Date.now(), entries });
  return entries;
}

async function disclosureText(rceptNo: string, requestKey?: string): Promise<string> {
  const cached = documentCache.get(rceptNo);
  if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.text;
  const entries = await disclosureEntries(rceptNo, requestKey);
  const text = entries.map((entry) => `\n[문서 ${entry.name}]\n${stripMarkup(entry.text)}`).join("\n");
  documentCache.set(rceptNo, { at: Date.now(), text });
  return text;
}

/**
 * 본문 API에 감가상각·무형자산상각 계정이 없을 때 공시 원문 첨부의 표를 확인합니다.
 * 당기/누계 열과 표 단위가 확인되는 동일 표 안에서 합계 계정 또는 감가상각+무형자산상각을
 * 모두 찾은 경우에만 결과를 반환합니다. 열·단위가 모호하거나 서로 다른 표의 값만 존재하면 추정하지 않습니다.
 */
async function depreciationFromDisclosure(rceptNo: string, period: Period, requestKey?: string): Promise<{ value: number; lines: string[] } | null> {
  const entries = await disclosureEntries(rceptNo, requestKey).catch(() => []);
  const norm = (v: string) => v.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
  const cleanLabel = (v: string) => norm(stripMarkup(v)).replace(/[\s·ㆍ()（）]/g, "");
  const expandCells = (html: string) => [...html.matchAll(/<(?:td|th)\b([^>]*)>([\s\S]*?)<\/(?:td|th)>/gi)].flatMap((m) => {
    const span = Math.max(1, Math.min(16, Number(m[1].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1)));
    const text = norm(stripMarkup(m[2]));
    return Array.from({ length: span }, () => text);
  });
  const parseAmount = (text: string, unit: string): number | null => {
    const t = text.replace(/\s/g, "").replace(/−/g, "-");
    if (/^(?:-|—|–|－)$/.test(t)) return 0;
    const match = t.match(/^\(?(-?[\d,]+(?:\.\d+)?)\)?$/);
    if (!match) return null;
    let value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    if (t.startsWith("(") && t.endsWith(")")) value = -Math.abs(value);
    if (unit === "원") return value / 1e8;
    if (unit === "천원") return value / 1e5;
    if (unit === "백만원") return value / 100;
    if (unit === "억원") return value;
    return null;
  };
  const avoidPrior = /전기|전반기|전분기|전년도|전년|비교|기초/;
  const periodTarget = (header: string) => {
    const h = header.replace(/[\s·ㆍ]/g, "");
    if (avoidPrior.test(h)) return false;
    // 공시 주석의 표 머리글은 '당반기 누적', '당기', '당분기', '당해' 등으로 다양하게 표기됩니다.
    // 기간 문구를 못 찾으면 아래의 단일 숫자열 규칙만 허용하므로, 과거 열을 추정해 선택하지 않습니다.
    if (period.kind === "half" && period.mode !== "qtr") return /당반기.*(?:누적|합계)?|당기누적|당기|당해|누적|제\s*\d+\s*기\s*반기/.test(h) && !/3개월/.test(h);
    if (period.kind === "half" && period.mode === "qtr") return /당반기.*3개월|당기.*3개월|당분기|당기분기|3개월/.test(h);
    if (period.kind === "q3" && period.mode === "qtr") return /당분기|당기분기|당기.*3개월|3개월/.test(h);
    if (period.kind === "q1") return /당분기|당기분기|당기|당해|누적/.test(h) && !/3개월.*누적/.test(h);
    return /당기|당해|당연도|당기말|제\s*\d+\s*기/.test(h);
  };
  const foundAggregates: Array<{ value: number; label: string }> = [];
  const foundPairs: Array<{ value: number; lines: string[] }> = [];

  for (const entry of entries) {
    const tables = [...entry.text.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
    for (const tableMatch of tables) {
      const tableHtml = tableMatch[0];
      const tableStart = tableMatch.index ?? 0;
      const before = entry.text.slice(Math.max(0, tableStart - 900), tableStart);
      const unitText = `${before} ${tableHtml}`.replace(/\s+/g, " ");
      const unitMatch = unitText.match(/단위\s*[:：]?\s*(천원|백만원|억원|원)(?![가-힣])/i);
      if (!unitMatch) continue;
      const unit = unitMatch[1];
      const rawRows = [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => ({ html: m[0], cells: expandCells(m[0]) })).filter((r) => r.cells.length);
      if (!rawRows.length) continue;
      const maxCols = Math.max(...rawRows.slice(0, 8).map((r) => r.cells.length));
      const headers = Array.from({ length: maxCols }, (_, i) => rawRows.slice(0, 8).map((r) => r.cells[i] ?? "").join(" "));
      let amountCol = headers.findIndex((h) => periodTarget(h));
      if (amountCol < 0) {
        // 당기 열을 확인할 수 없는 경우, 각 데이터 행에 숫자 열이 하나뿐이고 표 안에 기간명이 명시된 때만 허용합니다.
        const visibleTable = norm(stripMarkup(tableHtml));
        const hasCurrentLabel = /당기|당반기|당분기|당해|누적/.test(visibleTable) && !avoidPrior.test(visibleTable);
        if (!hasCurrentLabel) continue;
      }
      const getCurrent = (cells: string[]) => {
        if (amountCol >= 0 && cells[amountCol] !== undefined) return parseAmount(cells[amountCol], unit);
        const vals = cells.map((cell) => parseAmount(cell, unit)).filter((v): v is number => v !== null);
        return vals.length === 1 ? vals[0] : null;
      };
      const parsedRows = rawRows.map((r) => {
        const label = cleanLabel(r.cells.slice(0, Math.max(1, amountCol >= 0 ? amountCol : 2)).join(" "));
        const value = getCurrent(r.cells);
        return { label, value };
      }).filter((r) => r.value !== null);
      const aggregate = parsedRows.filter((r) => /(?:유형자산및무형자산|유무형자산|감가상각비및무형자산상각비|감가상각및상각비|감가상각비와무형자산상각비|감가상각비및상각비)/.test(r.label));
      if (aggregate.length === 1) {
        foundAggregates.push({ value: Math.abs(aggregate[0].value!), label: aggregate[0].label });
        continue;
      }
      if (aggregate.length > 1) continue;
      const depreciation = parsedRows.filter((r) => /감가상각비/.test(r.label) && !/누계액|감가상각누계/.test(r.label) && !/무형자산/.test(r.label));
      const amortization = parsedRows.filter((r) => /무형자산상각비|무형자산상각/.test(r.label) && !/누계액/.test(r.label));
      if (depreciation.length === 1 && amortization.length === 1) {
        foundPairs.push({ value: Math.abs(depreciation[0].value!) + Math.abs(amortization[0].value!), lines: [`주석 원문 ${depreciation[0].label}: ${won(Math.abs(depreciation[0].value!))}`, `주석 원문 ${amortization[0].label}: ${won(Math.abs(amortization[0].value!))}`] });
      }
    }
  }
  if (foundAggregates.length) {
    const distinct = [...new Set(foundAggregates.map((x) => x.value.toFixed(6)))];
    if (distinct.length !== 1) return null;
    const selected = foundAggregates[0];
    return { value: selected.value, lines: [`DART 첨부 원문에 공시된 감가상각·상각 합계 ${selected.label}: ${won(selected.value)}`] };
  }
  if (foundPairs.length) {
    const distinct = [...new Set(foundPairs.map((x) => x.value.toFixed(6)))];
    if (distinct.length !== 1) return null;
    return foundPairs[0];
  }
  return null;
}

function findCauseEvidence(text: string, metric: FinancialMetric): Array<{ section: string; excerpt: string; explicitCause: boolean }> {
  const metricTerms: Record<FinancialMetric, RegExp> = {
    revenue: /매출|수익|판매량|판매단가|판매가격|제품별|지역별|수주|물량|환율/,
    operatingProfit: /영업이익|영업손익|매출원가|판매비와관리비|판관비|원재료|제품믹스|가동률|고정비/,
    netIncome: /당기순이익|순이익|법인세|금융원가|이자비용|환차손익|지분법손익|처분손익/,
    operatingMargin: /영업이익률|영업이익|매출원가|판관비|원재료/,
    netMargin: /순이익률|당기순이익|법인세|금융원가/,
    operatingCashFlow: /영업활동현금흐름|매출채권|재고자산|매입채무|운전자본/,
    investmentCashFlow: /투자활동현금흐름|유형자산의취득|설비투자|투자자산/,
    financingCashFlow: /재무활동현금흐름|차입금|사채|유상증자|배당금지급/,
    capex: /유형자산의취득|설비투자|자본적지출|생산설비/,
    freeCashFlow: /영업활동현금흐름|유형자산의취득|설비투자/,
    netDebt: /차입금|사채|현금및현금성자산|유동성장기부채/,
    borrowings: /차입금|사채|차입 계약|신규 차입|상환/,
    borrowingsRatio: /차입금|사채|자산총계|재무구조/,
    workingCapital: /매출채권|재고자산|매입채무|운전자본/,
    payables: /매입채무|매입채무및기타채무|유동매입채무/,
    debtRatio: /부채비율|부채총계|자본총계|차입금/,
    currentRatio: /유동비율|유동자산|유동부채/,
    interestCoverage: /이자보상배율|영업이익|이자비용|금융원가/,
    roe: /자기자본이익률|ROE|당기순이익|자본총계/,
    roa: /총자산이익률|ROA|당기순이익|자산총계/,
    eps: /주당순이익|주당순손익|EPS/,
    ebitda: /EBITDA|감가상각비|무형자산상각비|영업이익/,
    per: /주가수익비율|PER/,
    pbr: /주가순자산비율|PBR/,
  };
  const sentences = text.split(/(?<=[.。!?！？])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 900);
  const cause = /증가|감소|상승|하락|확대|축소|기인|영향|따라|때문|원인|이유|주요 요인|개선|악화|반영|전년|전기|주요 제품|판매량|판매단가|원재료|환율|수주|가동률|제품믹스|판관비|매출원가|일회성/;
  const score = (sentence: string) => Number(metricTerms[metric].test(sentence)) * 2 + Number(cause.test(sentence)) + Number(/증가.*(?:기인|때문|영향|따라)|감소.*(?:기인|때문|영향|따라)|(?:주요|주된) 원인|에 기인/.test(sentence)) * 2;
  const ranked = sentences.map((excerpt) => ({ excerpt, score: score(excerpt), explicitCause: /(?:증가|감소|상승|하락|확대|축소|개선|악화).{0,70}(?:기인|때문|영향을?\s*(?:미쳤|받았|주었|줬)|따라|결과)|(?:주요|주된)?\s*(?:원인|이유|요인).{0,70}(?:증가|감소|상승|하락|확대|축소|개선|악화)|에 기인|의 영향으로/.test(excerpt) }))
    .filter((item) => item.score >= 3).sort((a, b) => b.score - a.score || b.excerpt.length - a.excerpt.length);
  const unique = [...new Map(ranked.map((item) => [item.excerpt, item])).values()].slice(0, 8);
  return unique.map((item) => ({ section: /매출|판매|수주/.test(item.excerpt) ? "매출·영업활동 관련 본문" : /원가|비용|감가|이자/.test(item.excerpt) ? "비용·손익 관련 본문" : "사업내용·재무 관련 본문", excerpt: item.excerpt, explicitCause: item.explicitCause }));
}

async function analyzeDisclosureCause(input: { corpCode: string; corpName: string; currentRcept: string; previousRcept: string; currentYear: number; previousYear: number; metric: FinancialMetric; currentPeriod: string; previousPeriod: string }, requestKey?: string) {
  // 실적 비교 공시뿐 아니라 비교 연도에 가장 가까운 실제 사업보고서 본문도 함께 검색합니다.
  // 사업보고서의 접수번호는 공시검색 API(list.json)에서 확인된 값만 사용합니다.
  const annualYears = [...new Set([input.currentYear - 1, input.previousYear - 1].filter((year) => year >= 2000))];
  const annualFilings = await Promise.all(annualYears.map(async (year) => ({
    year,
    filing: await filingForPeriod(input.corpCode, year, "11011", requestKey).catch(() => null),
  })));
  const sources: Array<{ label: string; rceptNo: string }> = [
    { label: input.currentPeriod, rceptNo: input.currentRcept },
    { label: input.previousPeriod, rceptNo: input.previousRcept },
    ...annualFilings.filter((item) => item.filing?.rceptNo).map((item) => ({ label: `${item.year}년 사업보고서`, rceptNo: item.filing!.rceptNo })),
  ];
  const uniqueSources = [...new Map(sources.filter((s) => /^\d{14}$/.test(s.rceptNo)).map((s) => [s.rceptNo, s])).values()];
  const docs = await Promise.all(uniqueSources.map(async (source) => ({
    ...source,
    text: await disclosureText(source.rceptNo, requestKey).catch(() => ""),
  })));
  const candidates = docs.flatMap((doc) => findCauseEvidence(doc.text, input.metric).map((e) => ({ ...e, reportPeriod: doc.label, rceptNo: doc.rceptNo })));
  const evidence = [...new Map(candidates.map((item) => [`${item.rceptNo}-${item.excerpt}`, item])).values()].slice(0, 8);
  const explicit = evidence.filter((item) => item.explicitCause).length;
  return {
    status: explicit ? "explicit-evidence" as const : evidence.length ? "related-context-only" as const : "not-found" as const,
    summary: explicit
      ? "공시 본문에서 증감 원인을 직접 설명하는 문장을 찾았습니다. 아래 원문 문장을 근거로 확인하세요."
      : evidence.length
        ? "관련 사업·비용 설명 문장은 찾았지만, 해당 실적 증감의 직접 원인이라고 명시된 문장은 확인되지 않았습니다. 공시로 인과관계를 특정할 수 없습니다."
        : "접근 가능한 사업보고서 본문에서 해당 실적 증감의 직접 원인을 입증할 문장을 찾지 못했습니다. 공시로 특정되지 않습니다. 주석 및 첨부자료를 직접 확인하세요.",
    evidence,
    note: "문장 검색은 공시 원문 안의 근거 후보를 제시하는 기능입니다. 원문에 인과관계가 명시되지 않은 경우 에이전트가 원인을 추측하거나 사실로 단정하지 않습니다.",
  };
}


export async function buildDartSectionDeepLink(rceptNo: string, requestedSection: "CFS" | "OFS", requestKey?: string, statement: "BS" | "IS" | "CF" = "BS") {
  if (!/^\d{14}$/.test(rceptNo)) throw new TRPCError({ code: "BAD_REQUEST", message: "실제 14자리 DART 접수번호가 필요합니다." });
  const cacheKey = `${rceptNo}:${requestedSection}:${statement}`;
  const cachedLink = deepLinkCache.get(cacheKey);
  if (cachedLink && Date.now() - cachedLink.at < 24 * 3600_000) return cachedLink.value;
  const mainUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://dart.fss.or.kr/",
  };

  try {
    const response = await dartFetch(mainUrl, { headers, redirect: "follow" }, 8_000);
    if (!response.ok) return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: `DART 원문 목차 조회 실패: HTTP ${response.status}. 세부 본문 링크 대신 공식 공시 목차를 제공합니다.` };
    const mainHtml = await readDartHtml(response);
    const direct = parseViewerDeepLinkHtml(mainHtml, rceptNo, requestedSection, statement);
    if (direct.deepLinked) {
      // DART main.do 원문 스크립트 안에서 요청한 재무제표 제목과 실제 viewDoc(rcpNo,dcmNo,eleId,...) 호출을 함께 추출했습니다.
      // 서버측 재요청이 보안장비·리다이렉트에 막힐 수 있으므로, 이 실데이터 링크를 추가 HTTP probe가 실패했다는 이유만으로 버리지 않습니다.
      const verified = { ...direct, message: (("note" in direct && direct.note) ? `${direct.note} ` : "") + `DART 원문 목차에서 실제 ${direct.sectionTitle} 항목과 본문 매개변수를 추출했습니다.` };
      deepLinkCache.set(cacheKey, { at: Date.now(), value: verified });
      return verified;
    }

    // 응답이 프레임/초기 뷰어만 포함하는 DART 문서 유형이면, 진짜 뷰어 페이지를 한 번 더 받아
    // 그 안의 문서 트리를 읽습니다. 어느 단계에서도 dsaf001/main.do를 최종 목적지로 쓰지 않습니다.
    const initial = extractInitialViewerArgs(mainHtml, rceptNo);
    if (initial) {
      const initialUrl = new URL("https://dart.fss.or.kr/report/viewer.do");
      Object.entries(initial).forEach(([name, value]) => initialUrl.searchParams.set(name, value));
      const viewerResponse = await dartFetch(initialUrl.toString(), { headers: { ...headers, "Referer": mainUrl }, redirect: "follow" }, 8_000);
      if (viewerResponse.ok) {
        const viewerHtml = await readDartHtml(viewerResponse);
        const secondary = parseViewerDeepLinkHtml(viewerHtml, rceptNo, requestedSection, statement);
        if (secondary.deepLinked) {
          const verified = { ...secondary, message: (("note" in secondary && secondary.note) ? `${secondary.note} ` : "") + `DART 뷰어 목차에서 실제 ${secondary.sectionTitle} 항목과 본문 매개변수를 추출했습니다.` };
          deepLinkCache.set(cacheKey, { at: Date.now(), value: verified });
          return verified;
        }
      }
    }
    const targetTitle = `${requestedSection === "CFS" ? "연결" : "별도"} ${statement === "BS" ? "재무상태표" : statement === "IS" ? "손익계산서" : "현금흐름표"}`;
    const hasDocCall = /viewDoc\s*\(/i.test(mainHtml);
    return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: hasDocCall
      ? `DART HTML에서 '${targetTitle}' 세부 본문 위치를 찾지 못해 공식 공시 목차를 제공합니다. 목차에서 재무제표를 선택하세요.`
      : `DART 공시 HTML에서 '${targetTitle}' 링크를 찾지 못해 공식 공시 목차를 제공합니다. 목차에서 재무제표를 선택하세요.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "네트워크 오류";
    return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: `DART 뷰어 목차 조회 실패: ${detail}. 공식 공시 목차를 제공합니다.` };
  }
}

type HistoryReportKey = "q1" | "half" | "q3" | "annual";
const HISTORY_REPORTS: Array<{ key: HistoryReportKey; code: string; kind: HistoryReportKey }> = [
  { key: "q1", code: "11013", kind: "q1" },
  { key: "half", code: "11012", kind: "half" },
  { key: "q3", code: "11014", kind: "q3" },
  { key: "annual", code: "11011", kind: "annual" },
];

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function historyReportIsDue(year: number, key: HistoryReportKey, now = new Date()): boolean {
  // 정기보고서의 통상 제출기한 이전에는 해당 연도의 미공시 분기를 반복 조회하지 않습니다.
  const month = now.getMonth() + 1;
  if (key === "annual") return year < now.getFullYear();
  if (year < now.getFullYear()) return true;
  if (year > now.getFullYear()) return false;
  if (key === "q1") return month >= 5;
  if (key === "half") return month >= 8;
  if (key === "q3") return month >= 11;
  return false;
}

async function loadHistoryRows(corp: { code: string }, basis: "CFS" | "OFS", requestKey?: string) {
  const currentYear = new Date().getFullYear();
  const failures: string[] = [];
  const jobs: Array<{ year: number; key: HistoryReportKey; code: string }> = [];
  for (let year = currentYear - 3; year <= currentYear; year++) {
    for (const report of HISTORY_REPORTS) {
      if (historyReportIsDue(year, report.key)) jobs.push({ year, key: report.key, code: report.code });
    }
  }
  const loaded = await mapWithConcurrency(jobs, 5, async (job) => {
    try {
      const rows = await statements(corp.code, job.year, job.code, basis, false, requestKey);
      if (!rows?.length) failures.push(`${job.year} ${job.key}: 해당 기준 공시가 없거나 원천 계정이 반환되지 않음`);
      return { ...job, rows };
    } catch (error) {
      // 해당 보고서의 오류만 기록하고 나머지 기간은 계속 수집합니다.
      const detail = error instanceof Error ? error.message : "DART 조회 오류";
      failures.push(`${job.year} ${job.key}: ${detail}`);
      return { ...job, rows: null };
    }
  });
  const yearRows = new Map<number, Record<HistoryReportKey, Row[] | null>>();
  for (let year = currentYear - 3; year <= currentYear; year++) {
    yearRows.set(year, { q1: null, half: null, q3: null, annual: null });
  }
  for (const item of loaded) yearRows.get(item.year)![item.key] = item.rows;
  return { rows: yearRows, failures };
}

function historyValues(rows: Row[] | null, year: number, kind: HistoryReportKey) {
  if (!rows) return null;
  const period = P(year, kind, "cum");
  const revenue = pickMetric(rows, period, "revenue")?.value;
  const operatingProfit = pickMetric(rows, period, "operatingProfit")?.value;
  const netIncome = pickMetric(rows, period, "netIncome")?.value;
  return Number.isFinite(revenue) && Number.isFinite(operatingProfit)
    ? { revenue: revenue!, operatingProfit: operatingProfit!, ...(Number.isFinite(netIncome) ? { netIncome: netIncome! } : {}) }
    : null;
}

function pointsFromHistoryRows(yearRows: Map<number, Record<HistoryReportKey, Row[] | null>>, basis: "CFS" | "OFS") {
  const points: Array<{ period: string; rceptNo?: string; basisCode: "CFS" | "OFS"; revenue: number; operatingProfit: number; netIncome?: number; isFourthQuarterDerived?: boolean }> = [];
  for (const [year, rows] of yearRows) {
    const q1 = historyValues(rows.q1, year, "q1");
    const half = historyValues(rows.half, year, "half");
    const q3 = historyValues(rows.q3, year, "q3");
    const annual = historyValues(rows.annual, year, "annual");
    const add = (quarter: "1Q" | "2Q" | "3Q" | "4Q", value: ReturnType<typeof historyValues>, sub?: NonNullable<ReturnType<typeof historyValues>>, fourth = false) => {
      if (!value) return;
      const calculated = {
        revenue: sub ? value.revenue - sub.revenue : value.revenue,
        operatingProfit: sub ? value.operatingProfit - sub.operatingProfit : value.operatingProfit,
        ...(Number.isFinite(value.netIncome) && (!sub || Number.isFinite(sub.netIncome)) ? { netIncome: sub ? value.netIncome! - sub.netIncome! : value.netIncome! } : {}),
      };
      if (![calculated.revenue, calculated.operatingProfit].every(Number.isFinite)) return;
      const rowSet = quarter === "1Q" ? rows.q1 : quarter === "2Q" ? rows.half : quarter === "3Q" ? rows.q3 : rows.annual;
      points.push({ period: `${quarter}${String(year).slice(2)}`, rceptNo: rowSet?.find((row) => row.rcept_no)?.rcept_no, basisCode: basis, ...calculated, ...(fourth ? { isFourthQuarterDerived: true } : {}) });
    };
    add("1Q", q1);
    if (half && q1) add("2Q", half, q1);
    if (q3 && half) add("3Q", q3, half);
    if (annual && q3) add("4Q", annual, q3, true);
  }
  return points;
}

async function quarterlyHistory(corp: { code: string }, preferredFs: "CFS" | "OFS", requestKey?: string) {
  if (preferredFs === "OFS") {
    const loaded = await loadHistoryRows(corp, "OFS", requestKey);
    return historyResponseShape(pointsFromHistoryRows(loaded.rows, "OFS"), loaded.failures);
  }

  // CFS/OFS를 병렬로 조회하되 filingInFlight가 같은 보고서의 공시목록 호출을 합칩니다.
  // 두 기준을 순차로 기다려 보고서 생성이 45초 이상 지연되는 일을 방지합니다.
  const [primaryLoaded, separateLoaded] = await Promise.all([
    loadHistoryRows(corp, "CFS", requestKey),
    loadHistoryRows(corp, "OFS", requestKey),
  ]);
  const primaryPoints = pointsFromHistoryRows(primaryLoaded.rows, "CFS");
  const separatePoints = pointsFromHistoryRows(separateLoaded.rows, "OFS");
  if (primaryPoints.length < 4 && separatePoints.length > primaryPoints.length) {
    return historyResponseShape(separatePoints, [...primaryLoaded.failures, ...separateLoaded.failures]);
  }
  if (primaryPoints.length < 4) {
    return historyResponseShape(primaryPoints, [...primaryLoaded.failures, ...separateLoaded.failures]);
  }
  for (const point of primaryPoints) {
    const separate = separatePoints.find((candidate) => candidate.period === point.period);
    if (separate) {
      (point as any).separateOperatingProfit = separate.operatingProfit;
      (point as any).subsidiaryAndAdjProfit = point.operatingProfit - separate.operatingProfit;
    }
  }
  return historyResponseShape(primaryPoints, [...primaryLoaded.failures, ...separateLoaded.failures]);
}

/** 분기 시계열은 기본 스냅샷과 독립적으로 조회·캐시하여 차트가 화면 로딩을 무기한 막지 않도록 합니다. */
export async function historyDart(companyName: string, requestKey?: string) {
  const map = await corps(false, requestKey);
  const corp = findCorp(companyName, map);
  if (!corp) throw new TRPCError({ code: "NOT_FOUND", message: `DART 기업목록에서 찾지 못했습니다: ${companyName}` });
  const cacheKey = `${corp.code}:${requestKey?.slice(-6) ?? "server-key"}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60_000) return {
    found: true as const, company: corp.name, corpCode: corp.code,
    basisCode: cached.value.points[0]?.basisCode ?? "CFS", quarterlyHistory: cached.value.points,
    count: cached.value.points.length, message: cached.value.points.length
      ? `실제 공시로 분기 ${cached.value.points.length}개를 구성했습니다.`
      : cached.value.failures.length ? `분기 조회 실패: ${cached.value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
  };
  const pending = historyInFlight.get(cacheKey);
  if (pending) {
    const value = await pending;
    return {
      found: true as const, company: corp.name, corpCode: corp.code,
      basisCode: value.points[0]?.basisCode ?? "CFS", quarterlyHistory: value.points,
      count: value.points.length, message: value.points.length
        ? `실제 공시로 분기 ${value.points.length}개를 구성했습니다.`
        : value.failures.length ? `분기 조회 실패: ${value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
    };
  }
  const request = quarterlyHistory(corp, "CFS", requestKey);
  historyInFlight.set(cacheKey, request);
  try {
    const value = await request;
    if (value.points.length) historyCache.set(cacheKey, { at: Date.now(), value });
    return {
      found: true as const, company: corp.name, corpCode: corp.code,
      basisCode: value.points[0]?.basisCode ?? "CFS", quarterlyHistory: value.points,
      count: value.points.length, message: value.points.length
        ? `실제 공시로 분기 ${value.points.length}개를 구성했습니다.`
        : value.failures.length ? `분기 조회 실패: ${value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
    };
  } finally {
    if (historyInFlight.get(cacheKey) === request) historyInFlight.delete(cacheKey);
  }
}

export async function clearDartCaches() {
  corpCache = null;
  stmtCache.clear();
  filingCache.clear();
  documentCache.clear();
  documentEntriesCache.clear();
  historyCache.clear();
  deepLinkCache.clear();
  return { ok: true as const, refreshedAt: new Date().toISOString() };
}

export async function searchDartCompanies(query: string, limit = 12, requestKey?: string) {
  const map = await corps(false, requestKey);
  return searchCorps(query, map, limit);
}

/** 등록 기업의 신규 공시 확인. DART list.json의 실제 접수번호만 반환합니다. */
export async function recentFilingsDart(companyNames: string[], fromDate: string, requestKey?: string) {
  if (!/^\d{8}$/.test(fromDate)) throw new TRPCError({ code: "BAD_REQUEST", message: "조회 시작일은 YYYYMMDD 형식이어야 합니다." });
  const today = new Date();
  const endDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const map = await corps(false, requestKey);
  const names = [...new Set(companyNames.map((name) => name.trim()).filter(Boolean))];
  const results = await mapWithConcurrency(names, 3, async (requested) => {
    const corp = findCorp(requested, map);
    if (!corp) return [] as Array<{ company: string; reportName: string; receiptDate: string; rceptNo: string; url: string }>;
    const params = new URLSearchParams({ crtfc_key: key(requestKey), corp_code: corp.code, bgn_de: fromDate, end_de: endDate, pblntf_ty: "A", page_no: "1", page_count: "100", sort: "date", sort_mth: "desc" });
    try {
      const response = await dartFetch(`${BASE}/list.json?${params}`, {}, 8_000);
      if (!response.ok) return [];
      const json = await response.json() as { status: string; list?: DartFiling[] };
      if (json.status !== "000") return [];
      return (json.list ?? []).filter((item) => /^\d{14}$/.test(item.rcept_no ?? "") && (item.rcept_dt ?? "") >= fromDate && (item.rcept_dt ?? "") <= endDate)
        .map((item) => ({ company: corp.name, reportName: item.report_nm, receiptDate: item.rcept_dt, rceptNo: item.rcept_no, url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}` }));
    } catch { return []; }
  });
  return results.flat().sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.rceptNo.localeCompare(a.rceptNo));
}

export async function snapshotDart(companyName: string, force = false, requestKey?: string, includeHistory = false, requestedBasis: "CFS" | "OFS" = "CFS") {
  const map = await corps(force, requestKey);
  const corp = findCorp(companyName, map);
  if (!corp) throw new TRPCError({ code: "NOT_FOUND", message: `DART 기업목록에서 찾지 못했습니다: ${companyName}` });

  // CFS를 우선 검색하되, 연결재무제표가 없는 기업은 동일 기간의 OFS로 폴백합니다.
  const resolved = await resolvePeriod(corp, periodCandidates(""), requestedBasis, force, requestKey);
  if (!resolved) return { found: false as const, company: corp.name, message: "공시검색 API에서 실제 접수번호와 재무제표를 확인할 수 없습니다." };
  const { period, rows, fs } = resolved;
  const metrics = {} as Record<FinancialMetric, { value: number | null; unit: string; formula: string | null; citation: string; available: boolean; lines?: string[]; disclaimer?: string | null } | null>;
  const rcept = rows.find((row) => row.rcept_no)?.rcept_no ?? "";
  (Object.keys(METRIC_LABELS) as FinancialMetric[]).forEach((metric) => {
    const picked = pickMetric(rows, period, metric);
    metrics[metric] = picked
      ? {
          value: Number.isFinite(picked.value) ? picked.value : null,
          unit: picked.unit,
          formula: picked.formula,
          citation: citation(periodLabel(period), picked.sourceHeading, rcept),
          available: Number.isFinite(picked.value),
          lines: picked.lines,
          disclaimer: picked.disclaimer,
        }
      : null;
  });
  // EBITDA 본문 계정이 확정되지 않으면 실제 접수번호의 첨부 주석 표를 추가로 확인합니다.
  // 당기 열과 단위가 모호한 주석 값은 사용하지 않습니다.
  if (!Number.isFinite(metrics.ebitda?.value)) {
    const operatingProfit = pickMetric(rows, period, "operatingProfit");
    if (!operatingProfit || !Number.isFinite(operatingProfit.value)) {
      metrics.ebitda = {
        value: null, unit: "억원", formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비",
        citation: citation(periodLabel(period), "EBITDA 구성 계정", rcept), available: false,
        lines: [], disclaimer: "같은 공시에서 영업이익 원천 계정을 확인하지 못해 EBITDA를 계산할 수 없습니다. 다른 기간의 영업이익으로 대체하지 않았습니다.",
      };
    } else {
      const noteDepreciation = /^\d{14}$/.test(rcept) ? await depreciationFromDisclosure(rcept, period, requestKey) : null;
      if (noteDepreciation) {
        const value = operatingProfit.value + noteDepreciation.value;
        metrics.ebitda = {
          value, unit: "억원", formula: "EBITDA = 영업이익 + DART 첨부 주석에 공시된 감가상각·상각비",
          citation: citation(periodLabel(period), "첨부 주석 > 감가상각·상각비", rcept), available: true,
          lines: [`영업이익 ${won(operatingProfit.value)}`, ...noteDepreciation.lines, `계산 EBITDA ${won(value)}`],
          disclaimer: null,
        };
      } else {
        metrics.ebitda = {
          ...(metrics.ebitda ?? { value: null, unit: "억원", formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비", citation: citation(periodLabel(period), "첨부 주석 > 감가상각·상각비", rcept), available: false, lines: [] }),
          disclaimer: "DART 본문 계정과 첨부 원문 주석을 확인했지만, 같은 기간의 감가상각비·무형자산상각비 금액과 단위를 명확하게 매칭하지 못했습니다. EBITDA를 추정하지 않았습니다. 보고서 주석을 직접 확인해야 합니다.",
        };
      }
    }
  }
  const quarterHistoryResult = includeHistory ? await quarterlyHistory(corp, fs, requestKey) : historyResponseShape([], []);
  const quarterHistory = quarterHistoryResult.points;
  return {
    found: true as const, company: corp.name, corpCode: corp.code, stockCode: corp.stock,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    periodKind: period.kind, basis: fsLabel(fs), basisCode: fs,
    metrics, rawAccountMetrics: pickRawAccountMetrics(rows, period, rcept), rawRows: rows, rceptNo: rcept, reportName: (await filingForPeriod(corp.code, period.year, period.code, requestKey))?.reportName ?? periodLabel(period),
    quarterlyHistory: quarterHistory, refreshedAt: new Date().toISOString(),
  };
}

export type CompareInput = {
  companies: string[];
  metric: FinancialMetric;
  year?: number;
  period: Kind | "latest" | "h2";
  basis: "CFS" | "OFS";
  force?: boolean;
};

export async function compareDart(input: CompareInput, requestKey?: string) {
  const map = await corps(Boolean(input.force), requestKey);
  const uniqueNames = [...new Set(input.companies)].slice(0, 8);
  const resultRows = [] as Array<{
    company: string;
    found: boolean;
    value: number | null;
    unit: string;
    period: string;
    basis: string;
    citation?: string;
    rceptNo?: string;
    formula?: string | null;
    message?: string;
  }>;

  for (const requested of uniqueNames) {
    const corp = findCorp(requested, map);
    if (!corp) {
      resultRows.push({ company: requested, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "DART 기업목록에서 찾지 못했습니다." });
      continue;
    }
    if (input.period === "h2") {
      const year = input.year ?? new Date().getFullYear() - 1;
      const pointInTimeMetrics = new Set<FinancialMetric>(["netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio"]);
      if (pointInTimeMetrics.has(input.metric)) {
        const annualResolved = await resolvePeriod(corp, [P(year, "annual", "cum")], input.basis, Boolean(input.force), requestKey);
        if (!annualResolved) {
          resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${year}년 하반기 말`, basis: fsLabel(input.basis), message: "연간 사업보고서의 기말 잔액을 확인할 수 없습니다." });
          continue;
        }
        const picked = pickMetric(annualResolved.rows, annualResolved.period, input.metric);
        const rcept = annualResolved.rows.find((r) => r.rcept_no)?.rcept_no ?? "";
        if (!picked || !Number.isFinite(picked.value)) {
          resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${year}년 하반기 말(사업보고서 기말)`, basis: fsLabel(annualResolved.fs), rceptNo: rcept || undefined, message: `${METRIC_LABELS[input.metric]} 기말 잔액의 원천 계정을 확인할 수 없습니다.` });
          continue;
        }
        resultRows.push({ company: corp.name, found: true, value: picked.value, unit: picked.unit, period: `${year}년 하반기 말(사업보고서 기말)`, basis: fsLabel(annualResolved.fs), rceptNo: rcept || undefined, citation: citation(`${year}년 사업보고서`, picked.sourceHeading, rcept), formula: picked.formula });
        continue;
      }
      const pair = await halfYearPair(corp, year, input.basis, requestKey);
      if (!pair) {
        resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${year}년 하반기`, basis: fsLabel(input.basis), message: "같은 회계 기준의 연간·상반기 공시가 모두 없어 하반기를 계산하지 않았습니다." });
        continue;
      }
      const picked = secondHalfPicked(pair, input.metric);
      const annualRcept = pair.annualRows.find((r) => r.rcept_no)?.rcept_no ?? "";
      const halfRcept = pair.halfRows.find((r) => r.rcept_no)?.rcept_no ?? "";
      if (!picked || !Number.isFinite(picked.value)) {
        resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${year}년 하반기(연간−상반기)`, basis: fsLabel(pair.fs), rceptNo: annualRcept || undefined, message: picked?.disclaimer ?? `${METRIC_LABELS[input.metric]}은 하반기 차감에 필요한 흐름 지표/원천 계정이 부족합니다.` });
        continue;
      }
      resultRows.push({ company: corp.name, found: true, value: picked.value, unit: picked.unit, period: `${year}년 하반기(연간−상반기)`, basis: fsLabel(pair.fs), rceptNo: annualRcept || undefined, citation: `연간 접수번호 ${annualRcept || "미확인"}; 상반기 접수번호 ${halfRcept || "미확인"}`, formula: picked.formula });
      continue;
    }
    const resolved = await resolvePeriod(corp, periodFromFilters(input.year, input.period), input.basis, Boolean(input.force), requestKey);
    if (!resolved) {
      resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "선택한 기간의 공시가 없습니다." });
      continue;
    }
    const picked = pickMetric(resolved.rows, resolved.period, input.metric);
    const rcept = resolved.rows.find((r) => r.rcept_no)?.rcept_no ?? "";
    if (!picked || !Number.isFinite(picked.value)) {
      resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`, basis: fsLabel(resolved.fs), rceptNo: rcept || undefined, message: picked?.disclaimer ?? `${METRIC_LABELS[input.metric]} 계정 또는 계산 구성 계정을 확인할 수 없습니다.` });
      continue;
    }
    resultRows.push({
      company: corp.name,
      found: true,
      value: picked.value,
      unit: picked.unit,
      period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`,
      basis: fsLabel(resolved.fs),
      rceptNo: rcept || undefined,
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

type HalfYearPair = { annualPeriod: Period; halfPeriod: Period; annualRows: Row[]; halfRows: Row[]; fs: "CFS" | "OFS" };

async function halfYearPair(corp: { code: string }, year: number, preferredFs: "CFS" | "OFS", requestKey?: string): Promise<HalfYearPair | null> {
  // 같은 회사·같은 회계 기준의 연간 누계와 상반기 누계가 모두 존재해야만 차감합니다.
  const order: Array<"CFS" | "OFS"> = preferredFs === "CFS" ? ["CFS", "OFS"] : ["OFS", "CFS"];
  for (const basis of order) {
    const annualPeriod = P(year, "annual", "cum");
    const halfPeriod = P(year, "half", "cum");
    const annualRows = await statements(corp.code, year, annualPeriod.code, basis, false, requestKey);
    const halfRows = await statements(corp.code, year, halfPeriod.code, basis, false, requestKey);
    if (annualRows?.length && halfRows?.length) return { annualPeriod, halfPeriod, annualRows, halfRows, fs: basis };
  }
  return null;
}

function secondHalfPicked(pair: HalfYearPair, metric: FinancialMetric): PickedMetric | null {
  const a = pickMetric(pair.annualRows, pair.annualPeriod, metric);
  const h = pickMetric(pair.halfRows, pair.halfPeriod, metric);
  const rceptFY = pair.annualRows.find((r) => r.rcept_no)?.rcept_no ?? "";
  const rceptH1 = pair.halfRows.find((r) => r.rcept_no)?.rcept_no ?? "";
  const source = `연간 접수번호 ${rceptFY || "미확인"} − 상반기 접수번호 ${rceptH1 || "미확인"}`;
  const pointInTimeMetrics = new Set<FinancialMetric>(["netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio"]);
  if (pointInTimeMetrics.has(metric)) {
    if (!a || !Number.isFinite(a.value)) return null;
    return {
      ...a,
      lines: [...a.lines, "이 지표는 누계가 아닌 기말 잔액/기말 비율이므로 연간 사업보고서의 12월 31일 실제 잔액을 사용했습니다.", `사업보고서 접수번호 ${rceptFY || "미확인"}`],
      sourceHeading: `사업보고서 > ${a.sourceHeading}`,
    };
  }
  if (metric === "operatingMargin" || metric === "netMargin") {
    const revA = pickMetric(pair.annualRows, pair.annualPeriod, "revenue");
    const revH = pickMetric(pair.halfRows, pair.halfPeriod, "revenue");
    const profitMetric: FinancialMetric = metric === "operatingMargin" ? "operatingProfit" : "netIncome";
    const profitA = pickMetric(pair.annualRows, pair.annualPeriod, profitMetric);
    const profitH = pickMetric(pair.halfRows, pair.halfPeriod, profitMetric);
    if (!revA || !revH || !profitA || !profitH) return null;
    const h2Revenue = revA.value - revH.value;
    const h2Profit = profitA.value - profitH.value;
    if (!Number.isFinite(h2Revenue) || !Number.isFinite(h2Profit) || h2Revenue === 0) return null;
    const profitLabel = metric === "operatingMargin" ? "영업이익" : "순이익";
    return { value: h2Profit / h2Revenue * 100, unit: "%", lines: [`하반기 매출액 = 연간 ${won(revA.value)} − 상반기 ${won(revH.value)} = ${won(h2Revenue)}`, `하반기 ${profitLabel} = 연간 ${won(profitA.value)} − 상반기 ${won(profitH.value)} = ${won(h2Profit)}`, source], formula: `${METRIC_LABELS[metric]} = (연간 누계 ${profitLabel} − 상반기 누계 ${profitLabel}) ÷ (연간 누계 매출 − 상반기 누계 매출) × 100`, disclaimer: null, sourceHeading: "사업보고서·반기보고서 > 하반기 파생 계산" };
  }
  if (!a || !h || !Number.isFinite(a.value) || !Number.isFinite(h.value)) return null;
  if (!["revenue", "operatingProfit", "netIncome", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "ebitda"].includes(metric)) return null;
  const value = a.value - h.value;
  if (!Number.isFinite(value)) return null;
  return { value, unit: a.unit, lines: [`연간 누계: ${won(a.value)}`, `상반기 누계: ${won(h.value)}`, `하반기 계산값: ${won(a.value)} − ${won(h.value)} = ${won(value)}`, source], formula: `${METRIC_LABELS[metric]}(하반기) = ${METRIC_LABELS[metric]}(연간 누계) − ${METRIC_LABELS[metric]}(상반기 누계)`, disclaimer: a.disclaimer || h.disclaimer, sourceHeading: "사업보고서·반기보고서 > 하반기 파생 계산" };
}

export async function askDart(question: string, requestKey?: string) {
  const parsed = parseDartQuery(question);
  const map = await corps(false, requestKey);
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
  if (/하반기/.test(question)) {
    if (!metrics.length) return fail("하반기는 사업보고서 누계에서 상반기 누계를 빼는 방식으로 계산합니다. 재무지표의 정확한 명칭을 지정해 주세요.");
    const flowMetrics = new Set<FinancialMetric>(["revenue", "operatingProfit", "netIncome", "operatingMargin", "netMargin", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "ebitda"]);
    const pointInTimeMetrics = new Set<FinancialMetric>(["netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio"]);
    const supportedH2Metrics = new Set<FinancialMetric>([...flowMetrics, ...pointInTimeMetrics]);
    const unsupported = metrics.filter((metric) => !supportedH2Metrics.has(metric));
    if (unsupported.length) return fail(`하반기 자료로 처리할 수 없는 지표입니다: ${unsupported.map((m) => METRIC_LABELS[m]).join(", ")}. 흐름 지표는 연간 누계−상반기 누계로 계산하고, 재무상태표 지표는 사업보고서 기말 잔액을 사용합니다.`);
    const requestedYear = parsed.yearEnd ?? parsed.years.at(-1) ?? parsed.yearStart ?? (new Date().getFullYear() - 1);
    if (metrics.every((metric) => pointInTimeMetrics.has(metric))) {
      const annualResolved = await resolvePeriod(corp, [P(requestedYear, "annual", "cum")], fs, false, requestKey);
      if (!annualResolved) return fail(`${corp.name}의 ${requestedYear}년 사업보고서에서 하반기 말 잔액을 확인할 수 없습니다.`);
      const values: Record<string, number | null> = {};
      const units: Record<string, string> = {};
      const lines: string[] = ["재무상태표 지표는 누계 차감 대상이 아니므로 하반기 말(12월 31일) 사업보고서 기말 잔액을 사용했습니다."];
      const pickedMap: Record<string, PickedMetric> = {};
      for (const metric of metrics) {
        const picked = pickMetric(annualResolved.rows, annualResolved.period, metric);
        values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
        units[metric] = picked?.unit ?? (metric === "borrowingsRatio" || metric === "debtRatio" || metric === "currentRatio" ? "%" : "억원");
        if (picked && Number.isFinite(picked.value)) { pickedMap[metric] = picked; lines.push(`${METRIC_LABELS[metric]}: ${formatMetricValue(picked.value, picked.unit)}`, ...picked.lines); }
      }
      if (metrics.every((metric) => values[metric] === null)) return fail(`${requestedYear}년 기말 잔액에 필요한 실제 원천 계정을 확인하지 못했습니다.`);
      const rcept = annualResolved.rows.find((row) => row.rcept_no)?.rcept_no ?? "";
      return {
        found: true as const, company: corp.name, period: `${requestedYear}년 하반기 말(12월 31일 기말 잔액)`, basis: fsLabel(annualResolved.fs), notice,
        metric: metrics.map((metric) => METRIC_LABELS[metric]).join(" · "),
        headline: metrics.map((metric) => `${METRIC_LABELS[metric]} ${values[metric] === null ? "자료 없음" : formatMetricValue(values[metric]!, units[metric])}`).join(" / "),
        lines, formula: metrics.map((metric) => pickedMap[metric]?.formula).filter(Boolean).join("; ") || null,
        citation: citation(`${requestedYear}년 사업보고서`, "재무상태표 기말 잔액", rcept),
        citations: [{ reportName: `${requestedYear}년 사업보고서`, rceptNo: rcept, url: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : null }],
        disclaimer: null, query: parsed,
      };
    }
    let pair: HalfYearPair | null = null;
    let targetYear = requestedYear;
    const explicitYear = parsed.yearEnd !== null || parsed.years.length > 0 || parsed.yearStart !== null;
    // 연도를 명시했다면 그 연도만 시도합니다. 연도를 생략한 경우에만 가장 최근 완결 연도를 역탐색합니다.
    const minYear = explicitYear ? requestedYear : Math.max(2000, requestedYear - 5);
    for (let year = requestedYear; year >= minYear; year--) {
      pair = await halfYearPair(corp, year, fs, requestKey);
      if (pair) { targetYear = year; break; }
    }
    if (!pair) return fail(`${corp.name}의 요청 연도 주변에서 동일 회계 기준의 사업보고서와 반기보고서를 모두 찾지 못해 하반기 수치를 계산할 수 없습니다.`);
    const values: Record<string, number | null> = {};
    const units: Record<string, string> = {};
    const missing: string[] = [];
    const pickedMap: Record<string, PickedMetric> = {};
    for (const metric of metrics) {
      const picked = secondHalfPicked(pair, metric);
      values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
      units[metric] = picked?.unit ?? (["operatingMargin", "netMargin"].includes(metric) ? "%" : "억원");
      if (picked && Number.isFinite(picked.value)) pickedMap[metric] = picked; else missing.push(METRIC_LABELS[metric]);
    }
    if (metrics.every((metric) => values[metric] === null)) return fail(`${targetYear}년 하반기 계산에 필요한 실제 공시 계정이 부족합니다. 추정값은 제공하지 않습니다. 누락 지표: ${missing.join(", ")}`);
    const primary = metrics[0];
    const rceptFY = pair.annualRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const rceptH1 = pair.halfRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const, company: corp.name, period: `${targetYear}년 하반기(7~12월) · 연간 누계 − 상반기 누계`, basis: fsLabel(pair.fs), notice,
      metric: metrics.map((m) => METRIC_LABELS[m]).join(" · "),
      headline: metrics.map((m) => `${METRIC_LABELS[m]} ${values[m] === null ? "자료 없음" : formatMetricValue(values[m]!, units[m])}`).join(" / "),
      lines: ["하반기 값은 동일 회계 기준의 사업보고서 연간 누계에서 반기보고서 상반기 누계를 차감했습니다.", ...metrics.flatMap((m) => pickedMap[m]?.lines ?? []), ...(missing.length ? [`공시 계정 부족으로 계산하지 않은 지표: ${missing.join(", ")}`] : [])],
      formula: "하반기(7~12월) = 사업보고서 연간 누계 − 반기보고서 상반기 누계",
      citation: citation(`${targetYear}년 사업보고서 + 반기보고서`, "연간 누계 − 상반기 누계", rceptFY),
      citations: [{ reportName: `${targetYear}년 사업보고서`, rceptNo: rceptFY, url: rceptFY ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptFY}` : null }, { reportName: `${targetYear}년 반기보고서`, rceptNo: rceptH1, url: rceptH1 ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptH1}` : null }],
      disclaimer: missing.length ? `일부 지표는 원천 계정 미확인으로 계산하지 않았습니다: ${missing.join(", ")}` : null, query: parsed,
    };
  }

  // 재무상태표/손익계산서/현금흐름표에 실제 계정명이 존재하는 경우에는
  // 임의의 다른 지표(예: 매출액)로 대체하지 않고 해당 계정만 정확히 찾습니다.
  if (parsed.directAccount && !metrics.length) {
    const candidates = parsed.kind && parsed.kind !== "latest" ? [P(parsed.yearEnd ?? parsed.years.at(-1) ?? new Date().getFullYear(), parsed.kind, parsed.mode ?? "cum")] : periodCandidates(question);
    if (!candidates.length) return fail(`${corp.name}의 요청 기간을 해석할 수 없습니다.`);
    const baseResolved = await resolvePeriod(corp, candidates, fs, false, requestKey);
    if (!baseResolved) return fail(`${corp.name}의 ${parsed.directAccount}을(를) 찾을 수 있는 보고서를 찾지 못했습니다.`);
    let periods: Period[] = [baseResolved.period];
    if (parsed.yearStart !== null && parsed.yearEnd !== null) periods = Array.from({ length: parsed.yearEnd - parsed.yearStart + 1 }, (_, i) => P(parsed.yearStart! + i, baseResolved.period.kind, baseResolved.period.mode));
    else if (parsed.recentYears) periods = Array.from({ length: parsed.recentYears }, (_, i) => P(baseResolved.period.year - (parsed.recentYears! - 1 - i), baseResolved.period.kind, baseResolved.period.mode));
    const series: any[] = [];
    for (const requestedPeriod of periods) {
      const resolvedYear = await resolvePeriod(corp, [requestedPeriod], baseResolved.fs, false, requestKey);
      const period = resolvedYear?.period ?? requestedPeriod;
      const rows = resolvedYear?.rows ?? null;
      const picked = rows ? pickDirectAccount(rows, period, parsed.directAccount) : null;
      series.push({ year: period.year, period: periodLabel(period), mode: modeLabel(period), basis: resolvedYear ? fsLabel(resolvedYear.fs) : fsLabel(baseResolved.fs), value: picked?.value ?? null, unit: picked?.unit ?? "억원", found: !!picked, message: !rows ? "해당 보고서가 없습니다." : !picked ? `${parsed.directAccount} 계정을 찾지 못했습니다.` : undefined });
    }
    const valid = series.filter((x) => x.value !== null);
    if (!valid.length) return fail(`${corp.name}의 요청한 기간에 '${parsed.directAccount}' 계정을 찾지 못했습니다.`);
    const latest = valid[valid.length - 1];
    const latestResolved = await resolvePeriod(corp, [P(latest.year, baseResolved.period.kind, baseResolved.period.mode)], baseResolved.fs, false, requestKey);
    const latestRows = latestResolved?.rows ?? null;
    const latestPeriod = latestResolved?.period ?? P(latest.year, baseResolved.period.kind, baseResolved.period.mode);
    const pickedLatest = latestRows ? pickDirectAccount(latestRows, latestPeriod, parsed.directAccount) : null;
    const rcept = latestRows?.find((r) => r.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const, company: corp.name,
      period: parsed.recentYears ? `최근 ${parsed.recentYears}개년 · ${modeLabel(baseResolved.period)}` : periods.length > 1 ? `${periodLabel(periods[0])} ~ ${periodLabel(periods.at(-1)!)}` : `${periodLabel(baseResolved.period)} · ${modeLabel(baseResolved.period)} · 기준일 ${baseDate(baseResolved.period)}`,
      basis: latestResolved ? fsLabel(latestResolved.fs) : fsLabel(baseResolved.fs), notice, metric: parsed.directAccount,
      headline: formatMetricValue(latest.value, latest.unit), lines: [`${parsed.directAccount} 연도별 조회`],
      series, formula: null, citation: citation(periodLabel(baseResolved.period), pickedLatest?.sourceHeading ?? `재무제표 > ${parsed.directAccount}`, rcept), disclaimer: null, query: parsed,
    };
  }

  // 1) 기간이 명시된 다년 질의: 2024~2026 / 최근 4개년 / 최근 3년 등.
  //    각 연도에서 같은 보고기간을 조회하고, 여러 지표가 들어오면 행/열 형태로 함께 반환한다.
  const isHistorical = parsed.analysis !== "cause" && (!!parsed.recentYears || requestedYears.length >= 2 || !!parsed.yearStart);
  if (isHistorical) {
    let base: Period | null = null;
    let historyFs: "CFS" | "OFS" = fs;
    if (parsed.yearStart !== null && parsed.yearEnd !== null) {
      const anchorYear = parsed.yearEnd;
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : [P(anchorYear, "annual", "cum"), P(anchorYear - 1, "annual", "cum"), P(anchorYear - 2, "annual", "cum")];
      const resolved = await resolvePeriod(corp, anchorCandidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 연간/요청 보고기간 공시를 찾지 못했습니다.`);
      base = explicitKind ? resolved.period : P(anchorYear, "annual", "cum");
      historyFs = resolved.fs;
    } else if (parsed.recentYears) {
      const currentYear = new Date().getFullYear();
      const candidates = parsed.kind && parsed.kind !== "latest"
        ? Array.from({ length: 15 }, (_, i) => P(currentYear - i, parsed.kind as Kind, parsed.mode ?? "cum"))
        : Array.from({ length: 15 }, (_, i) => P(currentYear - 1 - i, "annual", "cum"));
      const resolved = await resolvePeriod(corp, candidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 요청한 동일 보고기간 공시를 찾지 못했습니다.`);
      base = resolved.period;
      historyFs = resolved.fs;
    } else if (requestedYears.length >= 2) {
      const anchorYear = requestedYears[requestedYears.length - 1];
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : [P(anchorYear, "annual", "cum"), P(anchorYear - 1, "annual", "cum"), P(anchorYear - 2, "annual", "cum")];
      const resolved = await resolvePeriod(corp, anchorCandidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 연간/요청 보고기간 공시를 찾지 못했습니다.`);
      base = explicitKind ? resolved.period : P(anchorYear, "annual", "cum");
      historyFs = resolved.fs;
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

    for (const requestedPeriod of periods) {
      // 연도마다 요청 기준을 우선 조회하고, CFS가 없는 해에만 OFS로 재시도해 과거 공시 누락을 줄입니다.
      const resolvedYear = await resolvePeriod(corp, [requestedPeriod], historyFs, false, requestKey);
      const period = resolvedYear?.period ?? requestedPeriod;
      const rows = resolvedYear?.rows ?? null;
      const actualBasis = resolvedYear?.fs ?? historyFs;
      const values: Record<string, number | null> = {};
      const units: Record<string, string> = {};
      let found = false;
      for (const metric of metrics) {
        const picked = rows ? pickMetric(rows, period, metric) : null;
        values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
        units[metric] = picked?.unit ?? (["operatingMargin", "netMargin", "debtRatio", "currentRatio", "roe", "roa"].includes(metric) ? "%" : "억원");
        if (picked && Number.isFinite(picked.value)) found = true;
      }
      matrix.push({
        year: period.year,
        period: periodLabel(period),
        mode: modeLabel(period),
        basis: fsLabel(actualBasis),
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
    const latestRows = await statements(corp.code, latestRow.year, P(latestRow.year, base.kind, base.mode).code, historyFs, false, requestKey);
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
      basis: fsLabel(historyFs),
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
  // 여러 지표만 나열한 질의는 같은 최신 보고기간의 값을 한 행에 묶습니다.
  // 연도 비교를 요청하지 않았는데 매출·영업이익을 임의로 전년 비교로 바꾸지 않습니다.
  if (metrics.length >= 2 && requestedYears.length < 2 && !parsed.recentYears && parsed.yearStart === null && parsed.analysis !== "cause" && !/(올해.*(?:작년|지난해)|(?:작년|지난해).*올해|전년대비|작년보다|지난해보다)/.test(question)) {
    const resolved = await resolvePeriod(corp, periodCandidates(question), fs, false, requestKey);
    if (!resolved) return fail(`${corp.name}의 최신 공시 재무제표를 찾을 수 없습니다.`);
    const effectiveFs = resolved.fs;
    const values: Record<string, number | null> = {};
    const units: Record<string, string> = {};
    const missing: string[] = [];
    for (const metric of metrics) {
      const picked = pickMetric(resolved.rows, resolved.period, metric);
      values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
      units[metric] = picked?.unit ?? (["operatingMargin", "netMargin", "debtRatio", "currentRatio", "roe", "roa"].includes(metric) ? "%" : "억원");
      if (!picked) missing.push(METRIC_LABELS[metric]);
    }
    if (metrics.every((metric) => values[metric] === null)) return fail(`${corp.name}의 ${periodLabel(resolved.period)}에서 ${missing.join(", ")} 자료를 찾지 못했습니다.`);
    const rcept = resolved.rows.find((row) => row.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const,
      company: corp.name,
      period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)} · 기준일 ${baseDate(resolved.period)}`,
      basis: fsLabel(resolved.fs),
      notice,
      metric: metrics.map((metric) => METRIC_LABELS[metric]).join(" · "),
      headline: metrics.map((metric) => `${METRIC_LABELS[metric]} ${values[metric] === null ? "자료 없음" : formatMetricValue(values[metric]!, units[metric])}`).join(" / "),
      lines: ["요청한 지표를 동일 보고기간 기준으로 조회했습니다.", ...(missing.length ? [`자료를 찾지 못한 지표: ${missing.join(", ")}`] : [])],
      matrix: [{ year: resolved.period.year, period: periodLabel(resolved.period), mode: modeLabel(resolved.period), values, units, found: missing.length < metrics.length }],
      formula: null,
      citation: citation(periodLabel(resolved.period), `재무제표 > ${metrics.map((metric) => METRIC_LABELS[metric]).join("·")}`, rcept),
      disclaimer: null,
      query: parsed,
    };
  }

  const needsComparison = parsed.analysis === "comparison" || parsed.analysis === "cause" || /올해.*(?:작년|지난해)|(?:작년|지난해).*올해|전년대비|작년보다|지난해보다/.test(question);
  if (needsComparison) {
    const primary = metrics[0];
    let firstPeriod: Period;
    let secondPeriod: Period;
    if (requestedYears.length >= 2 || (parsed.yearStart !== null && parsed.yearEnd !== null)) {
      const firstYear = parsed.yearStart ?? requestedYears[0];
      const secondYear = parsed.yearEnd ?? requestedYears[requestedYears.length - 1];
      const kind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual";
      firstPeriod = P(firstYear, kind, parsed.mode ?? "cum");
      secondPeriod = P(secondYear, kind, parsed.mode ?? "cum");
    } else {
      const latest = await resolvePeriod(corp, periodCandidates(question), fs, false, requestKey);
      if (!latest) return fail(`${corp.name}의 최신 공시 재무제표를 찾을 수 없습니다.`);
      secondPeriod = latest.period;
      firstPeriod = P(latest.period.year - 1, latest.period.kind, latest.period.mode);
    }
    let pair: { firstRows: Row[]; secondRows: Row[]; fs: "CFS" | "OFS" } | null = null;
    const basisOrder: Array<"CFS" | "OFS"> = fs === "CFS" ? ["CFS", "OFS"] : ["OFS", "CFS"];
    for (const basis of basisOrder) {
      const firstRows = await statements(corp.code, firstPeriod.year, firstPeriod.code, basis, false, requestKey);
      const secondRows = await statements(corp.code, secondPeriod.year, secondPeriod.code, basis, false, requestKey);
      if (firstRows?.length && secondRows?.length) { pair = { firstRows, secondRows, fs: basis }; break; }
    }
    if (!pair) return fail(`${corp.name}의 ${periodLabel(firstPeriod)}와 ${periodLabel(secondPeriod)}을 동일 연결/별도 기준으로 비교할 수 있는 공시를 찾지 못했습니다.`);
    const firstPicked = pickMetric(pair.firstRows, firstPeriod, primary);
    const secondPicked = pickMetric(pair.secondRows, secondPeriod, primary);
    if (!firstPicked || !secondPicked || !Number.isFinite(firstPicked.value) || !Number.isFinite(secondPicked.value)) return fail(`${corp.name}의 비교 기간에 ${METRIC_LABELS[primary]} 원천 계정이 확인되지 않아 계산하지 않았습니다.`);
    const diff = secondPicked.value - firstPicked.value;
    const pct = firstPicked.value === 0 ? null : (diff / Math.abs(firstPicked.value)) * 100;
    const direction = diff > 0 ? "증가" : diff < 0 ? "감소" : "변동 없음";
    const firstRcept = pair.firstRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const secondRcept = pair.secondRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const lines = [
      `${METRIC_LABELS[primary]} ${direction}: ${formatMetricValue(Math.abs(diff), secondPicked.unit)}${pct === null ? "" : ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}`,
      `${periodLabel(firstPeriod)} ${formatMetricValue(firstPicked.value, firstPicked.unit)} → ${periodLabel(secondPeriod)} ${formatMetricValue(secondPicked.value, secondPicked.unit)}`,
      `비교 기준: 같은 보고기간·${fsLabel(pair.fs)}`,
    ];
    let causeAnalysis: Awaited<ReturnType<typeof analyzeDisclosureCause>> | undefined;
    if (parsed.hasCauseIntent) {
      causeAnalysis = await analyzeDisclosureCause({ corpCode: corp.code, corpName: corp.name, currentRcept: secondRcept, previousRcept: firstRcept, currentYear: secondPeriod.year, previousYear: firstPeriod.year, metric: primary, currentPeriod: periodLabel(secondPeriod), previousPeriod: periodLabel(firstPeriod) }, requestKey);
      lines.push(causeAnalysis.summary);
      if (causeAnalysis.evidence.length) lines.push(...causeAnalysis.evidence.slice(0, 4).map((ev, i) => `공시 근거 ${i + 1} [${ev.reportPeriod}${ev.explicitCause ? " · 원인 직접 명시" : " · 관련 설명(직접 원인 미확인)"}]: ${ev.excerpt}`));
    }
    return {
      found: true as const, company: corp.name,
      period: `${periodLabel(firstPeriod)} vs ${periodLabel(secondPeriod)} · ${modeLabel(secondPeriod)}`,
      basis: fsLabel(pair.fs), notice, metric: METRIC_LABELS[primary],
      headline: `${formatMetricValue(firstPicked.value, firstPicked.unit)} → ${formatMetricValue(secondPicked.value, secondPicked.unit)}`,
      lines, formula: secondPicked.formula,
      citation: citation(periodLabel(secondPeriod), secondPicked.sourceHeading, secondRcept),
      citations: [{ reportName: periodLabel(firstPeriod), rceptNo: firstRcept, url: firstRcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${firstRcept}` : null }, { reportName: periodLabel(secondPeriod), rceptNo: secondRcept, url: secondRcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${secondRcept}` : null }],
      causeAnalysis, disclaimer: secondPicked.disclaimer, query: parsed,
    };
  }

  // 3) 단일 숫자 질의.
  const cands = periodCandidates(question);
  if (!cands.length) return fail("하반기만으로는 직접 조회할 수 없습니다. 1분기·반기·3분기·사업보고서 기준으로 질문해 주세요.");
  const resolved = await resolvePeriod(corp, cands, fs, false, requestKey);
  if (!resolved) return fail(`해당 자료를 찾을 수 없습니다. (${corp.name} · ${cands.map(periodLabel).join(" / ")} · ${fsLabel(fs)})`);
  const { period, rows, fs: resolvedFs } = resolved;
  const metric = metrics[0];
  const picked = pickMetric(rows, period, metric);
  if (!picked) return fail(`${corp.name}의 '${METRIC_LABELS[metric]}' 계정을 ${periodLabel(period)}에서 찾지 못했습니다.`);
  const rcept = rows.find((r) => r.rcept_no)?.rcept_no ?? "";
  return {
    found: true as const,
    company: corp.name,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    basis: fsLabel(resolvedFs),
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
  if (!Number.isFinite(value)) return "자료 없음";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "원") return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
  // 억원 값은 소수점 첫째 자리까지 보존합니다. 정확한 원 단위 금액은 DART 원문 표에 별도로 남습니다.
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
}

