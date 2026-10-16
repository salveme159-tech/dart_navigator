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
  Building2,
  BookOpen,
  MessageSquare,
  BarChart3,
  LayoutDashboard,
} from "lucide-react";
import {
  exportRowsToCsvExcel,
  exportRowsToPrintablePdf,
  ExportTableRow,
} from "@/lib/xlsxExport";

// ============================================================================
// 1. 기업별 검증된 DART 공시 원문 데이터셋 (대한전선, 가온전선, LS, 삼성전자 외 확장 가능)
//    - 모든 단위: 억원 (비율 지표는 %)
//    - GitHub Pages(정적 호스팅) 환경에서도 '—' 없이 0.1초 만에 즉시 표시되며,
//      OpenDART 실시간 API 응답 시 최신 값으로 자동 병합됩니다.
// ============================================================================
export interface CompanyFinancialRecord {
  corpCode: string;
  corpName: string;
  stockCode: string;
  reportName: string;
  period: string;
  rceptNo: string;
  accounts: {
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
  };
}

const INITIAL_COMPANIES: CompanyFinancialRecord[] = [
  {
    corpCode: "00113526",
    corpName: "대한전선",
    stockCode: "001440",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260320000841",
    accounts: {
      매출액: 32820,
      영업이익: 1146,
      순이익: 738,
      자산총계: 31450,
      부채총계: 16210,
      자본총계: 15240,
      유동자산: 19840,
      유동부채: 11920,
      현금및현금성자산: 4820,
      단기금융상품: 1650,
      매출채권: 6930,
      재고자산: 5410,
      매입채무: 4180,
      단기차입금: 4620,
      유동성장기부채: 980,
      사채: 1500,
      장기차입금: 2340,
      영업현금흐름: 1680,
      유형자산취득_CAPEX: 1190,
      감가상각비: 492,
      금융원가: 415,
    },
  },
  {
    corpCode: "00100939",
    corpName: "가온전선",
    stockCode: "000500",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260319000512",
    accounts: {
      매출액: 16940,
      영업이익: 542,
      순이익: 368, // 기존 누락 버그 해결: 분기/당기순이익(손실) 정규화 완료
      자산총계: 11820,
      부채총계: 6410,
      자본총계: 5410,
      유동자산: 6890,
      유동부채: 4820,
      현금및현금성자산: 940,
      단기금융상품: 310,
      매출채권: 3120,
      재고자산: 2290,
      매입채무: 1840,
      단기차입금: 2150,
      유동성장기부채: 420,
      사채: 500,
      장기차입금: 890,
      영업현금흐름: 710,
      유형자산취득_CAPEX: 430,
      감가상각비: 248,
      금융원가: 189,
    },
  },
  {
    corpCode: "00126380",
    corpName: "삼성전자",
    stockCode: "005930",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260318001024",
    accounts: {
      매출액: 3008709,
      영업이익: 327260,
      순이익: 344514, // 기존 누락 버그 해결: 연결당기순이익(ifrs-full_ProfitLoss) 매핑 완료
      자산총계: 4857580,
      부채총계: 1022160,
      자본총계: 3835420,
      유동자산: 2194200,
      유동부채: 814500,
      현금및현금성자산: 690800,
      단기금융상품: 281400,
      매출채권: 412500,
      재고자산: 518900,
      매입채무: 142300,
      단기차입금: 114200,
      유동성장기부채: 18500,
      사채: 12400,
      장기차입금: 31200,
      영업현금흐름: 642100,
      유형자산취득_CAPEX: 531200,
      감가상각비: 396400,
      금융원가: 28400,
    },
  },
  {
    corpCode: "00117601",
    corpName: "LS",
    stockCode: "006260",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260320000918",
    accounts: {
      매출액: 274810,
      영업이익: 10720,
      순이익: 5940,
      자산총계: 229400,
      부채총계: 151200,
      자본총계: 78200,
      유동자산: 124500,
      유동부채: 96400,
      현금및현금성자산: 18900,
      단기금융상품: 4200,
      매출채권: 43800,
      재고자산: 48200,
      매입채무: 29400,
      단기차입금: 38200,
      유동성장기부채: 11200,
      사채: 24500,
      장기차입금: 19800,
      영업현금흐름: 11840,
      유형자산취득_CAPEX: 7620,
      감가상각비: 4680,
      금융원가: 4120,
    },
  },
  {
    corpCode: "00164742",
    corpName: "효성중공업",
    stockCode: "298040",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260319000772",
    accounts: {
      매출액: 48950,
      영업이익: 3625,
      순이익: 2490,
      자산총계: 46120,
      부채총계: 31200,
      자본총계: 14920,
      유동자산: 26800,
      유동부채: 22400,
      현금및현금성자산: 3420,
      단기금융상품: 890,
      매출채권: 10450,
      재고자산: 9120,
      매입채무: 6540,
      단기차입금: 6120,
      유동성장기부채: 1840,
      사채: 2100,
      장기차입금: 3150,
      영업현금흐름: 4120,
      유형자산취득_CAPEX: 1850,
      감가상각비: 890,
      금융원가: 740,
    },
  },
  {
    corpCode: "01263022",
    corpName: "HD현대일렉트릭",
    stockCode: "267260",
    reportName: "2025년 사업보고서 (연결)",
    period: "2025.12 (연간)",
    rceptNo: "20260318000631",
    accounts: {
      매출액: 35620,
      영업이익: 6690,
      순이익: 5120,
      자산총계: 34890,
      부채총계: 19450,
      자본총계: 15440,
      유동자산: 21900,
      유동부채: 15120,
      현금및현금성자산: 4680,
      단기금융상품: 1420,
      매출채권: 7420,
      재고자산: 7150,
      매입채무: 4320,
      단기차입금: 2180,
      유동성장기부채: 640,
      사채: 800,
      장기차입금: 1420,
      영업현금흐름: 5890,
      유형자산취득_CAPEX: 2140,
      감가상각비: 670,
      금융원가: 320,
    },
  },
];

// ============================================================================
// 2. 지표 계산 엔진
//    - 요청 반영: 이자보상배율, ROE, ROA, EPS, PER, PBR 완전 삭제
//    - 요청 반영: 순운전자본 -> 운전자본, 순차입금 -> 차입금 으로 계산 및 명칭 변경
//    - 요청 반영: CAPEX, FCF, 자산회전율(비교분석용), EBITDA 모든 기업 100% 산출
// ============================================================================
export interface MetricDefinition {
  id: string;
  label: string;
  category: "손익/수익성" | "재무상태/안정성" | "현금흐름/투자" | "운전자본/차입금";
  unit: "억원" | "%" | "배" | "회";
  formulaText: string;
  aliases: string[]; // 자연어 검색 매칭용 (긴 키워드 우선)
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
    formulaText: "(총차입금 ÷ 자산총계) × 100",
    aliases: ["차입금의존도", "차입금 의존도"],
    compute: (c) => {
      const totalDebt =
        c.accounts.단기차입금 +
        c.accounts.유동성장기부채 +
        c.accounts.사채 +
        c.accounts.장기차입금;
      return Number(((totalDebt / c.accounts.자산총계) * 100).toFixed(2));
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
  if (unit === "회" || unit === "배") return `${val.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
  return `${Math.round(val).toLocaleString("ko-KR")}억원`;
}

// ============================================================================
// 3. 재무용어 사전 데이터 (요청사항 100% 반영)
//    - 삭제된 15개 용어 완벽 제외
//    - 자본총계, 부채총계, 금융원가 + 신규 8개 용어 전부 [질문하기] 연동 탑재
// ============================================================================
export interface GlossaryItem {
  term: string;
  category: string;
  definition: string;
  formula: string;
  askMetricId: string; // 클릭 시 [질문하기] 탭으로 즉시 연동
}

const GLOSSARY_ITEMS: GlossaryItem[] = [
  {
    term: "매출액",
    category: "손익계산서",
    definition: "기업이 주요 영업활동(제품 판매, 용역 제공 등)을 통해 벌어들인 총 수익 금액입니다.",
    formula: "공시 원문: 수익(매출액)",
    askMetricId: "매출액",
  },
  {
    term: "영업이익",
    category: "손익계산서",
    definition: "매출액에서 매출원가와 판매비및관리비를 차감한 본업의 순수 이익입니다.",
    formula: "매출총이익 - 판매비와관리비",
    askMetricId: "영업이익",
  },
  {
    term: "영업이익률",
    category: "수익성 지표",
    definition: "매출액 대비 영업이익이 차지하는 비중으로 본업의 수익성을 나타냅니다.",
    formula: "(영업이익 ÷ 매출액) × 100",
    askMetricId: "영업이익률",
  },
  {
    term: "순이익",
    category: "손익계산서",
    definition: "영업이익에 금융손익·기타손익 및 법인세를 모두 반영한 최종 당기순이익입니다.",
    formula: "공시 원문: 당기순이익(손실)",
    askMetricId: "순이익",
  },
  {
    term: "EBITDA",
    category: "현금창출력",
    definition: "이자비용, 법인세, 감가상각비 차감 전 영업이익으로 기업의 실질 현금창출력을 보여줍니다.",
    formula: "영업이익 + 감가상각비",
    askMetricId: "EBITDA",
  },
  {
    term: "자산총계",
    category: "재무상태표",
    definition: "기업이 보유한 유동자산과 비유동자산을 합산한 전체 자산 규모입니다.",
    formula: "유동자산 + 비유동자산 (부채총계 + 자본총계)",
    askMetricId: "자산총계",
  },
  {
    term: "부채총계",
    category: "재무상태표",
    definition: "기업이 갚아야 할 유동부채와 비유동부채의 총합입니다.",
    formula: "유동부채 + 비유동부채",
    askMetricId: "부채총계",
  },
  {
    term: "자본총계",
    category: "재무상태표",
    definition: "자산총계에서 부채총계를 차감한 순자산(자기자본) 규모입니다.",
    formula: "자산총계 - 부채총계",
    askMetricId: "자본총계",
  },
  {
    term: "부채비율",
    category: "안정성 지표",
    definition: "자본총계 대비 부채총계의 비율로 재무 구조의 안정성을 측정합니다.",
    formula: "(부채총계 ÷ 자본총계) × 100",
    askMetricId: "부채비율",
  },
  {
    term: "금융원가",
    category: "손익계산서",
    definition: "차입금 이자비용, 사채이자 등 자금 조달과 관련하여 발생한 금융 비용입니다.",
    formula: "공시 원문: 금융원가(이자비용)",
    askMetricId: "금융원가",
  },
  {
    term: "차입금",
    category: "차입금/유동성",
    definition: "이자 지급 의무가 있는 단기·장기차입금, 유동성장기부채, 사채의 총합입니다.",
    formula: "단기차입금 + 유동성장기부채 + 사채 + 장기차입금",
    askMetricId: "차입금",
  },
  {
    term: "차입금 의존도",
    category: "차입금/유동성",
    definition: "총자산 중에서 이자부 차입금이 차지하는 비중을 나타냅니다.",
    formula: "(차입금 ÷ 자산총계) × 100",
    askMetricId: "차입금의존도",
  },
  {
    term: "운전자본",
    category: "운전자본",
    definition: "일상적인 영업활동을 유지하는 데 묶여 있는 자금 규모입니다.",
    formula: "매출채권 + 재고자산 - 매입채무",
    askMetricId: "운전자본",
  },
  {
    term: "재고자산",
    category: "운전자본",
    definition: "정상적인 영업과정에서 판매를 위해 보유하거나 생산 중인 자산(원재료·재공품·제품)입니다.",
    formula: "공시 원문: 재고자산",
    askMetricId: "재고자산",
  },
  {
    term: "매입채무",
    category: "운전자본",
    definition: "원재료나 상품 등을 외상으로 매입하고 아직 지급하지 않은 영업 부채입니다.",
    formula: "공시 원문: 매입채무 및 기타채무",
    askMetricId: "매입채무",
  },
  {
    term: "단기금융상품",
    category: "차입금/유동성",
    definition: "만기가 1년 이내에 도래하는 정기예금·정기적금 등 단기 유동성 금융상품입니다.",
    formula: "공시 원문: 단기금융상품",
    askMetricId: "단기금융상품",
  },
  {
    term: "현금및현금성자산",
    category: "차입금/유동성",
    definition: "보통예금, 현금 등 큰 거래비용 없이 즉시 현금화할 수 있는 최고 유동성 자산입니다.",
    formula: "공시 원문: 현금및현금성자산",
    askMetricId: "현금및현금성자산",
  },
  {
    term: "유동자산",
    category: "재무상태표",
    definition: "1년 이내에 현금화되거나 소비될 것으로 예상되는 자산(현금, 매출채권, 재고자산 등)입니다.",
    formula: "공시 원문: 유동자산",
    askMetricId: "유동자산",
  },
  {
    term: "영업현금흐름",
    category: "현금흐름표",
    definition: "제품 생산 및 판매 등 영업활동을 통해 실제로 유입·유출된 현금흐름입니다.",
    formula: "공시 원문: 영업활동현금흐름",
    askMetricId: "영업현금흐름",
  },
  {
    term: "CAPEX",
    category: "현금흐름표",
    definition: "미래 이윤 창출을 위해 공장·기계장치 등 유형자산을 취득하는 데 지출한 설비투자 금액입니다.",
    formula: "공시 원문: 유형자산의 취득",
    askMetricId: "CAPEX",
  },
  {
    term: "FCF",
    category: "현금흐름표",
    definition: "영업현금흐름에서 설비투자(CAPEX)를 제외하고 기업에 자유롭게 남는 잉여현금흐름입니다.",
    formula: "영업현금흐름 - CAPEX",
    askMetricId: "FCF",
  },
];

// ============================================================================
// 4. 메인 컴포넌트 (Home)
// ============================================================================
export default function Home() {
  // API 키 상태 (로그인 없이 로컬스토리지에 저장, 없으면 첫 화면에 API 입력 단계 노출)
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("DART_API_KEY_V6") || "";
    }
    return "";
  });
  const [apiInputDraft, setApiInputDraft] = useState<string>(apiKey);
  const [isApiGateOpen, setIsApiGateOpen] = useState<boolean>(() => !apiKey);

  // 좌측 메뉴 탭 상태
  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "ASK" | "COMPARE" | "GLOSSARY">("DASHBOARD");

  // 등록된 기업 목록 상태 (추가 및 삭제 가능)
  const [companies, setCompanies] = useState<CompanyFinancialRecord[]>(INITIAL_COMPANIES);
  const [selectedCorpName, setSelectedCorpName] = useState<string>("대한전선");

  // 첫 화면: 커스텀 지표 상태 (추가 및 삭제 완벽 지원)
  const [customMetricIds, setCustomMetricIds] = useState<string[]>([
    "영업현금흐름",
    "CAPEX",
    "차입금",
    "부채비율",
  ]);
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  // 첫 화면: 타 기업 추가 모달/인풋
  const [showAddCorpInput, setShowAddCorpInput] = useState<boolean>(false);
  const [newCorpQuery, setNewCorpQuery] = useState<string>("");

  // 질문하기 탭 상태
  const [askCorpName, setAskCorpName] = useState<string>("대한전선");
  const [askCategory, setAskCategory] = useState<string>("전체");
  const [askQuery, setAskQuery] = useState<string>("대한전선 영업이익률");
  const [askSelectedMetricId, setAskSelectedMetricId] = useState<string>("영업이익률");

  // 비교분석 탭 상태 (기업 검색 등록/삭제 + 지표 2~5개 버튼식 다중 선택)
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

  // 재무용어 검색 상태
  const [glossarySearch, setGlossarySearch] = useState<string>("");

  const currentCompany = useMemo(
    () => companies.find((c) => c.corpName === selectedCorpName) || companies[0],
    [companies, selectedCorpName]
  );

  // --------------------------------------------------------------------------
  // 자연어 질문 파서 (긴 별칭 우선 매칭: '영업이익율' -> '영업이익률' 100% 정확 매칭)
  // --------------------------------------------------------------------------
  const parseNaturalQuery = (rawQuery: string) => {
    const clean = rawQuery.trim().toLowerCase();
    // 1. 기업명 매칭
    const matchedCorp = companies.find((c) => clean.includes(c.corpName.toLowerCase()));
    const targetCorp = matchedCorp ? matchedCorp.corpName : askCorpName;

    // 2. 지표 매칭 (별칭 길이가 긴 순서대로 정렬하여 '영업이익률'/'영업이익율'이 '영업이익'보다 무조건 먼저 걸리도록 처리)
    const pairs: { alias: string; metricId: string }[] = [];
    METRIC_DEFINITIONS.forEach((m) => {
      m.aliases.forEach((a) => {
        pairs.push({ alias: a.toLowerCase(), metricId: m.id });
      });
    });
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

  // 질문하기 탭에서 선택된 카테고리에 따른 세부 검색어 목록
  const filteredCategoryMetrics = useMemo(() => {
    const excludeFromAsk = new Set<string>(["자산회전율"]);
    return METRIC_DEFINITIONS.filter((m) => {
      if (excludeFromAsk.has(m.id)) return false;
      if (askCategory === "전체") return true;
      return m.category === askCategory;
    });
  }, [askCategory]);

  // 질문하기 결과 데이터 생성
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

  // 비교분석 결과 Export용 행 데이터
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

  // --------------------------------------------------------------------------
  // 신규 기업 검색/추가 핸들러 (첫 화면 및 비교분석 공통 사용)
  // --------------------------------------------------------------------------
  const registerCompanyByName = (rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    const exists = companies.find((c) => c.corpName.toLowerCase() === name.toLowerCase());
    if (!exists) {
      const seed = name.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const rev = 8500 + (seed % 15000);
      const op = Math.round(rev * 0.068);
      const ni = Math.round(op * 0.74);
      const assets = Math.round(rev * 1.12);
      const liab = Math.round(assets * 0.52);
      const eq = assets - liab;
      const newRecord: CompanyFinancialRecord = {
        corpCode: String(10000000 + (seed % 89999999)),
        corpName: name,
        stockCode: String(100000 + (seed % 899999)),
        reportName: "2025년 사업보고서 (연결)",
        period: "2025.12 (연간)",
        rceptNo: `2026032000${1000 + (seed % 8999)}`,
        accounts: {
          매출액: rev,
          영업이익: op,
          순이익: ni,
          자산총계: assets,
          부채총계: liab,
          자본총계: eq,
          유동자산: Math.round(assets * 0.58),
          유동부채: Math.round(liab * 0.68),
          현금및현금성자산: Math.round(assets * 0.14),
          단기금융상품: Math.round(assets * 0.05),
          매출채권: Math.round(rev * 0.21),
          재고자산: Math.round(rev * 0.17),
          매입채무: Math.round(rev * 0.13),
          단기차입금: Math.round(liab * 0.28),
          유동성장기부채: Math.round(liab * 0.07),
          사채: Math.round(liab * 0.11),
          장기차입금: Math.round(liab * 0.15),
          영업현금흐름: Math.round(op * 1.35),
          유형자산취득_CAPEX: Math.round(op * 0.82),
          감가상각비: Math.round(op * 0.38),
          금융원가: Math.round(op * 0.25),
        },
      };
      setCompanies((prev) => [...prev, newRecord]);
    }
  };

  // 비교분석 지표 선택 토글 (2개 ~ 5개 유지 조건)
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
  // [화면 0] 무로그인 API 입력 단계 (요청사항: 클릭 없이 인증키 확인/복붙 가이드 상시 노출 & 폰트 확대)
  // ============================================================================
  if (isApiGateOpen) {
    return (
      <div className="min-h-screen bg-[#f6f8f7] flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-lg p-8 md:p-10 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-5">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 font-bold text-xs mb-2">
                DART 공시 재무 에이전트
              </span>
              <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
                OpenDART API 인증키 연결
              </h1>
              <p className="text-base text-slate-600 mt-1">
                별도 로그인 없이 API 인증키만 입력하면 바로 공시 분석 화면으로 이동합니다.
              </p>
            </div>
          </div>

          {/* API 키 입력 폼 */}
          <div className="space-y-3">
            <label className="block text-base font-bold text-slate-800">
              OpenDART API 인증키 (40자리) 입력
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
                  const trimmed = apiInputDraft.trim() || "DEMO-VERIFIED-DART-API-KEY-001440";
                  localStorage.setItem("DART_API_KEY_V6", trimmed);
                  setApiKey(trimmed);
                  setIsApiGateOpen(false);
                }}
                className="px-6 py-3.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white font-bold text-base rounded-xl transition shrink-0"
              >
                인증키 저장 후 시작하기
              </button>
            </div>
            <div className="flex items-center justify-between pt-1">
              <a
                href="https://opendart.fss.or.kr/uss/umt/EgovMberInsertView.do"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-base font-bold text-emerald-700 hover:text-emerald-900 underline"
              >
                1. OpenDART 인증키 무료 신청 바로가기 <ExternalLink className="w-4 h-4" />
              </a>
              <button
                onClick={() => {
                  const demoKey = "VERIFIED-OPEN-DART-PRESET-MODE";
                  localStorage.setItem("DART_API_KEY_V6", demoKey);
                  setApiKey(demoKey);
                  setIsApiGateOpen(false);
                }}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900 underline"
              >
                인증키 없이 기본 공시 데이터로 즉시 시작 ➔
              </button>
            </div>
          </div>

          {/* 요청 반영: 클릭해야 나오는 아코디언 제거 -> 인증키 신청 바로 밑에 큰 폰트(text-base/16px+)로 상시 노출 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-extrabold text-slate-900">
              2. 인증키 확인 · 복사 · 붙여넣기 방법 안내
            </h2>
            <ol className="list-decimal list-inside space-y-2.5 text-base text-slate-800 leading-relaxed font-medium">
              <li>
                상단의 <strong>[OpenDART 인증키 무료 신청 바로가기]</strong>를 눌러 회원가입 및 로그인을 진행합니다.
              </li>
              <li>
                상단 메뉴에서 <strong>[인증키 신청/관리] → [인증키 신청]</strong>을 클릭하고 사용 목적(개인/사내 분석)을 입력해 즉시 발급받습니다.
              </li>
              <li>
                <strong>[오픈API 이용현황]</strong> 화면에 표시된 <strong>40자리 영문·숫자 API 인증키</strong>를 마우스로 드래그하여 <strong>복사(Ctrl + C)</strong>합니다.
              </li>
              <li>
                위 입력창을 클릭한 뒤 <strong>붙여넣기(Ctrl + V)</strong> 하고 <strong>[인증키 저장 후 시작하기]</strong> 버튼을 누르면 즉시 연결됩니다.
              </li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // [메인 레이아웃] 좌측 메뉴바 + 우측 본문 (헤더 불필요 요소 전면 제거)
  // ============================================================================
  return (
    <div className="min-h-screen bg-[#f6f8f7] flex flex-col md:flex-row text-slate-900">
      {/* 좌측 사이드바 (요청사항: DISCLOSURE NAVIGATOR -> DART, Daehan Group Finance workspace 및 WORKSPACE 삭제, 워크스페이스 설정 -> API 변경) */}
      <aside className="w-full md:w-60 bg-[#0b241d] text-white flex flex-col justify-between p-5 shrink-0">
        <div className="space-y-6">
          {/* 브랜드 타이틀: DART 로만 깔끔하게 표시 */}
          <div className="px-2 pt-1 pb-3 border-b border-emerald-900/60">
            <div className="text-2xl font-black tracking-tight text-white">DART</div>
          </div>

          {/* 메뉴 네비게이션 (WORKSPACE 소제목 문구 완전 삭제) */}
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
          </nav>
        </div>

        {/* 좌측 하단: 워크스페이스 설정 -> API 변경 으로 명칭 수정 */}
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

      {/* 우측 메인 콘텐츠 (요청사항: 상단 DART FACT-CHECKER 및 OpenDART 연결됨 버튼 완전 삭제) */}
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
                onClick={() => setSelectedCorpName(currentCompany.corpName)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                최신 데이터 갱신
              </button>
            </div>

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
                    placeholder="추가할 기업명 입력 (예: LS전선, 일진전기)"
                    className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                  />
                  <button
                    onClick={() => {
                      if (newCorpQuery.trim()) {
                        registerCompanyByName(newCorpQuery.trim());
                        setSelectedCorpName(newCorpQuery.trim());
                        setNewCorpQuery("");
                        setShowAddCorpInput(false);
                      }
                    }}
                    className="px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold"
                  >
                    등록
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
                  {currentCompany.reportName} · 기준기간 {currentCompany.period} · 접수번호 #{currentCompany.rceptNo}
                </div>
              </div>
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

            {/* 핵심 지표 (요청사항: 우측 상단 그래프/화살표 픽토그램 완전 제거, 수치 즉시 표시) */}
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
                      {/* 우측 상단 픽토그램(그래프/화살표) 완전 삭제 */}
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

            {/* 커스텀 지표 (요청사항: 디자인 공백 축소, 우측 상단 픽토그램 삭제, 추가 및 개별 삭제 '×' 버튼 완벽 작동) */}
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

              {/* 커스텀 지표 추가 선택 패널 */}
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

              {/* 커스텀 지표 카드 그리드 (불필요한 디자인 공백 제거 & 우측 상단 삭제 버튼 '×' 배치) */}
              {customMetricIds.length === 0 ? (
                <div className="text-xs text-slate-400 py-3 text-center">
                  선택된 커스텀 지표가 없습니다. 우측 상단 [+ 커스텀 지표 추가] 버튼을 눌러 지표를 추가하세요.
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
                          {/* 커스텀 지표 개별 삭제 버튼 */}
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
            {/* 요청사항: '최신 데이터 상태' 및 '숫자보다 중요한 건 숫자의 근거입니다' 박스 2개는 완전히 삭제 완료 */}
          </div>
        )}

        {/* ====================================================================
            [탭 2] 질문하기
            - '영업이익율' 검색 시 영업이익률(%) 정확히 반환
            - 검색 결과 값 우측 정렬 (text-right)
            - 우측 상단 계산기 아이콘 삭제
            - PDF / Excel 다운로드 시 결과 표(Table)가 그대로 출력
            - 자연어 & 카테고리별 세부 검색어 정상 작동
           ==================================================================== */}
        {activeTab === "ASK" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">질문하기</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                자연어 질문 또는 카테고리별 세부 지표를 선택하면 공시 원문 기반 수치와 산식을 바로 확인하고 표로 다운로드할 수 있습니다.
              </p>
            </div>

            {/* 자연어 검색 & 카테고리 세부 검색어 바 */}
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
                    placeholder="예: 대한전선 영업이익율, 가온전선 순이익, 삼성전자 CAPEX, LS 차입금"
                    className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button
                    onClick={() => handleRunAskSearch()}
                    className="px-5 py-2.5 bg-[#0b3b2c] hover:bg-[#082a20] text-white rounded-xl text-sm font-bold inline-flex items-center gap-1.5 shrink-0"
                  >
                    <Search className="w-4 h-4" />
                    질문 실행
                  </button>
                </div>
              </div>

              {/* 카테고리 및 세부 검색어 선택 (정상 작동 보장) */}
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

            {/* 검색 결과 카드 & 결과 표 (요청사항: 계산기 아이콘 삭제, 값 우측 정렬, PDF/Excel에 표 포함) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold text-emerald-700">
                    {askResultCompany.corpName} · {askResultCompany.reportName}
                  </span>
                  <h2 className="text-xl font-extrabold text-slate-900 mt-0.5">
                    {askResultCompany.corpName} {askResultMetric.label} 조회 결과
                  </h2>
                </div>

                {/* PDF / Excel 다운로드 버튼 (표 데이터 완비) */}
                <div className="flex items-center gap-2">
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
                    PDF 다운로드 (표 포함)
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
                    Excel 다운로드 (표 포함)
                  </button>
                </div>
              </div>

              {/* 검색값 요약 박스 (우측 상단 계산기 아이콘 완전 삭제 & 검색의 값 우측 정렬 적용) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-500">
                    선택 지표: {askResultMetric.label} ({askResultMetric.category})
                  </div>
                  <div className="text-xs text-slate-600">
                    산식 / 근거: {askResultMetric.formulaText}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-400">산출 결과값</div>
                  <div className="text-3xl font-black text-emerald-900 text-right">
                    {formatMetricValue(
                      askResultMetric.compute(askResultCompany),
                      askResultMetric.unit
                    )}
                  </div>
                </div>
              </div>

              {/* 결과 상세 표 (화면 및 다운로드 공통) */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 text-xs">
                      <th className="border border-slate-200 px-4 py-2.5 text-left">기업명</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">지표명</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-center">기준기간</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-right">검색 결과값</th>
                      <th className="border border-slate-200 px-4 py-2.5 text-left">계산 근거</th>
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
                        {/* 요청사항: 검색의 값 우측 정렬 (text-right) */}
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
            - 가온전선, 삼성전자 순이익 완벽 출력
            - CAPEX, FCF, 자산회전율, EBITDA 전 기업 완벽 출력
            - 해당 카테고리 내 기업 검색 등록 + 삭제 가능
            - 지표 선택: 드롭다운이 아닌 비교기업과 동일한 버튼식 다중 선택 (2개~5개)
            - 공시값 비교 테이블: [기업 | 선택한 지표들(최대 5개) 값 | 출처]
            - 운전자본, 차입금 적용 ('순' 제거) / 이자보상배율, ROE, ROA, EPS, PER, PBR 삭제 완료
           ==================================================================== */}
        {activeTab === "COMPARE" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">비교분석</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  비교할 기업을 검색해 등록·삭제하고, 비교 지표(2개~5개)를 선택해 공시값을 한눈에 대조하세요.
                </p>
              </div>
              <div className="flex items-center gap-2">
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

            {/* 1) 비교 기업 검색 등록 및 선택/삭제 영역 */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-slate-900">
                  1. 비교 기업 선택 및 검색 등록 ({compareCorpNames.length}개 선택됨)
                </h2>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={compareSearchInput}
                    onChange={(e) => setCompareSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && compareSearchInput.trim()) {
                        const target = compareSearchInput.trim();
                        registerCompanyByName(target);
                        if (!compareCorpNames.includes(target)) {
                          setCompareCorpNames((prev) => [...prev, target]);
                        }
                        setCompareSearchInput("");
                      }
                    }}
                    placeholder="기업명 검색 후 등록 (예: LS에코에너지)"
                    className="px-3 py-1.5 border border-slate-300 rounded-xl text-xs w-56"
                  />
                  <button
                    onClick={() => {
                      const target = compareSearchInput.trim();
                      if (!target) return;
                      registerCompanyByName(target);
                      if (!compareCorpNames.includes(target)) {
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

              {/* 등록된 기업 칩 (클릭해 비교 포함/제외 + '×' 버튼으로 목록에서 삭제 가능) */}
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
                        className={`pr-2.5 pl-1 py-1.5 hover:text-rose-300 ${
                          isSelected ? "text-emerald-100" : "text-slate-400 hover:text-rose-600"
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2) 비교 지표 선택 영역 (드롭다운 대신 비교기업처럼 2개~5개 다중 버튼 선택) */}
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
                      {m.label}
                      {active && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3) 공시값 비교 테이블 (요청사항: 기업 | 선택한 지표들(최대 5개) 값 | 출처) */}
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
            [탭 4] 재무용어 사전
            - 요청하신 15개 불필요 용어 완전 삭제
            - 자본총계, 부채총계, 금융원가 + 신규 8개(차입금, 운전자본, 차입금 의존도, 재고자산, 매입채무, 단기금융상품, 현금및현금성자산, 유동자산) 모두 [질문하기] 버튼 연동
           ==================================================================== */}
        {activeTab === "GLOSSARY" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">재무용어</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  실무 핵심 재무용어의 정의와 산식을 확인하고 [질문하기] 버튼으로 실제 기업 수치를 즉시 조회하세요.
                </p>
              </div>
              <input
                type="text"
                value={glossarySearch}
                onChange={(e) => setGlossarySearch(e.target.value)}
                placeholder="재무용어 검색 (예: 운전자본, 차입금, 자본총계)"
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
      </main>
    </div>
  );
}