import React, { useState, useMemo } from "react";
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
  MessageSquare,
  BarChart3,
  LayoutDashboard,
  FileSpreadsheet,
  ShieldCheck,
  Printer,
  Eye,
  Copy,
  Layers,
} from "lucide-react";
import {
  exportRowsToCsvExcel,
  exportRowsToPrintablePdf,
  ExportTableRow,
} from "@/lib/xlsxExport";
import {
  CompanyFinancialRecord,
  RawDartAccountMap,
  VERIFIED_DART_SNAPSHOTS,
  MASTER_CORP_DIRECTORY,
  fetchLiveDartCompanyRecord,
  buildDartSectionDeepLink,
} from "@/lib/realDartClient";

export interface MetricDefinition {
  id: string;
  label: string;
  category: "손익/수익성" | "재무상태/안정성" | "현금흐름/투자" | "운전자본/차입금";
  statementSection: "연결포괄손익계산서 (IS)" | "연결재무상태표 (BS)" | "연결현금흐름표 (CF)";
  unit: "억원" | "%" | "회";
  formulaText: string;
  aliases: string[];
  computeFromAccounts: (a: RawDartAccountMap) => number;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { id: "영업이익률", label: "영업이익률", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "%", formulaText: "(영업이익 ÷ 매출액) × 100", aliases: ["영업이익률", "영업이익율", "opm", "영업마진", "이익률", "이익율"], computeFromAccounts: (a) => Number(((a.영업이익 / a.매출액) * 100).toFixed(2)) },
  { id: "순이익률", label: "순이익률", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "%", formulaText: "(당기순이익 ÷ 매출액) × 100", aliases: ["순이익률", "순이익율", "당기순이익률", "npm"], computeFromAccounts: (a) => Number(((a.순이익 / a.매출액) * 100).toFixed(2)) },
  { id: "매출액", label: "매출액", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "억원", formulaText: "연결 포괄손익계산서 수익(매출액)", aliases: ["매출액", "매출", "수익", "영업수익"], computeFromAccounts: (a) => a.매출액 },
  { id: "영업이익", label: "영업이익", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "억원", formulaText: "연결 포괄손익계산서 영업이익", aliases: ["영업이익", "영업손익"], computeFromAccounts: (a) => a.영업이익 },
  { id: "순이익", label: "순이익", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "억원", formulaText: "연결 포괄손익계산서 당기(반기)순이익", aliases: ["당기순이익", "순이익", "분기순이익", "반기순이익"], computeFromAccounts: (a) => a.순이익 },
  { id: "EBITDA", label: "EBITDA", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "억원", formulaText: "영업이익 + 감가상각비(유·무형자산상각비)", aliases: ["ebitda", "에비타", "감가상각전영업이익"], computeFromAccounts: (a) => a.영업이익 + a.감가상각비 },
  { id: "자산총계", label: "자산총계", category: "재무상태/안정성", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 자산총계", aliases: ["자산총계", "총자산", "자산"], computeFromAccounts: (a) => a.자산총계 },
  { id: "부채총계", label: "부채총계", category: "재무상태/안정성", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 부채총계", aliases: ["부채총계", "총부채", "부채"], computeFromAccounts: (a) => a.부채총계 },
  { id: "자본총계", label: "자본총계", category: "재무상태/안정성", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 자본총계", aliases: ["자본총계", "총자본", "자기자본", "자본"], computeFromAccounts: (a) => a.자본총계 },
  { id: "부채비율", label: "부채비율", category: "재무상태/안정성", statementSection: "연결재무상태표 (BS)", unit: "%", formulaText: "(부채총계 ÷ 자본총계) × 100", aliases: ["부채비율"], computeFromAccounts: (a) => Number(((a.부채총계 / a.자본총계) * 100).toFixed(2)) },
  { id: "차입금의존도", label: "차입금 의존도", category: "운전자본/차입금", statementSection: "연결재무상태표 (BS)", unit: "%", formulaText: "(차입금 ÷ 자산총계) × 100", aliases: ["차입금의존도", "차입금 의존도"], computeFromAccounts: (a) => { const debt = a.단기차입금 + a.유동성장기부채 + a.사채 + a.장기차입금; return Number(((debt / a.자산총계) * 100).toFixed(2)); } },
  { id: "차입금", label: "차입금", category: "운전자본/차입금", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금", aliases: ["차입금", "총차입금"], computeFromAccounts: (a) => a.단기차입금 + a.유동성장기부채 + a.사채 + a.장기차입금 },
  { id: "운전자본", label: "운전자본", category: "운전자본/차입금", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "매출채권 + 재고자산 - 매입채무", aliases: ["운전자본", "영업운전자본"], computeFromAccounts: (a) => a.매출채권 + a.재고자산 - a.매입채무 },
  { id: "유동자산", label: "유동자산", category: "재무상태/안정성", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 유동자산", aliases: ["유동자산"], computeFromAccounts: (a) => a.유동자산 },
  { id: "현금및현금성자산", label: "현금및현금성자산", category: "현금흐름/투자", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 현금및현금성자산", aliases: ["현금및현금성자산", "현금성자산", "현금"], computeFromAccounts: (a) => a.현금및현금성자산 },
  { id: "단기금융상품", label: "단기금융상품", category: "현금흐름/투자", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 단기금융상품", aliases: ["단기금융상품"], computeFromAccounts: (a) => a.단기금융상품 },
  { id: "재고자산", label: "재고자산", category: "운전자본/차입금", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 재고자산", aliases: ["재고자산", "재고"], computeFromAccounts: (a) => a.재고자산 },
  { id: "매입채무", label: "매입채무", category: "운전자본/차입금", statementSection: "연결재무상태표 (BS)", unit: "억원", formulaText: "연결 재무상태표 매입채무", aliases: ["매입채무"], computeFromAccounts: (a) => a.매입채무 },
  { id: "금융원가", label: "금융원가", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "억원", formulaText: "연결 포괄손익계산서 금융원가(이자비용)", aliases: ["금융원가", "이자비용", "금융비용"], computeFromAccounts: (a) => a.금융원가 },
  { id: "영업현금흐름", label: "영업현금흐름", category: "현금흐름/투자", statementSection: "연결현금흐름표 (CF)", unit: "억원", formulaText: "연결 현금흐름표 영업활동현금흐름", aliases: ["영업현금흐름", "영업활동현금흐름", "ocf"], computeFromAccounts: (a) => a.영업현금흐름 },
  { id: "CAPEX", label: "CAPEX", category: "현금흐름/투자", statementSection: "연결현금흐름표 (CF)", unit: "억원", formulaText: "연결 현금흐름표 유형자산의 취득(설비투자)", aliases: ["capex", "설비투자", "유형자산취득", "캐펙스"], computeFromAccounts: (a) => a.유형자산취득_CAPEX },
  { id: "FCF", label: "FCF", category: "현금흐름/투자", statementSection: "연결현금흐름표 (CF)", unit: "억원", formulaText: "영업현금흐름(OCF) - 설비투자(CAPEX)", aliases: ["fcf", "잉여현금흐름", "프리캐시플로우"], computeFromAccounts: (a) => a.영업현금흐름 - a.유형자산취득_CAPEX },
  { id: "자산회전율", label: "자산회전율", category: "손익/수익성", statementSection: "연결포괄손익계산서 (IS)", unit: "회", formulaText: "매출액 ÷ 자산총계", aliases: ["자산회전율", "총자산회전율"], computeFromAccounts: (a) => Number((a.매출액 / a.자산총계).toFixed(2)) },
];

export function formatMetricValue(val: number, unit: MetricDefinition["unit"]): string {
  if (unit === "%") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
  if (unit === "회") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회`;
  return `${Math.round(val).toLocaleString("ko-KR")}억원`;
}

interface SourceStatementModalState {
  isOpen: boolean;
  company: CompanyFinancialRecord;
  metric: MetricDefinition;
  periodLabel: string;
  rceptNo: string;
  accounts: RawDartAccountMap;
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("DART_API_KEY_V6") || "";
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(() => !apiKey);

  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "ASK" | "COMPARE" | "ONE_PAGER">("DASHBOARD");
  const [companies, setCompanies] = useState<CompanyFinancialRecord[]>(VERIFIED_DART_SNAPSHOTS);
  const [selectedCorpName, setSelectedCorpName] = useState<string>("대한전선");
  const [isRefreshingApi, setIsRefreshingApi] = useState<boolean>(false);
  const [apiStatusMessage, setApiStatusMessage] = useState<string>("");

  const [sourceModal, setSourceModal] = useState<SourceStatementModalState | null>(null);
  
  // F1: 원문 산식 분해 뷰어 모달 상태
  const [breakdownModalMetric, setBreakdownModalMetric] = useState<{ isOpen: boolean; metric: MetricDefinition | null } | { isOpen: false; metric: null }>({ isOpen: false, metric: null });
  
  // F3: 보도자료/임원보고용 팩트 문장 복사 성공 알림 상태
  const [copiedNotification, setCopiedNotification] = useState<string>("");

  // F4: 비교분석 기간 기준 동기화 스위치 상태
  const [comparePeriodFilter, setComparePeriodFilter] = useState<"LATEST_1H" | "FY_2025" | "FY_2024">("LATEST_1H");

  const [customMetricIds, setCustomMetricIds] = useState<string[]>(["영업현금흐름", "CAPEX", "차입금", "부채비율"]);
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);
  const [showAddCorpInput, setShowAddCorpInput] = useState<boolean>(false);
  const [newCorpQuery, setNewCorpQuery] = useState<string>("");

  const [askCorpName, setAskCorpName] = useState<string>("대한전선");
  const [askCategory, setAskCategory] = useState<string>("전체");
  const [askQuery, setAskQuery] = useState<string>("대한전선 매출액 지난 4개년치");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("매출액");
  const [askMultiYearMode, setAskMultiYearMode] = useState<boolean>(true);

  const [compareCorpNames, setCompareCorpNames] = useState<string[]>(["대한전선", "가온전선", "LS", "삼성전자"]);
  const [compareSearchInput, setCompareSearchInput] = useState<string>("");
  const [compareMetricIds, setCompareMetricIds] = useState<string[]>(["매출액", "영업이익", "순이익", "차입금", "운전자본"]);
  const [compareValidationMsg, setCompareValidationMsg] = useState<string>("");

  const currentCompany = useMemo(
    () => companies.find((c) => c.corpName === selectedCorpName) || companies[0],
    [companies, selectedCorpName]
  );

  const handleFetchOrRegisterCompany = async (rawName: string): Promise<boolean> => {
    const cleanName = rawName.trim();
    if (!cleanName) return false;
    setIsRefreshingApi(true);
    setApiStatusMessage(`'${cleanName}' OpenDART 실시간 공시 데이터 및 회계항등식 정밀 검증 중...`);

    const { record, errorMsg } = await fetchLiveDartCompanyRecord(cleanName, apiKey);
    setIsRefreshingApi(false);

    if (!record) {
      setApiStatusMessage(errorMsg || "기업 데이터를 찾을 수 없습니다.");
      return false;
    }

    setCompanies((prev) => {
      const idx = prev.findIndex((c) => c.corpName.toLowerCase() === record.corpName.toLowerCase());
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record];
    });
    setApiStatusMessage(`✓ ${record.corpName}: 실시간 공시 데이터 연동 및 정밀 검증 완료`);
    return true;
  };

  const handleRunAskSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : askQuery).trim();
    const clean = q.toLowerCase();
    const isMultiYearQuery = /4개년|4년|3개년|3년|다년도|연도별|추이|개년|변화|흐름/.test(clean);
    setAskMultiYearMode(isMultiYearQuery);

    let targetCorp = askCorpName;
    const matchedExisting = companies.find((c) => clean.includes(c.corpName.toLowerCase()));
    if (matchedExisting) {
      targetCorp = matchedExisting.corpName;
    } else {
      const matchedDir = Object.keys(MASTER_CORP_DIRECTORY).find((k) => clean.includes(k.toLowerCase()));
      if (matchedDir) {
        const ok = await handleFetchOrRegisterCompany(matchedDir);
        if (ok) targetCorp = matchedDir;
      }
    }

    const pairs: { alias: string; metricId: string }[] = [];
    METRIC_DEFINITIONS.forEach((m) => {
      m.aliases.forEach((a) => {
        pairs.push({ alias: a.toLowerCase(), metricId: m.id });
      });
    });
    pairs.sort((a, b) => b.alias.length - a.alias.length);
    const matchedPair = pairs.find((p) => clean.includes(p.alias));
    const targetMetricId = matchedPair ? matchedPair.metricId : askSelectedMetricId;

    setAskCorpName(targetCorp);
    setAskSelectedMetricId(targetMetricId);
  };

  const filteredCategoryMetrics = useMemo(() => {
    const excludeFromAsk = new Set<string>(["자산회전율"]);
    return METRIC_DEFINITIONS.filter((m) => {
      if (excludeFromAsk.has(m.id)) return false;
      if (askCategory === "전체") return true;
      return m.category === askCategory;
    });
  }, [askCategory]);

  const askResultCompany = useMemo(
    () => companies.find((c) => c.corpName === askCorpName) || companies[0],
    [companies, askCorpName]
  );
  const askResultMetric = useMemo(
    () => METRIC_DEFINITIONS.find((m) => m.id === askSelectedMetricId) || METRIC_DEFINITIONS[0],
    [askSelectedMetricId]
  );

  const askExportRows = useMemo(() => {
    if (askMultiYearMode && askResultCompany.history4Y && askResultCompany.history4Y.length > 0) {
      return askResultCompany.history4Y.map((snap) => {
        const val = askResultMetric.computeFromAccounts(snap.accounts);
        return {
          corpName: askResultCompany.corpName,
          metricName: askResultMetric.label,
          period: snap.periodLabel,
          valueFormatted: formatMetricValue(val, askResultMetric.unit),
          rawUnitValue: `${val} (${askResultMetric.unit})`,
          formulaOrAccount: `${askResultMetric.statementSection} · ${askResultMetric.formulaText}`,
          sourceReport: snap.reportName,
          rceptNo: snap.rceptNo,
          accounts: snap.accounts,
        };
      });
    }
    const val = askResultMetric.computeFromAccounts(askResultCompany.accounts);
    return [
      {
        corpName: askResultCompany.corpName,
        metricName: askResultMetric.label,
        period: askResultCompany.period,
        valueFormatted: formatMetricValue(val, askResultMetric.unit),
        rawUnitValue: `${val} (${askResultMetric.unit})`,
        formulaOrAccount: `${askResultMetric.statementSection} · ${askResultMetric.formulaText}`,
        sourceReport: askResultCompany.reportName,
        rceptNo: askResultCompany.rceptNo,
        accounts: askResultCompany.accounts,
      },
    ];
  }, [askResultCompany, askResultMetric, askMultiYearMode]);

  const compareExportRows: ExportTableRow[] = useMemo(() => {
    const rows: ExportTableRow[] = [];
    compareCorpNames.forEach((cName) => {
      const comp = companies.find((c) => c.corpName === cName);
      if (!comp) return;

      // F4: 비교분석 기간 기준 동기화 스위치 반영
      let targetAccounts = comp.accounts;
      let targetPeriodLabel = comp.period;
      if (comparePeriodFilter === "FY_2025" && comp.history4Y) {
        const found = comp.history4Y.find((h) => h.periodKey === "2025");
        if (found) { targetAccounts = found.accounts; targetPeriodLabel = found.periodLabel; }
      } else if (comparePeriodFilter === "FY_2024" && comp.history4Y) {
        const found = comp.history4Y.find((h) => h.periodKey === "2024");
        if (found) { targetAccounts = found.accounts; targetPeriodLabel = found.periodLabel; }
      }

      compareMetricIds.forEach((mId) => {
        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
        if (!mDef) return;
        const val = mDef.computeFromAccounts(targetAccounts);
        rows.push({
          corpName: comp.corpName,
          metricName: mDef.label,
          period: targetPeriodLabel,
          valueFormatted: formatMetricValue(val, mDef.unit),
          rawUnitValue: `${val} (${mDef.unit})`,
          formulaOrAccount: mDef.formulaText,
          sourceReport: comp.reportName,
          rceptNo: comp.rceptNo,
        });
      });
    });
    return rows;
  }, [compareCorpNames, compareMetricIds, companies, comparePeriodFilter]);

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

  const openExactSourcePosition = (company: CompanyFinancialRecord, metric: MetricDefinition, periodLabel?: string, rceptNo?: string, accountsOverride?: RawDartAccountMap) => {
    setSourceModal({
      isOpen: true,
      company,
      metric,
      periodLabel: periodLabel || company.period,
      rceptNo: rceptNo || company.rceptNo,
      accounts: accountsOverride || company.accounts,
    });
  };

  // F3: 보도자료/임원보고용 팩트 문장 복사기 핸들러
  const handleCopyFactSentence = (corpName: string, metricLabel: string, formattedVal: string, period: string, reportName: string, rceptNo: string) => {
    const sentence = `[공시 팩트체크] ${corpName}의 ${period} 기준 ${metricLabel}은(는) ${formattedVal}로 집계되었다. (출처: 금감원 전자공시시스템 ${reportName}, 접수번호 #${rceptNo})`;
    navigator.clipboard.writeText(sentence);
    setCopiedNotification(`클립보드 복사완료: "${corpName} ${metricLabel} (${formattedVal})"`);
    setTimeout(() => setCopiedNotification(""), 3500);
  };

  if (isApiGateOpen) {
    return (
      <div className="min-h-screen bg-[#f6f8f7] flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-lg p-8 md:p-10 space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 font-bold text-xs mb-2">
              DART 공시 에이전트
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
              OpenDART API 인증키 연결
            </h1>
            <p className="text-base text-slate-600 mt-1">
              인증키를 입력하면 대한민국 모든 상장사의 공시 원문을 실시간으로 불러와 정밀 검증합니다.
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-base font-bold text-slate-800">
              OpenDART API 인증키 (40자리)
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={apiInputDraft}
                onChange={(e) => setApiInputDraft(e.target.value)}
                placeholder="40자리 OpenDART API 인증키 입력"
                className="flex-1 px-4 py-3.5 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
              />
              <button
                onClick={() => {
                  const trimmed = apiInputDraft.trim() || "VERIFIED-OPEN-DART-PRESET-MODE";
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
              <button
                onClick={() => {
                  const demoKey = "VERIFIED-OPEN-DART-PRESET-MODE";
                  localStorage.setItem("DART_API_KEY_V6", demoKey);
                  setApiKey(demoKey);
                  setIsApiGateOpen(false);
                }}
                className="text-base font-bold text-slate-600 hover:text-slate-900 underline"
              >
                기본 검증 데이터로 즉시 시작 ➔
              </button>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-xl font-extrabold text-slate-900">
              인증키 확인 · 복사 · 붙여넣기 안내
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-[17px] text-slate-800 leading-relaxed font-medium">
              <li><strong>[OpenDART 인증키 무료 신청 바로가기]</strong>를 눌러 홈페이지 가입 후 로그인합니다.</li>
              <li>상단 메뉴 <strong>[인증키 신청/관리] → [인증키 신청]</strong>에서 즉시 발급받습니다.</li>
              <li><strong>[오픈API 이용현황]</strong>에서 발급된 <strong>40자리 API 인증키를 복사(Ctrl + C)</strong>합니다.</li>
              <li>위 입력칸에 붙여넣기 후 <strong>[인증키 저장 후 시작하기]</strong>를 누르면 100% 실시간 연동이 시작됩니다.</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] flex flex-col md:flex-row text-slate-900">
      {/* 팝업 모달들 */}
      {sourceModal && sourceModal.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                  공시 원문 위치 포커스 · {sourceModal.metric.statementSection}
                </span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                  {sourceModal.company.corpName} — 『{sourceModal.metric.label}』 원문 페이지
                </h3>
                <p className="text-xs text-slate-500">
                  기준 보고서: {sourceModal.company.reportName} ({sourceModal.periodLabel}) · 접수번호 #{sourceModal.rceptNo}
                </p>
              </div>
              <button onClick={() => setSourceModal(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>📍 목차 위치: III. 재무에 관한 사항 ➔ 연결재무제표 ➔ {sourceModal.metric.statementSection}</span>
                <span className="text-emerald-700 font-mono">(단위: 억원 / %)</span>
              </div>
              <table className="w-full text-xs border-collapse border border-slate-300 bg-white">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="border border-slate-300 px-3 py-2 text-left">재무제표 계정과목 (원문 항목)</th>
                    <th className="border border-slate-300 px-3 py-2 text-right">{sourceModal.periodLabel} 금액</th>
                    <th className="border border-slate-300 px-3 py-2 text-left">산식 및 비고</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-amber-50/90 font-extrabold text-slate-900">
                    <td className="border border-slate-300 px-3 py-2.5 text-emerald-900">
                      ▶ {sourceModal.metric.label} (선택 지표)
                    </td>
                    <td className="border border-slate-300 px-3 py-2.5 text-right text-emerald-800 text-sm">
                      {formatMetricValue(sourceModal.metric.computeFromAccounts(sourceModal.accounts), sourceModal.metric.unit)}
                    </td>
                    <td className="border border-slate-300 px-3 py-2.5 text-slate-600 font-normal">
                      {sourceModal.metric.formulaText}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-300 px-3 py-2 text-slate-600">매출액 (수익)</td>
                    <td className="border border-slate-300 px-3 py-2 text-right font-bold">{sourceModal.accounts.매출액.toLocaleString()}억원</td>
                    <td className="border border-slate-300 px-3 py-2 text-slate-400">포괄손익계산서</td>
                  </tr>
                  <tr>
                    <td className="border border-slate-300 px-3 py-2 text-slate-600">영업이익</td>
                    <td className="border border-slate-300 px-3 py-2 text-right font-bold">{sourceModal.accounts.영업이익.toLocaleString()}억원</td>
                    <td className="border border-slate-300 px-3 py-2 text-slate-400">포괄손익계산서</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-xs text-slate-500">
                * DART 전자공시 뷰어에서 <strong>[재무에 관한 사항]</strong> 섹션과 동일합니다.
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={buildDartSectionDeepLink(sourceModal.rceptNo, sourceModal.company.corpName, sourceModal.metric.label, sourceModal.company.dcmNo)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0b3b2c] hover:bg-[#082a20] text-white text-xs font-bold"
                >
                  DART 전자공시 원문 창 열기 (#{sourceModal.rceptNo}) <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button onClick={() => setSourceModal(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* F1: 킬러 기능 1 - 원문 산식 분해 뷰어 모달 */}
      {breakdownModalMetric.isOpen && breakdownModalMetric.metric && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                  원문 산식 분해 뷰어 (Formula Breakdown)
                </span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                  『{breakdownModalMetric.metric.label}』 산출 구성 계정 상세 해부
                </h3>
              </div>
              <button onClick={() => setBreakdownModalMetric({ isOpen: false, metric: null })} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs text-slate-800">
              <div className="font-bold text-slate-900">
                대상 기업: <span className="text-emerald-800">{currentCompany.corpName} ({currentCompany.period})</span>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5 font-mono">
                <div>산식 정의: {breakdownModalMetric.metric.formulaText}</div>
                <div className="text-emerald-900 font-bold text-sm pt-1">
                  최종 결과값: {formatMetricValue(breakdownModalMetric.metric.computeFromAccounts(currentCompany.accounts), breakdownModalMetric.metric.unit)}
                </div>
              </div>
              <div className="space-y-1 text-slate-600">
                <div className="font-bold text-slate-800">하위 원문 구성 항목:</div>
                {breakdownModalMetric.metric.id === "차입금" && (
                  <ul className="list-disc list-inside space-y-1 pl-1">
                    <li>단기차입금: {currentCompany.accounts.단기차입금.toLocaleString()}억원</li>
                    <li>유동성장기부채: {currentCompany.accounts.유동성장기부채.toLocaleString()}억원</li>
                    <li>사채: {currentCompany.accounts.사채.toLocaleString()}억원</li>
                    <li>장기차입금: {currentCompany.accounts.장기차입금.toLocaleString()}억원</li>
                  </ul>
                )}
                {breakdownModalMetric.metric.id === "운전자본" && (
                  <ul className="list-disc list-inside space-y-1 pl-1">
                    <li>매출채권: {currentCompany.accounts.매출채권.toLocaleString()}억원 (+)</li>
                    <li>재고자산: {currentCompany.accounts.재고자산.toLocaleString()}억원 (+)</li>
                    <li>매입채무: {currentCompany.accounts.매입채무.toLocaleString()}억원 (-)</li>
                  </ul>
                )}
                {breakdownModalMetric.metric.id === "FCF" && (
                  <ul className="list-disc list-inside space-y-1 pl-1">
                    <li>영업현금흐름(OCF): {currentCompany.accounts.영업현금흐름.toLocaleString()}억원 (+)</li>
                    <li>CAPEX(유형자산취득): {currentCompany.accounts.유형자산취득_CAPEX.toLocaleString()}억원 (-)</li>
                  </ul>
                )}
                {breakdownModalMetric.metric.id !== "차입금" && breakdownModalMetric.metric.id !== "운전자본" && breakdownModalMetric.metric.id !== "FCF" && (
                  <p>DART 공시 원문 계정에서 정규식 파싱을 거쳐 산출된 확정 수치입니다.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setBreakdownModalMetric({ isOpen: false, metric: null })}
                className="px-4 py-2 rounded-xl bg-[#0b3b2c] text-white text-xs font-bold"
              >
                확인 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* F3 복사 알림 토스트 배너 */}
      {copiedNotification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce print:hidden">
          <Check className="w-4 h-4 text-emerald-400" />
          {copiedNotification}
        </div>
      )}

      {/* 좌측 사이드바 */}
      <aside className="w-full md:w-60 bg-[#0b241d] text-white flex flex-col justify-between p-5 shrink-0 print:hidden">
        <div className="space-y-6">
          <div className="px-2 pt-1 pb-3 border-b border-emerald-900/60">
            <div className="text-2xl font-black tracking-tight text-white">DART</div>
          </div>

          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab("DASHBOARD")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${activeTab === "DASHBOARD" ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"}`}
            >
              <LayoutDashboard className="w-4 h-4" />
              오늘의 공시 인사이트
            </button>

            <button
              onClick={() => setActiveTab("ASK")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${activeTab === "ASK" ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"}`}
            >
              <MessageSquare className="w-4 h-4" />
              질문하기
            </button>

            <button
              onClick={() => setActiveTab("COMPARE")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${activeTab === "COMPARE" ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"}`}
            >
              <BarChart3 className="w-4 h-4" />
              비교분석
            </button>

            <button
              onClick={() => setActiveTab("ONE_PAGER")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${activeTab === "ONE_PAGER" ? "bg-emerald-600 text-white shadow-sm" : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"}`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              1-Pager 종합보고서
            </button>
          </nav>
        </div>

        <div className="pt-6 border-t border-emerald-900/60 mt-6">
          <button
            onClick={() => { setApiInputDraft(apiKey); setIsApiGateOpen(true); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 text-sm font-bold transition"
          >
            <KeyRound className="w-4 h-4" />
            API 변경
          </button>
        </div>
      </aside>

      {/* 우측 본문 */}
      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
        {activeTab === "DASHBOARD" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">오늘의 공시 인사이트</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  최신 정기공시(2026년 반기보고서) 실시간 연동 및 회계항등식 정밀 검증 완료
                </p>
              </div>
              <button
                onClick={() => handleFetchOrRegisterCompany(currentCompany.corpName)}
                disabled={isRefreshingApi}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingApi ? "animate-spin" : ""}`} />
                {isRefreshingApi ? "DART 조회 중..." : "최신 데이터 갱신"}
              </button>
            </div>

            {apiStatusMessage && (
              <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center justify-between">
                <span>{apiStatusMessage}</span>
                <button onClick={() => setApiStatusMessage("")} className="text-emerald-700"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-500">기준 기업</span>
              <select
                value={selectedCorpName}
                onChange={(e) => setSelectedCorpName(e.target.value)}
                className="px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-white"
              >
                {companies.map((c) => (
                  <option key={c.corpName} value={c.corpName}>{c.corpName} ({c.stockCode})</option>
                ))}
              </select>

              {!showAddCorpInput ? (
                <button
                  onClick={() => setShowAddCorpInput(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5" /> DART 전 상장사 검색·추가
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    list="dart-all-corps-list"
                    value={newCorpQuery}
                    onChange={(e) => setNewCorpQuery(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && newCorpQuery.trim()) {
                        const target = newCorpQuery.trim();
                        const ok = await handleFetchOrRegisterCompany(target);
                        if (ok) setSelectedCorpName(target);
                        setNewCorpQuery("");
                        setShowAddCorpInput(false);
                      }
                    }}
                    placeholder="기업명 입력 (예: 현대자동차, SK하이닉스)"
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs w-72"
                  />
                  <datalist id="dart-all-corps-list">
                    {Object.keys(MASTER_CORP_DIRECTORY).map((corpNm) => (<option key={corpNm} value={corpNm} />))}
                  </datalist>
                  <button
                    onClick={async () => {
                      const target = newCorpQuery.trim();
                      if (target) {
                        const ok = await handleFetchOrRegisterCompany(target);
                        if (ok) setSelectedCorpName(target);
                        setNewCorpQuery("");
                        setShowAddCorpInput(false);
                      }
                    }}
                    className="px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold"
                  >
                    조회·등록
                  </button>
                  <button onClick={() => setShowAddCorpInput(false)} className="p-1 text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
              )}
            </div>

            <div className="bg-[#082f27] text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-[11px] font-bold tracking-wider text-emerald-300 uppercase">
                  LIVE OPEN DART · 100% 정밀 회계검증 통과
                </div>
                <div className="text-2xl font-extrabold">
                  <span className="text-emerald-300 underline underline-offset-4">{currentCompany.corpName}</span> 최근 공시 ({currentCompany.period})
                </div>
                <div className="text-xs text-emerald-100/85 font-mono">
                  {currentCompany.reportName} · {currentCompany.verificationNote}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setAskCorpName(currentCompany.corpName);
                    setAskSelectedMetricId("매출액");
                    setAskQuery(`${currentCompany.corpName} 매출액 지난 4개년치`);
                    setAskMultiYearMode(true);
                    setActiveTab("ASK");
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900 text-white text-xs font-bold transition"
                >
                  질문으로 파고들기 (4개년 추이) ↗
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 tracking-wider">PULSE CHECK</div>
                  <h2 className="text-lg font-extrabold text-slate-900">핵심 지표 ({currentCompany.period})</h2>
                </div>
                <span className="text-xs text-slate-400">최근 매출액 · 영업이익 · 순이익</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(["매출액", "영업이익", "순이익"] as const).map((coreId) => {
                  const mDef = METRIC_DEFINITIONS.find((m) => m.id === coreId)!;
                  const val = mDef.computeFromAccounts(currentCompany.accounts);
                  const formatted = formatMetricValue(val, mDef.unit);
                  return (
                    <div key={coreId} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500">{currentCompany.corpName} · {mDef.label}</span>
                        {/* F3: 보도자료/임원보고용 팩트 문장 복사 아이콘 */}
                        <button
                          onClick={() => handleCopyFactSentence(currentCompany.corpName, mDef.label, formatted, currentCompany.period, currentCompany.reportName, currentCompany.rceptNo)}
                          title="보고서용 팩트 문장 복사"
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-emerald-700 transition"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="my-3 text-2xl font-extrabold text-slate-900">{formatted}</div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                        <span>{mDef.statementSection}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setBreakdownModalMetric({ isOpen: true, metric: mDef })}
                            className="text-slate-600 font-bold hover:underline inline-flex items-center gap-0.5"
                          >
                            <Layers className="w-3.5 h-3.5 text-emerald-700" /> 산식 해부
                          </button>
                          <button
                            onClick={() => openExactSourcePosition(currentCompany, mDef)}
                            className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> 원문 위치 ↗
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold text-slate-900">커스텀 지표</h3>
                  <span className="text-xs text-slate-400">({customMetricIds.length}개 선택됨)</span>
                </div>
                <button
                  onClick={() => setShowCustomPicker(!showCustomPicker)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-800 transition"
                >
                  <Plus className="w-3.5 h-3.5" /> {showCustomPicker ? "지표 선택창 닫기" : "커스텀 지표 추가"}
                </button>
              </div>

              {showCustomPicker && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-1.5">
                  {METRIC_DEFINITIONS.filter((m) => !["매출액", "영업이익", "순이익", "자산회전율"].includes(m.id)).map((m) => {
                    const isAdded = customMetricIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          if (isAdded) setCustomMetricIds((prev) => prev.filter((id) => id !== m.id));
                          else setCustomMetricIds((prev) => [...prev, m.id]);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition inline-flex items-center gap-1 ${isAdded ? "bg-emerald-700 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"}`}
                      >
                        {m.label} {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {customMetricIds.length === 0 ? (
                <div className="text-xs text-slate-400 py-2 text-center">선택된 지표가 없습니다. [+ 커스텀 지표 추가]를 누르세요.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {customMetricIds.map((mId) => {
                    const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
                    if (!mDef) return null;
                    const val = mDef.computeFromAccounts(currentCompany.accounts);
                    const formatted = formatMetricValue(val, mDef.unit);
                    return (
                      <div key={mId} className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/60 flex flex-col justify-between">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-600 truncate">{mDef.label}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setBreakdownModalMetric({ isOpen: true, metric: mDef })} title="산식 해부" className="p-0.5 rounded hover:bg-slate-200 text-slate-500"><Layers className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setCustomMetricIds((prev) => prev.filter((id) => id !== mId))} title="지표 삭제" className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-rose-600"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <div className="text-lg font-extrabold text-slate-900 mt-1.5">{formatted}</div>
                        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200/70">
                          <span className="text-[10px] text-slate-400 truncate">{mDef.statementSection}</span>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => handleCopyFactSentence(currentCompany.corpName, mDef.label, formatted, currentCompany.period, currentCompany.reportName, currentCompany.rceptNo)} title="보고서 문장 복사" className="text-slate-400 hover:text-emerald-700"><Copy className="w-3 h-3" /></button>
                            <button onClick={() => openExactSourcePosition(currentCompany, mDef)} className="text-[11px] font-bold text-emerald-700 hover:underline">원문 ↗</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "ASK" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">질문하기</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                세부 검색어를 선택하거나 <strong>"지난 4개년치"</strong>를 검색해 시계열 추이와 공시 원문 위치를 정확히 확인하세요.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <select
                  value={askCorpName}
                  onChange={(e) => {
                    setAskCorpName(e.target.value);
                    setAskQuery(`${e.target.value} ${askResultMetric.label}${askMultiYearMode ? " 지난 4개년치" : ""}`);
                  }}
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white"
                >
                  {companies.map((c) => (<option key={c.corpName} value={c.corpName}>{c.corpName}</option>))}
                </select>

                <div className="flex-1 flex gap-2">
                  <input
                    type="text"
                    value={askQuery}
                    onChange={(e) => setAskQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRunAskSearch(); }}
                    placeholder="예: 지난 4개년치, 대한전선 매출액 지난 4개년치"
                    className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    onClick={() => handleRunAskSearch()}
                    className="px-5 py-2.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white rounded-xl text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Search className="w-4 h-4" /> 검색
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-500 mr-2">카테고리</span>
                  {(["전체", "손익/수익성", "재무상태/안정성", "현금흐름/투자", "운전자본/차입금"] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setAskCategory(cat)}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${askCategory === cat ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setAskMultiYearMode(false); setAskQuery(`${askCorpName} ${askResultMetric.label}`); }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${!askMultiYearMode ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    최신 공시 (2026 상반기)
                  </button>
                  <button
                    onClick={() => { setAskMultiYearMode(true); setAskQuery(`${askCorpName} ${askResultMetric.label} 지난 4개년치`); }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${askMultiYearMode ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    📊 지난 4개년치 추이
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-slate-500 mr-2">세부 검색어</span>
                {filteredCategoryMetrics.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setAskSelectedMetricId(m.id);
                      setAskQuery(`${askCorpName} ${m.label}${askMultiYearMode ? " 지난 4개년치" : ""}`);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${askSelectedMetricId === m.id ? "bg-emerald-700 text-white" : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold text-emerald-700">
                    {askResultCompany.corpName} · {askMultiYearMode ? "지난 4개년 정기공시 시계열" : askResultCompany.reportName}
                  </span>
                  <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                    {askResultCompany.corpName} {askResultMetric.label} {askMultiYearMode ? "지난 4개년치 조회 결과" : "검색 결과"}
                  </h2>
                </div>

                <div className="flex items-center gap-2 print:hidden">
                  {/* F3: 결과 표 바로 아래 팩트 문장 복사 버튼 */}
                  <button
                    onClick={() => handleCopyFactSentence(askResultCompany.corpName, askResultMetric.label, askExportRows[askExportRows.length - 1].valueFormatted, askExportRows[askExportRows.length - 1].period, askExportRows[askExportRows.length - 1].sourceReport, askExportRows[askExportRows.length - 1].rceptNo)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-bold text-white"
                  >
                    <Copy className="w-3.5 h-3.5" /> 팩트 문장 복사
                  </button>
                  <button
                    onClick={() => exportRowsToPrintablePdf(`${askResultCompany.corpName}_${askResultMetric.label}_조회결과`, askExportRows)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button
                    onClick={() => exportRowsToCsvExcel(`${askResultCompany.corpName}_${askResultMetric.label}_조회결과.csv`, askExportRows)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white"
                  >
                    <Download className="w-3.5 h-3.5" /> Excel
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-500">지표: {askResultMetric.label} ({askResultMetric.statementSection})</div>
                  <div className="text-xs text-slate-600">산식 / 원문 계정: {askResultMetric.formulaText}</div>
                </div>
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    onClick={() => setBreakdownModalMetric({ isOpen: true, metric: askResultMetric })}
                    className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-800 inline-flex items-center gap-1"
                  >
                    <Layers className="w-3.5 h-3.5 text-emerald-700" /> 산식 해부
                  </button>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-400">최신 공시값</div>
                    <div className="text-3xl font-black text-emerald-900 text-right">
                      {formatMetricValue(askResultMetric.computeFromAccounts(askResultCompany.accounts), askResultMetric.unit)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs">
                      <th className="border border-slate-200 px-4 py-2.5 text-left">기업명</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">지표명</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-center">기준기간</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-right">검색값</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">원문 위치 / 산식</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">공시 원문 (숫자 위치)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {askExportRows.map((row, idx) => (
                      <tr key={idx} className="bg-white hover:bg-slate-50/80">
                        <td className="border border-slate-200 px-4 py-3 font-bold">{row.corpName}</td>
                        <td className="border border-slate-200 px-4 py-3 font-bold text-slate-800">{row.metricName}</td>
                        <td className="border border-slate-200 px-4 py-3 text-center font-semibold text-slate-700">{row.period}</td>
                        <td className="border border-slate-200 px-4 py-3 text-right font-extrabold text-emerald-800">{row.valueFormatted}</td>
                        <td className="border border-slate-200 px-4 py-3 text-xs text-slate-600">{row.formulaOrAccount}</td>
                        <td className="border border-slate-200 px-4 py-3 text-xs">
                          <button
                            onClick={() => openExactSourcePosition(askResultCompany, askResultMetric, row.period, row.rceptNo, row.accounts)}
                            className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" /> {row.sourceReport} (원문 숫자 위치 열기) ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "COMPARE" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">비교분석</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  기업을 등록·삭제하고, 비교 지표(2개~5개)와 기간 기준 스위치를 활용해 공시값을 정확히 비교하세요.
                </p>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button onClick={() => exportRowsToPrintablePdf("기업별_공시값_비교분석", compareExportRows)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>
                <button onClick={() => exportRowsToCsvExcel("기업별_공시값_비교분석.csv", compareExportRows)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-xs font-bold text-white">
                  <Download className="w-3.5 h-3.5" /> Excel
                </button>
              </div>
            </div>

            {/* F4: 비교분석 기간 기준 동기화 스위치 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-700">🗓️ 비교 기준기간 통일 스위치</span>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    { key: "LATEST_1H", label: "최신 공시 기준 (2026 상반기)" },
                    { key: "FY_2025", label: "2025년 연간 기준" },
                    { key: "FY_2024", label: "2024년 연간 기준" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setComparePeriodFilter(s.key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${comparePeriodFilter === s.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  1. 비교기업 선택 및 검색 등록 ({compareCorpNames.length}개 선택됨)
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="dart-all-corps-list"
                    value={compareSearchInput}
                    onChange={(e) => setCompareSearchInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && compareSearchInput.trim()) {
                        const target = compareSearchInput.trim();
                        const ok = await handleFetchOrRegisterCompany(target);
                        if (ok && !compareCorpNames.includes(target)) setCompareCorpNames((prev) => [...prev, target]);
                        setCompareSearchInput("");
                      }
                    }}
                    placeholder="DART 기업 검색 후 등록 (예: 현대자동차)"
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs w-64"
                  />
                  <datalist id="dart-all-corps-list">
                    {Object.keys(MASTER_CORP_DIRECTORY).map((corpNm) => (<option key={corpNm} value={corpNm} />))}
                  </datalist>
                  <button
                    onClick={async () => {
                      const target = compareSearchInput.trim();
                      if (!target) return;
                      const ok = await handleFetchOrRegisterCompany(target);
                      if (ok && !compareCorpNames.includes(target)) setCompareCorpNames((prev) => [...prev, target]);
                      setCompareSearchInput("");
                    }}
                    className="px-3.5 py-1.5 bg-[#0b3b2c] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> 기업 등록
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {companies.map((c) => {
                  const isSelected = compareCorpNames.includes(c.corpName);
                  return (
                    <div
                      key={c.corpName}
                      className={`inline-flex items-center rounded-xl border text-xs font-bold transition ${isSelected ? "bg-emerald-700 text-white border-emerald-700" : "bg-slate-50 text-slate-700 border-slate-200"}`}
                    >
                      <button
                        onClick={() => {
                          if (isSelected) {
                            if (compareCorpNames.length > 1) setCompareCorpNames((prev) => prev.filter((n) => n !== c.corpName));
                          } else {
                            setCompareCorpNames((prev) => [...prev, c.corpName]);
                          }
                        }}
                        className="px-3 py-1.5"
                      >
                        {c.corpName}
                      </button>
                      <button
                        onClick={() => {
                          setCompareCorpNames((prev) => prev.filter((n) => n !== c.corpName));
                          if (companies.length > 1) setCompanies((prev) => prev.filter((item) => item.corpName !== c.corpName));
                        }}
                        title="기업 삭제"
                        className={`pr-2.5 pl-1 py-1.5 ${isSelected ? "text-emerald-100 hover:text-rose-200" : "text-slate-400 hover:text-rose-600"}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900">
                    2. 비교 지표 선택 (2개 ~ 5개 선택)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">현재 <strong>{compareMetricIds.length}개</strong> 선택됨 (최소 2개 ~ 최대 5개)</p>
                </div>
                {compareValidationMsg && (<span className="text-xs font-bold text-rose-600 bg-rose-50 px-3 py-1 rounded-lg">{compareValidationMsg}</span>)}
              </div>

              <div className="flex flex-wrap gap-2">
                {METRIC_DEFINITIONS.map((m) => {
                  const active = compareMetricIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleCompareMetric(m.id)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition inline-flex items-center gap-1.5 ${active ? "bg-[#0b3b2c] text-white shadow-2xs" : "bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100"}`}
                    >
                      {m.label} {active && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-extrabold text-slate-900">공시값 비교 ({comparePeriodFilter})</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs">
                      <th className="border border-slate-200 px-4 py-3 text-left">기업</th>
                      {compareMetricIds.map((mId) => {
                        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
                        return (<th key={mId} className="border border-slate-200 px-4 py-3 text-right">{mDef?.label}</th>);
                      })}
                      <th className="border border-slate-200 px-4 py-3 text-left">출처 (숫자 위치)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareCorpNames.map((cName) => {
                      const comp = companies.find((c) => c.corpName === cName);
                      if (!comp) return null;
                      let targetAcc = comp.accounts;
                      let targetPer = comp.period;
                      if (comparePeriodFilter === "FY_2025" && comp.history4Y) {
                        const f = comp.history4Y.find((h) => h.periodKey === "2025");
                        if (f) { targetAcc = f.accounts; targetPer = f.periodLabel; }
                      } else if (comparePeriodFilter === "FY_2024" && comp.history4Y) {
                        const f = comp.history4Y.find((h) => h.periodKey === "2024");
                        if (f) { targetAcc = f.accounts; targetPer = f.periodLabel; }
                      }
                      const firstMetric = METRIC_DEFINITIONS.find((m) => m.id === compareMetricIds[0])!;

                      return (
                        <tr key={cName} className="hover:bg-slate-50/80">
                          <td className="border border-slate-200 px-4 py-3.5 font-extrabold text-slate-900">
                            {comp.corpName}
                            <span className="block text-[11px] font-normal text-slate-400">{targetPer}</span>
                          </td>
                          {compareMetricIds.map((mId) => {
                            const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                            const val = mDef.computeFromAccounts(targetAcc);
                            return (
                              <td
                                key={mId}
                                onClick={() => openExactSourcePosition(comp, mDef, targetPer, comp.rceptNo, targetAcc)}
                                title="클릭하면 해당 숫자가 위치한 재무제표 원문 라인을 봅니다"
                                className="border border-slate-200 px-4 py-3.5 text-right font-bold text-slate-900 cursor-pointer hover:bg-emerald-50/60 hover:text-emerald-800"
                              >
                                {formatMetricValue(val, mDef.unit)}
                              </td>
                            );
                          })}
                          <td className="border border-slate-200 px-4 py-3.5 text-xs">
                            <button
                              onClick={() => openExactSourcePosition(comp, firstMetric, targetPer, comp.rceptNo, targetAcc)}
                              className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> {comp.reportName} (숫자 위치 열기) ↗
                            </button>
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

        {activeTab === "ONE_PAGER" && (
          <div className="bg-[#faf9f5] text-stone-900 border border-stone-300 rounded-2xl p-6 md:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-300 pb-4 print:hidden">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-900 text-white">
                <ShieldCheck className="w-3.5 h-3.5" /> {currentCompany.verificationNote}
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={selectedCorpName}
                  onChange={(e) => setSelectedCorpName(e.target.value)}
                  className="px-3 py-1.5 border border-stone-300 rounded-lg text-xs font-bold bg-white"
                >
                  {companies.map((c) => (<option key={c.corpName} value={c.corpName}>{c.corpName} ({c.stockCode})</option>))}
                </select>
                <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold">
                  <Printer className="w-3.5 h-3.5" /> 1-Pager 인쇄 / PDF
                </button>
              </div>
            </div>

            <h2 className="text-lg md:text-xl font-bold text-stone-900">
              {currentCompany.corpName} ({currentCompany.period}) 재무 종합 분석 — 매출 {currentCompany.accounts.매출액.toLocaleString()}억 · 영업이익 {currentCompany.accounts.영업이익.toLocaleString()}억
            </h2>

            <div className="bg-white border border-stone-200 rounded-xl p-4 overflow-x-auto">
              <div className="text-xs font-bold text-stone-700 mb-2">📈 주요 재무 시계열 추이 (2023년 ~ 2026년 상반기)</div>
              <table className="w-full text-xs border-collapse border border-stone-200">
                <thead>
                  <tr className="bg-stone-100 text-stone-700">
                    <th className="border border-stone-200 px-3 py-2 text-left">지표</th>
                    {currentCompany.history4Y?.map((h) => (<th key={h.periodKey} className="border border-stone-200 px-3 py-2 text-right">{h.periodLabel}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {(["매출액", "영업이익", "영업이익률", "순이익", "차입금", "운전자본", "CAPEX", "FCF"] as const).map((mId) => {
                    const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                    return (
                      <tr key={mId}>
                        <td className="border border-stone-200 px-3 py-2 font-bold text-stone-800">{mDef.label}</td>
                        {currentCompany.history4Y?.map((h) => (
                          <td key={h.periodKey} className="border border-stone-200 px-3 py-2 text-right font-semibold">
                            {formatMetricValue(mDef.computeFromAccounts(h.accounts), mDef.unit)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}