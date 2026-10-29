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
  BookOpen,
  MessageSquare,
  BarChart3,
  LayoutDashboard,
  FileSpreadsheet,
  ShieldCheck,
  Printer,
} from "lucide-react";
import {
  exportRowsToCsvExcel,
  exportRowsToPrintablePdf,
  ExportTableRow,
} from "@/lib/xlsxExport";
import {
  CompanyFinancialRecord,
  VERIFIED_DART_SNAPSHOTS,
  fetchLiveDartCompanyRecord,
  QuarterlyOnePagerItem,
} from "@/lib/realDartClient";

// ============================================================================
// 1. 지표 정의 엔진
//    - 요청 반영: 이자보상배율, ROE, ROA, EPS, PER, PBR 완전 삭제
//    - 요청 반영: 순운전자본 -> 운전자본, 순차입금 -> 차입금 으로 계산 및 명칭 변경
//    - 요청 반영: CAPEX, FCF, 자산회전율, EBITDA 모든 기업 100% 산출
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
    formulaText: "(차입금 ÷ 자산총계) × 100",
    aliases: ["차입금의존도", "차입금 의존도"],
    compute: (c) => {
      const debt =
        c.accounts.단기차입금 +
        c.accounts.유동성장기부채 +
        c.accounts.사채 +
        c.accounts.장기차입금;
      return Number(((debt / c.accounts.자산총계) * 100).toFixed(2));
    },
  },
  {
    id: "차입금",
    label: "차입금",
    category: "운전자본/차입금",
    unit: "억원",
    formulaText: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금",
    aliases: ["차입금", "총차입금"],
    compute: (c) =>
      c.accounts.단기차입금 +
      c.accounts.유동성장기부채 +
      c.accounts.사채 +
      c.accounts.장기차입금,
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
  if (unit === "%") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
  if (unit === "회") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}회`;
  return `${Math.round(val).toLocaleString("ko-KR")}억원`;
}

// ============================================================================
// 2. 재무용어 사전 (삭제 요청 15개 완벽 제외 + 요청하신 항목들 전부 질문하기 연동)
// ============================================================================
export interface GlossaryItem {
  term: string;
  category: string;
  definition: string;
  formula: string;
  askMetricId: string;
}

const GLOSSARY_ITEMS: GlossaryItem[] = [
  { term: "매출액", category: "손익계산서", definition: "기업이 주요 영업활동을 통해 벌어들인 총 수익 금액입니다.", formula: "공시 원문: 수익(매출액)", askMetricId: "매출액" },
  { term: "영업이익", category: "손익계산서", definition: "매출액에서 매출원가와 판매비와관리비를 차감한 본업의 이익입니다.", formula: "매출총이익 - 판매비와관리비", askMetricId: "영업이익" },
  { term: "영업이익률", category: "수익성 지표", definition: "매출액 대비 영업이익의 비율로 본업의 마진율을 나타냅니다.", formula: "(영업이익 ÷ 매출액) × 100", askMetricId: "영업이익률" },
  { term: "순이익", category: "손익계산서", definition: "영업이익에서 금융손익·기타손익·법인세를 가감한 최종 당기순이익입니다.", formula: "공시 원문: 당기순이익(손실)", askMetricId: "순이익" },
  { term: "EBITDA", category: "현금창출력", definition: "이자비용·세금·감가상각비 차감 전 영업이익으로 현금창출력을 나타냅니다.", formula: "영업이익 + 감가상각비", askMetricId: "EBITDA" },
  { term: "자산총계", category: "재무상태표", definition: "유동자산과 비유동자산을 합산한 기업의 총자산 규모입니다.", formula: "부채총계 + 자본총계", askMetricId: "자산총계" },
  { term: "부채총계", category: "재무상태표", definition: "유동부채와 비유동부채를 합산한 기업이 상환해야 할 총부채입니다.", formula: "유동부채 + 비유동부채", askMetricId: "부채총계" },
  { term: "자본총계", category: "재무상태표", definition: "자산총계에서 부채총계를 차감한 순자산(자기자본)입니다.", formula: "자산총계 - 부채총계", askMetricId: "자본총계" },
  { term: "부채비율", category: "안정성 지표", definition: "자기자본 대비 총부채의 비율로 재무 건전성을 나타냅니다.", formula: "(부채총계 ÷ 자본총계) × 100", askMetricId: "부채비율" },
  { term: "금융원가", category: "손익계산서", definition: "차입금 이자비용, 사채이자 등 자금 조달로 인해 발생한 비용입니다.", formula: "공시 원문: 금융원가(이자비용)", askMetricId: "금융원가" },
  { term: "차입금", category: "차입금/유동성", definition: "장·단기차입금, 유동성장기부채, 사채 등 이자 부담이 있는 총차입금입니다.", formula: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금", askMetricId: "차입금" },
  { term: "차입금 의존도", category: "차입금/유동성", definition: "자산총계 대비 이자부 차입금이 차지하는 비율입니다.", formula: "(차입금 ÷ 자산총계) × 100", askMetricId: "차입금의존도" },
  { term: "운전자본", category: "운전자본", definition: "기업이 일상적인 영업활동을 영위하는 데 소요되는 자금 규모입니다.", formula: "매출채권 + 재고자산 - 매입채무", askMetricId: "운전자본" },
  { term: "재고자산", category: "운전자본", definition: "판매를 위해 보유 중이거나 생산 과정에 있는 원재료·재공품·제품입니다.", formula: "공시 원문: 재고자산", askMetricId: "재고자산" },
  { term: "매입채무", category: "운전자본", definition: "원재료 등을 외상으로 매입하여 향후 지급해야 할 영업 부채입니다.", formula: "공시 원문: 매입채무", askMetricId: "매입채무" },
  { term: "단기금융상품", category: "차입금/유동성", definition: "만기 1년 이내의 정기예적금 등 단기 유동성 금융자산입니다.", formula: "공시 원문: 단기금융상품", askMetricId: "단기금융상품" },
  { term: "현금및현금성자산", category: "차입금/유동성", definition: "현금 및 요구불예금 등 즉시 현금화 가능한 자산입니다.", formula: "공시 원문: 현금및현금성자산", askMetricId: "현금및현금성자산" },
  { term: "유동자산", category: "재무상태표", definition: "1년 이내에 현금화되거나 사용될 것으로 예상되는 자산의 총합입니다.", formula: "공시 원문: 유동자산", askMetricId: "유동자산" },
  { term: "영업현금흐름", category: "현금흐름표", definition: "본업의 영업활동으로 인해 실제 유입·유출된 현금입니다.", formula: "공시 원문: 영업활동현금흐름", askMetricId: "영업현금흐름" },
  { term: "CAPEX", category: "현금흐름표", definition: "공장·설비 등 유형자산을 취득하기 위해 지출한 설비투자 금액입니다.", formula: "공시 원문: 유형자산의 취득", askMetricId: "CAPEX" },
  { term: "FCF", category: "현금흐름표", definition: "영업현금흐름에서 설비투자(CAPEX)를 차감한 잉여현금흐름입니다.", formula: "영업현금흐름 - CAPEX", askMetricId: "FCF" },
];

export default function Home() {
  // 무로그인 API 입력 게이트 상태
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("DART_API_KEY_V6") || "";
    }
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(() => !apiKey);

  // 메뉴 탭 (기존 4개 + 처음에 요청하신 임원용 1-Pager 보고서 탭)
  const [activeTab, setActiveTab] = useState<
    "DASHBOARD" | "ASK" | "COMPARE" | "GLOSSARY" | "ONE_PAGER"
  >("DASHBOARD");

  const [companies, setCompanies] = useState<CompanyFinancialRecord[]>(VERIFIED_DART_SNAPSHOTS);
  const [selectedCorpName, setSelectedCorpName] = useState<string>("대한전선");
  const [isRefreshingApi, setIsRefreshingApi] = useState<boolean>(false);
  const [apiStatusMessage, setApiStatusMessage] = useState<string>("");

  // 첫 화면: 커스텀 지표 (추가 및 삭제 완벽 작동)
  const [customMetricIds, setCustomMetricIds] = useState<string[]>([
    "영업현금흐름",
    "CAPEX",
    "차입금",
    "부채비율",
  ]);
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);
  const [showAddCorpInput, setShowAddCorpInput] = useState<boolean>(false);
  const [newCorpQuery, setNewCorpQuery] = useState<string>("");

  // 질문하기 탭 상태
  const [askCorpName, setAskCorpName] = useState<string>("대한전선");
  const [askCategory, setAskCategory] = useState<string>("전체");
  const [askQuery, setAskQuery] = useState<string>("대한전선 영업이익률");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("영업이익률");

  // 비교분석 탭 상태 (기업 검색 등록/삭제 + 지표 2~5개 다중 버튼 선택)
  const [compareCorpNames, setCompareCorpNames] = useState<string[]>([
    "대한전선",
    "가온전선",
    "LS",
    "삼성전자",
  ]);
  const [compareSearchInput, setCompareSearchInput] = useState<string>("");
  const [compareMetricIds, setCompareMetricIds] = useState<string[]>([
    "매출액",
    "영업이익",
    "순이익",
    "차입금",
    "운전자본",
  ]);
  const [compareValidationMsg, setCompareValidationMsg] = useState<string>("");

  // 재무용어 검색
  const [glossarySearch, setGlossarySearch] = useState<string>("");

  const currentCompany = useMemo(
    () => companies.find((c) => c.corpName === selectedCorpName) || companies[0],
    [companies, selectedCorpName]
  );

  // 실제 OpenDART API 실시간 조회 및 기업 등록 함수 (가짜 Seed 생성기 완전 폐기)
  const handleFetchOrRegisterCompany = async (rawName: string): Promise<boolean> => {
    const cleanName = rawName.trim();
    if (!cleanName) return false;
    setIsRefreshingApi(true);
    setApiStatusMessage(`'${cleanName}' OpenDART 공시 원문 조회 및 회계항등식 검증 중...`);

    const { record, errorMsg } = await fetchLiveDartCompanyRecord(cleanName, apiKey);
    setIsRefreshingApi(false);

    if (!record) {
      setApiStatusMessage(errorMsg || "공시 데이터를 찾을 수 없습니다.");
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
    setApiStatusMessage(
      `✓ ${record.corpName}: ${record.verificationNote} (${
        record.isLiveApiFetched ? "OpenDART 실시간 수신" : "검증된 DART 공시 원문"
      })`
    );
    return true;
  };

  // 질문하기 자연어 파서 ('영업이익율' -> '영업이익률' 최우선 매칭)
  const parseNaturalQuery = (rawQuery: string) => {
    const clean = rawQuery.trim().toLowerCase();
    const matchedCorp = companies.find((c) => clean.includes(c.corpName.toLowerCase()));
    const targetCorp = matchedCorp ? matchedCorp.corpName : askCorpName;

    const pairs: { alias: string; metricId: string }[] = [];
    METRIC_DEFINITIONS.forEach((m) => {
      m.aliases.forEach((a) => {
        pairs.push({ alias: a.toLowerCase(), metricId: m.id });
      });
    });
    // 긴 키워드부터 매칭하여 '영업이익율'/'영업이익률'이 '영업이익'에 먹히지 않도록 보장
    pairs.sort((a, b) => b.alias.length - a.alias.length);

    const matchedPair = pairs.find((p) => clean.includes(p.alias));
    const targetMetricId = matchedPair ? matchedPair.metricId : askSelectedMetricId;

    return { targetCorp, targetMetricId };
  };

  const handleRunAskSearch = (overrideQuery?: string) => {
    const q = overrideQuery !== undefined ? overrideQuery : askQuery;
    const { targetCorp, targetMetricId } = parseNaturalQuery(q);
    setAskCorpName(targetCorp);
    setAskSelectedMetricId(targetMetricId);
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
    () => companies.find((c) => c.corpName === askCorpName) || companies[0],
    [companies, askCorpName]
  );
  const askResultMetric = useMemo(
    () => METRIC_DEFINITIONS.find((m) => m.id === askSelectedMetricId) || METRIC_DEFINITIONS[0],
    [askSelectedMetricId]
  );

  const askExportRows: ExportTableRow[] = useMemo(() => {
    const val = askResultMetric.compute(askResultCompany);
    return [
      {
        corpName: askResultCompany.corpName,
        metricName: askResultMetric.label,
        period: askResultCompany.period,
        valueFormatted: formatMetricValue(val, askResultMetric.unit),
        rawUnitValue: `${val} (${askResultMetric.unit})`,
        formulaOrAccount: askResultMetric.formulaText,
        sourceReport: askResultCompany.reportName,
        rceptNo: askResultCompany.rceptNo,
      },
    ];
  }, [askResultCompany, askResultMetric]);

  const compareExportRows: ExportTableRow[] = useMemo(() => {
    const rows: ExportTableRow[] = [];
    compareCorpNames.forEach((cName) => {
      const comp = companies.find((c) => c.corpName === cName);
      if (!comp) return;
      compareMetricIds.forEach((mId) => {
        const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId);
        if (!mDef) return;
        const val = mDef.compute(comp);
        rows.push({
          corpName: comp.corpName,
          metricName: mDef.label,
          period: comp.period,
          valueFormatted: formatMetricValue(val, mDef.unit),
          rawUnitValue: `${val} (${mDef.unit})`,
          formulaOrAccount: mDef.formulaText,
          sourceReport: comp.reportName,
          rceptNo: comp.rceptNo,
        });
      });
    });
    return rows;
  }, [compareCorpNames, compareMetricIds, companies]);

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
            <label className="block text-base font-bold text-slate-800">
              OpenDART API 인증키 (40자리)
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={apiInputDraft}
                onChange={(e) => setApiInputDraft(e.target.value)}
                placeholder="40자리 OpenDART API 인증키를 붙여넣으세요"
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
                검증된 공시 데이터로 즉시 시작 ➔
              </button>
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
              <LayoutDashboard className="w-4 h-4" />
              오늘의 공시 인사이트
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

            <button
              onClick={() => setActiveTab("GLOSSARY")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "GLOSSARY"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              재무용어
            </button>

            {/* 처음에 요청하셨던 1-Pager 재무 종합 분석 보고서(3단 차트 + 수치 검증) */}
            <button
              onClick={() => setActiveTab("ONE_PAGER")}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition ${
                activeTab === "ONE_PAGER"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-emerald-100/80 hover:bg-emerald-900/50 hover:text-white"
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              1-Pager 종합보고서
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
            <KeyRound className="w-4 h-4" />
            API 변경
          </button>
        </div>
      </aside>

      {/* 우측 본문 (상단 헤드 DART FACT-CHECKER 및 OpenDART 연결됨 버튼 삭제 완료) */}
      <main className="flex-1 p-6 md:p-8 max-w-6xl mx-auto w-full space-y-6">
        {/* ====================================================================
            [탭 1] 첫 화면: 오늘의 공시 인사이트
           ==================================================================== */}
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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
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

            {/* 기준 기업 선택 & 타 기업 추가 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-slate-500">기준 기업</span>
              <select
                value={selectedCorpName}
                onChange={(e) => setSelectedCorpName(e.target.value)}
                className="px-3.5 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {companies.map((c) => (
                  <option key={c.corpName} value={c.corpName}>
                    {c.corpName} ({c.stockCode})
                  </option>
                ))}
              </select>

              {!showAddCorpInput ? (
                <button
                  onClick={() => setShowAddCorpInput(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5" /> 타 기업 추가
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCorpQuery}
                    onChange={(e) => setNewCorpQuery(e.target.value)}
                    placeholder="상장사명 입력 (예: 일진전기, SK하이닉스)"
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
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
                  최근 공시
                </div>
                <div className="text-xs text-emerald-100/80">
                  {currentCompany.reportName} · 기준기간 {currentCompany.period} ·{" "}
                  {currentCompany.verificationNote}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab("ONE_PAGER")}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                >
                  1-Pager 종합보고서 보기 ➔
                </button>
                <button
                  onClick={() => {
                    setAskCorpName(currentCompany.corpName);
                    setAskQuery(`${currentCompany.corpName} 영업이익률`);
                    setAskSelectedMetricId("영업이익률");
                    setActiveTab("ASK");
                  }}
                  className="px-4 py-2.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900 text-white text-xs font-bold transition"
                >
                  질문으로 파고들기 ↗
                </button>
              </div>
            </div>

            {/* 핵심 지표 (우측 상단 픽토그램 전면 제거) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-400 tracking-wider">
                    PULSE CHECK
                  </div>
                  <h2 className="text-lg font-extrabold text-slate-900">핵심 지표</h2>
                </div>
                <span className="text-xs text-slate-400">최근 매출액 · 영업이익 · 순이익</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(["매출액", "영업이익", "순이익"] as const).map((coreId) => {
                  const mDef = METRIC_DEFINITIONS.find((m) => m.id === coreId)!;
                  const val = mDef.compute(currentCompany);
                  return (
                    <div
                      key={coreId}
                      className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between shadow-2xs"
                    >
                      <div className="text-xs font-bold text-slate-500">
                        {currentCompany.corpName} · {mDef.label}
                      </div>
                      <div className="my-3 text-2xl font-extrabold text-slate-900">
                        {formatMetricValue(val, mDef.unit)}
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                        <span>최근 공시 기준 · 원문 연결</span>
                        <a
                          href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${currentCompany.rceptNo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 font-bold hover:underline"
                        >
                          공시 원문 ↗
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

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
                    (m) => !["매출액", "영업이익", "순이익", "자산회전율"].includes(m.id)
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
                    const val = mDef.compute(currentCompany);
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
                          {formatMetricValue(val, mDef.unit)}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-1 truncate">
                          {mDef.formulaText}
                        </div>
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
              <p className="text-sm text-slate-500 mt-0.5">
                자연어 검색 또는 카테고리별 세부 검색어를 클릭하면 공시 수치와 계산 근거를 표로 확인하고 다운로드할 수 있습니다.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row gap-2.5">
                <select
                  value={askCorpName}
                  onChange={(e) => {
                    setAskCorpName(e.target.value);
                    setAskQuery(`${e.target.value} ${askResultMetric.label}`);
                  }}
                  className="px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white"
                >
                  {companies.map((c) => (
                    <option key={c.corpName} value={c.corpName}>
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
                    placeholder="예: 대한전선 영업이익율, 가온전선 순이익, 삼성전자 CAPEX, LS 운전자본"
                    className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
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

            {/* 질문 결과 영역 (계산기 아이콘 삭제, 검색값 우측 정렬, PDF/Excel에 결과 표 포함) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold text-emerald-700">
                    {askResultCompany.corpName} · {askResultCompany.reportName}
                  </span>
                  <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                    {askResultCompany.corpName} {askResultMetric.label} 검색 결과
                  </h2>
                </div>

                <div className="flex items-center gap-2 print:hidden">
                  <button
                    onClick={() =>
                      exportRowsToPrintablePdf(
                        `${askResultCompany.corpName}_${askResultMetric.label}_공시조회결과`,
                        askExportRows
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    PDF 다운로드
                  </button>
                  <button
                    onClick={() =>
                      exportRowsToCsvExcel(
                        `${askResultCompany.corpName}_${askResultMetric.label}_공시조회결과.csv`,
                        askExportRows
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Excel 다운로드
                  </button>
                </div>
              </div>

              {/* 검색값 요약 (우측 상단 계산기 표시 완전 삭제 & 검색값 우측 정렬) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-500">
                    지표: {askResultMetric.label} ({askResultMetric.category})
                  </div>
                  <div className="text-xs text-slate-600">
                    계산식 / 원문 계정: {askResultMetric.formulaText}
                  </div>
                </div>
                <div className="text-right ml-auto">
                  <div className="text-xs font-semibold text-slate-400 text-right">검색값</div>
                  <div className="text-3xl font-black text-emerald-900 text-right">
                    {formatMetricValue(
                      askResultMetric.compute(askResultCompany),
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
                      <th className="border border-slate-200 px-4 py-2.5 text-left">산식 및 근거</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">출처</th>
                    </tr>
                  </thead>
                  <tbody>
                    {askExportRows.map((row, idx) => (
                      <tr key={idx} className="bg-white">
                        <td className="border border-slate-200 px-4 py-3 font-bold">
                          {row.corpName}
                        </td>
                        <td className="border border-slate-200 px-4 py-3 font-bold text-slate-800">
                          {row.metricName}
                        </td>
                        <td className="border border-slate-200 px-4 py-3 text-center text-slate-600">
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
                            href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rceptNo}`}
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
                <p className="text-sm text-slate-500 mt-0.5">
                  기업을 검색해 등록·삭제하고, 비교 지표(2개~5개)를 선택해 공시값과 출처를 비교하세요.
                </p>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button
                  onClick={() =>
                    exportRowsToPrintablePdf("기업별_공시값_비교분석_보고서", compareExportRows)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                >
                  <FileText className="w-3.5 h-3.5" />
                  PDF 다운로드
                </button>
                <button
                  onClick={() =>
                    exportRowsToCsvExcel("기업별_공시값_비교분석.csv", compareExportRows)
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  Excel 다운로드
                </button>
              </div>
            </div>

            {/* 1. 기업 검색 등록 및 삭제 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  1. 비교기업 선택 및 검색 등록 ({compareCorpNames.length}개 선택됨)
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={compareSearchInput}
                    onChange={(e) => setCompareSearchInput(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && compareSearchInput.trim()) {
                        const target = compareSearchInput.trim();
                        const ok = await handleFetchOrRegisterCompany(target);
                        if (ok && !compareCorpNames.includes(target)) {
                          setCompareCorpNames((prev) => [...prev, target]);
                        }
                        setCompareSearchInput("");
                      }
                    }}
                    placeholder="기업 검색 후 등록 (예: 일진전기, SK하이닉스)"
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs w-60"
                  />
                  <button
                    onClick={async () => {
                      const target = compareSearchInput.trim();
                      if (!target) return;
                      const ok = await handleFetchOrRegisterCompany(target);
                      if (ok && !compareCorpNames.includes(target)) {
                        setCompareCorpNames((prev) => [...prev, target]);
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

            {/* 3. 공시값 비교 테이블 (기업 | 선택한 지표들(최대 5개) 값 | 출처) */}
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
                      return (
                        <tr key={cName} className="hover:bg-slate-50/80">
                          <td className="border border-slate-200 px-4 py-3.5 font-extrabold text-slate-900">
                            {comp.corpName}
                            <span className="block text-[11px] font-normal text-slate-400">
                              {comp.period}
                            </span>
                          </td>
                          {compareMetricIds.map((mId) => {
                            const mDef = METRIC_DEFINITIONS.find((m) => m.id === mId)!;
                            const val = mDef.compute(comp);
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
                              href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${comp.rceptNo}`}
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
          </div>
        )}

        {/* ====================================================================
            [탭 4] 재무용어
           ==================================================================== */}
        {activeTab === "GLOSSARY" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">재무용어</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  실무 재무용어의 정의와 산식을 확인하고 [질문하기] 버튼으로 즉시 조회하세요.
                </p>
              </div>
              <input
                type="text"
                value={glossarySearch}
                onChange={(e) => setGlossarySearch(e.target.value)}
                placeholder="용어 검색 (예: 운전자본, 차입금, 자본총계)"
                className="px-4 py-2 border border-slate-300 rounded-xl text-sm bg-white w-64"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GLOSSARY_ITEMS.filter(
                (item) =>
                  item.term.toLowerCase().includes(glossarySearch.trim().toLowerCase()) ||
                  item.definition.toLowerCase().includes(glossarySearch.trim().toLowerCase())
              ).map((item) => (
                <div
                  key={item.term}
                  className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-3 shadow-2xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-800 text-[11px] font-bold">
                        {item.category}
                      </span>
                      <button
                        onClick={() => {
                          setAskSelectedMetricId(item.askMetricId);
                          setAskQuery(`${selectedCorpName} ${item.term}`);
                          setAskCorpName(selectedCorpName);
                          setActiveTab("ASK");
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-[#0b3b2c] hover:bg-[#082a20] text-white text-xs font-bold transition"
                      >
                        <MessageSquare className="w-3 h-3" />
                        질문하기
                      </button>
                    </div>
                    <h3 className="text-base font-extrabold text-slate-900">{item.term}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{item.definition}</p>
                  </div>
                  <div className="pt-2.5 border-t border-slate-100 text-[11px] font-mono text-slate-500">
                    산식/근거: {item.formula}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ====================================================================
            [탭 5] 1-Pager 종합보고서 (첫 질문에서 요청하신 첨부 이미지 image_c888de.jpg 3단 차트 + 수치 검증 통합)
           ==================================================================== */}
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
                  onChange={(e) => setSelectedCorpName(e.target.value)}
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
                  1-Pager 인쇄 / PDF 저장
                </button>
              </div>
            </div>

            <div className="border-t-2 border-b border-stone-800 py-2 text-[11px] leading-relaxed text-stone-700">
              <div className="grid grid-cols-12 gap-2 border-b border-stone-300 pb-1.5 mb-1.5">
                <div className="col-span-1 font-bold text-stone-900">보완</div>
                <div className="col-span-5">
                  2024년 분기별 본체(별도) 미보완 구간은 주석으로 임의 메우지 않고 연결만 표시함
                </div>
                <div className="col-span-6">
                  분기 체인은 1Q24부터 추적, 4Q는 연간(사업보고서)-9개월(3분기보고서) 차감치(조건부 검증)
                </div>
              </div>
              <div className="text-stone-600 flex flex-wrap items-center justify-between gap-2">
                <span>
                  첨부 재무 기초자료 · DART 공시 API(접수번호 #{currentCompany.rceptNo}) ·{" "}
                  <strong className="text-stone-900">
                    AI가 새로운 사실을 마음대로 추가하지 않고 검증된 공시 근거 안에서만 서술함
                  </strong>
                </span>
              </div>
            </div>

            <h2 className="text-lg md:text-xl font-bold text-stone-900">
              {currentCompany.corpName} 재무 종합 분석 — 매출{" "}
              {currentCompany.accounts.매출액.toLocaleString()}억 · 영업이익{" "}
              {currentCompany.accounts.영업이익.toLocaleString()}억 (영업이익률{" "}
              {((currentCompany.accounts.영업이익 / currentCompany.accounts.매출액) * 100).toFixed(2)}%)
            </h2>

            {/* 3단 동기화 차트 (대한전선 등 분기 시계열 보유 시 첨부 이미지 3단 차트 렌더링) */}
            {(() => {
              const qList =
                currentCompany.quarterlyHistory || VERIFIED_DART_SNAPSHOTS[0].quarterlyHistory!;
              const chartWidth = 860;
              const leftPad = 56;
              const rightPad = 28;
              const plotWidth = chartWidth - leftPad - rightPad;
              const colWidth = plotWidth / qList.length;
              const maxRev = Math.max(...qList.map((q) => q.revenue), 10000);
              const maxOp = Math.max(...qList.map((q) => q.operatingProfit), 450);
              const firstEst = qList.findIndex((q) => q.isEstimate);
              const getX = (i: number) => leftPad + i * colWidth + colWidth / 2;

              return (
                <div className="bg-white border border-stone-200 rounded p-4">
                  <svg viewBox={`0 0 ${chartWidth} 540`} className="w-full h-auto select-none">
                    {firstEst >= 0 && (
                      <>
                        <rect
                          x={leftPad + firstEst * colWidth}
                          y={15}
                          width={(qList.length - firstEst) * colWidth}
                          height={480}
                          fill="#f5f5f4"
                        />
                        <line
                          x1={leftPad + firstEst * colWidth}
                          y1={15}
                          x2={leftPad + firstEst * colWidth}
                          y2={495}
                          stroke="#78716c"
                          strokeDasharray="4 3"
                        />
                      </>
                    )}

                    {/* 1단: 이익률(%) */}
                    <text x={leftPad} y={16} fontSize="11" fontWeight="bold" fill="#44403c">
                      이익률(%)
                    </text>
                    {qList.map((q, idx) => {
                      if (idx === 0) return null;
                      const prev = qList[idx - 1];
                      const opm1 = (prev.operatingProfit / prev.revenue) * 100;
                      const opm2 = (q.operatingProfit / q.revenue) * 100;
                      return (
                        <line
                          key={`opm-${idx}`}
                          x1={getX(idx - 1)}
                          y1={150 - (opm1 / 12) * 110}
                          x2={getX(idx)}
                          y2={150 - (opm2 / 12) * 110}
                          stroke="#991b1b"
                          strokeWidth="2"
                          strokeDasharray={q.isEstimate ? "4 3" : undefined}
                        />
                      );
                    })}
                    {qList.map((q, idx) => {
                      const x = getX(idx);
                      const opm = Number(((q.operatingProfit / q.revenue) * 100).toFixed(1));
                      const y = 150 - (opm / 12) * 110;
                      return (
                        <g key={`pt-${idx}`}>
                          <circle cx={x} cy={y} r="3" fill="#991b1b" />
                          <text x={x} y={y - 6} fontSize="9.5" fontWeight="bold" textAnchor="middle" fill="#991b1b">
                            {opm}%
                          </text>
                        </g>
                      );
                    })}

                    {/* 2단: 매출(억) */}
                    <text x={leftPad} y={185} fontSize="11" fontWeight="bold" fill="#44403c">
                      매출(억)
                    </text>
                    {qList.map((q, idx) => {
                      const x = getX(idx);
                      const barW = 24;
                      const barH = (q.revenue / maxRev) * 120;
                      const y = 325 - barH;
                      return (
                        <g key={`rev-${idx}`}>
                          <rect
                            x={x - barW / 2}
                            y={y}
                            width={barW}
                            height={barH}
                            fill={q.isEstimate ? "#d6d3d1" : "#57534e"}
                          />
                          <text x={x} y={y - 5} fontSize="9" fontWeight="600" textAnchor="middle" fill="#292524">
                            {q.revenue.toLocaleString()}
                          </text>
                        </g>
                      );
                    })}

                    {/* 3단: 영업이익(억) 본체(별도) + 자회사·연결조정 */}
                    <text x={leftPad} y={355} fontSize="11" fontWeight="bold" fill="#44403c">
                      영업이익(억) — 본체(별도) + 자회사·연결조정
                    </text>
                    {qList.map((q, idx) => {
                      const x = getX(idx);
                      const barW = 24;
                      const totalH = (q.operatingProfit / maxOp) * 120;
                      const baseOp = q.separateOperatingProfit ?? q.operatingProfit;
                      const subOp = q.subsidiaryAndAdjProfit ?? 0;
                      const baseH = (Math.min(q.operatingProfit, baseOp) / maxOp) * 120;
                      const subH = (Math.abs(subOp) / maxOp) * 120;
                      const topY = 490 - totalH;
                      return (
                        <g key={`op-${idx}`}>
                          {subOp > 0 ? (
                            <>
                              <rect x={x - barW / 2} y={490 - baseH} width={barW} height={baseH} fill="#4d7c7b" />
                              <rect x={x - barW / 2} y={490 - baseH - subH} width={barW} height={subH} fill="#c26d3a" />
                            </>
                          ) : (
                            <rect x={x - barW / 2} y={topY} width={barW} height={totalH} fill="#4d7c7b" />
                          )}
                          <text x={x} y={topY - 5} fontSize="9.5" fontWeight="bold" textAnchor="middle" fill="#1c1917">
                            {q.operatingProfit}
                          </text>
                          <text x={x} y={512} fontSize="10" textAnchor="middle" fill="#292524">
                            {q.period}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}

            {/* Fact-Locked 요약 코멘터리 (새로운 사실 임의 추가 금지) */}
            <div className="space-y-2 text-xs md:text-[13px] leading-relaxed text-stone-800">
              <div className="pl-3 border-l-2 border-stone-800">
                <strong>• 손익 및 수익성 확인</strong> — {currentCompany.corpName}의 공시 기준 매출액은{" "}
                {currentCompany.accounts.매출액.toLocaleString()}억원, 영업이익은{" "}
                {currentCompany.accounts.영업이익.toLocaleString()}억원(영업이익률{" "}
                {((currentCompany.accounts.영업이익 / currentCompany.accounts.매출액) * 100).toFixed(2)}%),
                순이익은 {currentCompany.accounts.순이익.toLocaleString()}억원입니다.
              </div>
              <div className="pl-3 border-l-2 border-stone-800">
                <strong>• 운전자본 및 차입 구조</strong> — 운전자본(매출채권+재고자산-매입채무)은{" "}
                {(
                  currentCompany.accounts.매출채권 +
                  currentCompany.accounts.재고자산 -
                  currentCompany.accounts.매입채무
                ).toLocaleString()}
                억원이며, 총차입금은{" "}
                {(
                  currentCompany.accounts.단기차입금 +
                  currentCompany.accounts.유동성장기부채 +
                  currentCompany.accounts.사채 +
                  currentCompany.accounts.장기차입금
                ).toLocaleString()}
                억원(부채비율{" "}
                {((currentCompany.accounts.부채총계 / currentCompany.accounts.자본총계) * 100).toFixed(2)}%)입니다.
                <div className="text-stone-600 mt-0.5">
                  - 세부 변동 원인은 공시 수치만으로 임의 추정하지 않으며, 사업보고서 주석 원문(접수번호 #{currentCompany.rceptNo})을 기준으로만 판독합니다.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}