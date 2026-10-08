// DART 재무 데이터 처리 핵심 로직. 네트워크와 분리해 단위 테스트할 수 있도록 구성합니다.
import { inflateRawSync } from "node:zlib";

export const DISCLAIMER = "※ 본 순차입금은 현금및현금성자산과 단기금융상품을 차감하고 리스부채를 제외하는 정책(net_debt_v1)을 적용합니다. 채권성 부채는 재무상태표 장부가액 기준으로 반영합니다.";

export const ALIASES: Record<string, string> = {
  삼전: "삼성전자",
  현차: "현대자동차",
  하닉: "SK하이닉스",
  엘지: "LG",
  네이버: "NAVER",
};

export function normalizeQuestion(q: string): string {
  let s = q.replace(/\(주\)|㈜|주식회사/g, "");
  for (const [k, v] of Object.entries(ALIASES)) s = s.split(k).join(v);
  return s;
}

export type Corp = { code: string; stock: string };

export function parseCorps(xml: string): Map<string, Corp> {
  const out = new Map<string, Corp>();
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const t = (tag: string) => m[1].match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() ?? "";
    const name = t("corp_name");
    const stock = t("stock_code");
    const prev = out.get(name);
    if (!name || !t("corp_code")) continue;
    if (prev?.stock && !stock) continue;
    out.set(name, { code: t("corp_code"), stock });
  }
  return out;
}

export function findCorp(q: string, corps: Map<string, Corp>) {
  const s = normalizeQuestion(q);
  let best = "";
  for (const [n, c] of corps) {
    if (n.length < (c.stock ? 2 : 3)) continue;
    if (s.includes(n) && n.length > best.length) best = n;
  }
  return best ? { name: best, ...corps.get(best)! } : null;
}

export function searchCorps(query: string, corps: Map<string, Corp>, limit = 12) {
  const q = normalizeQuestion(query).trim().toLowerCase();
  if (!q) return [];
  return [...corps.entries()]
    .filter(([name, corp]) => {
      const hay = `${name} ${corp.stock}`.toLowerCase();
      return hay.includes(q);
    })
    .sort(([a, ac], [b, bc]) => {
      const rank = (name: string, corp: Corp) => (name.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) ? 1 : corp.stock === q ? 2 : 3);
      return rank(a, ac) - rank(b, bc) || a.localeCompare(b, "ko");
    })
    .slice(0, limit)
    .map(([name, corp]) => ({ name, code: corp.code, stock: corp.stock }));
}

export function unzipFirst(buf: Buffer): string {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("ZIP 형식이 아닙니다.");
  const cd = buf.readUInt32LE(e + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + size);
  return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
}

export const fsDivFor = (q: string): "CFS" | "OFS" => (/별도|개별/.test(q) ? "OFS" : "CFS");
export const fsLabel = (fs: "CFS" | "OFS") => (fs === "CFS" ? "연결 기준" : "별도 기준");
export const parseYear = (q: string): number | null => {
  const m = q.match(/20\d\d/);
  return m ? Number(m[0]) : null;
};

export type Row = {
  sj_div?: string;
  account_nm?: string;
  thstrm_amount?: string;
  thstrm_add_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
  rcept_no?: string;
  account_id?: string;
};

const N = (s?: string) => (s ?? "").replace(/[\s·ㆍ]/g, "");
const AMT = ["thstrm_amount", "frmtrm_amount", "bfefrmtrm_amount"] as const;

export function amountOf(r: Row, idx = 0, cum = false): number | null {
  const cumulativeEligible = r.sj_div === "IS" || r.sj_div === "CIS" || r.sj_div === "CF";
  const shouldUseCumulative = cum && idx === 0 && cumulativeEligible;
  if (shouldUseCumulative && !r.thstrm_add_amount) return null;
  const raw = (shouldUseCumulative ? r.thstrm_add_amount : r[AMT[idx]]) ?? "";
  const v = raw.replace(/,/g, "").trim();
  const n = Number(v);
  return v === "" || Number.isNaN(n) ? null : n / 1e8;
}

export const findRow = (rows: Row[], sj: string[], names: string[]) => {
  const target = names.map(N);
  return rows.find((r) => sj.includes(r.sj_div ?? "") && target.includes(N(r.account_nm)) && !N(r.account_nm).includes("리스"));
};

export const findRowLike = (rows: Row[], sj: string[], names: string[], accountIds: string[] = []) => {
  const target = names.map(N);
  const candidates = rows.filter((r) => {
    const account = N(r.account_nm);
    return sj.includes(r.sj_div ?? "") && target.some((n) => account === n || account.includes(n)) && !account.includes("리스");
  });
  const ids = new Set(accountIds);
  return candidates.sort((a, b) => {
    const ai = a.account_id ?? "", bi = b.account_id ?? "";
    const idScore = (x: string) => x && ids.has(x) ? 0 : x && x !== "-표준계정코드 미사용-" ? 1 : 2;
    const aa = N(a.account_nm), bb = N(b.account_nm);
    const nameScore = (x: string) => target.some((n) => x === n) ? 0 : target.some((n) => x.startsWith(n)) ? 1 : 2;
    return idScore(ai) - idScore(bi) || nameScore(aa) - nameScore(bb) || aa.length - bb.length;
  })[0];
};

type Groups = [string, string[]][];
const DEBT: Groups = [
  ["단기차입금", ["단기차입금"]],
  ["유동성장기부채", ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분"]],
  ["장기차입금", ["장기차입금"]],
  ["사채", ["사채", "회사채", "전환사채", "신주인수권부사채", "교환사채", "단기사채"]],
];
const LIQ: Groups = [["현금및현금성자산", ["현금및현금성자산"]], ["단기금융상품", ["단기금융상품", "단기금융자산"]]];

export type Item = { group: string; account: string; amount: number; sign: "+" | "−"; accountId?: string };

export type NetDebtInputStatus = "reported" | "absent_in_complete_statement" | "unavailable";
export type NetDebtItem = Item & { status: NetDebtInputStatus };

export const NET_DEBT_POLICY_ID = "net_debt_v1";
export const NET_DEBT_POLICY_LABEL = "현금및현금성자산·단기금융상품 차감 · 리스부채 제외 · 채권성 부채 장부가액 기준";

const DEBT_ADJUSTMENT_EXCLUSIONS = ["사채상환할증금", "사채할인발행차금", "채권할인발행차금"];
const DEBT_KEYWORDS = /차입|사채|회사채|전환사채|신주인수권부사채|교환사채|단기사채|금융부채/;
// Totals and generic finance liabilities require manual classification; never silently count them as zero.
const DEBT_TOTAL_EXCLUSIONS = /^(유동부채|비유동부채|부채총계|자본과부채총계)$/;
const DEBT_MAPPING_IDS = new Set([
  'ifrs-full:ShorttermBorrowings', 'ifrs-full:LongtermBorrowings',
  'ifrs-full:CurrentPortionOfLongtermBorrowings', 'ifrs-full:Borrowings',
  'dart:ShortTermBorrowings', 'dart:LongTermBorrowings',
]);

function isCompleteBalanceSheet(rows: Row[]) {
  const bs = rows.filter((r) => r.sj_div === "BS");
  const get = (names: string[]) => {
    const row = findRowLike(bs, ["BS"], names);
    return row ? amountOf(row) : null;
  };
  const assets = get(["자산총계"]);
  const liabilities = get(["부채총계"]);
  const equity = get(["자본총계"]);
  if (assets === null || liabilities === null || equity === null) return false;
  const currentAssets = get(["유동자산"]);
  const nonCurrentAssets = get(["비유동자산"]);
  const currentLiabilities = get(["유동부채"]);
  const nonCurrentLiabilities = get(["비유동부채"]);
  const tolerance = Math.max(1, Math.abs(assets) * 0.00001);
  // A balance sheet is considered complete only when the primary totals and
  // the current/non-current subtotals are all present and reconcile.
  if (currentAssets === null || nonCurrentAssets === null || currentLiabilities === null || nonCurrentLiabilities === null) return false;
  if (Math.abs((currentAssets + nonCurrentAssets) - assets) > tolerance) return false;
  if (Math.abs((currentLiabilities + nonCurrentLiabilities) - liabilities) > tolerance) return false;
  if (Math.abs((liabilities + equity) - assets) > tolerance) return false;
  return true;
}

export function netDebt(rows: Row[], idx = 0) {
  const complete = isCompleteBalanceSheet(rows);
  const items: NetDebtItem[] = [];
  const missing: string[] = [];
  const collect = (groups: Groups, sign: "+" | "−") => {
    let sum = 0;
    for (const [group, names] of groups) {
      const matches = rows.filter((r) => {
        if (r.sj_div !== "BS") return false;
        const account = N(r.account_nm);
        if (account.includes("리스") || DEBT_ADJUSTMENT_EXCLUSIONS.some((x) => account.includes(N(x)))) return false;
        return names.some((n) => account === N(n) || account.startsWith(N(n)));
      });
      const detailPresent = matches.length > 1 && matches.some((r) => {
        const a = N(r.account_nm);
        return names.some((n) => N(n) !== a && a.endsWith(N(n)));
      });
      const seen = new Set<string>();
      let groupSum = 0;
      let reportedAny = false;
      for (const r of matches) {
        const aName = N(r.account_nm);
        if (detailPresent && (aName === N("사채") || aName === N("회사채") || aName === N("유동성장기부채"))) continue;
        const account = (r.account_nm ?? "").trim();
        const dedupe = `${account}::${r.sj_div}`;
        if (seen.has(dedupe)) continue;
        const amount = amountOf(r, idx, false);
        if (amount === null) {
          missing.push(`공시된 계정의 금액을 읽을 수 없음: ${account}`);
          continue;
        }
        seen.add(dedupe);
        groupSum += amount;
        reportedAny = true;
        items.push({ group, account, amount, sign, status: "reported", accountId: r.account_id });
      }
      if (reportedAny) {
        sum += groupSum;
        continue;
      }
      if (complete) {
        // 완전한 BS에서 해당 계정군이 존재하지 않으면 0으로 간주하되
        // 화면에서는 '공시상 부재 → 0 처리'를 명시합니다.
        items.push({ group, account: "공시 계정 부재", amount: 0, sign, status: "absent_in_complete_statement" });
        continue;
      }
      missing.push(group);
      items.push({ group, account: "확인 불가", amount: 0, sign, status: "unavailable" });
    }
    return sum;
  };
  const totalDebt = collect(DEBT, "+");
  const liquid = collect(LIQ, "−");
  const bsRows = rows.filter((r) => r.sj_div === "BS");
  const debtAliases = DEBT.flatMap(([, names]) => names.map(N));
  const unmatchedDebtRows = bsRows.filter((r) => {
    const a = N(r.account_nm);
    const mappedByPolicy = debtAliases.some((n) => a === n || a.startsWith(n));
    const id = r.account_id ?? "";
    const suspiciousId = DEBT_MAPPING_IDS.has(id) || /(?:Borrowings|Debentures|BondsPayable)/i.test(id);
    return !DEBT_TOTAL_EXCLUSIONS.test(a) && (DEBT_KEYWORDS.test(a) || suspiciousId) && !mappedByPolicy && !DEBT_ADJUSTMENT_EXCLUSIONS.some((x) => a.includes(N(x)));
  });
  if (unmatchedDebtRows.length) missing.push(`분류되지 않은 차입·사채 계정: ${unmatchedDebtRows.map((r) => r.account_nm).join(", ")}`);
  if (!complete) missing.unshift("재무상태표 소계/총계 재조정 실패");
  if (missing.length > 0) {
    return { ok: false as const, reason: `순차입금 입력의 완전성 또는 차입금 분류를 검증할 수 없습니다: ${missing.join(", ")}`, items, missing, complete };
  }
  return {
    ok: true as const,
    value: totalDebt - liquid,
    totalDebt,
    liquid,
    items,
    missing,
    complete,
    formula: "순차입금 = (단기차입금 + 유동성장기부채 + 장기차입금 + 사채) − (현금및현금성자산 + 단기금융상품)",
    policyId: NET_DEBT_POLICY_ID,
    policyLabel: NET_DEBT_POLICY_LABEL,
    disclaimer: DISCLAIMER,
  };
}

export const dartUrl = (rcept: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}`;
export const citation = (label: string, heading: string, rcept: string) => `📄 출처: [${label}] > [${heading}] (${dartUrl(rcept)})`;
export function chunkByHeading(text: string): { heading: string; body: string }[] {
  const chunks: { heading: string; body: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\d+\.\s.*/.test(line.trim())) chunks.push({ heading: line.trim(), body: "" });
    else if (chunks.length) chunks[chunks.length - 1].body += line + "\n";
  }
  return chunks;
}

export const SYSTEM_PROMPT = `너는 DART 공시 재무 팩트체커다.\n1) 사용자가 쓴 기업명은 약어·(주) 표기를 제거해 DART 공식 명칭으로 정규화한 뒤 도구에 전달하라.\n2) 순차입금 등 계산이 필요한 지표는 반드시 내장 함수 결과를 그대로 사용하라.\n3) 도구가 반환하지 않은 수치는 만들지 말고 "해당 자료를 찾을 수 없습니다"라고 답하라.\n4) 모든 수치에 연결/별도 기준, 계산식(계산 지표인 경우), 출처 링크를 함께 표시하라.`;

export const DEFAULT_COMPANY = "대한전선";
const VOCAB = /순차입금|순부채|차입금|영업활동현금흐름|영업현금흐름|영업현금|현금흐름|영업이익|영업익|당기순이익|당기순익|순이익|순익|매출액|매출|capex|설비투자|자본적지출|유형자산|취득|부채비율|영업이익률|영업마진|연도|개년|연간|상반기|하반기|반기|분기|사업보고서|연결|별도|개별|기준|재무제표|올해|작년|지난해|전년도|최근|지난|직전|알려줘|알려주세요|알려|얼마야|얼마|보여줘|조회|궁금|추이|증가|감소|비교|차이|전년|20\d\d|[0-9]+|년|월|도/gi;
const PARTICLE = /^(은|는|이|가|을|를|의|도|만|좀|해줘|줘|야|요|해|주세요|인가요|뭐야|어때|입니까)+$/;
export const looksLikeCompany = (q: string) =>
  q
    .replace(VOCAB, " ")
    .split(/[^가-힣A-Za-z&]+/)
    .some((t) => t.length >= 2 && !PARTICLE.test(t));

const CODE = { annual: "11011", half: "11012", q1: "11013", q3: "11014" } as const;
export type Kind = keyof typeof CODE;
export type Period = { year: number; kind: Kind; code: string; mode: "cum" | "qtr" };
export const P = (year: number, kind: Kind, mode: "cum" | "qtr" = "cum"): Period => ({ year, kind, code: CODE[kind], mode });

export function periodCandidates(q: string, now = new Date()): Period[] {
  const y = parseYear(q);
  const cur = now.getFullYear();
  const year = y ?? cur;
  if (y !== null && y < 2015) return [];
  if (/하반기/.test(q)) return [];
  if (/2\s*분기/.test(q)) return [P(year, "half", "qtr")];
  if (/상반기|반기/.test(q)) return [P(year, "half")];
  if (/1\s*분기/.test(q)) return [P(year, "q1", /누적/.test(q) ? "cum" : "qtr")];
  if (/3\s*분기\s*누적/.test(q)) return [P(year, "q3", "cum")];
  if (/3\s*분기/.test(q)) return [P(year, "q3", "qtr")];
  if (/사업보고서|연간|작년|지난해|전년도/.test(q)) return [P(y ?? cur - 1, "annual")];
  if (y && y < cur) return [P(y, "annual")];
  const latest = [P(year, "q3"), P(year, "half"), P(year, "q1")];
  return y ? latest : [...latest, P(year - 1, "annual")];
}

export const periodFromFilters = (year: number | undefined, period: Kind | "latest", now = new Date()): Period[] => {
  if (period === "latest") return periodCandidates("", now);
  return [P(year ?? now.getFullYear(), period)];
};

const KO = { annual: "사업보고서", half: "반기보고서", q1: "1분기보고서", q3: "3분기보고서" } as const;
export const periodLabel = (p: Period) => `${p.year} ${KO[p.kind]}`;
export const baseDate = (p: Period) => `${p.year}.${{ annual: "12.31", half: "06.30", q1: "03.31", q3: "09.30" }[p.kind]}`;
export const modeLabel = (p: Period) =>
  p.kind === "annual" ? "연간" : p.mode === "qtr" ? "해당 분기(3개월)" : p.kind === "half" ? "상반기 누적(1~6월)" : p.kind === "q1" ? "1분기(1~3월)" : "3분기 누적(1~9월)";

export type FinancialMetric = "revenue" | "operatingProfit" | "netIncome" | "operatingMargin" | "operatingCashFlow" | "investmentCashFlow" | "financingCashFlow" | "capex" | "freeCashFlow" | "netWorkingCapital" | "assetTurnover" | "netDebt" | "debtRatio" | "currentRatio" | "interestCoverage" | "roe" | "roa" | "eps" | "ebitda" | "per" | "pbr";

export type QueryAnalysis = "single" | "comparison" | "trend" | "cause";
export type QueryOutput = "value" | "table" | "trend" | "comparison";
export type ParsedDartQuery = {
  years: number[];
  yearStart: number | null;
  yearEnd: number | null;
  recentYears: number | null;
  kind: Kind | "latest" | null;
  mode: "cum" | "qtr" | null;
  basis: "CFS" | "OFS";
  metrics: FinancialMetric[];
  directAccount: string | null;
  analysis: QueryAnalysis;
  output: QueryOutput;
  hasCauseIntent: boolean;
  explicitPeriod: boolean;
};

const UNIQUE_METRICS = (items: FinancialMetric[]) => [...new Set(items)];

export function parseDartQuery(question: string, now = new Date()): ParsedDartQuery {
  const q = normalizeQuestion(question).replace(/[？?]/g, "").trim();
  const years = [...new Set((q.match(/20\d{2}/g) ?? []).map(Number))];
  const range = q.match(/(20\d{2})\s*(?:~|〜|-|–|—|부터|에서)\s*(20\d{2})/);
  const yearStart = range ? Number(range[1]) : null;
  const yearEnd = range ? Number(range[2]) : null;
  const recent = q.match(/(?:최근|지난|직전|과거)\s*(\d+)\s*(?:개년|년|연도)/);
  const recentYears = recent ? Math.max(2, Math.min(10, Number(recent[1]))) : null;

  let kind: ParsedDartQuery["kind"] = null;
  let mode: "cum" | "qtr" | null = null;
  if (/하반기/.test(q)) kind = "annual";
  else if (/2\s*분기/.test(q)) { kind = "half"; mode = "qtr"; }
  else if (/상반기|반기/.test(q)) kind = "half";
  else if (/1\s*분기/.test(q)) { kind = "q1"; mode = /누적/.test(q) ? "cum" : "qtr"; }
  else if (/3\s*분기\s*누적/.test(q)) { kind = "q3"; mode = "cum"; }
  else if (/3\s*분기/.test(q)) { kind = "q3"; mode = "qtr"; }
  else if (/사업보고서|연간|연도별|연간실적/.test(q)) kind = "annual";
  else if (/최신|최근 공시|가장 최근/.test(q)) kind = "latest";

  const metricHits: Array<[RegExp, FinancialMetric]> = [
    [/영업이익률|영업마진|영업마진율|OPM/i, "operatingMargin"],
    [/영업이익|영업익/i, "operatingProfit"],
    [/당기순이익|순이익|순익|당기순익|반기순손익|분기순손익/i, "netIncome"],
    [/투자활동현금흐름|투자현금흐름|투자활동.*현금/i, "investmentCashFlow"],
    [/재무활동현금흐름|재무현금흐름|재무활동.*현금/i, "financingCashFlow"],
    [/영업활동현금흐름|영업현금흐름|영업현금|영업활동.*현금/i, "operatingCashFlow"],
    [/FCF|free.?cash.?flow|자유현금흐름/i, "freeCashFlow"],
    [/운전자본|순운전자본|NWC/i, "netWorkingCapital"],
    [/자산회전율|asset.?turnover/i, "assetTurnover"],
    [/capex|설비투자|자본적지출|유형자산.?취득/i, "capex"],
    [/순차입금|순부채/i, "netDebt"],
    [/부채비율/i, "debtRatio"],
    [/유동비율/i, "currentRatio"],
    [/이자보상배율/i, "interestCoverage"],
    [/ROE|자기자본이익률/i, "roe"],
    [/ROA|총자산이익률/i, "roa"],
    [/EPS|주당순이익|기본주당순손익|희석주당순손익/i, "eps"],
    [/EBITDA|에비타/i, "ebitda"],
    [/PER/i, "per"],
    [/PBR/i, "pbr"],
    [/매출액|매출|매출실적/i, "revenue"],
  ];
  let metrics = UNIQUE_METRICS(metricHits.filter(([re]) => re.test(q)).map(([, metric]) => metric));
  if (metrics.includes("operatingMargin")) metrics = metrics.filter((m) => m !== "operatingProfit");
  const ACCOUNT_ALIASES: Array<[string, string[]]> = [
    ["유동자산", ["유동자산"]], ["현금및현금성자산", ["현금및현금성자산"]], ["단기금융상품", ["단기금융상품", "단기금융자산"]],
    ["유동당기손익-공정가치측정금융자산", ["유동당기손익-공정가치측정금융자산"]], ["유동매출채권", ["유동매출채권"]],
    ["단기대여금", ["단기대여금"]], ["기타유동금융자산", ["기타유동금융자산"]], ["유동재고자산", ["유동재고자산", "재고자산"]],
    ["당기법인세자산", ["당기법인세자산"]], ["기타유동자산", ["기타유동자산"]], ["비유동자산", ["비유동자산"]],
    ["비유동당기손익-공정가치측정금융자산", ["비유동당기손익-공정가치측정금융자산"]], ["비유동상각후원가측정금융자산", ["비유동상각후원가측정금융자산"]],
    ["기타포괄손익-공정가치측정금융자산", ["기타포괄손익-공정가치측정금융자산"]], ["지분법적용투자지분", ["지분법적용투자지분"]],
    ["비유동매출채권", ["비유동매출채권"]], ["장기대여금", ["장기대여금"]], ["기타비유동금융자산", ["기타비유동금융자산"]],
    ["사용권자산을포함하는유형자산", ["사용권자산을포함하는유형자산", "유형자산"]], ["무형자산", ["무형자산"]], ["투자부동산", ["투자부동산"]],
    ["비유동순확정급여자산", ["비유동순확정급여자산"]], ["이연법인세자산", ["이연법인세자산"]], ["기타비유동자산", ["기타비유동자산"]],
    ["자산총계", ["자산총계"]], ["유동부채", ["유동부채"]], ["유동매입채무", ["유동매입채무", "매입채무"]],
    ["유동성금융기관차입금", ["유동성금융기관차입금"]], ["비유동차입금의유동성대체부분", ["비유동차입금의유동성대체부분"]],
    ["유동성전환사채", ["유동성전환사채"]], ["기타유동금융부채", ["기타유동금융부채"]], ["당기법인세부채", ["당기법인세부채"]],
    ["유동충당부채", ["유동충당부채"]], ["기타유동부채", ["기타유동부채"]], ["비유동부채", ["비유동부채"]],
    ["장기차입금", ["장기차입금"]], ["기타비유동금융부채", ["기타비유동금융부채"]], ["순확정급여부채", ["순확정급여부채"]],
    ["기타비유동부채", ["기타비유동부채"]], ["비유동충당부채", ["비유동충당부채"]], ["이연법인세부채", ["이연법인세부채"]], ["부채총계", ["부채총계"]],
    ["지배기업의소유주에게귀속되는자본", ["지배기업의소유주에게귀속되는자본"]], ["자본금", ["자본금"]], ["기타불입자본", ["기타불입자본"]],
    ["기타포괄손익누계액", ["기타포괄손익누계액"]], ["이익잉여금", ["이익잉여금", "이익잉여금(결손금)"]], ["비지배지분", ["비지배지분"]], ["자본총계", ["자본총계"]],
    ["자본과부채총계", ["자본과부채총계"]], ["유동성장기부채", ["유동성장기부채", "유동성장기차입금", "유동성사채", "유동성장기사채", "비유동차입금의유동성대체부분"]],
    ["수익", ["수익", "매출액", "수익(매출액)"]], ["매출원가", ["매출원가"]], ["매출총이익", ["매출총이익"]], ["판매비와관리비", ["판매비와관리비"]],
    ["영업외손익", ["영업외손익"]], ["기타이익", ["기타이익"]], ["기타손실", ["기타손실"]], ["금융수익", ["금융수익"]], ["금융원가", ["금융원가"]],
    ["법인세차감전순손익", ["법인세차감전순손익"]], ["법인세비용", ["법인세비용"]], ["반기순손익", ["반기순손익", "당기순이익", "분기순손익"]],
    ["기타포괄손익", ["기타포괄손익"]], ["총포괄손익", ["총포괄손익"]], ["지배기업소유주귀속반기순손익", ["지배기업의소유주에게귀속되는반기순손익"]],
    ["기본주당순손익", ["기본주당순손익"]], ["희석주당순손익", ["희석주당순손익"]],
    ["영업활동현금흐름", ["영업활동으로인한현금흐름", "영업활동현금흐름", "영업활동순현금흐름"]],
    ["투자활동현금흐름", ["투자활동으로인한현금흐름", "투자활동현금흐름", "투자활동순현금흐름"]],
    ["재무활동현금흐름", ["재무활동으로인한현금흐름", "재무활동현금흐름", "재무활동순현금흐름"]],
  ];
  const nq = N(q);
  const directAccount = [...ACCOUNT_ALIASES].sort((a,b) => Math.max(...b[1].map((x) => N(x).length)) - Math.max(...a[1].map((x) => N(x).length))).find(([, aliases]) => aliases.some((a) => nq.includes(N(a))))?.[0] ?? null;

  const hasCauseIntent = /증가원인|감소원인|증가\s*이유|감소\s*이유|왜\s*(?:증가|감소|늘|줄)|원인|이유|왜/.test(q);
  const hasComparison = /비교|차이|대비|전년|전년대비|vs|증감|늘었|줄었|증가|감소|높아|낮아|차이가/.test(q) || years.length >= 2 || !!range;
  const hasTrend = /추이|트렌드|흐름|변화|최근\s*\d+\s*개년|연도별|기간별/.test(q) || !!recentYears;
  const analysis: QueryAnalysis = hasCauseIntent ? "cause" : hasTrend && !hasComparison ? "trend" : hasComparison ? "comparison" : "single";

  let output: QueryOutput = "value";
  if (hasTrend || recentYears || (range && (Number(range[2]) - Number(range[1]) >= 2))) output = "trend";
  if (metrics.length >= 2 || years.length >= 2 || !!range || /비교|대비|vs|차이/.test(q)) output = "comparison";
  if (/표|테이블|정리해|목록으로/.test(q)) output = "table";

  const explicitPeriod = !!kind && kind !== "latest";
  const resolvedYears = range && yearEnd! >= yearStart! && yearEnd! - yearStart! <= 10
    ? Array.from({ length: yearEnd! - yearStart! + 1 }, (_, i) => yearStart! + i)
    : years;

  return {
    years: resolvedYears,
    yearStart,
    yearEnd,
    recentYears,
    kind,
    mode,
    basis: fsDivFor(q),
    metrics,
    directAccount,
    analysis,
    output,
    hasCauseIntent,
    explicitPeriod,
  };
}

export type FormulaSpec = {
  label: string;
  formula: string;
  inputs: string[];
  method: "source" | "derived";
  queryable: boolean;
  note?: string;
};

/**
 * Single source of truth for metrics exposed by the demo and future ChatGPT Agent.
 * A metric may be queryable only when the implementation is deterministic and all
 * mandatory inputs are explicitly validated.
 */
export const FORMULAS: Record<FinancialMetric, FormulaSpec> = {
  revenue: { label: "매출액", formula: "DART 공시값", inputs: ["revenue"], method: "source", queryable: true },
  operatingProfit: { label: "영업이익", formula: "DART 공시값", inputs: ["operatingProfit"], method: "source", queryable: true },
  netIncome: { label: "순이익", formula: "DART 공시값", inputs: ["netIncome"], method: "source", queryable: true },
  operatingMargin: { label: "영업이익률", formula: "영업이익 ÷ 매출액 × 100", inputs: ["operatingProfit", "revenue"], method: "derived", queryable: true },
  operatingCashFlow: { label: "영업활동현금흐름", formula: "DART 현금흐름표 공시값", inputs: ["operatingCashFlow"], method: "source", queryable: true },
  investmentCashFlow: { label: "투자활동현금흐름", formula: "DART 현금흐름표 공시값", inputs: ["investmentCashFlow"], method: "source", queryable: true },
  financingCashFlow: { label: "재무활동현금흐름", formula: "DART 현금흐름표 공시값", inputs: ["financingCashFlow"], method: "source", queryable: true },
  capex: { label: "CAPEX", formula: "|유형자산 취득| + |무형자산 취득| + |투자부동산 취득|", inputs: ["capex"], method: "derived", queryable: true, note: "현금흐름표의 해당 자산 취득 현금유출 절대값 합산. 리스부채 상환 제외" },
  freeCashFlow: { label: "FCF", formula: "영업활동현금흐름 − CAPEX", inputs: ["operatingCashFlow", "capex"], method: "derived", queryable: true, note: "CAPEX 정책 버전 1을 사용" },
  netWorkingCapital: { label: "순운전자본", formula: "유동자산 − 유동부채", inputs: ["currentAssets", "currentLiabilities"], method: "derived", queryable: true },
  assetTurnover: { label: "자산회전율", formula: "매출액 ÷ 평균총자산", inputs: ["revenue", "averageAssets"], method: "derived", queryable: false, note: "평균총자산의 기간 기준을 보강한 뒤 활성화" },
  netDebt: { label: "순차입금", formula: "(단기차입금 + 유동성장기부채 + 장기차입금 + 사채) − (현금및현금성자산 + 단기금융상품)", inputs: ["shortTermDebt", "currentPortionLongTermDebt", "longTermDebt", "bonds", "cash", "shortTermFinancialAssets"], method: "derived", queryable: true, note: "리스부채 제외. 완전한 BS에서 계정 부재는 0 처리하되 표시하며, BS 완전성 자체가 확인되지 않으면 거부" },
  debtRatio: { label: "부채비율", formula: "부채총계 ÷ 자본총계 × 100", inputs: ["totalLiabilities", "totalEquity"], method: "derived", queryable: true },
  currentRatio: { label: "유동비율", formula: "유동자산 ÷ 유동부채 × 100", inputs: ["currentAssets", "currentLiabilities"], method: "derived", queryable: true },
  interestCoverage: { label: "이자보상배율", formula: "영업이익 ÷ 이자비용", inputs: ["operatingProfit", "interestExpense"], method: "derived", queryable: true, note: "이자비용이 0이면 계산하지 않음" },
  roe: { label: "ROE", formula: "지배기업 소유주 귀속 순이익 ÷ 평균 지배기업 소유주지분 × 100", inputs: ["ownerNetIncome", "averageOwnerEquity"], method: "derived", queryable: true, note: "연환산하지 않음. 반기/분기 누적값은 누적 ROE로 표시" },
  roa: { label: "ROA", formula: "연결 당기순이익 ÷ 평균총자산 × 100", inputs: ["consolidatedNetIncome", "averageAssets"], method: "derived", queryable: true, note: "연환산하지 않음. 반기/분기 누적값은 누적 ROA로 표시" },
  eps: { label: "EPS", formula: "DART 주당순손익 공시값", inputs: ["eps"], method: "source", queryable: true },
  ebitda: { label: "EBITDA", formula: "영업이익 + 감가상각비 + 무형자산상각비", inputs: ["operatingProfit", "depreciation", "amortization"], method: "derived", queryable: true, note: "감가상각비와 무형자산상각비가 모두 확인돼야 계산" },
  per: { label: "PER", formula: "주가 ÷ EPS", inputs: ["sharePrice", "eps"], method: "derived", queryable: false, note: "DART 재무제표만으로 현재 주가를 확정하지 않으므로 비활성" },
  pbr: { label: "PBR", formula: "주가 ÷ BPS", inputs: ["sharePrice", "bps"], method: "derived", queryable: false, note: "DART 재무제표만으로 현재 주가를 확정하지 않으므로 비활성" },
};

export const QUERYABLE_METRICS = (Object.keys(FORMULAS) as FinancialMetric[]).filter((m) => FORMULAS[m].queryable) as FinancialMetric[];

export const METRIC_LABELS: Record<FinancialMetric, string> = {
  revenue: "매출액",
  operatingProfit: "영업이익",
  netIncome: "순이익",
  operatingMargin: "영업이익률",
  operatingCashFlow: "영업활동현금흐름",
  investmentCashFlow: "투자활동현금흐름",
  financingCashFlow: "재무활동현금흐름",
  capex: "CAPEX",
  freeCashFlow: "FCF",
  netWorkingCapital: "순운전자본",
  assetTurnover: "자산회전율",
  netDebt: "순차입금",
  debtRatio: "부채비율",
  currentRatio: "유동비율",
  interestCoverage: "이자보상배율",
  roe: "ROE",
  roa: "ROA",
  eps: "EPS",
  ebitda: "EBITDA",
  per: "PER",
  pbr: "PBR",
};

export const metricConfig: Record<FinancialMetric, { sj: string[]; names: string[]; accountIds?: string[] }> = {
  revenue: { sj: ["IS", "CIS"], names: ["매출액", "수익(매출액)", "영업수익", "매출"], accountIds: ["ifrs-full_Revenue", "ifrs_Revenue"] },
  operatingProfit: { sj: ["IS", "CIS"], names: ["영업이익", "영업이익(손실)"], accountIds: ["ifrs-full_ProfitLossFromOperatingActivities", "ifrs_ProfitLossFromOperatingActivities"] },
  netIncome: { sj: ["CIS", "IS"], names: ["반기순손익", "분기순손익", "당기순이익", "당기순이익(손실)", "연결당기순이익", "지배기업의소유주에게귀속되는당기순이익", "지배기업소유주지분당기순이익"], accountIds: ["ifrs-full_ProfitLoss", "ifrs_ProfitLoss"] },
  operatingCashFlow: { sj: ["CF"], names: ["영업활동으로인한현금흐름", "영업활동현금흐름", "영업활동순현금흐름"], accountIds: ["ifrs-full_CashFlowsFromUsedInOperatingActivities", "ifrs_CashFlowsFromUsedInOperatingActivities"] },
  investmentCashFlow: { sj: ["CF"], names: ["투자활동으로인한현금흐름", "투자활동현금흐름", "투자활동순현금흐름"] },
  financingCashFlow: { sj: ["CF"], names: ["재무활동으로인한현금흐름", "재무활동현금흐름", "재무활동순현금흐름"] },
  operatingMargin: { sj: ["IS", "CIS"], names: [] },
  capex: { sj: ["CF"], names: ["유형자산의취득", "유형자산취득"] },
  freeCashFlow: { sj: ["CF", "IS", "CIS"], names: [] },
  netWorkingCapital: { sj: ["BS"], names: [] },
  assetTurnover: { sj: ["BS", "IS", "CIS"], names: [] },
  netDebt: { sj: ["BS"], names: [] },
  debtRatio: { sj: ["BS"], names: ["부채비율"] },
  currentRatio: { sj: ["BS"], names: ["유동비율"] },
  interestCoverage: { sj: ["IS", "CIS"], names: [] },
  roe: { sj: ["BS", "IS", "CIS"], names: [] },
  roa: { sj: ["BS", "IS", "CIS"], names: [] },
  eps: { sj: ["IS", "CIS"], names: ["기본주당순손익", "기본주당순이익", "희석주당순손익"], accountIds: ["ifrs-full_BasicEarningsLossPerShare", "ifrs-full_DilutedEarningsLossPerShare"] },
  ebitda: { sj: ["IS", "CIS"], names: [] },
  per: { sj: [], names: [] },
  pbr: { sj: [], names: [] },
};
