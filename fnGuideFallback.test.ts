import { describe, expect, it } from "vitest";
import { extractFnGuideLeaseFixture, extractFnGuideMetricFixture } from "./fnGuideFallback";
import { P } from "./engine";

const html = `
<div>재무제표 IFRS(연결) 단위: 억원</div>
<table>
  <thead><tr><th>계정명</th><th>2023/12</th><th>2024/12</th><th>2025/12</th></tr></thead>
  <tbody>
    <tr><th>매출액</th><td>80</td><td>90</td><td>100</td></tr>
    <tr><th>영업이익</th><td>8</td><td>9</td><td>10</td></tr>
    <tr><th>당기순이익</th><td>4</td><td>5</td><td>6</td></tr>
    <tr><th>유동리스부채</th><td>8</td><td>9</td><td>10</td></tr>
    <tr><th>비유동리스부채</th><td>18</td><td>19</td><td>20</td></tr>
    <tr><th>EBITDA</th><td>12</td><td>13</td><td>15</td></tr>
  </tbody>
</table>
<div>재무제표 IFRS(연결) 분기</div>
<table>
  <thead><tr><th>계정명</th><th>2026/03</th><th>2026/06</th><th>2026/09</th></tr></thead>
  <tbody>
    <tr><th>매출액</th><td>30</td><td>40</td><td>50</td></tr>
    <tr><th>영업이익</th><td>3</td><td>4</td><td>5</td></tr>
    <tr><th>당기순이익</th><td>2</td><td>2.5</td><td>3</td></tr>
    <tr><th>유동리스부채</th><td>4</td><td>5</td><td>6</td></tr>
    <tr><th>비유동리스부채</th><td>8</td><td>9</td><td>10</td></tr>
    <tr><th>EBITDA</th><td>4</td><td>6</td><td>7</td></tr>
  </tbody>
</table>`;

describe("FnGuide fallback parser", () => {
  it("reads a same-date current and non-current lease liability and adds them once", () => {
    const result = extractFnGuideLeaseFixture(html, P(2026, "half", "cum"), "CFS");
    expect(result.current?.value).toBe(5);
    expect(result.noncurrent?.value).toBe(9);
    expect(result.total).toBe(14);
  });
  it("uses the exact quarter for a balance sheet and doesn't add prior columns", () => {
    const result = extractFnGuideLeaseFixture(html, P(2026, "q1", "cum"), "CFS");
    expect(result.current?.value).toBe(4);
    expect(result.noncurrent?.value).toBe(8);
    expect(result.total).toBe(12);
  });
  it("sums quarterly flow values for a cumulative half-year period", () => {
    const result = extractFnGuideMetricFixture(html, "revenue", P(2026, "half", "cum"), "CFS");
    expect(result?.value).toBe(70);
  });
  it("doesn't treat a quarterly column as an annual amount", () => {
    const result = extractFnGuideMetricFixture(html, "revenue", P(2026, "annual", "cum"), "CFS");
    expect(result).toBeNull();
  });
  it("reads EBITDA only when the requested reporting date exists", () => {
    const result = extractFnGuideMetricFixture(html, "ebitda", P(2025, "annual", "cum"), "CFS");
    expect(result?.value).toBe(15);
  });
});
