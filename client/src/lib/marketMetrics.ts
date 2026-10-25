import { QuarterlyFinancialPoint } from "./financialVerification";

export interface MarketQuotePayload {
  symbol: string;
  currentPrice: number;
  marketCapWon: number;
  marketCapEok: number;
  sharesOutstanding: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  fetchedAt: string;
  source: "NAVER_FINANCE_LIVE" | "FALLBACK_CACHE";
}

export interface ComputedValuationMetrics {
  periodRoePct: number | null;
  ttmRoePct: number | null;
  periodRoaPct: number | null;
  ttmRoaPct: number | null;
  operatingMarginPct: number;
  grossMarginPct: number | null;
  debtToEquityPct: number | null;
  subsidiaryOpSharePct: number | null;
  perTtm: number | null;
  pbrLatest: number | null;
  epsTtmWon: number | null;
  bpsLatestWon: number | null;
  marketCapEok: number | null;
  currentPriceWon: number | null;
  methodologyNote: string;
}

export function computeFullMetrics(
  quarters: QuarterlyFinancialPoint[],
  quote?: MarketQuotePayload | null
): ComputedValuationMetrics {
  const actuals = quarters.filter((q) => !q.isEstimate);
  const latest = actuals[actuals.length - 1];
  const prev = actuals.length > 1 ? actuals[actuals.length - 2] : latest;
  const last4 = actuals.slice(-4);

  if (!latest) {
    return {
      periodRoePct: null,
      ttmRoePct: null,
      periodRoaPct: null,
      ttmRoaPct: null,
      operatingMarginPct: 0,
      grossMarginPct: null,
      debtToEquityPct: null,
      subsidiaryOpSharePct: null,
      perTtm: null,
      pbrLatest: null,
      epsTtmWon: null,
      bpsLatestWon: null,
      marketCapEok: null,
      currentPriceWon: null,
      methodologyNote: "실측 분기 데이터 없음",
    };
  }

  const avgEquity =
    latest.totalEquity && prev?.totalEquity
      ? (latest.totalEquity + prev.totalEquity) / 2
      : latest.totalEquity ?? null;

  const avgAssets =
    latest.totalAssets && prev?.totalAssets
      ? (latest.totalAssets + prev.totalAssets) / 2
      : latest.totalAssets ?? null;

  const ttmNetIncomeEok =
    last4.length === 4 ? last4.reduce((acc, q) => acc + q.netIncome, 0) : null;

  const periodRoePct =
    avgEquity && avgEquity > 0
      ? Number(((latest.netIncome / avgEquity) * 100).toFixed(2))
      : null;

  const ttmRoePct =
    avgEquity && avgEquity > 0 && ttmNetIncomeEok !== null
      ? Number(((ttmNetIncomeEok / avgEquity) * 100).toFixed(2))
      : null;

  const periodRoaPct =
    avgAssets && avgAssets > 0
      ? Number(((latest.netIncome / avgAssets) * 100).toFixed(2))
      : null;

  const ttmRoaPct =
    avgAssets && avgAssets > 0 && ttmNetIncomeEok !== null
      ? Number(((ttmNetIncomeEok / avgAssets) * 100).toFixed(2))
      : null;

  const operatingMarginPct =
    latest.revenue > 0
      ? Number(((latest.operatingProfit / latest.revenue) * 100).toFixed(1))
      : 0;

  const grossMarginPct =
    latest.revenue > 0 && typeof latest.grossProfit === "number"
      ? Number(((latest.grossProfit / latest.revenue) * 100).toFixed(1))
      : null;

  const debtToEquityPct =
    latest.totalLiabilities && latest.totalEquity && latest.totalEquity > 0
      ? Number(((latest.totalLiabilities / latest.totalEquity) * 100).toFixed(1))
      : null;

  const subsidiaryOpSharePct =
    typeof latest.subsidiaryAndAdjProfit === "number" && latest.operatingProfit > 0
      ? Number(((latest.subsidiaryAndAdjProfit / latest.operatingProfit) * 100).toFixed(1))
      : null;

  let perTtm: number | null = null;
  let pbrLatest: number | null = null;
  let epsTtmWon: number | null = null;
  let bpsLatestWon: number | null = null;

  if (quote && quote.marketCapEok > 0) {
    if (ttmNetIncomeEok && ttmNetIncomeEok > 0) {
      perTtm = Number((quote.marketCapEok / ttmNetIncomeEok).toFixed(2));
    }
    if (latest.totalEquity && latest.totalEquity > 0) {
      pbrLatest = Number((quote.marketCapEok / latest.totalEquity).toFixed(2));
    }
    if (quote.sharesOutstanding > 0) {
      if (ttmNetIncomeEok !== null) {
        epsTtmWon = Math.round((ttmNetIncomeEok * 100_000_000) / quote.sharesOutstanding);
      }
      if (latest.totalEquity) {
        bpsLatestWon = Math.round((latest.totalEquity * 100_000_000) / quote.sharesOutstanding);
      }
    }
  }

  return {
    periodRoePct,
    ttmRoePct,
    periodRoaPct,
    ttmRoaPct,
    operatingMarginPct,
    grossMarginPct,
    debtToEquityPct,
    subsidiaryOpSharePct,
    perTtm,
    pbrLatest,
    epsTtmWon,
    bpsLatestWon,
    marketCapEok: quote?.marketCapEok ?? null,
    currentPriceWon: quote?.currentPrice ?? null,
    methodologyNote:
      "기간 ROE·ROA는 분기 순이익/평균자본(자산) 원값이며 임의 연율화(×4)를 하지 않음. 연간 환산이 필요한 경우 최근 4개 분기 합산(TTM) 지표를 별도 병기함.",
  };
}