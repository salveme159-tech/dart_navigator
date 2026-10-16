export interface ServerMarketQuote {
  symbol: string;
  currentPrice: number;
  marketCapWon: number;
  marketCapEok: number;
  sharesOutstanding: number;
  fetchedAt: string;
  source: "YAHOO_FINANCE_LIVE" | "FALLBACK_CACHE";
}

export async function fetchYahooFinanceQuote(
  stockCode: string,
  corpCls: string = "Y"
): Promise<ServerMarketQuote | null> {
  if (!stockCode || !/^\d{6}$/.test(stockCode.trim())) {
    return null;
  }
  const suffix = corpCls === "K" ? "KQ" : "KS";
  const symbol = `${stockCode.trim()}.${suffix}`;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DisclosureNavigatorV6/1.0)",
      },
    });
    if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
    const data: any = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice || 0);
    if (!price) return null;

    const shares = Number(meta?.sharesOutstanding || 0);
    const marketCapWon = shares > 0 ? price * shares : 0;

    return {
      symbol,
      currentPrice: price,
      marketCapWon,
      marketCapEok: marketCapWon > 0 ? Math.round(marketCapWon / 100_000_000) : 0,
      sharesOutstanding: shares,
      fetchedAt: new Date().toISOString(),
      source: "YAHOO_FINANCE_LIVE",
    };
  } catch {
    return null;
  }
}

export function buildFactLockedResearchPrompt(verifiedPayloadJson: string): string {
  return [
    "당신은 DART 공시 원문과 검증된 실적표만을 기반으로 보고서를 작성하는 엄격한 재무 리서치 에이전트입니다.",
    "[절대 규칙]",
    "1. 제공된 JSON 수치 외에 새로운 사실을 마음대로 추가하거나 추측하지 마십시오.",
    "2. 특정 분기 이익 급감·급증의 구체적 원인이 제공된 공시 주석 데이터에 없다면 반드시 '원인은 공시로 특정되지 않는다'고 명시하십시오.",
    "3. '기간 순이익/평균자본'에 임의로 연율(×4)을 곱해 연간 ROE로 서술하지 마십시오.",
    "4. 연결 영업이익과 본체(별도) 영업이익의 차이(자회사·연결조정 몫) 변화를 명확히 짚어주십시오.",
    "",
    "[검증 완료 재무 기초자료 JSON]",
    verifiedPayloadJson,
  ].join("\n");
}