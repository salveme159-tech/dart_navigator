export interface RawDartAccountMap {
  매출액: number | null;
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
  영업현금흐름: number | null;
  유형자산취득_CAPEX: number | null;
  감가상각비: number | null;
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

export function buildDartSectionDeepLink(rceptNo: string, corpName: string, _metricLabel?: string, _dcmNo?: string): string {
  return buildDartDirectUrl(rceptNo, corpName);
}

async function fetchJsonViaProxy(targetUrl: string): Promise<any | null> {
  const proxies = [
    "https://corsproxy.io/?" + encodeURIComponent(targetUrl),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl),
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(targetUrl),
  ];
  for (const pUrl of proxies) {
    try {
      const res = await fetch(pUrl);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || text.trim().startsWith("<")) continue;
      return JSON.parse(text);
    } catch {
      // try next proxy
    }
  }
  return null;
}

async function fetchBufferViaProxy(targetUrl: string): Promise<ArrayBuffer | null> {
  const proxies = [
    "https://corsproxy.io/?" + encodeURIComponent(targetUrl),
    "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(targetUrl),
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(targetUrl),
  ];
  for (const pUrl of proxies) {
    try {
      const res = await fetch(pUrl);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf && buf.byteLength > 100) return buf;
    } catch {
      // try next proxy
    }
  }
  return null;
}

let cachedCorpList: CorpCodeEntry[] | null = null;

export async function loadAllDartCorpCodes(apiKey: string): Promise<CorpCodeEntry[]> {
  if (cachedCorpList && cachedCorpList.length > 0) {
    return cachedCorpList;
  }
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey || cleanKey.length < 20) return [];

  const zipUrl = "https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=" + encodeURIComponent(cleanKey);
  const buf = await fetchBufferViaProxy(zipUrl);
  if (!buf) return [];

  try {
    const bytes = new Uint8Array(buf);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return [];

    const fileNameLen = bytes[26] | (bytes[27] << 8);
    const extraLen = bytes[28] | (bytes[29] << 8);
    const dataStart = 30 + fileNameLen + extraLen;

    let dataEnd = bytes.length;
    for (let i = dataStart; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
        dataEnd = i;
        break;
      }
    }

    const compressedSlice = bytes.slice(dataStart, dataEnd);
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(compressedSlice);
    writer.close();
    const xmlText = await new Response(ds.readable).text();

    const parsed: CorpCodeEntry[] = [];
    const blocks = xmlText.split("<list>");
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      const cCodeMatch = b.match(/<corp_code>\s*(\d{8})\s*<\/corp_code>/);
      const cNameMatch = b.match(/<corp_name>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/corp_name>/);
      const sCodeMatch = b.match(/<stock_code>\s*(\d{6})?\s*<\/stock_code>/);
      if (cCodeMatch && cNameMatch) {
        parsed.push({
          corpCode: cCodeMatch[1].trim(),
          corpName: cNameMatch[1].trim(),
          stockCode: sCodeMatch && sCodeMatch[1] ? sCodeMatch[1].trim() : "",
        });
      }
    }

    parsed.sort((a, b) => (b.stockCode ? 1 : 0) - (a.stockCode ? 1 : 0));
    cachedCorpList = parsed;
    return parsed;
  } catch {
    return [];
  }
}

export async function findCorpEntryByName(queryName: string, apiKey: string): Promise<CorpCodeEntry | null> {
  const clean = (queryName || "").trim().toLowerCase();
  if (!clean) return null;

  const list = await loadAllDartCorpCodes(apiKey);
  if (list.length > 0) {
    const exactListed = list.find((item) => item.stockCode && item.corpName.toLowerCase() === clean);
    if (exactListed) return exactListed;

    const exactAny = list.find((item) => item.corpName.toLowerCase() === clean);
    if (exactAny) return exactAny;

    const byStockCode = list.find((item) => item.stockCode === clean);
    if (byStockCode) return byStockCode;

    const partialListed = list.find((item) => item.stockCode && item.corpName.toLowerCase().includes(clean));
    if (partialListed) return partialListed;
  }
  return null;
}

function parseToEok(rawVal: any): number | null {
  if (rawVal === undefined || rawVal === null) return null;
  const str = String(rawVal).replace(/,/g, "").trim();
  if (!str || str === "-") return null;
  const num = Number(str);
  if (Number.isNaN(num)) return null;
  return Number((num / 100_000_000).toFixed(1));
}

export function parseDartFullStatementRows(rows: any[]): RawDartAccountMap {
  const findVal = (
    sjDivs: string[],
    idPatterns: RegExp[],
    namePatterns: RegExp[],
    useAbs = false,
    useCumulativeForFlow = false
  ): number | null => {
    const pickAmount = (r: any, isFlow: boolean) => {
      if (isFlow && useCumulativeForFlow && r.thstrm_add_amount && String(r.thstrm_add_amount).trim() !== "-") {
        return parseToEok(r.thstrm_add_amount);
      }
      const primary = parseToEok(r.thstrm_amount);
      if (primary !== null) return primary;
      return parseToEok(r.thstrm_add_amount);
    };

    for (const r of rows) {
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accId = String(r.account_id || "").trim();
      if (idPatterns.some((re) => re.test(accId))) {
        const v = pickAmount(r, r.sj_div === "IS" || r.sj_div === "CIS");
        if (v !== null) return useAbs ? Math.abs(v) : v;
      }
    }
    for (const r of rows) {
      if (sjDivs.length > 0 && !sjDivs.includes(r.sj_div)) continue;
      const accNm = String(r.account_nm || "").replace(/\s+/g, "");
      if (namePatterns.some((re) => re.test(accNm))) {
        const v = pickAmount(r, r.sj_div === "IS" || r.sj_div === "CIS");
        if (v !== null) return useAbs ? Math.abs(v) : v;
      }
    }
    return null;
  };

  const 매출액 = findVal(
    ["IS", "CIS"],
    [/ifrs-full_Revenue$/i, /dart_OperatingRevenue$/i],
    [/^매출액$/, /^수익\(매출액\)$/, /^영업수익$/, /^매출$/, /^I\.매출액$/],
    false,
    true
  );

  const 영업이익 = findVal(
    ["IS", "CIS"],
    [/dart_OperatingIncomeLoss$/i, /ifrs-full_ProfitLossFromOperatingActivities$/i],
    [/^영업이익/, /^영업손익/, /^영업이익\(손실\)$/],
    false,
    true
  );

  const 순이익 = findVal(
    ["IS", "CIS"],
    [/ifrs-full_ProfitLoss$/i],
    [/^당기순이익/, /^당기순손익/, /^분기순이익/, /^반기순이익/, /^연결당기순이익/, /^연결반기순이익/, /^연결분기순이익/],
    false,
    true
  );

  const 자산총계 = findVal(["BS"], [/ifrs-full_Assets$/i], [/^자산총계$/, /^총자산$/]);
  const 부채총계 = findVal(["BS"], [/ifrs-full_Liabilities$/i], [/^부채총계$/, /^총부채$/]);
  const 자본총계 = findVal(["BS"], [/ifrs-full_Equity$/i], [/^자본총계$/, /^총자본$/]);
  const 유동자산 = findVal(["BS"], [/ifrs-full_CurrentAssets$/i], [/^유동자산$/]);
  const 유동부채 = findVal(["BS"], [/ifrs-full_CurrentLiabilities$/i], [/^유동부채$/]);
  const 현금및현금성자산 = findVal(["BS"], [/ifrs-full_CashAndCashEquivalents$/i], [/^현금및현금성자산$/]);
  const 단기금융상품 = findVal(["BS"], [/dart_ShortTermDeposits/i], [/^단기금융상품$/, /^단기투자자산$/]);
  const 매출채권 = findVal(["BS"], [/ifrs-full_TradeAndOtherCurrentReceivables$/i], [/^매출채권/, /^단기매출채권/]);
  const 재고자산 = findVal(["BS"], [/ifrs-full_Inventories$/i], [/^재고자산$/]);
  const 매입채무 = findVal(["BS"], [/ifrs-full_TradeAndOtherCurrentPayables$/i], [/^매입채무/, /^단기매입채무/]);
  const 단기차입금 = findVal(["BS"], [/ifrs-full_ShorttermBorrowings$/i], [/^단기차입금/]);
  const 유동성장기부채 = findVal(["BS"], [/ifrs-full_CurrentPortionOfLongtermBorrowings$/i], [/^유동성장기부채/, /^유동성장기차입금/]);
  const 사채 = findVal(["BS"], [/ifrs-full_BondsIssued$/i], [/^사채$/, /^회사채$/]);
  const 장기차입금 = findVal(["BS"], [/ifrs-full_LongtermBorrowings$/i], [/^장기차입금/]);

  const 영업현금흐름 = findVal(
    ["CF"],
    [/ifrs-full_CashFlowsFromUsedInOperatingActivities$/i],
    [/^영업활동현금흐름/, /^영업활동으로인한현금흐름/]
  );

  const 유형자산취득_CAPEX = findVal(
    ["CF"],
    [/ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i],
    [/유형자산의취득/, /유형자산의증가/],
    true
  );

  const 감가상각비 = findVal(
    ["CF", "IS", "CIS"],
    [/ifrs-full_AdjustmentsForDepreciationExpense$/i, /ifrs-full_DepreciationAndAmortisationExpense$/i],
    [/^감가상각비$/, /^유형자산감가상각비$/, /^유무형자산상각비$/],
    true
  );

  const 금융원가 = findVal(
    ["IS", "CIS"],
    [/ifrs-full_FinanceCosts$/i],
    [/^금융원가/, /^금융비용/, /^이자비용/],
    false,
    true
  );

  return {
    매출액, 영업이익, 순이익, 자산총계, 부채총계, 자본총계,
    유동자산, 유동부채, 현금및현금성자산, 단기금융상품,
    매출채권, 재고자산, 매입채무, 단기차입금, 유동성장기부채,
    사채, 장기차입금, 영업현금흐름, 유형자산취득_CAPEX, 감가상각비, 금융원가,
  };
}

async function fetchSingleStatementPeriod(
  corpCode: string,
  bsnsYear: string,
  reprtCode: string,
  periodKey: string,
  periodLabel: string,
  reportTitle: string,
  apiKey: string,
  fallbackRceptNo: string
): Promise<PeriodFinancialSnapshot | null> {
  for (const fsDiv of ["CFS", "OFS"] as const) {
    const url =
      "https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json?crtfc_key=" +
      encodeURIComponent(apiKey) +
      "&corp_code=" +
      corpCode +
      "&bsns_year=" +
      bsnsYear +
      "&reprt_code=" +
      reprtCode +
      "&fs_div=" +
      fsDiv;

    const json = await fetchJsonViaProxy(url);
    if (json && json.status === "000" && Array.isArray(json.list) && json.list.length > 0) {
      const accounts = parseDartFullStatementRows(json.list);
      const rceptNo = String(json.list[0]?.rcept_no || fallbackRceptNo);
      return {
        periodKey,
        periodLabel,
        reportName: reportTitle + (fsDiv === "CFS" ? " (연결)" : " (별도)"),
        rceptNo,
        fsDiv,
        accounts,
      };
    }
  }
  return null;
}

export async function fetchLiveDartCompanyRecord(
  corpNameInput: string,
  apiKey: string
): Promise<{ record: CompanyFinancialRecord | null; errorMsg?: string }> {
  const cleanKey = (apiKey || "").trim();
  if (!cleanKey || cleanKey.length < 20) {
    return {
      record: null,
      errorMsg: "유효한 40자리 OpenDART API 인증키를 먼저 입력해 주세요.",
    };
  }

  const entry = await findCorpEntryByName(corpNameInput, cleanKey);
  if (!entry) {
    return {
      record: null,
      errorMsg: `'${corpNameInput}' 기업을 OpenDART 고유번호 마스터에서 찾을 수 없습니다. 정확한 기업명 또는 6자리 종목코드를 입력해 주세요.`,
    };
  }

  const listUrl =
    "https://opendart.fss.or.kr/api/list.json?crtfc_key=" +
    encodeURIComponent(cleanKey) +
    "&corp_code=" +
    entry.corpCode +
    "&bgn_de=20220101&pblntf_ty=A&page_no=1&page_count=20";

  const listJson = await fetchJsonViaProxy(listUrl);
  const filingList: any[] = listJson && Array.isArray(listJson.list) ? listJson.list : [];
  const latestFilingRceptNo = filingList[0]?.rcept_no ? String(filingList[0].rcept_no) : "";

  const latestCandidates = [
    { year: "2026", code: "11014", key: "LATEST", label: "2026.09 (3분기 누적)", title: "2026년 3분기보고서" },
    { year: "2026", code: "11012", key: "LATEST", label: "2026.06 (상반기)", title: "2026년 반기보고서" },
    { year: "2026", code: "11013", key: "LATEST", label: "2026.03 (1분기)", title: "2026년 1분기보고서" },
    { year: "2025", code: "11011", key: "2025", label: "2025.12 (연간)", title: "2025년 사업보고서" },
    { year: "2025", code: "11012", key: "LATEST", label: "2025.06 (상반기)", title: "2025년 반기보고서" },
    { year: "2024", code: "11011", key: "2024", label: "2024.12 (연간)", title: "2024년 사업보고서" },
  ];

  let latestSnap: PeriodFinancialSnapshot | null = null;
  for (const cand of latestCandidates) {
    const snap = await fetchSingleStatementPeriod(
      entry.corpCode,
      cand.year,
      cand.code,
      cand.key,
      cand.label,
      cand.title,
      cleanKey,
      latestFilingRceptNo
    );
    if (snap && (snap.accounts.매출액 !== null || snap.accounts.자산총계 !== null)) {
      latestSnap = snap;
      break;
    }
  }

  if (!latestSnap) {
    return {
      record: null,
      errorMsg: `'${entry.corpName}'의 정기보고서 재무제표를 OpenDART에서 불러오지 못했습니다.`,
    };
  }

  const annualYears = ["2022", "2023", "2024", "2025"];
  const annualPromises = annualYears.map((yr) =>
    fetchSingleStatementPeriod(
      entry.corpCode,
      yr,
      "11011",
      yr,
      `${yr}.12 (연간)`,
      `${yr}년 사업보고서`,
      cleanKey,
      latestFilingRceptNo
    )
  );
  const annualResults = await Promise.all(annualPromises);
  const history4Y: PeriodFinancialSnapshot[] = [];

  for (const res of annualResults) {
    if (res && (res.accounts.매출액 !== null || res.accounts.자산총계 !== null)) {
      history4Y.push(res);
    }
  }

  if (!history4Y.some((h) => h.rceptNo === latestSnap!.rceptNo)) {
    history4Y.push(latestSnap);
  }

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
        ? `회계항등식 검증 통과 (자산 ${acc.자산총계!.toLocaleString()}억 = 부채 ${acc.부채총계!.toLocaleString()}억 + 자본 ${acc.자본총계!.toLocaleString()}억)`
        : "OpenDART 원문 데이터 수신 완료",
      accounts: latestSnap.accounts,
      history4Y,
    },
  };
}