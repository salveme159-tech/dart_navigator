// client/src/lib/apiBase.ts

export function getApiBaseUrl(): string {
  // 브라우저 환경에서는 별도의 백엔드 서버 대신 빈 문자열 또는 프록시 기본값 반환
  return "";
}

export async function apiFetch(endpoint: string, options?: RequestInit) {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const response = await fetch(url, options);
  return response;
}
