import { metricSourceLinks } from "@/lib/metricSources";
import { COMPARISON_METRIC_BY_LABEL } from "@shared/comparisonMetrics";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { apiBaseUrl, apiUrl } from "@/lib/apiBase";
import LiveDartPanel from "@/components/LiveDartPanel";
import { startComparisonLoad } from "@/lib/comparisonLoader";
import { startFilingPolling } from "@/lib/filingPolling";
import {
  Search,
  Plus,
  X,
  RefreshCw,
  Download,
  FileText,
  KeyRound,
  ExternalLink,
  Check,
  BookOpen,
  MessageSquare,
  BarChart3,
  LayoutDashboard,
  FileSpreadsheet,
  ShieldCheck,
  Printer,
} from "lucide-react";
import {
  exportComparisonExcel,
  exportComparisonPdf,
  type ComparisonExportMatrix,
} from "@/lib/xlsxExport";
import {
  CompanyFinancialRecord,
  EMPTY_DART_RECORD,
  INITIAL_DART_COMPANIES,
  validateDartApiKey,
  fetchLiveDartCompanyRecord,
  fetchLiveDartCompanyHistory,
  searchLiveDartCompanies,
  QuarterlyOnePagerItem,
} from "@/lib/realDartClient";
import type { RawDartAccountMap, RawDartRow } from "@/lib/realDartClient";

// ============================================================================
// 1. 지표 정의 엔진
//    - 요청 반영: 이자보상배율, ROE, ROA, EPS, PER, PBR 완전 삭제
//    - 요청 반영: 순운전자본 -> 운전자본, 순차입금 -> 차입금 으로 계산 및 명칭 변경
//    - 원천 공시 계정이 확인되는 경우에만 CAPEX, FCF, 자산회전율, EBITDA를 산출
// ============================================================================
export interface MetricDefinition {
  id: string;
  label: string;
  category: "손익/수익성" | "재무상태/안정성" | "현금흐름/투자" | "운전자본/차입금";
  unit: "억원" | "%" | "회";
  formulaText: string;
  aliases: string[];
  compute: (c: CompanyFinancialRecord) => number;
}

type LiveCompareRow = {
  company: string;
  found: boolean;
  value: number | null;
  unit: string;
  period: string;
  basis: string;
  citation?: string;
  source?: string;
  rceptNo?: string;
  message?: string;
};

type ComparePeriodChoice = "latest" | "q1" | "half" | "q3" | "annual";

export const SERVER_METRIC_BY_UI_LABEL: Record<string, string> = {
  "매출액": "revenue", "영업이익": "operatingProfit", "순이익": "netIncome",
  "영업이익률": "operatingMargin", "순이익률": "netMargin",
  "영업현금흐름": "operatingCashFlow", "투자현금흐름": "investmentCashFlow", "투자활동현금흐름": "investmentCashFlow",
  "재무현금흐름": "financingCashFlow", "재무활동현금흐름": "financingCashFlow",
  "CAPEX": "capex", "FCF": "freeCashFlow", "순차입금": "netDebt", "차입금": "borrowings",
  "차입금의존도": "borrowingsRatio", "운전자본": "workingCapital", "매입채무": "payables", "부채비율": "debtRatio",
  "유동비율": "currentRatio", "이자보상배율": "interestCoverage", "ROE": "roe", "ROA": "roa",
  "EPS": "eps", "EBITDA": "ebitda", "PER": "per", "PBR": "pbr",
};

// Raw-account comparison routes are not snapshot serverMetrics keys.
export const COMPARISON_METRIC_BY_UI_LABEL: Record<string, string> = {...SERVER_METRIC_BY_UI_LABEL, ...COMPARISON_METRIC_BY_LABEL};

function companySearchControl(props: {
  expanded: boolean;
  query: string;
  suggestions: Array<{name:string; code:string; stock?:string}>;
  busy: boolean;
  onToggle: (expanded:boolean) => void;
  onQueryChange: (query:string) => void;
  onPick: (name:string) => Promise<void>;
}) {
  return <div className="flex flex-wrap items-center gap-3" data-company-search="true">
    {!props.expanded ? <button type="button" onClick={() => props.onToggle(true)} aria-expanded={false} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" />기업 검색</button> :
      <div className="relative flex flex-wrap items-center gap-2">
        <input type="text" autoFocus value={props.query} onChange={e => props.onQueryChange(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && props.query.trim()) void props.onPick(props.query.trim());}} aria-label="기업명 검색" placeholder="기업명 검색" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs" />
        <button type="button" disabled={props.busy || !props.query.trim()} onClick={() => void props.onPick(props.query.trim())} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">기업 검색</button>
        <button type="button" aria-label="기업 검색 닫기" onClick={() => props.onToggle(false)} className="p-1 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        {props.suggestions.length > 0 && <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{props.suggestions.map(item => <button type="button" key={item.code} onClick={() => void props.onPick(item.name)} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-emerald-50"><span className="font-bold">{item.name}</span><span className="ml-2 text-slate-500">{item.stock || item.code}</span></button>)}</div>}
      </div>}
  </div>;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "영업이익률",
    label: "영업이익률",
    category: "손익/수익성",
    unit: "%",
    formulaText: "(영업이익 ÷ 매출액) × 100",
    aliases: ["영업이익률", "영업이익율", "opm", "영업마진", "이익률", "이익율"],
    compute: (c) => Number(((c.accounts.영업이익 / c.accounts.매출액) * 100).toFixed(2)),
  },
  {
    id: "순이익률",
    label: "순이익률",
    category: "손익/수익성",
    unit: "%",
    formulaText: "(당기순이익 ÷ 매출액) × 100",
    aliases: ["순이익률", "순이익율", "당기순이익률", "당기순이익율", "npm"],
    compute: (c) => Number(((c.accounts.순이익 / c.accounts.매출액) * 100).toFixed(2)),
  },
  {
    id: "매출액",
    label: "매출액",
    category: "손익/수익성",
    unit: "억원",
    formulaText: "연결 포괄손익계산서 수익(매출액)",
    aliases: ["매출액", "매출", "수익", "영업수익"],
    compute: (c) => c.accounts.매출액,
  },
  {
    id: "영업이익",
    label: "영업이익",
    category: "손익/수익성",
    unit: "억원",
    formulaText: "연결 포괄손익계산서 영업이익",
    aliases: ["영업이익", "영업손익"],
    compute: (c) => c.accounts.영업이익,
  },
  {
    id: "순이익",
    label: "순이익",
    category: "손익/수익성",
    unit: "억원",
    formulaText: "연결 포괄손익계산서 당기순이익(손실)",
    aliases: ["당기순이익", "순이익", "분기순이익", "연결순이익"],
    compute: (c) => c.accounts.순이익,
  },
  {
    id: "EBITDA",
    label: "EBITDA",
    category: "손익/수익성",
    unit: "억원",
    formulaText: "영업이익 + 감가상각비(유·무형자산상각비)",
    aliases: ["ebitda", "에비타", "감가상각전영업이익"],
    compute: (c) => c.accounts.영업이익 + c.accounts.감가상각비,
  },
  {
    id: "자산총계",
    label: "자산총계",
    category: "재무상태/안정성",
    unit: "억원",
    formulaText: "연결 재무상태표 자산총계",
    aliases: ["자산총계", "총자산", "자산"],
    compute: (c) => c.accounts.자산총계,
  },
  {
    id: "부채총계",
    label: "부채총계",
    category: "재무상태/안정성",
    unit: "억원",
    formulaText: "연결 재무상태표 부채총계",
    aliases: ["부채총계", "총부채", "부채"],
    compute: (c) => c.accounts.부채총계,
  },
  {
    id: "자본총계",
    label: "자본총계",
    category: "재무상태/안정성",
    unit: "억원",
    formulaText: "연결 재무상태표 자본총계",
    aliases: ["자본총계", "총자본", "자기자본", "자본"],
    compute: (c) => c.accounts.자본총계,
  },
  {
    id: "부채비율",
    label: "부채비율",
    category: "재무상태/안정성",
    unit: "%",
    formulaText: "(부채총계 ÷ 자본총계) × 100",
    aliases: ["부채비율"],
    compute: (c) => Number(((c.accounts.부채총계 / c.accounts.자본총계) * 100).toFixed(2)),
  },
  {
    id: "차입금의존도",
    label: "차입금 의존도",
    category: "운전자본/차입금",
    unit: "%",
    formulaText: "(차입금(리스부채 미포함) ÷ 자산총계) × 100",
    aliases: ["차입금의존도", "차입금 의존도"],
    compute: (c) => c.serverMetrics?.borrowingsRatio?.value ?? Number.NaN,
  },
  {
    id: "차입금",
    label: "차입금",
    category: "운전자본/차입금",
    unit: "억원",
    formulaText: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금 (리스부채 미포함)",
    aliases: ["차입금", "총차입금"],
    compute: (c) => c.serverMetrics?.borrowings?.value ?? Number.NaN,
  },
  {
    id: "운전자본",
    label: "운전자본",
    category: "운전자본/차입금",
    unit: "억원",
    formulaText: "매출채권 + 재고자산 - 매입채무",
    aliases: ["운전자본", "영업운전자본"],
    compute: (c) => c.accounts.매출채권 + c.accounts.재고자산 - c.accounts.매입채무,
  },
  {
    id: "유동자산",
    label: "유동자산",
    category: "재무상태/안정성",
    unit: "억원",
    formulaText: "연결 재무상태표 유동자산",
    aliases: ["유동자산"],
    compute: (c) => c.accounts.유동자산,
  },
  {
    id: "현금및현금성자산",
    label: "현금및현금성자산",
    category: "현금흐름/투자",
    unit: "억원",
    formulaText: "연결 재무상태표 현금및현금성자산",
    aliases: ["현금및현금성자산", "현금성자산", "현금"],
    compute: (c) => c.accounts.현금및현금성자산,
  },
  {
    id: "단기금융상품",
    label: "단기금융상품",
    category: "현금흐름/투자",
    unit: "억원",
    formulaText: "연결 재무상태표 단기금융상품",
    aliases: ["단기금융상품"],
    compute: (c) => c.accounts.단기금융상품,
  },
  {
    id: "재고자산",
    label: "재고자산",
    category: "운전자본/차입금",
    unit: "억원",
    formulaText: "연결 재무상태표 재고자산",
    aliases: ["재고자산", "재고"],
    compute: (c) => c.accounts.재고자산,
  },
  {
    id: "매입채무",
    label: "매입채무",
    category: "운전자본/차입금",
    unit: "억원",
    formulaText: "연결 재무상태표 매입채무",
    aliases: ["매입채무"],
    compute: (c) => c.accounts.매입채무,
  },
  {
    id: "금융원가",
    label: "금융원가",
    category: "손익/수익성",
    unit: "억원",
    formulaText: "연결 포괄손익계산서 금융원가(이자비용 포함)",
    aliases: ["금융원가", "이자비용", "금융비용"],
    compute: (c) => c.accounts.금융원가,
  },
  {
    id: "영업현금흐름",
    label: "영업현금흐름",
    category: "현금흐름/투자",
    unit: "억원",
    formulaText: "연결 현금흐름표 영업활동현금흐름",
    aliases: ["영업현금흐름", "영업활동현금흐름", "ocf"],
    compute: (c) => c.accounts.영업현금흐름,
  },
  {
    id: "CAPEX",
    label: "CAPEX",
    category: "현금흐름/투자",
    unit: "억원",
    formulaText: "연결 현금흐름표 유형자산의 취득(설비투자)",
    aliases: ["capex", "설비투자", "유형자산취득", "캐펙스"],
    compute: (c) => c.accounts.유형자산취득_CAPEX,
  },
  {
    id: "FCF",
    label: "FCF",
    category: "현금흐름/투자",
    unit: "억원",
    formulaText: "영업현금흐름(OCF) - 설비투자(CAPEX)",
    aliases: ["fcf", "잉여현금흐름", "프리캐시플로우"],
    compute: (c) => c.accounts.영업현금흐름 - c.accounts.유형자산취득_CAPEX,
  },
  {
    id: "자산회전율",
    label: "자산회전율",
    category: "손익/수익성",
    unit: "회",
    formulaText: "매출액 ÷ 자산총계",
    aliases: ["자산회전율", "총자산회전율"],
    compute: (c) => Number((c.accounts.매출액 / c.accounts.자산총계).toFixed(2)),
  },
];

export function formatMetricValue(val: number, unit: MetricDefinition["unit"]): string {
  if (!Number.isFinite(val)) return "자료 없음";
  if (unit === "%") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
  if (unit === "회") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회`;
  return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
}


function userFacingDartError(value: unknown, fallback = "DART 조회에 실패했습니다."): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (/failed to fetch|networkerror|fetch failed|load failed/i.test(raw)) {
    return "DART 조회 서버에 연결하지 못했습니다. 서버 실행 상태와 OpenDART 인증키를 확인한 뒤 다시 시도하세요.";
  }
  if (/네이버 금융|FnGuide|Yahoo Finance|교차검증|수치 대조/i.test(raw)) {
    return "공시 원문에서 필요한 계정 정보를 모두 확인하지 못했습니다. 확인되지 않은 수치는 임의로 보정하지 않았습니다.";
  }
  const cleaned = raw
    .replace(/CFS\s*\(연결\)\s*공시가 없으면\s*OFS\s*\(별도\)를\s*확인합니다\.?/gi, "")
    .replace(/조회 실패와 실제 미공시를 구분(?:하며|합니다)[,，。]?/g, "")
    .replace(/실제 수치가 확보되지 않은 구간은 만들어 채우지 않습니다\.?/g, "")
    .trim();
  return cleaned || fallback;
}


function makeDartRegisteredPlaceholder(item: { name: string; code: string; stock: string }): CompanyFinancialRecord {
  return {
    ...EMPTY_DART_RECORD,
    corpCode: item.code,
    corpName: item.name,
    stockCode: item.stock || "비상장",
    reportName: "DART 등록 기업 · 재무자료 미확보",
    period: "재무제표 조회 대기",
    rceptNo: "",
    isLiveApiFetched: false,
    verificationPassed: false,
    verificationNote: "DART 기업코드는 확인됐습니다. 조회 가능한 정기 재무제표가 없거나 현재 기간 데이터가 제공되지 않았습니다.",
    accounts: { ...EMPTY_DART_RECORD.accounts },
    quarterlyHistory: [],
    rawRows: [],
    serverMetrics: {},
    rawAccountMetrics: {},
  };
}


export default function Home() {
  // 무로그인 API 입력 게이트 상태
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("DART_API_KEY_V6") || "";
    }
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(true);


  useEffect(() => {
    if (!apiKey || isApiGateOpen) return;
    let cancelled = false;
    (async () => {
      setIsRefreshingApi(true);
      setApiStatusMessage("인증키 유효성을 실제 DART API로 검증하고 기본 기업 공시를 조회하는 중입니다…");
      const validation = await validateDartApiKey(apiKey);
      if (cancelled) return;
      if (!validation.valid) {
        // 키가 실제로 거부된 경우에만 저장된 키를 지웁니다. 서버 미연결·일시 오류에서는 키를 보존하고 사유를 화면에 표시합니다.
        if (validation.reason === "invalid" || validation.reason === "format") {
          localStorage.removeItem("DART_API_KEY_V6");
          setApiInputDraft("");
        }
        setApiKey("");
        setIsApiGateOpen(true);
        setIsRefreshingApi(false);
        setApiStatusMessage(validation.message);
        return;
      }
      const loaded: CompanyFinancialRecord[] = [];
      const failures: string[] = [];
      const savedListRaw = localStorage.getItem("DART_REGISTERED_COMPANIES_V1");
      let savedNames: string[] = [];
      try {
        const parsed = savedListRaw === null ? [] : JSON.parse(savedListRaw);
        if (Array.isArray(parsed)) savedNames = parsed.filter((x) => typeof x === "string");
      } catch { savedNames = []; }
      // 기존 버전에서 자동 등록된 예시 종목은 제거합니다. 저장 목록이 존재하면 사용자가 삭제한 종목을 다시 추가하지 않습니다.
      if (localStorage.getItem("DART_SEED_CLEANUP_V2") !== "done") {
        const removedSeedNames = new Set(["가온전선", "삼성전자", "LS", "LS전선"]);
        savedNames = savedNames.filter((name) => !removedSeedNames.has(name.trim()));
        localStorage.setItem("DART_SEED_CLEANUP_V2", "done");
      }
      const initialNames = [...new Set(savedListRaw === null ? [...INITIAL_DART_COMPANIES] : savedNames)];
      // 상장 여부와 무관하게 DART 등록 기업을 조회합니다. 비상장사는 stockCode가 없어도 corpCode로 DART 재무를 조회할 수 있습니다.
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, initialNames.length) }, async () => {
        while (cursor < initialNames.length) {
          const name = initialNames[cursor++];
          if (cancelled) return;
          const result = await fetchLiveDartCompanyRecord(name, apiKey);
          if (result.record) {
            loaded.push(result.record);
            continue;
          }
          const matches = await searchLiveDartCompanies(name, apiKey, 20).catch(() => []);
          const normalized = (value: string) => value.replace(/[\s㈜()주식회사]/g, "").toLowerCase();
          const registered = matches.find((item) => normalized(item.name) === normalized(name)) ?? matches.find((item) => normalized(item.name).includes(normalized(name)) || normalized(name).includes(normalized(item.name)));
          if (registered) loaded.push(makeDartRegisteredPlaceholder(registered));
          else failures.push(`${name}: ${result.errorMsg ?? "DART 기업코드 미확인"}`);
        }
      }));
      if (cancelled) return;
      setCompanies(loaded);
      localStorage.setItem("DART_REGISTERED_COMPANIES_V1", JSON.stringify(loaded.map((company) => company.corpName)));
      if (loaded.length) {
        setSelectedCorpName(loaded[0].corpName);
        setSelectedBasis(loaded[0].basisCode === "OFS" ? "OFS" : "CFS");
        setAskCorpName(loaded[0].corpName);
        setAskQuery(`${loaded[0].corpName} 영업이익률`);
        setCompareCorpNames(loaded.map((c) => c.corpName).slice(0, 10));
      }
      setIsRefreshingApi(false);
      setApiStatusMessage(loaded.length
        ? `실시간 DART 조회 완료: ${loaded.length}/${initialNames.length}개 등록 기업(상장·비상장 포함). ${failures.length ? `미조회: ${failures.join(" / ")}` : "실제 공시 조회를 완료했습니다."}`
        : initialNames.length
          ? `등록된 DART 기업의 공시 조회에 실패했습니다. 임의 수치를 표시하지 않았습니다. ${failures.join(" / ")}`
          : "등록된 종목이 없습니다. 종목 현황에서 ‘기업 검색’를 눌러 등록하세요.");
    })().catch((err) => {
      if (!cancelled) {
        setIsRefreshingApi(false);
        setApiStatusMessage(userFacingDartError(err, "DART 실시간 조회에 실패했습니다."));
      }
    });
    return () => { cancelled = true; };
  }, [apiKey, isApiGateOpen]);

  // 메뉴 탭: 종목 현황·질문하기·비교분석·요약 보고서·공시 알림 및 최신 현황
  const [activeTab, setActiveTab] = useState<
    "DASHBOARD" | "ASK" | "COMPARE" | "ONE_PAGER" | "ALERTS"
  >("DASHBOARD");

  const [companySearchSuggestions, setCompanySearchSuggestions] = useState<Array<{name:string;code:string;stock:string}>>([]);
  const [compareCompanySuggestions, setCompareCompanySuggestions] = useState<Array<{name:string;code:string;stock:string}>>([]);
  const [filingAlerts, setFilingAlerts] = useState<Array<{company:string;reportName:string;receiptDate:string;rceptNo:string;url:string}>>(() => {
    try { const rows=JSON.parse(localStorage.getItem("DART_ALERT_INBOX_V2")||"[]"); return Array.isArray(rows)?rows.filter(row=>row && /^\d{14}$/.test(row.rceptNo) && typeof row.company==="string" && typeof row.reportName==="string").map(row=>({...row,url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rceptNo}`})).slice(0,50):[]; } catch{return []}
  });
  const [readFilingAlertIds, setReadFilingAlertIds] = useState<Set<string>>(() => { try { const ids=JSON.parse(localStorage.getItem("DART_ALERT_READ_V2")||"[]"); return new Set(Array.isArray(ids)?ids.filter(id=>typeof id==="string"):[]); } catch{return new Set()} });
  useEffect(()=>{localStorage.setItem("DART_ALERT_INBOX_V2",JSON.stringify(filingAlerts));localStorage.setItem("DART_ALERT_READ_V2",JSON.stringify([...readFilingAlertIds].slice(-2000)));},[filingAlerts,readFilingAlertIds]);
  const unreadFilingAlertCount = activeTab === "ALERTS" ? 0 : filingAlerts.filter((item) => !readFilingAlertIds.has(item.rceptNo)).length;
  const markFilingAlertsRead = () => {
    setReadFilingAlertIds((previous) => new Set([...previous, ...filingAlerts.map((item) => item.rceptNo)]));
  };
  useEffect(() => {
    if (activeTab === "ALERTS" && filingAlerts.length) {
      setReadFilingAlertIds((previous) => new Set([...previous, ...filingAlerts.map((item) => item.rceptNo)]));
    }
  }, [activeTab, filingAlerts]);
  const [currentCompanyFilings, setCurrentCompanyFilings] = useState<Array<{company:string;reportName:string;receiptDate:string;rceptNo:string;url:string}>>([]);
  const [isLoadingCurrentFilings, setIsLoadingCurrentFilings] = useState<boolean>(false);
  const [currentFilingsMessage, setCurrentFilingsMessage] = useState<string>("최근 공시 현황을 불러올 준비가 되었습니다.");
  const [companyFilingsRefreshNonce, setCompanyFilingsRefreshNonce] = useState<number>(0);
  const [showFilingAlertPopup, setShowFilingAlertPopup] = useState<boolean>(false);
  const [lastAlertCheck, setLastAlertCheck] = useState<string>("");
  const [alertStatus, setAlertStatus] = useState<string>("관심기업을 추가하면 신규 공시 확인을 시작합니다.");
  const [alertCompanyNames, setAlertCompanyNames] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { const saved = JSON.parse(localStorage.getItem("DART_ALERT_WATCHLIST_V1") || "[]"); return Array.isArray(saved) ? saved.filter((x) => typeof x === "string").slice(0,20) : []; } catch { return []; }
  });
  const [alertCompanyChoice, setAlertCompanyChoice] = useState<string>("");
  const [alertViewCompanyName, setAlertViewCompanyName] = useState<string>("");
  const [alertCompanySearch, setAlertCompanySearch] = useState<string>("");
  const [alertCompanySuggestions, setAlertCompanySuggestions] = useState<Array<{name:string;code:string;stock:string}>>([]);
  const [askCompanySearch, setAskCompanySearch] = useState<string>("");
  const [askCompanySuggestions, setAskCompanySuggestions] = useState<Array<{name:string;code:string;stock:string}>>([]);

  const [companies, setCompanies] = useState<CompanyFinancialRecord[]>([]);
  const [selectedCorpName, setSelectedCorpName] = useState<string>("대한전선");
  const [selectedBasis, setSelectedBasis] = useState<"CFS" | "OFS">("CFS");
  const [isRefreshingApi, setIsRefreshingApi] = useState<boolean>(false);
  const [apiStatusMessage, setApiStatusMessage] = useState<string>("");
  const [historyStartYear,setHistoryStartYear]=useState(new Date().getFullYear()-2);
  const [historyEndYear,setHistoryEndYear]=useState(new Date().getFullYear());
  const [historyLoadAttemptedFor, setHistoryLoadAttemptedFor] = useState<string>("");
  const [historyRetryNonce, setHistoryRetryNonce] = useState<number>(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [historyLoadMessage, setHistoryLoadMessage] = useState<string>("");

  const snapshotGeneration = useRef(0);
  useEffect(() => {
    const company=companies.find(c=>c.corpName===selectedCorpName);
    const generation=++snapshotGeneration.current;
    if(company?.basisCode===selectedBasis){setIsRefreshingApi(false);return;}
    if (!apiKey || isApiGateOpen || !company) return;
    const controller=new AbortController();
    setIsRefreshingApi(true);
    setApiStatusMessage(`${selectedBasis==="CFS"?"연결":"별도"} 기준 공시 조회 중…`);
    void fetchLiveDartCompanyRecord(selectedCorpName,apiKey,false,selectedBasis,false,controller.signal).then(result=>{
      if (controller.signal.aborted || generation!==snapshotGeneration.current) return;
      if (result.record) { setCompanies(prev=>prev.map(c=>c.corpName===selectedCorpName?result.record!:c)); setApiStatusMessage(`✓ ${selectedCorpName}: 실제 OpenDART 재무자료를 조회했습니다. ${result.record.period}`); }
      else setApiStatusMessage(result.errorMsg || "선택한 기준의 공시를 확인하지 못했습니다.");
    }).finally(()=>{if(!controller.signal.aborted && generation===snapshotGeneration.current)setIsRefreshingApi(false);});
    return ()=>controller.abort();
  },[selectedCorpName,selectedBasis,apiKey,isApiGateOpen]);
  // 첫 화면: 커스텀 지표 (추가 및 삭제 완벽 작동)
  const [customMetricIds, setCustomMetricIds] = useState<string[]>([
    "차입금",
    "운전자본",
    "매입채무",
    "차입금의존도",
  ]);
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);
  const [expandedCalculationMetric, setExpandedCalculationMetric] = useState<string | null>(null);
  const [showAddCorpInput, setShowAddCorpInput] = useState<boolean>(false);
  const [newCorpQuery, setNewCorpQuery] = useState<string>("");

  const [showAskCompanyInput, setShowAskCompanyInput] = useState(false);

  // 질문하기 탭 상태
  const [askCorpName, setAskCorpName] = useState<string>("대한전선");
  const [askCategory, setAskCategory] = useState<string>("전체");
  const [askQuery, setAskQuery] = useState<string>("대한전선 영업이익률");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("영업이익률");
  const [askExecutedQuery, setAskExecutedQuery] = useState<string>("");
  const [liveAskStatus, setLiveAskStatus] = useState<"idle" | "loading" | "live" | "not-found" | "error">("idle");

  // 비교분석 탭 상태 (기업 검색 등록/삭제 + 지표 2~5개 다중 버튼 선택)
  const [compareCorpNames, setCompareCorpNames] = useState<string[]>(["대한전선"]);
  const [compareSearchInput, setCompareSearchInput] = useState<string>("");
  const [compareMetricIds, setCompareMetricIds] = useState<string[]>([
    "매출액",
    "영업이익",
    "순이익",
    "차입금",
    "운전자본",
  ]);
  const [compareValidationMsg, setCompareValidationMsg] = useState<string>("");
  const [compareYear, setCompareYear] = useState<number>(2025);
  const [comparePeriodChoice, setComparePeriodChoice] = useState<ComparePeriodChoice>("annual");
  const [liveCompareResults, setLiveCompareResults] = useState<Record<string, LiveCompareRow[]>>({});
  const [isRefreshingCompare, setIsRefreshingCompare] = useState<boolean>(false);
  const [liveCompareStatus, setLiveCompareStatus] = useState<string>("");

  const currentCompany = useMemo(
    () => { const company=companies.find((c) => c.corpName === selectedCorpName) || companies[0]; return company && company.basisCode!==selectedBasis ? {...EMPTY_DART_RECORD,corpName:company.corpName,corpCode:company.corpCode,stockCode:company.stockCode,basisCode:selectedBasis,period:"선택한 회계기준 조회 대기"} : company || EMPTY_DART_RECORD; },
    [companies, selectedCorpName,selectedBasis]
  );
  const alertDisplayCompany = useMemo(
    () => companies.find((c) => c.corpName === alertViewCompanyName) || currentCompany,
    [companies, alertViewCompanyName, currentCompany]
  );
  const displayedCompanyFilings=currentCompanyFilings.filter(row=>row.company===alertDisplayCompany.corpName);
  // 공시 알람의 공시 현황은 종목 현황 탭의 선택과 독립적으로 기업을 바꿔 조회할 수 있습니다.
  useEffect(() => {
    if (!apiKey || isApiGateOpen || !alertDisplayCompany.corpCode || alertDisplayCompany.corpName === "DART 조회 대기") {
      setCurrentCompanyFilings([]);
      setCurrentFilingsMessage(!apiKey ? "API 인증키를 등록하면 최근 공시 현황이 표시됩니다." : "종목 정보를 불러오는 중입니다.");
      return;
    }
    setCurrentCompanyFilings([]);
    setCurrentFilingsMessage("공시목록 조회 중…");
    let cancelled = false;
    const toDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/-/g, "");
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 6);
    const query = encodeURIComponent(JSON.stringify({ json: { companies: [alertDisplayCompany.corpName], fromDate: toDateKey(fromDate) } }));
    const stopPolling = startFilingPolling(async (signal) => {
    setIsLoadingCurrentFilings(true);
    await fetch(apiUrl(`/api/trpc/dart.recentFilings?input=${query}`), {
      headers: { "X-OpenDART-Key": apiKey },
      credentials: apiBaseUrl ? "omit" : "same-origin",
      cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        const data = payload?.result?.data?.json ?? payload?.result?.data;
        if (!response.ok || !data || !Array.isArray(data.rows)) throw new Error("조회 응답 없음");
        return data as { rows: Array<{company:string;reportName:string;receiptDate:string;rceptNo:string;url:string}>; warnings?: string[] };
      })
      .then((data) => {
        if (cancelled) return;
        const rows = data.rows.filter((row) => /^\d{14}$/.test(row.rceptNo || "") && Boolean(row.reportName) && Boolean(row.receiptDate))
          .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.rceptNo.localeCompare(a.rceptNo));
        if (!rows.length && data.warnings?.length) {
          setCurrentFilingsMessage("공시목록 갱신에 실패했습니다. 마지막 성공 결과를 표시하며 자동으로 다시 확인합니다.");
          return;
        }
        setCurrentCompanyFilings(rows.slice(0, 30));
        if (rows.length) setCurrentFilingsMessage(`최근 6개월 · 최신순 ${rows.length}건 · ${new Date().toLocaleTimeString("ko-KR", {timeZone:"Asia/Seoul"})} 확인`);
        else if (data.warnings?.length) setCurrentFilingsMessage("공시목록을 확인하지 못했습니다. API 인증키와 네트워크를 확인해 주세요.");
        else setCurrentFilingsMessage("최근 6개월간 확인된 공시가 없습니다.");
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentFilingsMessage("공시목록 갱신에 실패했습니다. 마지막 성공 결과를 표시하며 자동으로 다시 확인합니다.");
        }
      })
      .finally(() => { if (!cancelled) setIsLoadingCurrentFilings(false); });
    });
    return () => { cancelled = true; stopPolling(); };
  }, [apiKey, isApiGateOpen, alertDisplayCompany.corpName, alertDisplayCompany.corpCode, companyFilingsRefreshNonce]);

  const handleRemoveRegisteredCompany = (corpName: string) => {
    const remaining = companies.filter((company) => company.corpName !== corpName);
    setCompanies(remaining);
    localStorage.setItem("DART_REGISTERED_COMPANIES_V1", JSON.stringify(remaining.map((company) => company.corpName)));
    setCompareCorpNames((prev) => prev.filter((name) => name !== corpName));
    setAlertCompanyNames((prev) => prev.filter((name) => name !== corpName));
    setAlertViewCompanyName((prev) => prev === corpName ? (remaining[0]?.corpName ?? "") : prev);
    setSelectedCorpName((prev) => prev === corpName ? (remaining[0]?.corpName ?? "") : prev);
    setAskCorpName((prev) => prev === corpName ? (remaining[0]?.corpName ?? "") : prev);
    setAskQuery((prev) => prev.includes(corpName) ? `${remaining[0]?.corpName ?? ""} 영업이익률`.trim() : prev);
  };

  useEffect(() => {
    if (!apiKey || newCorpQuery.trim().length < 1) { setCompanySearchSuggestions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = (await searchLiveDartCompanies(newCorpQuery, apiKey, 8).catch(() => [])).filter((item) => /^\d{6}$/.test(String(item.stock ?? "")) && item.stock !== "000000");
      if (!cancelled) setCompanySearchSuggestions(rows);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [newCorpQuery, apiKey]);

  useEffect(() => {
    if (!apiKey || compareSearchInput.trim().length < 1) { setCompareCompanySuggestions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = (await searchLiveDartCompanies(compareSearchInput, apiKey, 8).catch(() => [])).filter((item) => /^\d{6}$/.test(String(item.stock ?? "")) && item.stock !== "000000");
      if (!cancelled) setCompareCompanySuggestions(rows);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [compareSearchInput, apiKey]);

  useEffect(() => {
    if (!apiKey || alertCompanySearch.trim().length < 1) { setAlertCompanySuggestions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = (await searchLiveDartCompanies(alertCompanySearch, apiKey, 10).catch(() => []))
        .filter((item) => /^\d{6}$/.test(String(item.stock ?? "")) && item.stock !== "000000");
      if (!cancelled) setAlertCompanySuggestions(rows);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [alertCompanySearch, apiKey]);

  useEffect(() => {
    if (!apiKey || askCompanySearch.trim().length < 1) { setAskCompanySuggestions([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const rows = (await searchLiveDartCompanies(askCompanySearch, apiKey, 10).catch(() => [])).filter((item) => /^\d{6}$/.test(String(item.stock ?? "")) && item.stock !== "000000");
      if (!cancelled) setAskCompanySuggestions(rows);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [askCompanySearch, apiKey]);

  useEffect(() => {
    localStorage.setItem("DART_ALERT_WATCHLIST_V1", JSON.stringify([...new Set(alertCompanyNames)]));
  }, [alertCompanyNames]);

  // 관심기업만 조회합니다. 성공/실패 상태를 화면에 기록하고, 새 접수번호가 있으면 팝업과 브라우저 알림을 표시합니다.
  useEffect(() => {
    if (!apiKey || isApiGateOpen || !alertCompanyNames.length) { setAlertStatus("관심기업을 추가하면 신규 공시 확인을 시작합니다."); return; }
    let cancelled = false;
    const todayKey = () => {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
    };
    let firstCheck = true;
    const check = async (signal: AbortSignal) => {
      const baseline = firstCheck && !Number(localStorage.getItem("DART_ALERT_LAST_CHECK_MS") || 0);
      const names = [...new Set(alertCompanyNames)];
      const now = Date.now();
      const previousCheck = Math.max(Number(localStorage.getItem("DART_ALERT_LAST_CHECK_MS") || 0), Date.now() - 89 * 86400_000);
      const fromDate = Number(localStorage.getItem("DART_ALERT_LAST_CHECK_MS") || 0) ? new Date(previousCheck - 6 * 60 * 60 * 1000) : todayKey();
      const dateText = typeof fromDate === "string" ? fromDate : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(fromDate).replace(/-/g, "");
      try {
        const input = encodeURIComponent(JSON.stringify({ json: { companies: names, fromDate: dateText } }));
        const response = await fetch(apiUrl(`/api/trpc/dart.recentFilings?input=${input}`), { headers: { "X-OpenDART-Key": apiKey }, credentials: apiBaseUrl ? "omit" : "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]) });
        const payload = await response.json().catch(() => ({}));
        const data = payload?.result?.data?.json ?? payload?.result?.data;
        const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : null;
        if (!response.ok || !rows) {
          const detail = payload?.error?.json?.message ?? payload?.error?.message ?? `HTTP ${response.status}`;
          if (!cancelled) setAlertStatus(`공시 조회 실패: ${detail}`);
          return;
        }
        if (cancelled) return;
        let seenValues: string[] = [];
        try { const saved = JSON.parse(localStorage.getItem("DART_ALERT_SEEN_RCEPTS_V1") || "[]"); if(Array.isArray(saved)) seenValues=saved.filter((v):v is string=>typeof v==="string"); } catch {}
        const seen = new Set<string>(seenValues);
        const newRows = rows.filter((row: any) => row && typeof row.rceptNo === "string" && !seen.has(row.rceptNo));
        rows.forEach((row: any) => { if (row?.rceptNo) seen.add(row.rceptNo); });
        localStorage.setItem("DART_ALERT_SEEN_RCEPTS_V1", JSON.stringify([...seen].slice(-2000)));
        if (!data?.warnings?.length) localStorage.setItem("DART_ALERT_LAST_CHECK_MS", String(now));
        firstCheck = false;
        setLastAlertCheck(new Date(now).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
        const warningText = Array.isArray(data?.warnings) && data.warnings.length ? ` · 일부 조회 실패 ${data.warnings.length}건: ${data.warnings.slice(0, 2).join(" / ")}` : "";
        setAlertStatus(`${new Date(now).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 조회 성공 · 관심기업 ${names.length}개 · 공시 ${rows.length}건${newRows.length ? ` · 신규 ${newRows.length}건` : " · 신규 공시 없음"}${warningText}`);
        if (newRows.length) setCompanyFilingsRefreshNonce((n) => n + 1);
        if (!baseline && newRows.length) {
          setFilingAlerts((prev) => [...newRows, ...prev].filter((row, index, all) => all.findIndex((candidate) => candidate.rceptNo === row.rceptNo) === index).slice(0, 50));
          setShowFilingAlertPopup(true);
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("DART 신규 공시", { body: newRows.slice(0, 3).map((r: any) => `${r.company}: ${r.reportName}`).join("\n") });
          }
        }
      } catch (error) {
        if (!cancelled) setAlertStatus(userFacingDartError(error, "공시 조회 중 오류가 발생했습니다."));
      }
    };
    const stopPolling = startFilingPolling(check);
    return () => { cancelled = true; stopPolling(); };
  }, [apiKey, isApiGateOpen, alertCompanyNames.join("|")]);

  // 요약 보고서의 숫자는 서버가 실제 DART 원천 계정으로 계산한 값만 사용합니다.
  // 로컬 편의용 계정 파싱값으로 서버 계산 결과를 덮어쓰지 않습니다.
  const officialMetricValue = (metricKey: string): number => {
    const value = currentCompany.serverMetrics?.[metricKey]?.value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if(Object.prototype.hasOwnProperty.call(currentCompany.serverMetrics ?? {},metricKey))return Number.NaN;
    // 서버 지표가 없는 구버전 응답에만 같은 공시 값을 사용합니다.
    // 서버 지표 매칭 별칭이 누락된 경우에도 실제 원문 금액을 표시하며, 임의 수치를 만들지 않습니다.
    const rawAccountKey: Record<string, keyof CompanyFinancialRecord["accounts"]> = {
      revenue: "매출액",
      operatingProfit: "영업이익",
      netIncome: "순이익",
    };
    const accountKey = rawAccountKey[metricKey];
    if (accountKey) {
      const accountValue = currentCompany.accounts[accountKey];
      if (typeof accountValue === "number" && Number.isFinite(accountValue)) return accountValue;
    }
    return Number.NaN;
  };
  // 같은 화면의 비율은 서버에서 별도 산출한 퍼센트와 섞지 않습니다.
  // 매출액·이익은 동일한 최신 공시 스냅샷에서 가져오고, 헤드라인·카드·해설이 같은 계산식을 사용합니다.
  const metricSourceTag = (metricKey: string): string => {
    const citation = currentCompany.serverMetrics?.[metricKey]?.citation ?? currentCompany.rawAccountMetrics?.[metricKey]?.citation ?? "";
    if (/FnGuide/i.test(citation)) return "FNGUIDE";
    if (/네이버 금융/.test(citation)) return "NAVER_FINANCE";
    return currentCompany.isLiveApiFetched ? `DART:${currentCompany.rceptNo}:${currentCompany.basisCode ?? "CFS"}` : "UNKNOWN";
  };
  const officialMetricValueForDisplay = (metricKey: string): number => {
    const directValue = currentCompany.serverMetrics?.[metricKey]?.value;
    if (typeof directValue === "number" && Number.isFinite(directValue)) return directValue;
    if(Object.prototype.hasOwnProperty.call(currentCompany.serverMetrics ?? {},metricKey))return Number.NaN;
    if (metricKey === "operatingMargin" || metricKey === "netMargin") {
      const revenue = officialMetricValue("revenue");
      const profitKey = metricKey === "operatingMargin" ? "operatingProfit" : "netIncome";
      const profit = officialMetricValue(profitKey);
      // DART 값과 외부 보조값을 섞어 만든 비율은 표시하지 않습니다.
      if (metricSourceTag("revenue") !== metricSourceTag(profitKey)) return Number.NaN;
      return Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(profit) ? (profit / revenue) * 100 : Number.NaN;
    }
    return officialMetricValue(metricKey);
  };
  const officialMetricText = (metricKey: string, unit: "%" | "억원" = "억원") =>
    formatMetricValue(officialMetricValueForDisplay(metricKey), unit);

  // serverMetrics에 별도 계산 지표가 없는 원천 계정은, 동일한 실시간 DART 응답(rawRows)에서 직접 읽습니다.
  // local snapshot이나 이전 회사 값을 사용하지 않고, 계정 행이 실제로 있을 때만 숫자를 표시합니다.
  const rawAccountValue = (metricId: string): number => {
    // Only server-normalized values are used; a second UI parser cannot invent a fallback.
    const serverRawValue = currentCompany.rawAccountMetrics?.[metricId]?.value;
    if (typeof serverRawValue === "number" && Number.isFinite(serverRawValue)) return serverRawValue;
    const accountValue=currentCompany.accounts[metricId as keyof RawDartAccountMap];
    return typeof accountValue==="number" && Number.isFinite(accountValue)?accountValue:Number.NaN;
  };

  const summaryAssessments = (() => {
    const items: Array<{ title: string; text: string; basis: string }> = [];
    const revenue = officialMetricValue("revenue");
    const operatingProfit = officialMetricValue("operatingProfit");
    const netIncome = officialMetricValue("netIncome");
    const opMargin = officialMetricValueForDisplay("operatingMargin");
    const netMargin = officialMetricValueForDisplay("netMargin");
    if (Number.isFinite(revenue) && Number.isFinite(operatingProfit) && Number.isFinite(opMargin)) {
      let text = `영업이익률은 ${opMargin.toFixed(2)}%입니다. 매출 100원당 영업이익 약 ${opMargin.toFixed(2)}원에 해당합니다.`;
      if (operatingProfit > 0) text += " 본업 기준으로 영업이익은 흑자입니다.";
      else if (operatingProfit < 0) text += " 본업 기준으로 영업손실이 발생했습니다.";
      if (Number.isFinite(netIncome) && operatingProfit > 0 && netIncome < 0) {
        text += " 다만 영업이익과 달리 순손실이므로 영업외손익·금융원가·법인세 항목을 추가 확인할 필요가 있습니다. 이 수치만으로 순손실 원인을 단정하지 않습니다.";
      } else if (Number.isFinite(netMargin)) {
        text += ` 순이익률은 ${netMargin.toFixed(2)}%입니다.`;
      }
      items.push({ title: "수익성 평가", text, basis: `근거: 매출액 ${formatMetricValue(revenue, "억원")}, 영업이익 ${formatMetricValue(operatingProfit, "억원")}, 순이익 ${formatMetricValue(netIncome, "억원")}` });
    }

    const history = (currentCompany.quarterlyHistory ?? []).filter((point) => Number.isFinite(point.revenue) && Number.isFinite(point.operatingProfit));
    const quarterId = (period: string) => period.match(/^([1-4])Q(\d{2})$/i);
    const latest = history.length ? history[history.length - 1] : null;
    const latestMatch = latest ? quarterId(latest.period) : null;
    if (latest && latestMatch) {
      const latestYear = Number(`20${latestMatch[2]}`);
      const priorPeriod = `${latestMatch[1]}Q${String(latestYear - 1).slice(-2)}`;
      const prior = history.find((point) => point.period === priorPeriod);
      if (prior) {
        const changeText = (label: string, now: number, before: number) => {
          const delta = now - before;
          if (before !== 0) {
            const pct = delta / Math.abs(before) * 100;
            return `${label} ${pct > 0 ? "증가" : pct < 0 ? "감소" : "보합"} ${Math.abs(pct).toFixed(1)}% (${delta > 0 ? "+" : ""}${formatMetricValue(delta, "억원")})`;
          }
          return `${label} ${delta > 0 ? "+" : ""}${formatMetricValue(delta, "억원")} 변동(비교 기준값 0)`;
        };
        const currentMargin = latest.revenue !== 0 ? latest.operatingProfit / latest.revenue * 100 : Number.NaN;
        const previousMargin = prior.revenue !== 0 ? prior.operatingProfit / prior.revenue * 100 : Number.NaN;
        const marginChange = Number.isFinite(currentMargin) && Number.isFinite(previousMargin) ? currentMargin - previousMargin : Number.NaN;
        let interpretation = "동일 분기 비교 자료를 확보했습니다.";
        if (latest.revenue > prior.revenue && latest.operatingProfit > prior.operatingProfit && marginChange > 0) interpretation = "매출과 영업이익이 함께 증가하고 영업이익률도 상승해, 비교 분기 기준 성장과 수익성 개선이 동시에 관찰됩니다.";
        else if (latest.revenue > prior.revenue && marginChange < 0) interpretation = "매출은 증가했지만 영업이익률은 하락했습니다. 외형 성장과 이익 효율이 같은 방향으로 움직이지 않아 원가·판관비 항목을 확인할 필요가 있습니다.";
        else if (latest.revenue < prior.revenue && latest.operatingProfit < prior.operatingProfit) interpretation = "매출과 영업이익이 함께 감소했습니다. 다만 감소 원인은 수치만으로 입증되지 않으므로 사업보고서의 사업내용·매출원가·판관비 설명을 함께 확인해야 합니다.";
        items.push({ title: "동일 분기 전년 비교", text: `${latest.period}와 ${prior.period} 비교: ${changeText("매출", latest.revenue, prior.revenue)}; ${changeText("영업이익", latest.operatingProfit, prior.operatingProfit)}.${Number.isFinite(marginChange) ? ` 영업이익률 ${previousMargin.toFixed(2)}% → ${currentMargin.toFixed(2)}% (${marginChange > 0 ? "+" : ""}${marginChange.toFixed(2)}%p). ` : " "}${interpretation}`, basis: `근거: 선택 기업의 실제 ${latest.basisCode === "OFS" ? "별도(OFS)" : "연결(CFS)"} 분기 공시. ${latest.isFourthQuarterDerived ? "최신 4분기 값은 연간 누계−3분기 누계 차감값입니다." : "동일 분기 기준으로 비교했습니다."}` });
      }
    }

    const borrowingsRatio = officialMetricValue("borrowingsRatio");
    const debtRatio = officialMetricValue("debtRatio");
    const currentRatio = officialMetricValue("currentRatio");
    const interestCoverage = officialMetricValue("interestCoverage");
    const workingCapital = officialMetricValue("workingCapital");
    if ([borrowingsRatio, debtRatio, currentRatio, interestCoverage].some(Number.isFinite)) {
      const parts: string[] = [];
      if (Number.isFinite(borrowingsRatio)) {
        const debt = officialMetricValue("borrowings");
        const assets = rawAccountValue("자산총계");
        parts.push(`차입금의존도는 ${borrowingsRatio.toFixed(2)}%입니다. 즉 공시 산식에서 확인한 이자부 차입금이 자산총계의 ${borrowingsRatio.toFixed(2)}%를 차지합니다.`);
        if (Number.isFinite(debt) && Number.isFinite(assets) && assets > 0) parts.push(`분자 ${formatMetricValue(debt, "억원")} ÷ 분모 자산총계 ${formatMetricValue(assets, "억원")} × 100 = ${borrowingsRatio.toFixed(2)}%로 확인됩니다.`);
        parts.push("차입금의존도는 자금조달 구조를 보여주는 비율이며, 단기 상환능력이나 이자 부담을 단독으로 판정하는 지표는 아닙니다.");
      }
      if (Number.isFinite(debtRatio)) {
        parts.push(`부채비율 ${debtRatio.toFixed(2)}%는 부채총계가 자본총계의 ${(debtRatio / 100).toFixed(2)}배라는 뜻입니다.`);
        if (debtRatio > 100) parts.push("부채가 자본보다 큰 구조이므로 이자 부담·만기 구조·현금흐름을 함께 점검할 필요가 있습니다. 이 비율 하나만으로 지급불능을 의미하지는 않습니다.");
        else parts.push("부채총계가 자본총계보다 작습니다. 다만 상환능력은 만기별 부채와 현금흐름을 함께 봐야 합니다.");
      }
      if (Number.isFinite(currentRatio)) {
        parts.push(`유동비율은 ${currentRatio.toFixed(2)}%입니다.`);
        if (currentRatio < 100) parts.push("유동자산이 유동부채보다 적은 상태이므로 단기 유동성 점검이 필요합니다.");
        else parts.push("유동자산이 유동부채 이상입니다. 다만 재고자산의 현금화 속도와 매출채권 회수 가능성은 별도로 확인해야 합니다.");
      }
      if (Number.isFinite(interestCoverage)) {
        parts.push(`이자보상배율은 ${interestCoverage.toFixed(2)}배입니다.`);
        if (interestCoverage < 1) parts.push("현재 산출된 영업이익이 이자비용에 미치지 못합니다. 이자비용 범위와 일회성 손익도 원문에서 확인해야 합니다.");
        else parts.push("산출 기준상 영업이익이 이자비용을 충당합니다. 원금 상환능력과 동일한 의미는 아닙니다.");
      }
      items.push({ title: "재무안정성 평가", text: parts.join(" "), basis: `근거: ${currentCompany.serverMetrics?.borrowingsRatio?.lines?.join(" · ") || "차입금의존도 계산근거 미확인"}${currentCompany.serverMetrics?.debtRatio?.lines?.length ? ` · ${currentCompany.serverMetrics.debtRatio.lines.join(" · ")}` : ""}${currentCompany.serverMetrics?.currentRatio?.lines?.length ? ` · ${currentCompany.serverMetrics.currentRatio.lines.join(" · ")}` : ""}${currentCompany.serverMetrics?.interestCoverage?.lines?.length ? ` · ${currentCompany.serverMetrics.interestCoverage.lines.join(" · ")}` : ""}` });
    }
    const operatingCash = officialMetricValue("operatingCashFlow");
    if (Number.isFinite(workingCapital) || Number.isFinite(operatingCash)) {
      let text = Number.isFinite(workingCapital)
        ? `프로젝트 산식상 영업운전자본(매출채권 + 재고자산 − 매입채무)은 ${formatMetricValue(workingCapital, "억원")}입니다. 이 금액이 크다는 사실만으로 양호·불량을 판정할 수는 없으며, 매출채권 회수와 재고 회전 속도를 함께 봐야 합니다.`
        : "영업운전자본 구성 계정이 충분히 확인되지 않았습니다.";
      if (Number.isFinite(operatingCash)) {
        text += ` 영업활동현금흐름은 ${formatMetricValue(operatingCash, "억원")}입니다.`;
        if (Number.isFinite(operatingProfit) && operatingProfit > 0 && operatingCash < 0) text += " 영업이익은 흑자지만 영업현금흐름은 음수입니다. 이익과 현금 유입의 차이를 매출채권·재고자산·매입채무 변동에서 확인할 필요가 있습니다. 이는 점검 신호이지 원인 확정은 아닙니다.";
      }
      items.push({ title: "운전자본·현금흐름 평가", text, basis: `근거: ${currentCompany.serverMetrics?.workingCapital?.lines?.join(" · ") || "운전자본 원천 계정 미확인"}${currentCompany.serverMetrics?.operatingCashFlow?.lines?.length ? ` · ${currentCompany.serverMetrics.operatingCashFlow.lines.join(" · ")}` : ""}` });
    }
    // 수치 종합 판단은 확보한 실제 지표에서만 위험 신호와 긍정 신호를 분리해 작성합니다.
    // 업종 평균이나 공시에 없는 원인을 추정하지 않고, 근거 수치와 함께 평가 한계를 명시합니다.
    const strengths: string[] = [];
    const watchouts: string[] = [];
    const contextNotes: string[] = [];
    if (Number.isFinite(revenue) && Number.isFinite(operatingProfit)) {
      if (operatingProfit > 0) strengths.push("해당 공시 기간에는 영업이익 흑자를 기록했습니다.");
      else if (operatingProfit < 0) watchouts.push("영업손실이 발생해 본업의 수익성 회복 여부를 확인해야 합니다.");
      if (Number.isFinite(opMargin) && opMargin > 0) strengths.push(`영업이익률 ${opMargin.toFixed(2)}%는 매출 100원당 약 ${opMargin.toFixed(2)}원의 영업이익을 의미합니다. 이 비율의 개선 여부는 동일 기간의 과거 실적과 비교해야 합니다.`);
      else if (Number.isFinite(opMargin) && opMargin < 0) watchouts.push(`영업이익률 ${opMargin.toFixed(2)}%로 매출을 올려도 본업에서 손실이 발생한 상태입니다. 매출원가와 판관비의 변동을 확인해야 하며, 수치만으로 원인을 확정하지 않습니다.`);
    }
    if (Number.isFinite(netIncome) && netIncome < 0 && operatingProfit > 0) watchouts.push("영업 흑자와 순손실이 동시에 나타납니다. 금융원가·기타영업외손익·법인세 등 손익계산서의 차이 항목을 확인해야 하며, 현재 수치만으로 원인을 확정할 수 없습니다.");
    if (Number.isFinite(debtRatio) && debtRatio > 100) watchouts.push(`부채비율 ${debtRatio.toFixed(2)}%로 부채총계가 자본총계를 초과합니다. 상환 만기와 이자 부담을 함께 검토할 필요가 있습니다.`);
    if (Number.isFinite(currentRatio) && currentRatio < 100) watchouts.push(`유동비율 ${currentRatio.toFixed(2)}%로 유동자산이 유동부채보다 적습니다. 단기 유동성 위험을 점검해야 합니다.`);
    else if (Number.isFinite(currentRatio)) strengths.push(`유동비율 ${currentRatio.toFixed(2)}%로 기말 유동자산이 유동부채보다 큽니다. 다만 재고·매출채권의 현금화 가능성까지 의미하는 것은 아닙니다.`);
    if (Number.isFinite(interestCoverage) && interestCoverage < 1) watchouts.push(`이자보상배율 ${interestCoverage.toFixed(2)}배로 산식상 영업이익이 이자비용을 충분히 덮지 못합니다. 이자비용 계정 범위와 일회성 항목을 원문에서 확인해야 합니다.`);
    else if (Number.isFinite(interestCoverage)) strengths.push(`이자보상배율 ${interestCoverage.toFixed(2)}배로 계산상 영업이익이 이자비용을 충당합니다. 원금 상환 능력과는 구분해 봐야 합니다.`);
    if (Number.isFinite(operatingCash) && operatingCash < 0) watchouts.push(`영업활동현금흐름 ${formatMetricValue(operatingCash, "억원")}은 음수입니다. 영업손익과 현금흐름이 다르게 움직이는 이유를 매출채권·재고·매입채무 변동에서 점검해야 합니다.`);
    else if (Number.isFinite(operatingCash)) strengths.push(`영업활동현금흐름 ${formatMetricValue(operatingCash, "억원")}은 양수로, 해당 기간 영업활동에서 현금 순유입이 발생했습니다. 일회성 운전자본 변동 여부는 추가 확인 대상입니다.`);
    if (Number.isFinite(borrowingsRatio)) contextNotes.push(`차입금의존도 ${borrowingsRatio.toFixed(2)}%는 검산된 총차입금 ÷ 자산총계 비율입니다. 비율 자체를 긍정/부정으로 분류하지 않고, 과거 동일 기준의 변화와 만기·이자 구조를 함께 판단해야 합니다.`);
    else if (typeof currentCompany.serverMetrics?.borrowingsRatio?.value === "number" && Number.isFinite(currentCompany.serverMetrics.borrowingsRatio.value)) watchouts.push("차입금의존도는 서버 산출값과 같은 공시의 총차입금·자산총계로 검산한 값이 일치하지 않거나 분자·분모 계정이 확보되지 않아 표시를 보류했습니다. 계정 범위와 회계기준을 확인해야 합니다.");
    if (strengths.length || watchouts.length || contextNotes.length) {
      const verdict = [
        strengths.length ? `확인된 신호: ${strengths.join(" ")}` : "확인된 긍정 신호는 현재 확보한 지표만으로 충분히 판단하기 어렵습니다.",
        watchouts.length ? `우선 점검 사항: ${watchouts.join(" ")}` : "현재 확보한 지표에서 위 기준에 해당하는 뚜렷한 경고 신호는 확인되지 않았습니다. 이는 재무 위험이 없다는 보증은 아닙니다.",
        contextNotes.length ? `추가 관찰: ${contextNotes.join(" ")}` : "",
        "본 평가는 해당 공시의 회계 수치에 기반한 1차 점검이며, 산업 특성·현금 만기·주석·경영진 설명을 반영한 투자 판단이나 신용등급을 대신하지 않습니다.",
      ].join(" ");
      items.unshift({ title: "종합 평가 · 긍정 신호와 점검 리스크", text: verdict, basis: `근거 공시: ${currentCompany.reportName || currentCompany.period || "DART 정기보고서"} · 접수번호 ${currentCompany.rceptNo || "미확인"} · ${currentCompany.basisCode === "OFS" ? "별도 기준" : "연결 기준"}` });
    }
    if (!items.length) items.push({ title: "평가 보류", text: "평가에 필요한 실제 DART 원천 계정을 충분히 확보하지 못했습니다. 확인되지 않은 숫자로 재무 상태를 판단하지 않습니다.", basis: `기준 공시 접수번호: ${currentCompany.rceptNo || "미확인"}` });
    return items;
  })();

  useEffect(() => {
    if (activeTab !== "COMPARE") return;
    setLiveCompareResults({});
    if (compareCorpNames.length < 2 || !apiKey || !compareMetricIds.length) {
      setIsRefreshingCompare(false);
      setLiveCompareStatus("DART 인증키와 비교 기업 2개 이상·지표를 선택하세요.");
      return;
    }
    setIsRefreshingCompare(true);
    const choice = comparePeriodChoice === "latest" ? {period:"latest" as const} : {year:compareYear,period:comparePeriodChoice};
    // Each cell may finish independently: one slow company or metric must not hide completed values.
    const tasks=compareMetricIds.flatMap(metricId=>compareCorpNames.map(company=>({metricId,company})));
    const save=(task:typeof tasks[number],row:LiveCompareRow)=>setLiveCompareResults(prev=>({
      ...prev,[task.metricId]:[...(prev[task.metricId] ?? []).filter(existing=>existing.company!==task.company),row],
    }));
    const request=startComparisonLoad({
      tasks,concurrency:4,timeoutMs:45_000,
      load:async(task,signal):Promise<LiveCompareRow>=>{
        const metric=COMPARISON_METRIC_BY_UI_LABEL[task.metricId];
        if(!metric)throw new Error("이 지표의 실시간 비교 엔드포인트 매핑이 없습니다.");
        const input=encodeURIComponent(JSON.stringify({json:{companies:[task.company],metric,basis:selectedBasis,...choice,includeValidation:false}}));
        const response=await fetch(apiUrl(`/api/trpc/dart.compare?input=${input}`),{
          signal,cache:"no-store",headers:{"X-OpenDART-Key":apiKey},
          credentials:apiUrl("/")==="/" ? "same-origin" : "omit",
        });
        const payload=await response.json().catch(()=>({}));
        const data=payload?.result?.data?.json ?? payload?.result?.data;
        if(!response.ok || !Array.isArray(data?.rows))throw new Error(payload?.error?.json?.message ?? payload?.error?.message ?? `${task.metricId} 비교 조회 실패`);
        const row=data.rows.find((item:LiveCompareRow)=>item.company===task.company) ?? data.rows[0];
        if(!row)throw new Error("기업별 조회 결과가 비어 있습니다.");
        return {...row,company:task.company};
      },
      onResult:save,
      onError:(task,error)=>save(task,{company:task.company,found:false,value:null,unit:"",period:"",basis:"",message:error instanceof Error ? error.message : "조회 실패"}),
      onProgress:({completed,total})=>setLiveCompareStatus(`선택한 기간의 공시 조회 중… ${completed}/${total}개 완료`),
      onComplete:({completed,failed})=>{
        setIsRefreshingCompare(false);
        setLiveCompareStatus(`${completed}개 기업·지표 조회 완료${failed ? ` · ${failed}개 요청 실패(각 셀의 사유 확인)` : ""}. DART 조회값을 우선 표시하며 외부 사이트 교차검증 대기는 생략합니다.`);
      },
    });
    return ()=>request.cancel();
  }, [activeTab, apiKey, compareCorpNames, compareMetricIds, comparePeriodChoice, compareYear, selectedBasis]);

  useEffect(() => {
    const attemptKey = `${currentCompany.corpName}:${selectedBasis}:${historyStartYear}:${historyEndYear}:${apiKey.slice(-6)}`;
    if (activeTab !== "ONE_PAGER" || !apiKey || !currentCompany.isLiveApiFetched || historyLoadAttemptedFor === attemptKey) return;
    let cancelled = false,completed=false;
    setCompanies(prev=>prev.map(c=>c.corpName===currentCompany.corpName && c.basisCode===selectedBasis?{...c,quarterlyHistory:[]}:c));
    setHistoryLoadAttemptedFor(attemptKey);
    setIsLoadingHistory(true);
    setHistoryLoadMessage(`${currentCompany.corpName}의 선택한 기간의 실제 분기 공시를 조회하고 있습니다…`);
    setApiStatusMessage(`${currentCompany.corpName}의 실제 분기 공시를 별도 조회합니다. 기본 재무 지표는 먼저 표시합니다…`);
    const historyController=new AbortController();

    (async () => {
      // 현재 회사의 최신 스냅샷은 첫 화면/API 인증 단계에서 이미 표시됩니다.
      // 보고서 진입 시 같은 스냅샷을 다시 조회하면 분기 시계열 요청이 시작조차 늦어질 수 있어,
      // 여기서는 분기 자료 전용 API를 바로 호출합니다.
      const history = await fetchLiveDartCompanyHistory(currentCompany.corpName, apiKey,selectedBasis,historyStartYear,historyEndYear,historyController.signal,(completed,total,points)=>{
        if(cancelled)return;
        setHistoryLoadMessage(`분기 공시 ${completed}/${total}개 연도 확인 · 실제 분기 ${points.length}개 수집 중…`);
        setCompanies(prev=>prev.map(c=>c.corpName===currentCompany.corpName && c.basisCode===selectedBasis?{...c,quarterlyHistory:points}:c));
      });
      if (cancelled) return;
      if (history.quarterlyHistory.length) {
        setCompanies((prev) => prev.map((c) => c.corpName === currentCompany.corpName ? {
          ...c,
          quarterlyHistory: history.quarterlyHistory,
        } : c));
        const latestPeriod = history.quarterlyHistory[history.quarterlyHistory.length - 1]?.period;
        const message = `실제 DART 분기 ${history.quarterlyHistory.length}개를 수집했습니다. 최신 확인 기간: ${latestPeriod ?? "미확인"}. 기준: ${history.basisCode === "OFS" ? "별도(OFS)" : "연결(CFS)"}.`;
        setHistoryLoadMessage(history.errorMsg ? `${message} 일부 기간 확인 필요: ${history.errorMsg}` : message);
        setApiStatusMessage(`${currentCompany.corpName}: ${message}`);
      } else {
        const rawMessage = history.errorMsg ?? `${currentCompany.corpName}: 확인 가능한 실제 분기 자료가 없습니다.`;
        const cleanedMessage = rawMessage
          .replace(/CFS\s*\(연결\)\s*공시가 없으면\s*OFS\s*\(별도\)를\s*확인합니다\.?/gi, "")
          .replace(/조회 실패와 실제 미공시를 구분(?:하며|합니다)[,，。]?/g, "")
          .replace(/실제 수치가 확보되지 않은 구간은 만들어 채우지 않습니다\.?/g, "")
          .replace(/확인되지 않은 분기 수치는 임의로 생성하지 않았습니다\.?/g, "")
          .trim();
        const message = /failed to fetch|networkerror|fetch failed|load failed/i.test(rawMessage)
          ? "DART 분기자료 연결에 실패했습니다. 서버 실행 상태와 OpenDART 인증키를 확인한 뒤 다시 시도하세요."
          : cleanedMessage || "조회 가능한 분기 공시 자료가 없습니다. 서버 연결과 OpenDART 인증 상태를 확인한 뒤 다시 시도하세요.";
        setHistoryLoadMessage(message);
        setApiStatusMessage(message);
      }
    })().catch((error) => {
      if (!cancelled) {
        const rawMessage = error instanceof Error ? error.message : "실제 DART 분기 데이터 조회에 실패했습니다.";
        const message = /failed to fetch|networkerror|fetch failed|load failed/i.test(rawMessage)
          ? "DART 분기자료 연결에 실패했습니다. 서버 실행 상태와 OpenDART 인증키를 확인한 뒤 다시 시도하세요."
          : rawMessage
              .replace(/CFS\s*\(연결\)\s*공시가 없으면\s*OFS\s*\(별도\)를\s*확인합니다\.?/gi, "")
              .replace(/조회 실패와 실제 미공시를 구분(?:하며|합니다)[,，。]?/g, "")
              .replace(/실제 수치가 확보되지 않은 구간은 만들어 채우지 않습니다\.?/g, "")
              .trim() || "실제 DART 분기자료 조회에 실패했습니다.";
        setHistoryLoadMessage(message);
        setApiStatusMessage(message);
      }
    }).finally(() => {
      if (!cancelled) {completed=true;setIsLoadingHistory(false);}
    });
    return () => { cancelled = true; historyController.abort();if(!completed)setHistoryLoadAttemptedFor(""); };
  // historyLoadAttemptedFor는 이 effect 안에서 설정되므로 의존성 배열에 넣으면,
  // 방금 시작한 요청이 자기 상태 업데이트 때문에 cleanup되어 영원히 로딩으로 남습니다.
  // 수동 재시도는 별도 nonce로 트리거합니다.
  }, [activeTab, currentCompany.corpName, currentCompany.corpCode,currentCompany.isLiveApiFetched, apiKey, historyRetryNonce,selectedBasis,historyStartYear,historyEndYear]);

  // 실제 OpenDART API 실시간 조회 및 기업 등록 함수 (가짜 Seed 생성기 완전 폐기)
  const handleFetchOrRegisterCompany = async (rawName: string, includeHistory = false, force = false): Promise<string | null> => {
    const generation=++snapshotGeneration.current;
    const cleanName = rawName.trim();
    if (!cleanName) return null;
    setIsRefreshingApi(true);
    setApiStatusMessage(`'${cleanName}'의 실제 OpenDART 공시 수치를 조회하고 있습니다…`);

    const { record: fetchedRecord, errorMsg } = await fetchLiveDartCompanyRecord(cleanName, apiKey, includeHistory, selectedBasis, force);
    if(generation!==snapshotGeneration.current) return null;
    let record = fetchedRecord;
    if (!record && force) { setIsRefreshingApi(false); setApiStatusMessage(userFacingDartError(errorMsg,"갱신에 실패했습니다. 기존 조회값을 유지합니다.")); return null; }
    if (!record) {
      const matches = await searchLiveDartCompanies(cleanName, apiKey, 20).catch(() => []);
      const normalized = (value: string) => value.replace(/[\s㈜()주식회사]/g, "").toLowerCase();
      const registered = matches.find((item) => normalized(item.name) === normalized(cleanName)) ?? matches.find((item) => normalized(item.name).includes(normalized(cleanName)) || normalized(cleanName).includes(normalized(item.name)));
      if (registered && /^\d{6}$/.test(String(registered.stock ?? "")) && registered.stock !== "000000") record = makeDartRegisteredPlaceholder(registered);
    }
    if(generation!==snapshotGeneration.current) return null;
    setIsRefreshingApi(false);

    if (record && (!/^\d{6}$/.test(String(record.stockCode ?? "")) || record.stockCode === "000000")) {
      setApiStatusMessage("비상장 기업은 목록에 표시하지 않도록 설정되어 있습니다. 상장 종목을 선택하세요.");
      return null;
    }
    if (!record) {
      setApiStatusMessage(userFacingDartError(errorMsg, "DART 기업목록에서 해당 기업을 찾지 못했습니다."));
      return null;
    }
    const finalRecord: CompanyFinancialRecord = record;
    if(force){setHistoryLoadAttemptedFor("");setHistoryRetryNonce(n=>n+1);}
    setCompanies((prev) => {
      const idx = prev.findIndex((c) => c.corpName.toLowerCase() === finalRecord.corpName.toLowerCase());
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = finalRecord;
        return next;
      }
      return [...prev, finalRecord];
    });
    try {
      const existing = JSON.parse(localStorage.getItem("DART_REGISTERED_COMPANIES_V1") || "[]");
      const names = Array.isArray(existing) ? existing.filter((x) => typeof x === "string") : [];
      localStorage.setItem("DART_REGISTERED_COMPANIES_V1", JSON.stringify([...new Set([...names, finalRecord.corpName])]));
    } catch { localStorage.setItem("DART_REGISTERED_COMPANIES_V1", JSON.stringify([finalRecord.corpName])); }
    setApiStatusMessage(finalRecord.isLiveApiFetched
      ? `✓ ${finalRecord.corpName}: 실제 OpenDART 재무자료를 조회했습니다. ${finalRecord.period}${finalRecord.dataNotice ? ` · ${finalRecord.dataNotice}` : ""}`
      : `${finalRecord.corpName}: DART 기업목록 등록은 완료했습니다. 재무제표가 확인되지 않아 수치는 표시하지 않습니다.`);
    return finalRecord.corpName;
  };

  // 화면용 별칭 감지는 입력 문구를 서버에 보내기 전의 보조 기능입니다.
  // 기간·비교·추이·원인 해석은 서버의 동일한 자연어 엔진이 담당합니다.
  const parseNaturalQuery = (rawQuery: string) => {
    const clean = rawQuery.trim().toLowerCase();
    const matchedCorp = [...companies]
      .sort((a, b) => b.corpName.length - a.corpName.length)
      .find((c) => clean.includes(c.corpName.toLowerCase()));
    const targetCorp = matchedCorp ? matchedCorp.corpName : askCorpName;

    const pairs: { alias: string; metricId: string }[] = [];
    METRIC_DEFINITIONS.forEach((m) => {
      m.aliases.forEach((a) => pairs.push({ alias: a.toLowerCase(), metricId: m.id }));
    });
    // 긴 표현을 우선해 '영업이익율'·'영업이익률'이 '영업이익'에 먼저 잡히지 않게 합니다.
    pairs.sort((a, b) => b.alias.length - a.alias.length);
    const matchedPair = pairs.find((p) => clean.includes(p.alias));
    return { targetCorp, targetMetricId: matchedPair?.metricId ?? null };
  };

  const handleRunAskSearch = (overrideQuery?: string) => {
    const rawQuery = (overrideQuery !== undefined ? overrideQuery : askQuery).trim();
    if (!rawQuery) return;
    const q = /연결\s*(?:기준)?|별도\s*(?:기준)?|개별\s*(?:기준)?/.test(rawQuery)
      ? rawQuery
      : `${rawQuery} ${selectedBasis === "OFS" ? "별도 기준" : "연결 기준"}`;
    const { targetCorp, targetMetricId } = parseNaturalQuery(q);
    setAskCorpName(targetCorp);
    // 알 수 없는 표현을 이전에 선택한 지표로 대체하면 전혀 다른 숫자를 보여주므로 변경하지 않습니다.
    if (targetMetricId) setAskSelectedMetricId(targetMetricId);
    setAskExecutedQuery(q);
    setLiveAskStatus("loading");
  };

  // 질문하기 탭 카테고리별 세부 검색어 필터
  const filteredCategoryMetrics = useMemo(() => {
    const excludeFromAsk = new Set<string>(["자산회전율"]);
    return METRIC_DEFINITIONS.filter((m) => {
      if (excludeFromAsk.has(m.id)) return false;
      if (askCategory === "전체") return true;
      return m.category === askCategory;
    });
  }, [askCategory]);

  const askResultCompany = useMemo(
    () => companies.find((c) => c.corpName === askCorpName) || companies[0] || EMPTY_DART_RECORD,
    [companies, askCorpName]
  );
  const askResultMetric = useMemo(
    () => METRIC_DEFINITIONS.find((m) => m.id === askSelectedMetricId) || METRIC_DEFINITIONS[0],
    [askSelectedMetricId]
  );
  const naturalQueryNeedsServer = useMemo(() => {
    const q = askExecutedQuery.trim().toLowerCase();
    if (!q) return false;
    const advancedIntent = /20\d{2}|올해|금년|작년|지난해|전년도|최근\s*\d+|지난\s*\d+|개년|연도별|기간별|비교|대비|차이|추이|트렌드|흐름|원인|이유|왜|증가|감소|늘었|줄었|상반기|하반기|반기|[123]\s*분기|사업보고서|연간|별도|개별/.test(q);
    const hasLocalMetric = METRIC_DEFINITIONS.some((metric) => metric.aliases.some((alias) => q.includes(alias.toLowerCase())));
    // 단일 지표 스냅샷에 없는 원천계정 및 미지원 표현은 이전 숫자로 대체하지 않습니다.
    return advancedIntent || !hasLocalMetric;
  }, [askExecutedQuery]);


  // Export uses the same selected companies, metric order, values and source links as the visible comparison table.
  const comparisonExportMatrix: ComparisonExportMatrix = useMemo(() => {
    const metrics = compareMetricIds.map(id => METRIC_DEFINITIONS.find(m => m.id === id)?.label ?? id);
    const cells: ComparisonExportMatrix["cells"] = {};
    const sources: ComparisonExportMatrix["sources"] = {};
    for (const name of compareCorpNames) {
      cells[name] = {};
      for (let i = 0; i < compareMetricIds.length; i++) {
        const id = compareMetricIds[i];
        const def = METRIC_DEFINITIONS.find(m => m.id === id);
        const row = (liveCompareResults[id] ?? []).find(item => item.company === name);
        const verified = Boolean(row?.found && row.value !== null && Number.isFinite(row.value));
        cells[name][metrics[i]] = {
          text: verified && def ? formatMetricValue(row!.value as number, def.unit) : "수치 미검증",
          verified,
        };
      }
      const links = compareMetricIds.flatMap(id => {
        const row = (liveCompareResults[id] ?? []).find(item => item.company === name);
        return metricSourceLinks(row?.citation, row?.rceptNo);
      });
      const distinct = [...new Map(links.map(link => [link.url, link])).values()];
      sources[name] = distinct.length ? {label: distinct.length === 1 ? distinct[0].label : "출처 보기", url: distinct[0].url} : {label:"출처 미확인",url:""};
    }
    return {companies:compareCorpNames, metrics, cells, sources};
  }, [compareCorpNames, compareMetricIds, liveCompareResults]);

  const toggleCompareMetric = (metricId: string) => {
    setCompareValidationMsg("");
    if (compareMetricIds.includes(metricId)) {
      if (compareMetricIds.length <= 2) {
        setCompareValidationMsg("비교 지표는 최소 2개 이상 선택되어야 합니다.");
        return;
      }
      setCompareMetricIds((prev) => prev.filter((id) => id !== metricId));
    } else {
      if (compareMetricIds.length >= 5) {
        setCompareValidationMsg("비교 지표는 최대 5개까지 선택할 수 있습니다.");
        return;
      }
      setCompareMetricIds((prev) => [...prev, metricId]);
    }
  };

  // ============================================================================
  // [API 입력 단계] 무로그인 첫 화면 + 클릭 없이 인증키 신청 바로 밑에 확인/복붙 가이드 큰 폰트로 표시
  // ============================================================================
  if (isApiGateOpen) {
    return (
      <div className="min-h-screen bg-[#f6f8f7] flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-lg p-8 md:p-10 space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 font-bold text-xs mb-2">
              DART
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
              OpenDART API 인증키 연결
            </h1>
            <p className="text-base text-slate-600 mt-1">
              로그인 절차 없이 OpenDART 인증키를 입력하면 즉시 공시 데이터를 조회합니다.
            </p>
          </div>

          <div className="space-y-3">
            {apiStatusMessage && !/확인하는 중/.test(apiStatusMessage) && (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 leading-relaxed">
                {apiStatusMessage}
              </div>
            )}
            <label className="block text-base font-bold text-slate-800">
              OpenDART API 인증키 (40자리)
            </label>
            <div className="flex flex-col lg:flex-row gap-2.5">
              <input
                type="text"
                value={apiInputDraft}
                onChange={(e) => setApiInputDraft(e.target.value)}
                placeholder="40자리 OpenDART API 인증키를 붙여넣으세요"
                className="flex-1 px-4 py-3.5 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
              />
              <button
                onClick={() => {
                  const trimmed = apiInputDraft.trim();
                  if (!/^[A-Za-z0-9]{40}$/.test(trimmed) || /^(DEMO|VERIFIED)/i.test(trimmed)) {
                    setApiStatusMessage("실제 OpenDART 인증키 40자리를 입력하세요. 데모 데이터는 제공하지 않습니다.");
                    return;
                  }
                  setApiStatusMessage("인증키를 DART 서버에서 확인하는 중입니다…");
                  localStorage.setItem("DART_API_KEY_V6", trimmed);
                  setApiKey(trimmed);
                  setIsApiGateOpen(false);
                }}
                className="px-6 py-3.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white font-bold text-base rounded-xl transition shrink-0"
              >
                인증키 저장 후 시작하기
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <a
                href="https://opendart.fss.or.kr/uss/umt/EgovMberInsertView.do"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-lg font-extrabold text-emerald-700 hover:text-emerald-900 underline"
              >
                👉 OpenDART 인증키 무료 신청 바로가기 <ExternalLink className="w-4 h-4" />
              </a>

            </div>
          </div>

          {/* 요청 반영: 클릭해야 나오는 방식이 아니라, 인증키 신청 바로 밑에 큰 폰트(17px)로 상시 노출 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-xl font-extrabold text-slate-900">
              인증키 확인 · 복사 · 붙여넣기 안내
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-[17px] text-slate-800 leading-relaxed font-medium">
              <li>
                위의 <strong>[OpenDART 인증키 무료 신청 바로가기]</strong>를 눌러 OpenDART 홈페이지에 접속 후 로그인합니다.
              </li>
              <li>
                상단 메뉴 <strong>[인증키 신청/관리] → [인증키 신청]</strong>에서 사용 목적을 입력하고 인증키를 발급받습니다.
              </li>
              <li>
                <strong>[인증키 신청/관리] → [오픈API 이용현황]</strong> 메뉴에서 발급된 <strong>40자리 API 인증키를 확인하고 마우스로 드래그해 복사(Ctrl + C)</strong>합니다.
              </li>
              <li>
                상단 입력칸에 <strong>붙여넣기(Ctrl + V)</strong> 한 뒤 <strong>[인증키 저장 후 시작하기]</strong>를 누르면 연결이 완료됩니다.
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] flex flex-col md:flex-row text-slate-900">
      {/* 좌측 메뉴바 (요청사항: DISCLOSURE NAVIGATOR -> DART, Daehan Group Finance workspace 및 WORKSPACE 문구 삭제, 워크스페이스 설정 -> API 변경) */}
      <aside className="w-full md:w-60 bg-[#0b241d] text-white flex flex-col justify-between p-5 shrink-0 print:hidden">
        <div className="space-y-6">
          <div className="px-2 pt-1 pb-3 border-b border-emerald-900/60">
            <div className="text-2xl font-black tracking-tight text-white">DART FINDER</div>
          </div>

          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab("DASHBOARD")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "DASHBOARD"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              종목 현황
            </button>

            <button
              onClick={() => setActiveTab("ASK")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ASK"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              질문하기
            </button>

            <button
              onClick={() => setActiveTab("COMPARE")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "COMPARE"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              비교분석
            </button>



            {/* 처음에 요청하셨던 요약 재무 분석 보고서(3단 차트 + 수치 검증) */}
            <button
              onClick={() => setActiveTab("ONE_PAGER")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ONE_PAGER"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              요약 보고서
            </button>

            <button onClick={() => setActiveTab("ALERTS")} className={`relative w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${activeTab === "ALERTS" ? "bg-emerald-600 text-white" : "text-emerald-100/80 hover:bg-emerald-900/50"}`}><BookOpen className="w-4 h-4 shrink-0" /><span className="whitespace-nowrap">공시 알림 및 최신 현황</span>{unreadFilingAlertCount > 0 && <span className="absolute right-1 top-0.5 rounded-full bg-emerald-600 px-1.5 text-[9px] leading-4">{unreadFilingAlertCount > 99 ? "99+" : unreadFilingAlertCount}</span>}</button>

          </nav>
        </div>

        <div className="pt-6 border-t border-emerald-900/60 mt-6">
          <button
            onClick={() => {
              setApiInputDraft(apiKey);
              setIsApiGateOpen(true);
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 text-sm font-bold transition"
          >
            <KeyRound className="w-4 h-4" />
            API 변경
          </button>
        </div>
      </aside>

      {/* 우측 본문 (상단 헤드 DART FACT-CHECKER 및 OpenDART 연결됨 버튼 삭제 완료) */}
      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
        {/* ====================================================================
            [탭 1] 첫 화면: 종목 현황
           ==================================================================== */}
        {activeTab === "DASHBOARD" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">종목 현황</h1>

              </div>

            </div>



            {companySearchControl({
              expanded:showAddCorpInput, query:newCorpQuery, suggestions:companySearchSuggestions, busy:isRefreshingApi,
              onToggle:open => {setShowAddCorpInput(open); if (!open) {setNewCorpQuery(""); setCompanySearchSuggestions([]);}},
              onQueryChange:setNewCorpQuery,
              onPick:async target => {const name = await handleFetchOrRegisterCompany(target); if (name) setSelectedCorpName(name); setNewCorpQuery(""); setCompanySearchSuggestions([]); setShowAddCorpInput(false);},
            })}
            {/* 기준 기업 선택 & 기업 검색 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-500">기준 기업</span>
              <select
                value={selectedCorpName}
                onChange={(e) => { setSelectedCorpName(e.target.value); setApiStatusMessage(""); }}
                className="px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {companies.map((c) => (
                  <option key={c.corpName} value={c.corpName}>
                    {c.corpName} ({c.stockCode})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">재무제표 기준
                <select value={selectedBasis} onChange={(e) => setSelectedBasis(e.target.value as "CFS" | "OFS")} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-800">
                  <option value="CFS">연결 기준</option><option value="OFS">별도 기준</option>
                </select>
              </label>

              <button
                onClick={() => handleFetchOrRegisterCompany(currentCompany.corpName, false, true)}
                disabled={isRefreshingApi}
                className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingApi ? "animate-spin" : ""}`} />
                {isRefreshingApi ? "DART 조회 중..." : "최신 데이터 갱신"}
              </button>
            </div>
            {apiStatusMessage && (
              <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center justify-between">
                <span>{apiStatusMessage}</span>
                <button onClick={() => setApiStatusMessage("")} className="text-emerald-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {companies.length > 0 && <div className="flex flex-wrap items-center gap-2 -mt-3" aria-label="등록 종목 삭제">
              <span className="text-[11px] text-slate-500">등록 종목</span>
              {companies.map((company) => <span key={company.corpName} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${company.corpName === selectedCorpName ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-white text-slate-700"}`}>
                <button type="button" onClick={() => { setSelectedCorpName(company.corpName); setApiStatusMessage(""); }} className="hover:underline">{company.corpName}</button>
                <button type="button" title={`${company.corpName} 삭제`} aria-label={`${company.corpName} 삭제`} onClick={() => handleRemoveRegisteredCompany(company.corpName)} className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-700"><X className="h-3 w-3" /></button>
              </span>)}
            </div>}

            {/* 상단 배너 */}
            <div className="bg-[#082f27] text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-2xl font-extrabold">
                  <span className="text-emerald-300 underline underline-offset-4">
                    {currentCompany.corpName}
                  </span>{" "}
                  종목 현황
                </div>
                <div className="text-xs text-emerald-100/80">{currentCompany.period}</div>{currentCompany.dataNotice && <p role="status" className="text-xs text-amber-200">{currentCompany.dataNotice}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveTab("ONE_PAGER")}
                  className="px-4 py-2.5 rounded-xl border border-white bg-white hover:bg-slate-100 text-emerald-950 text-xs font-bold transition"
                >
                  요약 보고서 보기 ➔
                </button>
                <button
                  onClick={() => {
                    setAskCorpName(currentCompany.corpName);
                    setAskQuery(`${currentCompany.corpName} 영업이익률`);
                    setAskSelectedMetricId("영업이익률");
                    setActiveTab("ASK");
                  }}
                  className="px-4 py-2.5 rounded-xl border border-white bg-white hover:bg-slate-100 text-emerald-950 text-xs font-bold transition"
                >
                  질문하기 ➔
                </button>
              </div>
            </div>



            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold text-slate-900">주요 실적</h2><span className="text-xs text-slate-500">{currentCompany.basisCode === "OFS" ? "별도 기준" : "연결 기준"}</span></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[{label:"매출액",key:"revenue"},{label:"영업이익",key:"operatingProfit"},{label:"순이익",key:"netIncome"}].map((item) => {
                  const value = officialMetricValue(item.key);
                  return <div key={item.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="text-xs font-bold text-slate-500">{item.label}</div><div className="mt-1 text-xl font-extrabold text-slate-900">{formatMetricValue(value, "억원")}</div></div>;
                })}
              </div>

            </section>

            {/* 커스텀 지표 (디자인 공백 축소, 우측 상단 픽토그램 제거, 추가 및 개별 삭제 '×' 작동) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold text-slate-900">커스텀 지표</h3>
                  <span className="text-xs text-slate-400">
                    ({customMetricIds.length}개 선택됨)
                  </span>
                </div>
                <button
                  onClick={() => setShowCustomPicker(!showCustomPicker)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showCustomPicker ? "지표 선택창 닫기" : "커스텀 지표 추가"}
                </button>
              </div>

              {showCustomPicker && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-1.5">
                  {METRIC_DEFINITIONS.filter(
                    (m) => !["매출액", "영업이익", "순이익", "자산회전율", "EBITDA"].includes(m.id)
                  ).map((m) => {
                    const isAdded = customMetricIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (isAdded) {
                            setCustomMetricIds((prev) => prev.filter((id) => id !== m.id));
                          } else {
                            setCustomMetricIds((prev) => [...prev, m.id]);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition inline-flex items-center gap-1 ${
                          isAdded
                            ? "bg-emerald-700 text-white"
                            : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {m.label}
                        {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {customMetricIds.length === 0 ? (
                <div className="text-xs text-slate-400 py-2 text-center">
                  선택된 커스텀 지표가 없습니다. [+ 커스텀 지표 추가] 버튼을 눌러 추가하세요.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {customMetricIds.map((mId) => {
                    const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
                    if (!mDef) return null;
                    const serverMetricKey = SERVER_METRIC_BY_UI_LABEL[mDef.id];
                    const hasAuthoritativeMetric = Boolean(serverMetricKey && currentCompany.serverMetrics && Object.prototype.hasOwnProperty.call(currentCompany.serverMetrics, serverMetricKey));
                    const serverMetricEntry = serverMetricKey ? currentCompany.serverMetrics?.[serverMetricKey] : undefined;
                    const serverMetricValue = serverMetricEntry?.value;
                    // 외부 수치 대조 정보는 화면에 노출하지 않습니다. 계정 산식·리스부채 제외 안내 등 필요한 계산 정보만 표시합니다.
                    const metricFormulaCandidate = serverMetricEntry?.formula || currentCompany.rawAccountMetrics?.[mDef.id]?.formula || mDef.formulaText;
                    const metricFormulaForDisplay = /네이버 금융|FnGuide|Yahoo Finance/i.test(metricFormulaCandidate) ? mDef.formulaText : metricFormulaCandidate;
                    const metricLinesForDisplay = [...(serverMetricEntry?.lines ?? []), ...(currentCompany.rawAccountMetrics?.[mDef.id]?.lines ?? [])]
                      .filter((line) => !/네이버 금융|FnGuide|Yahoo Finance|출처별 비교|수치 대조|교차검증|CFS\s*\(연결\)\s*공시가 없으면|조회 실패와 실제 미공시를 구분|실제 수치가 확보되지 않은 구간은 만들어 채우지 않습니다/i.test(line));
                    const metricDisclaimerForDisplay = serverMetricEntry?.disclaimer
                      ? (/네이버 금융|FnGuide|Yahoo Finance/i.test(serverMetricEntry.disclaimer) ? "공시 원문에서 필요한 계정 정보를 모두 확인하지 못했습니다. 확인되지 않은 값은 임의로 보정하지 않았습니다." : serverMetricEntry.disclaimer)
                      : undefined;
                    // 서버가 원문 계정으로 산출해 null을 반환한 지표는 로컬의 일부 계정 합계로 대체하지 않습니다.
                    // 서버 지표 매핑이 있는 항목은 반드시 같은 공시 스냅샷의 서버 계산값만 사용합니다.
                    // 서버 결과가 누락·산출불가이면 과거/별도 로컬 계정으로 계산해 헤드라인과 다른 비율을 만들지 않습니다.
                    const snapshotRevenue = officialMetricValue("revenue");
                    const snapshotOperatingProfit = officialMetricValue("operatingProfit");
                    const snapshotNetIncome = officialMetricValue("netIncome");
                    // 비율 카드는 서버의 독립된 비율 값이나 로컬 계정 캐시를 쓰지 않고,
                    // 화면 헤드라인과 동일한 이번 공시의 원천 숫자로 다시 계산해 값이 어긋나지 않게 합니다.
                    const sameSnapshotDerivedValue = mDef.id === "영업이익률"
                      ? officialMetricValueForDisplay("operatingMargin")
                      : mDef.id === "순이익률"
                        ? officialMetricValueForDisplay("netMargin")
                        : Number.NaN;
                    const revenueAndOperatingProfitSameSource = metricSourceTag("revenue") === metricSourceTag("operatingProfit");
                    const revenueAndNetIncomeSameSource = metricSourceTag("revenue") === metricSourceTag("netIncome");
                    const marginCalculationLines: string[] | null = mDef.id === "영업이익률" && revenueAndOperatingProfitSameSource && Number.isFinite(snapshotRevenue) && snapshotRevenue !== 0 && Number.isFinite(snapshotOperatingProfit)
                      ? [
                          `분자 · 영업이익: ${snapshotOperatingProfit.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}억원`,
                          `분모 · 매출액: ${snapshotRevenue.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}억원`,
                          `계산 · (${snapshotOperatingProfit.toLocaleString("ko-KR", { maximumFractionDigits: 6 })} ÷ ${snapshotRevenue.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}) × 100 = ${sameSnapshotDerivedValue.toFixed(2)}%`,
                          `기준 · ${currentCompany.basisCode === "OFS" ? "별도" : "연결"} / ${currentCompany.period || "현재 선택 공시 기간"}`,
                        ]
                      : mDef.id === "순이익률" && revenueAndNetIncomeSameSource && Number.isFinite(snapshotRevenue) && snapshotRevenue !== 0 && Number.isFinite(snapshotNetIncome)
                        ? [
                            `분자 · 당기순이익: ${snapshotNetIncome.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}억원`,
                            `분모 · 매출액: ${snapshotRevenue.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}억원`,
                            `계산 · (${snapshotNetIncome.toLocaleString("ko-KR", { maximumFractionDigits: 6 })} ÷ ${snapshotRevenue.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}) × 100 = ${sameSnapshotDerivedValue.toFixed(2)}%`,
                            `기준 · ${currentCompany.basisCode === "OFS" ? "별도" : "연결"} / ${currentCompany.period || "현재 선택 공시 기간"}`,
                          ]
                        : null;
                    const rawValue = mDef.id === "자산회전율"
                      ? Number.isFinite(snapshotRevenue) && Number.isFinite(rawAccountValue("자산총계")) && rawAccountValue("자산총계") !== 0
                        ? snapshotRevenue / rawAccountValue("자산총계") : Number.NaN
                      : rawAccountValue(mDef.id);
                    const val = Number.isFinite(sameSnapshotDerivedValue)
                      ? sameSnapshotDerivedValue
                      : serverMetricKey
                        ? (hasAuthoritativeMetric && typeof serverMetricValue === "number" && Number.isFinite(serverMetricValue) ? Number(serverMetricValue) : Number.NaN)
                        : rawValue;
                    return (
                      <div
                        key={mId}
                        className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/60 flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-600 truncate">
                            {mDef.label}
                          </span>
                          <button
                            onClick={() =>
                              setCustomMetricIds((prev) => prev.filter((id) => id !== mId))
                            }
                            title="지표 삭제"
                            className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-rose-600 transition"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="text-lg font-extrabold text-slate-900 mt-1.5">
                          {Number.isFinite(val) ? formatMetricValue(val, mDef.unit) : "수치 미검증"}
                        </div>
                        {!Number.isFinite(val) && (
                          <div className="mt-1 text-[10px] leading-relaxed text-slate-500">원문에서 확인 필요</div>
                        )}
                        {(mDef.id === "차입금" || mDef.id === "차입금의존도") && <div className="mt-1 text-[10px] font-medium text-slate-500">리스 미포함</div>}
                        <button type="button" onClick={() => setExpandedCalculationMetric((current) => current === mId ? null : mId)} className="mt-1 self-start rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-100">{expandedCalculationMetric === mId ? "계산식 닫기" : "계산식 살펴보기"}</button>
                        {expandedCalculationMetric === mId && <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3 text-xs leading-relaxed"><div className="font-extrabold text-slate-800">계산식</div><div className="mt-1 text-slate-700">{mDef.id === "영업이익률" ? "(영업이익 ÷ 매출액) × 100" : mDef.id === "순이익률" ? "(당기순이익 ÷ 매출액) × 100" : metricFormulaForDisplay}</div>{marginCalculationLines ? <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">{marginCalculationLines.map((line, index) => <div key={`${mId}-calculation-${index}`}>{line}</div>)}</div> : metricLinesForDisplay.length ? <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">{metricLinesForDisplay.map((line, index) => <div key={`${mId}-${index}`}>{line}</div>)}</div> : <div className="mt-2 text-amber-800">원문에서 확인 필요</div>}{!marginCalculationLines && metricDisclaimerForDisplay && <div className="mt-2 text-amber-800">{metricDisclaimerForDisplay}</div>}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* 요청사항: '최신 데이터 상태' 및 '숫자보다 중요한 건 숫자의 근거입니다' 박스 완전 삭제 유지 */}
          </div>
        )}

        {/* ====================================================================
            [탭 2] 질문하기
           ==================================================================== */}
        {activeTab === "ASK" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">질문하기</h1>

            </div>

            {companySearchControl({
              expanded:showAskCompanyInput, query:askCompanySearch, suggestions:askCompanySuggestions, busy:isRefreshingApi,
              onToggle:open => {setShowAskCompanyInput(open); if (!open) {setAskCompanySearch(""); setAskCompanySuggestions([]);}},
              onQueryChange:setAskCompanySearch,
              onPick:async target => {const name = await handleFetchOrRegisterCompany(target); if (name) {setAskCorpName(name); setAskQuery(`${name} 영업이익률`); setAskExecutedQuery(""); setLiveAskStatus("idle");} setAskCompanySearch(""); setAskCompanySuggestions([]); setShowAskCompanyInput(false);},
            })}

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <select
                  value={askCorpName}
                  onChange={(e) => {
                    setAskCorpName(e.target.value);
                    setAskQuery(`${e.target.value} ${askResultMetric.label}`);
                    setAskExecutedQuery("");
                    setLiveAskStatus("idle");
                  }}
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white"
                >
                  {companies.map((c) => (
                    <option key={c.corpName} value={c.corpName}>
                      {c.corpName}
                    </option>
                  ))}
                </select>

                <div className="min-w-0 flex gap-2 lg:w-1/2">
                  <input
                    type="text"
                    value={askQuery}
                    onChange={(e) => setAskQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRunAskSearch();
                    }}
                    placeholder="예: 대한전선 2026년 상반기 영업이익률, 최근 3년 매출액 추이, 차입금의존도"
                    className="min-w-0 flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    onClick={() => handleRunAskSearch()}
                    className="px-5 py-2.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white rounded-xl text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Search className="w-4 h-4" />
                    검색
                  </button>
                </div>

              </div>



              <p className="text-xs font-medium text-slate-600">기업명 + 기간 + 지표 입력 필요</p>
              <div className="pt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-500">질문 예시</span>
                {["10개년 상반기 매출액", "2024~2025년 자본총계", "최근 3년 부채비율 추이", "2026년 상반기 차입금 의존도", "최근 4개년 영업이익률 비교"].map((sample) => (
                  <button key={sample} type="button" onClick={() => { const q = `${askCorpName} ${sample}`; setAskQuery(q); handleRunAskSearch(q); }} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100">{sample}</button>
                ))}
              </div>
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-500 mr-2">카테고리</span>
                  {(
                    [
                      "전체",
                      "손익/수익성",
                      "재무상태/안정성",
                      "현금흐름/투자",
                      "운전자본/차입금",
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setAskCategory(cat)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        askCategory === cat
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-500 mr-2">세부 검색어</span>
                  {filteredCategoryMetrics.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setAskSelectedMetricId(m.id);
                        setAskQuery(`${askCorpName} ${m.label}`);
                        setAskExecutedQuery("");
                        setLiveAskStatus("idle");
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                        askSelectedMetricId === m.id
                          ? "bg-emerald-700 text-white"
                          : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {askExecutedQuery.trim().length >= 2 && (
              <LiveDartPanel
                question={askExecutedQuery}
                onStatusChange={setLiveAskStatus}
              />
            )}


          </div>
        )}

        {/* ====================================================================
            [탭 3] 비교분석
           ==================================================================== */}
        {activeTab === "COMPARE" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">비교분석</h1>

              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button disabled={isRefreshingCompare}
                  onClick={() =>
                    exportComparisonPdf(comparisonExportMatrix)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF 다운로드
                </button>
                <button disabled={isRefreshingCompare}
                  onClick={() =>
                    exportComparisonExcel(comparisonExportMatrix)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Excel 다운로드
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-extrabold text-slate-700" htmlFor="compare-year-choice">① 비교 연도</label>
                <select id="compare-year-choice" value={compareYear} onChange={(e) => { setLiveCompareResults({}); setIsRefreshingCompare(true); setCompareYear(Number(e.target.value)); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  {Array.from({ length: new Date().getFullYear() - 2016 + 1 }, (_, i) => new Date().getFullYear() - i).map((year) => <option key={year} value={year}>{year}년</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-extrabold text-slate-700" htmlFor="compare-period-choice">② 보고 기간</label>
                <select id="compare-period-choice" value={comparePeriodChoice} onChange={(e) => { setLiveCompareResults({}); setIsRefreshingCompare(true); setComparePeriodChoice(e.target.value as ComparePeriodChoice); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
                  <option value="q1">1분기 (1~3월 누계)</option>
                  <option value="half">상반기 (1~6월 누계)</option>
                  <option value="q3">3분기 (1~9월 누계)</option>
                  <option value="annual">연간 (사업보고서)</option>
                </select>
              </div>

            </div>

            {/* 1. 기업 검색 등록 및 삭제 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  1. 비교기업 선택 및 검색 등록 ({compareCorpNames.length}개 / 최대 10개 비교 가능)
                </h2>
                <div className="relative flex items-center gap-2">
                  <input
                    type="text"
                    value={compareSearchInput}
                    onChange={(e) => setCompareSearchInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && compareSearchInput.trim()) {
                        const target = compareSearchInput.trim();
                        const registeredName = await handleFetchOrRegisterCompany(target);
                        if (registeredName && !compareCorpNames.includes(registeredName)) {
                          setCompareCorpNames((prev) => [...new Set([...prev, registeredName])].slice(0,10));
                        }
                        setCompareSearchInput("");
                      }
                    }}
                    placeholder="기업명 검색"
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs w-60"
                  />
                  {compareCompanySuggestions.length > 0 && <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{compareCompanySuggestions.map((item) => <button type="button" key={item.code} onClick={async () => { const name = await handleFetchOrRegisterCompany(item.name); if (name && !compareCorpNames.includes(name)) setCompareCorpNames((prev) => [...new Set([...prev, name])].slice(0,20).slice(0,10)); setCompareSearchInput(""); setCompareCompanySuggestions([]); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-emerald-50"><span className="font-bold">{item.name}</span><span className="ml-2 text-slate-500">{item.stock || item.code}</span></button>)}</div>}
                  <button
                    onClick={async () => {
                      const target = compareSearchInput.trim();
                      if (!target) return;
                      const registeredName = await handleFetchOrRegisterCompany(target);
                      if (registeredName && !compareCorpNames.includes(registeredName)) {
                        setCompareCorpNames((prev) => [...new Set([...prev, registeredName])].slice(0,10));
                      }
                      setCompareSearchInput("");
                    }}
                    className="px-3.5 py-1.5 bg-[#0b3b2c] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> 기업 검색
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {companies.map((c) => {
                  const isSelected = compareCorpNames.includes(c.corpName);
                  return (
                    <div
                      key={c.corpName}
                      className={`inline-flex items-center rounded-xl border text-xs font-bold transition ${
                        isSelected
                          ? "bg-emerald-700 text-white border-emerald-700"
                          : "bg-slate-50 text-slate-700 border-slate-200"
                      }`}
                    >
                      <button
                        onClick={() => {
                          if (isSelected) {
                            if (compareCorpNames.length > 1) {
                              setCompareCorpNames((prev) =>
                                prev.filter((n) => n !== c.corpName)
                              );
                            }
                          } else {
                            setCompareCorpNames((prev) => [...new Set([...prev, c.corpName])].slice(0,10));
                          }
                        }}
                        className="px-3 py-1.5"
                      >
                        {c.corpName}
                      </button>
                      <button
                        onClick={() => handleRemoveRegisteredCompany(c.corpName)}
                        title="기업 삭제"
                        className={`pr-2.5 pl-1 py-1.5 ${
                          isSelected ? "text-emerald-100 hover:text-rose-200" : "text-slate-400 hover:text-rose-600"
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. 비교 지표 다중 선택 (드롭다운 대신 비교기업처럼 2개~5개 버튼 선택) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    2. 비교 지표 선택 (2개 ~ 5개 선택)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    현재 <strong>{compareMetricIds.length}개</strong> 선택됨 (최소 2개 ~ 최대 5개)
                  </p>
                </div>
                {compareValidationMsg && (
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-lg">
                    {compareValidationMsg}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {METRIC_DEFINITIONS.map((m) => {
                  const active = compareMetricIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleCompareMetric(m.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${
                        active
                          ? "bg-[#0b3b2c] text-white shadow-2xs"
                          : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {m.label}
                      {active && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. 결과값 비교 테이블 (기업 | 선택한 지표들(최대 5개) 값 | 출처) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-extrabold text-slate-900">결과값 비교</h2>
              <div className="overflow-x-auto">
                <table className="dart-results-table dart-compare-table w-full text-sm border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs">
                      <th className="border border-slate-200 px-4 py-3 text-left">기업</th>
                      {compareMetricIds.map((mId) => {
                        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
                        return (
                          <th
                            key={mId}
                            className="border border-slate-200 px-4 py-3 text-right"
                          >
                            {mDef?.label}
                          </th>
                        );
                      })}
                      <th className="border border-slate-200 px-2 py-3 text-left whitespace-nowrap">출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareCorpNames.map((cName) => {
                      const comp = companies.find((c) => c.corpName === cName);
                      if (!comp) return null;
                      return (
                        <tr key={cName} className="hover:bg-slate-50/80">
                          <td className="border border-slate-200 px-4 py-3.5 font-extrabold text-slate-900">
                            {comp.corpName}
                            <span className="block text-[10px] font-semibold text-emerald-700">
                              {liveCompareResults[compareMetricIds[0]]?.find((row) => row.company === comp.corpName)?.basis || ""}
                            </span>
                          </td>
                          {compareMetricIds.map((mId) => {
                            const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                            const serverRow = (liveCompareResults[mId] ?? []).find((row) => row.company === comp.corpName);
                            const hasValue = Boolean(serverRow?.found && serverRow.value !== null && Number.isFinite(serverRow.value));
                            return (
                              <td key={mId} title="실시간 공시 기준 조회 결과" className="border border-slate-200 px-3 py-3.5 text-right font-bold text-slate-900 whitespace-nowrap">
                                <div>{hasValue ? formatMetricValue(serverRow!.value as number, mDef.unit) : !serverRow && isRefreshingCompare ? "조회 중…" : "수치 미검증"}</div>
                                {!hasValue && !isRefreshingCompare && <div className="mt-1 text-[10px] font-normal text-slate-500">원문에서 확인 필요</div>}
                              </td>
                            );
                          })}
                          <td className="border border-slate-200 px-2 py-2 text-[10px] whitespace-nowrap min-w-[190px]">
                            {(() => {
                              const sources = compareMetricIds.flatMap(metricId => {
                                const row = (liveCompareResults[metricId] || []).find(item => item.company === comp.corpName);
                                return metricSourceLinks(row?.citation, row?.rceptNo).map(link => ({...link, metricId}));
                              });
                              const links = [...new Map(sources.map(link => [link.url, link])).values()];
                              if (!links.length) return <span className="text-slate-400">출처 미확인</span>;
                              if (links.length === 1) return <a href={links[0].url} target="_blank" rel="noreferrer" className="text-emerald-700 underline">{links[0].label} ↗</a>;
                              return <details><summary className="cursor-pointer text-emerald-700 underline">출처 보기</summary><div className="mt-2 space-y-2 whitespace-normal">{links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="block text-emerald-700 underline">{sources.filter(item => item.url === link.url).map(item => item.metricId).join(", ")} · {link.label} ↗</a>)}</div></details>;
                            })()}

                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            [탭 5] 요약 보고서 (첫 질문에서 요청하신 첨부 이미지 image_c888de.jpg 3단 차트 + 수치 검증 통합)
           ==================================================================== */}



        {activeTab === "ALERTS" && <section className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="whitespace-nowrap text-2xl font-extrabold">공시 알림 및 최신 현황</h1><p className="mt-1 text-sm text-slate-500">관심기업의 신규 공시를 15초 간격으로 확인하며, 브라우저가 열려 있는 동안 동작합니다.</p></div><div className="ml-auto flex shrink-0 gap-2"><button type="button" onClick={() => { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); setAlertStatus("브라우저 알림 권한 요청을 보냈습니다. 브라우저에서 허용해 주세요."); }} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">브라우저 알림 켜기</button></div></div>
          <div className="rounded-2xl border bg-white p-4 space-y-3"><div className="text-sm font-extrabold">관심기업 추가·삭제 (최대 20개)</div><div className="relative flex flex-wrap gap-2"><input value={alertCompanySearch} onChange={(e) => setAlertCompanySearch(e.target.value)} onKeyDown={async (e) => { if (e.key === "Enter" && alertCompanySearch.trim()) { const name = await handleFetchOrRegisterCompany(alertCompanySearch); if (name) { setAlertCompanyNames((prev) => [...new Set([...prev, name])].slice(0,20)); setAlertViewCompanyName(name); setAlertStatus(`${name}을 등록하고 관심기업에 추가했습니다.`); } setAlertCompanySearch(""); setAlertCompanySuggestions([]); } }} placeholder="기업명 검색" className="min-w-[220px] flex-1 rounded-lg border px-3 py-2 text-sm"/><button type="button" disabled={!alertCompanySearch.trim() || isRefreshingApi} onClick={async () => { const name = await handleFetchOrRegisterCompany(alertCompanySearch); if (name) { setAlertCompanyNames((prev) => [...new Set([...prev, name])].slice(0,20)); setAlertViewCompanyName(name); setAlertStatus(`${name}을 등록하고 관심기업에 추가했습니다.`); } setAlertCompanySearch(""); setAlertCompanySuggestions([]); }} className="rounded-lg bg-emerald-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">기업 등록하기</button>{alertCompanySuggestions.length > 0 && <div className="absolute left-0 top-full z-30 mt-1 max-h-60 w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">{alertCompanySuggestions.map((item) => <button type="button" key={item.code} onClick={async () => { const name = await handleFetchOrRegisterCompany(item.name); if (name) { setAlertCompanyNames((prev) => [...new Set([...prev, name])].slice(0,20)); setAlertViewCompanyName(name); setAlertStatus(`${name}을 등록하고 관심기업에 추가했습니다.`); } setAlertCompanySearch(""); setAlertCompanySuggestions([]); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-emerald-50"><span className="font-bold">{item.name}</span><span className="ml-2 text-slate-500">{item.stock || item.code}</span></button>)}</div>}</div><div className="flex flex-wrap gap-2">{alertCompanyNames.map((name) => <span key={name} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold">{name}<button type="button" title={`${name} 관심기업에서 삭제`} onClick={() => setAlertCompanyNames((prev) => prev.filter((item) => item !== name))} className="text-slate-500 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button></span>)}{!alertCompanyNames.length && <span className="text-xs text-slate-500">관심기업이 없습니다. 위에서 기업을 검색하거나 선택하세요.</span>}</div><div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><div>상태: {alertStatus}</div><div className="mt-1">마지막 성공 조회: {lastAlertCheck || "아직 없음"}</div></div></div>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="font-extrabold text-slate-900">{alertDisplayCompany.corpName} 공시 현황</h2><p className="mt-1 text-xs text-slate-500">최근 6개월 접수 공시 · 최신순</p></div><div className="flex flex-wrap items-center gap-2"><label htmlFor="alert-view-company" className="text-xs font-semibold text-slate-600">기업 선택</label><select id="alert-view-company" aria-label="공시 현황 기업 선택" value={alertDisplayCompany.corpName} onChange={(e) => setAlertViewCompanyName(e.target.value)} className="max-w-[220px] rounded-lg border px-3 py-2 text-xs font-semibold">{companies.map((item) => <option key={item.corpName} value={item.corpName}>{item.corpName}</option>)}</select><button type="button" onClick={() => setCompanyFilingsRefreshNonce((n) => n + 1)} disabled={isLoadingCurrentFilings} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">{isLoadingCurrentFilings ? "조회 중…" : "새로고침"}</button></div></div>{displayedCompanyFilings.length ? <div className="divide-y divide-slate-100">{displayedCompanyFilings.slice(0, 20).map((filing) => <a key={filing.rceptNo} href={filing.url} target="_blank" rel="noreferrer" className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-emerald-50/50"><span className="w-[82px] text-xs tabular-nums text-slate-500">{filing.receiptDate.slice(0,4)}.{filing.receiptDate.slice(4,6)}.{filing.receiptDate.slice(6,8)}</span><span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{filing.reportName}</span><ExternalLink className="h-3.5 w-3.5 text-emerald-700" /></a>)}</div> : <div className="p-5 text-sm text-slate-500">{isLoadingCurrentFilings ? "DART 공시목록을 조회하고 있습니다…" : currentFilingsMessage}</div>}<p className="border-t border-slate-100 p-3 text-[11px] text-slate-500">{currentFilingsMessage} · 화면 활성 시 15초 간격 자동 확인</p></section>
        </section>}

        {activeTab === "ONE_PAGER" && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-xs"><label>분기 조회 시작 연도 <select value={historyStartYear} onChange={e=>{setHistoryStartYear(Number(e.target.value));setHistoryEndYear(end=>Math.max(end,Number(e.target.value)));setHistoryLoadAttemptedFor("");}}>{Array.from({length:new Date().getFullYear()-2015},(_,i)=>2016+i).map(y=><option key={y}>{y}</option>)}</select></label><label>종료 연도 <select value={historyEndYear} onChange={e=>{setHistoryEndYear(Number(e.target.value));setHistoryLoadAttemptedFor("");}}>{Array.from({length:new Date().getFullYear()-historyStartYear+1},(_,i)=>historyStartYear+i).map(y=><option key={y}>{y}</option>)}</select></label><span role="status">{historyLoadMessage || "최근 3개년 기본 조회 · 2016년부터 선택 가능"}</span></div>}
        {activeTab === "ONE_PAGER" && (
          <div className="bg-[#faf9f5] text-stone-900 border border-stone-300 rounded-2xl p-6 md:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-300 pb-4 print:hidden">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-900 text-white">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {currentCompany.verificationNote}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={selectedCorpName}
                  onChange={(e) => { setSelectedCorpName(e.target.value); setApiStatusMessage(""); }}
                  className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs font-bold bg-white"
                >
                  {companies.map((c) => (
                    <option key={c.corpName} value={c.corpName}>
                      {c.corpName} ({c.stockCode})
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold"
                >
                  <Printer className="w-3.5 h-3.5" />
                  요약 보고서 인쇄 / PDF 저장
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-stone-300 bg-white/70 px-3 py-2 text-xs text-stone-600">
              <span className="font-bold text-stone-800">최신 확인 공시:</span> {currentCompany.reportName || currentCompany.period || "DART 정기보고서"} · {currentCompany.basisCode === "OFS" ? "별도 기준" : "연결 기준"}
              {/^\d{14}$/.test(currentCompany.rceptNo || "") && <> · <a className="font-bold text-emerald-800 underline" href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${currentCompany.rceptNo}`} target="_blank" rel="noreferrer">공시 원문 확인 ↗</a></>}
            </div>
            <h2 className="text-lg md:text-xl font-bold text-stone-900">
              {currentCompany.corpName} 재무 종합 분석 — 매출 {officialMetricText("revenue")} · 영업이익 {officialMetricText("operatingProfit")} (영업이익률 {officialMetricText("operatingMargin", "%")})
            </h2>

            {/* 임원용 핵심 평가: 확인된 공시 수치로만 긍정 신호·점검 리스크를 자동 요약합니다. */}
            {(() => {
              const revenue = officialMetricValue("revenue");
              const op = officialMetricValue("operatingProfit");
              const net = officialMetricValue("netIncome");
              const margin = officialMetricValueForDisplay("operatingMargin");
              const debtRatio = officialMetricValue("debtRatio");
              const currentRatio = officialMetricValue("currentRatio");
              const coverage = officialMetricValue("interestCoverage");
              const cashFlow = officialMetricValue("operatingCashFlow");
              const strengths: string[] = [];
              const risks: string[] = [];
              const limitations: string[] = [];
              if (Number.isFinite(op)) op > 0 ? strengths.push(`본업은 ${formatMetricValue(op, "억원")} 영업흑자입니다.`) : risks.push(`본업은 ${formatMetricValue(op, "억원")} 영업손실입니다.`);
              if (Number.isFinite(margin)) margin > 0 ? strengths.push(`영업이익률 ${margin.toFixed(2)}%로 매출에서 본업 이익을 남겼습니다.`) : risks.push(`영업이익률 ${margin.toFixed(2)}%로 본업 손실 상태입니다.`);
              if (Number.isFinite(op) && Number.isFinite(net) && op > 0 && net < 0) risks.push(`영업흑자와 순손실(${formatMetricValue(net, "억원")})이 동시에 나타납니다. 금융원가·기타손익·법인세를 확인해야 하지만, 현재 숫자만으로 원인을 확정할 수 없습니다.`);
              if (Number.isFinite(debtRatio)) debtRatio > 100 ? risks.push(`부채비율 ${debtRatio.toFixed(2)}%로 부채총계가 자본총계를 초과합니다. 만기와 이자 부담을 함께 점검해야 합니다.`) : strengths.push(`부채비율 ${debtRatio.toFixed(2)}%로 부채총계가 자본총계보다 낮습니다. 단, 상환능력 전체를 뜻하지는 않습니다.`);
              if (Number.isFinite(currentRatio)) currentRatio < 100 ? risks.push(`유동비율 ${currentRatio.toFixed(2)}%로 유동자산이 유동부채보다 적습니다. 단기 유동성 점검이 필요합니다.`) : strengths.push(`유동비율 ${currentRatio.toFixed(2)}%로 유동자산이 유동부채 이상입니다. 회수 가능성은 별도로 봐야 합니다.`);
              if (Number.isFinite(coverage)) coverage < 1 ? risks.push(`이자보상배율 ${coverage.toFixed(2)}배로 영업이익이 이자비용에 미치지 못합니다.`) : strengths.push(`이자보상배율 ${coverage.toFixed(2)}배로 산식상 영업이익이 이자비용을 충당합니다.`);
              if (Number.isFinite(cashFlow)) cashFlow < 0 ? risks.push(`영업활동현금흐름 ${formatMetricValue(cashFlow, "억원")}이 음수입니다. 매출채권·재고·매입채무 변동을 점검할 필요가 있습니다.`) : strengths.push(`영업활동현금흐름 ${formatMetricValue(cashFlow, "억원")}이 양수여서 해당 기간 영업활동에서 현금 순유입이 발생했습니다.`);
              const qHistory = (currentCompany.quarterlyHistory ?? []).filter((q) => Number.isFinite(q.revenue) && Number.isFinite(q.operatingProfit));
              const qMatch = (period: string) => period.match(/^([1-4])Q(\d{2})$/i);
              if (qHistory.length) {
                const latest = qHistory[qHistory.length - 1];
                const match = qMatch(latest.period);
                const previous = match ? qHistory.find((q) => q.period === `${match[1]}Q${String(Number(match[2]) - 1).padStart(2, "0")}`) : undefined;
                if (previous) {
                  const revenueDelta = latest.revenue - previous.revenue;
                  const profitDelta = latest.operatingProfit - previous.operatingProfit;
                  if (revenueDelta > 0 && profitDelta > 0) strengths.push(`동일 분기 전년 대비 매출이 ${formatMetricValue(revenueDelta, "억원")}, 영업이익이 ${formatMetricValue(profitDelta, "억원")} 증가했습니다.`);
                  if (revenueDelta < 0 || profitDelta < 0) risks.push(`동일 분기 전년 대비 매출 변동 ${formatMetricValue(revenueDelta, "억원")}, 영업이익 변동 ${formatMetricValue(profitDelta, "억원")}입니다. 변동 원인은 사업보고서 설명에서 별도로 입증해야 합니다.`);
                } else limitations.push("동일 분기 전년 비교 자료가 확보되지 않아 성장 추세 평가는 보류했습니다.");
              } else limitations.push("비교 가능한 분기 공시가 아직 없어 추세 평가는 보류했습니다.");
              if (!strengths.length && !risks.length) limitations.push("현재 확보한 실제 원천 계정만으로 긍정·부정 신호를 판단하기 어렵습니다.");
              return <section className="rounded-xl border border-stone-300 bg-white p-4 md:p-5 space-y-3">
                <div className="flex flex-wrap justify-between items-center gap-2"><h3 className="text-base font-extrabold text-stone-900">핵심 평가 · 수치 기반 해석</h3><span className="text-[10px] text-stone-500">DART 실제 공시 기준 · #{currentCompany.rceptNo || "접수번호 미확인"}</span></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"><h4 className="text-xs font-bold text-emerald-900">확인된 긍정 신호</h4>{strengths.length ? <ul className="mt-1 list-disc pl-4 space-y-1 text-xs leading-relaxed text-stone-800">{strengths.map((text, i) => <li key={`strength-${i}`}>{text}</li>)}</ul> : <p className="mt-1 text-xs text-stone-600">현재 수치에서 확인 가능한 긍정 신호가 충분하지 않습니다.</p>}</div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3"><h4 className="text-xs font-bold text-amber-900">우선 점검할 리스크</h4>{risks.length ? <ul className="mt-1 list-disc pl-4 space-y-1 text-xs leading-relaxed text-stone-800">{risks.map((text, i) => <li key={`risk-${i}`}>{text}</li>)}</ul> : <p className="mt-1 text-xs text-stone-600">현재 확인한 지표에서 지정된 점검 신호는 확인되지 않았습니다. 위험이 없다는 보증은 아닙니다.</p>}</div>
                </div>
                {limitations.length > 0 && <p className="text-xs text-stone-600 leading-relaxed">판단 한계: {limitations.join(" ")}</p>}
                <p className="text-[10px] text-stone-500 leading-relaxed">이 평가는 선택 공시의 산식과 실제 수치를 바탕으로 한 1차 점검입니다. 업종 평균·공시로 입증되지 않은 원인·투자 등급을 추정하지 않습니다.</p>
              </section>;
            })()}

            {/* 분기별 실적 흐름: 지표별 차트 카드로 분리해 가독성을 높입니다. */}
            {(() => {
              const allPoints = currentCompany.quarterlyHistory ?? [];
              if (!allPoints.length) return <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100"><BarChart3 className="h-6 w-6 text-stone-500" /></div><p className="mt-3 text-sm font-semibold text-stone-700">{isLoadingHistory ? `${currentCompany.corpName}의 분기 공시를 조회하고 있습니다…` : historyLoadMessage || "차트에 표시할 실제 분기 자료가 없습니다."}</p><button type="button" disabled={isLoadingHistory || !apiKey} onClick={() => { setHistoryLoadAttemptedFor(""); setHistoryRetryNonce((n) => n + 1); }} className="mt-4 rounded-lg bg-stone-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">{isLoadingHistory ? "조회 중…" : "분기 공시 다시 조회"}</button></div>;
              const points = allPoints.slice(-8);
              const latest = points[points.length - 1];
              const previous = points.length > 1 ? points[points.length - 2] : undefined;
              const fmt = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
              // 그래프 원천 금액은 서버에서 이미 억원으로 변환되어 있습니다.
              // 축에서도 만/천으로 재축약하지 않고 억원 숫자를 그대로 표시합니다.
              const compact = (value: number) => fmt(value);
              const chartWidth = 520;
              const left = 80;
              const right = 12;
              const top = 22;
              const bottom = 151;
              const height = bottom - top;
              const slot = (chartWidth - left - right) / points.length;
              const xAt = (index: number) => left + index * slot + slot / 2;
              const deltaText = (value: number, prior?: number) => {
                if (prior === undefined) return "직전 분기 비교 자료 없음";
                const delta = value - prior;
                const sign = delta > 0 ? "+" : "";
                return `${sign}${fmt(delta)}억원 · 전분기 대비`;
              };
              const revenueMax = Math.max(1, ...points.map((q) => Math.abs(q.revenue))) * 1.18;
              const operatingValues = points.flatMap((q) => [q.operatingProfit, Number.isFinite(q.separateOperatingProfit) ? q.separateOperatingProfit as number : q.operatingProfit]);
              const operatingMin = Math.min(0, ...operatingValues);
              const operatingMax = Math.max(0, ...operatingValues);
              const operatingSpan = Math.max(1, operatingMax - operatingMin);
              const operatingY = (value: number) => top + ((operatingMax - value) / operatingSpan) * height;
              const margins = points.map((q) => q.revenue !== 0 ? (q.operatingProfit / q.revenue) * 100 : 0);
              const marginMin = Math.min(0, ...margins);
              const marginMax = Math.max(5, ...margins);
              const marginPadding = Math.max(1.5, (marginMax - marginMin) * .15);
              const rateMin = marginMin - marginPadding;
              const rateMax = marginMax + marginPadding;
              const rateY = (value: number) => top + ((rateMax - value) / Math.max(1, rateMax - rateMin)) * height;
              const ratePoints = points.map((q, index) => `${xAt(index)},${rateY(q.revenue ? q.operatingProfit / q.revenue * 100 : 0)}`).join(" ");
              const latestMargin = latest && latest.revenue !== 0 ? latest.operatingProfit / latest.revenue * 100 : Number.NaN;
              const previousMargin = previous && previous.revenue !== 0 ? previous.operatingProfit / previous.revenue * 100 : Number.NaN;
              const cardClass = "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";
              const valueClass = "mt-2 text-2xl font-black tracking-tight text-slate-900";
              return <section className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-2 px-1"><div><h3 className="text-lg font-extrabold tracking-tight text-stone-900">분기별 실적 흐름</h3><p className="mt-1 text-xs text-stone-500">최근 {points.length}개 분기 · {points[0]?.basisCode === "OFS" ? "별도 기준" : "연결 기준"} · 원천 공시 수치</p></div><span className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-600">단위: 억원 · 이익률 %</span></div>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <article className={cardClass}>
                    <header className="border-b border-slate-100 px-4 pb-3 pt-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600"/><h4 className="text-sm font-extrabold text-slate-900">매출액</h4></div><span className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">분기 실적</span></div><div className={valueClass}>{latest ? fmt(latest.revenue) : "—"}<span className="ml-1 text-xs font-semibold text-slate-500">억원</span></div><p className={`mt-1 text-[11px] ${previous && latest && latest.revenue < previous.revenue ? "text-rose-600" : "text-emerald-700"}`}>{latest && previous ? deltaText(latest.revenue, previous.revenue) : "직전 분기 비교 자료 없음"}</p></header>
                    <div className="px-2 pb-3 pt-3"><svg viewBox={`0 0 ${chartWidth} 195`} className="h-auto w-full" role="img" aria-label="최근 분기별 매출액 막대 차트">{[0,.5,1].map((ratio) => { const y = bottom - ratio * height; return <g key={ratio}><line x1={left} y1={y} x2={chartWidth-right} y2={y} stroke="#e6ecef" strokeDasharray="3 4"/><text x={left-7} y={y+3.5} textAnchor="end" fontSize="9.5" fill="#94a3b8">{compact(revenueMax*ratio)}</text></g>; })}{points.map((q,index) => {const x=xAt(index);const barHeight=Math.abs(q.revenue)/revenueMax*height;const y=bottom-barHeight;const width=Math.min(27,slot*.55);return <g key={`revenue-${q.period}`}><rect x={x-width/2} y={y} width={width} height={Math.max(1,barHeight)} rx="4" fill={index===points.length-1?"#047857":"#a7d9c8"}/><text x={x} y={Math.max(12,y-5)} textAnchor="middle" fontSize="8.5" fontWeight={index===points.length-1?700:500} fill="#334155">{fmt(q.revenue)}</text><text x={x} y="175" textAnchor="middle" fontSize="9.5" fontWeight={index===points.length-1?700:400} fill={index===points.length-1?"#047857":"#64748b"}>{q.period}</text></g>;})}</svg></div>
                  </article>
                  <article className={cardClass}>
                    <header className="border-b border-slate-100 px-4 pb-3 pt-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-amber-500"/><h4 className="text-sm font-extrabold text-slate-900">영업이익</h4></div><span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">본업 수익</span></div><div className={valueClass}>{latest ? fmt(latest.operatingProfit) : "—"}<span className="ml-1 text-xs font-semibold text-slate-500">억원</span></div><p className={`mt-1 text-[11px] ${previous && latest && latest.operatingProfit < previous.operatingProfit ? "text-rose-600" : "text-emerald-700"}`}>{latest && previous ? deltaText(latest.operatingProfit, previous.operatingProfit) : "직전 분기 비교 자료 없음"}</p></header>
                    <div className="px-2 pb-3 pt-3"><div className="mb-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[9.5px] text-slate-500"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-emerald-700"/>별도</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-amber-500"/>연결 차이</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-slate-300"/>분해 미확인</span></div><svg viewBox={`0 0 ${chartWidth} 195`} className="h-auto w-full" role="img" aria-label="최근 분기별 영업이익 막대 차트">{[-1,0,1].map((part)=>{const value=operatingMin+(operatingSpan*(part+1))/2;const y=operatingY(value);return <g key={part}><line x1={left} y1={y} x2={chartWidth-right} y2={y} stroke={Math.abs(value)<.0001?"#aab4c0":"#e6ecef"} strokeDasharray={Math.abs(value)<.0001?undefined:"3 4"}/><text x={left-7} y={y+3.5} textAnchor="end" fontSize="9.5" fill="#94a3b8">{compact(value)}</text></g>;})}{points.map((q,index)=>{const x=xAt(index);const width=Math.min(27,slot*.55);const baseline=operatingY(0);const totalY=operatingY(q.operatingProfit);const hasSeparate=Number.isFinite(q.separateOperatingProfit)&&Number.isFinite(q.subsidiaryAndAdjProfit);const separate=hasSeparate?q.separateOperatingProfit as number:q.operatingProfit;const separateY=operatingY(separate);const rect=(y1:number,y2:number,fill:string,key:string)=><rect key={key} x={x-width/2} y={Math.min(y1,y2)} width={width} height={Math.max(1,Math.abs(y2-y1))} rx="3" fill={fill}/>;return <g key={`operating-${q.period}`}>{hasSeparate?<>{rect(baseline,separateY,"#047857",`base-${q.period}`)}{Math.abs(q.operatingProfit-separate)>.0001?rect(separateY,totalY,"#f59e0b",`delta-${q.period}`):null}</>:rect(baseline,totalY,"#cbd5e1",`total-${q.period}`)}<text x={x} y={q.operatingProfit>=0?Math.max(12,totalY-5):totalY+12} textAnchor="middle" fontSize="9.5" fontWeight={index===points.length-1?700:500} fill={q.operatingProfit<0?"#be123c":"#334155"}>{compact(q.operatingProfit)}</text><text x={x} y="175" textAnchor="middle" fontSize="9.5" fontWeight={index===points.length-1?700:400} fill={index===points.length-1?"#047857":"#64748b"}>{q.period}</text></g>;})}</svg></div>
                  </article>
                  <article className={cardClass}>
                    <header className="border-b border-slate-100 px-4 pb-3 pt-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-indigo-600"/><h4 className="text-sm font-extrabold text-slate-900">영업이익률</h4></div><span className="rounded-md bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-800">수익성</span></div><div className={valueClass}>{Number.isFinite(latestMargin) ? `${latestMargin.toFixed(2)}%` : "—"}</div><p className={`mt-1 text-[11px] ${Number.isFinite(latestMargin) && Number.isFinite(previousMargin) && latestMargin < previousMargin ? "text-rose-600" : "text-indigo-700"}`}>{Number.isFinite(latestMargin) && Number.isFinite(previousMargin) ? `${latestMargin-previousMargin>0?"+":""}${(latestMargin-previousMargin).toFixed(2)}%p · 전분기 대비` : "직전 분기 비교 자료 없음"}</p></header>
                    <div className="px-2 pb-3 pt-3"><svg viewBox={`0 0 ${chartWidth} 195`} className="h-auto w-full" role="img" aria-label="최근 분기별 영업이익률 선 차트">{[0,.5,1].map((ratio)=>{const value=rateMin+(rateMax-rateMin)*ratio;const y=rateY(value);return <g key={ratio}><line x1={left} y1={y} x2={chartWidth-right} y2={y} stroke="#e6ecef" strokeDasharray="3 4"/><text x={left-7} y={y+3.5} textAnchor="end" fontSize="9.5" fill="#94a3b8">{value.toFixed(0)}%</text></g>;})}<polyline points={ratePoints} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{points.map((q,index)=>{const value=q.revenue!==0?q.operatingProfit/q.revenue*100:0;const x=xAt(index);const y=rateY(value);return <g key={`margin-${q.period}`}><circle cx={x} cy={y} r={index===points.length-1?5:3.5} fill={index===points.length-1?"#4f46e5":"#a5b4fc"} stroke="#fff" strokeWidth="1.5"/><text x={x} y={y-9} textAnchor="middle" fontSize="9.5" fontWeight={index===points.length-1?700:500} fill="#4338ca">{value.toFixed(1)}%</text><text x={x} y="175" textAnchor="middle" fontSize="9.5" fontWeight={index===points.length-1?700:400} fill={index===points.length-1?"#4f46e5":"#64748b"}>{q.period}</text></g>;})}</svg></div>
                  </article>
                </div>
                <p className="px-1 text-[11px] leading-relaxed text-stone-500">주: 최근 8개 분기만 표시합니다. 영업이익 분해가 확인되지 않은 기간은 총 영업이익으로 표시하며, 실제 공시에 없는 값은 보간하지 않습니다. 막대·선 위의 값은 해당 분기 실적입니다.</p>
              </section>;
            })()}

                        {/* 실제 공시 수치로 만든 해석. 추세 비교는 동일 분기 공시가 모두 있을 때만 표기합니다. */}
            <section className="rounded-xl border border-stone-300 bg-white p-4 md:p-5 space-y-3">
              <h3 className="text-base font-extrabold text-stone-900">수치 기반 평가</h3>
              <p className="text-[11px] text-stone-500">공시 수치에서 직접 계산한 해석입니다. 업종 평균·경영진 설명이 확인되지 않은 경우 업계 대비 우열이나 원인을 단정하지 않습니다.</p>
              {summaryAssessments.map((item) => (
                <div key={item.title} className="border-l-2 border-emerald-800 pl-3 py-1">
                  <div className="font-bold text-stone-900">{item.title}</div>
                  <p className="mt-1 text-xs md:text-[13px] leading-relaxed text-stone-800">{item.text}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-stone-500">{item.basis}</p>
                </div>
              ))}
            </section>

            {/* Fact-Locked 요약 코멘터리: 서버의 실제 DART 원천 계정 기반 수치만 표시 */}
            <div className="space-y-2 text-xs md:text-[13px] leading-relaxed text-stone-800">
              <div className="pl-3 border-l-2 border-stone-800">
                <strong>• 손익 및 수익성 확인</strong> — {currentCompany.corpName}의 DART 원천 계정 기준 매출액은 {officialMetricText("revenue")}, 영업이익은 {officialMetricText("operatingProfit")} (영업이익률 {officialMetricText("operatingMargin", "%")}), 순이익은 {officialMetricText("netIncome")}입니다.
              </div>
              <div className="pl-3 border-l-2 border-stone-800">
                <strong>• 운전자본 및 차입 구조</strong> — 원천 계정으로 계산한 운전자본은 {officialMetricText("workingCapital")}, 총차입금은 {officialMetricText("borrowings")}, 차입금의존도는 {officialMetricText("borrowingsRatio", "%")}, 부채비율은 {officialMetricText("debtRatio", "%")}입니다.
                <div className="text-stone-600 mt-1">
                  운전자본 산식 근거: {currentCompany.serverMetrics?.workingCapital?.lines?.join(" · ") || "필요한 실제 원천 계정을 모두 확인하지 못했습니다."}
                </div>
                <div className="text-stone-600 mt-0.5">
                  차입금 산식 근거: {currentCompany.serverMetrics?.borrowings?.lines?.join(" · ") || "필수 차입금 구성 계정을 모두 확인하지 못했습니다."}
                </div>
                <div className="text-stone-600 mt-0.5">
                  증감 원인은 공시 문장으로 직접 확인할 때만 설명하며, 원인이 명시되지 않으면 공시로 특정되지 않는다고 표시합니다. 기준 접수번호 #{currentCompany.rceptNo}.
                </div>
              </div>
            </div>
          </div>
        )}
        {showFilingAlertPopup && filingAlerts.length > 0 && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"><div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">새로운 DART 공시가 등록됐습니다</h2><p className="mt-1 text-xs text-slate-500">등록한 기업의 신규 접수번호를 확인했습니다.</p></div><button type="button" onClick={() => setShowFilingAlertPopup(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{filingAlerts.slice(0, 10).map((item) => <a key={item.rceptNo} onClick={() => setReadFilingAlertIds((previous) => new Set([...previous, item.rceptNo]))} href={item.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-200 p-3 hover:bg-emerald-50"><div className="text-xs text-slate-500">{item.company} · {item.receiptDate}</div><div className="mt-1 text-sm font-bold text-slate-900">{item.reportName}</div><div className="mt-1 text-[11px] text-emerald-700">DART 공시 열기 ↗</div></a>)}</div><div className="mt-4 flex justify-end"><button type="button" onClick={() => { markFilingAlertsRead(); setShowFilingAlertPopup(false); }} className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-bold text-white">확인</button></div></div></div>}
      </main>
      

    </div>
  );
}
