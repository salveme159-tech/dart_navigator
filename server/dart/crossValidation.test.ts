import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { P } from "./engine";
import {
  clearCrossValidationCache,
  crossValidateMetric,
  fetchNaverDebtFallback,
  parseNaverFinancialHighlight,
  parseNaverMobileFinance,
} from "./crossValidation";

const naverHtml = (basis: "연결" | "별도" = "연결") => `
<table>
  <thead><tr>
    <th>주요재무정보</th><th>2025/12 (IFRS${basis})</th><th>2024/12 (IFRS${basis})</th><th>2023/12 (IFRS${basis})</th>
  </tr></thead>
  <tbody>
    <tr><th>매출액</th><td>1,000</td><td>900</td><td>800</td></tr>
    <tr><th>영업이익</th><td>100</td><td>90</td><td>80</td></tr>
    <tr><th>당기순이익</th><td>70</td><td>60</td><td>50</td></tr>
    <tr><th>자산총계</th><td>2,000</td><td>1,900</td><td>1,800</td></tr>
    <tr><th>부채총계</th><td>1,200</td><td>1,150</td><td>1,100</td></tr>
    <tr><th>자본총계</th><td>800</td><td>750</td><td>700</td></tr>
    <tr><th>유동자산</th><td>900</td><td>850</td><td>800</td></tr>
    <tr><th>유동부채</th><td>500</td><td>480</td><td>460</td></tr>
    <tr><th>영업활동현금흐름</th><td>120</td><td>110</td><td>100</td></tr>
    <tr><th>투자활동현금흐름</th><td>-60</td><td>-50</td><td>-40</td></tr>
    <tr><th>재무활동현금흐름</th><td>20</td><td>15</td><td>10</td></tr>
    <tr><th>유형자산의 취득</th><td>-30</td><td>-25</td><td>-20</td></tr>
    <tr><th>기본주당순이익</th><td>700</td><td>600</td><td>500</td></tr>
    <tr><th>영업이익률</th><td>10.0%</td><td>10.0%</td><td>10.0%</td></tr>
  </tbody>
</table>`;

beforeEach(() => {
  clearCrossValidationCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DART 재무 수치의 네이버 금융 보조 확인", () => {
  it("네이버 Financial Highlight에서 같은 열의 여러 지표를 모두 파싱한다", () => {
    const parsed = parseNaverFinancialHighlight(naverHtml("연결"), "CFS", "annual");
    expect(parsed.basis).toBe("CFS");
    expect(parsed.observations.find((item) => item.key === "revenue" && item.year === 2025)?.month).toBe(12);
    expect(parsed.observations.find((item) => item.key === "revenue" && item.year === 2025)?.value).toBe(1000);
    expect(parsed.observations.find((item) => item.key === "operatingProfit" && item.year === 2025)?.value).toBe(100);
    expect(parsed.observations.find((item) => item.key === "netIncome" && item.year === 2025)?.value).toBe(70);
    expect(parsed.observations.find((item) => item.key === "operatingCashFlow" && item.year === 2025)?.value).toBe(120);
    expect(parsed.observations.find((item) => item.key === "eps" && item.year === 2025)?.value).toBe(700);
  });

  it("네이버의 일반 '차입금' 행을 리스 포함 총차입금으로 오인하지 않는다", () => {
    const html = `<table><thead><tr><th>주요재무정보</th><th>2025/12 (IFRS연결)</th><th>2024/12 (IFRS연결)</th></tr></thead><tbody>
      <tr><th>차입금</th><td>1,100</td><td>1,000</td></tr>
      <tr><th>자산총계</th><td>2,000</td><td>1,900</td></tr>
    </tbody></table>`;
    const parsed = parseNaverFinancialHighlight(html, "CFS", "annual");
    expect(parsed.observations.some((item) => item.key === "borrowings")).toBe(false);
  });

  it("연간 수치를 찾을 때 12월 분기값을 연간 합계로 잘못 대체하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" }, metric: "revenue", dartValue: 1000,
      unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.source).toBe("NAVER_FINANCE");
    expect(result.providers[0]?.value).toBe(1000);
  });

  it("재무 수치 보조 조회는 네이버 금융만 사용한다", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("c1010001.aspx")) {
        return new Response("<html><script>var options = { encparam: 'test-enc', id: 'test-id' };</script></html>", { status: 200 });
      }
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" }, metric: "revenue", dartValue: 1000,
      unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    const annualUrl = urls.find((url) => url.includes("cF1001.aspx") && url.includes("freq_typ=Y"));
    expect(annualUrl).toContain("encparam=test-enc");
    expect(annualUrl).toContain("id=test-id");
    expect(urls.some((url) => url.includes("query1.finance.yahoo.com"))).toBe(false);
  });

  it("같은 기간의 네이버 금융 값만 비교하고 DART 원천값을 유지한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" },
      metric: "revenue", dartValue: 1000, unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0]?.source).toBe("NAVER_FINANCE");
    expect(result.providers[0]?.value).toBe(1000);
    expect(result.status).toBe("MATCH");
  });

  it("반기 누계 영업이익률은 분기 이익률을 더하지 않고 누계 영업이익÷누계 매출로 재계산한다", async () => {
    const quarterlyNaver = `<table><thead><tr><th>주요재무정보</th><th>2026/06 (IFRS연결)</th><th>2026/03 (IFRS연결)</th><th>2025/12 (IFRS연결)</th></tr></thead><tbody>
      <tr><th>매출액</th><td>100</td><td>100</td><td>1,000</td></tr><tr><th>영업이익</th><td>6</td><td>5</td><td>100</td></tr><tr><th>영업이익률</th><td>6.0%</td><td>5.0%</td><td>10.0%</td></tr>
    </tbody></table>`;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx") && url.includes("freq_typ=Q")) return new Response(quarterlyNaver, { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" }, metric: "operatingMargin", dartValue: 5.5,
      unit: "%", period: P(2026, "half"), basis: "CFS",
    });
    expect(result.providers.find((provider) => provider.source === "NAVER_FINANCE")?.value).toBe(5.5);
    expect(result.providers).toHaveLength(1);
    expect(result.providers.find((provider) => provider.source === "NAVER_FINANCE")?.period).toContain("2026/03 + 2026/06");
  });

  it("외부 값과 DART 값이 다르면 MISMATCH를 반환하고 값을 덮어쓰지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" },
      metric: "revenue", dartValue: 1200, unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    expect(result.status).toBe("MISMATCH");
    expect(result.dartValue).toBe(1200);
    expect(result.providers.every((provider) => provider.value === 1000)).toBe(true);
  });

  it("DART 수치가 없더라도 외부 원수치는 참고값으로 노출하되 MATCH로 표시하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" }, metric: "revenue", dartValue: null, unit: "억원",
      period: P(2025, "annual"), basis: "CFS",
    });
    expect(result.status).toBe("NOT_COMPARABLE");
    expect(result.dartValue).toBeNull();
    expect(result.providers.every((provider) => provider.status !== "MATCH")).toBe(true);
    expect(result.providers.some((provider) => provider.found && provider.value === 1000)).toBe(true);
    expect(result.message).toContain("보조 정보");
  });

  it("네이버 모바일 재무표에 차입금 행이 없으면 Financial Highlight 표를 추가 조회해 필요한 행을 보완한다", async () => {
    const mobilePayload = {
      financeInfo: {
        fsDiv: "CFS",
        trTitleList: [{ title: "2025.12.", key: "202512", isConsensus: "N" }],
        rowList: [{ title: "매출액", columns: { "202512": { value: "1000" } } }],
      },
    };
    const legacyDebt = `<table><thead><tr><th>주요재무정보</th><th>2025/12 (IFRS연결)</th><th>2024/12 (IFRS연결)</th></tr></thead><tbody>
      <tr><th>매출액</th><td>1,000</td><td>900</td></tr><tr><th>총차입금</th><td>120</td><td>110</td></tr>
      <tr><th>유동리스부채</th><td>10</td><td>9</td></tr><tr><th>비유동리스부채</th><td>20</td><td>19</td></tr>
    </tbody></table>`;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/finance/annual")) return new Response(JSON.stringify(mobilePayload), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/finance/quarter")) return new Response(JSON.stringify({ financeInfo: { fsDiv: "CFS", trTitleList: [], rowList: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("c1010001.aspx")) return new Response(`<html><script>var options = { encparam: 'test-enc', id: 'test-id' };</script></html>`, { status: 200 });
      if (url.includes("cF1001.aspx") && url.includes("freq_typ=Y")) return new Response(legacyDebt, { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response("<table></table>", { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" }, metric: "borrowings", dartValue: 120,
      unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    const provider = result.providers.find((item) => item.source === "NAVER_FINANCE");
    expect(provider?.found).toBe(true);
    expect(provider?.value).toBe(120);
    // 총차입금의 리스 포함 범위는 네이버 행만으로 확정할 수 없으므로 숫자는 읽되 '일치'로 과장하지 않습니다.
    expect(provider?.status).toBe("NOT_COMPARABLE");
  });

  it("네이버에서 유동 리스부채 한쪽만 찾았다고 총리스부채로 확정하지 않는다", async () => {
    const payload = {
      financeInfo: {
        fsDiv: "CFS",
        trTitleList: [{ title: "2025.12.", key: "202512", isConsensus: "N" }],
        rowList: [
          { title: "유동리스부채", columns: { "202512": { value: "55.6" } } },
        ],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/finance/annual")) return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/finance/quarter")) return new Response(JSON.stringify({ financeInfo: { trTitleList: [], rowList: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("c1010001.aspx")) return new Response("<html><body></body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response("<html></html>", { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await fetchNaverDebtFallback({ name: "테스트상장사", stock: "123456" }, P(2025, "annual"), "CFS");
    expect(result.current?.value).toBe(55.6);
    expect(result.noncurrent).toBeNull();
    expect(result.totalLease).toBeNull();
  });

  it("차입금 범위나 계정 정의가 동일한지 확인되지 않으면 일치로 표시하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("c1010001.aspx")) return new Response("<html><body>Financial Summary</body></html>", { status: 200 });
      if (url.includes("cF1001.aspx")) return new Response(naverHtml("연결"), { status: 200 });
      return new Response("not found", { status: 404 });
    }));
    const result = await crossValidateMetric({
      company: { name: "테스트상장사", stock: "123456" },
      metric: "borrowings", dartValue: 100, unit: "억원", period: P(2025, "annual"), basis: "CFS",
    });
    expect(result.status).toBe("NOT_COMPARABLE");
    expect(result.providers.every((provider) => provider.status !== "MATCH")).toBe(true);
  });
});
