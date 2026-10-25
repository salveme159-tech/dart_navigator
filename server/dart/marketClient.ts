export interface ServerMarketQuote {
  symbol: string;
  currentPrice: number;
  marketCapWon: number;
  marketCapEok: number;
  sharesOutstanding: number;
  fetchedAt: string;
  source: "NAVER_FINANCE_LIVE" | "FALLBACK_CACHE";
}

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[%,\s]/g, "").replace(/원$/, ""));
  return Number.isFinite(n) ? n : null;
};

/** 네이버 금융의 공개 모바일 API만 사용해 현재가·시가총액을 가져옵니다. */
export async function fetchNaverFinanceQuote(stockCode: string): Promise<ServerMarketQuote | null> {
  const stock = stockCode.trim();
  if (!/^\d{6}$/.test(stock)) return null;
  const symbol = stock;
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; DART-Navigator/1.0)",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  };

  try {
    const [basicResponse, integrationResponse] = await Promise.all([
      fetch(`https://m.stock.naver.com/api/stock/${stock}/basic`, { headers, signal: AbortSignal.timeout(7_000) }),
      fetch(`https://m.stock.naver.com/api/stock/${stock}/integration`, { headers, signal: AbortSignal.timeout(7_000) }),
    ]);
    if (!basicResponse.ok) return null;
    const basic: any = await basicResponse.json();
    const integration: any = integrationResponse.ok ? await integrationResponse.json().catch(() => null) : null;
    const currentPrice = parseNumeric(basic?.closePrice ?? basic?.currentPrice ?? basic?.tradePrice ?? basic?.lastClosePrice) ?? 0;
    if (currentPrice <= 0) return null;

    const totalInfos: any[] = Array.isArray(integration?.totalInfos) ? integration.totalInfos : [];
    const marketValueInfo = totalInfos.find((item) => /marketValue|marketCap|시가총액|시총/i.test(`${item?.code ?? ""} ${item?.key ?? ""} ${item?.title ?? ""}`));
    const marketCapText = String(marketValueInfo?.value ?? "").replace(/,/g, "").trim();
    let marketCapWon = 0;
    if (marketCapText) {
      const trillion = marketCapText.match(/([+-]?[\d.]+)\s*조/);
      const hundredMillion = marketCapText.match(/([+-]?[\d.]+)\s*억/);
      const million = marketCapText.match(/([+-]?[\d.]+)\s*백만/);
      if (trillion || hundredMillion || million) {
        marketCapWon = (trillion ? Number(trillion[1]) * 1_000_000_000_000 : 0)
          + (hundredMillion ? Number(hundredMillion[1]) * 100_000_000 : 0)
          + (million ? Number(million[1]) * 1_000_000 : 0);
      }
    }
    const shares = parseNumeric(basic?.listedShares ?? basic?.stockCount ?? basic?.sharesOutstanding ?? integration?.stockCount) ?? 0;
    if (marketCapWon <= 0 && shares > 0) marketCapWon = currentPrice * shares;
    const effectiveShares = shares > 0 ? shares : marketCapWon > 0 ? marketCapWon / currentPrice : 0;
    return {
      symbol,
      currentPrice,
      marketCapWon,
      marketCapEok: marketCapWon > 0 ? marketCapWon / 100_000_000 : 0,
      sharesOutstanding: effectiveShares,
      fetchedAt: new Date().toISOString(),
      source: "NAVER_FINANCE_LIVE",
    };
  } catch {
    return null;
  }
}

export function buildFactLockedResearchPrompt(verifiedPayloadJson: string): string {
  return [
    "당신은 DART 공시 원문과 확인된 실적표만을 기반으로 보고서를 작성하는 엄격한 재무 리서치 에이전트입니다.",
    "[절대 규칙]",
    "1. 제공된 JSON 수치 외에 새로운 사실을 마음대로 추가하거나 추측하지 마십시오.",
    "2. 특정 분기 이익 급감·급증의 구체적 원인이 제공된 공시 주석 데이터에 없다면 반드시 '원인은 공시로 특정되지 않는다'고 명시하십시오.",
    "3. '기간 순이익/평균자본'에 임의로 연율(×4)을 곱해 연간 ROE로 서술하지 마십시오.",
    "4. 연결 영업이익과 본체(별도) 영업이익의 차이(자회사·연결조정 몫) 변화를 명확히 짚어주십시오.",
    "",
    "[DART 원천 재무 기초자료 JSON]",
    verifiedPayloadJson,
  ].join("\n");
}
