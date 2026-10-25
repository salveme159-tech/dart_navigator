import { describe, expect, it } from "vitest";
import { P } from "./engine";
import { parseDepreciationFromDisclosure, parseLeaseLiabilitiesFromDisclosure } from "./disclosureNotes";

describe("DART 원문 주석 리스부채 파서", () => {
  it("반기말 표의 유동·비유동 리스부채를 단위 변환해 합산한다", () => {
    const html = `
      <p>9. 리스부채</p><p>(단위: 백만원)</p>
      <table>
        <tr><th>구분</th><th colspan="2">당반기말</th><th colspan="2">전기말</th></tr>
        <tr><th></th><th>유동</th><th>비유동</th><th>유동</th><th>비유동</th></tr>
        <tr><td>리스부채</td><td>5,560</td><td>5,800</td><td>5,120</td><td>5,650</td></tr>
      </table>`;
    const result = parseLeaseLiabilitiesFromDisclosure([{ name: "notes.html", text: html }], P(2026, "half"));
    expect(result?.current).toBeCloseTo(55.6, 6);
    expect(result?.noncurrent).toBeCloseTo(58.0, 6);
    expect(result?.total).toBeCloseTo(113.6, 6);
  });

  it("리스 만기분석표의 미할인 계약상 현금흐름은 부채 잔액으로 채택하지 않는다", () => {
    const html = `
      <p>리스부채 만기분석 (단위: 백만원)</p>
      <table>
        <tr><th>리스료 만기</th><th>당반기말</th></tr>
        <tr><td>미할인 리스료 합계</td><td>20,000</td></tr>
      </table>`;
    const result = parseLeaseLiabilitiesFromDisclosure([{ name: "notes.html", text: html }], P(2026, "half"));
    expect(result).toBeNull();
  });

  it("유동 또는 비유동 한쪽만 있는 표는 총액을 만들어내지 않는다", () => {
    const html = `
      <p>리스부채 (단위: 억원)</p>
      <table>
        <tr><th>구분</th><th>당반기말</th></tr>
        <tr><td>유동리스부채</td><td>55.6</td></tr>
      </table>`;
    const result = parseLeaseLiabilitiesFromDisclosure([{ name: "notes.html", text: html }], P(2026, "half"));
    expect(result).toBeNull();
  });
});


describe("DART 원문 주석 감가상각비 파서", () => {
  it("반기 누계 열의 유형·무형 상각비를 같은 기간·단위로 합산한다", () => {
    const html = `
      <p>비용의 성격별 분류 (단위: 백만원)</p>
      <table>
        <tr><th>비용 항목</th><th>당반기 누계</th><th>전반기 누계</th></tr>
        <tr><td>감가상각비</td><td>2,000</td><td>1,800</td></tr>
        <tr><td>무형자산상각비</td><td>800</td><td>650</td></tr>
      </table>`;
    const result = parseDepreciationFromDisclosure([{ name: "notes.html", text: html }], P(2026, "half"));
    expect(result?.value).toBeCloseTo(28, 6);
    expect(result?.lines).toHaveLength(2);
  });

  it("한 개 상각 계정만 있는 경우 완전한 EBITDA 구성값으로 사용하지 않는다", () => {
    const html = `
      <p>비용의 성격별 분류 (단위: 백만원)</p>
      <table>
        <tr><th>비용 항목</th><th>당반기 누계</th><th>전반기 누계</th></tr>
        <tr><td>감가상각비</td><td>2,000</td><td>1,800</td></tr>
      </table>`;
    const result = parseDepreciationFromDisclosure([{ name: "notes.html", text: html }], P(2026, "half"));
    expect(result).toBeNull();
  });
});
