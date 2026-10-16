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

export interface PeriodFinancialSnapshot {
  periodKey: string;
  periodLabel: string;
  reportName: string;
  rceptNo: string;
  accounts: RawDartAccountMap;
}

export interface CompanyFinancialRecord {
  corpCode: string;
  corpName: string;
  stockCode: string;
  reportName: string;
  period: string;
  rceptNo: string;
  isLiveApiFetched: boolean;
  verificationPassed: boolean;
  verificationNote: string;
  accounts: RawDartAccountMap;
  history4Y: PeriodFinancialSnapshot[];
}

export function buildDartSectionDeepLink(rceptNo: string, corpName: string, metricLabel: string): string {
  const cleanRcp = String(rceptNo || "").trim();
  if (/^\d{14}$/.test(cleanRcp)) {
    return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${cleanRcp}`;
  }
  return `https://dart.fss.or.kr/dsab007/detailSearch.ax?textCrpNm=${encodeURIComponent(corpName)}`;
}

export function parseDartFullStatementRows(rows: any[], fallback?: RawDartAccountMap): RawDartAccountMap {
  const findVal = (sjDivs: string[], idPatterns: RegExp[], namePatterns: RegExp[], useAbs = false): number | null => {
    for (const r of rows) {
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accId = String(r.account_id || "");
      if (idPatterns.some((re) => re.test(accId))) {
        const v = Number(String(r.thstrm_amount || r.thstrm_add_amount || 0).replace(/,/g, ""));
        if (!Number.isNaN(v) && v !== 0) return useAbs ? Math.abs(v) : v;
      }
    }
    for (const r of rows) {
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accNm = String(r.account_nm || "").replace(/\s+/g, "");
      if (namePatterns.some((re) => re.test(accNm))) {
        const v = Number(String(r.thstrm_amount || r.thstrm_add_amount || 0).replace(/,/g, ""));
        if (!Number.isNaN(v) && v !== 0) return useAbs ? Math.abs(v) : v;
      }
    }
    return null;
  };

  const toEok = (raw: number | null) => (raw === null ? 0 : Math.round(raw / 100_000_000));

  const 매출액 = toEok(findVal(["IS", "CIS"], [/ifrs-full_Revenue$/i], [/^매출액$/, /^수익\(매출액\)$/, /^영업수익$/])) ?? fallback?.매출액 ?? 0;
  const 영업이익 = toEok(findVal(["IS", "CIS"], [/dart_OperatingIncomeLoss$/i], [/^영업이익/, /^영업손익/])) ?? fallback?.영업이익 ?? 0;
  const 순이익 = toEok(findVal(["IS", "CIS"], [/ifrs-full_ProfitLoss$/i], [/^당기순이익/, /^분기순이익/, /^반기순이익/])) ?? fallback?.순이익 ?? 0;
  const 자산총계 = toEok(findVal(["BS"], [/ifrs-full_Assets$/i], [/^자산총계$/])) ?? fallback?.자산총계 ?? 0;
  const 부채총계 = toEok(findVal(["BS"], [/ifrs-full_Liabilities$/i], [/^부채총계$/])) ?? fallback?.부채총계 ?? 0;
  const 자본총계 = toEok(findVal(["BS"], [/ifrs-full_Equity$/i], [/^자본총계$/])) ?? fallback?.자본총계 ?? 0;
  const 유동자산 = toEok(findVal(["BS"], [/ifrs-full_CurrentAssets$/i], [/^유동자산$/])) ?? fallback?.유동자산 ?? 0;
  const 유동부채 = toEok(findVal(["BS"], [/ifrs-full_CurrentLiabilities$/i], [/^유동부채$/])) ?? fallback?.유동부채 ?? 0;
  const 현금및현금성자산 = toEok(findVal(["BS"], [/ifrs-full_CashAndCashEquivalents$/i], [/^현금및현금성자산$/])) ?? fallback?.현금및현금성자산 ?? 0;
  const 단기금융상품 = toEok(findVal(["BS"], [/dart_ShortTermDeposits/i], [/^단기금융상품$/])) ?? fallback?.단기금융상품 ?? 0;
  const 매출채권 = toEok(findVal(["BS"], [/ifrs-full_TradeAndOtherCurrentReceivables$/i], [/^매출채권/])) ?? fallback?.매출채권 ?? 0;
  const 재고자산 = toEok(findVal(["BS"], [/ifrs-full_Inventories$/i], [/^재고자산$/])) ?? fallback?.재고자산 ?? 0;
  const 매입채무 = toEok(findVal(["BS"], [/ifrs-full_TradeAndOtherCurrentPayables$/i], [/^매입채무/])) ?? fallback?.매입채무 ?? 0;
  const 단기차입금 = toEok(findVal(["BS"], [/ifrs-full_ShorttermBorrowings$/i], [/^단기차입금/])) ?? fallback?.단기차입금 ?? 0;
  const 유동성장기부채 = toEok(findVal(["BS"], [/ifrs-full_CurrentPortionOfLongtermBorrowings$/i], [/^유동성장기부채/])) ?? fallback?.유동성장기부채 ?? 0;
  const 사채 = toEok(findVal(["BS"], [/ifrs-full_BondsIssued$/i], [/^사채$/])) ?? fallback?.사채 ?? 0;
  const 장기차입금 = toEok(findVal(["BS"], [/ifrs-full_LongtermBorrowings$/i], [/^장기차입금/])) ?? fallback?.장기차입금 ?? 0;
  const 영업현금흐름 = toEok(findVal(["CF"], [/ifrs-full_CashFlowsFromUsedInOperatingActivities$/i], [/^영업활동현금흐름/])) ?? fallback?.영업현금흐름 ?? 0;
  const 유형자산취득_CAPEX = toEok(findVal(["CF"], [/ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i], [/유형자산의취득/], true)) ?? fallback?.유형자산취득_CAPEX ?? 0;
  const 감가상각비 = toEok(findVal(["CF", "IS", "CIS"], [/ifrs-full_AdjustmentsForDepreciationExpense$/i], [/감가상각비/], true)) ?? fallback?.감가상각비 ?? 0;
  const 금융원가 = toEok(findVal(["IS", "CIS"], [/ifrs-full_FinanceCosts$/i], [/^금융원가/])) ?? fallback?.금융원가 ?? 0;

  return {
    매출액, 영업이익, 순이익, 자산총계, 부채총계, 자본총계,
    유동자산, 유동부채, 현금및현금성자산, 단기금융상품,
    매출채권, 재고자산, 매입채무, 단기차입금, 유동성장기부채,
    사채, 장기차입금, 영업현금흐름, 유형자산취득_CAPEX, 감가상각비, 금융원가,
  };
}

async function fetchWithCorsFallback(targetUrl: string): Promise<any | null> {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p);
      if (!res.ok) continue;
      return await res.json();
    } catch {}
  }
  return null;
}

/**
 * 100% 실시간 OpenDART API 동적 조회 엔진 (하드코딩 스냅샷 전면 배제)
 */
export async function fetchLiveDartCompanyRecord(
  corpNameInput: string,
  apiKey: string
): Promise<{ record: CompanyFinancialRecord | null; errorMsg?: string }> {
  const cleanName = corpNameInput.trim();
  if (!cleanName) return { record: null, errorMsg: "기업명을 입력해 주세요." };

  const keyToUse = apiKey && apiKey.trim().length >= 30 && !apiKey.startsWith("VERIFIED") ? apiKey.trim() : "DEMO_KEY";

  try {
    // 1. 공시검색 API로 해당 기업의 corp_code 및 최신 접수번호 실시간 획득
    const searchUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${keyToUse}&corp_name=${encodeURIComponent(cleanName)}&page_no=1&page_count=1`;
    const sJson = await fetchWithCorsFallback(searchUrl);

    if (!sJson || sJson.status !== "000" || !Array.isArray(sJson.list) || sJson.list.length === 0) {
      return {
        record: null,
        errorMsg: `'${cleanName}' 기업을 DART 공시에서 찾을 수 없습니다. 정확한 상장법인명을 입력했는지 확인해 주세요.`,
      };
    }

    const corpCode = sJson.list[0].corp_code;
    const stockCode = sJson.list[0].stock_code || "-";
    const latestRceptNo = sJson.list[0].rcept_no;
    const reportName = sJson.list[0].report_nm || "사업보고서 (연결)";

    // 2. 단일회사 전체 재무제표 API (fnlttSinglAcntAll) 실시간 호출 (2025년 및 2024년 시계열 동적 구성)
    const years = ["2025", "2024", "2023"];
    const history4Y: PeriodFinancialSnapshot[] = [];
    let latestAccounts: RawDartAccountMap | null = null;
    let latestPeriodLabel = "2025.12 (연간)";

    for (const yr of years) {
      const stmtUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${keyToUse}&corp_code=${corpCode}&bsns_year=${yr}&reprt_code=11011&fs_div=CFS`;
      const stmtJson = await fetchWithCorsFallback(stmtUrl);

      if (stmtJson && stmtJson.status === "000" && Array.isArray(stmtJson.list) && stmtJson.list.length > 0) {
        const parsed = parseDartFullStatementRows(stmtJson.list);
        if (!latestAccounts) {
          latestAccounts = parsed;
          latestPeriodLabel = `${yr}.12 (연간)`;
        }
        history4Y.push({
          periodKey: yr,
          periodLabel: `${yr}.12 (연간)`,
          reportName: `${yr}년 사업보고서 (연결)`,
          rceptNo: stmtJson.list[0]?.rcept_no || latestRceptNo,
          accounts: parsed,
        });
      }
    }

    if (!latestAccounts) {
      return {
        record: null,
        errorMsg: `'${cleanName}'의 재무제표 데이터를 DART에서 파싱할 수 없습니다.`,
      };
    }

    const diff = Math.abs(latestAccounts.자산총계 - (latestAccounts.부채총계 + latestAccounts.자본총계));
    const passed = diff <= Math.max(5, latestAccounts.자산총계 * 0.003);

    const liveRecord: CompanyFinancialRecord = {
      corpCode,
      corpName: cleanName,
      stockCode,
      reportName,
      period: latestPeriodLabel,
      rceptNo: latestRceptNo,
      isLiveApiFetched: true,
      verificationPassed: passed,
      verificationNote: passed
        ? `OpenDART 실시간 API 연동 및 회계항등식 검증 통과 (자산 ${latestAccounts.자산총계.toLocaleString()}억 = 부채+자본)`
        : "단위 절사 오차 범위 확인 필요",
      accounts: latestAccounts,
      history4Y: history4Y.reverse(),
    };

    return { record: liveRecord };
  } catch (err: any) {
    return {
      record: null,
      errorMsg: `DART API 연동 중 오류가 발생했습니다: ${err?.message || "네트워크 오류"}`,
    };
  }
}