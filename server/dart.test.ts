import { describe, expect, it } from "vitest";
import { DISCLAIMER, fsDivFor, netDebt, normalizeQuestion, chunkByHeading, type Row } from "./dart/engine";

const bs = (nm: string, v: number): Row => ({ sj_div: "BS", account_nm: nm, thstrm_amount: String(v * 1e8) });
describe("DART-Copilot engine", () => {
  it("연결 기본, 별도·개별 키워드만 OFS", () => {
    expect(fsDivFor("삼성전자 순차입금")).toBe("CFS");
    expect(fsDivFor("삼성전자 별도 순차입금")).toBe("OFS");
  });
  it("순차입금: 리스부채 제외, 전환사채 포함, 단기금융상품 차감", () => {
    const r = netDebt([bs("단기차입금", 100), bs("장기차입금", 200), bs("전환사채", 50), bs("리스부채", 999), bs("현금및현금성자산", 80), bs("단기금융상품", 20)]);
    expect(r.ok && r.value).toBe(250);
    expect(r.ok && r.disclaimer).toBe(DISCLAIMER);
  });
  it("약어 정규화와 주석 목차 캡처", () => {
    expect(normalizeQuestion("(주)삼전 순차입금")).toContain("삼성전자");
    expect(chunkByHeading("14. 차입금 내역\n내용")[0].heading).toBe("14. 차입금 내역");
  });
});

import { amountOf, periodCandidates, looksLikeCompany } from "./dart/engine";
describe("기간·기본기업", () => {
  const now = new Date("2026-10-05");
  it("상반기 → 반기보고서(11012) 누적", () => {
    const [p] = periodCandidates("대한전선 2026년 상반기 연결 기준 매출액", now);
    expect([p.year, p.code, p.mode]).toEqual([2026, "11012", "cum"]);
  });
  it("기간 미지정 → 최신 분기부터 시도, 과거 연도 명시 → 사업보고서", () => {
    expect(periodCandidates("매출액", now).map((p) => p.code)).toEqual(["11014", "11012", "11013", "11011"]);
    expect(periodCandidates("2025년 매출액", now)[0].code).toBe("11011");
  });
  it("누적 금액과 기업명 판별", () => {
    expect(amountOf({ thstrm_amount: "100000000", thstrm_add_amount: "250000000" }, 0, true)).toBe(2.5);
    expect(looksLikeCompany("LS전선 매출")).toBe(true);
    expect(looksLikeCompany("2026년 상반기 매출액")).toBe(false);
  });
});

import { searchCorps, periodFromFilters } from "./dart/engine";
describe("기업 검색·비교 기간", () => {
  const corps = new Map([
    ["대한전선", { code: "001", stock: "001440" }],
    ["대한전선홀딩스", { code: "002", stock: "002440" }],
    ["삼성전자", { code: "003", stock: "005930" }],
  ]);
  it("기업명 검색은 DART 공식명과 종목코드를 함께 찾는다", () => {
    expect(searchCorps("대한전선", corps, 5)[0].name).toBe("대한전선");
    expect(searchCorps("005930", corps, 5)[0].name).toBe("삼성전자");
  });
  it("비교 기간 필터는 동일한 보고서 후보를 만든다", () => {
    const [p] = periodFromFilters(2025, "annual", new Date("2026-10-05"));
    expect([p.year, p.code]).toEqual([2025, "11011"]);
  });
});

import { parseDartQuery } from "./dart/engine";
describe("자연어 질의 파서", () => {
  it("최근 4개년 상반기 매출액을 기간·지표·추이로 구조화한다", () => {
    const q = parseDartQuery("대한전선 최근 4개년 상반기 매출액", new Date("2026-10-05"));
    expect(q.recentYears).toBe(4);
    expect(q.kind).toBe("half");
    expect(q.metrics).toEqual(["revenue"]);
    expect(q.analysis).toBe("trend");
  });
  it("올해 매출이 작년보다 왜 늘었어를 원인 비교로 구조화한다", () => {
    const q = parseDartQuery("대한전선 올해 매출이 작년보다 왜 늘었어?");
    expect(q.hasCauseIntent).toBe(true);
    expect(q.analysis).toBe("cause");
    expect(q.metrics).toEqual(["revenue"]);
  });
  it("최근 3년 영업이익률 추이를 단일 지표 추이로 구조화한다", () => {
    const q = parseDartQuery("최근 3년 영업이익률 추이");
    expect(q.recentYears).toBe(3);
    expect(q.metrics).toEqual(["operatingMargin"]);
    expect(q.analysis).toBe("trend");
  });
  it("2024~2026 매출과 영업이익 비교를 두 지표 비교로 구조화한다", () => {
    const q = parseDartQuery("2024~2026 매출과 영업이익 비교");
    expect(q.yearStart).toBe(2024);
    expect(q.yearEnd).toBe(2026);
    expect(q.metrics).toEqual(["operatingProfit", "revenue"]);
    expect(q.analysis).toBe("comparison");
    expect(q.output).toBe("comparison");
  });
});

describe("재무계정 자연어 파서", () => {
  it("투자현금흐름을 영업현금흐름으로 오인하지 않는다", () => {
    const q = parseDartQuery("대한전선 2026년 반기 투자현금흐름");
    expect(q.metrics).toEqual(["investmentCashFlow"]);
  });
  it("유동성장기부채를 직접 계정으로 인식한다", () => {
    const q = parseDartQuery("대한전선 2026년 반기 유동성장기부채");
    expect(q.metrics).toEqual([]);
    expect(q.directAccount).toBe("유동성장기부채");
  });
  it("알 수 없는 재무 용어를 매출액으로 대체하지 않는다", () => {
    const q = parseDartQuery("대한전선 2026년 반기 완전히없는재무용어");
    expect(q.metrics).toEqual([]);
    expect(q.directAccount).toBeNull();
  });
  it("순이익은 반기순손익 계정으로 해석한다", () => {
    const q = parseDartQuery("대한전선 2026년 반기 순이익");
    expect(q.metrics).toEqual(["netIncome"]);
  });
});
