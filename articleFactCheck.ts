export type FactCheckInput = {
  article: string;
  company: string;
  year: number;
  period: "annual" | "half" | "q1" | "q3";
  mode: "cum" | "qtr";
  basis: "CFS" | "OFS";
  articleDate: string;
  contractReceipt?: string;
};
export type FactClaim = {
  id: number; start: number; end: number; text: string; sentence: string;
  company: string; label: string; value: number; unit: string;
  year: number; period: FactCheckInput["period"]; mode: "cum" | "qtr"; basis: "CFS" | "OFS";
  metric?: string; growth?: "increase" | "decrease"; approximate: boolean; tolerance: number;
  status: "MATCH" | "MISMATCH" | "UNVERIFIED";
  actual: number | null; actualText: string; message: string;
  sourceUrl?: string; sourceLabel?: string; basisLabel?: string;
};
export type FactCheckResult = {
  article: string; claims: FactClaim[]; checkedAt: string;
  summary: { matched: number; mismatched: number; unverified: number };
  contractCandidates: Array<{ company: string; reportName: string; rceptNo: string; receiptDate: string; url: string }>;
  warnings: string[];
};
