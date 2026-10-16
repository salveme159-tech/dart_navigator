import { describe, expect, it } from "vitest";
import { DISCLAIMER, fsDivFor, netDebt, normalizeQuestion, chunkByHeading, type Row } from "./dart/engine";

const bs = (nm: string, v: number): Row => ({ sj_div: "BS", account_nm: nm, thstrm_amount: String(v * 1e8), account_id: `test_${nm}` });
const completeTotals = [bs("자산총계", 1000), bs("유동자산", 600), bs("비유동자산", 400), bs("부채총계", 400), bs("유동부채", 150), bs("비유동부채", 250), bs("자본총계", 600)];
describe("DART-Copilot engine", () => {
  it("연결 기본, 별도·개별 키워드만 OFS", () => {
    expect(fsDivFor("삼성전자 순차입금")).toBe("CFS");
    expect(fsDivFor("삼성전자 별도 순차입금")).toBe("OFS");
  });
  it("순차입금: 리스부채 제외, 전환사채 포함, 단기금융상품 차감", () => {
    const r = netDebt([...completeTotals, bs("단기차입금", 100), bs("장기차입금", 200), bs("전환사채", 50), bs("리스부채", 999), bs("현금및현금성자산", 80), bs("단기금융상품", 20)]);
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
    expect(amountOf({ sj_div: "IS", thstrm_amount: "100000000", thstrm_add_amount: "250000000" }, 0, true)).toBe(2.5);
    expect(amountOf({ sj_div: "IS", thstrm_amount: "100000000", thstrm_add_amount: "" }, 0, true)).toBeNull();
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


describe("공시 필드 규칙", () => {
  it("반기 손익/현금흐름은 누적 필드를 사용하고 BS는 시점값을 사용한다", () => {
    expect(amountOf({ sj_div: "IS", thstrm_amount: "100000000", thstrm_add_amount: "250000000" }, 0, true)).toBe(2.5);
    expect(amountOf({ sj_div: "CF", thstrm_amount: "100000000", thstrm_add_amount: "300000000" }, 0, true)).toBe(3);
    expect(amountOf({ sj_div: "BS", thstrm_amount: "100000000", thstrm_add_amount: "999999999" }, 0, true)).toBe(1);
  });
});

describe("순차입금 입력 상태", () => {
  it("완전한 BS에서 사채군이 부재하면 0 처리하고 상태를 표시한다", () => {
    const rows: Row[] = [
      ...completeTotals,
      bs("단기차입금", 100), bs("현금및현금성자산", 80), bs("단기금융상품", 20),
    ];
    const r = netDebt(rows);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe(0);
    expect(r.ok && r.items.some((x) => x.group === "사채" && x.status === "absent_in_complete_statement")).toBe(true);
  });
  it("BS 완전성 확인 전에는 누락 계정을 임의로 0 처리하지 않는다", () => {
    const r = netDebt([bs("단기차입금", 100), bs("현금및현금성자산", 80)]);
    expect(r.ok).toBe(false);
  });
});

describe("추가 정합성 규칙", () => {
  it("영업이익률은 영업이익으로 중복 해석하지 않는다", () => {
    const q = parseDartQuery("대한전선 최근 3년 영업이익률 추이");
    expect(q.metrics).toEqual(["operatingMargin"]);
  });
  it("3분기 기본은 해당 분기 3개월이며 누적을 명시하면 누적이다", () => {
    expect(periodCandidates("2026년 3분기 매출액")[0].mode).toBe("qtr");
    expect(periodCandidates("2026년 3분기 누적 매출액")[0].mode).toBe("cum");
  });
});


describe("순차입금 재조정", () => {
  it("유동/비유동 소계와 총계를 맞추지 못하면 완전 BS로 인정하지 않는다", () => {
    const rows = [bs("자산총계", 1000), bs("유동자산", 550), bs("비유동자산", 400), bs("부채총계", 400), bs("유동부채", 150), bs("비유동부채", 250), bs("자본총계", 600), bs("단기차입금", 100), bs("현금및현금성자산", 80)];
    expect(netDebt(rows).ok).toBe(false);
  });
  it("사채 부모와 전환사채 상세를 중복 합산하지 않는다", () => {
    const rows = [...completeTotals, bs("사채", 100), bs("전환사채", 60), bs("단기차입금", 100), bs("현금및현금성자산", 80), bs("단기금융상품", 20)];
    const r = netDebt(rows);
    expect(r.ok && r.value).toBe(60);
  });
});

describe("순차입금 미분류 계정 방어", () => {
  it("완전한 BS라도 일반 차입금 행을 분류하지 못하면 계산을 거부한다", () => {
    const rows = [...completeTotals, bs("차입금", 500), bs("현금및현금성자산", 80), bs("단기금융상품", 0)];
    const r = netDebt(rows);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("분류되지 않은");
  });
  it("금액이 비어 있는 보고 계정을 0으로 간주하지 않는다", () => {
    const rows: Row[] = [...completeTotals, {sj_div: "BS", account_nm: "단기차입금", thstrm_amount: ""}, bs("현금및현금성자산", 80)];
    expect(netDebt(rows).ok).toBe(false);
  });
});
