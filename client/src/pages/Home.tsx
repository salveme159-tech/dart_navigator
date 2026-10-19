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
  Sliders,
  Activity,
  RotateCcw,
  Target,
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
    statementSection: "현금흐름표",
    unit: "억원",
    formulaText: "영업이익 + 유형자산감가상각비 + 무형자산상각비",
    aliases: ["ebitda", "에비타", "감가상각전영업이익"],
    computeFromAccounts: (a) => {
      if (a.영업이익 === null) return null;
      if (a.감가상각비 === null && a.무형자산상각비 === null) return null;
      return Number((a.영업이익 + (a.감가상각비 || 0) + (a.무형자산상각비 || 0)).toFixed(2));
    },
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
      if (a.총차입금_정밀원화합산 !== undefined && a.총차입금_정밀원화합산 !== null) {
        return a.총차입금_정밀원화합산;
      }
      const sum =
        (a.단기차입금 || 0) +
        (a.유동성장기부채 || 0) +
        (a.사채 || 0) +
        (a.장기차입금 || 0);
      return Number(sum.toFixed(2));
    },
  },
  {
    id: "차입금의존도",
    label: "차입금 의존도",
    category: "운전자본/차입금",
    statementSection: "재무상태표",
    unit: "%",
    formulaText: "(원문 KRW 총차입금 ÷ 원문 KRW 자산총계) × 100",
    aliases: ["차입금의존도", "차입금 의존도"],
    computeFromAccounts: (a) => {
      if (a.차입금의존도_정밀산출 !== undefined && a.차입금의존도_정밀산출 !== null) {
        return a.차입금의존도_정밀산출;
      }
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
      Number(((a.매출채권 || 0) + (a.재고자산 || 0) - (a.매입채무 || 0)).toFixed(2)),
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
        ? Number((a.영업현금흐름 - a.유형자산취득_CAPEX).toFixed(2))
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
  if (unit === "%") return `${val.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  if (unit === "회") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회`;
  return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억원`;
}

function computeAdvancedFinancialIntelligence(
  comp: CompanyFinancialRecord,
  rawMaterialCostDeltaPctP: number,
  interestRateDeltaPctP: number,
  fxRateDeltaPct: number,
  fxExposureRatioPct: number,
  userPlannedCapexEok: number | null
) {
  const a = comp.accounts;
  const rev = a.매출액 || 0;
  const cogs = a.매출원가;
  const cogsRatioPct =
    cogs !== null && rev > 0 ? Number(((cogs / rev) * 100).toFixed(2)) : null;

  const op = a.영업이익 || 0;
  const net = a.순이익 || 0;

  const totalDebt =
    a.총차입금_정밀원화합산 !== null && a.총차입금_정밀원화합산 !== undefined
      ? a.총차입금_정밀원화합산
      : Number(
          (
            (a.단기차입금 || 0) +
            (a.유동성장기부채 || 0) +
            (a.사채 || 0) +
            (a.장기차입금 || 0)
          ).toFixed(2)
        );

  const debtDependencyPct =
    a.차입금의존도_정밀산출 !== null && a.차입금의존도_정밀산출 !== undefined
      ? a.차입금의존도_정밀산출
      : a.자산총계 && a.자산총계 > 0
      ? Number(((totalDebt / a.자산총계) * 100).toFixed(2))
      : 0;

  const finCost = a.금융원가 || 0;
  const ocf = a.영업현금흐름 || 0;
  const capex = a.유형자산취득_CAPEX || 0;
  const ar = a.매출채권 || 0;
  const inv = a.재고자산 || 0;
  const ap = a.매입채무 || 0;
  const nwc = Number((ar + inv - ap).toFixed(2));

  const isHalfYear = comp.period.includes("06") || comp.period.includes("반기");
  const isQuarter = comp.period.includes("03") || comp.period.includes("09") || comp.period.includes("분기");
  const timeFactor = isHalfYear ? 0.5 : isQuarter ? 0.25 : 1.0;

  const costImpact = -(rev * (rawMaterialCostDeltaPctP / 100));
  const fxImpact = rev * (fxExposureRatioPct / 100) * (fxRateDeltaPct / 100);
  const simulatedOp = Number((op + costImpact + fxImpact).toFixed(2));
  const simulatedOpm = rev > 0 ? Number(((simulatedOp / rev) * 100).toFixed(2)) : 0;
  const opDropPct = op !== 0 ? Number((((simulatedOp - op) / Math.abs(op)) * 100).toFixed(1)) : 0;

  const interestImpact = totalDebt * (interestRateDeltaPctP / 100) * timeFactor;
  const simulatedFinCost = Math.max(0, Number((finCost + interestImpact).toFixed(2)));
  const preTaxDelta = costImpact + fxImpact - interestImpact;
  const simulatedNet = Number((net + preTaxDelta * 0.78).toFixed(2));

  const baseIcr = finCost > 0 ? Number((op / finCost).toFixed(2)) : null;
  const simulatedIcr =
    simulatedFinCost > 0 ? Number((simulatedOp / simulatedFinCost).toFixed(2)) : null;

  const cumulativeActualCapex = Number(
    comp.history4Y
      .reduce((acc, cur) => acc + (cur.accounts.유형자산취득_CAPEX || 0), 0)
      .toFixed(2)
  );

  const sayDoRatioPct =
    userPlannedCapexEok && userPlannedCapexEok > 0
      ? Number(((cumulativeActualCapex / userPlannedCapexEok) * 100).toFixed(1))
      : null;

  const snaps = comp.history4Y;
  const prevSnap = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
  const prevRev = prevSnap?.accounts.매출액 || null;
  const prevArInv =
    prevSnap && (prevSnap.accounts.매출채권 !== null || prevSnap.accounts.재고자산 !== null)
      ? (prevSnap.accounts.매출채권 || 0) + (prevSnap.accounts.재고자산 || 0)
      : null;
  const currArInv = ar + inv;

  const annualizedRev = isHalfYear ? rev * 2 : rev;
  const revGrowthPct =
    prevRev && prevRev > 0
      ? Number((((annualizedRev - prevRev) / prevRev) * 100).toFixed(1))
      : null;
  const arInvGrowthPct =
    prevArInv && prevArInv > 0
      ? Number((((currArInv - prevArInv) / prevArInv) * 100).toFixed(1))
      : null;

  const accrualGapEok = Number((ocf - op).toFixed(2));
  const ocfConversionPct = op > 0 ? Number(((ocf / op) * 100).toFixed(1)) : null;

  const isAccrualAnomaly = op > 0 && ocf < 0;
  const isWorkingCapitalSpike =
    revGrowthPct !== null &&
    arInvGrowthPct !== null &&
    arInvGrowthPct > 5 &&
    arInvGrowthPct >= Math.max(revGrowthPct * 2, revGrowthPct + 10);

  let forensicStatus = "정상 · 우량 (영업현금 유입 확인)";
  let forensicDiagnosis = `장부상 영업이익(${op.toLocaleString()}억)과 영업활동현금흐름(${ocf.toLocaleString()}억) 사이에 비정상적 역전 징후가 발견되지 않았습니다.`;

  if (isAccrualAnomaly) {
    forensicStatus = "경고 (장부상 흑자 vs 영업현금 유출 괴리)";
    forensicDiagnosis = `영업이익은 ${op.toLocaleString()}억원 흑자이나 실제 영업활동현금흐름(OCF)은 ${ocf.toLocaleString()}억원 유출 상태입니다. 매출채권(${ar.toLocaleString()}억) 및 재고자산(${inv.toLocaleString()}억) 묶임 여부를 확인하세요.`;
  } else if (op < 0 && ocf < 0) {
    forensicStatus = "경고 (영업적자 및 영업현금 유출 지속)";
    forensicDiagnosis = `영업손실(${op.toLocaleString()}억)과 영업현금 유출(${ocf.toLocaleString()}억)이 동시에 발생하고 있습니다.`;
  } else if (isWorkingCapitalSpike) {
    forensicStatus = "주의 (매출 대비 매출채권·재고자산 급증)";
    forensicDiagnosis = `직전 보고서 대비 연환산 매출 증감률(${revGrowthPct}%)보다 매출채권+재고자산 증가율(${arInvGrowthPct}%)이 2배 이상 빠릅니다.`;
  }

  return {
    rev,
    cogs,
    cogsRatioPct,
    op,
    net,
    totalDebt,
    debtDependencyPct,
    finCost,
    ocf,
    capex,
    ar,
    inv,
    ap,
    nwc,
    simulatedOp,
    simulatedOpm,
    opDropPct,
    simulatedFinCost,
    simulatedNet,
    baseIcr,
    simulatedIcr,
    costImpact: Number(costImpact.toFixed(2)),
    fxImpact: Number(fxImpact.toFixed(2)),
    interestImpact: Number(interestImpact.toFixed(2)),
    cumulativeActualCapex,
    sayDoRatioPct,
    revGrowthPct,
    arInvGrowthPct,
    accrualGapEok,
    ocfConversionPct,
    forensicStatus,
    forensicDiagnosis,
  };
}

export default function Home() {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("DART_API_KEY_LIVE") || "";
      return saved.startsWith("VERIFIED") ? "" : saved;
    }
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(() => !apiKey);

  const [activeTab, setActiveTab] = useState<
    "DASHBOARD" | "ADVANCED" | "ASK" | "COMPARE" | "ONE_PAGER"
  >("DASHBOARD");
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
  const [comparePeriodFilter, setComparePeriodFilter] = useState<"LATEST" | "2025" | "2024">("LATEST");

  const [simCostRateDelta, setSimCostRateDelta] = useState<number>(0);
  const [simInterestDelta, setSimInterestDelta] = useState<number>(0);
  const [simFxDelta, setSimFxDelta] = useState<number>(0);
  const [simFxExposurePct, setSimFxExposurePct] = useState<number>(0);
  const [customCapexPlanInput, setCustomCapexPlanInput] = useState<string>("");

  const [customMetricIds, setCustomMetricIds] = useState<string[]>([
    "차입금의존도",
    "EBITDA",
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
  const [askQuery, setAskQuery] = useState<string>("대한전선 차입금의존도 지난 4개년치");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("차입금의존도");
  const [askMultiYearMode, setAskMultiYearMode] = useState<boolean>(true);

  const [compareCorpNames, setCompareCorpNames] = useState<string[]>(["대한전선"]);
  const [compareSearchInput, setCompareSearchInput] = useState<string>("");
  const [compareMetricIds, setCompareMetricIds] = useState<string[]>([
    "매출액",
    "영업이익",
    "EBITDA",
    "차입금의존도",
    "영업현금흐름",
  ]);
  const [compareValidationMsg, setCompareValidationMsg] = useState<string>("");

  useEffect(() => {
    if (!apiKey || isApiGateOpen) return;
    let cancelled = false;
    async function initWorkspace() {
      setIsRefreshingApi(true);
      setApiStatusMessage("OpenDART 서버에서 '대한전선' 실시간 원문 데이터를 불러오는 중...");
      const masterList = await loadAllDartCorpCodes(apiKey);
      if (!cancelled && masterList.length > 0) {
        setAllCorpMaster(masterList);
      }

      const res = await fetchLiveDartCompanyRecord("대한전선", apiKey);
      if (!cancelled) {
        setIsRefreshingApi(false);
        if (res.record) {
          setCompanies([res.record]);
          setSelectedCorpName(res.record.corpName);
          setAskCorpName(res.record.corpName);
          setCompareCorpNames([res.record.corpName]);
          setApiStatusMessage(`✓ ${res.record.corpName} (${res.record.period}) OpenDART 실시간 원문 연동 완료`);
        } else {
          setApiStatusMessage(res.errorMsg || "OpenDART 응답 실패. API 인증키를 확인해 주세요.");
        }
      }
    }
    initWorkspace();
    return () => {
      cancelled = true;
    };
  }, [apiKey, isApiGateOpen]);

  const currentCompany = useMemo(
    () => companies.find((c) => c.corpName === selectedCorpName) || companies[0] || null,
    [companies, selectedCorpName]
  );

  const currentIntel = useMemo(() => {
    if (!currentCompany) return null;
    const parsedPlan = Number(customCapexPlanInput);
    return computeAdvancedFinancialIntelligence(
      currentCompany,
      simCostRateDelta,
      simInterestDelta,
      simFxDelta,
      simFxExposurePct,
      !Number.isNaN(parsedPlan) && parsedPlan > 0 ? parsedPlan : null
    );
  }, [
    currentCompany,
    simCostRateDelta,
    simInterestDelta,
    simFxDelta,
    simFxExposurePct,
    customCapexPlanInput,
  ]);

  const handleFetchOrRegisterCompany = async (
    rawName: string
  ): Promise<CompanyFinancialRecord | null> => {
    const cleanName = rawName.trim();
    if (!cleanName) return null;
    setIsRefreshingApi(true);
    setApiStatusMessage(`'${cleanName}' OpenDART 실시간 재무제표 원문 요청 중...`);

    const { record, errorMsg } = await fetchLiveDartCompanyRecord(cleanName, apiKey);
    setIsRefreshingApi(false);

    if (!record) {
      setApiStatusMessage(errorMsg || `'${cleanName}' 데이터를 가져오지 못했습니다.`);
      return null;
    }

    setCompanies((prev) => {
      const idx = prev.findIndex(
        (c) => c.corpCode === record.corpCode || c.corpName === record.corpName
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record];
    });
    setApiStatusMessage(`✓ ${record.corpName} (${record.period}) OpenDART 원문 데이터 반영 완료`);
    return record;
  };

  const handleRunAskSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : askQuery).trim();
    const clean = q.toLowerCase();

    const isMulti = /4개년|4년|3개년|3년|2개년|다년도|연도별|추이|개년|변화|흐름|역대/.test(clean);
    setAskMultiYearMode(isMulti);

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

    let matchedCorp = companies.find((c) => clean.includes(c.corpName.toLowerCase()));
    if (!matchedCorp && allCorpMaster.length > 0) {
      const masterHit = allCorpMaster.find(
        (m) => m.corpName.length >= 2 && clean.includes(m.corpName.toLowerCase())
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
              하드코딩 없이 100% 실제 OpenDART API 원문으로만 작동합니다. 40자리 인증키를 입력해 주세요.
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
                  if (!trimmed || trimmed.length < 20) {
                    alert("유효한 40자리 OpenDART API 인증키를 입력해 주세요.");
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
                위 입력칸에 <strong>붙여넣기(Ctrl + V)</strong> 한 뒤 <strong>[인증키 저장 후 시작하기]</strong>를 누르면 실시간 연결됩니다.
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] flex flex-col md:flex-row text-slate-900">
      <datalist id="dart-all-corps-list">
        {allCorpMaster.map((c) => (
          <option key={c.corpCode} value={c.corpName}>
            {c.stockCode}
          </option>
        ))}
      </datalist>

      {/* 산식 분해 모달 */}
      {breakdownModalMetric.isOpen && breakdownModalMetric.metric && currentCompany && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-extrabold">
                  OpenDART 원문 산식 분해기
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
                <div className="font-bold text-slate-600">
                  산식: {breakdownModalMetric.metric.formulaText}
                </div>
                <div className="text-emerald-900 font-extrabold text-base">
                  산출 결과:{" "}
                  {formatMetricValue(
                    breakdownModalMetric.metric.computeFromAccounts(currentCompany.accounts),
                    breakdownModalMetric.metric.unit
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 bg-white p-3 rounded-lg border border-slate-200">
                <div>자산총계: {formatMetricValue(currentCompany.accounts.자산총계, "억원")}</div>
                <div>영업이익: {formatMetricValue(currentCompany.accounts.영업이익, "억원")}</div>
                <div>감가상각비: {formatMetricValue(currentCompany.accounts.감가상각비, "억원")}</div>
                <div>무형자산상각비: {formatMetricValue(currentCompany.accounts.무형자산상각비, "억원")}</div>
                <div>단기차입금: {formatMetricValue(currentCompany.accounts.단기차입금, "억원")}</div>
                <div>유동성장기부채: {formatMetricValue(currentCompany.accounts.유동성장기부채, "억원")}</div>
                <div>사채: {formatMetricValue(currentCompany.accounts.사채, "억원")}</div>
                <div>장기차입금: {formatMetricValue(currentCompany.accounts.장기차입금, "억원")}</div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <a
                href={buildDartDirectUrl(currentCompany.rceptNo, currentCompany.corpName)}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1"
              >
                재무제표 원문 보기 (#{currentCompany.rceptNo}) <ExternalLink className="w-3.5 h-3.5" />
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

      {/* 좌측 사이드바 */}
      <aside className="w-full md:w-64 bg-[#0b241d] text-white flex flex-col justify-between p-5 shrink-0 print:hidden">
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
              onClick={() => setActiveTab("ADVANCED")}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ADVANCED"
                  ? "bg-amber-500 text-slate-950 shadow-sm"
                  : "bg-emerald-950/60 text-amber-300 hover:bg-emerald-900/70"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4" /> 고급 재무 분석
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200 font-extrabold">
                PRO
              </span>
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

        {!currentCompany || !currentIntel ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-4">
            {isRefreshingApi ? (
              <>
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-700" />
                <div className="text-base font-bold text-slate-800">
                  OpenDART 서버에서 실시간 재무제표 원문을 수신하고 있습니다...
                </div>
              </>
            ) : (
              <>
                <div className="text-base font-bold text-rose-700">
                  {apiStatusMessage || "OpenDART API 응답을 받지 못했습니다. 40자리 인증키를 확인해 주세요."}
                </div>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => handleFetchOrRegisterCompany("대한전선")}
                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-bold"
                  >
                    다시 시도
                  </button>
                  <button
                    onClick={() => {
                      setApiInputDraft(apiKey);
                      setIsApiGateOpen(true);
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold"
                  >
                    API 인증키 재입력
                  </button>
                </div>
              </>
            )}
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
                      하드코딩 없이 OpenDART 원문 API에서 실시간으로 파싱된 재무 수치입니다.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveTab("ADVANCED")}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-xs"
                    >
                      <Sliders className="w-3.5 h-3.5" /> 고급 재무 분석 열기 ↗
                    </button>
                    <button
                      onClick={() => handleFetchOrRegisterCompany(currentCompany.corpName)}
                      disabled={isRefreshingApi}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingApi ? "animate-spin" : ""}`} />
                      실시간 재조회
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
                  <span className="text-xs font-bold text-slate-500">기준 기업</span>
                  <select
                    value={selectedCorpName}
                    onChange={(e) => setSelectedCorpName(e.target.value)}
                    className="px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-white"
                  >
                    {companies.map((c) => (
                      <option key={c.corpCode + c.corpName} value={c.corpName}>
                        {c.corpName} ({c.stockCode})
                      </option>
                    ))}
                  </select>

                  {!showAddCorpInput ? (
                    <button
                      onClick={() => setShowAddCorpInput(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> 타 기업 직접 추가
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
                        placeholder="기업명 또는 8자리 고유번호 입력 (예: 가온전선, LS, 삼성전자)"
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

                <div className="bg-[#082f27] text-white rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold tracking-wider text-emerald-300 uppercase">
                      LIVE OPEN DART API
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
                  <div className="flex items-center gap-2">
                    <a
                      href={buildDartDirectUrl(currentCompany.rceptNo, currentCompany.corpName)}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition inline-flex items-center gap-1.5"
                    >
                      재무제표 원문 보기 <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => {
                        setAskCorpName(currentCompany.corpName);
                        setAskSelectedMetricId("차입금의존도");
                        setAskQuery(`${currentCompany.corpName} 차입금의존도 지난 4개년치`);
                        setAskMultiYearMode(true);
                        setActiveTab("ASK");
                      }}
                      className="px-4 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900 text-white text-xs font-bold transition"
                    >
                      질문으로 파고들기 ↗
                    </button>
                  </div>
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
                            href={buildDartDirectUrl(
                              currentCompany.rceptNo,
                              currentCompany.corpName
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 font-bold hover:underline inline-flex items-center gap-1"
                          >
                            재무제표 원문 보기 ↗
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 커스텀 지표 */}
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

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                              원문 보기 ↗
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                [탭 2] 고급 재무 분석
               ================================================================ */}
            {activeTab === "ADVANCED" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-extrabold mb-1">
                      ADVANCED FINANCIAL INTELLIGENCE
                    </span>
                    <h1 className="text-2xl font-extrabold text-slate-900">
                      고급 재무 분석 (Say-Do 추적 · 실시간 P&L 슬라이더 · 이익의 질 포렌식)
                    </h1>
                    <p className="text-sm text-slate-600 mt-0.5">
                      가짜 추정식 0% — OpenDART 원문 계정과 사용자가 지정한 시나리오 변수만으로 연산합니다.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedCorpName}
                      onChange={(e) => setSelectedCorpName(e.target.value)}
                      className="px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-bold bg-white"
                    >
                      {companies.map((c) => (
                        <option key={c.corpCode + c.corpName} value={c.corpName}>
                          {c.corpName} ({c.period})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        setSimCostRateDelta(0);
                        setSimInterestDelta(0);
                        setSimFxDelta(0);
                        setSimFxExposurePct(0);
                        setCustomCapexPlanInput("");
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> 초기화
                    </button>
                  </div>
                </div>

                {/* 기능 2 & 4: 실시간 P&L 민감도 슬라이더 */}
                <div className="bg-white border-2 border-emerald-800/20 rounded-2xl p-6 shadow-xs space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                        <Sliders className="w-5 h-5 text-emerald-700" />
                        [기능 2 · 4] 실시간 P&L 민감도 슬라이더 (What-If Simulator)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        DART 원문 베이스 ({currentCompany.period}): 매출액 {currentIntel.rev.toLocaleString()}억 · 영업이익 {currentIntel.op.toLocaleString()}억 · 총차입금 {currentIntel.totalDebt.toLocaleString()}억(차입금의존도 {currentIntel.debtDependencyPct}%) · 금융원가 {currentIntel.finCost.toLocaleString()}억
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setSimCostRateDelta(2.0);
                          setSimInterestDelta(1.0);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold"
                      >
                        🔥 스트레스 시나리오 (원가율 +2%p / 금리 +1%p)
                      </button>
                      <button
                        onClick={() => {
                          setSimCostRateDelta(-1.0);
                          setSimInterestDelta(-0.5);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold"
                      >
                        🚀 우호적 시나리오 (원가율 -1%p / 금리 -0.5%p)
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-800">
                          ① 원자재 / 매출원가율 변동 (%p)
                        </span>
                        <span className="text-sm font-black px-2 py-0.5 rounded bg-white border border-slate-200">
                          {simCostRateDelta > 0 ? `+${simCostRateDelta}` : simCostRateDelta}%p
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-5}
                        max={5}
                        step={0.25}
                        value={simCostRateDelta}
                        onChange={(e) => setSimCostRateDelta(Number(e.target.value))}
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                      <div className="text-xs font-bold text-slate-700 pt-1">
                        영업이익 타격: {currentIntel.costImpact.toLocaleString()}억원
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-800">
                          ② 차입 금리 변동 (%p)
                        </span>
                        <span className="text-sm font-black px-2 py-0.5 rounded bg-white border border-slate-200">
                          {simInterestDelta > 0 ? `+${simInterestDelta}` : simInterestDelta}%p
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-2}
                        max={3}
                        step={0.25}
                        value={simInterestDelta}
                        onChange={(e) => setSimInterestDelta(Number(e.target.value))}
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                      <div className="text-xs font-bold text-slate-700 pt-1">
                        금융원가 증감: {currentIntel.interestImpact.toLocaleString()}억원
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-800">
                          ③ 환율 변동(%) × 외화노출비중({simFxExposurePct}%)
                        </span>
                        <span className="text-sm font-black px-2 py-0.5 rounded bg-white border border-slate-200">
                          {simFxDelta > 0 ? `+${simFxDelta}` : simFxDelta}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={1}
                        value={simFxDelta}
                        onChange={(e) => setSimFxDelta(Number(e.target.value))}
                        className="w-full accent-emerald-700 cursor-pointer"
                      />
                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span>외화노출비중(%):</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={simFxExposurePct}
                          onChange={(e) => setSimFxExposurePct(Number(e.target.value) || 0)}
                          className="w-16 px-2 py-0.5 border border-slate-300 rounded bg-white text-right font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
                    <div className="p-4 rounded-xl bg-[#082f27] text-white space-y-1">
                      <div className="text-xs text-emerald-200 font-bold">시뮬레이션 영업이익</div>
                      <div className="text-2xl font-black">
                        {currentIntel.simulatedOp.toLocaleString()}억원
                      </div>
                      <div className="text-xs text-emerald-300">
                        기존 {currentIntel.op.toLocaleString()}억 ({currentIntel.opDropPct > 0 ? `+${currentIntel.opDropPct}%` : `${currentIntel.opDropPct}%`})
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-900 text-white space-y-1">
                      <div className="text-xs text-slate-300 font-bold">시뮬레이션 당기순이익</div>
                      <div className="text-2xl font-black">
                        {currentIntel.simulatedNet.toLocaleString()}억원
                      </div>
                      <div className="text-xs text-slate-400">
                        기존 {currentIntel.net.toLocaleString()}억
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 space-y-1">
                      <div className="text-xs text-slate-600 font-bold">시뮬레이션 금융원가</div>
                      <div className="text-2xl font-black text-slate-900">
                        {currentIntel.simulatedFinCost.toLocaleString()}억원
                      </div>
                      <div className="text-xs text-slate-500">
                        기존 {currentIntel.finCost.toLocaleString()}억
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-1">
                      <div className="text-xs font-bold">이자보상배율</div>
                      <div className="text-2xl font-black">
                        {currentIntel.simulatedIcr !== null ? `${currentIntel.simulatedIcr}배` : "미기재"}
                      </div>
                      <div className="text-xs">
                        기존: {currentIntel.baseIcr !== null ? `${currentIntel.baseIcr}배` : "-"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 기능 1 & 3 */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 flex flex-col justify-between">
                    <div className="space-y-2">
                      <span className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                        <Target className="w-4 h-4" /> [기능 1] 경영진 '계획(Say)' vs '실제 집행(Do)' 괴리율 추적기
                      </span>
                      <h3 className="text-lg font-extrabold text-slate-900">
                        현금흐름표 실제 누적 CAPEX:{" "}
                        <span className="text-emerald-700">
                          {currentIntel.cumulativeActualCapex.toLocaleString()}억원
                        </span>
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        공시된 설비투자 계획금액을 입력하면 현금흐름표상 실제 유형자산 취득 누적액과 대조해 달성률(%)을 산출합니다.
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-700">
                          공시된 설비투자 계획금액 입력(억원):
                        </span>
                        <input
                          type="number"
                          value={customCapexPlanInput}
                          onChange={(e) => setCustomCapexPlanInput(e.target.value)}
                          placeholder="예: 3400"
                          className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs w-36 bg-white font-bold text-right"
                        />
                      </div>
                      <div className="flex justify-between pt-2 border-t border-slate-200">
                        <span className="text-slate-500">계획 대비 실제 누적 집행률:</span>
                        <span className="font-extrabold text-emerald-800 text-sm">
                          {currentIntel.sayDoRatioPct !== null
                            ? `${currentIntel.sayDoRatioPct}%`
                            : "계획금액 입력 시 산출"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                          <Activity className="w-4 h-4" /> [기능 3] 이익의 질(QoE) & 흑자착시 포렌식 스캐너
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-900">
                          {currentIntel.forensicStatus}
                        </span>
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-900">
                        영업현금흐름(OCF) - 영업이익 괴리:{" "}
                        <span className="text-emerald-700">
                          {currentIntel.accrualGapEok > 0
                            ? `+${currentIntel.accrualGapEok.toLocaleString()}`
                            : currentIntel.accrualGapEok.toLocaleString()}
                          억원
                        </span>
                      </h3>
                      <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
                        {currentIntel.forensicDiagnosis}
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">영업이익 vs 영업활동현금흐름(OCF):</span>
                        <span className="font-bold">
                          {currentIntel.op.toLocaleString()}억 vs{" "}
                          {currentIntel.ocf.toLocaleString()}억
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">매출채권 + 재고자산 합산액:</span>
                        <span className="font-bold">
                          {(currentIntel.ar + currentIntel.inv).toLocaleString()}억원 (순운전자본{" "}
                          {currentIntel.nwc.toLocaleString()}억)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================================================================
                [탭 3] 질문하기
               ================================================================ */}
            {activeTab === "ASK" && askResultCompany && (
              <div className="space-y-6">
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
                        <option key={c.corpCode + c.corpName} value={c.corpName}>
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
                        placeholder="예: 대한전선 차입금의존도, 대한전선 EBITDA 지난 4개년치"
                        className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm"
                      />
                      <button
                        onClick={() => handleRunAskSearch()}
                        className="px-5 py-2.5 bg-[#0b3b2c] text-white rounded-xl text-sm font-bold"
                      >
                        검색
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {filteredCategoryMetrics.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setAskSelectedMetricId(m.id);
                          setAskQuery(`${askCorpName} ${m.label} 지난 4개년치`);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                          askSelectedMetricId === m.id
                            ? "bg-emerald-700 text-white"
                            : "bg-slate-50 border border-slate-200 text-slate-700"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-x-auto">
                  <table className="w-full text-sm border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 text-xs">
                        <th className="border border-slate-200 px-4 py-2.5 text-left">기업명</th>
                        <th className="border border-slate-200 px-4 py-2.5 text-left">지표명</th>
                        <th className="border border-slate-200 px-4 py-2.5 text-center">기준기간</th>
                        <th className="border border-slate-200 px-4 py-2.5 text-right">검색값</th>
                        <th className="border border-slate-200 px-4 py-2.5 text-left">산식 및 근거</th>
                        <th className="border border-slate-200 px-4 py-2.5 text-left">공시 원문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {askExportRows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="border border-slate-200 px-4 py-3 font-bold">
                            {row.corpName}
                          </td>
                          <td className="border border-slate-200 px-4 py-3 font-bold">
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
                              className="text-emerald-700 font-bold hover:underline"
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
            )}

            {/* ================================================================
                [탭 4] 비교분석
               ================================================================ */}
            {activeTab === "COMPARE" && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-extrabold text-slate-900">
                      1. 비교기업 추가 ({compareCorpNames.length}개 선택됨)
                    </h2>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        list="dart-all-corps-list"
                        value={compareSearchInput}
                        onChange={(e) => setCompareSearchInput(e.target.value)}
                        placeholder="비교할 기업명 입력 (예: 가온전선, LS)"
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
                        className="px-3.5 py-1.5 bg-[#0b3b2c] text-white rounded-xl text-xs font-bold"
                      >
                        + 기업 등록
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 overflow-x-auto">
                  <table className="w-full text-sm border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 text-xs">
                        <th className="border border-slate-200 px-4 py-3 text-left">기업</th>
                        {compareMetricIds.map((mId) => (
                          <th key={mId} className="border border-slate-200 px-4 py-3 text-right">
                            {METRIC_DEFINITIONS.find((m) => m.id === mId)?.label}
                          </th>
                        ))}
                        <th className="border border-slate-200 px-4 py-3 text-left">원문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareCorpNames.map((cName) => {
                        const comp = companies.find((c) => c.corpName === cName);
                        if (!comp) return null;
                        return (
                          <tr key={cName}>
                            <td className="border border-slate-200 px-4 py-3.5 font-extrabold">
                              {comp.corpName}
                            </td>
                            {compareMetricIds.map((mId) => {
                              const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                              return (
                                <td
                                  key={mId}
                                  className="border border-slate-200 px-4 py-3.5 text-right font-bold"
                                >
                                  {formatMetricValue(
                                    mDef.computeFromAccounts(comp.accounts),
                                    mDef.unit
                                  )}
                                </td>
                              );
                            })}
                            <td className="border border-slate-200 px-4 py-3.5 text-xs">
                              <a
                                href={buildDartDirectUrl(comp.rceptNo, comp.corpName)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-700 font-bold hover:underline"
                              >
                                {comp.reportName} (#{comp.rceptNo}) ↗
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ================================================================
                [탭 5] 1-Pager 종합보고서
               ================================================================ */}
            {activeTab === "ONE_PAGER" && (
              <div className="bg-[#faf9f5] text-stone-900 border border-stone-300 rounded-2xl p-6 md:p-8 space-y-5">
                <div className="flex items-center justify-between border-b border-stone-300 pb-4 print:hidden">
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-900 text-white">
                    {currentCompany.verificationNote}
                  </span>
                  <button
                    onClick={() => window.print()}
                    className="px-3.5 py-1.5 rounded-lg bg-stone-900 text-white text-xs font-bold"
                  >
                    1-Pager 인쇄 / PDF
                  </button>
                </div>

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
                          "EBITDA",
                          "순이익",
                          "자산총계",
                          "부채총계",
                          "자본총계",
                          "부채비율",
                          "차입금",
                          "차입금의존도",
                          "운전자본",
                          "영업현금흐름",
                          "CAPEX",
                          "FCF",
                        ] as const
                      ).map((mId) => {
                        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                        return (
                          <tr key={mId}>
                            <td className="border border-stone-200 px-3 py-2 font-bold">
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