// client/src/lib/realDartClient.ts

// 공개 CORS 프록시 배열 (브라우저 CORS 제한 우회용)
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

async function fetchWithCorsProxy(targetUrl: string) {
  let lastError = null;
  for (const getProxyUrl of CORS_PROXIES) {
    try {
      const proxyUrl = getProxyUrl(targetUrl);
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data.status !== 'undefined') {
        return data;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("모든 CORS 프록시 통신에 실패했습니다.");
}

export async function fetchDartCompanyInfo(apiKey: string, corpCode: string) {
  const targetUrl = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${apiKey}&corp_code=${corpCode}`;
  return await fetchWithCorsProxy(targetUrl);
}

export async function fetchDartFinancials(apiKey: string, corpCode: string, bsnsYear: string, reprtCode: string = "11011") {
  const targetUrl = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reprtCode}`;
  return await fetchWithCorsProxy(targetUrl);
}

export async function fetchDartFilings(apiKey: string, corpCode: string, pageCount: string = "10") {
  const targetUrl = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&page_count=${pageCount}`;
  return await fetchWithCorsProxy(targetUrl);
}

export async function searchLiveDartCompanies(apiKey: string, query: string) {
  try {
    return [];
  } catch (e) {
    return [];
  }
}

// Home.tsx 및 기타 컴포넌트에서 요구하는 상수 및 타입 정의 (언더바 오타 수정 완료)
export const EMPTY_DART_RECORD = {
  corp_code: "",
  corp_name: "",
  stock_code: "",
  modify_date: "",
  revenue: 0,
  operating_income: 0,
  net_income: 0,
  total_assets: 0,
  total_liabilities: 0,
  total_equity: 0,
};

export const INITIAL_DART_COMPANIES = [
  { name: "삼성전자", code: "005930", corpCode: "00126380" },
  { name: "SK하이닉스", code: "000660", corpCode: "00164779" },
  { name: "현대자동차", code: "005380", corpCode: "00164742" }
];

export type CompanyFinancialRecord = typeof EMPTY_DART_RECORD;
export type QuarterlyOnePagerItem = any;

export async function validateDartApikey(apiKey: string): Promise<boolean> {
  try {
    const data = await fetchDartCompanyInfo(apiKey, "00126380");
    return data && data.status === "000";
  } catch {
    return false;
  }
}
