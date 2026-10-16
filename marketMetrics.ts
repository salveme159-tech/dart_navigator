/** Price-based metrics are calculated only from dated, explicitly sourced inputs. No scraping. */
export type MarketObservation = { price: number; priceDate: string; source: string; adjusted: boolean; currency: string };
export type MarketMetricResult = { value: number; formula: string; source: string; date: string } | { error: string };
export function calculatePER(quote: MarketObservation, trailingEPS: number, epsCurrency: string): MarketMetricResult {
  if(!quote.source || !/^\d{4}-\d{2}-\d{2}$/.test(quote.priceDate)) return {error:'가격 기준일과 출처가 필요합니다.'};
  if(!Number.isFinite(quote.price) || quote.price<=0 || !Number.isFinite(trailingEPS) || trailingEPS<=0) return {error:'양의 주가와 최근 12개월 EPS가 필요합니다. 적자기업 PER은 계산하지 않습니다.'};
  if(quote.currency!==epsCurrency) return {error:'주가와 EPS 통화가 다릅니다.'};
  return {value:quote.price/trailingEPS,formula:'기준일 주가 ÷ 최근 12개월 EPS',source:quote.source,date:quote.priceDate};
}
export function calculatePBR(quote: MarketObservation, bps: number, bpsCurrency: string): MarketMetricResult {
  if(!quote.source || !/^\d{4}-\d{2}-\d{2}$/.test(quote.priceDate)) return {error:'가격 기준일과 출처가 필요합니다.'};
  if(!Number.isFinite(quote.price)||quote.price<=0||!Number.isFinite(bps)||bps<=0) return {error:'양의 주가와 주당순자산이 필요합니다.'};
  if(quote.currency!==bpsCurrency) return {error:'주가와 BPS 통화가 다릅니다.'};
  return {value:quote.price/bps,formula:'기준일 주가 ÷ 기준 재무제표 BPS',source:quote.source,date:quote.priceDate};
}
export function calculateROA(netIncome: number, assetsEnd: number, assetsPreviousEnd: number): MarketMetricResult {
  const avg=(assetsEnd+assetsPreviousEnd)/2;
  if(![netIncome,assetsEnd,assetsPreviousEnd].every(Number.isFinite)||avg<=0) return {error:'순이익과 양의 평균총자산이 필요합니다.'};
  return {value:netIncome/avg*100,formula:'기간 누적 순이익 ÷ (당기말 총자산 + 전기말 총자산)/2 × 100; 연환산 아님',source:'입력된 공시 데이터',date:'보고기간'};
}
