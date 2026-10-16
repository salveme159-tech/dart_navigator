import React, { useState, useMemo, useEffect } from "react";
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
  CorpCodeEntry,
  loadAllDartCorpCodes,
  fetchLiveDartCompanyRecord,
  buildDartDirectUrl,
} from "@/lib/realDartClient";

export interface MetricDefinition {
  id: string;
  label: string;
  category: "손익/수익성" | "재무상태/안정성" | "현금흐름/투자" | "운전자본/차입금";
  statementSection: "포괄손익계산서" | "재무상태표" | "현금흐름표";
  unit: "억원" | "%" | "회";
  formulaText: string;
  aliases: string[];
  computeFromAccounts: (a: RawDartAccountMap) => number | null;
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "영업이익률",
    label: "영업이익률",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "%",
    formulaText: "(영업이익 ÷ 매출액) × 100",
    aliases: ["영업이익률", "영업이익율", "opm", "영업마진", "이익률", "이익율"],
    computeFromAccounts: (a) =>
      a.영업이익 !== null && a.매출액 !== null && a.매출액 !== 0
        ? Number(((a.영업이익 / a.매출액) * 100).toFixed(2))
        : null,
  },
  {
    id: "순이익률",
    label: "순이익률",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "%",
    formulaText: "(당기순이익 ÷ 매출액) × 100",
    aliases: ["순이익률", "순이익율", "당기순이익률", "npm"],
    computeFromAccounts: (a) =>
      a.순이익 !== null && a.매출액 !== null && a.매출액 !== 0
        ? Number(((a.순이익 / a.매출액) * 100).toFixed(2))
        : null,
  },
  {
    id: "매출액",
    label: "매출액",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "억원",
    formulaText: "포괄손익계산서 수익(매출액)",
    aliases: ["매출액", "매출", "수익", "영업수익"],
    computeFromAccounts: (a) => a.매출액,
  },
  {
    id: "영업이익",
    label: "영업이익",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "억원",
    formulaText: "포괄손익계산서 영업이익(손실)",
    aliases: ["영업이익", "영업손익"],
    computeFromAccounts: (a) => a.영업이익,
  },
  {
    id: "순이익",
    label: "순이익",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "억원",
    formulaText: "포괄손익계산서 당기(반기/분기)순이익",
    aliases: ["당기순이익", "순이익", "분기순이익", "반기순이익"],
    computeFromAccounts: (a) => a.순이익,
  },
  {
    id: "EBITDA",
    label: "EBITDA",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "억원",
    formulaText: "영업이익 + 감가상각비",
    aliases: ["ebitda", "에비타", "감가상각전영업이익"],
    computeFromAccounts: (a) =>
      a.영업이익 !== null && a.감가상각비 !== null ? Number((a.영업이익 + a.감가상각비).toFixed(1)) : a.영업이익,
  },
  {
    id: "자산총계",
    label: "자산총계",
    category: "재무상태/안정성",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 자산총계",
    aliases: ["자산총계", "총자산", "자산"],
    computeFromAccounts: (a) => a.자산총계,
  },
  {
    id: "부채총계",
    label: "부채총계",
    category: "재무상태/안정성",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 부채총계",
    aliases: ["부채총계", "총부채", "부채"],
    computeFromAccounts: (a) => a.부채총계,
  },
  {
    id: "자본총계",
    label: "자본총계",
    category: "재무상태/안정성",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 자본총계",
    aliases: ["자본총계", "총자본", "자기자본", "자본"],
    computeFromAccounts: (a) => a.자본총계,
  },
  {
    id: "부채비율",
    label: "부채비율",
    category: "재무상태/안정성",
    statementSection: "재무상태표",
    unit: "%",
    formulaText: "(부채총계 ÷ 자본총계) × 100",
    aliases: ["부채비율"],
    computeFromAccounts: (a) =>
      a.부채총계 !== null && a.자본총계 !== null && a.자본총계 !== 0
        ? Number(((a.부채총계 / a.자본총계) * 100).toFixed(2))
        : null,
  },
  {
    id: "차입금",
    label: "차입금",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금",
    aliases: ["차입금", "총차입금"],
    computeFromAccounts: (a) => {
      const sum =
        (a.단기차입금 || 0) +
        (a.유동성장기부채 || 0) +
        (a.사채 || 0) +
        (a.장기차입금 || 0);
      return Number(sum.toFixed(1));
    },
  },
  {
    id: "차입금의존도",
    label: "차입금 의존도",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "%",
    formulaText: "(차입금 ÷ 자산총계) × 100",
    aliases: ["차입금의존도", "차입금 의존도"],
    computeFromAccounts: (a) => {
      if (!a.자산총계) return null;
      const debt =
        (a.단기차입금 || 0) +
        (a.유동성장기부채 || 0) +
        (a.사채 || 0) +
        (a.장기차입금 || 0);
      return Number(((debt / a.자산총계) * 100).toFixed(2));
    },
  },
  {
    id: "운전자본",
    label: "운전자본",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "매출채권 + 재고자산 - 매입채무",
    aliases: ["운전자본", "영업운전자본"],
    computeFromAccounts: (a) =>
      Number(((a.매출채권 || 0) + (a.재고자산 || 0) - (a.매입채무 || 0)).toFixed(1)),
  },
  {
    id: "유동자산",
    label: "유동자산",
    category: "재무상태/안정성",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 유동자산",
    aliases: ["유동자산"],
    computeFromAccounts: (a) => a.유동자산,
  },
  {
    id: "현금및현금성자산",
    label: "현금및현금성자산",
    category: "현금흐름/투자",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 현금및현금성자산",
    aliases: ["현금및현금성자산", "현금성자산", "현금"],
    computeFromAccounts: (a) => a.현금및현금성자산,
  },
  {
    id: "단기금융상품",
    label: "단기금융상품",
    category: "현금흐름/투자",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 단기금융상품",
    aliases: ["단기금융상품"],
    computeFromAccounts: (a) => a.단기금융상품,
  },
  {
    id: "재고자산",
    label: "재고자산",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 재고자산",
    aliases: ["재고자산", "재고"],
    computeFromAccounts: (a) => a.재고자산,
  },
  {
    id: "매입채무",
    label: "매입채무",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "억원",
    formulaText: "재무상태표 매입채무",
    aliases: ["매입채무"],
    computeFromAccounts: (a) => a.매입채무,
  },
  {
    id: "금융원가",
    label: "금융원가",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "억원",
    formulaText: "포괄손익계산서 금융원가(이자비용)",
    aliases: ["금융원가", "이자비용", "금융비용"],
    computeFromAccounts: (a) => a.금융원가,
  },
  {
    id: "영업현금흐름",
    label: "영업현금흐름",
    category: "현금흐름/투자",
    statementSection: "현금흐름표",
    unit: "억원",
    formulaText: "현금흐름표 영업활동현금흐름",
    aliases: ["영업현금흐름", "영업활동현금흐름", "ocf"],
    computeFromAccounts: (a) => a.영업현금흐름,
  },
  {
    id: "CAPEX",
    label: "CAPEX",
    category: "현금흐름/투자",
    statementSection: "현금흐름표",
    unit: "억원",
    formulaText: "현금흐름표 유형자산의 취득",
    aliases: ["capex", "설비투자", "유형자산취득", "캐펙스"],
    computeFromAccounts: (a) => a.유형자산취득_CAPEX,
  },
  {
    id: "FCF",
    label: "FCF",
    category: "현금흐름/투자",
    statementSection: "현금흐름표",
    unit: "억원",
    formulaText: "영업현금흐름(OCF) - CAPEX",
    aliases: ["fcf", "잉여현금흐름", "프리캐시플로우"],
    computeFromAccounts: (a) =>
      a.영업현금흐름 !== null && a.유형자산취득_CAPEX !== null
        ? Number((a.영업현금흐름 - a.유형자산취득_CAPEX).toFixed(1))
        : null,
  },
  {
    id: "자산회전율",
    label: "자산회전율",
    category: "손익/수익성",
    statementSection: "포괄손익계산서",
    unit: "회",
    formulaText: "매출액 ÷ 자산총계",
    aliases: ["자산회전율", "총자산회전율"],
    computeFromAccounts: (a) =>
      a.매출액 !== null && a.자산총계 !== null && a.자산총계 !== 0
        ? Number((a.매출액 / a.자산총계).toFixed(2))
        : null,
  },
];

export function formatMetricValue(val: number | null, unit: MetricDefinition["unit"]): string {
  if (val === null || Number.isNaN(val)) return "공시원문 미기재";
  if (unit === "%") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
  if (unit === "회") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회`;
  return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("DART_API_KEY_LIVE") || "";
      return saved;
    }
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(() => !apiKey);

  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "ASK" | "COMPARE" | "ONE_PAGER">("DASHBOARD");
  const [allCorpMaster, setAllCorpMaster] = useState<CorpCodeEntry[]>([]);
  const [companies, setCompanies] = useState<CompanyFinancialRecord[]>([]);
  const [selectedCorpName, setSelectedCorpName] = useState<string>("대한전선");
  const [isRefreshingApi, setIsRefreshingApi] = useState<boolean>(false);
  const [apiStatusMessage, setApiStatusMessage] = useState<string>("");

  const [breakdownModalMetric, setBreakdownModalMetric] = useState<{
    isOpen: boolean;
    metric: MetricDefinition | null;
  }>({ isOpen: false, metric: null });
  const [copiedNotification, setCopiedNotification] = useState<string>("");
  const [comparePeriodFilter, setComparePeriodFilter] = useState<"LATEST" | "2025" | "2024" | "2023">("LATEST");

  const [customMetricIds, setCustomMetricIds] = useState<string[]>([
    "영업현금흐름",
    "CAPEX",
    "차입금",
    "부채비율",
  ]);
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);
  const [showAddCorpInput, setShowAddCorpInput] = useState<boolean>(false);
  const [newCorpQuery, setNewCorpQuery] = useState<string>("");

  const [askCorpName, setAskCorpName] = useState<string>("대한전선");
  const [askCategory, setAskCategory] = useState<string>("전체");
  const [askQuery, setAskQuery] = useState<string>("대한전선 매출액 지난 4개년치");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("매출액");
  const [askMultiYearMode, setAskMultiYearMode] = useState<boolean>(true);

  const [compareCorpNames, setCompareCorpNames] = useState<string[]>([]);
  const [compareSearchInput, setCompareSearchInput] = useState<string>("");
  const [compareMetricIds, setCompareMetricIds] = useState<string[]>([
    "매출액",
    "영업이익",
    "순이익",
    "차입금",
    "운전자본",
  ]);
  const [compareValidationMsg, setCompareValidationMsg] = useState<string>("");

  // API 키가 설정되면 즉시 OpenDART에서 전체 상장사 목록(corpCode.xml)과 초기 기준 기업(대한전선, 가온전선, 삼성전자, LS)을 실시간 로드
  useEffect(() => {
    if (!apiKey || isApiGateOpen) return;
    let cancelled = false;

    async function initLiveWorkspace() {
      setIsRefreshingApi(true);
      setApiStatusMessage("OpenDART 전체 상장사 고유번호(corpCode.xml) 및 실시간 최신 공시 수신 중...");
      const masterList = await loadAllDartCorpCodes(apiKey);
      if (!cancelled && masterList.length > 0) {
        setAllCorpMaster(masterList);
      }

      const initialTargets = ["대한전선", "가온전선", "삼성전자", "LS"];
      const loaded: CompanyFinancialRecord[] = [];
      for (const name of initialTargets) {
        const res = await fetchLiveDartCompanyRecord(name, apiKey);
        if (res.record) {
          loaded.push(res.record);
        }
      }

      if (!cancelled) {
        setIsRefreshingApi(false);
        if (loaded.length > 0) {
          setCompanies(loaded);
          setSelectedCorpName(loaded[0].corpName);
          setAskCorpName(loaded[0].corpName);
          setCompareCorpNames(loaded.map((c) => c.corpName));
          setApiStatusMessage(
            `✓ OpenDART 실시간 연동 완료 (등록 상장사 ${masterList.length.toLocaleString()}개 검색 가능)`
          );
        } else {
          setApiStatusMessage(
            "OpenDART API 응답을 받지 못했습니다. [API 변경]에서 40자리 인증키를 확인해 주세요."
          );
        }
      }
    }

    initLiveWorkspace();
    return () => {
      cancelled = true;
    };
  }, [apiKey, isApiGateOpen]);

  const currentCompany = useMemo(
    () => companies.find((c) => c.corpName === selectedCorpName) || companies[0] || null,
    [companies, selectedCorpName]
  );

  const handleFetchOrRegisterCompany = async (rawName: string): Promise<CompanyFinancialRecord | null> => {
    const cleanName = rawName.trim();
    if (!cleanName) return null;
    setIsRefreshingApi(true);
    setApiStatusMessage(`'${cleanName}' OpenDART 실시간 공시 및 4개년 재무제표 조회 중...`);

    const { record, errorMsg } = await fetchLiveDartCompanyRecord(cleanName, apiKey);
    setIsRefreshingApi(false);

    if (!record) {
      setApiStatusMessage(errorMsg || `'${cleanName}' 공시 데이터를 찾을 수 없습니다.`);
      return null;
    }

    setCompanies((prev) => {
      const idx = prev.findIndex((c) => c.corpCode === record.corpCode || c.corpName === record.corpName);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record];
    });
    setApiStatusMessage(
      `✓ ${record.corpName} (${record.stockCode}): ${record.reportName} (접수번호 #${record.rceptNo}) 실시간 수신 완료`
    );
    return record;
  };

  // 질문하기 자연어 검색 실행 (아직 로드되지 않은 기업을 질문해도 실시간으로 DART에서 가져옴)
  const handleRunAskSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : askQuery).trim();
    const clean = q.toLowerCase();

    const isMulti = /4개년|4년|3개년|3년|2개년|다년도|연도별|추이|개년|변화|흐름|역대/.test(clean);
    setAskMultiYearMode(isMulti);

    // 1. 질문 문장 안에 포함된 지표 찾기 (긴 별칭 우선: '영업이익율' -> '영업이익률')
    const pairs: { alias: string; metricId: string }[] = [];
    METRIC_DEFINITIONS.forEach((m) => {
      m.aliases.forEach((a) => {
        pairs.push({ alias: a.toLowerCase(), metricId: m.id });
      });
    });
    pairs.sort((a, b) => b.alias.length - a.alias.length);
    const matchedPair = pairs.find((p) => clean.includes(p.alias));
    const targetMetricId = matchedPair ? matchedPair.metricId : askSelectedMetricId;
    setAskSelectedMetricId(targetMetricId);

    // 2. 질문 문장 안에 기업명이 있는지 확인 (기존 로드된 기업 또는 전체 DART 상장사 마스터)
    let matchedCorp = companies.find((c) => clean.includes(c.corpName.toLowerCase()));
    if (!matchedCorp && allCorpMaster.length > 0) {
      const masterHit = allCorpMaster.find(
        (m) => m.stockCode && m.corpName.length >= 2 && clean.includes(m.corpName.toLowerCase())
      );
      if (masterHit) {
        const fetched = await handleFetchOrRegisterCompany(masterHit.corpName);
        if (fetched) matchedCorp = fetched;
      }
    }
    if (matchedCorp) {
      setAskCorpName(matchedCorp.corpName);
    }
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
    () => companies.find((c) => c.corpName === askCorpName) || currentCompany,
    [companies, askCorpName, currentCompany]
  );

  const askResultMetric = useMemo(
    () => METRIC_DEFINITIONS.find((m) => m.id === askSelectedMetricId) || METRIC_DEFINITIONS[0],
    [askSelectedMetricId]
  );

  const askExportRows: ExportTableRow[] = useMemo(() => {
    if (!askResultCompany) return [];
    if (askMultiYearMode && askResultCompany.history4Y.length > 0) {
      return askResultCompany.history4Y.map((snap) => {
        const val = askResultMetric.computeFromAccounts(snap.accounts);
        return {
          corpName: askResultCompany.corpName,
          metricName: askResultMetric.label,
          period: snap.periodLabel,
          valueFormatted: formatMetricValue(val, askResultMetric.unit),
          rawUnitValue: val !== null ? `${val} (${askResultMetric.unit})` : "-",
          formulaOrAccount: `${askResultMetric.statementSection} · ${askResultMetric.formulaText}`,
          sourceReport: snap.reportName,
          rceptNo: snap.rceptNo,
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
        rawUnitValue: val !== null ? `${val} (${askResultMetric.unit})` : "-",
        formulaOrAccount: `${askResultMetric.statementSection} · ${askResultMetric.formulaText}`,
        sourceReport: askResultCompany.reportName,
        rceptNo: askResultCompany.rceptNo,
      },
    ];
  }, [askResultCompany, askResultMetric, askMultiYearMode]);

  const compareExportRows: ExportTableRow[] = useMemo(() => {
    const rows: ExportTableRow[] = [];
    compareCorpNames.forEach((cName) => {
      const comp = companies.find((c) => c.corpName === cName);
      if (!comp) return;

      let targetSnap = {
        periodLabel: comp.period,
        reportName: comp.reportName,
        rceptNo: comp.rceptNo,
        accounts: comp.accounts,
      };
      if (comparePeriodFilter !== "LATEST") {
        const found = comp.history4Y.find((h) => h.periodKey === comparePeriodFilter);
        if (found) targetSnap = found;
      }

      compareMetricIds.forEach((mId) => {
        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
        if (!mDef) return;
        const val = mDef.computeFromAccounts(targetSnap.accounts);
        rows.push({
          corpName: comp.corpName,
          metricName: mDef.label,
          period: targetSnap.periodLabel,
          valueFormatted: formatMetricValue(val, mDef.unit),
          rawUnitValue: val !== null ? `${val} (${mDef.unit})` : "-",
          formulaOrAccount: mDef.formulaText,
          sourceReport: targetSnap.reportName,
          rceptNo: targetSnap.rceptNo,
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

  const handleCopyFactSentence = (
    corpName: string,
    metricLabel: string,
    formattedVal: string,
    period: string,
    reportName: string,
    rceptNo: string
  ) => {
    const sentence = `${corpName}의 ${period} 기준 ${metricLabel}은(는) ${formattedVal}이다. (출처: DART ${reportName}, 접수번호 #${rceptNo})`;
    navigator.clipboard.writeText(sentence);
    setCopiedNotification(`복사 완료: ${sentence}`);
    setTimeout(() => setCopiedNotification(""), 3500);
  };

  // ============================================================================
  // [API 입력 단계] 무로그인 첫 화면 + 인증키 신청 바로 밑에 확인·복사·붙여넣기 상시 노출 (폰트 확대)
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
              로그인 없이 OpenDART API 인증키(40자리)를 입력하면 DART에 등록된 모든 기업의 실시간 공시를 조회합니다.
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
                placeholder="발급받은 40자리 OpenDART API 인증키를 붙여넣으세요"
                className="flex-1 px-4 py-3.5 text-base border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
              />
              <button
                onClick={() => {
                  const trimmed = apiInputDraft.trim();
                  if (!trimmed) {
                    alert("발급받은 40자리 OpenDART API 인증키를 입력해 주세요.");
                    return;
                  }
                  localStorage.setItem("DART_API_KEY_LIVE", trimmed);
                  setApiKey(trimmed);
                  setIsApiGateOpen(false);
                }}
                className="px-6 py-3.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white font-bold text-base rounded-xl transition shrink-0"
              >
                인증키 저장 후 시작하기
              </button>
            </div>

            <div className="pt-2">
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

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-xl font-extrabold text-slate-900">
              인증키 확인 · 복사 · 붙여넣기 방법
            </h2>
            <ol className="list-decimal list-inside space-y-3 text-[17px] text-slate-800 leading-relaxed font-medium">
              <li>
                위의 <strong>[OpenDART 인증키 무료 신청 바로가기]</strong>를 눌러 회원가입 및 로그인을 진행합니다.
              </li>
              <li>
                상단 메뉴 <strong>[인증키 신청/관리] → [인증키 신청]</strong>에서 사용 목적을 입력해 즉시 발급받습니다.
              </li>
              <li>
                <strong>[인증키 신청/관리] → [오픈API 이용현황]</strong>에서 발급된 <strong>40자리 API 인증키를 확인하고 복사(Ctrl + C)</strong>합니다.
              </li>
              <li>
                위 입력칸에 <strong>붙여넣기(Ctrl + V)</strong> 한 뒤 <strong>[인증키 저장 후 시작하기]</strong>를 누르면 연결됩니다.
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] flex flex-col md:flex-row text-slate-900">
      {/* DART 전체 상장사 자동완성 리스트 */}
      <datalist id="dart-all-corps-list">
        {allCorpMaster
          .filter((c) => c.stockCode)
          .slice(0, 3000)
          .map((c) => (
            <option key={c.corpCode} value={c.corpName}>
              {c.stockCode}
            </option>
          ))}
      </datalist>

      {/* 산식 분해 모달 (사용자가 '산식 해부' 버튼을 눌렀을 때만 열림) */}
      {breakdownModalMetric.isOpen && breakdownModalMetric.metric && currentCompany && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                  공시 원문 산식 분해기
                </span>
                <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                  {currentCompany.corpName} — 『{breakdownModalMetric.metric.label}』 원문 계정 구성
                </h3>
              </div>
              <button
                onClick={() => setBreakdownModalMetric({ isOpen: false, metric: null })}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs text-slate-800">
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1">
                <div className="font-bold text-slate-600">산식: {breakdownModalMetric.metric.formulaText}</div>
                <div className="text-emerald-900 font-extrabold text-base">
                  산출 결과:{" "}
                  {formatMetricValue(
                    breakdownModalMetric.metric.computeFromAccounts(currentCompany.accounts),
                    breakdownModalMetric.metric.unit
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-bold text-slate-900">DART 원문 하위 계정 금액 ({currentCompany.period}):</div>
                <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-lg border border-slate-200">
                  <div>매출액: {formatMetricValue(currentCompany.accounts.매출액, "억원")}</div>
                  <div>영업이익: {formatMetricValue(currentCompany.accounts.영업이익, "억원")}</div>
                  <div>당기순이익: {formatMetricValue(currentCompany.accounts.순이익, "억원")}</div>
                  <div>감가상각비: {formatMetricValue(currentCompany.accounts.감가상각비, "억원")}</div>
                  <div>단기차입금: {formatMetricValue(currentCompany.accounts.단기차입금, "억원")}</div>
                  <div>유동성장기부채: {formatMetricValue(currentCompany.accounts.유동성장기부채, "억원")}</div>
                  <div>사채: {formatMetricValue(currentCompany.accounts.사채, "억원")}</div>
                  <div>장기차입금: {formatMetricValue(currentCompany.accounts.장기차입금, "억원")}</div>
                  <div>매출채권: {formatMetricValue(currentCompany.accounts.매출채권, "억원")}</div>
                  <div>재고자산: {formatMetricValue(currentCompany.accounts.재고자산, "억원")}</div>
                  <div>매입채무: {formatMetricValue(currentCompany.accounts.매입채무, "억원")}</div>
                  <div>CAPEX(유형자산취득): {formatMetricValue(currentCompany.accounts.유형자산취득_CAPEX, "억원")}</div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <a
                href={buildDartDirectUrl(currentCompany.rceptNo, currentCompany.corpName)}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                DART 공시 원문 열기 (#{currentCompany.rceptNo}) <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setBreakdownModalMetric({ isOpen: false, metric: null })}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-800 text-xs font-bold"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {copiedNotification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 print:hidden">
          <Check className="w-4 h-4 text-emerald-400" /> {copiedNotification}
        </div>
      )}

      {/* 좌측 사이드바 (요청사항: DART 로만 표시, WORKSPACE 문구 삭제, 재무용어 삭제, API 변경) */}
      <aside className="w-full md:w-60 bg-[#0b241d] text-white flex flex-col justify-between p-5 shrink-0 print:hidden">
        <div className="space-y-6">
          <div className="px-2 pt-1 pb-3 border-b border-emerald-900/60">
            <div className="text-2xl font-black tracking-tight text-white">DART</div>
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
              <LayoutDashboard className="w-4 h-4" /> 오늘의 공시 인사이트
            </button>
            <button
              onClick={() => setActiveTab("ASK")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ASK"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <MessageSquare className="w-4 h-4" /> 질문하기
            </button>
            <button
              onClick={() => setActiveTab("COMPARE")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "COMPARE"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <BarChart3 className="w-4 h-4" /> 비교분석
            </button>
            <button
              onClick={() => setActiveTab("ONE_PAGER")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ONE_PAGER"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" /> 1-Pager 종합보고서
            </button>
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
            <KeyRound className="w-4 h-4" /> API 변경
          </button>
        </div>
      </aside>

      {/* 우측 본문 */}
      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
        {apiStatusMessage && (
          <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-900 flex items-center justify-between print:hidden">
            <span>{apiStatusMessage}</span>
            <button onClick={() => setApiStatusMessage("")} className="text-emerald-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {!currentCompany ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
            <div className="text-base font-bold text-slate-800">
              OpenDART에서 실시간 공시 데이터를 불러오고 있습니다...
            </div>
          </div>
        ) : (
          <>
            {/* ================================================================
                [탭 1] 오늘의 공시 인사이트
               ================================================================ */}
            {activeTab === "DASHBOARD" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-extrabold text-slate-900">오늘의 공시 인사이트</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                      최근 보고서의 핵심 재무지표를 먼저 보고, 필요한 숫자는 직접 확장하세요.
                    </p>
                  </div>
                  <button
                    onClick={() => handleFetchOrRegisterCompany(currentCompany.corpName)}
                    disabled={isRefreshingApi}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingApi ? "animate-spin" : ""}`} />
                    {isRefreshingApi ? "조회 중..." : "최신 데이터 갱신"}
                  </button>
                </div>

                {/* 기준 기업 선택 및 DART 전 기업 검색 추가 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-slate-500">기준 기업</span>
                  <select
                    value={selectedCorpName}
                    onChange={(e) => setSelectedCorpName(e.target.value)}
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-white"
                  >
                    {companies.map((c) => (
                      <option key={c.corpCode} value={c.corpName}>
                        {c.corpName} ({c.stockCode})
                      </option>
                    ))}
                  </select>

                  {!showAddCorpInput ? (
                    <button
                      onClick={() => setShowAddCorpInput(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> 타 기업 추가 (DART 전체 검색)
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
                            const rec = await handleFetchOrRegisterCompany(newCorpQuery.trim());
                            if (rec) setSelectedCorpName(rec.corpName);
                            setNewCorpQuery("");
                            setShowAddCorpInput(false);
                          }
                        }}
                        placeholder="기업명 또는 종목코드 (예: 에넥스, 에이스테크, 현대자동차)"
                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs w-72"
                      />
                      <button
                        onClick={async () => {
                          if (!newCorpQuery.trim()) return;
                          const rec = await handleFetchOrRegisterCompany(newCorpQuery.trim());
                          if (rec) setSelectedCorpName(rec.corpName);
                          setNewCorpQuery("");
                          setShowAddCorpInput(false);
                        }}
                        className="px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold"
                      >
                        조회·등록
                      </button>
                      <button
                        onClick={() => setShowAddCorpInput(false)}
                        className="p-1 text-slate-400 hover:text-slate-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* 상단 배너 */}
                <div className="bg-[#082f27] text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold tracking-wider text-emerald-300 uppercase">
                      LIVE OPEN DART
                    </div>
                    <div className="text-2xl font-extrabold">
                      <span className="text-emerald-300 underline underline-offset-4">
                        {currentCompany.corpName}
                      </span>{" "}
                      최근 공시 ({currentCompany.period})
                    </div>
                    <div className="text-xs text-emerald-100/85">
                      {currentCompany.reportName} · 접수번호 #{currentCompany.rceptNo} ·{" "}
                      {currentCompany.verificationNote}
                    </div>
                  </div>
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
                    질문으로 파고들기 ↗
                  </button>
                </div>

                {/* 핵심 지표 (우측 상단 픽토그램 제거, 원문 클릭 시 중간 모달 없이 진짜 DART 창 직행) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold text-slate-400 tracking-wider">
                        PULSE CHECK
                      </div>
                      <h2 className="text-lg font-extrabold text-slate-900">
                        핵심 지표 ({currentCompany.period})
                      </h2>
                    </div>
                    <span className="text-xs text-slate-400">최근 매출액 · 영업이익 · 순이익</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(["매출액", "영업이익", "순이익"] as const).map((coreId) => {
                      const mDef = METRIC_DEFINITIONS.find((m) => m.id === coreId)!;
                      const val = mDef.computeFromAccounts(currentCompany.accounts);
                      const formatted = formatMetricValue(val, mDef.unit);
                      return (
                        <div
                          key={coreId}
                          className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between shadow-2xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500">
                              {currentCompany.corpName} · {mDef.label}
                            </span>
                            <button
                              onClick={() =>
                                handleCopyFactSentence(
                                  currentCompany.corpName,
                                  mDef.label,
                                  formatted,
                                  currentCompany.period,
                                  currentCompany.reportName,
                                  currentCompany.rceptNo
                                )
                              }
                              title="보고서용 문장 복사"
                              className="text-slate-400 hover:text-emerald-700"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="my-3 text-2xl font-extrabold text-slate-900">
                            {formatted}
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                            <span>{currentCompany.reportName}</span>
                            <a
                              href={buildDartDirectUrl(currentCompany.rceptNo, currentCompany.corpName)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                            >
                              공시 원문 ↗
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 커스텀 지표 (추가/삭제 완벽 작동, 중간 모달 없이 바로 DART 원문 연결) */}
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
                      <Plus className="w-3.5 h-3.5" />{" "}
                      {showCustomPicker ? "지표 선택창 닫기" : "커스텀 지표 추가"}
                    </button>
                  </div>

                  {showCustomPicker && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap gap-1.5">
                      {METRIC_DEFINITIONS.filter(
                        (m) => !["매출액", "영업이익", "순이익", "자산회전율"].includes(m.id)
                      ).map((m) => {
                        const isAdded = customMetricIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (isAdded)
                                setCustomMetricIds((prev) => prev.filter((id) => id !== m.id));
                              else setCustomMetricIds((prev) => [...prev, m.id]);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition inline-flex items-center gap-1 ${
                              isAdded
                                ? "bg-emerald-700 text-white"
                                : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {m.label}{" "}
                            {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {customMetricIds.length === 0 ? (
                    <div className="text-xs text-slate-400 py-2 text-center">
                      선택된 커스텀 지표가 없습니다. [+ 커스텀 지표 추가]를 눌러 추가하세요.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {customMetricIds.map((mId) => {
                        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
                        if (!mDef) return null;
                        const val = mDef.computeFromAccounts(currentCompany.accounts);
                        const formatted = formatMetricValue(val, mDef.unit);
                        return (
                          <div
                            key={mId}
                            className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/60 flex flex-col justify-between"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-bold text-slate-600 truncate">
                                {mDef.label}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() =>
                                    setBreakdownModalMetric({ isOpen: true, metric: mDef })
                                  }
                                  title="산식 구성 보기"
                                  className="p-0.5 rounded hover:bg-slate-200 text-slate-500"
                                >
                                  <Layers className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() =>
                                    setCustomMetricIds((prev) => prev.filter((id) => id !== mId))
                                  }
                                  title="지표 삭제"
                                  className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-rose-600"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <div className="text-lg font-extrabold text-slate-900 mt-1.5">
                              {formatted}
                            </div>
                            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200/70">
                              <span className="text-[10px] text-slate-400 truncate">
                                {mDef.formulaText}
                              </span>
                              <a
                                href={buildDartDirectUrl(
                                  currentCompany.rceptNo,
                                  currentCompany.corpName
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-bold text-emerald-700 hover:underline shrink-0"
                              >
                                원문 ↗
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================
                [탭 2] 질문하기
               ================================================================ */}
            {activeTab === "ASK" && askResultCompany && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-2xl font-extrabold text-slate-900">질문하기</h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    자연어 질문(예: <strong>"에넥스 영업이익률"</strong>, <strong>"지난 4개년치"</strong>)이나 세부 검색어를 클릭하면 실시간 DART 수치와 원문 링크가 표로 출력됩니다.
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <select
                      value={askCorpName}
                      onChange={(e) => {
                        setAskCorpName(e.target.value);
                        setAskQuery(
                          `${e.target.value} ${askResultMetric.label}${
                            askMultiYearMode ? " 지난 4개년치" : ""
                          }`
                        );
                      }}
                      className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white"
                    >
                      {companies.map((c) => (
                        <option key={c.corpCode} value={c.corpName}>
                          {c.corpName}
                        </option>
                      ))}
                    </select>

                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={askQuery}
                        onChange={(e) => setAskQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRunAskSearch();
                        }}
                        placeholder="예: 지난 4개년치, 에넥스 매출액 지난 4개년치, 에이스테크 차입금"
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

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setAskMultiYearMode(false);
                          setAskQuery(`${askCorpName} ${askResultMetric.label}`);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          !askMultiYearMode
                            ? "bg-emerald-700 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        최신 공시 단일
                      </button>
                      <button
                        onClick={() => {
                          setAskMultiYearMode(true);
                          setAskQuery(`${askCorpName} ${askResultMetric.label} 지난 4개년치`);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                          askMultiYearMode
                            ? "bg-emerald-700 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
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
                          setAskQuery(
                            `${askCorpName} ${m.label}${askMultiYearMode ? " 지난 4개년치" : ""}`
                          );
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

                {/* 검색 결과 (계산기 아이콘 삭제, 값 우측 정렬, 모달 없이 DART 원문 바로 열기) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <span className="text-xs font-bold text-emerald-700">
                        {askResultCompany.corpName} ·{" "}
                        {askMultiYearMode ? "다년도 정기공시 시계열" : askResultCompany.reportName}
                      </span>
                      <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                        {askResultCompany.corpName} {askResultMetric.label}{" "}
                        {askMultiYearMode ? "지난 4개년치 조회 결과" : "검색 결과"}
                      </h2>
                    </div>

                    <div className="flex items-center gap-2 print:hidden">
                      <button
                        onClick={() =>
                          exportRowsToPrintablePdf(
                            `${askResultCompany.corpName}_${askResultMetric.label}_조회결과`,
                            askExportRows
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
                      >
                        <FileText className="w-3.5 h-3.5" /> PDF 다운로드
                      </button>
                      <button
                        onClick={() =>
                          exportRowsToCsvExcel(
                            `${askResultCompany.corpName}_${askResultMetric.label}_조회결과.csv`,
                            askExportRows
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white"
                      >
                        <Download className="w-3.5 h-3.5" /> Excel 다운로드
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-500">
                        지표: {askResultMetric.label} ({askResultMetric.statementSection})
                      </div>
                      <div className="text-xs text-slate-600">
                        산식 / 근거: {askResultMetric.formulaText}
                      </div>
                    </div>
                    <div className="text-right ml-auto">
                      <div className="text-xs font-semibold text-slate-400 text-right">
                        최신 공시 기준 ({askResultCompany.period})
                      </div>
                      <div className="text-3xl font-black text-emerald-900 text-right">
                        {formatMetricValue(
                          askResultMetric.computeFromAccounts(askResultCompany.accounts),
                          askResultMetric.unit
                        )}
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
                          <th className="border border-slate-200 px-4 py-2.5 text-left">산식 및 계정근거</th>
                          <th className="border border-slate-200 px-4 py-2.5 text-left">공시 원문</th>
                        </tr>
                      </thead>
                      <tbody>
                        {askExportRows.map((row, idx) => (
                          <tr key={idx} className="bg-white hover:bg-slate-50">
                            <td className="border border-slate-200 px-4 py-3 font-bold">
                              {row.corpName}
                            </td>
                            <td className="border border-slate-200 px-4 py-3 font-bold text-slate-800">
                              {row.metricName}
                            </td>
                            <td className="border border-slate-200 px-4 py-3 text-center">
                              {row.period}
                            </td>
                            <td className="border border-slate-200 px-4 py-3 text-right font-extrabold text-emerald-800">
                              {row.valueFormatted}
                            </td>
                            <td className="border border-slate-200 px-4 py-3 text-xs text-slate-600">
                              {row.formulaOrAccount}
                            </td>
                            <td className="border border-slate-200 px-4 py-3 text-xs">
                              <a
                                href={buildDartDirectUrl(row.rceptNo, row.corpName)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                              >
                                {row.sourceReport} (#{row.rceptNo}) ↗
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                [탭 3] 비교분석
               ================================================================ */}
            {activeTab === "COMPARE" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-2xl font-extrabold text-slate-900">비교분석</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                      DART에 등록된 모든 기업을 검색해 추가·삭제하고, 지표(2개~5개)를 선택해 비교하세요.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 print:hidden">
                    <button
                      onClick={() =>
                        exportRowsToPrintablePdf("기업별_공시값_비교분석", compareExportRows)
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700"
                    >
                      <FileText className="w-3.5 h-3.5" /> PDF 다운로드
                    </button>
                    <button
                      onClick={() =>
                        exportRowsToCsvExcel("기업별_공시값_비교분석.csv", compareExportRows)
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 text-xs font-bold text-white"
                    >
                      <Download className="w-3.5 h-3.5" /> Excel 다운로드
                    </button>
                  </div>
                </div>

                {/* 기준기간 동기화 스위치 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-700">비교 기준기간 선택</span>
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        { key: "LATEST", label: "최신 정기공시 기준" },
                        { key: "2025", label: "2025년 사업보고서 (연간)" },
                        { key: "2024", label: "2024년 사업보고서 (연간)" },
                        { key: "2023", label: "2023년 사업보고서 (연간)" },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setComparePeriodFilter(s.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                          comparePeriodFilter === s.key
                            ? "bg-slate-900 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 1. 기업 검색 등록 및 삭제 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-extrabold text-slate-900">
                      1. 비교기업 선택 및 DART 검색 등록 ({compareCorpNames.length}개 선택됨)
                    </h2>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        list="dart-all-corps-list"
                        value={compareSearchInput}
                        onChange={(e) => setCompareSearchInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === "Enter" && compareSearchInput.trim()) {
                            const rec = await handleFetchOrRegisterCompany(compareSearchInput.trim());
                            if (rec && !compareCorpNames.includes(rec.corpName)) {
                              setCompareCorpNames((prev) => [...prev, rec.corpName]);
                            }
                            setCompareSearchInput("");
                          }
                        }}
                        placeholder="기업명 입력 (예: 에넥스, 에이스테크, 일진전기)"
                        className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs w-64"
                      />
                      <button
                        onClick={async () => {
                          if (!compareSearchInput.trim()) return;
                          const rec = await handleFetchOrRegisterCompany(compareSearchInput.trim());
                          if (rec && !compareCorpNames.includes(rec.corpName)) {
                            setCompareCorpNames((prev) => [...prev, rec.corpName]);
                          }
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
                          key={c.corpCode}
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
                              if (companies.length > 1) {
                                setCompanies((prev) =>
                                  prev.filter((item) => item.corpName !== c.corpName)
                                );
                              }
                            }}
                            title="기업 삭제"
                            className={`pr-2.5 pl-1 py-1.5 ${
                              isSelected
                                ? "text-emerald-100 hover:text-rose-200"
                                : "text-slate-400 hover:text-rose-600"
                            }`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 비교 지표 선택 (2개~5개 버튼 선택) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-extrabold text-slate-900">
                        2. 비교 지표 선택 (2개 ~ 5개 다중 선택)
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
                          {m.label} {active && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. 공시값 비교 테이블 (기업 | 선택 지표들(최대 5개) | 출처) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                  <h2 className="text-lg font-extrabold text-slate-900">공시값 비교</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse border border-slate-200">
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
                          <th className="border border-slate-200 px-4 py-3 text-left">출처</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareCorpNames.map((cName) => {
                          const comp = companies.find((c) => c.corpName === cName);
                          if (!comp) return null;

                          let targetSnap = {
                            periodLabel: comp.period,
                            reportName: comp.reportName,
                            rceptNo: comp.rceptNo,
                            accounts: comp.accounts,
                          };
                          if (comparePeriodFilter !== "LATEST") {
                            const found = comp.history4Y.find(
                              (h) => h.periodKey === comparePeriodFilter
                            );
                            if (found) targetSnap = found;
                          }

                          return (
                            <tr key={cName} className="hover:bg-slate-50">
                              <td className="border border-slate-200 px-4 py-3.5 font-extrabold text-slate-900">
                                {comp.corpName}
                                <span className="block text-[11px] font-normal text-slate-400">
                                  {targetSnap.periodLabel}
                                </span>
                              </td>
                              {compareMetricIds.map((mId) => {
                                const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                                const val = mDef.computeFromAccounts(targetSnap.accounts);
                                return (
                                  <td
                                    key={mId}
                                    className="border border-slate-200 px-4 py-3.5 text-right font-bold text-slate-900"
                                  >
                                    {formatMetricValue(val, mDef.unit)}
                                  </td>
                                );
                              })}
                              <td className="border border-slate-200 px-4 py-3.5 text-xs">
                                <a
                                  href={buildDartDirectUrl(targetSnap.rceptNo, comp.corpName)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                                >
                                  {targetSnap.reportName} (#{targetSnap.rceptNo}) ↗
                                </a>
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

            {/* ================================================================
                [탭 4] 1-Pager 종합보고서 (실시간 수집된 4개년 데이터 기반 동적 차트 + 요약)
               ================================================================ */}
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
                      {companies.map((c) => (
                        <option key={c.corpCode} value={c.corpName}>
                          {c.corpName} ({c.stockCode})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold"
                    >
                      <Printer className="w-3.5 h-3.5" /> 1-Pager 인쇄 / PDF
                    </button>
                  </div>
                </div>

                <h2 className="text-lg md:text-xl font-bold text-stone-900">
                  {currentCompany.corpName} ({currentCompany.period}) 재무 종합 분석 — 매출{" "}
                  {formatMetricValue(currentCompany.accounts.매출액, "억원")} · 영업이익{" "}
                  {formatMetricValue(currentCompany.accounts.영업이익, "억원")}
                </h2>

                {/* 실시간 수집된 시계열 동적 SVG 차트 */}
                {currentCompany.history4Y.length > 0 && (
                  <div className="bg-white border border-stone-200 rounded-xl p-4">
                    <div className="text-xs font-bold text-stone-700 mb-2">
                      📊 {currentCompany.corpName} 다년도 매출·영업이익·영업이익률 추이 (OpenDART 원문 기준)
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                      {currentCompany.history4Y.map((h) => {
                        const opm =
                          h.accounts.영업이익 !== null &&
                          h.accounts.매출액 !== null &&
                          h.accounts.매출액 !== 0
                            ? ((h.accounts.영업이익 / h.accounts.매출액) * 100).toFixed(2)
                            : "-";
                        return (
                          <div
                            key={h.periodKey + h.periodLabel}
                            className="p-3 rounded-lg bg-stone-50 border border-stone-200 space-y-1"
                          >
                            <div className="text-xs font-bold text-stone-500">{h.periodLabel}</div>
                            <div className="text-sm font-extrabold text-stone-900">
                              매출: {formatMetricValue(h.accounts.매출액, "억원")}
                            </div>
                            <div className="text-xs font-bold text-emerald-800">
                              영업이익: {formatMetricValue(h.accounts.영업이익, "억원")} ({opm}%)
                            </div>
                            <div className="text-xs text-stone-600">
                              순이익: {formatMetricValue(h.accounts.순이익, "억원")}
                            </div>
                            <a
                              href={buildDartDirectUrl(h.rceptNo, currentCompany.corpName)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-700 hover:underline block pt-1"
                            >
                              DART #{h.rceptNo} ↗
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 전체 지표 시계열 표 */}
                <div className="bg-white border border-stone-200 rounded-xl p-4 overflow-x-auto">
                  <table className="w-full text-xs border-collapse border border-stone-200">
                    <thead>
                      <tr className="bg-stone-100 text-stone-700">
                        <th className="border border-stone-200 px-3 py-2 text-left">지표</th>
                        {currentCompany.history4Y.map((h) => (
                          <th
                            key={h.periodKey + h.periodLabel}
                            className="border border-stone-200 px-3 py-2 text-right"
                          >
                            {h.periodLabel}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          "매출액",
                          "영업이익",
                          "영업이익률",
                          "순이익",
                          "자산총계",
                          "부채총계",
                          "자본총계",
                          "부채비율",
                          "차입금",
                          "운전자본",
                          "영업현금흐름",
                          "CAPEX",
                          "FCF",
                        ] as const
                      ).map((mId) => {
                        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                        return (
                          <tr key={mId}>
                            <td className="border border-stone-200 px-3 py-2 font-bold text-stone-800">
                              {mDef.label}
                            </td>
                            {currentCompany.history4Y.map((h) => (
                              <td
                                key={h.periodKey + h.periodLabel}
                                className="border border-stone-200 px-3 py-2 text-right font-semibold"
                              >
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
          </>
        )}
      </main>
    </div>
  );
}
