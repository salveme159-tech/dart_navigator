// Snapshot cards and comparison cells select these raw accounts through the same engine.
export const COMPARISON_ACCOUNT_METRICS = {
  totalAssets: "자산총계",
  totalLiabilities: "부채총계",
  totalEquity: "자본총계",
  currentAssets: "유동자산",
  currentLiabilities: "유동부채",
  cashAndCashEquivalents: "현금및현금성자산",
  shortTermFinancialAssets: "단기금융상품",
  inventories: "재고자산",
  financeCosts: "금융원가",
} as const;

export type AccountComparisonMetric = keyof typeof COMPARISON_ACCOUNT_METRICS;
export type ExtraComparisonMetric = AccountComparisonMetric | "assetTurnover";
export const EXTRA_COMPARISON_METRIC_IDS = [...Object.keys(COMPARISON_ACCOUNT_METRICS), "assetTurnover"] as ExtraComparisonMetric[];
export const COMPARISON_METRIC_BY_LABEL = Object.fromEntries([
  ...Object.entries(COMPARISON_ACCOUNT_METRICS).map(([id, label]) => [label, id]),
  ["자산회전율", "assetTurnover"],
]) as Record<string, ExtraComparisonMetric>;

export function isExtraComparisonMetric(metric: string): metric is ExtraComparisonMetric {
  return metric === "assetTurnover" || Object.prototype.hasOwnProperty.call(COMPARISON_ACCOUNT_METRICS, metric);
}
