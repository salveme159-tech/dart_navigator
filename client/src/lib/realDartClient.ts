export interface RawDartAccountMap {
  매출액: number | null;
  매출원가: number | null;
  영업이익: number | null;
  순이익: number | null;
  자산총계: number | null;
  부채총계: number | null;
  자본총계: number | null;
  유동자산: number | null;
  유동부채: number | null;
  현금및현금성자산: number | null;
  단기금융상품: number | null;
  매출채권: number | null;
  재고자산: number | null;
  매입채무: number | null;
  단기차입금: number | null;
  유동성장기부채: number | null;
  사채: number | null;
  장기차입금: number | null;
  총차입금_정밀원화합산: number | null;
  차입금의존도_정밀산출: number | null;
  영업현금흐름: number | null;
  유형자산취득_CAPEX: number | null;
  감가상각비: number | null;
  무형자산상각비: number | null;
  금융원가: number | null;
}

export interface PeriodFinancialSnapshot {
  periodKey: string;
  periodLabel: string;
  reportName: string;
  rceptNo: string;
  fsDiv: "CFS" | "OFS";
  accounts: RawDartAccountMap;
}

export interface CompanyFinancialRecord {
  corpCode: string;
  corpName: string;
  stockCode: string;
  reportName: string;
  period: string;
  rceptNo: string;
  fsDiv: "CFS" | "OFS";
  isLiveApiFetched: boolean;
  verificationPassed: boolean;
  verificationNote: string;
  accounts: RawDartAccountMap;
  history4Y: PeriodFinancialSnapshot[];
}

export interface CorpCodeEntry {
  corpCode: string;
  corpName: string;
  stockCode: string;
}

export function buildDartDirectUrl(rceptNo: string, corpName: string): string {
  const clean = String(rceptNo || "").trim();
  if (/^\d{14}$/.test(clean)) {
    return "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=" + clean;
  }
  return "https://dart.fss.or.kr/dsab007/detailSearch.ax?textCrpNm=" + encodeURIComponent(corpName);
}

export function buildDartSectionDeepLink(rceptNo: string, corpName: string): string {
  return buildDartDirectUrl(rceptNo, corpName);
}

const CORP_CODE_DIRECTORY: CorpCodeEntry[] = [
  { corpName: "대한전선", corpCode: "00113526", stockCode: "001440" },
  { corpName: "가온전선", corpCode: "00100939", stockCode: "000500" },
  { corpName: "LS", corpCode: "00117601", stockCode: "006260" },
  { corpName: "삼성전자", corpCode: "00126380", stockCode: "005930" },
  { corpName: "SK하이닉스", corpCode: "00164779", stockCode: "000660" },
  { corpName: "효성중공업", corpCode: "01318636", stockCode: "298040" },
  { corpName: "HD현대일렉트릭", corpCode: "01204959", stockCode: "267260" },
  { corpName: "일진전기", corpCode: "00688996", stockCode: "103590" },
  { corpName: "에넥스", corpCode: "00142492", stockCode: "011090" },
  { corpName: "에이스테크", corpCode: "00579005", stockCode: "088800" },
  { corpName: "현대자동차", corpCode: "00164742", stockCode: "005380" },
  { corpName: "기아", corpCode: "00106641", stockCode: "000270" },
  { corpName: "POSCO홀딩스", corpCode: "00155319", stockCode: "005490" },
  { corpName: "한화에어로스페이스", corpCode: "00162461", stockCode: "012450" },
  { corpName: "두산에너빌리티", corpCode: "00159616", stockCode: "034020" },
  { corpName: "한미반도체", corpCode: "00161383", stockCode: "042700" },
];

export async function loadAllDartCorpCodes(_apiKey: string): Promise<CorpCodeEntry[]> {
  return CORP_CODE_DIRECTORY;
}

async function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenDartJson(targetUrl: string): Promise<any | null> {
  const gateways = [
    "https://corsproxy.io/?" + encodeURIComponent(targetUrl),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl),
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(targetUrl),
  ];

  for (const gw of gateways) {
    try {
      const res = await fetchWithTimeout(gw, 7000);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith("<")) continue;
      const json = JSON.parse(text);
      if (json && typeof json === "object") return json;
    } catch {}
  }
  return null;
}

export async function findCorpEntryByName(queryName: string, apiKey: string): Promise<CorpCodeEntry | null> {
  const clean = (queryName || "").trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();

  if (/^\d{8}$/.test(clean)) {
    const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${encodeURIComponent(apiKey.trim())}&corp_code=${clean}`;
    const info = await fetchOpenDartJson(url);
    if (info && info.status === "000") {
      return { corpCode: clean, corpName: info.corp_name || clean, stockCode: info.stock_code || "" };
    }
  }

  const exact = CORP_CODE_DIRECTORY.find(
    (c) => c.corpName.toLowerCase() === lower || c.stockCode === clean
  );
  if (exact) return exact;

  const partial = CORP_CODE_DIRECTORY.find((c) => c.corpName.toLowerCase().includes(lower));
  if (partial) return partial;

  return null;
}

function parseRawWon(val: any): number | null {
  if (val === undefined || val === null) return null;
  const str = String(val).replace(/,/g, "").trim();
  if (!str || str === "-") return null;
  const num = Number(str);
  return Number.isNaN(num) ? null : num;
}

function wonToEok(won: number | null): number | null {
  if (won === null) return null;
  return Number((won / 100_000_000).toFixed(2));
}

export function parseDartFullStatementRows(rows: any[]): RawDartAccountMap {
  const usedRowIndices = new Set<number>();

  const findRawWon = (
    sjDivs: string[],
    idPatterns: RegExp[],
    namePatterns: RegExp[],
    useAbs = false,
    lockRow = false,
    preferCumulativeFlow = false
  ): number | null => {
    const extractWon = (r: any) => {
      const isFlow = r.sj_div === "IS" || r.sj_div === "CIS";
      if (isFlow && preferCumulativeFlow) {
        const cum = parseRawWon(r.thstrm_add_amount);
        if (cum !== null) return cum;
      }
      const primary = parseRawWon(r.thstrm_amount);
      if (primary !== null) return primary;
      return parseRawWon(r.thstrm_add_amount);
    };

    for (let i = 0; i < rows.length; i++) {
      if (lockRow && usedRowIndices.has(i)) continue;
      const r = rows[i];
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accId = String(r.account_id || "").trim();
      if (accId && accId !== "-표준계정코드 미사용-" && idPatterns.some((re) => re.test(accId))) {
        const v = extractWon(r);
        if (v !== null) {
          if (lockRow) usedRowIndices.add(i);
          return useAbs ? Math.abs(v) : v;
        }
      }
    }

    for (let i = 0; i < rows.length; i++) {
      if (lockRow && usedRowIndices.has(i)) continue;
      const r = rows[i];
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const cleanNm = String(r.account_nm || "")
        .replace(/\(주\d*\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/\s+/g, "");
      if (namePatterns.some((re) => re.test(cleanNm))) {
        const v = extractWon(r);
        if (v !== null) {
          if (lockRow) usedRowIndices.add(i);
          return useAbs ? Math.abs(v) : v;
        }
      }
    }
    return null;
  };

  const sumAllMatchingRawWon = (
    sjDivs: string[],
    idPatterns: RegExp[],
    namePatterns: RegExp[],
    useAbs = true
  ): number | null => {
    let sum = 0;
    let found = false;
    for (let i = 0; i < rows.length; i++) {
      if (usedRowIndices.has(i)) continue;
      const r = rows[i];
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accId = String(r.account_id || "").trim();
      const cleanNm = String(r.account_nm || "")
        .replace(/\(주\d*\)/g, "")
        .replace(/\[.*?\]/g, "")
        .replace(/\s+/g, "");

      const idMatched =
        accId && accId !== "-표준계정코드 미사용-" && idPatterns.some((re) => re.test(accId));
      const nmMatched = namePatterns.some((re) => re.test(cleanNm));

      if (idMatched || nmMatched) {
        const v = parseRawWon(r.thstrm_amount ?? r.thstrm_add_amount);
        if (v !== null) {
          usedRowIndices.add(i);
          sum += useAbs ? Math.abs(v) : v;
          found = true;
        }
      }
    }
    return found ? sum : null;
  };

  const revWon = findRawWon(
    ["IS", "CIS"],
    [/ifrs-full_Revenue$/i, /dart_OperatingRevenue$/i],
    [/^매출액$/, /^수익\(매출액\)$/, /^영업수익$/, /^I\.매출액$/],
    false,
    false,
    true
  );
  const cogsWon = findRawWon(
    ["IS", "CIS"],
    [/ifrs-full_CostOfSales$/i],
    [/^매출원가$/, /^II\.매출원가$/],
    true,
    false,
    true
  );
  const opWon = findRawWon(
    ["IS", "CIS"],
    [/dart_OperatingIncomeLoss$/i, /ifrs-full_ProfitLossFromOperatingActivities$/i],
    [/^영업이익/, /^영업손익/],
    false,
    false,
    true
  );
  const netWon = findRawWon(
    ["IS", "CIS"],
    [/ifrs-full_ProfitLoss$/i],
    [/^당기순이익/, /^반기순이익/, /^분기순이익/, /^연결당기순이익/, /^연결반기순이익/, /^연결분기순이익/],
    false,
    false,
    true
  );

  const assetsWon = findRawWon(["BS"], [/ifrs-full_Assets$/i], [/^자산총계$/, /^총자산$/]);
  const liabWon = findRawWon(["BS"], [/ifrs-full_Liabilities$/i], [/^부채총계$/, /^총부채$/]);
  const equityWon = findRawWon(["BS"], [/ifrs-full_Equity$/i], [/^자본총계$/, /^총자본$/]);
  const curAssetsWon = findRawWon(["BS"], [/ifrs-full_CurrentAssets$/i], [/^유동자산$/]);
  const curLiabWon = findRawWon(["BS"], [/ifrs-full_CurrentLiabilities$/i], [/^유동부채$/]);
  const cashWon = findRawWon(["BS"], [/ifrs-full_CashAndCashEquivalents$/i], [/^현금및현금성자산$/]);
  const stFinWon = findRawWon(["BS"], [/dart_ShortTermDeposits/i], [/^단기금융상품$/, /^단기투자자산$/]);
  const arWon = findRawWon(["BS"], [/ifrs-full_TradeAndOtherCurrentReceivables$/i], [/^매출채권/, /^단기매출채권/]);
  const invWon = findRawWon(["BS"], [/ifrs-full_Inventories$/i], [/^재고자산$/]);
  const apWon = findRawWon(["BS"], [/ifrs-full_TradeAndOtherCurrentPayables$/i], [/^매입채무/, /^단기매입채무/]);

  const stBorrowWon = findRawWon(
    ["BS"],
    [/ifrs-full_ShorttermBorrowings$/i],
    [/^단기차입금$/],
    false,
    true
  );
  const curLongBorrowWon = findRawWon(
    ["BS"],
    [/ifrs-full_CurrentPortionOfLongtermBorrowings$/i, /dart_CurrentPortionOfLongTermBorrowings/i],
    [/^유동성장기부채$/, /^유동성장기차입금$/, /^유동성장기금융부채$/, /^유동성사채$/, /^유동성장기차입금및사채$/],
    false,
    true
  );
  const bondsWon = findRawWon(
    ["BS"],
    [/ifrs-full_BondsIssued$/i],
    [/^사채$/, /^회사채$/],
    false,
    true
  );
  const ltBorrowWon = findRawWon(
    ["BS"],
    [/ifrs-full_LongtermBorrowings$/i],
    [/^장기차입금$/, /^장기금융부채$/, /^장기차입금및사채$/],
    false,
    true
  );

  const totalDebtWon =
    (stBorrowWon || 0) + (curLongBorrowWon || 0) + (bondsWon || 0) + (ltBorrowWon || 0);
  const hasAnyDebt =
    stBorrowWon !== null || curLongBorrowWon !== null || bondsWon !== null || ltBorrowWon !== null;

  const exactDebtDependencyPct =
    hasAnyDebt && assetsWon && assetsWon > 0
      ? Number(((totalDebtWon / assetsWon) * 100).toFixed(2))
      : null;

  const ocfWon = findRawWon(
    ["CF"],
    [/ifrs-full_CashFlowsFromUsedInOperatingActivities$/i],
    [/^영업활동현금흐름/, /^영업활동으로인한현금흐름/]
  );
  const capexWon = findRawWon(
    ["CF"],
    [/ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i],
    [/유형자산의취득/, /유형자산의증가/],
    true
  );

  const deprWon = sumAllMatchingRawWon(
    ["CF", "IS", "CIS"],
    [
      /ifrs-full_AdjustmentsForDepreciationExpense$/i,
      /ifrs-full_DepreciationAndAmortisationExpense$/i,
      /ifrs-full_DepreciationExpense$/i,
      /dart_DepreciationExpense$/i,
    ],
    [
      /^감가상각비$/,
      /^유형자산감가상각비$/,
      /^유무형자산상각비$/,
      /^감가상각비및무형자산상각비$/,
      /^유형자산및투자부동산감가상각비$/,
      /^투자부동산감가상각비$/,
      /^사용권자산감가상각비$/,
    ],
    true
  );

  const amortWon = sumAllMatchingRawWon(
    ["CF", "IS", "CIS"],
    [/ifrs-full_AdjustmentsForAmortisationExpense$/i, /ifrs-full_AmortisationExpense$/i],
    [/^무형자산상각비$/, /^무형자산감가상각비$/],
    true
  );

  const finCostWon = findRawWon(
    ["IS", "CIS", "CF"],
    [/ifrs-full_FinanceCosts$/i, /ifrs-full_InterestExpense$/i],
    [/^금융원가$/, /^금융비용$/, /^이자비용/],
    true,
    false,
    true
  );

  return {
    매출액: wonToEok(revWon),
    매출원가: wonToEok(cogsWon),
    영업이익: wonToEok(opWon),
    순이익: wonToEok(netWon),
    자산총계: wonToEok(assetsWon),
    부채총계: wonToEok(liabWon),
    자본총계: wonToEok(equityWon),
    유동자산: wonToEok(curAssetsWon),
    유동부채: wonToEok(curLiabWon),
    현금및현금성자산: wonToEok(cashWon),
    단기금융상품: wonToEok(stFinWon),
    매출채권: wonToEok(arWon),
    재고자산: wonToEok(invWon),
    매입채무: wonToEok(apWon),
    단기차입금: wonToEok(stBorrowWon),
    유동성장기부채: wonToEok(curLongBorrowWon),
    사채: wonToEok(bondsWon),
    장기차입금: wonToEok(ltBorrowWon),
    총차입금_정밀원화합산: hasAnyDebt ? wonToEok(totalDebtWon) : null,
    차입금의존도_정밀산출: exactDebtDependencyPct,
    영업현금흐름: wonToEok(ocfWon),
    유형자산취득_CAPEX: wonToEok(capexWon),
    감가상각비: wonToEok(deprWon),
    무형자산상각비: wonToEok(amortWon),
    금융원가: wonToEok(finCostWon),
  };
}

async function fetchSinglePeriodFromDart(
  corpCode: string,
  bsnsYear: string,
  reprtCode: string,
  periodKey: string,
  periodLabel: string,
  reportTitle: string,
  apiKey: string
): Promise<{ snap: PeriodFinancialSnapshot | null; apiErr?: string }> {
  for (const fsDiv of ["CFS", "OFS"] as const) {
    const url =
      `https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=${encodeURIComponent(apiKey)}` +
      `&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=${fsDiv}`;

    const json = await fetchOpenDartJson(url);
    if (!json) continue;

    if (json.status === "010" || json.status === "011" || json.status === "020") {
      return { snap: null, apiErr: `OpenDART API 오류(${json.status}): ${json.message}` };
    }

    if (json.status === "000" && Array.isArray(json.list) && json.list.length > 0) {
      const accounts = parseDartFullStatementRows(json.list);
      const rceptNo = String(json.list[0]?.rcept_no || "");
      return {
        snap: {
          periodKey,
          periodLabel,
          reportName: `${reportTitle} (${fsDiv === "CFS" ? "연결" : "별도"})`,
          rceptNo,
          fsDiv,
          accounts,
        },
      };
    }
  }
  return { snap: null };
}

export async function fetchLiveDartCompanyRecord(
  corpNameInput: string,
  apiKey: string
): Promise<{ record: CompanyFinancialRecord | null; errorMsg?: string }> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey || cleanKey.length < 20 || cleanKey.startsWith("VERIFIED")) {
    return {
      record: null,
      errorMsg: "좌측 하단 [API 변경]을 눌러 실제 40자리 OpenDART API 인증키를 입력해 주세요.",
    };
  }

  const entry = await findCorpEntryByName(corpNameInput, cleanKey);
  if (!entry) {
    return {
      record: null,
      errorMsg: `'${corpNameInput}' 기업을 찾을 수 없습니다. 정확한 기업명 또는 8자리 DART 고유번호를 입력해 주세요.`,
    };
  }

  const targetPeriods = [
    { year: "2023", code: "11011", key: "2023", label: "2023.12 (연간)", title: "2023년 사업보고서" },
    { year: "2024", code: "11011", key: "2024", label: "2024.12 (연간)", title: "2024년 사업보고서" },
    { year: "2025", code: "11011", key: "2025", label: "2025.12 (연간)", title: "2025년 사업보고서" },
    { year: "2026", code: "11013", key: "2026.1Q", label: "2026.03 (1분기)", title: "2026년 1분기보고서" },
    { year: "2026", code: "11012", key: "2026.1H", label: "2026.06 (상반기)", title: "2026년 반기보고서" },
  ];

  const results = await Promise.all(
    targetPeriods.map((p) =>
      fetchSinglePeriodFromDart(entry.corpCode, p.year, p.code, p.key, p.label, p.title, cleanKey)
    )
  );

  const errHit = results.find((r) => r.apiErr);
  if (errHit && errHit.apiErr) {
    return { record: null, errorMsg: errHit.apiErr };
  }

  const validSnaps = results
    .map((r) => r.snap)
    .filter((s): s is PeriodFinancialSnapshot => s !== null && (s.accounts.매출액 !== null || s.accounts.자산총계 !== null));

  if (validSnaps.length === 0) {
    return {
      record: null,
      errorMsg: `'${entry.corpName}'의 OpenDART 재무제표 응답을 받지 못했습니다. API 인증키와 네트워크를 확인해 주세요.`,
    };
  }

  const latestSnap = validSnaps[validSnaps.length - 1];
  const acc = latestSnap.accounts;
  const hasBs = acc.자산총계 !== null && acc.부채총계 !== null && acc.자본총계 !== null;
  const diff = hasBs ? Math.abs(acc.자산총계! - (acc.부채총계! + acc.자본총계!)) : 0;
  const passed = hasBs ? diff <= Math.max(5, acc.자산총계! * 0.005) : true;

  return {
    record: {
      corpCode: entry.corpCode,
      corpName: entry.corpName,
      stockCode: entry.stockCode || "-",
      reportName: latestSnap.reportName,
      period: latestSnap.periodLabel,
      rceptNo: latestSnap.rceptNo,
      fsDiv: latestSnap.fsDiv,
      isLiveApiFetched: true,
      verificationPassed: passed,
      verificationNote: hasBs
        ? `OpenDART 실시간 원문 검증 통과 (자산 ${acc.자산총계!.toLocaleString()}억 = 부채 ${acc.부채총계!.toLocaleString()}억 + 자본 ${acc.자본총계!.toLocaleString()}억)`
        : "OpenDART 실시간 원문 수신 완료",
      accounts: latestSnap.accounts,
      history4Y: validSnaps,
    },
  };
}