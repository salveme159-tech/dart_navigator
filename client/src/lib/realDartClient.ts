// Build repair 2026-10-27: includes EMPTY_DART_RECORD export.
import { apiUrl, apiBaseUrl } from "./apiBase";

export interface RawDartAccountMap {
  매출액: number;
  영업이익: number;
  순이익: number;
  자산총계: number;
  부채총계: number;
  자본총계: number;
  유동자산: number;
  유동부채: number;
  현금및현금성자산: number;
  단기금융상품: number;
  매출채권: number;
  재고자산: number;
  매입채무: number;
  단기차입금: number;
  유동성장기부채: number;
  사채: number;
  장기차입금: number;
  영업현금흐름: number;
  유형자산취득_CAPEX: number;
  감가상각비: number;
  금융원가: number;
}

export interface QuarterlyOnePagerItem {
  period: string;
  isEstimate?: boolean;
  isFourthQuarterDerived?: boolean;
  rceptNo?: string;
  basisCode?: "CFS" | "OFS";
  revenue: number;
  grossProfit?: number;
  sgaExpense?: number;
  operatingProfit: number;
  separateOperatingProfit?: number;
  subsidiaryAndAdjProfit?: number;
  netIncome?: number;
}

export interface RawDartRow {
  corp_code?: string;
  bsns_year?: string;
  reprt_code?: string;
  sj_div?: string;
  sj_nm?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_nm?: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
  frmtrm_nm?: string;
  frmtrm_amount?: string;
  bfefrmtrm_nm?: string;
  bfefrmtrm_amount?: string;
  rcept_no?: string;
  currency?: string;
  unit?: string;
}

export interface CrossValidationProviderValue {
  source: "NAVER_FINANCE";
  sourceLabel: string;
  url: string | null;
  found: boolean;
  value: number | null;
  unit: string;
  period: string | null;
  basis: "CFS" | "OFS" | "UNKNOWN";
  status: "MATCH" | "MISMATCH" | "UNAVAILABLE" | "NOT_COMPARABLE";
  differencePct: number | null;
  message: string;
}
export interface MetricCrossValidationValue {
  metric: string;
  metricLabel: string;
  status: "MATCH" | "MISMATCH" | "PARTIAL" | "UNAVAILABLE" | "NOT_COMPARABLE";
  dartValue: number | null;
  unit: string;
  period: string;
  basis: "CFS" | "OFS";
  tolerancePct: number;
  providers: CrossValidationProviderValue[];
  checkedAt: string;
  message: string;
}
export interface ServerMetricValue {
  value: number | null;
  unit: string;
  formula: string | null;
  citation: string;
  available?: boolean;
  lines?: string[];
  disclaimer?: string | null;
  crossValidation?: MetricCrossValidationValue;
}

export interface CompanyFinancialRecord {
  corpCode: string;
  corpName: string;
  stockCode: string;
  reportName: string;
  period: string;
  rceptNo: string;
  basisCode?: "CFS" | "OFS";
  isLiveApiFetched?: boolean;
  verificationPassed: boolean;
  verificationNote: string;
  accounts: RawDartAccountMap;
  quarterlyHistory?: QuarterlyOnePagerItem[];
  rawRows?: RawDartRow[];
  /** 서버에서 실제 원천 계정으로 계산한 지표. 키가 존재하면서 null이면 산출 불가를 뜻합니다. */
  serverMetrics?: Record<string, ServerMetricValue | null>;
  /** 카드용 기본 계정값. 동일한 DART 재무제표에서 행 이름·계정코드를 확인해 서버에서 추출합니다. */
  rawAccountMetrics?: Record<string, ServerMetricValue | null>;
  crossValidation?: Partial<Record<string, MetricCrossValidationValue>>;
  validationSummary?: { checked: number; matched: number; mismatched: number; partial: number; unverified: number; message: string };
}

// 초기 화면에 표시할 회사 이름만 둡니다. 기업코드·접수번호·재무 수치는 반드시 DART API에서 가져옵니다.
export const INITIAL_DART_COMPANIES = ["대한전선"] as const;

const EMPTY_ACCOUNT_MAP: RawDartAccountMap = {
  매출액: Number.NaN, 영업이익: Number.NaN, 순이익: Number.NaN,
  자산총계: Number.NaN, 부채총계: Number.NaN, 자본총계: Number.NaN,
  유동자산: Number.NaN, 유동부채: Number.NaN, 현금및현금성자산: Number.NaN,
  단기금융상품: Number.NaN, 매출채권: Number.NaN, 재고자산: Number.NaN, 매입채무: Number.NaN,
  단기차입금: Number.NaN, 유동성장기부채: Number.NaN, 사채: Number.NaN, 장기차입금: Number.NaN,
  영업현금흐름: Number.NaN, 유형자산취득_CAPEX: Number.NaN, 감가상각비: Number.NaN, 금융원가: Number.NaN,
};

// 조회 전 자리표시자입니다. 숫자를 제공하는 스냅샷이 아니며, 화면에서는 모든 값이 '자료 없음'으로 표시됩니다.
export const EMPTY_DART_RECORD: CompanyFinancialRecord = {
  corpCode: "", corpName: "DART 조회 대기", stockCode: "", reportName: "실시간 조회 전", period: "자료 미수집",
  rceptNo: "", isLiveApiFetched: false, verificationPassed: false,
  verificationNote: "OpenDART 인증키 검증 및 실시간 조회가 필요합니다.", accounts: EMPTY_ACCOUNT_MAP, quarterlyHistory: [], rawRows: [],
};

function parseAmountToEok(raw: unknown): number {
  if (raw === undefined || raw === null) return Number.NaN;
  const cleaned = String(raw).replace(/,/g, "").trim();
  if (!cleaned) return Number.NaN;
  if (/^(?:-|—|–|－|−)$/.test(cleaned)) return 0;
  const negativeParentheses = /^\(.*\)$/.test(cleaned);
  const numericText = negativeParentheses ? `-${cleaned.slice(1, -1)}` : cleaned;
  const num = Number(numericText);
  if (!Number.isFinite(num)) return Number.NaN;
  // 억원 환산 시 정수 반올림하지 않습니다. 원 단위 원문은 rawRows로 별도 보존합니다.
  return num / 100_000_000;
}

/** DART 원문 계정이 확인된 경우에만 금액을 채웁니다. 없거나 읽을 수 없는 계정은 NaN(자료 없음)으로 유지합니다. */
export function parseDartFullStatementRows(rows: RawDartRow[], basis: "CFS" | "OFS" = "CFS"): RawDartAccountMap {
  const findVal = (sjDivs: string[], ids: RegExp[], names: RegExp[], absolute = false): number => {
    const preferredSections = sjDivs.length === 1
      ? sjDivs
      : basis === "CFS"
        ? ["CIS", "IS", ...sjDivs.filter((s) => s !== "CIS" && s !== "IS")]
        : ["IS", "CIS", ...sjDivs.filter((s) => s !== "CIS" && s !== "IS")];
    const eligible = rows.filter((row) => preferredSections.includes(row.sj_div ?? ""))
      .sort((a, b) => preferredSections.indexOf(a.sj_div ?? "") - preferredSections.indexOf(b.sj_div ?? ""));
    const rawValue = (row: RawDartRow) => {
      const isBalanceRow = sjDivs.length === 1 && sjDivs[0] === "BS";
      const raw = isBalanceRow ? (row.thstrm_amount || row.thstrm_add_amount) : (row.thstrm_add_amount || row.thstrm_amount);
      const value = parseAmountToEok(raw);
      return Number.isFinite(value) ? (absolute ? Math.abs(value) : value) : Number.NaN;
    };
    // 계정코드는 공시 표준 태그를 먼저 찾되, 동일 태그가 IS/CIS에 있으면 기준별 우선순위가 적용된 행을 선택합니다.
    for (const id of ids) {
      const row = eligible.find((candidate) => id.test(String(candidate.account_id ?? "")) && Number.isFinite(rawValue(candidate)));
      if (row) return rawValue(row);
    }
    const normalized = (value: string) => value.replace(/[\s·ㆍ]/g, "");
    // 별칭의 선언 순서와 정확 일치 여부를 함께 평가해 '수익' 같은 넓은 표현이 다른 계정을 잡지 않게 합니다.
    for (const re of names) {
      const row = eligible.find((candidate) => {
        const name = normalized(String(candidate.account_nm ?? ""));
        const exactPattern = re.source.startsWith("^") && re.source.endsWith("$");
        return re.test(name) && (!exactPattern || re.test(name)) && Number.isFinite(rawValue(candidate));
      });
      if (row) return rawValue(row);
    }
    return Number.NaN;
  };

  return {
    매출액: findVal(["IS", "CIS"], [/^ifrs-full_Revenue$/i, /^dart_OperatingRevenue$/i], [/^매출액$/, /^수익\(매출액\)$/, /^영업수익$/, /^매출$/]),
    영업이익: findVal(["IS", "CIS"], [/^dart_OperatingIncomeLoss$/i, /^ifrs-full_ProfitLossFromOperatingActivities$/i], [/^영업이익(?:\(손실\))?$/, /^영업손익$/]),
    순이익: findVal(["IS", "CIS"], [/^ifrs-full_ProfitLoss$/i], [/^당기순이익(?:\(손실\))?$/, /^당기순손익$/, /^연결당기순이익$/, /^분기순이익$/, /^반기순이익$/]),
    자산총계: findVal(["BS"], [/^ifrs-full_Assets$/i], [/^자산총계$/, /^총자산$/]),
    부채총계: findVal(["BS"], [/^ifrs-full_Liabilities$/i], [/^부채총계$/, /^총부채$/]),
    자본총계: findVal(["BS"], [/^ifrs-full_Equity$/i], [/^자본총계$/, /^총자본$/]),
    유동자산: findVal(["BS"], [/^ifrs-full_CurrentAssets$/i], [/^유동자산(?:합계)?$/]),
    유동부채: findVal(["BS"], [/^ifrs-full_CurrentLiabilities$/i], [/^유동부채(?:합계)?$/]),
    현금및현금성자산: findVal(["BS"], [/^ifrs-full_CashAndCashEquivalents$/i], [/^현금(?:및|과)현금성자산(?:합계)?$/]),
    단기금융상품: findVal(["BS"], [/^dart_ShortTermDepositsNotClassifiedAsCashEquivalents$/i], [/^단기금융상품(?:합계)?$/, /^단기투자자산$/, /^단기금융자산$/]),
    매출채권: findVal(["BS"], [/^ifrs-full_TradeAndOtherCurrentReceivables$/i], [/^매출채권(?:및기타채권)?$/, /^단기매출채권$/]),
    재고자산: findVal(["BS"], [/^ifrs-full_Inventories$/i], [/^재고자산(?:합계)?$/, /^유동재고자산$/]),
    매입채무: findVal(["BS"], [/^ifrs-full_TradeAndOtherCurrentPayables$/i], [/^매입채무$/, /^매입채무및기타채무$/, /^유동매입채무$/]),
    단기차입금: findVal(["BS"], [/^ifrs-full_ShorttermBorrowings$/i], [/^단기차입금$/]),
    유동성장기부채: findVal(["BS"], [/^ifrs-full_CurrentPortionOfLongtermBorrowings$/i], [/^유동성장기부채$/, /^유동성장기차입금$/, /^유동성장기사채$/, /^비유동차입금의유동성대체부분$/]),
    사채: findVal(["BS"], [/^ifrs-full_BondsIssued$/i], [/^사채$/, /^회사채$/]),
    장기차입금: findVal(["BS"], [/^ifrs-full_LongtermBorrowings$/i], [/^장기차입금$/, /^장기차입부채$/, /^비유동차입금$/]),
    영업현금흐름: findVal(["CF"], [/^ifrs-full_CashFlowsFromUsedInOperatingActivities$/i], [/^영업활동으로인한현금흐름$/, /^영업활동현금흐름$/, /^영업활동순현금흐름$/]),
    유형자산취득_CAPEX: findVal(["CF"], [/^ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i], [/^유형자산의취득$/, /^유형자산의증가$/], true),
    감가상각비: findVal(["CF", "IS", "CIS"], [/^ifrs-full_AdjustmentsForDepreciationExpense$/i, /^ifrs-full_DepreciationAndAmortisationExpense$/i], [/^감가상각비$/, /^유무형자산상각비$/, /^유형자산감가상각비$/, /^무형자산상각비$/, /^사용권자산상각비$/], true),
    금융원가: findVal(["IS", "CIS"], [/^ifrs-full_FinanceCosts$/i], [/^금융원가$/, /^금융비용$/, /^이자비용$/]),
  };
}

function unwrapTrpc(payload: any): any {
  return payload?.result?.data?.json ?? payload?.result?.data ?? payload;
}

async function readTrpc(path: string, apiKey: string): Promise<{ response: Response; data: any }> {
  const input = encodeURIComponent(JSON.stringify({ json: {} }));
  const response = await fetch(apiUrl(`/api/trpc/${path}?input=${input}`), {
    method: "GET",
    headers: { "X-OpenDART-Key": apiKey.trim() },
    credentials: apiBaseUrl ? "omit" : "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  return { response, data: unwrapTrpc(payload), payload } as any;
}

export type DartCompanySearchResult = { name: string; code: string; stock: string };

export async function searchLiveDartCompanies(query: string, apiKey: string, limit = 10): Promise<DartCompanySearchResult[]> {
  const clean = query.trim();
  if (clean.length < 1) return [];
  const input = encodeURIComponent(JSON.stringify({ json: { query: clean, limit } }));
  const response = await fetch(apiUrl(`/api/trpc/dart.searchCompanies?input=${input}`), {
    headers: { "X-OpenDART-Key": apiKey.trim() },
    credentials: apiBaseUrl ? "omit" : "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  const data = unwrapTrpc(payload);
  if (!response.ok || !Array.isArray(data)) return [];
  return data.filter((row: any) => row && typeof row.name === "string" && typeof row.code === "string") as DartCompanySearchResult[];
}

export type DartKeyValidation = {
  valid: boolean;
  message: string;
  /** invalid: DART가 키를 거부 / format: 형식 오류 / no-server: 조회 서버 주소 없음 / network: 서버 응답 없음 */
  reason?: "invalid" | "format" | "no-server" | "network";
};

export async function validateDartApiKey(apiKey: string): Promise<DartKeyValidation> {
  const normalized = apiKey.trim();
  if (!/^[A-Za-z0-9]{40}$/.test(normalized)) {
    return { valid: false, reason: "format", message: "OpenDART 인증키는 영문·숫자 40자리여야 합니다." };
  }
  if (/^(DEMO|VERIFIED)/i.test(normalized)) {
    return { valid: false, reason: "format", message: "데모용 문구는 실제 DART 인증키가 아닙니다. 발급받은 키를 입력하세요." };
  }
  // GitHub Pages는 정적 호스팅이라 /api/trpc 서버가 없습니다. API 서버 주소가 빌드에 주입되지 않았다면 키 문제가 아니라 서버 미연결입니다.
  if (typeof window !== "undefined" && !apiBaseUrl && /\.github\.io$/i.test(window.location.hostname)) {
    return {
      valid: false,
      reason: "no-server",
      message: "인증키 문제가 아니라, 이 사이트(GitHub Pages)에 DART 조회 서버가 연결되어 있지 않습니다. API 서버를 따로 배포하고 VITE_API_BASE_URL을 설정해 다시 배포해야 합니다. (DEPLOY_BACKEND_KO.md 참고)",
    };
  }
  try {
    const { response, data, payload } = await readTrpc("dart.validateKey", normalized) as any;
    if (data?.valid === true && response.ok) {
      return { valid: true, message: `DART 인증 성공 · 기업 ${Number(data.companyCount ?? 0).toLocaleString("ko-KR")}개 인덱스 확인` };
    }
    // 서버가 키를 명시적으로 거부한 경우에만 '키 오류'로 봅니다. JSON이 없거나 404/5xx이면 서버 연결 문제입니다.
    if (data && typeof data === "object" && data.valid === false) {
      return { valid: false, reason: "invalid", message: data.message ?? "DART 인증키 검증에 실패했습니다. 키를 확인하세요." };
    }
    const serverMessage = payload?.error?.json?.message ?? payload?.error?.message;
    return { valid: false, reason: "network", message: `DART 조회 서버가 정상 응답하지 않았습니다(HTTP ${response.status}). ${serverMessage ?? "서버 주소·CORS 설정과 서버 실행 상태를 확인하세요."}` };
  } catch {
    return { valid: false, reason: "network", message: "DART 조회 서버에 연결하지 못했습니다. 서버 주소(VITE_API_BASE_URL), 서버 실행 상태, CORS_ALLOWED_ORIGINS 설정을 확인하세요." };
  }
}

/** 실제 OpenDART 서버 결과만 반환합니다. 캐시·기준 스냅샷·임의 수치로 폴백하지 않습니다. */
export async function fetchLiveDartCompanyRecord(
  corpNameInput: string,
  apiKey: string,
  includeHistory = false,
  basis: "CFS" | "OFS" = "CFS",
  force = false,
): Promise<{ record: CompanyFinancialRecord | null; errorMsg?: string }> {
  const cleanName = corpNameInput.trim();
  if (!cleanName) return { record: null, errorMsg: "기업명을 입력하세요." };
  try {
    const input = encodeURIComponent(JSON.stringify({ json: { company: cleanName, force, includeHistory, basis } }));
    const response = await fetch(apiUrl(`/api/trpc/dart.snapshot?input=${input}`), {
      method: "GET",
      headers: { "X-OpenDART-Key": apiKey.trim() },
      credentials: apiBaseUrl ? "omit" : "same-origin",
    });
    const payload = await response.json().catch(() => ({}));
    const data = unwrapTrpc(payload);
    if (!response.ok || data?.found !== true || !Array.isArray(data.rawRows) || !/^\d{14}$/.test(String(data.rceptNo ?? ""))) {
      const errorMessage = payload?.error?.json?.message ?? data?.message;
      return { record: null, errorMsg: errorMessage ?? `실시간 DART 원문을 확인하지 못했습니다: ${cleanName}. 실제 접수번호가 확인되지 않은 자료는 표시하지 않았습니다.` };
    }

    const rawRows = data.rawRows as RawDartRow[];
    const parsedAccounts = parseDartFullStatementRows(rawRows, data.basisCode === "OFS" ? "OFS" : "CFS");
    const totalsAreKnown = [parsedAccounts.자산총계, parsedAccounts.부채총계, parsedAccounts.자본총계].every(Number.isFinite);
    const diff = totalsAreKnown ? Math.abs(parsedAccounts.자산총계 - (parsedAccounts.부채총계 + parsedAccounts.자본총계)) : Number.NaN;
    const passed = totalsAreKnown && diff <= Math.max(0.01, Math.abs(parsedAccounts.자산총계) * 0.002);
    const unavailable = Object.entries(parsedAccounts).filter(([, value]) => !Number.isFinite(value)).map(([name]) => name);
    return {
      record: {
        corpCode: String(data.corpCode ?? ""),
        corpName: String(data.company ?? cleanName),
        stockCode: String(data.stockCode ?? ""),
        reportName: String(data.period ?? "DART 정기보고서"),
        period: String(data.period ?? ""),
        rceptNo: String(data.rceptNo),
        basisCode: data.basisCode === "OFS" ? "OFS" : "CFS",
        isLiveApiFetched: true,
        verificationPassed: passed,
        verificationNote: passed
          ? `실시간 원문 회계항등식 점검 통과 · 차이 ${diff.toFixed(2)}억원`
          : totalsAreKnown
            ? `회계항등식 차이 ${diff.toFixed(2)}억원 · 수치 사용 전 원문 확인 필요`
            : `회계항등식 구성 계정 미수집 · 자료 없음: ${unavailable.join(", ")}`,
        accounts: parsedAccounts,
        quarterlyHistory: Array.isArray(data.quarterlyHistory) ? data.quarterlyHistory : [],
        rawRows,
        serverMetrics: data.metrics && typeof data.metrics === "object" ? data.metrics as Record<string, ServerMetricValue | null> : undefined,
        rawAccountMetrics: data.rawAccountMetrics && typeof data.rawAccountMetrics === "object" ? data.rawAccountMetrics as Record<string, ServerMetricValue | null> : undefined,
        crossValidation: data.crossValidation && typeof data.crossValidation === "object" ? data.crossValidation as Partial<Record<string, MetricCrossValidationValue>> : undefined,
        validationSummary: data.validationSummary && typeof data.validationSummary === "object" ? data.validationSummary : undefined,
      },
    };
  } catch (error) {
    return { record: null, errorMsg: error instanceof Error ? error.message : "OpenDART 실시간 조회에 실패했습니다." };
  }
}


/** 분기 시계열은 기본 스냅샷과 분리해 조회합니다. 한 건의 API 요청이 장시간 멈춰 첫 화면의 핵심 지표까지 가리는 문제를 방지합니다. */
export async function fetchLiveDartCompanyHistory(
  corpNameInput: string,
  apiKey: string,
): Promise<{ quarterlyHistory: QuarterlyOnePagerItem[]; basisCode?: "CFS" | "OFS"; errorMsg?: string }> {
  const cleanName = corpNameInput.trim();
  if (!cleanName) return { quarterlyHistory: [], errorMsg: "기업명이 비어 있습니다." };
  try {
    const input = encodeURIComponent(JSON.stringify({ json: { company: cleanName } }));
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 40_000);
    let response: Response;
    try {
      response = await fetch(apiUrl(`/api/trpc/dart.history?input=${input}`), {
        method: "GET",
        headers: { "X-OpenDART-Key": apiKey.trim() },
        credentials: apiBaseUrl ? "omit" : "same-origin",
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
    const payload = await response.json().catch(() => ({}));
    const data = unwrapTrpc(payload);
    if (!response.ok || data?.found !== true || !Array.isArray(data.quarterlyHistory)) {
      return {
        quarterlyHistory: [],
        errorMsg: payload?.error?.json?.message ?? data?.message ?? "DART 분기 시계열 조회에 실패했습니다.",
      };
    }
    return {
      quarterlyHistory: data.quarterlyHistory as QuarterlyOnePagerItem[],
      basisCode: data.basisCode === "OFS" ? "OFS" : "CFS",
      errorMsg: data.quarterlyHistory.length ? undefined : data.message ?? "실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
    };
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "분기 공시 조회가 40초를 초과했습니다. 현재 서버의 OpenDART 응답 또는 공시 검색이 지연되고 있습니다. 재시도하거나 API 서버 로그를 확인하세요."
      : error instanceof Error ? error.message : "DART 분기 시계열 조회에 실패했습니다.";
    return { quarterlyHistory: [], errorMsg: message };
  }
}
