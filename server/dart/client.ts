import { createHash } from "node:crypto";
import { recoverStatementRows } from "./statementRecovery";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import { extractInitialViewerArgs, parseViewerDeepLinkHtml } from "./viewerLink";
import { crossValidateMetric, crossValidateMetrics, clearCrossValidationCache, fetchNaverDebtFallback, type MetricCrossValidation } from "./crossValidation";
import { fetchFnGuideFallback, fetchFnGuideLeaseLiabilities } from "./fnGuideFallback";
import { parseBorrowingTotalFromDisclosure, parseDepreciationFromDisclosure, parseLeaseLiabilitiesFromDisclosure, parseRevenueFromDisclosure } from "./disclosureNotes";
import {
  DEFAULT_COMPANY,
  METRIC_LABELS,
  amountOf,
  baseDate,
  citation,
  findCorp,
  findRowLike,
  findRevenueRow,
  fsDivFor,
  fsLabel,
  looksLikeCompany,
  metricConfig,
  modeLabel,
  netDebt,
  parseCorps,
  periodCandidates,
  parseDartQuery,
  P,
  periodFromFilters,
  periodLabel,
  searchCorps,
  unzipFirst,
  unzipAll,
  type Corp,
  type FinancialMetric,
  type Kind,
  type Period,
  type Row,
} from "./engine";

const BASE = "https://opendart.fss.or.kr/api";
const won = (v: number) => !Number.isFinite(v) ? "자료 없음" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
const corpInFlight = new Map<string, Promise<Map<string, Corp>>>();
let corpCache: { at: number; map: Map<string, Corp> } | null = null;
const stmtCache = new Map<string, { at: number; rows: Row[] | null }>();
const statementInFlight = new Map<string, Promise<Row[] | null>>();
const filingCache = new Map<string, { at: number; filing: { rceptNo: string; reportName: string; receiptDate: string } | null }>();
const documentCache = new Map<string, { at: number; text: string }>();
const documentEntriesCache = new Map<string, { at: number; entries: Array<{ name: string; text: string }> }>();
const filingInFlight = new Map<string, Promise<{ rceptNo: string; reportName: string; receiptDate: string } | null>>();
const historyInFlight = new Map<string, Promise<ReturnType<typeof historyResponseShape>>>();
const historyCache = new Map<string, { at: number; value: ReturnType<typeof historyResponseShape> }>();
const deepLinkCache = new Map<string, { at: number; value: { url: string; deepLinked: boolean; sectionTitle: string; message: string } }>();

function historyResponseShape(points: Array<{ period: string; rceptNo?: string; basisCode: "CFS" | "OFS"; revenue: number; operatingProfit: number; netIncome?: number; separateOperatingProfit?: number; subsidiaryAndAdjProfit?: number; isFourthQuarterDerived?: boolean }>, failures: string[]) {
  return { points, failures };
}

type RecentResult={rows:Array<{company:string;reportName:string;receiptDate:string;rceptNo:string;url:string}>;warning:string|null};
const recentCache=new Map<string,{at:number;value:RecentResult}>();
const recentInFlight=new Map<string,Promise<RecentResult>>();
const dailyRequests=new Map<string,{day:string;count:number}>();
async function dartFetch(input: string | URL, init: RequestInit = {}, timeoutMs = 12_000) {
  const url=new URL(input);
  const credential=url.searchParams.get("crtfc_key");
  if(credential && url.hostname==="opendart.fss.or.kr") {
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul"}).format(new Date());
    const id=createHash("sha256").update(credential).digest("hex");
    for(const [k,v] of dailyRequests)if(v.day!==day)dailyRequests.delete(k);
    if(!dailyRequests.has(id) && dailyRequests.size>=2048)throw new Error("DART 요청이 많습니다. 잠시 후 재시도해 주세요.");
    const usage=dailyRequests.get(id)||{day,count:0};
    const configured=Number(process.env.DART_DAILY_REQUEST_BUDGET||18000);
    const budget=Number.isFinite(configured)&&configured>0?configured:18000;
    if(usage.count>=budget)throw new Error("인증키의 서버 내 일일 조회 예산에 도달했습니다. 공시 알림을 잠시 중단하고 다음 날 재시도하세요.");
    usage.count++;dailyRequests.set(id,usage);
  }
  // Buffer the body within the deadline as well as the response headers.
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  const response = await fetch(input, { ...init, signal });
  const bytes = await response.arrayBuffer();
  return new Response(bytes, {status:response.status,statusText:response.statusText,headers:response.headers});
}

/** DART 본문 응답의 charset을 존중해 목차 제목이 깨져 링크 추출에 실패하지 않도록 합니다. */
async function readDartHtml(response: Response): Promise<string> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const declared = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]?.toLowerCase() ?? "";
  const decode = (label: string) => {
    try { return new TextDecoder(label).decode(bytes); } catch { return ""; }
  };
  const declaredLabel = /euc-kr|ks_c_5601|949/.test(declared) ? "euc-kr" : /utf-?8/.test(declared) ? "utf-8" : declared;
  const candidates = [...new Set([declaredLabel, "utf-8", "euc-kr"].filter(Boolean))]
    .map((label) => ({ label, text: decode(label) }))
    .filter((item) => item.text.length > 0);
  const score = (text: string) => {
    const keyPhrases = (text.match(/연결재무제표|별도재무제표|재무상태표|손익계산서|현금흐름표|viewDoc|TreeNode/g) ?? []).length;
    const replacements = (text.match(/�/g) ?? []).length;
    const controls = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
    return keyPhrases * 100 + Math.min(500, (text.match(/[가-힣]/g) ?? []).length) - replacements * 25 - controls * 5;
  };
  // 응답의 charset 선언이 틀린 DART 페이지도 있어, 한글 재무제표 제목과 뷰어 호출을 가장 잘 복원하는 디코딩을 사용합니다.
  return candidates.sort((a, b) => score(b.text) - score(a.text))[0]?.text ?? "";
}

type DartFiling = { corp_code: string; corp_name: string; report_nm: string; rcept_no: string; rcept_dt: string };

function key(requestKey?: string) {
  const candidate = requestKey?.trim();
  // 요청에 키가 전달되었으면 유효하지 않은/데모용 문자열로 서버 키에 우회하지 않습니다.
  if (candidate) {
    if (!/^[A-Za-z0-9]{40}$/.test(candidate) || /^(DEMO|VERIFIED)/i.test(candidate)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "실제 OpenDART 인증키 40자리가 필요합니다. 데모 키로 우회 조회하지 않습니다." });
    }
    return candidate;
  }
  if (!ENV.opendartApiKey) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OpenDART 인증키가 없습니다. 화면에서 발급받은 인증키를 저장하거나 서버 .env에 OPENDART_API_KEY를 설정하세요." });
  }
  return ENV.opendartApiKey;
}

async function corps(force = false, requestKey?: string) {
  if (!force && corpCache && Date.now() - corpCache.at < 864e5) return corpCache.map;
  const fingerprint=createHash("sha256").update(key(requestKey)).digest("hex");
  const pending=corpInFlight.get(fingerprint);if(pending)return pending;
  const load=async()=>{
    const res=await dartFetch(`${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(key(requestKey))}`,{},15_000);
    if(!res.ok)throw new TRPCError({code:"BAD_GATEWAY",message:`DART 기업코드 조회 실패: HTTP ${res.status}`});
    const map=parseCorps(unzipFirst(Buffer.from(await res.arrayBuffer())));
    corpCache={at:Date.now(),map};return map;
  };
  const request=load();corpInFlight.set(fingerprint,request);
  try{return await request;}finally{if(corpInFlight.get(fingerprint)===request)corpInFlight.delete(fingerprint);}
}

function expectedReportPattern(year: number, reprt: string): RegExp {
  const month = reprt === "11011" ? "12" : reprt === "11012" ? "06" : reprt === "11013" ? "03" : "09";
  const type = reprt === "11011" ? "사업보고서" : reprt === "11012" ? "반기보고서" : "분기보고서";
  return new RegExp(`${type}.*${year}[.\-/]?${month}`);
}

const latestPeriodsCache = new Map<string,{at:number;periods:Period[]}>();
async function filingPages(code:string, fromDate:string, endDate:string, requestKey?:string, annualOnly=false) {
  const rows:DartFiling[]=[];
  const startedAt=Date.now();
  for(let page=1;page<=100;page++) {
    if(Date.now()-startedAt>30_000)throw new Error("공시 목록 조회가 지연되고 있습니다. 확인 시점을 갱신하지 않고 다시 확인합니다.");
    const params=new URLSearchParams({crtfc_key:key(requestKey),corp_code:code,bgn_de:fromDate,end_de:endDate,page_no:String(page),page_count:"100",sort:"date",sort_mth:"desc"});
    if(annualOnly){params.set("pblntf_ty","A");params.set("last_reprt_at","Y");}
    const response=await dartFetch(`${BASE}/list.json?${params}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}},8_000);
    if(!response.ok)throw new Error(`DART 공시목록 HTTP ${response.status}`);
    const json=await response.json() as {status:string;message?:string;list?:DartFiling[];total_page?:number};
    if(json.status==="013")break;
    if(json.status!=="000")throw new Error(`DART 공시목록 ${json.status}: ${json.message ?? "조회 실패"}`);
    rows.push(...(json.list ?? []));
    if(page>=Number(json.total_page || 1))break;
    if(page===100)throw new Error("공시목록 페이지가 100개를 넘어 전체 조회를 완료하지 못했습니다.");
  }
  const seen=new Set<string>();
  for(const filing of rows){
    const match=filing.report_nm?.match(/(20\d{2})[.\-/](03|06|09|12)/);
    if(!match || !/사업보고서|반기보고서|분기보고서/.test(filing.report_nm))continue;
    const report=match[2]==="12"?"11011":match[2]==="06"?"11012":match[2]==="03"?"11013":"11014";
    const periodKey=`${code}-${match[1]}-${report}`;
    if(seen.has(periodKey))continue;seen.add(periodKey);
    const old=filingCache.get(periodKey)?.filing;
    if(old && old.rceptNo!==filing.rcept_no){
      for(const k of stmtCache.keys())if(k.startsWith(periodKey+"-"))stmtCache.delete(k);
      for(const k of historyCache.keys())if(k.startsWith(code+":"))historyCache.delete(k);
    }
    filingCache.set(periodKey,{at:Date.now(),filing:{rceptNo:filing.rcept_no,reportName:filing.report_nm,receiptDate:filing.rcept_dt}});
  }
  return rows;
}

async function latestPublishedPeriods(code:string,requestKey?:string,force=false) {
  const cached=latestPeriodsCache.get(code);
  if(!force && cached && Date.now()-cached.at<15_000)return cached.periods;
  const year=new Date().getFullYear();
  const filings=await filingPages(code,`${year-2}0101`,`${year}1231`,requestKey,true);
  const periods=new Map<string,Period>();
  for(const filing of filings){
    const match=filing.report_nm.match(/(20\d{2})[.\-/](03|06|09|12)/);
    if(!match || !/사업보고서|반기보고서|분기보고서/.test(filing.report_nm))continue;
    const kind:Kind=match[2]==="12"?"annual":match[2]==="06"?"half":match[2]==="03"?"q1":"q3";
    periods.set(`${match[1]}:${kind}`,P(Number(match[1]),kind));
  }
  const rank:Record<Kind,number>={q1:1,half:2,q3:3,annual:4};
  const sorted=[...periods.values()].sort((a,b)=>b.year-a.year || rank[b.kind]-rank[a.kind]);
  latestPeriodsCache.set(code,{at:Date.now(),periods:sorted});
  return sorted;
}

async function lookupFilingForPeriod(code: string, year: number, reprt: string, requestKey?: string) {
  const cacheKey = `${code}-${year}-${reprt}`;
  const cached = filingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.filing ? 60_000 : 15_000)) return cached.filing;
  const nowYear = new Date().getFullYear();
  const startYear = reprt === "11011" ? year + 1 : year;
  if(startYear>nowYear)return null;
  const list=await filingPages(code,`${startYear}0101`,`${nowYear}1231`,requestKey,true);
  const pattern = expectedReportPattern(year, reprt);
  const typeOnly = reprt === "11011" ? /사업보고서/ : reprt === "11012" ? /반기보고서/ : /분기보고서/;
  const matching = list.filter((item) => {
    if (!/^\d{14}$/.test(item.rcept_no ?? "")) return false;
    if (!typeOnly.test(item.report_nm ?? "")) return false;
    return pattern.test(item.report_nm ?? "");
  }).sort((a, b) => (b.rcept_dt ?? "").localeCompare(a.rcept_dt ?? ""));
  const filing = matching[0] ? { rceptNo: matching[0].rcept_no, reportName: matching[0].report_nm, receiptDate: matching[0].rcept_dt } : null;
  filingCache.set(cacheKey, { at: Date.now(), filing });
  return filing;
}

async function filingForPeriod(code: string, year: number, reprt: string, requestKey?: string) {
  const cacheKey = `${code}-${year}-${reprt}`;
  const cached = filingCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.filing ? 60_000 : 15_000)) return cached.filing;
  const inflight = filingInFlight.get(cacheKey);
  if (inflight) return inflight;
  const pending = lookupFilingForPeriod(code, year, reprt, requestKey);
  filingInFlight.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    if (filingInFlight.get(cacheKey) === pending) filingInFlight.delete(cacheKey);
  }
}

async function statements(code: string, year: number, reprt: string, fs: "CFS" | "OFS", force = false, requestKey?: string): Promise<Row[] | null> {
  const fingerprint = createHash("sha256").update(key(requestKey)).digest("hex").slice(0,24);
  const k = `${code}-${year}-${reprt}-${fs}-${fingerprint}`;
  const hit = stmtCache.get(k);
  // A temporary incomplete response must not hide the income statement for one hour.
  const incomplete = !hit?.rows?.length || hit.rows.some(row=>Boolean(row.recovery_note && !row.recovery_note.includes("보완했습니다")));
  if (!force && hit && Date.now()-hit.at < (incomplete ? 15_000 : 60_000)) return hit.rows;
  const pending = force ? undefined : statementInFlight.get(k);
  if (pending) return pending;
  const load = async ():Promise<Row[] | null> => {
    const params = new URLSearchParams({crtfc_key:key(requestKey),corp_code:code,bsns_year:String(year),reprt_code:reprt});
    const [response,filing] = await Promise.all([
      dartFetch(`${BASE}/fnlttSinglAcntAll.json?${params}&fs_div=${fs}`,{},8_000),
      filingForPeriod(code,year,reprt,requestKey).catch(()=>null),
    ]);
    if (!response.ok) throw new TRPCError({code:"BAD_GATEWAY",message:`DART 재무제표 조회 실패: HTTP ${response.status}`});
    const json=await response.json() as {status:string;message?:string;list?:Row[]};
    if (!["000","013"].includes(json.status)) throw new TRPCError({code:"BAD_GATEWAY",message:`DART ${json.status}: ${json.message ?? "조회 실패"}`});
    const primary=(json.list ?? []).filter(row=>(!row.bsns_year || String(row.bsns_year)===String(year)) && (!row.reprt_code || row.reprt_code===reprt) && (!row.fs_div || row.fs_div===fs)).map(row => ({...row, source_type:"ALL" as const}));
    const receipt=primary.find(row=>/^\d{14}$/.test(row.rcept_no ?? ""))?.rcept_no ?? filing?.rceptNo;
    const recovered=await recoverStatementRows(primary,{year,report:reprt,basis:fs,receipt,corpCode:code},async()=>{
      const response=await dartFetch(`${BASE}/fnlttSinglAcnt.json?${params}`,{},5_000);
      if (!response.ok) throw new Error("major account request failed");
      return await response.json();
    });
    const resolvedReceipt=receipt ?? recovered.rows.find(row=>/^\d{14}$/.test(row.rcept_no ?? ""))?.rcept_no;
    const rows=resolvedReceipt ? recovered.rows.map(row=>({...row,rcept_no:row.rcept_no || resolvedReceipt})) : [];
    const result=rows.length ? rows : null;
    stmtCache.set(k,{at:Date.now(),rows:result});return result;
  };
  const request=load();statementInFlight.set(k,request);
  try { return await request; } finally { if (statementInFlight.get(k)===request) statementInFlight.delete(k); }
}

function normAccount(s: string) { return s.replace(/[\s·ㆍ]/g, ""); }

import { ACCOUNT_SPECS as DIRECT_ACCOUNT_SPECS, normalizeAccountName, periodAmount, pairedIncome, sameAccountScope, selectAccount } from "../../shared/financialAccounts.ts";
import { COMPARISON_ACCOUNT_METRICS, isExtraComparisonMetric, type ExtraComparisonMetric } from "../../shared/comparisonMetrics.ts";

export function pickDirectAccount(rows: Row[], period: Period, term: string) {
  const basis = rows.find(row => row.fs_div)?.fs_div === "OFS" ? "OFS" : "CFS";
  const selected = selectAccount(rows, term, period, basis);
  if (!selected) return null;
  const {row,value} = selected;
  return {value, unit:"억원", lines:[`원천 계정: ${row.account_nm}`, `계정코드: ${row.account_id || "미제공"}`, `금액 기준: ${period.mode === "cum" ? "누계" : "3개월"}`], formula:null, disclaimer:null,
    sourceHeading:`${row.sj_div === "BS" ? "재무상태표" : row.sj_div === "CF" ? "현금흐름표" : "손익계산서"} > ${row.account_nm}`};
}

type ResolvedBalanceTotal = { value: number; label: string; sourceLabel: string; derived: boolean; lines: string[] };

/**
 * 재무상태표 합계 계정은 DART 계정명 변형과 IFRS 계정코드를 함께 확인합니다.
 * 자산총계 행을 끝내 찾지 못한 경우에만 회계항등식(부채총계 + 자본총계)으로 보완하고,
 * 산식에 그 사실을 명시해 직접 공시값과 계산값이 혼동되지 않게 합니다.
 */
function resolveBalanceTotal(rows: Row[], period: Period, label: "자산총계" | "부채총계" | "자본총계"): ResolvedBalanceTotal | null {
  const aliases: Record<typeof label, string[]> = {
    자산총계: ["자산총계", "총자산", "자산총액", "자산합계", "자산계"],
    부채총계: ["부채총계", "총부채", "부채총액", "부채합계", "부채계"],
    자본총계: ["자본총계", "총자본", "자본총액", "자본합계", "자본계"],
  };
  const direct = pickDirectAccount(rows, period, label);
  if (direct && Number.isFinite(direct.value)) {
    const accountLine = direct.lines.find((line) => line.startsWith("원천 계정:")) ?? `원천 계정: ${label}`;
    return { value: direct.value, label, sourceLabel: accountLine.replace("원천 계정: ", ""), derived: false, lines: [accountLine] };
  }

  const row = findRowLike(rows, ["BS"], aliases[label]);
  const raw = row ? (row.thstrm_amount || row.thstrm_add_amount || "").replace(/,/g, "").trim() : "";
  let value: number | null = null;
  if (raw) {
    if (/^(?:-|—|–|－|−)$/.test(raw)) value = 0;
    else {
      const parenthesized = /^\(.*\)$/.test(raw);
      const numeric = Number(parenthesized ? `-${raw.slice(1, -1)}` : raw);
      if (Number.isFinite(numeric)) value = numeric / 1e8;
    }
  }
  if (row && value !== null && Number.isFinite(value)) {
    return { value, label, sourceLabel: row.account_nm ?? label, derived: false, lines: [`원천 계정: ${row.account_nm ?? label}`] };
  }

  if (label === "자산총계") {
    const liabilities = resolveBalanceTotal(rows, period, "부채총계");
    const equity = resolveBalanceTotal(rows, period, "자본총계");
    if (liabilities && equity && Number.isFinite(liabilities.value) && Number.isFinite(equity.value)) {
      const assets = liabilities.value + equity.value;
      if (Number.isFinite(assets) && assets > 0) {
        return {
          value: assets, label, sourceLabel: "부채총계 + 자본총계", derived: true,
          lines: [`자산총계 대체 산식: 부채총계 ${won(liabilities.value)} + 자본총계 ${won(equity.value)} = ${won(assets)}`],
        };
      }
    }
  }
  return null;
}

function pickedCitation(period:Period,picked:PickedMetric|null,rows:Row[],url:string|null=null) {
  const receipt=rows.find(row=>row.rcept_no)?.rcept_no ?? "";
  const external=/네이버 금융|FnGuide/.test(picked?.sourceHeading ?? "");
  return `${external ? picked!.sourceHeading : citation(periodLabel(period),picked?.sourceHeading ?? "원천 계정 미확인",receipt)}${url ? ` · ${url}` : ""}`;
}

function pickRawAccountMetrics(rows: Row[], period: Period, rceptNo: string) {
  return Object.fromEntries(Object.keys(DIRECT_ACCOUNT_SPECS).map((label) => {
    const picked = pickDirectAccount(rows, period, label);
    return [label, picked ? { ...picked, citation: citation(periodLabel(period), picked.sourceHeading, rceptNo), available: Number.isFinite(picked.value) } : null];
  }));
}


type GrossBorrowingComponent = { group: string; account: string; value: number; row: Row };

function leaseBucket(row: Row): "current" | "noncurrent" | "total" | null {
  const name = normalizeAccountName(row.account_nm);
  const id = (row.account_id ?? "").replace(/^(?:ifrs-full|dart)_/i, "");
  if (/^(?:NoncurrentLeaseLiabilities|LeaseLiabilitiesNoncurrent)$/i.test(id) || /비유동.*리스|리스.*비유동|장기리스/.test(name)) return "noncurrent";
  if (/^(?:CurrentLeaseLiabilities|LeaseLiabilitiesCurrent)$/i.test(id) || /유동.*리스|리스.*유동|단기리스/.test(name)) return "current";
  return /^(?:LeaseLiabilities)$/i.test(id) || /^(?:리스부채|리스부채합계|리스부채총계)$/.test(name) ? "total" : null;
}

/**
 * 총차입금/차입금의존도용 차입성 부채 집계.
 * 순차입금(netDebt)의 기존 정책(리스부채 제외)은 이 함수에 영향을 받지 않습니다.
 * 완전한 BS 응답에서 확인된 구성 계정만 합산하고, 애매한 '차입금및사채' 단일 행은 총계로 간주하지 않습니다.
 */
function grossBorrowingComponents(rows: Row[]): { items: GrossBorrowingComponent[]; coreFound: number; coreComplete: boolean; fullBalanceSheet: boolean; total: number; missing: string[]; combinedRow: Row | null } {
  const bsRows = rows.filter((row) => row.sj_div === "BS");
  const normalize = normalizeAccountName;
  const excluded = /사채할인발행차금|차입금할인발행차금|미상각할인차금|할인발행차금|상환할증금|사채발행비|총차입금|차입금총계|차입금합계|총차입부채|차입금및사채|차입금및회사채|차입금과사채/;
  const groups: Array<{ group: string; aliases: string[]; ids: RegExp[]; lease?: boolean; preferAggregate?: string[]; preferSingle?: string[] }> = [
    { group: "단기차입금", aliases: ["단기차입금", "단기차입부채", "단기금융기관차입금", "단기은행차입금", "단기대출금", "유동차입금", "유동성금융기관차입금"], ids: [/ShorttermBorrowings|ShortTermBorrowings|ShorttermLoansAndBorrowings|ShortTermLoansAndBorrowings|CurrentBorrowings|BorrowingsCurrent|CurrentLoansAndBorrowings|LoansAndBorrowingsCurrent|CurrentFinancialInstitutionBorrowings/i], preferSingle: ["단기차입금", "단기차입부채"] },
    { group: "유동성장기부채", aliases: ["유동성장기부채", "유동성장기차입금", "유동성장기차입부채", "유동성장기금융부채", "유동성금융기관차입금", "유동성차입부채", "유동성차입금", "비유동차입금의유동성대체부분", "유동성장기부채및사채", "유동성전환사채", "유동성사채", "유동성장기사채", "유동성전환사채", "유동성신주인수권부사채", "유동성교환사채"], ids: [/CurrentPortionOfLongtermBorrowings|CurrentPortionOfLongtermBorrowings|CurrentPortionOfLongtermFinancialLiabilities|CurrentMaturitiesOfLongtermBorrowings/i], preferAggregate: ["유동성장기부채", "유동성장기부채및사채"] },
    { group: "장기차입금", aliases: ["장기차입금", "장기차입부채", "장기금융기관차입금", "장기금융부채", "장기대출금", "비유동차입금", "비유동차입부채", "비유동성금융기관차입금", "비유동금융기관차입금", "비유동성금융기관차입금"], ids: [/LongtermBorrowings|LongTermBorrowings|LongtermLoansAndBorrowings|LongTermLoansAndBorrowings|NoncurrentBorrowings|NoncurrentLoansAndBorrowings|NoncurrentFinancialInstitutionBorrowings|LongTermDebtNoncurrent/i], preferAggregate: ["장기차입금", "장기차입부채", "장기금융부채", "비유동차입금", "비유동차입부채", "비유동성금융기관차입금", "비유동금융기관차입금"] },
    { group: "사채", aliases: ["사채", "회사채", "비유동사채", "전환사채", "신주인수권부사채", "교환사채", "단기사채"], ids: [/^ifrs-full_BondsIssued$|ConvertibleBondsIssued|DebenturesIssued|BondsPayable/i], preferSingle: ["사채", "회사채"] },
    { group: "유동리스부채", aliases: ["유동리스부채", "유동성리스부채", "유동리스부채합계", "유동성리스부채합계"], ids: [/CurrentLeaseLiabilities|LeaseLiabilitiesCurrent/i], lease: true, preferSingle: ["유동리스부채", "유동성리스부채"] },
    { group: "비유동리스부채", aliases: ["비유동리스부채", "장기리스부채", "비유동리스부채합계"], ids: [/NoncurrentLeaseLiabilities|LeaseLiabilitiesNoncurrent/i], lease: true, preferSingle: ["비유동리스부채", "장기리스부채"] },
  ];
  const candidatesFor = (spec: typeof groups[number]) => bsRows.flatMap((row) => {
    const account = normalize(row.account_nm);
    const id = row.account_id ?? "";
    if (!account && !spec.ids.some((pattern) => pattern.test(id))) return [];
    if (!spec.lease && account.includes("리스")) return [];
    if (!spec.lease && leaseBucket(row)) return [];
    const currentBankBorrowing = /^유동성금융기관차입금/.test(account);
    if (spec.group === "단기차입금" && ((/유동성|유동.*장기/.test(account) && !currentBankBorrowing) || /Noncurrent|Longterm|CurrentPortion|CurrentMaturities|BorrowingsNoncurrent/i.test(id))) return [];
    if (spec.group === "유동리스부채" && leaseBucket(row) !== "current") return [];
    if (spec.group === "비유동리스부채" && leaseBucket(row) !== "noncurrent") return [];
    if (excluded.test(account)) return [];
    if (spec.group === "사채" && account.startsWith("유동성")) return [];
    if (spec.group === "장기차입금" && (account.startsWith("유동성") || /CurrentPortion/i.test(id))) return [];
    if (spec.lease && !/리스/i.test(account) && !spec.ids.some((pattern) => pattern.test(id))) return [];
    const aliasIndex = spec.aliases.findIndex((alias) => account === alias || account.startsWith(alias));
    const idMatch = spec.ids.some((pattern) => pattern.test(id));
    if (aliasIndex < 0 && !idMatch && !spec.lease) return [];
    const raw = (row.thstrm_amount ?? "").replace(/,/g, "").trim();
    const value = /^[-—–－−]$/.test(raw) ? 0 : amountOf(row);
    if (value === null || !Number.isFinite(value)) return [];
    return [{ row, value, account, aliasIndex, idMatch, accountLength: account.length }];
  }).sort((a, b) => a.aliasIndex - b.aliasIndex || a.accountLength - b.accountLength);

  const selectGroupRows = (spec: typeof groups[number]) => {
    const candidates = candidatesFor(spec);
    if (!candidates.length) return [] as typeof candidates;
    // 공시가 범용 합계 행을 주면 그것을 사용하고 세부 계정을 더하지 않아 중복 합산을 막습니다.
    if (spec.preferAggregate?.length) {
      for (const alias of spec.preferAggregate) {
        const found = candidates.filter((item) => item.account === alias || item.account.startsWith(alias)).sort((a, b) => a.accountLength - b.accountLength)[0];
        if (found) {
          // A loan's current portion does not include separately disclosed convertible bonds.
          if (spec.group === "유동성장기부채" && !/사채/.test(found.account)) {
            return [found, ...candidates.filter(item => item.row !== found.row && /사채/.test(item.account))];
          }
          return [found];
        }
      }
    }
    // 이름이 같은 계정코드 변형이 여러 개 있으면 하나만 고르되, 상이한 세부 계정은 함께 합산합니다.
    if (spec.preferSingle?.length) {
      for (const alias of spec.preferSingle) {
        const found = candidates.filter((item) => item.account === alias || item.account.startsWith(alias)).sort((a, b) => a.accountLength - b.accountLength)[0];
        if (found) {
          if (spec.group === "사채" || spec.lease || (spec.group === "단기차입금" && ["단기차입금", "단기차입부채"].includes(alias))) return [found];
          // 유동성 금융기관 차입금(사채 제외)과 유동성 사채처럼 별도 계정인 항목은 같이 집계합니다.
          if (spec.group === "단기차입금") return [found, ...candidates.filter((item) => item.row !== found.row && !["단기차입금", "단기차입부채"].includes(item.account))];
        }
      }
    }
    const uniqueRows = new Set<Row>();
    return candidates.filter((item) => {
      if (uniqueRows.has(item.row)) return false;
      uniqueRows.add(item.row);
      return true;
    });
  };

  const coreSpecs = groups.filter((spec) => !spec.lease);
  const selectedCore = coreSpecs.map((spec) => ({ spec, selected: selectGroupRows(spec) }));
  const coreItems: GrossBorrowingComponent[] = selectedCore.flatMap(({ spec, selected }) => selected.map((found) => ({ group: spec.group, account: (found.row.account_nm ?? spec.group).trim(), value: found.value, row: found.row })));
  // 장기차입금 계정에 사채가 포함됐다고 명시되면 별도 사채 계정을 중복으로 더하지 않습니다.
  const longTermIncludesBonds = coreItems.some((item) => item.group === "장기차입금" && /(?:장기차입금|비유동차입금|장기차입부채).*사채.*포함|(?:장기차입금|비유동차입금|장기차입부채).*포함.*사채/.test(normalize(item.account)));
  const filteredCore = longTermIncludesBonds ? coreItems.filter((item) => item.group !== "사채") : coreItems;

  const leaseSpecs = groups.filter((spec) => spec.lease);
  let leaseItems: GrossBorrowingComponent[] = leaseSpecs.flatMap((spec) => selectGroupRows(spec).map((found) => ({ group: spec.group, account: (found.row.account_nm ?? spec.group).trim(), value: found.value, row: found.row })));
  // '리스부채'만 단독 계정으로 제공하는 공시도 지원하되 구성 행이 있으면 합계 행을 더하지 않습니다.
  if (!leaseItems.length) {
    const genericLease = bsRows.flatMap((row) => {
      const name = normalize(row.account_nm);
      if (!/^(?:리스부채|리스부채합계|리스부채총계)$/.test(name)) return [];
      const value = amountOf(row);
      return value === null || !Number.isFinite(value) ? [] : [{ group: "리스부채", account: (row.account_nm ?? "리스부채").trim(), value, row }];
    })[0];
    if (genericLease) leaseItems = [genericLease];
  }
  const usedRows = new Set<Row>();
  const items = [...filteredCore, ...leaseItems].filter((item) => {
    if (usedRows.has(item.row)) return false;
    usedRows.add(item.row);
    return true;
  });
  const nativeBalance = bsRows.filter(row => row.source_type !== "MAJOR");
  const basis = nativeBalance.find(row => row.fs_div)?.fs_div === "OFS" ? "OFS" : "CFS";
  const totals = ["자산총계", "부채총계", "자본총계"].map(label => selectAccount(nativeBalance, label, undefined, basis));
  // OpenDART ALL can contain multiple account_detail values within one CFS report.
  // Requiring every BS row to have the same account_detail incorrectly rejects
  // otherwise complete balance sheets (and makes absent bond categories "missing").
  // A complete statement requires the three control totals from ALL, a single
  // requested financial-statement basis, and a sufficiently populated BS.
  const hasAllSource = nativeBalance.some(row => row.source_type === "ALL") || (nativeBalance.length >= 6 && nativeBalance.every(row => !row.source_type));
  const knownBases = new Set(nativeBalance.map(row => row.fs_div).filter(Boolean));
  const fullBalanceSheet = hasAllSource && totals.every(Boolean) && nativeBalance.length >= 6 && knownBases.size <= 1;
  const coreFound = selectedCore.filter((item) => item.selected.length > 0).length;
  // Not every company issues bonds or has a current portion of long-term debt.
  // Only a complete ALL balance sheet without unresolved borrowing rows can
  // establish the scope of the reported components; sparse/major-account data cannot.
  const unmatchedBorrowing = bsRows.some(row => {
    const name = normalize(row.account_nm);
    if ((!/차입|사채|대출금/.test(name) && !/Borrowings|Bonds|Debenture|LoansAndBorrowings/i.test(row.account_id ?? "")) || /할인발행|발행비|상환할증|총차입금|차입금총계|차입금합계|차입금및사채|차입금및회사채|차입금과사채/.test(name)) return false;
    return !coreItems.some(item => item.row === row) && !selectedCore.some(({spec}) => candidatesFor(spec).some(item => item.row === row));
  });
  // Other financial liabilities include trade payables/derivatives and must not
  // invalidate the separately disclosed loan/bond accounts or be added wholesale.
  // Leases are independently verified in the body or the same report's notes.
  const reportedScopeComplete = fullBalanceSheet && coreFound > 0 && !unmatchedBorrowing;
  // '차입금및사채'처럼 차입금과 사채를 한 줄로 묶어 공시하는 계정(구성 계정이 따로 없을 때만 합계로 사용).
  const combinedRow = bsRows.find((row) => /^(?:차입금및사채|차입금및회사채|차입금과사채|차입금및사채합계)$/.test(normalize(row.account_nm)) && (() => { const v = amountOf(row); return v !== null && Number.isFinite(v); })()) ?? null;
  return {
    items, coreFound, coreComplete: selectedCore.every((item) => item.selected.length > 0) || reportedScopeComplete, fullBalanceSheet,
    total: items.reduce((sum, item) => sum + item.value, 0),
    missing: reportedScopeComplete ? [] : selectedCore.filter((item) => item.selected.length === 0).map((item) => item.spec.group),
    combinedRow,
  };
}

function pickGrossBorrowingMetric(rows: Row[], period: Period, metric: "borrowings" | "borrowingsRatio"): PickedMetric | null {
  const bsRows = rows.filter((row) => row.sj_div === "BS");
  const normalize = normalizeAccountName;
  const aggregateNames = new Set(["총차입금", "차입금총계", "차입금합계", "총차입부채", "총이자부부채", "이자부부채합계", "차입금및사채", "차입금및회사채", "차입금과사채"]);
  const aggregateRow = bsRows.find((row) => aggregateNames.has(normalize(row.account_nm)) && !normalize(row.account_nm).includes("리스"));
  const aggregateValue = aggregateRow ? amountOf(aggregateRow) : null;
  const components = grossBorrowingComponents(rows);
  let totalBorrowings = Number.NaN;
  let lines: string[] = [];
  let formula = "총차입금 = 공시된 차입성 부채 계정 합계(유동·비유동 리스부채 포함)";
  let disclaimer: string | null = null;
  let sourceHeading = "재무상태표 > 차입금 구성 계정";

  if (aggregateRow && aggregateValue !== null && Number.isFinite(aggregateValue) && aggregateValue >= 0) {
    // DART의 총차입금 합계가 리스부채를 제외하는지, 이미 포함하는지 구성 계정과 대조해 판별합니다.
    const leaseItems = components.items.filter((item) => /리스/.test(item.group) || /리스부채/.test(item.account));
    const coreItems = components.items.filter((item) => !leaseItems.includes(item));
    const coreTotal = coreItems.reduce((sum, item) => sum + item.value, 0);
    const leaseTotal = leaseItems.reduce((sum, item) => sum + item.value, 0);
    // 합계와 구성 계정의 차이 허용치는 반올림 수준으로 제한합니다. 1% 허용치는
    // 1조 원대 차입금에서 리스부채 규모까지 오차로 흡수해 리스를 중복 가산할 수 있습니다.
    const tolerance = Math.max(0.5, Math.abs(aggregateValue) * 0.0001);
    const matchesCoreOnly = components.coreFound > 0 && Math.abs(coreTotal - aggregateValue) <= tolerance;
    const matchesLeaseIncluded = leaseItems.length > 0 && Math.abs(components.total - aggregateValue) <= tolerance;
    const combinedBorrowingAndBonds = /^(?:차입금및사채|차입금및회사채|차입금과사채)$/.test(normalize(aggregateRow.account_nm));
    // 별도 구성 계정이 없고 원천 계정명이 '차입금및사채'인 경우, 그 이름은 차입성 부채·사채를 뜻하므로
    // 별도 항목인 리스부채는 한 번 추가합니다. 총차입금 합계와 구성 계정이 있을 때는 아래 대조 규칙이 우선합니다.
    const addLeaseToCombinedLine = combinedBorrowingAndBonds && components.coreFound === 0 && leaseTotal > 0 && !matchesLeaseIncluded;
    totalBorrowings = (matchesCoreOnly && leaseTotal > 0) || addLeaseToCombinedLine ? aggregateValue + leaseTotal : aggregateValue;
    lines = [`분자 · DART 공시 합계 계정 ${aggregateRow.account_nm}: ${won(aggregateValue)}`];
    sourceHeading = `재무상태표 > ${aggregateRow.account_nm}`;
    if (addLeaseToCombinedLine) {
      lines.push(`DART 원문 구성 리스부채 추가: ${won(leaseTotal)}`, `리스 포함 총차입금: ${won(totalBorrowings)}`);
      sourceHeading = `재무상태표 > ${aggregateRow.account_nm} + 리스부채 구성 계정`;
    } else if (matchesCoreOnly && leaseTotal > 0) {
      lines.push(...coreItems.map((item) => `구성 · ${item.account}: ${won(item.value)}`));
      lines.push(`DART 구성 계정에서 확인한 유동·비유동 리스부채 추가: ${won(leaseTotal)}`, `리스 포함 총차입금: ${won(totalBorrowings)}`);
      sourceHeading = `재무상태표 > ${aggregateRow.account_nm} + 리스부채 구성 계정`;
    } else if (matchesLeaseIncluded) {
      lines.push(`구성 계정 합계(리스부채 포함): ${won(components.total)}`, `차이: ${won(Math.abs(components.total - aggregateValue))}`);
    } else if (components.coreFound > 0) {
      lines.push(...components.items.map((item) => `구성 · ${item.account}: ${won(item.value)}`));
      if (combinedBorrowingAndBonds) lines.push(`참고 · '${aggregateRow.account_nm}' 행은 구성 계정과의 중복 합산을 방지하기 위해 별도로 더하지 않았습니다.`);
      lines.push(`구성 계정 합계(현재 확인 범위): ${won(components.total)}`, `차이: ${won(Math.abs(components.total - aggregateValue))}`);
      if (Math.abs(components.total - aggregateValue) > tolerance) disclaimer = "공시 합계와 구성 계정의 금액이 불일치합니다. 주석에서 리스부채 포함 여부를 확인해야 합니다.";
    } else if (combinedBorrowingAndBonds) {
      disclaimer = `구성 계정이 없어 '${aggregateRow.account_nm}' 합계 행을 사용했습니다. 리스부채는 별도 확인이 필요합니다.`;
    }
  } else if (components.coreFound > 0) {
    lines = components.items.map((item) => `구성 · ${item.account}: ${won(item.value)}`);
    if (components.fullBalanceSheet && components.coreComplete && components.coreFound < 4) lines.push("전체 재무상태표에서 공시된 차입금·사채 표시 계정을 합산했습니다. 별도 표시되지 않은 종류를 필수 누락으로 처리하지 않았습니다.");
    const missing = [...components.missing];
    if (!components.items.some(item => item.group === "리스부채")) {
      for (const lease of ["유동리스부채","비유동리스부채"]) if(!components.items.some(item=>item.group===lease)) missing.push(lease);
    }
    // IFRS 16 was effective from 2019. Before then, a missing lease-liability
    // account alone must not invalidate an otherwise reconciled debt subtotal.
    // This is a reporting-scope distinction, NOT an assumption that leases are zero.
    const unresolved = period.year < 2019 ? missing.filter(item => !/리스부채/.test(item)) : missing;
    if(unresolved.length) return {value:Number.NaN,partialValue:components.total,missingComponents:unresolved,unit:metric === "borrowingsRatio" ? "%" : "억원",lines:[...lines,`확인된 차입금 부분합: ${won(components.total)}`],formula,disclaimer:`총차입금을 확정하지 않았습니다. 미확인 구성 항목: ${unresolved.join(", ")}. 확인된 부분합 ${won(components.total)}을 총액 또는 비율로 사용하지 않습니다.`,sourceHeading};
    if (period.year < 2019 && missing.some(item => /리스부채/.test(item))) {
      disclaimer = "2019년 이전 회계기간으로, IFRS 16 적용 이후의 리스부채 범위와 직접 비교할 수 없습니다. 해당 기간 공시 차입금·사채 기준값입니다.";
    }
    totalBorrowings = components.total;
    lines.push(`분자 · 차입성 부채 합계(리스부채 포함): ${won(totalBorrowings)}`);
    if (components.combinedRow) lines.push(`참고 · '${components.combinedRow.account_nm}' 행은 구성 계정과의 중복 합산을 막기 위해 제외`);
    sourceHeading = "재무상태표 > 차입금·사채·리스부채 구성 계정";
  } else if (components.combinedRow) {
    const combined = amountOf(components.combinedRow) as number;
    totalBorrowings = combined;
    lines = [`분자 · 공시 계정 ${components.combinedRow.account_nm}: ${won(combined)}`];
    disclaimer = `별도 구성 계정이 없어 '${components.combinedRow.account_nm}' 행 전체를 총차입금으로 사용했습니다. 리스부채는 포함되지 않았을 수 있습니다.`;
    sourceHeading = `재무상태표 > ${components.combinedRow.account_nm}`;
  } else {
    const missing = components.missing.join(", ") || "차입금 구성 계정";
    return {
      value: Number.NaN, unit: metric === "borrowingsRatio" ? "%" : "억원",
      lines: ["재무상태표에서 차입금·사채 계정을 찾지 못했습니다.", `누락 계정: ${missing}`],
      formula: metric === "borrowingsRatio" ? "차입금의존도 = 총차입금 ÷ 자산총계 × 100" : formula,
      disclaimer: `재무상태표에서 차입금 관련 계정이 확인되지 않아(누락: ${missing}) 계산하지 않았습니다. 임의로 0원 처리하지 않았습니다.`,
      sourceHeading,
    };
  }

  if (metric === "borrowings") return { value: totalBorrowings, unit: "억원", lines, formula, disclaimer, sourceHeading };
  const resolvedAssets = resolveBalanceTotal(rows, period, "자산총계");
  const assets = resolvedAssets?.value ?? null;
  if (!resolvedAssets || assets === null || !Number.isFinite(assets) || assets <= 0 || !Number.isFinite(totalBorrowings)) {
    return { value: Number.NaN, unit: "%", lines: [...lines, "분모 · 자산총계 확인 실패"], formula: "차입금의존도 = 총차입성 부채(리스 포함) ÷ 자산총계 × 100", disclaimer: "자산총계 행과 부채총계+자본총계 대체 산식을 모두 확인하지 못해 차입금 의존도를 계산하지 않았습니다.", sourceHeading };
  }
  const ratio = totalBorrowings / assets * 100;
  lines.push(...resolvedAssets.lines, `분모 · 자산총계${resolvedAssets.derived ? "(부채총계 + 자본총계로 계산)" : ""}: ${won(assets)}`, `계산 · 총차입성 부채(리스 포함) ${won(totalBorrowings)} ÷ ${won(assets)} × 100 = ${ratio.toFixed(2)}%`);
  return { value: ratio, unit: "%", lines, formula: "차입금의존도 = (차입금 + 사채 + 유동·비유동 리스부채) ÷ 자산총계 × 100", disclaimer, sourceHeading: `${sourceHeading}·자산총계` };
}

type PickedMetric = { partialValue?: number; missingComponents?: string[]; value: number; unit: string; lines: string[]; formula: string | null; disclaimer: string | null; sourceHeading: string };

function revenueFromOperatingCosts(rows:Row[],period:Period):PickedMetric|null {
  for (const section of ["CIS","IS"]) {
    const group=rows.filter(row=>row.sj_div===section);
    const profit=findRowLike(group,[section],metricConfig.operatingProfit.names,period);
    const expense=group.find(row => (/^(?:영업비용|영업비용합계|총영업비용)$/.test(normalizeAccountName(row.account_nm)) || /^ifrs-full_OperatingExpenses$/i.test(row.account_id??"")) && periodAmount(row,period)!==null);
    if (!profit || !expense || !sameAccountScope(profit,expense)) continue;
    const p=periodAmount(profit,period),e=periodAmount(expense,period);
    if (p===null || e===null || e<0 || p+e<0) continue;
    return {value:p+e,unit:"억원",formula:"영업수익(매출액) = 동일 손익계산서의 영업이익 + 영업비용",lines:[`영업이익 ${won(p)}`,`공시 영업비용 합계 ${won(e)}`,`영업수익 ${won(p+e)}`],disclaimer:null,sourceHeading:"손익계산서 > 영업수익(영업이익 + 영업비용)"};
  }
  return null;
}

export function pickMetric(rows: Row[], period: Period, metric: FinancialMetric): PickedMetric | null {
  if (metric === "payables") return pickDirectAccount(rows, period, "매입채무");
  if (metric === "borrowings" || metric === "borrowingsRatio") {
    return pickGrossBorrowingMetric(rows, period, metric);
  }

  if (metric === "netDebt") {
    const result = netDebt(rows);
    if (!result.ok) return {
      value: Number.NaN,
      unit: "억원",
      lines: [`확인된 계정: ${result.items.map((item) => `${item.sign} ${item.account} ${won(item.amount)}`).join(" · ") || "없음"}`, `누락 계정: ${result.missing.join(", ")}`],
      formula: "순차입금 = 총차입금(리스부채 제외) − 현금성 자산·단기금융상품",
      disclaimer: `순차입금 계산에 필요한 계정이 누락되었습니다: ${result.missing.join(", ")}. 누락값을 0으로 간주하지 않습니다.`,
      sourceHeading: "재무상태표 > 차입금·현금 계정",
    };
    return {
      value: result.value, unit: "억원",
      lines: result.items.map((item) => `${item.sign} ${item.account} ${won(item.amount)}`),
      formula: result.formula, disclaimer: result.disclaimer, sourceHeading: "재무상태표 > 차입금·현금 계정",
    };
  }

  if (metric === "workingCapital") {
    const receivable = findRowLike(rows, ["BS"], ["매출채권", "매출채권및기타채권", "유동매출채권"]);
    const inventory = findRowLike(rows, ["BS"], ["재고자산", "유동재고자산"]);
    const payable = findRowLike(rows, ["BS"], ["매입채무", "매입채무및기타채무", "유동매입채무"]);
    const receivablesValue = receivable ? amountOf(receivable) : null;
    const inventoryValue = inventory ? amountOf(inventory) : null;
    const payableValue = payable ? amountOf(payable) : null;
    if (receivablesValue === null || inventoryValue === null || payableValue === null) return null;
    return {
      value: receivablesValue + inventoryValue - payableValue,
      unit: "억원",
      lines: [`매출채권 ${won(receivablesValue)} + 재고자산 ${won(inventoryValue)} − 매입채무 ${won(payableValue)}`],
      formula: "운전자본 = 매출채권 + 재고자산 − 매입채무",
      disclaimer: "기업별 계정 분류에 따라 구성 계정이 달라질 수 있으며, 본 화면은 프로젝트에 정의된 운전자본 공식을 적용합니다.",
      sourceHeading: "재무상태표 > 매출채권·재고자산·매입채무",
    };
  }

  if (metric === "capex") {
    const row = findRowLike(rows, ["CF"], metricConfig.capex.names);
    const rawValue = row ? periodAmount(row, period) : null;
    if (!row || rawValue === null || !Number.isFinite(rawValue)) return null;
    // 현금흐름표의 유형자산 취득은 일반적으로 현금 유출(음수)입니다. CAPEX는 지출 규모로 양수화하여 FCF 계산과 맞춥니다.
    const value = Math.abs(rawValue);
    return { value, unit: "억원", lines: [`원천 계정: ${row.account_nm} ${won(rawValue)}`, `CAPEX 지출 규모: ${won(value)}`], formula: "CAPEX = 현금흐름표의 유형자산 취득 현금유출 절댓값", disclaimer: null, sourceHeading: "현금흐름표 > 유형자산 취득" };
  }

  if (metric === "freeCashFlow") {
    const cashFlow = pickMetric(rows, period, "operatingCashFlow");
    const capex = pickMetric(rows, period, "capex");
    if (!cashFlow || !capex) return null;
    return {
      value: cashFlow.value - capex.value,
      unit: "억원",
      lines: [`영업활동현금흐름 ${won(cashFlow.value)} − CAPEX ${won(capex.value)}`],
      formula: "FCF = 영업활동현금흐름 − CAPEX",
      disclaimer: null,
      sourceHeading: "현금흐름표 > 영업활동현금흐름·유형자산 취득",
    };
  }

  if (metric === "debtRatio") {
    const liabilities = resolveBalanceTotal(rows, period, "부채총계");
    const equity = resolveBalanceTotal(rows, period, "자본총계");
    if (!liabilities || !equity || !Number.isFinite(liabilities.value) || !Number.isFinite(equity.value) || equity.value <= 0) {
      const missing = [!liabilities ? "부채총계" : "", !equity ? "자본총계" : ""].filter(Boolean).join(", ") || "자본총계(0 이하 또는 숫자 아님)";
      return {
        value: Number.NaN, unit: "%", lines: [liabilities ? `부채총계: ${won(liabilities.value)}` : "부채총계 확인 실패", equity ? `자본총계: ${won(equity.value)}` : "자본총계 확인 실패"],
        formula: "부채비율 = 부채총계 ÷ 자본총계 × 100",
        disclaimer: `부채비율을 계산할 원천 계정이 부족합니다: ${missing}. 누락값을 임의로 채우지 않았습니다.`, sourceHeading: "재무상태표 > 부채총계·자본총계",
      };
    }
    const ratio = liabilities.value / equity.value * 100;
    return {
      value: ratio, unit: "%",
      lines: [...liabilities.lines, `분자 · 부채총계: ${won(liabilities.value)}`, ...equity.lines, `분모 · 자본총계: ${won(equity.value)}`, `계산 · ${won(liabilities.value)} ÷ ${won(equity.value)} × 100 = ${ratio.toFixed(2)}%`],
      formula: `부채비율 = 부채총계 ${won(liabilities.value)} ÷ 자본총계 ${won(equity.value)} × 100 = ${ratio.toFixed(2)}%`,
      disclaimer: null, sourceHeading: "재무상태표 > 부채총계·자본총계(직접 계산)",
    };
  }

  if (metric === "currentRatio") {
    const numerator = findRowLike(rows, ["BS"], ["유동자산"]);
    const denominator = findRowLike(rows, ["BS"], ["유동부채"]);
    const top = numerator ? amountOf(numerator) : null;
    const bottom = denominator ? amountOf(denominator) : null;
    if (top === null || bottom === null || bottom === 0) return null;
    return { value: top / bottom * 100, unit: "%", lines: [`유동자산 ${won(top)} ÷ 유동부채 ${won(bottom)} × 100`], formula: "유동비율 = 유동자산 ÷ 유동부채 × 100", disclaimer: null, sourceHeading: "재무상태표 > 유동자산·유동부채" };
  }

  if (metric === "operatingMargin" || metric === "netMargin") {
    const profitNames = metric === "operatingMargin" ? metricConfig.operatingProfit.names : metricConfig.netIncome.names;
    const pair = pairedIncome(rows, period, profitNames);
    if (!pair || pair.rev === 0) return null;
    const {rev, value: profitValue} = pair;
    const label = METRIC_LABELS[metric];
    const profitLabel = metric === "operatingMargin" ? "영업이익" : "순이익";
    return {
      value: (profitValue / rev) * 100,
      unit: "%",
      lines: [`${profitLabel} ${won(profitValue)} / 매출액 ${won(rev)}`],
      formula: `${label} = ${profitLabel} ÷ 매출액 × 100`,
      disclaimer: null,
      sourceHeading: `손익계산서 > 매출액·${profitLabel}`,
    };
  }


  if (metric === "interestCoverage") {
    const basis=rows.find(row=>row.fs_div)?.fs_div === "OFS" ? "OFS" : "CFS";
    const interest=selectAccount(rows,"이자비용",period,basis)?.row;
    const op=interest ? findRowLike(rows,[interest.sj_div ?? ""],metricConfig.operatingProfit.names) : undefined;
    if(!op || !interest || !sameAccountScope(op,interest))return null;
    const ov = op ? periodAmount(op, period) : null; const iv = interest ? periodAmount(interest, period) : null;
    if (ov === null || iv === null || iv === 0) return null;
    return { value: ov / Math.abs(iv), unit: "배", lines: [`영업이익 ${won(ov)} / ${interest!.account_nm} ${won(iv)}`], formula: "이자보상배율 = 영업이익 ÷ 이자비용", disclaimer: null, sourceHeading: "손익계산서 > 영업이익·이자비용" };
  }

  if (metric === "roe" || metric === "roa") {
    const profitRow = findRowLike(rows, ["CIS", "IS"], metricConfig.netIncome.names);
    const baseName = metric === "roe" ? "자본총계" : "자산총계";
    const baseRow = findRowLike(rows, ["BS"], [baseName]);
    const profit = profitRow ? periodAmount(profitRow, period) : null;
    const cur = baseRow ? amountOf(baseRow, 0) : null; const prev = baseRow ? amountOf(baseRow, 1) : null;
    if (profit === null || cur === null || prev === null || (cur + prev) === 0) return null;
    const avg = (cur + prev) / 2;
    return { value: profit / avg * 100, unit: "%", lines: [`순이익 ${won(profit)} / 평균${metric === "roe" ? "자본총계" : "자산총계"} ${won(avg)}`], formula: metric === "roe" ? "ROE = 당기순이익 ÷ 평균자기자본 × 100" : "ROA = 당기순이익 ÷ 평균총자산 × 100", disclaimer: null, sourceHeading: `재무제표 > ${metric.toUpperCase()} 원천 계정` };
  }

  if (metric === "eps") {
    const row = findRowLike(rows, ["CIS", "IS"], metricConfig.eps.names);
    const raw = row ? (row.thstrm_amount ?? "").replace(/,/g, "").trim() : "";
    const parsed = row ? periodAmount(row,period) : null;
    const value = parsed === null ? null : parsed * 1e8;
    if (value === null) return null;
    return { value, unit: "원", lines: [`원천 계정: ${row!.account_nm}`], formula: "EPS = 주당순이익 공시값", disclaimer: null, sourceHeading: `손익계산서 > ${row!.account_nm}` };
  }

  if (metric === "ebitda") {
    const op = findRowLike(rows, ["CIS", "IS"], metricConfig.operatingProfit.names);
    const ov = op ? periodAmount(op, period) : null;
    if (ov === null || !Number.isFinite(ov)) return null;

    const statementPriority = ["CF", "CIS", "IS"] as const;
    const normalize = (value: string) => value.replace(/[\s·ㆍ()（）]/g, "").toLowerCase();
    const expenseAmountOf = (row: Row) => periodAmount(row,period);
    const aggregateName = /(감가상각비.*무형자산상각비|무형자산상각비.*감가상각비|유무형자산.*상각|유형자산.*상각비.*무형자산.*상각|감가상각및상각비|감가상각비와상각비|감가상각비및무형자산상각비|감가상각비와무형자산상각비|감가상각및무형자산상각비|유형자산감가상각비및무형자산상각비|유형자산및무형자산상각비|감가상각비및상각비|감가상각및무형자산상각)/;
    const aggregateId = /DepreciationDepletionAndAmortisationExpense|DepreciationDepletionAndAmortizationExpense|DepreciationAndAmortisationExpense|DepreciationAmortisationExpense|DepreciationAndAmortizationExpense|DepreciationAmortizationExpense|AdjustmentsForDepreciationAndAmortisationExpense|AdjustmentsForDepreciationAndAmortizationExpense/i;
    const aggregateRows = rows.filter((row) => {
      if (!statementPriority.includes(row.sj_div as any)) return false;
      if (!(aggregateName.test(normalize(row.account_nm ?? "")) || aggregateId.test(row.account_id ?? ""))) return false;
      const value = expenseAmountOf(row);
      return value !== null && Number.isFinite(value);
    });
    // 공시가 유형·무형 상각비 합계를 하나의 계정으로 제공하면 이를 우선 사용합니다.
    const aggregate = aggregateRows.sort((a, b) => statementPriority.indexOf(a.sj_div as any) - statementPriority.indexOf(b.sj_div as any))[0];
    if (aggregate) {
      const da = expenseAmountOf(aggregate);
      if (da !== null && Number.isFinite(da)) {
        return {
          value: ov + Math.abs(da), unit: "억원",
          lines: [`영업이익 ${won(ov)}`, `${aggregate.account_nm} ${won(Math.abs(da))}`],
          formula: "EBITDA = 영업이익 + 공시된 유형·무형자산 감가상각/상각비 합계",
          disclaimer: null, sourceHeading: "손익계산서·현금흐름표 > EBITDA 원천 계정",
        };
      }
    }

    const daName = /(감가상각비|상각비)/;
    const normalizedName = (row: Row) => normalize(row.account_nm ?? "");
    const sumRows = (items: Row[]) => {
      const unique = new Map<string, Row>();
      for (const row of items) unique.set(row.account_id || `${row.sj_div}:${row.account_nm}`, row);
      const vals = [...unique.values()].map((row) => ({ row, value: expenseAmountOf(row) }));
      return vals.length && vals.every((item) => item.value !== null && Number.isFinite(item.value))
        ? { value: vals.reduce((sum, item) => sum + Math.abs(item.value!), 0), rows: vals }
        : null;
    };
    const sectionComponents = (section: string) => {
      const candidates = rows.filter((row) => {
        if (row.sj_div !== section || /상각누계액|감가상각누계액/.test(normalizedName(row))) return false;
        const id = row.account_id ?? "";
        const isDaTaxonomy = /AdjustmentsForDepreciationExpense|DepreciationExpense|DepreciationOfPropertyPlantAndEquipment|DepreciationOfInvestmentProperty|DepreciationOfRightOfUseAsset/i.test(id) && !/AccumulatedDepreciation|DepreciationAccumulated/i.test(id);
        const isAmortTaxonomy = /AdjustmentsForAmortisationExpense|AdjustmentsForAmortizationExpense|AmortisationExpense|AmortizationExpense|AmortisationOfIntangibleAssets|AmortizationOfIntangibleAssets/i.test(id) && !/AccumulatedAmort/i.test(id);
        return daName.test(row.account_nm ?? "") || isDaTaxonomy || isAmortTaxonomy;
      });
      const names = candidates.map((row) => ({
        row,
        name: normalizedName(row),
        id: row.account_id ?? "",
      }));
      const depreciationSpecific = names.filter(({ name, id }) =>
        /유형자산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*유형자산|사용권자산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*사용권자산|투자부동산.*(?:감가)?상각(?:비)?|(?:감가)?상각(?:비)?.*투자부동산/.test(name) || /AdjustmentsForDepreciationExpense|DepreciationExpense|DepreciationOfPropertyPlantAndEquipment|DepreciationOfInvestmentProperty|DepreciationOfRightOfUseAsset/i.test(id) && !/AccumulatedDepreciation|DepreciationAccumulated/i.test(id)
      ).map(({ row }) => row);
      const depreciationGeneric = names.filter(({ name }) => /^감가상각비$/.test(name)).map(({ row }) => row);
      const amortizationSpecific = names.filter(({ name, id }) =>
        /무형자산.*상각(?:비)?|상각(?:비)?.*무형자산|개발비상각비|소프트웨어상각비/.test(name) || /AdjustmentsForAmortisationExpense|AdjustmentsForAmortizationExpense|AmortisationExpense|AmortizationExpense|AmortisationOfIntangibleAssets|AmortizationOfIntangibleAssets/i.test(id) && !/AccumulatedAmort/i.test(id)
      ).map(({ row }) => row);
      const amortizationGeneric = names.filter(({ name }) => /^(무형자산상각비|무형자산상각|상각비)$/.test(name)).map(({ row }) => row);
      // 상세 계정이 있으면 같은 비용을 포함할 수 있는 포괄 계정 '감가상각비'와 중복 합산하지 않습니다.
      return {
        dep: sumRows(depreciationSpecific.length ? depreciationSpecific : depreciationGeneric),
        amort: sumRows(amortizationSpecific.length ? amortizationSpecific : amortizationGeneric),
      };
    };
    const bySection = statementPriority.map((section) => ({ section, ...sectionComponents(section) }));
    const complete = bySection.find((item) => item.dep && item.amort);
    // 일부 공시는 유형자산 감가상각비와 무형자산 상각비를 다른 표에 제공합니다.
    // 이 경우 각 구성요소를 우선순위가 가장 높은 표에서 각각 1회만 가져옵니다.
    const dep = complete?.dep ?? bySection.find((item) => item.dep)?.dep ?? null;
    const amort = complete?.amort ?? bySection.find((item) => item.amort)?.amort ?? null;
    if (!dep || !amort) {
      return {
        value: Number.NaN, unit: "억원",
        lines: [
          `영업이익 ${won(ov)}`,
          ...(dep?.rows ?? []).map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`),
          ...(amort?.rows ?? []).map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`),
          "공시 본문 미기재 (주석 확인 필요)",
        ],
        formula: "EBITDA = 영업이익 + 유형자산 감가상각비 + 무형자산 상각비",
        disclaimer: `EBITDA는 영업이익 ${won(ov)}에 공시된 감가상각비를 더해 계산합니다. ${!dep ? "유형자산 감가상각비" : "무형자산 상각비"}를 재무제표 본문에서 확인하지 못했습니다. 미공시 항목을 0 또는 CAPEX 비율로 추정하지 않았습니다. 해당 보고서 주석 확인이 필요합니다.`,
        sourceHeading: "현금흐름표·손익계산서 > 감가상각비·상각비",
      };
    }
    const da = dep.value + amort.value;
    const parts = [...dep.rows, ...amort.rows].map((item) => `${item.row.account_nm} ${won(Math.abs(item.value!))}`);
    return {
      value: ov + da, unit: "억원", lines: [`영업이익 ${won(ov)}`, ...parts],
      formula: "EBITDA = 영업이익 + 유형자산 감가상각비 + 무형자산 상각비",
      disclaimer: null, sourceHeading: "손익계산서·현금흐름표 > EBITDA 원천 계정",
    };
  }

  const directLabels:Partial<Record<FinancialMetric,string>>={revenue:"매출액",operatingProfit:"영업이익",netIncome:"순이익",operatingCashFlow:"영업현금흐름",investmentCashFlow:"투자활동현금흐름",financingCashFlow:"재무활동현금흐름"};
  if(directLabels[metric])return pickDirectAccount(rows,period,directLabels[metric]!) ?? (metric==="revenue" ? revenueFromOperatingCosts(rows,period) : null);
  const config = metricConfig[metric];
  const row = metric === "revenue"
    ? findRevenueRow(rows, config.sj, period)
    : metric === "netIncome"
      ? (findRowLike(rows, ["CIS", "IS"], ["반기순손익", "분기순손익", "당기순이익", "당기순이익(손실)", "연결당기순이익"]) ?? findRowLike(rows, config.sj, config.names))
      : findRowLike(rows, config.sj, config.names, period);
  const isFlowStatement = config.sj.some((statement) => ["IS", "CIS", "CF"].includes(statement));
  const value = row ? periodAmount(row, period) : null;
  if (!row || value === null) return null;
  const lines = [`원천 계정: ${row.account_nm}`];
  if (isFlowStatement && period.kind !== "annual" && row.thstrm_add_amount) lines.push(`당기 3개월: ${won(amountOf(row, 0, false) ?? 0)} / 누적: ${won(amountOf(row, 0, true) ?? 0)}`);
  return { value, unit: "억원", lines, formula: null, disclaimer: null, sourceHeading: `${config.sj.includes("CF") ? "현금흐름표" : "손익계산서"} > ${METRIC_LABELS[metric]}` };
}

async function withDartLeaseFallback(args: {
  corp: { name?: string; code?: string; stock?: string };
  rows: Row[];
  period: Period;
  basis: "CFS" | "OFS";
  metric: "borrowings" | "borrowingsRatio";
  picked: PickedMetric | null;
  rceptNo: string;
  requestKey?: string;
}): Promise<{ picked: PickedMetric | null; url: string | null }> {
  const { corp, rows, period, basis, metric, rceptNo, requestKey } = args;
  const picked = args.picked;
  const stockCode = /^\d{6}$/.test(corp.stock ?? "") ? corp.stock! : null;
  const isLeaseRow = (row: Row) => row.sj_div === "BS" && leaseBucket(row) !== null;
  const leaseRows = rows.filter(isLeaseRow);
  const hasLeaseRow = leaseRows.length > 0;
  const hasCurrentLeaseRow = leaseRows.some((row) => {
    const label = (row.account_nm ?? "").replace(/\s/g, "");
    return leaseBucket(row) === "current";
  });
  const hasNoncurrentLeaseRow = leaseRows.some((row) => leaseBucket(row) === "noncurrent");
  const leaseRowHasUsableAmount = (row: Row) => amountOf(row) !== null;
  const hasCurrentLeaseValue = leaseRows.some((row) => {
    const label = (row.account_nm ?? "").replace(/\s/g, "");
    const current = leaseBucket(row) === "current";
    return current && leaseRowHasUsableAmount(row);
  });
  const hasNoncurrentLeaseValue = leaseRows.some((row) => {
    const noncurrent = leaseBucket(row) === "noncurrent";
    return noncurrent && leaseRowHasUsableAmount(row);
  });
  const hasCompleteLeaseRows = hasCurrentLeaseRow && hasNoncurrentLeaseRow;
  const hasCompleteLeaseValues = hasCompleteLeaseRows && hasCurrentLeaseValue && hasNoncurrentLeaseValue;
  const components = grossBorrowingComponents(rows);
  const bodyLeaseTotal = components.items.find(item => item.group === "리스부채");
  const pickedAlreadyIncludesLease = (value: PickedMetric | null) => Boolean(value?.lines.some((line) => /리스부채 포함|리스 포함 총차입금|유동·비유동 리스부채 추가|리스부채 추가/.test(line)));
  // 본문에 유동·비유동 리스부채 금액이 모두 있고, 계산 결과에도 이미 반영된 경우만 조기 반환합니다.
  // 총계행만 사용해 리스가 빠진 경우에는 계속 진행해 구성 계정·주석과 대조합니다.
  if ((hasCompleteLeaseValues || bodyLeaseTotal) && picked && Number.isFinite(picked.value) && pickedAlreadyIncludesLease(picked)) return { picked, url: null };

  let naverDebtPromise: Promise<Awaited<ReturnType<typeof fetchNaverDebtFallback>> | null> | null = null;
  let naverDebt: Awaited<ReturnType<typeof fetchNaverDebtFallback>> | null | undefined;
  const getNaverDebt = async () => {
    // DART 원문 주석에서 먼저 찾고 실패했을 때만 네이버 금융을 요청합니다.
    if (!stockCode) return null;
    if (!naverDebtPromise) naverDebtPromise = fetchNaverDebtFallback({ name: corp.name ?? "", stock: stockCode }, period, basis).catch(() => null);
    if (naverDebt === undefined) naverDebt = await naverDebtPromise;
    return naverDebt;
  };

  const externalTotalFallback = async (urlHint: string | null = null) => {
    // 네이버 금융을 먼저 조회하고, 같은 기간·기준 총차입금이 없을 때만 FnGuide를 보조 사용합니다.
    let externalTotal: { value: number; unit: string; url: string; period?: string; source?: string } | null = null;
    let sourceLabel = "네이버 금융";
    const naver = await getNaverDebt();
    if (naver?.totalBorrowings && Number.isFinite(naver.totalBorrowings.value)) {
      externalTotal = naver.totalBorrowings;
    }
    if (!externalTotal && stockCode) {
      const fn = await fetchFnGuideFallback({ stockCode, period, basis, metric: "borrowings" }).catch(() => null);
      if (fn && Number.isFinite(fn.value)) {
        externalTotal = { value: fn.value, unit: fn.unit, url: fn.url, period: fn.period };
        sourceLabel = "FnGuide";
      }
    }
    if (!externalTotal || !Number.isFinite(externalTotal.value) || externalTotal.value < 0) {
      if (metric === "borrowingsRatio" && naver?.borrowingsRatio && Number.isFinite(naver.borrowingsRatio.value)) {
        return { picked: { value: naver.borrowingsRatio.value, unit: "%", lines: [...(picked?.lines ?? []), `네이버 금융 차입금 의존도: ${naver.borrowingsRatio.value.toFixed(2)}%`, `기간: ${naver.borrowingsRatio.period}`], formula: "네이버 금융이 동일 기간에 표시한 차입금 의존도", disclaimer: "DART 원문 주석에서 리스부채를 명확하게 확인하지 못해 네이버 금융 수치를 보조 표시했습니다. 표시 기준을 확인하세요.", sourceHeading: "네이버 금융 재무정보 > 차입금 의존도" }, url: naver.borrowingsRatio.url };
      }
      return { picked: picked ? { ...picked, disclaimer: "DART 원문 주석에서 리스부채를 확인하지 못했고, 네이버 금융·FnGuide에서도 같은 기간의 총차입금 자료를 확보하지 못했습니다. 확인된 DART 원수치를 임의로 보정하지 않았습니다." } : null, url: urlHint ?? naver?.url ?? null };
    }
    const externalLines = [
      ...(picked?.lines ?? []),
      ...(picked && Number.isFinite(picked.value) ? [`DART 계산값: ${formatMetricValue(picked.value, picked.unit)}`] : []),
      `${sourceLabel} 총차입금 원수치: ${won(externalTotal.value)}`,
      `자료 기간: ${externalTotal.period ?? periodLabel(period)} · 기준: ${basis === "CFS" ? "연결" : "별도"}`,
    ];
    if (metric === "borrowings") return {
      picked: { value: externalTotal.value, unit: "억원", lines: externalLines, formula: `${sourceLabel}가 표시한 동일 기간 총차입금`, disclaimer: `DART 본문과 원문 주석에서 총차입금 구성 범위를 완전히 확인하지 못해 ${sourceLabel} 수치를 보조 표시했습니다.`, sourceHeading: `${sourceLabel} 재무정보 > 총차입금` },
      url: externalTotal.url,
    };
    const resolvedAssets = resolveBalanceTotal(rows, period, "자산총계");
    const assets = resolvedAssets?.value ?? null;
    if (!resolvedAssets || assets === null || !Number.isFinite(assets) || assets <= 0) return { picked: picked ? { ...picked, disclaimer: `${sourceLabel} 총차입금은 확인했지만 DART 자산총계와 부채총계+자본총계 대체 산식을 확인하지 못해 차입금 의존도를 계산하지 않았습니다.` } : null, url: externalTotal.url };
    const ratio = externalTotal.value / assets * 100;
    return { picked: { value: ratio, unit: "%", lines: [...externalLines, ...resolvedAssets.lines, `DART 자산총계${resolvedAssets.derived ? "(부채총계 + 자본총계로 계산)" : ""}: ${won(assets)}`, `차입금 의존도: ${won(externalTotal.value)} ÷ ${won(assets)} × 100 = ${ratio.toFixed(2)}%`], formula: `차입금 의존도 = ${sourceLabel} 총차입금 ÷ DART 자산총계 × 100`, disclaimer: `분자는 ${sourceLabel} 수치, 분모는 DART 자산총계입니다. 외부 자료의 차입금 포함 범위는 원문 주석과 함께 확인해야 합니다.`, sourceHeading: `${sourceLabel} 총차입금 + DART 자산총계` }, url: externalTotal.url };
  };

  // 1순위: 실제 DART 접수번호의 원문 ZIP/XML/HTML 주석에서 같은 보고기간의 리스부채를 추출합니다.
  // 비상장기업도 DART 원문을 내려받을 수 있으므로 종목코드 여부와 관계없이 먼저 확인합니다.
  let leaseCurrent: number | null = null;
  let leaseNoncurrent: number | null = null;
  let leaseTotal: number | null = null;
  let noteBorrowing: ReturnType<typeof parseBorrowingTotalFromDisclosure> = null;
  let leaseSource = "DART 원문 주석";
  let leaseUrl: string | null = /^\d{14}$/.test(rceptNo) ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptNo}` : null;

  // 본문에 유동·비유동 금액이 모두 있으면 그 두 값을 우선 사용합니다.
  // 본문에서 하나라도 빠졌을 때만 DART 원문 ZIP/XML·HTML 주석을 조회합니다.
  const bodyCurrentLease = components.items.find((item) => item.group === "유동리스부채");
  const bodyNoncurrentLease = components.items.find((item) => /비유동리스부채/.test(item.group));
  if (hasCompleteLeaseValues && bodyCurrentLease && bodyNoncurrentLease) {
    leaseCurrent = bodyCurrentLease.value;
    leaseNoncurrent = bodyNoncurrentLease.value;
    leaseTotal = leaseCurrent + leaseNoncurrent;
    leaseSource = "DART 재무상태표 본문";
    leaseUrl = null;
  } else if (bodyLeaseTotal) {
    leaseTotal = bodyLeaseTotal.value;
    leaseSource = "DART 재무상태표 본문";
    leaseUrl = null;
  } else {
    const entries = /^\d{14}$/.test(rceptNo) ? await disclosureEntries(rceptNo, requestKey).catch(() => []) : [];
    noteBorrowing = parseBorrowingTotalFromDisclosure(entries, period, basis);
    const dartLease = parseLeaseLiabilitiesFromDisclosure(entries, period, basis);
    if (dartLease) {
      leaseCurrent = dartLease.current;
      leaseNoncurrent = dartLease.noncurrent;
      leaseTotal = dartLease.total;
      leaseSource = `DART 원문 주석 (${dartLease.sourceFile})`;
    }
  }

  // 2순위: 네이버 금융의 Financial Highlight / 재무 API에서 동일 기간·기준 리스부채를 찾습니다.
  // DART 원문에서 금액을 확정하지 못한 때에만 사용합니다.
  if (leaseTotal === null && stockCode) {
    const naver = await getNaverDebt();
    if (naver?.totalLease !== null && naver?.totalLease !== undefined && Number.isFinite(naver.totalLease)) {
      leaseCurrent = naver.current?.value ?? null;
      leaseNoncurrent = naver.noncurrent?.value ?? null;
      leaseTotal = naver.totalLease;
      leaseSource = "네이버 금융";
      leaseUrl = naver.url ?? leaseUrl;
    }
  }
  // 3순위: 네이버 금융에 같은 기간 행이 없을 때만 FnGuide를 보조 사용합니다.
  if (leaseTotal === null && stockCode) {
    const fnGuideLease = await fetchFnGuideLeaseLiabilities({ stockCode, period, basis }).catch(() => null);
    if (fnGuideLease?.total !== null && fnGuideLease?.total !== undefined && Number.isFinite(fnGuideLease.total)) {
      leaseCurrent = fnGuideLease.current?.value ?? null;
      leaseNoncurrent = fnGuideLease.noncurrent?.value ?? null;
      leaseTotal = fnGuideLease.total;
      leaseSource = "FnGuide";
      leaseUrl = fnGuideLease.url ?? leaseUrl;
    }
  }
  if (leaseTotal === null || !Number.isFinite(leaseTotal) || leaseTotal < 0) return externalTotalFallback(leaseUrl);

  const hasCoreAggregate = rows.some(row=>row.sj_div === "BS" && /^(총차입금|차입금총계|차입금합계|총차입부채|총이자부부채|이자부부채합계|차입금및사채|차입금및회사채|차입금과사채)$/.test((row.account_nm ?? "").replace(/\s/g,"")) && amountOf(row)!==null);
  if(!components.coreComplete && !hasCoreAggregate && !noteBorrowing) return externalTotalFallback(leaseUrl);
  const normalize = (value?: string) => (value ?? "").replace(/[\s·ㆍ]/g, "");
  const aggregateNames = new Set(["총차입금", "차입금총계", "차입금합계", "총차입부채", "총이자부부채", "이자부부채합계", "차입금및사채", "차입금및회사채", "차입금과사채"]);
  const aggregateRow = rows.find((row) => row.sj_div === "BS" && aggregateNames.has(normalize(row.account_nm)));
  const aggregateValue = aggregateRow ? amountOf(aggregateRow) : null;
  const coreItems = components.items.filter((item) => !/리스/.test(item.group) && !/리스부채/.test(item.account));
  const coreTotal = coreItems.reduce((sum, item) => sum + item.value, 0);
  // 1%는 리스부채 자체를 차이로 오인할 수 있을 만큼 큽니다. 합계 대조는 반올림 허용치만 둡니다.
  const tolerance = Math.max(0.5, Math.abs(coreTotal) * 0.0001);
  const near = (a: number | null, b: number) => a !== null && Number.isFinite(a) && Math.abs(a - b) <= tolerance;
  let baseDebt: number | null = null;
  let addLease = true;
  let reconciliationMessage = "";

  if (metric === "borrowings" && hasCompleteLeaseValues && picked && Number.isFinite(picked.value) && pickedAlreadyIncludesLease(picked)) return { picked, url: leaseUrl };
  if (noteBorrowing) {
    baseDebt = noteBorrowing.value;
    addLease = !noteBorrowing.includesLease;
    reconciliationMessage = `DART 원문 ${noteBorrowing.sourceFile}의 '${noteBorrowing.label}' 합계 계정을 사용했습니다.`;
  } else if (aggregateRow && aggregateValue !== null && Number.isFinite(aggregateValue)) {
    if (near(aggregateValue, coreTotal)) {
      baseDebt = aggregateValue;
      addLease = true;
    } else if (near(aggregateValue, coreTotal + leaseTotal)) {
      // 공시 합계가 이미 원문 주석의 리스부채를 포함하면 한 번만 반영합니다.
      baseDebt = aggregateValue;
      addLease = false;
      reconciliationMessage = "DART 총차입금 합계가 구성 계정과 원문 주석의 리스부채 합산값에 일치해 추가 합산하지 않았습니다.";
    } else if (components.coreComplete && coreItems.length > 0 && Number.isFinite(coreTotal)) {
      // 구성 계정 전체가 채워졌으나 합계 행과 다르면, 확인된 구성 계정으로 재산출합니다.
      baseDebt = coreTotal;
      addLease = true;
      reconciliationMessage = `DART 총차입금 합계 행(${won(aggregateValue)})이 구성 계정 합계(${won(coreTotal)})와 일치하지 않아, 확인된 구성 계정 및 리스부채 주석으로 다시 산출했습니다.`;
    } else if (components.coreFound === 0 && /^(?:차입금및사채|차입금및회사채|차입금과사채)$/.test(normalize(aggregateRow.account_nm))) {
      // 구성 계정이 별도로 없는 공시의 '차입금및사채'는 명칭 범위에 맞춰 비리스 차입성 부채 기준값으로 사용하고,
      // 별도 주석에서 확인한 리스부채를 더합니다. 계산식에 출처 행을 그대로 남깁니다.
      baseDebt = aggregateValue;
      addLease = true;
      reconciliationMessage = `DART 공시 '${aggregateRow.account_nm}' 행을 차입금·사채 기준값으로 사용하고, 별도 주석에서 확인한 리스부채를 더했습니다.`;
    } else {
      return { picked: picked ? { ...picked, disclaimer: "DART의 총차입금 합계와 구성 계정이 일치하지 않아 리스부채를 임의로 더하지 않았습니다. 원문 주석과 계정 범위를 추가 확인해야 합니다." } : null, url: leaseUrl };
    }
  } else {
    // 본문에 유동/비유동 리스부채 중 일부만 있으면 그 값을 포함한 rawDebt에 전체 리스부채를 더해 중복 계산하지 않습니다.
    // 확인된 비리스 차입금 구성 계정이 완전한 경우 그 합계를 기준으로 원문 주석의 전체 리스부채를 한 번만 추가합니다.
    if (hasLeaseRow) {
      // 리스 행이 일부만 본문에 있는 상황에서 pickMetric(rows) 값을 쓰면
      // 확인된 리스 한쪽 금액을 전체 리스부채에 다시 더해 중복 계산할 수 있습니다.
      // 따라서 리스 행을 제외한 구성 계정/합계만으로 기준 차입금을 구성합니다.
      const nonLeaseRows = rows.filter((row) => !isLeaseRow(row));
      const nonLeaseComponents = grossBorrowingComponents(nonLeaseRows);
      if (nonLeaseComponents.coreComplete && nonLeaseComponents.items.length > 0 && Number.isFinite(nonLeaseComponents.total)) {
        baseDebt = nonLeaseComponents.total;
      } else {
        const nonLeaseRawDebt = pickMetric(nonLeaseRows, period, "borrowings");
        if (nonLeaseRawDebt && Number.isFinite(nonLeaseRawDebt.value)) baseDebt = nonLeaseRawDebt.value;
      }
    } else {
      const rawDebt = pickMetric(rows, period, "borrowings");
      if (rawDebt && Number.isFinite(rawDebt.value)) baseDebt = rawDebt.value;
      else if (components.coreComplete && coreItems.length > 0 && Number.isFinite(coreTotal)) baseDebt = coreTotal;
    }
  }
  if (baseDebt === null || !Number.isFinite(baseDebt) || baseDebt < 0) return externalTotalFallback(leaseUrl);
  const correctedDebt = baseDebt + (addLease ? leaseTotal : 0);
  // 이 프로젝트의 차입금 의존도 기준은 리스부채를 포함한 총차입성 부채 ÷ 자산총계입니다.
  // 리스부채 포함 합계를 별도로 표시하면서 비율에서는 제외하던 이전 로직을 일치시킵니다.
  const ratioDebt = correctedDebt;
  const lines = [
    ...(picked?.lines ?? []),
    `DART 원문 주석 유동 리스부채: ${leaseCurrent === null ? "별도 행 미확인" : won(leaseCurrent)}`,
    `DART 원문 주석 비유동 리스부채: ${leaseNoncurrent === null ? "별도 행 미확인" : won(leaseNoncurrent)}`,
    `${leaseSource} 리스부채 합계: ${won(leaseTotal)}`,
    reconciliationMessage,
    addLease ? `총차입금(리스 포함 참고값): ${won(baseDebt)} + ${won(leaseTotal)} = ${won(correctedDebt)}` : `총차입금(리스 포함 참고값): ${won(correctedDebt)} (리스부채 이미 포함)`,
  ].filter(Boolean);
  const detailFormula = addLease
    ? `총차입금(리스 포함) = 비리스 차입금·사채 ${won(baseDebt)} + 리스부채 ${won(leaseTotal)} = ${won(correctedDebt)}`
    : `총차입금(리스 포함) = 공시 합계 ${won(baseDebt)} (리스부채 ${won(leaseTotal)} 포함 확인)`;
  if (metric === "borrowings") return {
    picked: { value: correctedDebt, unit: "억원", lines, formula: detailFormula, disclaimer: reconciliationMessage || null, sourceHeading: `${leaseSource} + DART 재무상태표 구성 계정` }, url: leaseUrl,
  };
  const resolvedAssets = resolveBalanceTotal(rows, period, "자산총계");
  const assets = resolvedAssets?.value ?? null;
  if (!resolvedAssets || assets === null || !Number.isFinite(assets) || assets <= 0) return { picked: picked ? { ...picked, disclaimer: "리스부채는 확인했지만 DART 자산총계와 부채총계+자본총계 대체 산식을 확인하지 못해 차입금 의존도를 계산하지 않았습니다." } : null, url: leaseUrl };
  const ratio = ratioDebt / assets * 100;
  const leaseInclusionNote = `리스부채 ${won(leaseTotal)}은 총차입성 부채 분자에 포함했습니다.`;
  return {
    picked: { value: ratio, unit: "%", lines: [...lines, `차입금 의존도 계산용 총차입성 부채(리스 포함): ${won(ratioDebt)}`, leaseInclusionNote, ...resolvedAssets.lines, `DART 자산총계${resolvedAssets.derived ? "(부채총계 + 자본총계로 계산)" : ""}: ${won(assets)}`, `차입금 의존도: ${won(ratioDebt)} ÷ ${won(assets)} × 100 = ${ratio.toFixed(2)}%`], formula: `차입금 의존도 = 총차입성 부채(리스 포함) ${won(ratioDebt)} ÷ 자산총계 ${won(assets)} × 100 = ${ratio.toFixed(2)}%`, disclaimer: leaseInclusionNote, sourceHeading: `${leaseSource} 리스부채 포함 + DART 재무상태표·자산총계` }, url: leaseUrl,
  };
}

async function resolvePeriod(corp: { code: string }, candidates: Period[], fs: "CFS" | "OFS", force = false, requestKey?: string) {
  for (const period of candidates) {
    const primary = await statements(corp.code, period.year, period.code, fs, force, requestKey);
    if (primary) return { period, rows: primary, fs };

  }
  return null;
}

export async function validateDartKey(requestKey?: string) {
  if (!requestKey || !/^[A-Za-z0-9]{40}$/.test(requestKey.trim()) || /^(DEMO|VERIFIED)/i.test(requestKey.trim())) {
    return { valid: false as const, companyCount: 0, message: "실제 40자리 OpenDART 인증키를 입력하세요." };
  }
  try {
    const map = await corps(true, requestKey);
    if (!map.size) return { valid: false as const, companyCount: 0, message: "DART 기업목록을 받지 못했습니다. 인증키를 확인하세요." };
    return { valid: true as const, companyCount: map.size, message: "OpenDART 인증키 검증 성공" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenDART 인증키 검증 실패";
    return { valid: false as const, companyCount: 0, message: `인증키 검증 실패: ${message}` };
  }
}

function stripMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|tr|td|th|li|h[1-6]|table|section|article|title)>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/[\t\u00a0]+/g, " ")
    .split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

async function disclosureEntries(rceptNo: string, requestKey?: string): Promise<Array<{ name: string; text: string }>> {
  const cached = documentEntriesCache.get(rceptNo);
  if (cached && Date.now() - cached.at < (cached.entries.length ? 24 * 3600_000 : 60_000)) return cached.entries;
  let response: Response;
  try {
    response = await dartFetch(`${BASE}/document.xml?crtfc_key=${encodeURIComponent(key(requestKey))}&rcept_no=${encodeURIComponent(rceptNo)}`, {}, 10_000);
  } catch {
    documentEntriesCache.set(rceptNo, { at: Date.now(), entries: [] });
    return [];
  }
  if (!response.ok) {
    // 일시 실패가 반복될 때 매 화면 갱신마다 10초씩 대기하지 않도록 짧게 음성 캐시합니다.
    documentEntriesCache.set(rceptNo, { at: Date.now(), entries: [] });
    return [];
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const entries = unzipAll(bytes).filter((entry) => /\.(xml|html?|xhtml)$/i.test(entry.name));
  documentEntriesCache.set(rceptNo, { at: Date.now(), entries });
  return entries;
}

async function disclosureText(rceptNo: string, requestKey?: string): Promise<string> {
  const cached = documentCache.get(rceptNo);
  if (cached && Date.now() - cached.at < 24 * 3600_000) return cached.text;
  const entries = await disclosureEntries(rceptNo, requestKey);
  const text = entries.map((entry) => `\n[문서 ${entry.name}]\n${stripMarkup(entry.text)}`).join("\n");
  documentCache.set(rceptNo, { at: Date.now(), text });
  return text;
}

/**
 * 본문 API에 감가상각·무형자산상각 계정이 없을 때 공시 원문 첨부의 표를 확인합니다.
 * 당기/누계 열과 표 단위가 확인되는 동일 표 안에서 합계 계정 또는 감가상각+무형자산상각을
 * 모두 찾은 경우에만 결과를 반환합니다. 열·단위가 모호하거나 서로 다른 표의 값만 존재하면 추정하지 않습니다.
 */
async function depreciationFromDisclosure(rceptNo: string, period: Period, requestKey?: string, basis?:"CFS"|"OFS"): Promise<{ value: number; lines: string[] } | null> {
  const entries = await disclosureEntries(rceptNo, requestKey).catch(() => []);
  const parsed = parseDepreciationFromDisclosure(entries, period, basis);
  return parsed ? { value: parsed.value, lines: parsed.lines } : null;
}

/**
 * 홈·질문하기·연도별 조회·비교분석이 같은 지표 계산 경로를 사용하도록 하는 표준 추출기.
 * 총차입금/의존도는 DART 원문 주석의 리스부채 보정을 적용하고, EBITDA 본문 값이 없을 때는
 * 같은 접수번호의 주석에서 상각비를 확인해 계산합니다. 미확인 값을 0으로 대체하지 않습니다.
 */
function missingMetricReason(rows:Row[], metric:FinancialMetric):string {
  const required=metric==="operatingMargin" ? ["매출액","영업이익"] : metric==="netMargin" ? ["매출액","당기순이익"] : [METRIC_LABELS[metric]];
  const note=rows.find(row=>row.recovery_note)?.recovery_note;
  return `${required.join("·")}의 같은 기간 원천 계정/유효 금액을 확인하지 못했습니다. 회사가 공시하지 않았다는 뜻은 아닙니다.${note ? " "+note : ""}`;
}

async function pickMetricWithOriginalFallback(args: {
  corp: Corp & { name: string };
  rows: Row[];
  period: Period;
  basis: "CFS" | "OFS";
  metric: FinancialMetric;
  requestKey?: string;
}): Promise<{ picked: PickedMetric | null; url: string | null }> {
  const { corp, rows, period, basis, metric, requestKey } = args;
  let picked = pickMetric(rows, period, metric);
  let url: string | null = null;
  const rceptNo = rows.find((row) => row.rcept_no)?.rcept_no ?? "";

  if (metric === "revenue" && (!picked || !Number.isFinite(picked.value)) && /^\d{14}$/.test(rceptNo)) {
    const entries=await disclosureEntries(rceptNo,requestKey).catch(()=>[]);
    const revenue=parseRevenueFromDisclosure(entries,period,basis);
    if (revenue) picked={value:revenue.value,unit:"억원",formula:null,lines:[`DART 원문 계정: ${revenue.label}`,`공시 파일: ${revenue.sourceFile}`,`동일 보고기간 영업수익 ${won(revenue.value)}`],disclaimer:null,sourceHeading:`DART 원문 손익계산서 > ${revenue.label}`};
  }

  if ((metric === "operatingMargin" || metric === "netMargin") && (!picked || !Number.isFinite(picked.value)) && !pickDirectAccount(rows,period,"매출액")) {
    const revenue=await pickMetricWithOriginalFallback({...args,metric:"revenue"});
    const profit=pickMetric(rows,period,metric==="operatingMargin"?"operatingProfit":"netIncome");
    if (revenue.picked && Number.isFinite(revenue.picked.value) && revenue.picked.value!==0 && profit && Number.isFinite(profit.value)) {
      const name=metric==="operatingMargin"?"영업이익":"순이익";
      picked={value:profit.value/revenue.picked.value*100,unit:"%",formula:`${name}률 = ${name} ÷ 영업수익(매출액) × 100`,lines:[...profit.lines,...revenue.picked.lines],disclaimer:null,sourceHeading:"같은 공시 손익계산서 > 이익·영업수익"};
    }
  }

  if (metric === "borrowings" || metric === "borrowingsRatio") {
    const corrected = await withDartLeaseFallback({ corp, rows, period, basis, metric, picked, rceptNo, requestKey });
    picked = corrected.picked ?? picked;
    url = corrected.url;
  }

  if (metric === "ebitda" && (!picked || !Number.isFinite(picked.value))) {
    const operatingProfit = pickMetric(rows, period, "operatingProfit");
    if (operatingProfit && Number.isFinite(operatingProfit.value) && /^\d{14}$/.test(rceptNo)) {
      const depreciation = await depreciationFromDisclosure(rceptNo, period, requestKey,basis);
      if (depreciation && Number.isFinite(depreciation.value)) {
        const value = operatingProfit.value + depreciation.value;
        picked = {
          value,
          unit: "억원",
          lines: [`영업이익 ${won(operatingProfit.value)}`, ...depreciation.lines, `EBITDA ${won(value)}`],
          formula: `EBITDA = 영업이익 ${won(operatingProfit.value)} + DART 원문 주석 감가상각·상각비 ${won(depreciation.value)} = ${won(value)}`,
          disclaimer: null,
          sourceHeading: "DART 원문 주석 > 감가상각·상각비",
        };
      }
    }
  }

  return { picked, url };
}

function findCauseEvidence(text: string, metric: FinancialMetric): Array<{ section: string; excerpt: string; explicitCause: boolean }> {
  const metricTerms: Record<FinancialMetric, RegExp> = {
    revenue: /매출|수익|판매량|판매단가|판매가격|제품별|지역별|수주|물량|환율/,
    operatingProfit: /영업이익|영업손익|매출원가|판매비와관리비|판관비|원재료|제품믹스|가동률|고정비/,
    netIncome: /당기순이익|순이익|법인세|금융원가|이자비용|환차손익|지분법손익|처분손익/,
    operatingMargin: /영업이익률|영업이익|매출원가|판관비|원재료/,
    netMargin: /순이익률|당기순이익|법인세|금융원가/,
    operatingCashFlow: /영업활동현금흐름|매출채권|재고자산|매입채무|운전자본/,
    investmentCashFlow: /투자활동현금흐름|유형자산의취득|설비투자|투자자산/,
    financingCashFlow: /재무활동현금흐름|차입금|사채|유상증자|배당금지급/,
    capex: /유형자산의취득|설비투자|자본적지출|생산설비/,
    freeCashFlow: /영업활동현금흐름|유형자산의취득|설비투자/,
    netDebt: /차입금|사채|현금및현금성자산|유동성장기부채/,
    borrowings: /차입금|사채|차입 계약|신규 차입|상환/,
    borrowingsRatio: /차입금|사채|자산총계|재무구조/,
    workingCapital: /매출채권|재고자산|매입채무|운전자본/,
    payables: /매입채무|매입채무및기타채무|유동매입채무/,
    debtRatio: /부채비율|부채총계|자본총계|차입금/,
    currentRatio: /유동비율|유동자산|유동부채/,
    interestCoverage: /이자보상배율|영업이익|이자비용|금융원가/,
    roe: /자기자본이익률|ROE|당기순이익|자본총계/,
    roa: /총자산이익률|ROA|당기순이익|자산총계/,
    eps: /주당순이익|주당순손익|EPS/,
    ebitda: /EBITDA|감가상각비|무형자산상각비|영업이익/,
    per: /주가수익비율|PER/,
    pbr: /주가순자산비율|PBR/,
  };
  const sentences = text.split(/(?<=[.。!?！？])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 30 && s.length <= 900);
  const cause = /증가|감소|상승|하락|확대|축소|기인|영향|따라|때문|원인|이유|주요 요인|개선|악화|반영|전년|전기|주요 제품|판매량|판매단가|원재료|환율|수주|가동률|제품믹스|판관비|매출원가|일회성/;
  const score = (sentence: string) => Number(metricTerms[metric].test(sentence)) * 2 + Number(cause.test(sentence)) + Number(/증가.*(?:기인|때문|영향|따라)|감소.*(?:기인|때문|영향|따라)|(?:주요|주된) 원인|에 기인/.test(sentence)) * 2;
  const ranked = sentences.map((excerpt) => ({ excerpt, score: score(excerpt), explicitCause: /(?:증가|감소|상승|하락|확대|축소|개선|악화).{0,70}(?:기인|때문|영향을?\s*(?:미쳤|받았|주었|줬)|따라|결과)|(?:주요|주된)?\s*(?:원인|이유|요인).{0,70}(?:증가|감소|상승|하락|확대|축소|개선|악화)|에 기인|의 영향으로/.test(excerpt) }))
    .filter((item) => item.score >= 3).sort((a, b) => b.score - a.score || b.excerpt.length - a.excerpt.length);
  const unique = [...new Map(ranked.map((item) => [item.excerpt, item])).values()].slice(0, 8);
  return unique.map((item) => ({ section: /매출|판매|수주/.test(item.excerpt) ? "매출·영업활동 관련 본문" : /원가|비용|감가|이자/.test(item.excerpt) ? "비용·손익 관련 본문" : "사업내용·재무 관련 본문", excerpt: item.excerpt, explicitCause: item.explicitCause }));
}

async function analyzeDisclosureCause(input: { corpCode: string; corpName: string; currentRcept: string; previousRcept: string; currentYear: number; previousYear: number; metric: FinancialMetric; currentPeriod: string; previousPeriod: string }, requestKey?: string) {
  // 실적 비교 공시뿐 아니라 비교 연도에 가장 가까운 실제 사업보고서 본문도 함께 검색합니다.
  // 사업보고서의 접수번호는 공시검색 API(list.json)에서 확인된 값만 사용합니다.
  const annualYears = [...new Set([input.currentYear - 1, input.previousYear - 1].filter((year) => year >= 2000))];
  const annualFilings = await Promise.all(annualYears.map(async (year) => ({
    year,
    filing: await filingForPeriod(input.corpCode, year, "11011", requestKey).catch(() => null),
  })));
  const sources: Array<{ label: string; rceptNo: string }> = [
    { label: input.currentPeriod, rceptNo: input.currentRcept },
    { label: input.previousPeriod, rceptNo: input.previousRcept },
    ...annualFilings.filter((item) => item.filing?.rceptNo).map((item) => ({ label: `${item.year}년 사업보고서`, rceptNo: item.filing!.rceptNo })),
  ];
  const uniqueSources = [...new Map(sources.filter((s) => /^\d{14}$/.test(s.rceptNo)).map((s) => [s.rceptNo, s])).values()];
  const docs = await Promise.all(uniqueSources.map(async (source) => ({
    ...source,
    text: await disclosureText(source.rceptNo, requestKey).catch(() => ""),
  })));
  const candidates = docs.flatMap((doc) => findCauseEvidence(doc.text, input.metric).map((e) => ({ ...e, reportPeriod: doc.label, rceptNo: doc.rceptNo })));
  const evidence = [...new Map(candidates.map((item) => [`${item.rceptNo}-${item.excerpt}`, item])).values()].slice(0, 8);
  const explicit = evidence.filter((item) => item.explicitCause).length;
  return {
    status: explicit ? "explicit-evidence" as const : evidence.length ? "related-context-only" as const : "not-found" as const,
    summary: explicit
      ? "공시 본문에서 증감 원인을 직접 설명하는 문장을 찾았습니다. 아래 원문 문장을 근거로 확인하세요."
      : evidence.length
        ? "관련 사업·비용 설명 문장은 찾았지만, 해당 실적 증감의 직접 원인이라고 명시된 문장은 확인되지 않았습니다. 공시로 인과관계를 특정할 수 없습니다."
        : "접근 가능한 사업보고서 본문에서 해당 실적 증감의 직접 원인을 입증할 문장을 찾지 못했습니다. 공시로 특정되지 않습니다. 주석 및 첨부자료를 직접 확인하세요.",
    evidence,
    note: "문장 검색은 공시 원문 안의 근거 후보를 제시하는 기능입니다. 원문에 인과관계가 명시되지 않은 경우 에이전트가 원인을 추측하거나 사실로 단정하지 않습니다.",
  };
}


export async function buildDartSectionDeepLink(rceptNo: string, requestedSection: "CFS" | "OFS", requestKey?: string, statement: "BS" | "IS" | "CF" = "BS") {
  if (!/^\d{14}$/.test(rceptNo)) throw new TRPCError({ code: "BAD_REQUEST", message: "실제 14자리 DART 접수번호가 필요합니다." });
  const cacheKey = `${rceptNo}:${requestedSection}:${statement}`;
  const cachedLink = deepLinkCache.get(cacheKey);
  if (cachedLink && Date.now() - cachedLink.at < 24 * 3600_000) return cachedLink.value;
  const mainUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://dart.fss.or.kr/",
  };

  try {
    const response = await dartFetch(mainUrl, { headers, redirect: "follow" }, 8_000);
    if (!response.ok) return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: `DART 원문 목차 조회 실패: HTTP ${response.status}. 세부 본문 링크 대신 공식 공시 목차를 제공합니다.` };
    const mainHtml = await readDartHtml(response);
    const direct = parseViewerDeepLinkHtml(mainHtml, rceptNo, requestedSection, statement);
    if (direct.deepLinked) {
      // DART main.do 원문 스크립트 안에서 요청한 재무제표 제목과 실제 viewDoc(rcpNo,dcmNo,eleId,...) 호출을 함께 추출했습니다.
      // 서버측 재요청이 보안장비·리다이렉트에 막힐 수 있으므로, 이 실데이터 링크를 추가 HTTP probe가 실패했다는 이유만으로 버리지 않습니다.
      const verified = { ...direct, message: (("note" in direct && direct.note) ? `${direct.note} ` : "") + `DART 원문 목차에서 실제 ${direct.sectionTitle} 항목과 본문 매개변수를 추출했습니다.` };
      deepLinkCache.set(cacheKey, { at: Date.now(), value: verified });
      return verified;
    }

    // 응답이 프레임/초기 뷰어만 포함하는 DART 문서 유형이면, 진짜 뷰어 페이지를 한 번 더 받아
    // 그 안의 문서 트리를 읽습니다. 어느 단계에서도 dsaf001/main.do를 최종 목적지로 쓰지 않습니다.
    const initial = extractInitialViewerArgs(mainHtml, rceptNo);
    if (initial) {
      const initialUrl = new URL("https://dart.fss.or.kr/report/viewer.do");
      Object.entries(initial).forEach(([name, value]) => initialUrl.searchParams.set(name, value));
      const viewerResponse = await dartFetch(initialUrl.toString(), { headers: { ...headers, "Referer": mainUrl }, redirect: "follow" }, 8_000);
      if (viewerResponse.ok) {
        const viewerHtml = await readDartHtml(viewerResponse);
        const secondary = parseViewerDeepLinkHtml(viewerHtml, rceptNo, requestedSection, statement);
        if (secondary.deepLinked) {
          const verified = { ...secondary, message: (("note" in secondary && secondary.note) ? `${secondary.note} ` : "") + `DART 뷰어 목차에서 실제 ${secondary.sectionTitle} 항목과 본문 매개변수를 추출했습니다.` };
          deepLinkCache.set(cacheKey, { at: Date.now(), value: verified });
          return verified;
        }
      }
    }
    const targetTitle = `${requestedSection === "CFS" ? "연결" : "별도"} ${statement === "BS" ? "재무상태표" : statement === "IS" ? "손익계산서" : "현금흐름표"}`;
    const hasDocCall = /viewDoc\s*\(/i.test(mainHtml);
    return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: hasDocCall
      ? `DART HTML에서 '${targetTitle}' 세부 본문 위치를 찾지 못해 공식 공시 목차를 제공합니다. 목차에서 재무제표를 선택하세요.`
      : `DART 공시 HTML에서 '${targetTitle}' 링크를 찾지 못해 공식 공시 목차를 제공합니다. 목차에서 재무제표를 선택하세요.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "네트워크 오류";
    return { url: mainUrl, deepLinked: false, sectionTitle: "DART 공시 목차", fallback: true, message: `DART 뷰어 목차 조회 실패: ${detail}. 공식 공시 목차를 제공합니다.` };
  }
}

type HistoryReportKey = "q1" | "half" | "q3" | "annual";
const HISTORY_REPORTS: Array<{ key: HistoryReportKey; code: string; kind: HistoryReportKey }> = [
  { key: "q1", code: "11013", kind: "q1" },
  { key: "half", code: "11012", kind: "half" },
  { key: "q3", code: "11014", kind: "q3" },
  { key: "annual", code: "11011", kind: "annual" },
];

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function historyReportIsDue(year: number, key: HistoryReportKey, now = new Date()): boolean {
  // 정기보고서의 통상 제출기한 이전에는 해당 연도의 미공시 분기를 반복 조회하지 않습니다.
  const month = now.getMonth() + 1;
  if (key === "annual") return year < now.getFullYear();
  if (year < now.getFullYear()) return true;
  if (year > now.getFullYear()) return false;
  if (key === "q1") return month >= 5;
  if (key === "half") return month >= 8;
  if (key === "q3") return month >= 11;
  return false;
}

async function loadHistoryRows(corp: { code: string }, basis: "CFS" | "OFS", requestKey?: string, startYear = new Date().getFullYear()-2, endYear = new Date().getFullYear()) {
  const currentYear = Math.min(endYear,new Date().getFullYear());
  const failures: string[] = [];
  const published = await latestPublishedPeriods(corp.code,requestKey).catch(()=>[]);
  const jobs: Array<{ year: number; key: HistoryReportKey; code: string }> = [];
  for (let year = Math.max(2015,startYear); year <= currentYear; year++) {
    for (const report of HISTORY_REPORTS) {
      if (historyReportIsDue(year, report.key) || published.some(p=>p.year===year && p.kind===report.kind)) jobs.push({ year, key: report.key, code: report.code });
    }
  }
  const loaded = await mapWithConcurrency(jobs, 5, async (job) => {
    try {
      const rows = await statements(corp.code, job.year, job.code, basis, false, requestKey);
      if (!rows?.length) failures.push(`${job.year} ${job.key}: 해당 기준 공시가 없거나 원천 계정이 반환되지 않음`);
      return { ...job, rows };
    } catch (error) {
      // 해당 보고서의 오류만 기록하고 나머지 기간은 계속 수집합니다.
      const detail = error instanceof Error ? error.message : "DART 조회 오류";
      failures.push(`${job.year} ${job.key}: ${detail}`);
      return { ...job, rows: null };
    }
  });
  const yearRows = new Map<number, Record<HistoryReportKey, Row[] | null>>();
  for (let year = Math.max(2015,startYear); year <= currentYear; year++) {
    yearRows.set(year, { q1: null, half: null, q3: null, annual: null });
  }
  for (const item of loaded) yearRows.get(item.year)![item.key] = item.rows;
  return { rows: yearRows, failures };
}

function historyValues(rows: Row[] | null, year: number, kind: HistoryReportKey) {
  if (!rows) return null;
  const period = P(year, kind, "cum");
  const pair=pairedIncome(rows,period,metricConfig.operatingProfit.names);
  if(!pair)return null;
  const revenue = pair.rev;
  const operatingProfit = pair.value;
  const netIncome = pickMetric(rows.filter(row=>row.sj_div===pair.revenue.sj_div), period, "netIncome")?.value;
  return Number.isFinite(revenue) && Number.isFinite(operatingProfit)
    ? { revenue: revenue!, operatingProfit: operatingProfit!, ...(Number.isFinite(netIncome) ? { netIncome: netIncome! } : {}) }
    : null;
}

function pointsFromHistoryRows(yearRows: Map<number, Record<HistoryReportKey, Row[] | null>>, basis: "CFS" | "OFS") {
  const points: Array<{ period: string; rceptNo?: string; basisCode: "CFS" | "OFS"; revenue: number; operatingProfit: number; netIncome?: number; isFourthQuarterDerived?: boolean }> = [];
  for (const [year, rows] of yearRows) {
    const q1 = historyValues(rows.q1, year, "q1");
    const half = historyValues(rows.half, year, "half");
    const q3 = historyValues(rows.q3, year, "q3");
    const annual = historyValues(rows.annual, year, "annual");
    const add = (quarter: "1Q" | "2Q" | "3Q" | "4Q", value: ReturnType<typeof historyValues>, sub?: NonNullable<ReturnType<typeof historyValues>>, fourth = false) => {
      if (!value) return;
      const calculated = {
        revenue: sub ? value.revenue - sub.revenue : value.revenue,
        operatingProfit: sub ? value.operatingProfit - sub.operatingProfit : value.operatingProfit,
        ...(Number.isFinite(value.netIncome) && (!sub || Number.isFinite(sub.netIncome)) ? { netIncome: sub ? value.netIncome! - sub.netIncome! : value.netIncome! } : {}),
      };
      if (![calculated.revenue, calculated.operatingProfit].every(Number.isFinite)) return;
      const rowSet = quarter === "1Q" ? rows.q1 : quarter === "2Q" ? rows.half : quarter === "3Q" ? rows.q3 : rows.annual;
      points.push({ period: `${quarter}${String(year).slice(2)}`, rceptNo: rowSet?.find((row) => row.rcept_no)?.rcept_no, basisCode: basis, ...calculated, ...(fourth ? { isFourthQuarterDerived: true } : {}) });
    };
    add("1Q", q1);
    if (half && q1) add("2Q", half, q1);
    if (q3 && half) add("3Q", q3, half);
    if (annual && q3) add("4Q", annual, q3, true);
  }
  return points;
}

async function quarterlyHistory(corp: { code: string }, preferredFs: "CFS" | "OFS", requestKey?: string, startYear = new Date().getFullYear()-2, endYear = new Date().getFullYear()) {
  if (preferredFs === "OFS") {
    const loaded = await loadHistoryRows(corp, "OFS", requestKey,startYear,endYear);
    return historyResponseShape(pointsFromHistoryRows(loaded.rows, "OFS"), loaded.failures);
  }

  const loaded=await loadHistoryRows(corp,preferredFs,requestKey,startYear,endYear);
  return historyResponseShape(pointsFromHistoryRows(loaded.rows,preferredFs),loaded.failures);
}

/** 분기 시계열은 기본 스냅샷과 독립적으로 조회·캐시하여 차트가 화면 로딩을 무기한 막지 않도록 합니다. */
export async function historyDart(companyName: string, requestKey?: string, basis: "CFS" | "OFS" = "CFS", startYear = new Date().getFullYear()-2, endYear = new Date().getFullYear()) {
  if(startYear>endYear || endYear-startYear>2)throw new TRPCError({code:"BAD_REQUEST",message:"분기 이력은 요청당 최대 3개년씩 조회해 주세요."});
  const map = await corps(false, requestKey);
  const corp = findCorp(companyName, map);
  if (!corp) throw new TRPCError({ code: "NOT_FOUND", message: `DART 기업목록에서 찾지 못했습니다: ${companyName}` });
  const cacheKey = `${corp.code}:${basis}:${startYear}:${endYear}:${createHash("sha256").update(key(requestKey)).digest("hex")}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60_000) return {
    found: true as const, company: corp.name, corpCode: corp.code,
    basisCode: cached.value.points[0]?.basisCode ?? basis, quarterlyHistory: cached.value.points, failures:cached.value.failures,
    count: cached.value.points.length, message: cached.value.points.length
      ? `실제 공시로 분기 ${cached.value.points.length}개를 구성했습니다.`
      : cached.value.failures.length ? `분기 조회 실패: ${cached.value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
  };
  const pending = historyInFlight.get(cacheKey);
  if (pending) {
    const value = await pending;
    return {
      found: true as const, company: corp.name, corpCode: corp.code,
      basisCode: value.points[0]?.basisCode ?? basis, quarterlyHistory: value.points,failures:value.failures,
      count: value.points.length, message: value.points.length
        ? `실제 공시로 분기 ${value.points.length}개를 구성했습니다.`
        : value.failures.length ? `분기 조회 실패: ${value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
    };
  }
  const request = quarterlyHistory(corp, basis, requestKey, startYear, endYear);
  historyInFlight.set(cacheKey, request);
  try {
    const value = await request;
    if (value.points.length) historyCache.set(cacheKey, { at: Date.now(), value });
    return {
      found: true as const, company: corp.name, corpCode: corp.code,
      basisCode: value.points[0]?.basisCode ?? basis, quarterlyHistory: value.points,failures:value.failures,
      count: value.points.length, message: value.points.length
        ? `실제 공시로 분기 ${value.points.length}개를 구성했습니다.`
        : value.failures.length ? `분기 조회 실패: ${value.failures.slice(0, 3).join(" / ")}` : "조회 가능한 실제 분기 공시에서 매출·영업이익 계정을 확인하지 못했습니다.",
    };
  } finally {
    if (historyInFlight.get(cacheKey) === request) historyInFlight.delete(cacheKey);
  }
}

export async function clearDartCaches() {
  latestPeriodsCache.clear();
  recentCache.clear();
  corpCache = null;
  stmtCache.clear();
  filingCache.clear();
  documentCache.clear();
  documentEntriesCache.clear();
  historyCache.clear();
  deepLinkCache.clear();
  clearCrossValidationCache();
  return { ok: true as const, refreshedAt: new Date().toISOString() };
}

export async function searchDartCompanies(query: string, limit = 12, requestKey?: string) {
  const map = await corps(false, requestKey);
  return searchCorps(query, map, limit);
}

/** 등록 기업의 신규 공시 확인. DART list.json의 실제 접수번호만 반환합니다. */
export async function recentFilingsDart(companyNames: string[], fromDate: string, requestKey?: string, requestedEndDate?: string) {
  if (!/^\d{8}$/.test(fromDate)) throw new TRPCError({ code: "BAD_REQUEST", message: "조회 시작일은 YYYYMMDD 형식이어야 합니다." });
  const endDate = requestedEndDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replace(/-/g, "");
  const map = await corps(false, requestKey);
  const names = [...new Set(companyNames.map((name) => name.trim()).filter(Boolean))];
  if(names.length>20)throw new TRPCError({code:"BAD_REQUEST",message:"관심기업은 최대 20개까지 가능합니다."});
  const results = await mapWithConcurrency(names, 3, async (requested) => {
    const corp=findCorp(requested,map);
    if(!corp)return {rows:[],warning:`${requested}: DART 기업코드 미확인`} as RecentResult;
    const cacheId=`${createHash("sha256").update(key(requestKey)).digest("hex")}:${corp.code}:${fromDate}:${endDate}`;
    const cached=recentCache.get(cacheId);
    if(cached && Date.now()-cached.at<15_000)return cached.value;
    const pending=recentInFlight.get(cacheId);if(pending)return pending;
    const load=async():Promise<RecentResult>=>{
      try{
        const list=await filingPages(corp.code,fromDate,endDate,requestKey);
        const rows=[...new Map(list.filter(item=>/^\d{14}$/.test(item.rcept_no ?? "") && item.rcept_dt>=fromDate && item.rcept_dt<=endDate).map(item=>[item.rcept_no,{company:corp.name,reportName:item.report_nm,receiptDate:item.rcept_dt,rceptNo:item.rcept_no,url:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`}])).values()];
        return {rows,warning:null};
      }catch(error){return {rows:[],warning:`${corp.name}: ${error instanceof Error ? error.message : "조회 실패"}`};}
    };
    const request=load();recentInFlight.set(cacheId,request);
    try{const value=await request;if(!value.warning){if(recentCache.size>=256)recentCache.delete(recentCache.keys().next().value!);recentCache.set(cacheId,{at:Date.now(),value});}return value;}
    finally{if(recentInFlight.get(cacheId)===request)recentInFlight.delete(cacheId);}
  });

  return {
    rows: results.flatMap((result) => result.rows).sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.rceptNo.localeCompare(a.rceptNo)),
    warnings: results.map((result) => result.warning).filter((warning): warning is string => Boolean(warning)),
    fromDate,
    endDate,
    checkedCompanies: names.length,
  };
}

export async function snapshotDart(companyName: string, force = false, requestKey?: string, includeHistory = false, requestedBasis: "CFS" | "OFS" = "CFS") {
  const map = await corps(false, requestKey);
  const corp = findCorp(companyName, map);
  if (!corp) throw new TRPCError({ code: "NOT_FOUND", message: `DART 기업목록에서 찾지 못했습니다: ${companyName}` });

  // 최신 보고서를 우선 조회하고, 해당 기업에 최신 정기보고서가 없으면 DART 공개 이력(2015년~)의 연간 보고서까지 역탐색합니다.
  if(force){
    for(const k of stmtCache.keys())if(k.startsWith(`${corp.code}-`))stmtCache.delete(k);
    for(const k of filingCache.keys())if(k.startsWith(`${corp.code}-`))filingCache.delete(k);
    for(const k of historyCache.keys())if(k.startsWith(`${corp.code}:`))historyCache.delete(k);
    latestPeriodsCache.delete(corp.code);
  }
  const published = await latestPublishedPeriods(corp.code,requestKey,force);
  const currentCandidates = published.length ? published : periodCandidates("");
  const seenPeriods = new Set(currentCandidates.map((p) => `${p.year}:${p.kind}:${p.mode}`));
  const fallbackAnnuals = Array.from({ length: Math.max(0, new Date().getFullYear() - 2015) }, (_, i) => P(new Date().getFullYear() - 1 - i, "annual", "cum"))
    .filter((p) => !seenPeriods.has(`${p.year}:${p.kind}:${p.mode}`));
  const resolved = await resolvePeriod(corp, [...currentCandidates, ...fallbackAnnuals], requestedBasis, force, requestKey);
  if (!resolved) return { found: false as const, company: corp.name, message: "DART 공개 이력에서 실제 접수번호와 재무제표를 확인하지 못했습니다." };
  const { period, rows, fs } = resolved;
  const metrics = {} as Record<FinancialMetric, { value: number | null; unit: string; formula: string | null; citation: string; available: boolean; lines?: string[]; disclaimer?: string | null; crossValidation?: MetricCrossValidation } | null>;
  const rcept = rows.find((row) => row.rcept_no)?.rcept_no ?? "";
  (Object.keys(METRIC_LABELS) as FinancialMetric[]).forEach((metric) => {
    const picked = pickMetric(rows, period, metric);
    metrics[metric] = picked
      ? {
          value: Number.isFinite(picked.value) ? picked.value : null,
          unit: picked.unit,
          formula: picked.formula,
          citation: citation(periodLabel(period), picked.sourceHeading, rcept),
          available: Number.isFinite(picked.value),
          lines: picked.lines,
          ...(picked.partialValue !== undefined ? {partialValue:picked.partialValue,missingComponents:picked.missingComponents} : {}),
          disclaimer: picked.disclaimer,
        }
      : {value:null,unit:["operatingMargin","netMargin","borrowingsRatio","debtRatio","currentRatio","roe","roa"].includes(metric) ? "%" : "억원",formula:null,citation:citation(periodLabel(period),"원천 계정 확인 필요",rcept),available:false,lines:[],disclaimer:missingMetricReason(rows,metric)};
  });
  // EBITDA 본문 계정이 확정되지 않으면 실제 접수번호의 첨부 주석 표를 추가로 확인합니다.
  // 당기 열과 단위가 모호한 주석 값은 사용하지 않습니다.
  if (!Number.isFinite(metrics.ebitda?.value)) {
    const operatingProfit = pickMetric(rows, period, "operatingProfit");
    if (!operatingProfit || !Number.isFinite(operatingProfit.value)) {
      metrics.ebitda = {
        value: null, unit: "억원", formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비",
        citation: citation(periodLabel(period), "EBITDA 구성 계정", rcept), available: false,
        lines: [], disclaimer: "같은 공시에서 영업이익 원천 계정을 확인하지 못해 EBITDA를 계산할 수 없습니다. 다른 기간의 영업이익으로 대체하지 않았습니다.",
      };
    } else {
      const noteDepreciation = /^\d{14}$/.test(rcept) ? await depreciationFromDisclosure(rcept, period, requestKey,fs) : null;
      if (noteDepreciation) {
        const value = operatingProfit.value + noteDepreciation.value;
        metrics.ebitda = {
          value, unit: "억원", formula: "EBITDA = 영업이익 + DART 첨부 주석에 공시된 감가상각·상각비",
          citation: citation(periodLabel(period), "첨부 주석 > 감가상각·상각비", rcept), available: true,
          lines: [`영업이익 ${won(operatingProfit.value)}`, ...noteDepreciation.lines, `계산 EBITDA ${won(value)}`],
          disclaimer: null,
        };
      } else {
        metrics.ebitda = {
          ...(metrics.ebitda ?? { value: null, unit: "억원", formula: "EBITDA = 영업이익 + 감가상각비 + 무형자산상각비", citation: citation(periodLabel(period), "첨부 주석 > 감가상각·상각비", rcept), available: false, lines: [] }),
          disclaimer: "DART 본문 계정과 첨부 원문 주석을 확인했지만, 같은 기간의 감가상각비·무형자산상각비 금액과 단위를 명확하게 매칭하지 못했습니다. EBITDA를 추정하지 않았습니다. 보고서 주석을 직접 확인해야 합니다.",
        };
      }
    }
  }
  // DART 본문에 리스부채가 없으면 실제 접수번호의 원문 주석에서 먼저 금액을 찾고, 네이버 금융을 그다음 보조 경로로 사용합니다.
  let leaseFallbackUrl: string | null = null;
  for (const metric of ["revenue", "operatingMargin", "netMargin", "borrowings", "borrowingsRatio"] as const) {
    const existing = metrics[metric];
    const corrected = await pickMetricWithOriginalFallback({corp, rows, period, basis:fs, metric, requestKey});
    if ((metric === "borrowings" || metric === "borrowingsRatio") && corrected.url) leaseFallbackUrl = corrected.url;
    if (corrected.picked && Number.isFinite(corrected.picked.value)) {
      metrics[metric] = { ...(existing ?? { value: null, unit: corrected.picked.unit, formula: corrected.picked.formula, citation: citation(periodLabel(period), corrected.picked.sourceHeading, rcept), available: false }), value: corrected.picked.value, unit: corrected.picked.unit, formula: corrected.picked.formula, lines: corrected.picked.lines, disclaimer: corrected.picked.disclaimer, citation: pickedCitation(period,corrected.picked,rows,corrected.url), available: true };
    } else if (existing && corrected.picked?.disclaimer) {
      metrics[metric] = { ...existing, disclaimer: corrected.picked.disclaimer };
    }
  }

  // 원본 DART 수치와 계산 근거를 보존하고, 네이버 금융은 기간·기준이 맞는 보조 확인 자료로만 연결합니다.
  const externalValidation = await crossValidateMetrics({
    company: { name: corp.name, stock: corp.stock },
    values: Object.fromEntries((Object.keys(METRIC_LABELS) as FinancialMetric[]).map((metric) => [metric, metrics[metric] ? { value: metrics[metric]!.value, unit: metrics[metric]!.unit } : null])),
    period,
    basis: fs,
  });
  for (const metric of Object.keys(METRIC_LABELS) as FinancialMetric[]) {
    // 외부 수치와 차이가 나더라도 DART 원천값을 다른 사이트의 숫자로 바꾸지 않습니다.
    if (metrics[metric] && externalValidation[metric]) metrics[metric] = { ...metrics[metric]!, crossValidation: externalValidation[metric] };
  }

  // DART 본문 행이 누락된 지표는 네이버 금융을 먼저 조회하고, 없을 때만 FnGuide를 보조 사용합니다.
  // EBITDA는 DART 첨부 주석에서 계산을 먼저 시도한 뒤 네이버 금융, FnGuide 순으로 확인합니다.
  for (const metric of Object.keys(METRIC_LABELS) as FinancialMetric[]) {
    if (Number.isFinite(metrics[metric]?.value)) continue;
    let fallback: { value: number; unit: string; source: string; url: string; period: string; rawLabel?: string } | null = null;
    const naver = externalValidation[metric]?.providers.find((provider) => provider.source === "NAVER_FINANCE" && provider.found && provider.value !== null && Number.isFinite(provider.value) && provider.basis === fs);
    if (naver?.value !== null && naver?.value !== undefined && naver.url) fallback = { value: naver.value, unit: naver.unit, source: "네이버 금융", url: naver.url, period: naver.period ?? periodLabel(period) };
    if (!fallback && /^\d{6}$/.test(corp.stock ?? "")) {
      const fnGuide = await fetchFnGuideFallback({ stockCode: corp.stock, period, basis: fs, metric }).catch(() => null);
      if (fnGuide && Number.isFinite(fnGuide.value)) fallback = { value: fnGuide.value, unit: fnGuide.unit, source: "FnGuide", url: fnGuide.url, period: fnGuide.period, rawLabel: fnGuide.rawLabel };
    }
    if (fallback) {
      metrics[metric] = {
        value: fallback.value, unit: fallback.unit, formula: metric === "ebitda" ? `${fallback.source}가 동일 기간에 제공한 EBITDA 원수치` : null,
        citation: `${fallback.source} 보조자료 (${fallback.url})`, available: true,
        lines: [`외부 출처: ${fallback.source}`, `기간: ${fallback.period}`, `원천 계정: ${fallback.rawLabel ?? METRIC_LABELS[metric]}`, `값: ${won(fallback.value)}`],
        disclaimer: "DART 본문에서 해당 계정을 확인하지 못해 외부 출처의 동일 기간 자료를 보조값으로 표시했습니다. DART 원문 수치와 일치한다고 판정한 값은 아닙니다.",
        crossValidation: externalValidation[metric],
      };
    }
  }
  const quarterHistoryResult = includeHistory ? await quarterlyHistory(corp, fs, requestKey) : historyResponseShape([], []);
  const quarterHistory = quarterHistoryResult.points;
  const validations = Object.values(externalValidation).filter((item): item is MetricCrossValidation => Boolean(item));
  const validationSummary = {
    checked: validations.filter((item) => item.dartValue !== null && Number.isFinite(item.dartValue)).length,
    matched: validations.filter((item) => item.dartValue !== null && Number.isFinite(item.dartValue) && item.status === "MATCH").length,
    mismatched: validations.filter((item) => item.dartValue !== null && Number.isFinite(item.dartValue) && item.status === "MISMATCH").length,
    partial: validations.filter((item) => item.dartValue !== null && Number.isFinite(item.dartValue) && item.status === "PARTIAL").length,
    unverified: validations.filter((item) => item.dartValue !== null && Number.isFinite(item.dartValue) && (item.status === "UNAVAILABLE" || item.status === "NOT_COMPARABLE")).length,
    message: validations.some((item) => item.status === "MISMATCH")
      ? "일부 지표의 보조자료 값이 DART 원천값과 다릅니다. 표시값은 DART 계산 결과를 유지합니다."
      : validations.some((item) => item.status !== "MATCH")
        ? "일부 지표는 같은 기간·회계기준의 보조자료를 찾지 못했습니다."
        : "조회 가능한 보조자료와 DART 원천값의 값이 허용 범위 안에 있습니다.",
  };
  const currentFiling=await filingForPeriod(corp.code,period.year,period.code,requestKey);
  const amendmentPending=Boolean(currentFiling && currentFiling.rceptNo!==rcept);
  return {
    amendmentPending, dataNotice:amendmentPending ? "공시 목록의 최신 정정 보고서가 재무 API에 아직 반영되지 않았습니다. 표시 접수번호의 자료를 확인하세요." : "",
    found: true as const, company: corp.name, corpCode: corp.code, stockCode: corp.stock,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    periodKind: period.kind, periodMode: period.mode, periodYear: period.year, basis: fsLabel(fs), basisCode: fs,
    metrics, crossValidation: externalValidation, validationSummary, externalLeaseFallbackUrl: leaseFallbackUrl, rawAccountMetrics: pickRawAccountMetrics(rows, period, rcept), rawRows: rows, rceptNo: rcept, reportName: currentFiling?.rceptNo === rcept ? currentFiling.reportName : periodLabel(period),
    quarterlyHistory: quarterHistory, refreshedAt: new Date().toISOString(),
  };
}

export type ComparisonMetric = FinancialMetric | ExtraComparisonMetric;

function comparisonMetricLabel(metric: ComparisonMetric): string {
  if (metric === "assetTurnover") return "자산회전율";
  return isExtraComparisonMetric(metric) ? COMPARISON_ACCOUNT_METRICS[metric] : METRIC_LABELS[metric];
}

function pickExtraComparisonMetric(rows: Row[], period: Period, metric: ExtraComparisonMetric): PickedMetric | null {
  if (metric !== "assetTurnover") return pickDirectAccount(rows, period, COMPARISON_ACCOUNT_METRICS[metric]);
  const revenue = pickMetric(rows, period, "revenue");
  const assets = resolveBalanceTotal(rows, period, "자산총계");
  if (!revenue || !assets || !Number.isFinite(revenue.value) || assets.value <= 0) return null;
  return {value:revenue.value / assets.value, unit:"회", formula:"자산회전율 = 같은 공시의 매출액 ÷ 자산총계", lines:[...revenue.lines, ...assets.lines], disclaimer:null, sourceHeading:"손익계산서 매출액 · 재무상태표 자산총계"};
}

export type CompareInput = {
  companies: string[];
  metric: ComparisonMetric;
  year?: number;
  period: Kind | "latest";
  basis: "CFS" | "OFS";
  force?: boolean;
  includeValidation?: boolean;
};

export async function compareDart(input: CompareInput, requestKey?: string) {
  const metric = input.metric;
  if ((input.period as string) === "h2") throw new TRPCError({code:"BAD_REQUEST", message:"비교분석은 1분기·상반기·3분기·연간 보고서만 지원합니다."});
  const map = await corps(Boolean(input.force), requestKey);
  if (new Set(input.companies).size > 10) throw new TRPCError({code:"BAD_REQUEST", message:"비교 기업은 최대 10개까지 가능합니다."});
  const uniqueNames = [...new Set(input.companies)];
  const resultRows = [] as Array<{
    company: string;
    found: boolean;
    value: number | null;
    unit: string;
    period: string;
    basis: string;
    citation?: string;
    rceptNo?: string;
    formula?: string | null;
    message?: string;
    crossValidation?: MetricCrossValidation;
    validationPeriod?: Period;
    source?: "DART" | "NAVER_FINANCE" | "FNGUIDE";
  }>;

  for (const requested of uniqueNames) {
    const corp = findCorp(requested, map);
    if (!corp) {
      resultRows.push({ company: requested, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "DART 기업목록에서 찾지 못했습니다." });
      continue;
    }
    if (isExtraComparisonMetric(metric)) {
      const candidates = input.period === "latest" ? await latestPublishedPeriods(corp.code, requestKey, Boolean(input.force)) : periodFromFilters(input.year, input.period);
      const resolved = await resolvePeriod(corp, candidates, input.basis, Boolean(input.force), requestKey);
      if (!resolved) {
        resultRows.push({company:corp.name, found:false, value:null, unit:"", period:"", basis:fsLabel(input.basis), message:"선택한 기간·회계기준의 재무제표를 확인하지 못했습니다."});
        continue;
      }
      const receipt = resolved.rows.find(row => row.rcept_no)?.rcept_no ?? "";
      const picked = pickExtraComparisonMetric(resolved.rows, resolved.period, metric);
      const available = Boolean(picked && Number.isFinite(picked.value));
      resultRows.push({company:corp.name, found:available, value:available ? picked!.value : null, unit:picked?.unit ?? (metric === "assetTurnover" ? "회" : "억원"), period:`${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`, basis:fsLabel(resolved.fs), rceptNo:receipt || undefined, citation:citation(periodLabel(resolved.period), picked?.sourceHeading ?? comparisonMetricLabel(metric), receipt), formula:picked?.formula, source:"DART", ...(available ? {} : {message:`같은 공시에서 ${comparisonMetricLabel(metric)}의 원천 계정을 확인하지 못했습니다.`})});
      continue;
    }
    const resolved = await resolvePeriod(corp, (input.period === "latest" ? await latestPublishedPeriods(corp.code,requestKey,Boolean(input.force)) : periodFromFilters(input.year, input.period)), input.basis, Boolean(input.force), requestKey);
    if (!resolved) {
      resultRows.push({ company: corp.name, found: false, value: null, unit: "", period: "", basis: fsLabel(input.basis), message: "선택한 기간·회계기준의 DART 전체 재무제표와 주요계정 API에서 값을 확인하지 못했습니다. 보고서 원문이 없다는 뜻은 아닙니다." });
      continue;
    }
    const rcept = resolved.rows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const selected = await pickMetricWithOriginalFallback({ corp, rows: resolved.rows, period: resolved.period, basis: resolved.fs, metric: metric, requestKey });
    const picked = selected.picked;
    if (!picked || !Number.isFinite(picked.value)) {
      const fallback = await externalFallbackForMetric({ name: corp.name, stock: corp.stock }, metric, resolved.period, resolved.fs);
      if (fallback) resultRows.push({ company: corp.name, found: true, value: fallback.value, unit: fallback.unit, period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)} · 네이버 금융`, basis: fsLabel(resolved.fs), citation: `${fallback.source} (${fallback.url})`, message: "DART 원천 계정이 없어 외부 출처 값을 보조 표시합니다.", crossValidation: fallback.validation, source: fallback.source === "FnGuide" ? "FNGUIDE" : "NAVER_FINANCE" });
      else {
        const components = (metric === "borrowings" || metric === "borrowingsRatio") ? grossBorrowingComponents(resolved.rows) : null;
        const diagnostic = components ? [
          `DART BS ${resolved.rows.filter(row => row.sj_div === "BS").length}행`,
          `차입성 구성 ${components.items.length}행`,
          `비리스 계정 그룹 ${components.coreFound}개`,
          `전체 재무상태표 판정 ${components.fullBalanceSheet ? "예" : "아니요"}`,
          `구성 완전성 ${components.coreComplete ? "예" : "아니요"}`,
          `미확인 ${components.missing.join("·") || "없음"}`,
          `원문 차입성 계정 ${resolved.rows.filter(row => row.sj_div === "BS" && /차입|사채|대출|리스|Borrowing|Bond|Lease|Debenture/i.test(`${row.account_nm} ${row.account_id}`)).map(row => `${row.account_nm}[${row.account_id ?? "코드없음"}]=${row.thstrm_amount ?? "금액없음"}`).slice(0, 16).join("; ") || "없음"}`,
          ...(picked?.partialValue !== undefined && Number.isFinite(picked.partialValue) ? [`확인된 부분합 ${won(picked.partialValue)} (총차입금 아님)`] : []),
        ].join(" / ") : "";
        resultRows.push({ company: corp.name, found: false, value: null, unit: metric === "borrowingsRatio" ? "%" : "억원", period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`, basis: fsLabel(resolved.fs), rceptNo: rcept || undefined, citation: citation(periodLabel(resolved.period), "재무상태표 차입성 계정", rcept), message: [picked?.disclaimer ?? missingMetricReason(resolved.rows,metric), diagnostic].filter(Boolean).join(" | ") });
      }
      continue;
    }
    const finalPicked = picked;
    const leaseFallbackUrl: string | null = selected.url;
    resultRows.push({
      company: corp.name,
      found: true,
      value: finalPicked.value,
      unit: finalPicked.unit,
      period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)}`,
      basis: fsLabel(resolved.fs),
      rceptNo: rcept || undefined,
      citation: pickedCitation(resolved.period,finalPicked,resolved.rows,leaseFallbackUrl),
      formula: finalPicked.formula,
      validationPeriod: resolved.period,
      source: /FnGuide/.test(finalPicked.sourceHeading) ? "FNGUIDE" : /네이버 금융/.test(finalPicked.sourceHeading) ? "NAVER_FINANCE" : "DART",
    });
  }

  // 비교표의 각 값에 동일 기간 네이버 금융 수치와 출처 정보를 연결합니다. 하반기(연간-상반기) 파생값은
  // 외부 출처의 개별 분기 데이터로 동일 구간을 재구성할 수 없으면 검증 불가로 표시합니다.
  const validationMap = await mapWithConcurrency(resultRows, 3, async (row) => {
    if (input.includeValidation === false || isExtraComparisonMetric(metric)) return row;
    if (!row.found || row.value === null || !Number.isFinite(row.value) || row.source === "NAVER_FINANCE" || row.source === "FNGUIDE") return row;
    const corp = findCorp(row.company, map);
    const rowBasis: "CFS" | "OFS" = /별도/.test(row.basis) ? "OFS" : input.basis;
    if (!corp) return row;
    if (!row.validationPeriod) {
      const sourceUnavailable: MetricCrossValidation = {
        metric: metric, metricLabel: METRIC_LABELS[metric], status: "NOT_COMPARABLE", dartValue: row.value, unit: row.unit,
        period: row.period, basis: rowBasis, tolerancePct: 1.25, checkedAt: new Date().toISOString(), providers: [],
        message: "이 값은 사업보고서 누계 − 상반기 누계로 파생한 하반기 값입니다. 네이버 금융에서 같은 6개월 구간을 독립적으로 맞출 수 없어 수치 비교는 보류했습니다.",
      };
      return { ...row, crossValidation: sourceUnavailable };
    }
    const crossValidation = await crossValidateMetric({ company: { name: corp.name, stock: corp.stock }, metric: metric, dartValue: row.value, unit: row.unit, period: row.validationPeriod, basis: rowBasis });
    // 비교분석의 표시값은 언제나 표준 DART 엔진의 산출값으로 유지합니다. 네이버 값은 출처 근거에만 붙입니다.
    return { ...row, crossValidation };
  });

  return {
    metric: metric,
    metricLabel: comparisonMetricLabel(metric),
    rows: validationMap.map(({ validationPeriod: _validationPeriod, ...row }) => row),
    refreshedAt: new Date().toISOString(),
  };
}

const LOOKUPS: Array<[RegExp, FinancialMetric]> = [
  [/영업이익률|영업마진|영업마진율|OPM/i, "operatingMargin"],
  [/영업이익|영업익/i, "operatingProfit"],
  [/당기순이익|순이익|순익|당기순익|반기순손익|분기순손익/i, "netIncome"],
  [/투자활동현금흐름|투자현금흐름/i, "investmentCashFlow"],
  [/재무활동현금흐름|재무현금흐름/i, "financingCashFlow"],
  [/영업활동현금흐름|영업현금흐름|영업현금/i, "operatingCashFlow"],
  [/capex|설비투자|자본적지출|유형자산.?취득/i, "capex"],
  [/순차입금|순부채/i, "netDebt"], [/부채비율/i, "debtRatio"], [/유동비율/i, "currentRatio"],
  [/이자보상배율/i, "interestCoverage"], [/ROE|자기자본이익률/i, "roe"], [/ROA|총자산이익률/i, "roa"], [/EPS|주당순이익/i, "eps"],
  [/매출액|매출|매출실적/i, "revenue"],
];

function metricFromQuestion(question: string): FinancialMetric | null {
  for (const [regex, key] of LOOKUPS) if (regex.test(question)) return key;
  return null;
}

function defaultMetricUnit(metric: FinancialMetric): string {
  if (["operatingMargin", "netMargin", "borrowingsRatio", "debtRatio", "currentRatio", "roe", "roa"].includes(metric)) return "%";
  if (metric === "eps") return "원";
  if (metric === "interestCoverage") return "배";
  return "억원";
}

async function externalFallbackForMetric(corp: { name: string; stock?: string | null }, metric: FinancialMetric, period: Period, basis: "CFS" | "OFS") {
  const validation = await crossValidateMetric({ company: { name: corp.name, stock: corp.stock }, metric, dartValue: null, unit: defaultMetricUnit(metric), period, basis });
  const naver = validation.providers.find((provider) => provider.source === "NAVER_FINANCE" && provider.found && provider.value !== null && Number.isFinite(provider.value) && provider.basis === basis);
  if (naver?.value !== null && naver?.value !== undefined && naver.url) return { value: naver.value, unit: naver.unit, source: "네이버 금융", url: naver.url, periodLabel: naver.period ?? periodLabel(period), rawLabel: METRIC_LABELS[metric], validation };
  if (/^\d{6}$/.test(corp.stock ?? "")) {
    const fnGuide = await fetchFnGuideFallback({ stockCode: corp.stock!, period, basis, metric }).catch(() => null);
    if (fnGuide && Number.isFinite(fnGuide.value)) return { value: fnGuide.value, unit: fnGuide.unit, source: "FnGuide", url: fnGuide.url, periodLabel: fnGuide.period, rawLabel: fnGuide.rawLabel, validation };
  }
  return null;
}

const fail = (message: string) => ({ found: false as const, message });

type HalfYearPair = { annualPeriod: Period; halfPeriod: Period; annualRows: Row[]; halfRows: Row[]; fs: "CFS" | "OFS" };

async function halfYearPair(corp: { code: string }, year: number, preferredFs: "CFS" | "OFS", requestKey?: string): Promise<HalfYearPair | null> {
  // 같은 회사·같은 회계 기준의 연간 누계와 상반기 누계가 모두 존재해야만 차감합니다.
  const order: Array<"CFS" | "OFS"> = [preferredFs];
  for (const basis of order) {
    const annualPeriod = P(year, "annual", "cum");
    const halfPeriod = P(year, "half", "cum");
    const annualRows = await statements(corp.code, year, annualPeriod.code, basis, false, requestKey);
    const halfRows = await statements(corp.code, year, halfPeriod.code, basis, false, requestKey);
    if (annualRows?.length && halfRows?.length) return { annualPeriod, halfPeriod, annualRows, halfRows, fs: basis };
  }
  return null;
}

function secondHalfPicked(pair: HalfYearPair, metric: FinancialMetric): PickedMetric | null {
  const a = pickMetric(pair.annualRows, pair.annualPeriod, metric);
  const h = pickMetric(pair.halfRows, pair.halfPeriod, metric);
  const rceptFY = pair.annualRows.find((r) => r.rcept_no)?.rcept_no ?? "";
  const rceptH1 = pair.halfRows.find((r) => r.rcept_no)?.rcept_no ?? "";
  const source = `연간 접수번호 ${rceptFY || "미확인"} − 상반기 접수번호 ${rceptH1 || "미확인"}`;
  const pointInTimeMetrics = new Set<FinancialMetric>(["netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio"]);
  if (pointInTimeMetrics.has(metric)) {
    if (!a || !Number.isFinite(a.value)) return null;
    return {
      ...a,
      lines: [...a.lines, "이 지표는 누계가 아닌 기말 잔액/기말 비율이므로 연간 사업보고서의 12월 31일 실제 잔액을 사용했습니다.", `사업보고서 접수번호 ${rceptFY || "미확인"}`],
      sourceHeading: `사업보고서 > ${a.sourceHeading}`,
    };
  }
  if (metric === "operatingMargin" || metric === "netMargin") {
    if(!a || !h)return null;
    const revA = pickMetric(pair.annualRows, pair.annualPeriod, "revenue");
    const revH = pickMetric(pair.halfRows, pair.halfPeriod, "revenue");
    const profitMetric: FinancialMetric = metric === "operatingMargin" ? "operatingProfit" : "netIncome";
    const profitA = pickMetric(pair.annualRows, pair.annualPeriod, profitMetric);
    const profitH = pickMetric(pair.halfRows, pair.halfPeriod, profitMetric);
    if (!revA || !revH || !profitA || !profitH) return null;
    const h2Revenue = revA.value - revH.value;
    const h2Profit = profitA.value - profitH.value;
    if (!Number.isFinite(h2Revenue) || !Number.isFinite(h2Profit) || h2Revenue === 0) return null;
    const profitLabel = metric === "operatingMargin" ? "영업이익" : "순이익";
    return { value: h2Profit / h2Revenue * 100, unit: "%", lines: [`하반기 매출액 = 연간 ${won(revA.value)} − 상반기 ${won(revH.value)} = ${won(h2Revenue)}`, `하반기 ${profitLabel} = 연간 ${won(profitA.value)} − 상반기 ${won(profitH.value)} = ${won(h2Profit)}`, source], formula: `${METRIC_LABELS[metric]} = (연간 누계 ${profitLabel} − 상반기 누계 ${profitLabel}) ÷ (연간 누계 매출 − 상반기 누계 매출) × 100`, disclaimer: null, sourceHeading: "사업보고서·반기보고서 > 하반기 파생 계산" };
  }
  if (!a || !h || !Number.isFinite(a.value) || !Number.isFinite(h.value)) return null;
  if (!["revenue", "operatingProfit", "netIncome", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "ebitda"].includes(metric)) return null;
  const value = a.value - h.value;
  if (!Number.isFinite(value)) return null;
  return { value, unit: a.unit, lines: [`연간 누계: ${won(a.value)}`, `상반기 누계: ${won(h.value)}`, `하반기 계산값: ${won(a.value)} − ${won(h.value)} = ${won(value)}`, source], formula: `${METRIC_LABELS[metric]}(하반기) = ${METRIC_LABELS[metric]}(연간 누계) − ${METRIC_LABELS[metric]}(상반기 누계)`, disclaimer: a.disclaimer || h.disclaimer, sourceHeading: "사업보고서·반기보고서 > 하반기 파생 계산" };
}

async function askDartCore(question: string, requestKey?: string) {
  const parsed = parseDartQuery(question);
  const map = await corps(false, requestKey);
  let corp = findCorp(question, map);
  let notice: string | null = null;
  if (!corp) {
    if (looksLikeCompany(question)) return fail("질문 속 기업을 DART 목록에서 찾지 못했습니다. 공식 회사명으로 다시 검색해 주세요.");
    corp = findCorp(DEFAULT_COMPANY, map);
    if (!corp) return fail(`기본 기업(${DEFAULT_COMPANY})을 DART 목록에서 찾지 못했습니다.`);
    notice = `질문에 기업명이 없어 기본 기업(${DEFAULT_COMPANY})으로 조회했습니다.`;
  }

  const publishedCandidates = !parsed.explicitPeriod ? await latestPublishedPeriods(corp.code,requestKey) : [];
  const scopedPublished = parsed.years.length === 1 ? publishedCandidates.filter(p=>p.year === parsed.years[0]) : publishedCandidates;
  const queryCandidates = !parsed.explicitPeriod && (!parsed.years.length || /올해|금년|당해연도/.test(question)) && scopedPublished.length ? scopedPublished : periodCandidates(question);
  const fs = parsed.basis;
  const metrics = parsed.metrics;
  const relativeComparison = !/20\d{2}/.test(question) && /올해|금년|당해연도/.test(question) && /작년|지난해|전년도/.test(question);
  const requestedYears = relativeComparison ? [] : parsed.years;
  if (!metrics.length && !parsed.directAccount) return fail(`질문에서 조회할 재무지표를 인식하지 못했습니다. 재무 용어의 정확한 명칭을 사용해 주세요.`);
  if (metrics.includes("per") || metrics.includes("pbr")) return fail(`PER/PBR은 현재 연결된 OpenDART 재무제표만으로는 현재 주가 데이터가 없어 계산하지 않습니다. 주가 데이터 연결 후 제공할 수 있습니다.`);
  if (/하반기/.test(question)) {
    if (!metrics.length) return fail("하반기는 사업보고서 누계에서 상반기 누계를 빼는 방식으로 계산합니다. 재무지표의 정확한 명칭을 지정해 주세요.");
    const flowMetrics = new Set<FinancialMetric>(["revenue", "operatingProfit", "netIncome", "operatingMargin", "netMargin", "operatingCashFlow", "investmentCashFlow", "financingCashFlow", "capex", "freeCashFlow", "ebitda"]);
    const pointInTimeMetrics = new Set<FinancialMetric>(["netDebt", "borrowings", "borrowingsRatio", "workingCapital", "payables", "debtRatio", "currentRatio"]);
    const supportedH2Metrics = new Set<FinancialMetric>([...flowMetrics, ...pointInTimeMetrics]);
    const unsupported = metrics.filter((metric) => !supportedH2Metrics.has(metric));
    if (unsupported.length) return fail(`하반기 자료로 처리할 수 없는 지표입니다: ${unsupported.map((m) => METRIC_LABELS[m]).join(", ")}. 흐름 지표는 연간 누계−상반기 누계로 계산하고, 재무상태표 지표는 사업보고서 기말 잔액을 사용합니다.`);
    const requestedYear = parsed.yearEnd ?? parsed.years.at(-1) ?? parsed.yearStart ?? (new Date().getFullYear() - 1);
    if (metrics.every((metric) => pointInTimeMetrics.has(metric))) {
      const annualResolved = await resolvePeriod(corp, [P(requestedYear, "annual", "cum")], fs, false, requestKey);
      if (!annualResolved) return fail(`${corp.name}의 ${requestedYear}년 사업보고서에서 하반기 말 잔액을 확인할 수 없습니다.`);
      const values: Record<string, number | null> = {};
      const units: Record<string, string> = {};
      const lines: string[] = ["재무상태표 지표는 누계 차감 대상이 아니므로 하반기 말(12월 31일) 사업보고서 기말 잔액을 사용했습니다."];
      const pickedMap: Record<string, PickedMetric> = {};
      for (const metric of metrics) {
        const result = await pickMetricWithOriginalFallback({ corp, rows: annualResolved.rows, period: annualResolved.period, basis: annualResolved.fs, metric, requestKey });
        const picked = result.picked;
        values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
        units[metric] = picked?.unit ?? (metric === "borrowingsRatio" || metric === "debtRatio" || metric === "currentRatio" ? "%" : "억원");
        if (picked && Number.isFinite(picked.value)) { pickedMap[metric] = picked; lines.push(`${METRIC_LABELS[metric]}: ${formatMetricValue(picked.value, picked.unit)}`, ...picked.lines); }
      }
      if (metrics.every((metric) => values[metric] === null)) return fail(`${requestedYear}년 기말 잔액에 필요한 실제 원천 계정을 확인하지 못했습니다.`);
      const rcept = annualResolved.rows.find((row) => row.rcept_no)?.rcept_no ?? "";
      return {
        found: true as const, company: corp.name, period: `${requestedYear}년 하반기 말(12월 31일 기말 잔액)`, basis: fsLabel(annualResolved.fs), notice,
        metric: metrics.map((metric) => METRIC_LABELS[metric]).join(" · "),
        headline: metrics.map((metric) => `${METRIC_LABELS[metric]} ${values[metric] === null ? "자료 없음" : formatMetricValue(values[metric]!, units[metric])}`).join(" / "),
        lines, formula: metrics.map((metric) => pickedMap[metric]?.formula).filter(Boolean).join("; ") || null,
        citation: citation(`${requestedYear}년 사업보고서`, "재무상태표 기말 잔액", rcept),
        citations: [{ reportName: `${requestedYear}년 사업보고서`, rceptNo: rcept, url: rcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}` : null }],
        disclaimer: null, query: parsed,
      };
    }
    let pair: HalfYearPair | null = null;
    let targetYear = requestedYear;
    const explicitYear = parsed.yearEnd !== null || parsed.years.length > 0 || parsed.yearStart !== null;
    // 연도를 명시했다면 그 연도만 시도합니다. 연도를 생략한 경우에만 가장 최근 완결 연도를 역탐색합니다.
    const minYear = explicitYear ? requestedYear : Math.max(2000, requestedYear - 5);
    for (let year = requestedYear; year >= minYear; year--) {
      pair = await halfYearPair(corp, year, fs, requestKey);
      if (pair) { targetYear = year; break; }
    }
    if (!pair) return fail(`${corp.name}의 요청 연도 주변에서 동일 회계 기준의 사업보고서와 반기보고서를 모두 찾지 못해 하반기 수치를 계산할 수 없습니다.`);
    const values: Record<string, number | null> = {};
    const units: Record<string, string> = {};
    const missing: string[] = [];
    const pickedMap: Record<string, PickedMetric> = {};
    for (const metric of metrics) {
      const picked = secondHalfPicked(pair, metric);
      values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
      units[metric] = picked?.unit ?? (["operatingMargin", "netMargin"].includes(metric) ? "%" : "억원");
      if (picked && Number.isFinite(picked.value)) pickedMap[metric] = picked; else missing.push(METRIC_LABELS[metric]);
    }
    if (metrics.every((metric) => values[metric] === null)) return fail(`${targetYear}년 하반기 계산에 필요한 실제 공시 계정이 부족합니다. 추정값은 제공하지 않습니다. 누락 지표: ${missing.join(", ")}`);
    const primary = metrics[0];
    const rceptFY = pair.annualRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const rceptH1 = pair.halfRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const, company: corp.name, period: `${targetYear}년 하반기(7~12월) · 연간 누계 − 상반기 누계`, basis: fsLabel(pair.fs), notice,
      metric: metrics.map((m) => METRIC_LABELS[m]).join(" · "),
      headline: metrics.map((m) => `${METRIC_LABELS[m]} ${values[m] === null ? "자료 없음" : formatMetricValue(values[m]!, units[m])}`).join(" / "),
      lines: ["하반기 값은 동일 회계 기준의 사업보고서 연간 누계에서 반기보고서 상반기 누계를 차감했습니다.", ...metrics.flatMap((m) => pickedMap[m]?.lines ?? []), ...(missing.length ? [`공시 계정 부족으로 계산하지 않은 지표: ${missing.join(", ")}`] : [])],
      formula: "하반기(7~12월) = 사업보고서 연간 누계 − 반기보고서 상반기 누계",
      citation: citation(`${targetYear}년 사업보고서 + 반기보고서`, "연간 누계 − 상반기 누계", rceptFY),
      citations: [{ reportName: `${targetYear}년 사업보고서`, rceptNo: rceptFY, url: rceptFY ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptFY}` : null }, { reportName: `${targetYear}년 반기보고서`, rceptNo: rceptH1, url: rceptH1 ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rceptH1}` : null }],
      disclaimer: missing.length ? `일부 지표는 원천 계정 미확인으로 계산하지 않았습니다: ${missing.join(", ")}` : null, query: parsed,
    };
  }

  // 재무상태표/손익계산서/현금흐름표에 실제 계정명이 존재하는 경우에는
  // 임의의 다른 지표(예: 매출액)로 대체하지 않고 해당 계정만 정확히 찾습니다.
  if (parsed.directAccount && !metrics.length) {
    const candidates = parsed.kind && parsed.kind !== "latest" ? [P(parsed.yearEnd ?? parsed.years.at(-1) ?? new Date().getFullYear(), parsed.kind, parsed.mode ?? "cum")] : queryCandidates;
    if (!candidates.length) return fail(`${corp.name}의 요청 기간을 해석할 수 없습니다.`);
    const baseResolved = await resolvePeriod(corp, candidates, fs, false, requestKey);
    if (!baseResolved) return fail(`${corp.name}의 ${parsed.directAccount}을(를) 찾을 수 있는 보고서를 찾지 못했습니다.`);
    let periods: Period[] = [baseResolved.period];
    if (parsed.yearStart !== null && parsed.yearEnd !== null) periods = Array.from({ length: parsed.yearEnd - parsed.yearStart + 1 }, (_, i) => P(parsed.yearStart! + i, baseResolved.period.kind, baseResolved.period.mode));
    else if (parsed.recentYears) periods = Array.from({ length: parsed.recentYears }, (_, i) => P(baseResolved.period.year - (parsed.recentYears! - 1 - i), baseResolved.period.kind, baseResolved.period.mode));
    const series: any[] = [];
    for (const requestedPeriod of periods) {
      const resolvedYear = await resolvePeriod(corp, [requestedPeriod], baseResolved.fs, false, requestKey);
      const period = resolvedYear?.period ?? requestedPeriod;
      const rows = resolvedYear?.rows ?? null;
      const picked = rows ? pickDirectAccount(rows, period, parsed.directAccount) : null;
      series.push({ year: period.year, period: periodLabel(period), mode: modeLabel(period), basis: resolvedYear ? fsLabel(resolvedYear.fs) : fsLabel(baseResolved.fs), value: picked?.value ?? null, unit: picked?.unit ?? "억원", found: !!picked, message: !rows ? "해당 보고서가 없습니다." : !picked ? `${parsed.directAccount} 계정을 찾지 못했습니다.` : undefined });
    }
    const valid = series.filter((x) => x.value !== null);
    if (!valid.length) return fail(`${corp.name}의 요청한 기간에 '${parsed.directAccount}' 계정을 찾지 못했습니다.`);
    const latest = valid[valid.length - 1];
    const latestResolved = await resolvePeriod(corp, [P(latest.year, baseResolved.period.kind, baseResolved.period.mode)], baseResolved.fs, false, requestKey);
    const latestRows = latestResolved?.rows ?? null;
    const latestPeriod = latestResolved?.period ?? P(latest.year, baseResolved.period.kind, baseResolved.period.mode);
    const pickedLatest = latestRows ? pickDirectAccount(latestRows, latestPeriod, parsed.directAccount) : null;
    const rcept = latestRows?.find((r) => r.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const, company: corp.name,
      period: parsed.recentYears ? `최근 ${parsed.recentYears}개년 · ${modeLabel(baseResolved.period)}` : periods.length > 1 ? `${periodLabel(periods[0])} ~ ${periodLabel(periods.at(-1)!)}` : `${periodLabel(baseResolved.period)} · ${modeLabel(baseResolved.period)} · 기준일 ${baseDate(baseResolved.period)}`,
      basis: latestResolved ? fsLabel(latestResolved.fs) : fsLabel(baseResolved.fs), notice, metric: parsed.directAccount,
      headline: formatMetricValue(latest.value, latest.unit), lines: [`${parsed.directAccount} 연도별 조회`],
      series, formula: null, citation: citation(periodLabel(baseResolved.period), pickedLatest?.sourceHeading ?? `재무제표 > ${parsed.directAccount}`, rcept), disclaimer: null, query: parsed,
    };
  }

  // 1) 기간이 명시된 다년 질의: 2024~2026 / 최근 4개년 / 최근 3년 등.
  //    각 연도에서 같은 보고기간을 조회하고, 여러 지표가 들어오면 행/열 형태로 함께 반환한다.
  const isHistorical = parsed.analysis !== "cause" && (!!parsed.recentYears || requestedYears.length >= 2 || !!parsed.yearStart);
  if (isHistorical) {
    let base: Period | null = null;
    let historyFs: "CFS" | "OFS" = fs;
    if (parsed.yearStart !== null && parsed.yearEnd !== null) {
      const anchorYear = parsed.yearEnd;
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : [P(anchorYear, "annual", "cum"), P(anchorYear - 1, "annual", "cum"), P(anchorYear - 2, "annual", "cum")];
      const resolved = await resolvePeriod(corp, anchorCandidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 연간/요청 보고기간 공시를 찾지 못했습니다.`);
      base = explicitKind ? resolved.period : P(anchorYear, "annual", "cum");
      historyFs = resolved.fs;
    } else if (parsed.recentYears) {
      const currentYear = new Date().getFullYear();
      const candidates = parsed.kind && parsed.kind !== "latest"
        ? Array.from({ length: 15 }, (_, i) => P(currentYear - i, parsed.kind as Kind, parsed.mode ?? "cum"))
        : Array.from({ length: 15 }, (_, i) => P(currentYear - 1 - i, "annual", "cum"));
      const resolved = await resolvePeriod(corp, candidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 요청한 동일 보고기간 공시를 찾지 못했습니다.`);
      base = resolved.period;
      historyFs = resolved.fs;
    } else if (requestedYears.length >= 2) {
      const anchorYear = requestedYears[requestedYears.length - 1];
      const explicitKind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : null;
      const anchorCandidates = explicitKind
        ? [P(anchorYear, explicitKind, parsed.mode ?? "cum")]
        : [P(anchorYear, "annual", "cum"), P(anchorYear - 1, "annual", "cum"), P(anchorYear - 2, "annual", "cum")];
      const resolved = await resolvePeriod(corp, anchorCandidates, fs, false, requestKey);
      if (!resolved) return fail(`${corp.name}의 연간/요청 보고기간 공시를 찾지 못했습니다.`);
      base = explicitKind ? resolved.period : P(anchorYear, "annual", "cum");
      historyFs = resolved.fs;
    }
    if (!base) return fail("질문의 기간 범위를 해석하지 못했습니다.");

    const periods = parsed.yearStart !== null && parsed.yearEnd !== null
      ? Array.from({ length: parsed.yearEnd - parsed.yearStart + 1 }, (_, i) => P(parsed.yearStart! + i, base!.kind, base!.mode))
      : parsed.recentYears
        ? Array.from({ length: parsed.recentYears }, (_, i) => P(base!.year - (parsed.recentYears! - 1 - i), base!.kind, base!.mode))
        : requestedYears.map((year) => P(year, base!.kind, base!.mode));

    const matrix: Array<{
      year: number;
      period: string;
      mode: string;
      basis?: string;
      values: Record<string, number | null>;
      units: Record<string, string>;
      sources: Record<string,string>;
      found: boolean;
      message?: string;
    }> = [];

    for (const requestedPeriod of periods) {
      // 연도마다 요청 기준을 우선 조회하고, CFS가 없는 해에만 OFS로 재시도해 과거 공시 누락을 줄입니다.
      const resolvedYear = await statements(corp.code,requestedPeriod.year,requestedPeriod.code,historyFs,false,requestKey).then(rows=>rows ? {period:requestedPeriod,rows,fs:historyFs} : null);
      const period = resolvedYear?.period ?? requestedPeriod;
      const rows = resolvedYear?.rows ?? null;
      const actualBasis = resolvedYear?.fs ?? historyFs;
      const values: Record<string, number | null> = {};
      const units: Record<string, string> = {};
      const sources: Record<string,string> = {};
      let found = false;
      for (const metric of metrics) {
        const result = rows ? await pickMetricWithOriginalFallback({ corp, rows, period, basis: actualBasis, metric, requestKey }) : null;
        const picked = result?.picked ?? null;
        sources[metric] = rows ? pickedCitation(period,picked,rows,result?.url) : "출처 미확인";
        values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
        units[metric] = picked?.unit ?? (["operatingMargin", "netMargin", "debtRatio", "currentRatio", "roe", "roa"].includes(metric) ? "%" : "억원");
        if (picked && Number.isFinite(picked.value)) found = true;
      }
      matrix.push({
        year: period.year,
        period: periodLabel(period),
        mode: modeLabel(period),
        basis: fsLabel(actualBasis),
        values,
        units,
        sources,
        found,
        message: !rows ? "해당 보고서가 없습니다." : !found ? `${metrics.map((m) => METRIC_LABELS[m]).join(", ")} 계정을 찾지 못했습니다.` : undefined,
      });
    }

    const valid = matrix.filter((row) => metrics.some((metric) => row.values[metric] !== null && Number.isFinite(row.values[metric])));
    if (!valid.length) return fail(`${corp.name}의 요청한 기간에 ${metrics.map((m) => METRIC_LABELS[m]).join(", ")} 자료를 찾지 못했습니다.`);

    const primary = metrics[0];
    // 요청한 모든 기간과 주 지표의 값이 실제로 확인된 기간을 구분합니다.
    // 한 지표가 없는 해를 다른 지표의 값으로 첫해/마지막 해처럼 보여주지 않습니다.
    const primaryValid = matrix.filter((row) => row.values[primary] !== null && Number.isFinite(row.values[primary]));
    const firstPrimaryRow = primaryValid[0] ?? valid[0];
    const latestPrimaryRow = primaryValid[primaryValid.length - 1] ?? valid[valid.length - 1];
    const firstValue = firstPrimaryRow.values[primary];
    const latestValue = latestPrimaryRow.values[primary];
    const unit = latestPrimaryRow.units[primary] ?? firstPrimaryRow.units[primary];
    const coverage = `${primaryValid.length}/${periods.length}개년`;
    const headline = firstValue !== null && latestValue !== null
      ? `요청 ${periods[0].year}~${periods[periods.length - 1].year}년 · 확인 ${firstPrimaryRow.year} ${formatMetricValue(firstValue, unit)} → ${latestPrimaryRow.year} ${formatMetricValue(latestValue, unit)} (${coverage} 값 확인)`
      : `요청 ${periods[0].year}~${periods[periods.length - 1].year}년 · ${METRIC_LABELS[primary]} ${coverage} 값 확인`;
    const latestRows = await statements(corp.code, latestPrimaryRow.year, P(latestPrimaryRow.year, base.kind, base.mode).code, historyFs, false, requestKey);
    const rcept = latestRows?.find((r) => r.rcept_no)?.rcept_no ?? "";
    const missingPrimaryYears = matrix.filter((row) => row.values[primary] === null || !Number.isFinite(row.values[primary])).map((row) => row.year);
    const metricCoverageLines = metrics.length > 1 ? metrics.map((metric) => {
      const foundYears = matrix.filter((row) => row.values[metric] !== null && Number.isFinite(row.values[metric])).length;
      const missingYears = matrix.filter((row) => row.values[metric] === null || !Number.isFinite(row.values[metric])).map((row) => row.year);
      return `${METRIC_LABELS[metric]}: ${foundYears}/${periods.length}개년 확인${missingYears.length ? ` · 미확인 연도 ${missingYears.join(", ")}` : ""}`;
    }) : [];

    const series = metrics.length === 1
      ? matrix.map((row) => ({ year: row.year, period: row.period, mode: row.mode, value: row.values[primary], unit: row.units[primary], citation:row.sources[primary], basis:row.basis, found: row.values[primary] !== null && Number.isFinite(row.values[primary]), message: row.message }))
      : undefined;

    return {
      found: true as const,
      company: corp.name,
      period: parsed.recentYears
        ? `최근 ${parsed.recentYears}개년 요청 · ${modeLabel(base)} · 기준일 ${baseDate(base)}`
        : `${periodLabel(periods[0])} ~ ${periodLabel(periods[periods.length - 1])} · ${modeLabel(base)}`,
      basis: fsLabel(historyFs),
      notice,
      metric: metrics.map((m) => METRIC_LABELS[m]).join(" · "),
      headline,
      lines: [
        metrics.length === 1
          ? `${METRIC_LABELS[primary]} · 요청 ${periods.length}개년 중 ${coverage} 값 확인`
          : `${metrics.map((m) => METRIC_LABELS[m]).join(" · ")} 연도별 비교`,
        `요청 조회 기간: ${periodLabel(periods[0])} ~ ${periodLabel(periods[periods.length - 1])} · 동일 보고기간 기준`,
        primaryValid.length ? `주 지표 확인 기간: ${firstPrimaryRow.year}~${latestPrimaryRow.year}년` : "주 지표의 확인된 연도가 없습니다.",
        missingPrimaryYears.length ? `주 지표 미확인 연도: ${missingPrimaryYears.join(", ")} · 해당 연도는 숫자를 추정하거나 다른 기간으로 대체하지 않았습니다.` : "",
        ...metricCoverageLines,
        metrics.length > 1 ? "여러 지표를 같은 연도·같은 보고기간으로 비교했습니다." : "",
      ].filter(Boolean),
      series,
      matrix: metrics.length > 1 ? matrix : undefined,
      formula: firstValue !== null && latestValue !== null && firstValue !== 0
        ? `확인된 첫해(${firstPrimaryRow.year}) 대비 마지막 해(${latestPrimaryRow.year}) 변화율: ${(((latestValue - firstValue) / Math.abs(firstValue)) * 100).toFixed(1)}%`
        : null,
      citation: citation(periodLabel(base), `손익계산서 > ${METRIC_LABELS[primary]}`, rcept),
      disclaimer: null,
      query: parsed,
    };
  }

  // 2) 올해/작년, 전년 대비, 증가·감소 원인 등 비교 질의.
  //    "올해"는 존재하지 않는 연간보고서를 강제로 만들지 않고 실제 최신 공시를 기준으로 한다.
  // 여러 지표만 나열한 질의는 같은 최신 보고기간의 값을 한 행에 묶습니다.
  // 연도 비교를 요청하지 않았는데 매출·영업이익을 임의로 전년 비교로 바꾸지 않습니다.
  if (metrics.length >= 2 && requestedYears.length < 2 && !parsed.recentYears && parsed.yearStart === null && parsed.analysis !== "cause" && !/(올해.*(?:작년|지난해)|(?:작년|지난해).*올해|전년대비|작년보다|지난해보다)/.test(question)) {
    const resolved = await resolvePeriod(corp, queryCandidates, fs, false, requestKey);
    if (!resolved) return fail(`${corp.name}의 최신 공시 재무제표를 찾을 수 없습니다.`);
    const effectiveFs = resolved.fs;
    const values: Record<string, number | null> = {};
    const units: Record<string, string> = {};
    const sources: Record<string,string> = {};
    const missing: string[] = [];
    for (const metric of metrics) {
      const result = await pickMetricWithOriginalFallback({ corp, rows: resolved.rows, period: resolved.period, basis: resolved.fs, metric, requestKey });
      const picked = result.picked;
      sources[metric] = pickedCitation(resolved.period,picked,resolved.rows,result.url);
      values[metric] = picked && Number.isFinite(picked.value) ? picked.value : null;
      units[metric] = picked?.unit ?? (["operatingMargin", "netMargin", "debtRatio", "currentRatio", "roe", "roa"].includes(metric) ? "%" : "억원");
      if (!picked || !Number.isFinite(picked.value)) missing.push(METRIC_LABELS[metric]);
    }
    if (metrics.every((metric) => values[metric] === null)) return fail(`${corp.name}의 ${periodLabel(resolved.period)}에서 ${missing.join(", ")} 자료를 찾지 못했습니다.`);
    const rcept = resolved.rows.find((row) => row.rcept_no)?.rcept_no ?? "";
    return {
      found: true as const,
      company: corp.name,
      period: `${periodLabel(resolved.period)} · ${modeLabel(resolved.period)} · 기준일 ${baseDate(resolved.period)}`,
      basis: fsLabel(resolved.fs),
      notice,
      metric: metrics.map((metric) => METRIC_LABELS[metric]).join(" · "),
      headline: metrics.map((metric) => `${METRIC_LABELS[metric]} ${values[metric] === null ? "자료 없음" : formatMetricValue(values[metric]!, units[metric])}`).join(" / "),
      lines: ["요청한 지표를 동일 보고기간 기준으로 조회했습니다.", ...(missing.length ? [`자료를 찾지 못한 지표: ${missing.join(", ")}`] : [])],
      matrix: [{ year: resolved.period.year, period: periodLabel(resolved.period), mode: modeLabel(resolved.period), basis:fsLabel(resolved.fs), values, units, sources, found: missing.length < metrics.length }],
      formula: null,
      citation: citation(periodLabel(resolved.period), `재무제표 > ${metrics.map((metric) => METRIC_LABELS[metric]).join("·")}`, rcept),
      disclaimer: null,
      query: parsed,
    };
  }

  const needsComparison = parsed.analysis === "comparison" || parsed.analysis === "cause" || /올해.*(?:작년|지난해)|(?:작년|지난해).*올해|전년대비|작년보다|지난해보다/.test(question);
  if (needsComparison) {
    const primary = metrics[0];
    let firstPeriod: Period;
    let secondPeriod: Period;
    if (requestedYears.length >= 2 || (parsed.yearStart !== null && parsed.yearEnd !== null)) {
      const firstYear = parsed.yearStart ?? requestedYears[0];
      const secondYear = parsed.yearEnd ?? requestedYears[requestedYears.length - 1];
      const kind = parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual";
      firstPeriod = P(firstYear, kind, parsed.mode ?? "cum");
      secondPeriod = P(secondYear, kind, parsed.mode ?? "cum");
    } else {
      const latest = await resolvePeriod(corp, queryCandidates, fs, false, requestKey);
      if (!latest) return fail(`${corp.name}의 최신 공시 재무제표를 찾을 수 없습니다.`);
      secondPeriod = latest.period;
      firstPeriod = P(latest.period.year - 1, latest.period.kind, latest.period.mode);
    }
    let pair: { firstRows: Row[]; secondRows: Row[]; fs: "CFS" | "OFS" } | null = null;
    const basisOrder: Array<"CFS" | "OFS"> = [fs];
    for (const basis of basisOrder) {
      const firstRows = await statements(corp.code, firstPeriod.year, firstPeriod.code, basis, false, requestKey);
      const secondRows = await statements(corp.code, secondPeriod.year, secondPeriod.code, basis, false, requestKey);
      if (firstRows?.length && secondRows?.length) { pair = { firstRows, secondRows, fs: basis }; break; }
    }
    if (!pair) return fail(`${corp.name}의 ${periodLabel(firstPeriod)}와 ${periodLabel(secondPeriod)}을 동일 연결/별도 기준으로 비교할 수 있는 공시를 찾지 못했습니다.`);
    const firstResult = await pickMetricWithOriginalFallback({ corp, rows: pair.firstRows, period: firstPeriod, basis: pair.fs, metric: primary, requestKey });
    const secondResult = await pickMetricWithOriginalFallback({ corp, rows: pair.secondRows, period: secondPeriod, basis: pair.fs, metric: primary, requestKey });
    const firstPicked = firstResult.picked;
    const secondPicked = secondResult.picked;
    if (!firstPicked || !secondPicked || !Number.isFinite(firstPicked.value) || !Number.isFinite(secondPicked.value)) return fail(`${corp.name}의 비교 기간에 ${METRIC_LABELS[primary]} 원천 계정이 확인되지 않아 계산하지 않았습니다.`);
    const diff = secondPicked.value - firstPicked.value;
    const pct = firstPicked.value === 0 ? null : (diff / Math.abs(firstPicked.value)) * 100;
    const direction = diff > 0 ? "증가" : diff < 0 ? "감소" : "변동 없음";
    const firstRcept = pair.firstRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const secondRcept = pair.secondRows.find((r) => r.rcept_no)?.rcept_no ?? "";
    const lines = [
      `${METRIC_LABELS[primary]} ${direction}: ${formatMetricValue(Math.abs(diff), secondPicked.unit)}${pct === null ? "" : ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}`,
      `${periodLabel(firstPeriod)} ${formatMetricValue(firstPicked.value, firstPicked.unit)} → ${periodLabel(secondPeriod)} ${formatMetricValue(secondPicked.value, secondPicked.unit)}`,
      `비교 기준: 같은 보고기간·${fsLabel(pair.fs)}`,
    ];
    let causeAnalysis: Awaited<ReturnType<typeof analyzeDisclosureCause>> | undefined;
    if (parsed.hasCauseIntent) {
      causeAnalysis = await analyzeDisclosureCause({ corpCode: corp.code, corpName: corp.name, currentRcept: secondRcept, previousRcept: firstRcept, currentYear: secondPeriod.year, previousYear: firstPeriod.year, metric: primary, currentPeriod: periodLabel(secondPeriod), previousPeriod: periodLabel(firstPeriod) }, requestKey);
      lines.push(causeAnalysis.summary);
      if (causeAnalysis.evidence.length) lines.push(...causeAnalysis.evidence.slice(0, 4).map((ev, i) => `공시 근거 ${i + 1} [${ev.reportPeriod}${ev.explicitCause ? " · 원인 직접 명시" : " · 관련 설명(직접 원인 미확인)"}]: ${ev.excerpt}`));
    }
    return {
      found: true as const, company: corp.name,
      period: `${periodLabel(firstPeriod)} vs ${periodLabel(secondPeriod)} · ${modeLabel(secondPeriod)}`,
      basis: fsLabel(pair.fs), notice, metric: METRIC_LABELS[primary],
      headline: `${formatMetricValue(firstPicked.value, firstPicked.unit)} → ${formatMetricValue(secondPicked.value, secondPicked.unit)}`,
      lines, formula: secondPicked.formula,
      citation: citation(periodLabel(secondPeriod), secondPicked.sourceHeading, secondRcept),
      citations: [{ reportName: periodLabel(firstPeriod), rceptNo: firstRcept, url: firstRcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${firstRcept}` : null }, { reportName: periodLabel(secondPeriod), rceptNo: secondRcept, url: secondRcept ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${secondRcept}` : null }],
      causeAnalysis, disclaimer: secondPicked.disclaimer, query: parsed,
    };
  }

  // 3) 단일 숫자 질의.
  const cands = queryCandidates;
  if (!cands.length) return fail("하반기만으로는 직접 조회할 수 없습니다. 1분기·반기·3분기·사업보고서 기준으로 질문해 주세요.");
  const resolved = await resolvePeriod(corp, cands, fs, false, requestKey);
  const metric = metrics[0];
  if (!resolved) {
    const fallbackPeriod = cands[0];
    if (fallbackPeriod) {
      const fallback = await externalFallbackForMetric({ name: corp.name, stock: corp.stock }, metric, fallbackPeriod, fs);
      if (fallback) return { found: true as const, company: corp.name, period: `${periodLabel(fallbackPeriod)} · 외부 보조자료`, basis: fsLabel(fs), notice, metric: METRIC_LABELS[metric], headline: formatMetricValue(fallback.value, fallback.unit), lines: [`외부 출처: ${fallback.source}`, `기간: ${fallback.periodLabel}`, `원천 계정: ${fallback.rawLabel}`, `값: ${formatMetricValue(fallback.value, fallback.unit)}`, "DART에서 동일 기간 재무제표를 확인하지 못해 외부 보조값을 표시했습니다."], formula: null, citation: `${fallback.source} (${fallback.url})`, disclaimer: "DART 원문을 확인하지 못한 외부 보조값입니다. DART 수치와 일치한다고 검증된 값은 아닙니다.", query: parsed, sourceType: "EXTERNAL_FALLBACK", crossValidation: fallback.validation };
    }
    return fail(`DART에서 해당 기간의 재무제표를 찾지 못했습니다. (${corp.name} · ${cands.map(periodLabel).join(" / ")} · ${fsLabel(fs)})`);
  }
  const { period, rows, fs: resolvedFs } = resolved;
  const rcept = rows.find((r) => r.rcept_no)?.rcept_no ?? "";
  const resolvedMetric = await pickMetricWithOriginalFallback({ corp, rows, period, basis: resolvedFs, metric, requestKey });
  const picked = resolvedMetric.picked;
  const leaseFallbackUrl = resolvedMetric.url;
  if (!picked || !Number.isFinite(picked.value)) {
    const fallback = await externalFallbackForMetric({ name: corp.name, stock: corp.stock }, metric, period, resolvedFs);
    if (fallback) return { found: true as const, company: corp.name, period: `${periodLabel(period)} · ${modeLabel(period)} · 외부 보조자료`, basis: fsLabel(resolvedFs), notice, metric: METRIC_LABELS[metric], headline: formatMetricValue(fallback.value, fallback.unit), lines: [`외부 출처: ${fallback.source}`, `기간: ${fallback.periodLabel}`, `원천 계정: ${fallback.rawLabel}`, `값: ${formatMetricValue(fallback.value, fallback.unit)}`, "DART 본문에서 같은 지표의 원천 계정을 확인하지 못해 외부 보조값을 표시했습니다."], formula: null, citation: `${fallback.source} (${fallback.url})`, disclaimer: "외부 보조값이며 DART 수치와 일치한다고 검증된 값은 아닙니다.", query: parsed, sourceType: "EXTERNAL_FALLBACK", crossValidation: fallback.validation };
    return fail(`${corp.name}의 '${METRIC_LABELS[metric]}' 계정을 ${periodLabel(period)}에서 찾지 못했습니다.`);
  }
  return {
    found: true as const,
    company: corp.name,
    period: `${periodLabel(period)} · ${modeLabel(period)} · 기준일 ${baseDate(period)}`,
    basis: fsLabel(resolvedFs),
    notice,
    metric: METRIC_LABELS[metric],
    headline: formatMetricValue(picked.value, picked.unit),
    lines: picked.lines,
    formula: picked.formula,
    citation: `${citation(periodLabel(period), picked.sourceHeading, rcept)}${leaseFallbackUrl ? ` · 리스부채 상세: ${leaseFallbackUrl}` : ""}`,
    disclaimer: picked.disclaimer,
    query: parsed,
  };
}

function metricKeyFromLabel(label: string): FinancialMetric | null {
  const normalized = label.replace(/[\s·ㆍ]/g, "");
  return (Object.keys(METRIC_LABELS) as FinancialMetric[]).find((metric) => METRIC_LABELS[metric] === normalized) ?? null;
}
function periodKindFromText(text: string, fallback: Kind = "annual"): Kind {
  if (/1\s*분기|1Q/i.test(text)) return "q1";
  if (/반기|상반기|2\s*분기|2Q/i.test(text)) return "half";
  if (/3\s*분기|3Q/i.test(text)) return "q3";
  if (/사업보고서|연간|12\s*월|4Q/i.test(text)) return "annual";
  return fallback;
}
function numericValueFromText(text: string): { value: number; unit: string } | null {
  const match = text.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(억원|원|%|배)/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? { value, unit: match[2] } : null;
}
function validationForUnsupportedPeriod(metric: FinancialMetric, value: number | null, unit: string, period: string, basis: "CFS" | "OFS", message: string): MetricCrossValidation {
  return {
    metric, metricLabel: METRIC_LABELS[metric], status: "NOT_COMPARABLE", dartValue: value, unit, period, basis, tolerancePct: 1.25,
    providers: [], checkedAt: new Date().toISOString(), message,
  };
}

/** 질문·비교·추이 답변에 DART 수치를 보존하고 네이버 금융의 출처·수치 차이를 덧붙입니다. */
export async function askDart(question: string, requestKey?: string) {
  const answer: any = await askDartCore(question, requestKey);
  if (answer?.sourceType === "EXTERNAL_FALLBACK" || answer?.sourceType === "EXTERNAL_CONSENSUS") return answer;
  if (!answer?.found || !answer.company || !answer.query) return answer;
  try {
    const corpsMap = await corps(false, requestKey);
    const corp = findCorp(String(answer.company), corpsMap);
    if (!corp) return { ...answer, crossValidationMessage: "기업코드를 확인하지 못해 보조자료를 조회하지 못했습니다." };
    const parsed: any = answer.query;
    const basis: "CFS" | "OFS" = /별도|개별/.test(String(answer.basis ?? "")) ? "OFS" : (parsed.basis ?? "CFS");
    const validations: MetricCrossValidation[] = [];
    const providerCompany = { name: corp.name, stock: corp.stock };
    // 추이 표는 각 연도·기간 셀에 대해 따로 검증합니다.
    if (Array.isArray(answer.matrix) && answer.matrix.length) {
      const matrix = [];
      for (const row of answer.matrix) {
        const rowKind = periodKindFromText(String(row.period ?? ""), parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual");
        const rowMode: "cum" | "qtr" = /당기\s*3개월|분기\s*단독/.test(String(row.mode ?? "")) ? "qtr" : (parsed.mode ?? "cum");
        const rowValidations: Record<string, MetricCrossValidation> = {};
        for (const [rawMetric, rawValue] of Object.entries(row.values ?? {})) {
          const metric = (Object.keys(METRIC_LABELS) as FinancialMetric[]).includes(rawMetric as FinancialMetric) ? rawMetric as FinancialMetric : metricKeyFromLabel(rawMetric);
          if (!metric) continue;
          const numericValue = typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
          const validation = await crossValidateMetric({ company: providerCompany, metric, dartValue: numericValue, unit: row.units?.[rawMetric], period: P(Number(row.year), rowKind, rowMode), basis });
          rowValidations[rawMetric] = validation;
          validations.push(validation);
        }
        matrix.push({ ...row, crossValidation: rowValidations });
      }
      return { ...answer, matrix, crossValidations: validations, crossValidationSummary: summarizeCrossValidation(validations) };
    }
    // 여러 기간의 시계열(연도별·분기별)도 행마다 검증하되, 동일 기간으로 구성되지 않으면 보류합니다.
    if (Array.isArray(answer.series) && answer.series.length) {
      const metric = (parsed.metrics?.[0] as FinancialMetric | undefined) ?? metricKeyFromLabel(String(answer.metric ?? ""));
      const series = [];
      if (metric) {
        for (const row of answer.series) {
          const periodText = String(row.period ?? row.mode ?? "");
          const kind = periodKindFromText(periodText, parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual");
          const matchQuarter = periodText.match(/\b([1-4])\s*Q/i);
          if (matchQuarter && matchQuarter[1] === "4") {
            const unverifiable = validationForUnsupportedPeriod(metric, row.value, String(row.unit ?? "억원"), periodText, basis, "4분기 파생값은 외부 출처의 연간/분기 차이를 같은 기준으로 재구성하지 못해 자동 일치 판정을 하지 않았습니다.");
            series.push({ ...row, crossValidation: unverifiable }); validations.push(unverifiable); continue;
          }
          const numericValue = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
          const validation = await crossValidateMetric({ company: providerCompany, metric, dartValue: numericValue, unit: String(row.unit ?? "억원"), period: P(Number(row.year), kind, /당기\s*3개월|분기\s*단독/.test(String(row.mode ?? "")) ? "qtr" : "cum"), basis });
          series.push({ ...row, crossValidation: validation }); validations.push(validation);
        }
      }
      return { ...answer, series, ...(validations.length ? { crossValidations: validations, crossValidationSummary: summarizeCrossValidation(validations) } : { crossValidationMessage: "시계열의 지표·기간을 정확히 대응시키지 못해 외부 검증을 완료하지 못했습니다." }) };
    }
    // 연도 간 비교 응답은 전·후 기간 값을 분리해 검증합니다.
    if (Array.isArray(answer.citations) && answer.citations.length >= 2 && String(answer.headline ?? "").includes("→")) {
      const metric = (parsed.metrics?.[0] as FinancialMetric | undefined) ?? metricKeyFromLabel(String(answer.metric ?? ""));
      const valueLine = (answer.lines ?? []).find((line: string) => String(line).includes("→"));
      const matchedValues = [...String(valueLine ?? "").matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*(억원|원|%|배)/g)];
      if (metric && matchedValues.length >= 2) {
        for (let i = 0; i < 2; i++) {
          const citationRow = answer.citations[i];
          const citedYear = String(citationRow.reportName ?? "").match(/(20\d{2})/);
          const year = Number(citedYear?.[1] ?? (i === 0 ? parsed.yearStart : parsed.yearEnd));
          if (!Number.isFinite(year) || year < 2000) continue;
          const periodText = String(citationRow.reportName ?? "");
          const kind = periodKindFromText(periodText, parsed.kind && parsed.kind !== "latest" ? parsed.kind : "annual");
          const value = Number(matchedValues[i][1].replace(/,/g, ""));
          const validation = await crossValidateMetric({ company: providerCompany, metric, dartValue: value, unit: matchedValues[i][2], period: P(year, kind, parsed.mode ?? "cum"), basis });
          validations.push(validation);
        }
      }
      return { ...answer, crossValidations: validations, crossValidationSummary: summarizeCrossValidation(validations) };
    }
    // 단일값 질의는 계산된 헤드라인과 쿼리 파서를 함께 사용합니다.
    const metricList = (parsed.metrics ?? []).filter((metric: unknown): metric is FinancialMetric => typeof metric === "string" && Object.prototype.hasOwnProperty.call(METRIC_LABELS, metric));
    const metric = metricList[0] ?? metricKeyFromLabel(String(answer.metric ?? ""));
    const headline = numericValueFromText(String(answer.headline ?? ""));
    const queryPeriod = periodCandidates(question)[0] ?? (parsed.kind && parsed.kind !== "latest" ? P(Number(parsed.yearEnd ?? parsed.years?.at(-1) ?? new Date().getFullYear()), parsed.kind, parsed.mode ?? "cum") : null);
    if (metric && queryPeriod) {
      const validation = await crossValidateMetric({ company: providerCompany, metric, dartValue: headline?.value ?? null, unit: headline?.unit, period: queryPeriod, basis });
      validations.push(validation);
      // 질문 응답 숫자를 외부 사이트 값으로 바꾸지 않습니다. 차이가 있으면 접힌 출처·산식에서 확인할 수 있습니다.
      return { ...answer, crossValidation: validation, crossValidationSummary: summarizeCrossValidation(validations) };
    }
    return { ...answer, crossValidationMessage: "답변은 DART 원문에서 조회했지만, 지표와 기간을 특정하지 못해 보조자료를 함께 표시하지 않았습니다." };
  } catch (error) {
    return { ...answer, crossValidationMessage: `보조자료 조회에 실패했습니다: ${error instanceof Error ? error.message : "조회 오류"}` };
  }
}

function summarizeCrossValidation(items: MetricCrossValidation[]) {
  const matched = items.filter((item) => item.status === "MATCH").length;
  const mismatched = items.filter((item) => item.status === "MISMATCH").length;
  const partial = items.filter((item) => item.status === "PARTIAL").length;
  const unverified = items.filter((item) => item.status === "UNAVAILABLE" || item.status === "NOT_COMPARABLE").length;
  return { checked: items.length, matched, mismatched, partial, unverified,
    status: mismatched ? "MISMATCH" : partial || unverified ? "PARTIAL" : items.length ? "MATCH" : "UNAVAILABLE",
    message: mismatched ? "네이버 금융 수치와 차이가 있는 항목이 있습니다. DART 원천값과 산식을 우선 확인합니다." : partial || unverified ? "일부 항목은 같은 기간·기준의 네이버 금융 자료가 없거나 계정 범위가 다릅니다." : items.length ? "조회 가능한 네이버 금융 수치는 DART 원천값과 허용 범위 안에 있습니다." : "조회할 수 있는 보조자료가 없습니다.",
  };
}

function formatMetricValue(value: number, unit: string) {
  if (!Number.isFinite(value)) return "자료 없음";
  if (unit === "%") return `${value.toFixed(1)}%`;
  if (unit === "원") return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
  // 억원 값은 소수점 첫째 자리까지 보존합니다. 정확한 원 단위 금액은 DART 원문 표에 별도로 남습니다.
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${unit}`;
}
