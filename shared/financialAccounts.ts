// 공시 계정 및 금액 해석을 서버와 브라우저에서 함께 사용합니다.
export type Row = {
  ord?: string | number;
  fs_div?: string;
  bsns_year?: string;
  reprt_code?: string;
  corp_code?: string;
  currency?: string;
  thstrm_dt?: string;
  frmtrm_dt?: string;
  amount_mode?: "cum" | "qtr";
  source_type?: "ALL" | "MAJOR";
  recovery_note?: string;
  sj_div?: string;
  sj_nm?: string;
  account_id?: string;
  unit?: string;
  thstrm_nm?: string;
  account_nm?: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
  rcept_no?: string;
};

const N = (s?: string) => (s ?? "").replace(/[\s·ㆍ]/g, "");
const AMT = ["thstrm_amount", "frmtrm_amount", "bfefrmtrm_amount"] as const;

export function amountOf(r: Row, idx = 0, cum = false): number | null {
  // Numeric API amounts are KRW. Never silently label a foreign-currency amount as won.
  if (r.currency && !/^(KRW|원|원화)$/i.test(r.currency.trim())) return null;
  const raw = ((cum && idx === 0 && r.thstrm_add_amount?.trim() ? r.thstrm_add_amount : r[AMT[idx]]) ?? "")
    .replace(/[,\s\u200b-\u200d\ufeff]/g, "").replace(/[−－]/g, "-");
  if (!raw) return null;
  if (/^(?:-|—|–)$/.test(raw)) return 0;
  const signed = /^\([+\-]?\d+(?:\.\d+)?\)$/.test(raw) ? `-${raw.slice(1,-1).replace(/^[+\-]/,"")}`
    : /^[△▲]\d+(?:\.\d+)?$/.test(raw) ? `-${raw.slice(1)}` : raw;
  if (!/^[+\-]?\d+(?:\.\d+)?$/.test(signed)) return null;
  const value = Number(signed);
  return Number.isFinite(value) ? value / 1e8 : null;
}

export type AccountPeriod = { year: number; kind: "annual" | "half" | "q1" | "q3"; mode: "cum" | "qtr" };

/** In interim income statements thstrm_amount and thstrm_add_amount have different periods. */
export function periodAmount(row: Row, period: AccountPeriod, idx = 0): number | null {
  if (idx !== 0 || row.sj_div === "BS") return amountOf(row, idx);
  if (period.kind === "annual" || period.kind === "q1") return amountOf(row, 0, period.mode === "cum");
  const dateParts = (row.thstrm_dt ?? "").match(/20\d{2}[.\-/]\d{2}[.\-/]\d{2}/g) ?? [];
  const dates = dateParts.map(v => v.replace(/\D/g, ""));
  const end = `${period.year}${period.kind === "half" ? "0630" : "0930"}`;
  const starts = period.mode === "cum" ? `${period.year}0101` : `${period.year}${period.kind === "half" ? "0401" : "0701"}`;
  if (period.mode === "cum") {
    if (row.thstrm_add_amount?.trim()) return amountOf(row, 0, true);
    // Cash-flow statements report year-to-date cash movements, including when add_amount is absent.
    if (row.sj_div === "CF" || row.amount_mode === "cum" || (dates[0] === starts && dates.at(-1) === end)) return amountOf(row);
    return null;
  }
  if (row.sj_div === "CF") return row.amount_mode === "qtr" ? amountOf(row) : null;
  if (row.amount_mode === "cum") return null;
  if (row.thstrm_add_amount?.trim() || row.amount_mode === "qtr" || (dates[0] === starts && dates.at(-1) === end)) return amountOf(row);
  return null;
}

export function sameAccountScope(a:Row,b:Row) {
  return (["corp_code","bsns_year","reprt_code","fs_div","rcept_no"] as const).every(key=>!a[key] || !b[key] || a[key]===b[key]);
}

/** Components of an income ratio must belong to the same statement and disclosure scope. */
export function pairedIncome(rows: Row[], period: AccountPeriod, names: string[]) {
  const sections = ["CIS","IS"];
  for (const section of sections) {
    const candidates = rows.filter(r => r.sj_div === section);
    const revenue = findRevenueRow(candidates, [section], period);
    const profit = findRowLike(candidates, [section], names, period);
    if (!revenue) continue;
    if (!profit) return null;
    const scope = ["corp_code", "bsns_year", "reprt_code", "fs_div", "rcept_no"] as const;
    if (scope.some(key => revenue[key] && profit[key] && revenue[key] !== profit[key])) return null;
    const rev = periodAmount(revenue, period), value = periodAmount(profit, period);
    if (rev !== null && value !== null) return { revenue, profit, rev, value };
  }
  return null;
}

/** Ignore typography, report row numbering and zero-width characters, not account meaning. */
export const normalizeAccountName = (value?: string) => (value ?? "").normalize("NFKC")
  .replace(/^[\s\u200b-\u200d\ufeff]*(?:(?:[IVXivx]+|\d+)[.．、)）]\s*|\(\d+\)\s*)/, "")
  .replace(/[\s\u200b-\u200d\ufeff·ㆍ]/g, "");

const STANDARD_ACCOUNTS: Array<{names:string[]; ids:RegExp; exclude?:RegExp}> = [
  {names:["영업이익","영업이익(손실)","영업손익","영업손실"], ids:/^(?:dart_OperatingIncomeLoss|ifrs-full_ProfitLossFromOperatingActivities)$/i, exclude:/영업외|중단영업|계속영업|영업이익률|부문|조정/},
  {names:["당기순이익","당기순이익(손실)","당기순손익","반기순손익","분기순손익","반기순이익","분기순이익","연결당기순이익","연결당기순이익(손실)","당기순손실"],ids:/^ifrs-full_ProfitLoss$/i,exclude:/귀속|지배|비지배|계속영업|중단영업|주당|세전|법인세차감전|순이익률/},
  {names:["자산총계"],ids:/^ifrs-full_Assets$/i},
  {names:["부채총계"],ids:/^ifrs-full_Liabilities$/i},
  {names:["자본총계"],ids:/^ifrs-full_Equity$/i,exclude:/지배|비지배/},
  {names:["유동자산"],ids:/^ifrs-full_CurrentAssets$/i},
  {names:["유동부채"],ids:/^ifrs-full_CurrentLiabilities$/i},
  {names:["재고자산"],ids:/^ifrs-full_Inventories$/i},
  {names:["현금및현금성자산"],ids:/^ifrs-full_CashAndCashEquivalents$/i},
  {names:["영업활동으로인한현금흐름","영업활동현금흐름","영업활동순현금흐름"],ids:/^ifrs-full_CashFlowsFromUsedInOperatingActivities$/i},
  {names:["투자활동으로인한현금흐름","투자활동현금흐름","투자활동순현금흐름"],ids:/^ifrs-full_CashFlowsFromUsedInInvestingActivities$/i},
  {names:["재무활동으로인한현금흐름","재무활동현금흐름","재무활동순현금흐름"],ids:/^ifrs-full_CashFlowsFromUsedInFinancingActivities$/i},
  {names:["유형자산의취득","유형자산취득"],ids:/^ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i},
];

export const findRow = (rows: Row[], sj: string[], names: string[]) => {
  const target = names.map(N);
  return rows.find((r) => sj.includes(r.sj_div ?? "") && target.includes(N(r.account_nm)) && !N(r.account_nm).includes("리스"));
};

/**
 * 매출은 회사·연도에 따라 계정명이 "매출액", "영업수익", "수익(매출액)" 또는
 * IFRS 표준계정코드로 반환될 수 있습니다. 재무제표 API의 account_id를 우선
 * 활용하되, 매출원가·매출채권·기타수익을 매출로 오인하지 않습니다.
 */
export const findRevenueRow = (rows: Row[], sj: string[] = ["CIS", "IS"], period?: AccountPeriod) => {
  const normalize = (value?: string) => normalizeAccountName(value).replace(/[()（）,，:：]/g, "").toLowerCase();
  const exactNames = [
    "매출액", "수익(매출액)", "영업수익", "매출액(영업수익)", "영업수익(매출액)", "총영업수익", "영업수익합계", "매출", "매출(수익)", "수익",
    "고객과의계약에서생기는수익", "고객과의계약에서생기는수익(매출액)", "고객과의계약에서발생하는수익",
  ].map(normalize);
  const idPattern = /^(?:ifrs-full_Revenue|dart_OperatingRevenue|ifrs-full_RevenueFromContractsWithCustomers|ifrs-full_RevenueFromContractsWithCustomersIncludingAmountsCollectedOnBehalfOfThirdParties)$/i;
  const exclude = /매출채권|매출원가|매출총이익|매출할인|매출에누리|매출환입|기타수익|금융수익|지분법수익|영업외수익|법인세수익/;
  const candidates = rows.flatMap((row) => {
    if (!sj.includes(row.sj_div ?? "")) return [];
    const rawName = N(row.account_nm);
    const name = normalize(row.account_nm);
    const accountId = String(row.account_id ?? "");
    if (exclude.test(rawName)) return [];
    const idMatch = idPattern.test(accountId);
    const exactIndex = exactNames.indexOf(name);
    const prefixMatch = ["매출액", "수익매출액", "영업수익", "매출수익", "고객과의계약에서생기는수익", "고객과의계약에서발생하는수익"].some((alias) => name.startsWith(normalize(alias)));
    if (!idMatch && exactIndex < 0 && !prefixMatch) return [];
    // 값이 있는 행을 우선하고, 표준 계정코드/정확한 계정명/접두어 순으로 선택합니다.
    const raw = row.thstrm_add_amount || row.thstrm_amount || "";
    const hasAmount = period ? periodAmount(row,period) !== null : amountOf(row,0,true) !== null || amountOf(row) !== null;
    const rank = idMatch ? 0 : exactIndex >= 0 ? 1 + exactIndex : 20;
    return [{ row, score: (hasAmount ? 0 : 100) + rank }];
  });
  candidates.sort((a, b) => {
    const statementRank = (row: Row) => sj.indexOf(row.sj_div ?? "");
    return Number(b.score < 100)-Number(a.score < 100) || statementRank(a.row) - statementRank(b.row) || a.score - b.score || N(a.row.account_nm).length - N(b.row.account_nm).length;
  });
  return candidates[0]?.row;
};

export const findRowLike = (rows: Row[], sj: string[], names: string[], period?: AccountPeriod) => {
  const target = names.map(normalizeAccountName);
  const standards = STANDARD_ACCOUNTS.filter(group => group.names.some(name => target.includes(normalizeAccountName(name))));
  const candidates = rows.flatMap(row => {
    if (!sj.includes(row.sj_div ?? "")) return [];
    const account = normalizeAccountName(row.account_nm);
    if (account.includes("리스")) return [];
    const standard = standards.find(group => group.ids.test(row.account_id ?? ""));
    // For aggregate net income, owners' share and discontinued operations are not substitutes.
    if (standards.some(group => group.exclude?.test(account))) return [];
    const exact = target.indexOf(account);
    const alias = standards.some(group => group.names.map(normalizeAccountName).includes(account));
    const prefix = target.findIndex(name => name.length>=3 && account.startsWith(name) && !(name==="매출" && /^(매출채권|매출원가|매출총이익)/.test(account)));
    if (!standard && exact<0 && !alias && prefix<0) return [];
    // A blank aggregate row must not hide a populated duplicate in another income statement.
    const available = period ? periodAmount(row,period) !== null : amountOf(row) !== null || amountOf(row,0,true) !== null;
    return [{row, available, rank:standard ? 0 : exact>=0 ? 10+exact : alias ? 30 : 50+prefix}];
  });
  candidates.sort((a,b) => Number(b.available)-Number(a.available) || sj.indexOf(a.row.sj_div ?? "")-sj.indexOf(b.row.sj_div ?? "") || a.rank-b.rank || normalizeAccountName(a.row.account_nm).length-normalizeAccountName(b.row.account_nm).length);
  return candidates[0]?.row;
};


export const ACCOUNT_SPECS: Record<string, { sj: string[]; names: string[]; ids?: RegExp[]; exclude?: RegExp[] }> = {
  매출액: { sj: ["CIS", "IS"], names: ["매출액", "수익(매출액)", "영업수익", "매출", "수익", "고객과의계약에서생기는수익", "고객과의계약에서발생하는수익"], ids: [/^(?:ifrs-full_Revenue|dart_OperatingRevenue|ifrs-full_RevenueFromContractsWithCustomers)$/i], exclude: [/매출채권|매출원가|매출총이익|매출할인|매출에누리|매출환입|기타수익|금융수익|지분법수익|영업외수익|법인세수익/] },
  자산총계: { sj: ["BS"], names: ["자산총계", "총자산", "자산총액", "자산합계", "자산계"], ids: [/^ifrs-full_Assets$/i, /^(?:dart_)?TotalAssets$/i] },
  부채총계: { sj: ["BS"], names: ["부채총계", "총부채", "부채총액", "부채합계", "부채계"], ids: [/^ifrs-full_Liabilities$/i, /^(?:dart_)?TotalLiabilities$/i] },
  자본총계: { sj: ["BS"], names: ["자본총계", "총자본", "자본총액", "자본합계", "자본계", "자본총계(지배기업의소유주에게귀속되는자본포함)"], ids: [/^ifrs-full_Equity$/i, /^(?:dart_)?TotalEquity$/i], exclude: [/지배기업소유주에게귀속되는자본$/] },
  유동자산: { sj: ["BS"], names: ["유동자산", "유동자산합계"], ids: [/^ifrs-full_CurrentAssets$/i] },
  유동부채: { sj: ["BS"], names: ["유동부채", "유동부채합계"], ids: [/^ifrs-full_CurrentLiabilities$/i] },
  현금및현금성자산: { sj: ["BS"], names: ["현금및현금성자산", "현금과현금성자산", "현금및현금성자산합계"], ids: [/^ifrs-full_CashAndCashEquivalents$/i] },
  단기금융상품: { sj: ["BS"], names: ["단기금융상품", "단기투자자산", "단기예치금", "단기금융자산"], ids: [/ShortTermDepositsNotClassifiedAsCashEquivalents/i] },
  매출채권: { sj: ["BS"], names: ["매출채권", "매출채권및기타채권", "매출채권및기타유동채권", "유동매출채권"], ids: [/TradeAndOtherCurrentReceivables/i], exclude: [/대손충당금|손상차손누계|기대신용손실충당금/] },
  재고자산: { sj: ["BS"], names: ["재고자산", "유동재고자산", "재고자산합계"], ids: [/^ifrs-full_Inventories$/i] },
  매입채무: { sj: ["BS"], names: ["매입채무", "매입채무및기타채무", "매입채무및기타유동채무", "유동매입채무", "매입채무합계"], ids: [/TradeAndOtherCurrentPayables/i], exclude: [/미지급금|충당부채|리스부채/] },
  단기차입금: { sj: ["BS"], names: ["단기차입금", "단기차입금및회사채", "단기대출금", "단기금융부채"], ids: [/ShorttermBorrowings|CurrentFinancialInstitutionBorrowings/i], exclude: [/리스부채/] },
  유동성장기부채: { sj: ["BS"], names: ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분", "유동성장기부채및사채"], ids: [/CurrentPortionOfLongtermBorrowings|CurrentPortionOfLongtermFinancialLiabilities/i], exclude: [/리스부채/] },
  사채: { sj: ["BS"], names: ["사채", "회사채", "비유동사채"], ids: [/^ifrs-full_BondsIssued$/i], exclude: [/유동성|리스|할인발행차금/] },
  장기차입금: { sj: ["BS"], names: ["장기차입금", "장기대출금", "비유동차입금", "장기차입부채"], ids: [/LongtermBorrowings|LongTermBorrowings|LongtermLoansAndBorrowings|LongTermLoansAndBorrowings|NoncurrentBorrowings|NoncurrentLoansAndBorrowings/i], exclude: [/리스부채|유동성|사채할인발행차금|차입금할인발행차금/] },
  금융원가: { sj: ["CIS", "IS"], names: ["금융원가", "금융비용"], ids: [/^ifrs-full_FinanceCosts$/i], exclude: [/금융수익/] },
};


Object.assign(ACCOUNT_SPECS, {
  영업이익: {sj:["CIS","IS"], names:["영업이익","영업이익(손실)","영업손익","영업손실"], ids:[/^(?:dart_OperatingIncomeLoss|ifrs-full_ProfitLossFromOperatingActivities)$/i], exclude:[/영업외|중단영업|계속영업|부문|조정|이익률/]},
  순이익: {sj:["CIS","IS"], names:["당기순이익","당기순이익(손실)","당기순손익","반기순손익","분기순손익","반기순이익","분기순이익","연결당기순이익","연결당기순이익(손실)","당기순손실"], ids:[/^ifrs-full_ProfitLoss$/i], exclude:[/귀속|지배|비지배|계속영업|중단영업|주당|세전|법인세차감전|순이익률/]},
  이자비용: {sj:["CIS","IS"], names:["이자비용","이자비용(금융원가)"], ids:[/^ifrs-full_InterestExpense$/i]},
  영업현금흐름: {sj:["CF"],names:["영업활동으로인한현금흐름","영업활동현금흐름","영업활동순현금흐름"],ids:[/^ifrs-full_CashFlowsFromUsedInOperatingActivities$/i]},
  투자활동현금흐름: {sj:["CF"],names:["투자활동으로인한현금흐름","투자활동현금흐름","투자활동순현금흐름"],ids:[/^ifrs-full_CashFlowsFromUsedInInvestingActivities$/i]},
  재무활동현금흐름: {sj:["CF"],names:["재무활동으로인한현금흐름","재무활동현금흐름","재무활동순현금흐름"],ids:[/^ifrs-full_CashFlowsFromUsedInFinancingActivities$/i]},
  유형자산취득_CAPEX: {sj:["CF"],names:["유형자산의취득","유형자산취득"],ids:[/^ifrs-full_PurchaseOfPropertyPlantAndEquipment$/i]},
  감가상각비: {sj:["CF","CIS","IS"],names:["감가상각비","유무형자산상각비","유형자산감가상각비"],ids:[/^ifrs-full_AdjustmentsForDepreciationExpense$/i]},
});

export function selectAccount(rows: Row[], term: string, period?: AccountPeriod, basis: "CFS" | "OFS" = "CFS") {
  if (term === "매출액") {
    const row = findRevenueRow(rows.filter(item => !item.fs_div || item.fs_div === basis), ["CIS","IS"], period);
    const value = row ? (period ? periodAmount(row,period) : amountOf(row,0,true)) : null;
    return row && value !== null ? {row,value,rank:0} : null;
  }
  const spec = ACCOUNT_SPECS[term];
  const names = (spec?.names ?? [term]).map(normalizeAccountName);
  const sections = spec?.sj ?? ["BS","CIS","IS","CF"];
  const sectionRank = (s: string) => s === "CIS" ? 0 : s === "IS" ? 1 : 0;
  const candidates = rows.flatMap(row => {
    if (!sections.includes(row.sj_div ?? "") || (row.fs_div && row.fs_div !== basis)) return [];
    const name = normalizeAccountName(row.account_nm);
    if (spec?.exclude?.some(re => re.test(name))) return [];
    const id = spec?.ids?.some(re => re.test(row.account_id ?? ""));
    const exact = names.indexOf(name);
    const prefix = names.some(n => n.length >= 3 && name.startsWith(n) && !/채권|원가|총이익|충당금/.test(name.slice(n.length)));
    if (!id && exact < 0 && !prefix) return [];
    const value = period ? periodAmount(row, period) : amountOf(row,0,true);
    if (value === null) return [];
    return [{row, value, rank: sectionRank(row.sj_div ?? "") * 100 + (id ? 0 : exact >= 0 ? 10 + exact : 70)}];
  });
  return candidates.sort((a,b) => a.rank-b.rank)[0] ?? null;
}
