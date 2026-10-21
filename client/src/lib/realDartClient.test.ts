import { describe, expect, it } from "vitest";
import { parseDartFullStatementRows, type RawDartRow } from "./realDartClient";

describe("DART 재무제표 기준별 계정 선택", () => {
  const rows: RawDartRow[] = [
    { sj_div: "IS", account_nm: "매출액", account_id: "ifrs-full_Revenue", thstrm_amount: "900000000000", thstrm_add_amount: "900000000000" },
    { sj_div: "CIS", account_nm: "매출액", account_id: "ifrs-full_Revenue", thstrm_amount: "1000000000000", thstrm_add_amount: "1000000000000" },
    { sj_div: "IS", account_nm: "영업이익", account_id: "dart_OperatingIncomeLoss", thstrm_amount: "50000000000", thstrm_add_amount: "50000000000" },
    { sj_div: "CIS", account_nm: "영업이익", account_id: "dart_OperatingIncomeLoss", thstrm_amount: "70000000000", thstrm_add_amount: "70000000000" },
    { sj_div: "IS", account_nm: "당기순이익(손실)", account_id: "ifrs-full_ProfitLoss", thstrm_amount: "20000000000", thstrm_add_amount: "20000000000" },
    { sj_div: "CIS", account_nm: "당기순이익(손실)", account_id: "ifrs-full_ProfitLoss", thstrm_amount: "-30000000000", thstrm_add_amount: "-30000000000" },
  ];
  it("연결 기준은 CIS를, 별도 기준은 IS를 우선한다", () => {
    expect(parseDartFullStatementRows(rows, "CFS").매출액).toBe(10000);
    expect(parseDartFullStatementRows(rows, "CFS").영업이익).toBe(700);
    expect(parseDartFullStatementRows(rows, "CFS").순이익).toBe(-300);
    expect(parseDartFullStatementRows(rows, "OFS").매출액).toBe(9000);
    expect(parseDartFullStatementRows(rows, "OFS").영업이익).toBe(500);
    expect(parseDartFullStatementRows(rows, "OFS").순이익).toBe(200);
  });
});
