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
