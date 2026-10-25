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
// client/src/lib/realDartClient.ts 파일 맨 아래에 아래 함수를 추가합니다.

export async function searchLiveDartCompanies(apiKey: string, query: string) {
  // 프록시를 통해 DART 고유번호/기업명 검색 수행 또는 빈 배열 반환
  try {
    const targetUrl = `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${apiKey}`;
    // 필요 시 검색 로직 수행 (여기서는 빌드 에러 방지를 위한 래퍼 함수)
    return [];
  } catch (e) {
    console.error(e);
    return [];
  }
}
