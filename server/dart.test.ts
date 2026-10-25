import { describe, expect, it } from "vitest";
import { DISCLAIMER, amountOf, fsDivFor, netDebt, normalizeQuestion, chunkByHeading, findRowLike, P, type Row } from "./dart/engine";
import { pickDirectAccount, pickMetric } from "./dart/client";
import { parseViewerDeepLinkHtml } from "./dart/viewerLink";

const bs = (nm: string, v: number): Row => ({ sj_div: "BS", account_nm: nm, thstrm_amount: String(v * 1e8) });
describe("DART-Copilot engine", () => {
  it("연결 기본, 별도·개별 키워드만 OFS", () => {
    expect(fsDivFor("삼성전자 순차입금")).toBe("CFS");
    expect(fsDivFor("삼성전자 별도 순차입금")).toBe("OFS");
  });
  it("순차입금: 리스부채 제외, 전환사채 포함, 단기금융상품 차감", () => {
    const r = netDebt([bs("단기차입금", 100), bs("유동성장기부채", 0), bs("장기차입금", 200), bs("전환사채", 50), bs("리스부채", 999), bs("현금및현금성자산", 80), bs("단기금융상품", 20)]);
    expect(r.ok && r.value).toBe(250);
    expect(r.ok && r.disclaimer).toBe(DISCLAIMER);
  });

  it("순차입금에서는 유동성 금융기관차입금과 유동성장기부채를 분리해 인식한다", () => {
    const result = netDebt([
      bs("유동성 금융기관차입금", 100), bs("유동성장기부채", 40),
      bs("장기차입금", 80), bs("사채", 50),
      bs("현금및현금성자산", 10), bs("단기금융상품", 5),
    ]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(255);
  });

  it("연결 기준 지표는 같은 이름의 별도 손익 계정보다 CIS를 우선한다", () => {
    const rows: Row[] = [
      { sj_div: "IS", account_nm: "매출액", thstrm_amount: "900000000000", thstrm_add_amount: "900000000000" },
      { sj_div: "CIS", account_nm: "매출액", thstrm_amount: "1000000000000", thstrm_add_amount: "1000000000000" },
      { sj_div: "IS", account_nm: "영업이익", thstrm_amount: "180000000000", thstrm_add_amount: "180000000000" },
      { sj_div: "CIS", account_nm: "영업이익", thstrm_amount: "100000000000", thstrm_add_amount: "100000000000" },
    ];
    expect(findRowLike(rows, ["CIS", "IS"], ["매출액"])?.sj_div).toBe("CIS");
    expect(pickMetric(rows, P(2026, "half"), "revenue")?.value).toBe(10000);
    expect(pickMetric(rows, P(2026, "half"), "operatingMargin")?.value).toBe(10);
  });

  it("매출 표준 계정코드와 대체 계정명으로 반기 매출액 및 영업이익률을 계산한다", () => {
    const rows: Row[] = [
      { sj_div: "CIS", account_nm: "수익", account_id: "ifrs-full_Revenue", thstrm_amount: "1198700000000", thstrm_add_amount: "2282028700000" },
      { sj_div: "CIS", account_nm: "영업이익(손실)", account_id: "ifrs-full_ProfitLossFromOperatingActivities", thstrm_amount: "60000000000", thstrm_add_amount: "121250000000" },
      { sj_div: "CIS", account_nm: "매출원가", thstrm_amount: "900000000000", thstrm_add_amount: "1700000000000" },
      { sj_div: "CIS", account_nm: "매출채권", thstrm_amount: "100000000000", thstrm_add_amount: "120000000000" },
    ];
    expect(pickMetric(rows, P(2026, "half"), "revenue")?.value).toBeCloseTo(22820.287, 3);
    expect(pickMetric(rows, P(2026, "half"), "operatingMargin")?.value).toBeCloseTo((1212.5 / 22820.287) * 100, 3);
    expect(pickDirectAccount(rows, P(2026, "half"), "매출액")?.value).toBeCloseTo(22820.287, 3);
  });

  it("매출액 검색은 매출원가·매출채권 같은 유사 계정을 매출로 잘못 선택하지 않는다", () => {
    const rows: Row[] = [
      { sj_div: "CIS", account_nm: "매출원가", thstrm_amount: "90000000000" },
      { sj_div: "CIS", account_nm: "매출채권", thstrm_amount: "10000000000" },
    ];
    expect(pickMetric(rows, P(2026, "half"), "revenue")).toBeNull();
  });

  it("EBITDA는 공시된 감가상각·무형자산상각 합계 계정을 영업이익에 더한다", () => {
    const rows: Row[] = [
      { sj_div: "CIS", account_nm: "영업이익", thstrm_amount: "100000000000", thstrm_add_amount: "100000000000" },
      { sj_div: "CF", account_nm: "감가상각비및무형자산상각비", account_id: "ifrs-full_DepreciationAndAmortisationExpense", thstrm_amount: "20000000000", thstrm_add_amount: "20000000000" },
    ];
    const result = pickMetric(rows, P(2026, "half"), "ebitda");
    expect(result?.value).toBe(1200);
    expect(result?.lines).toContain("영업이익 1,000억원");
  });

  it("차입금 구성 계정이 누락되면 0으로 간주하지 않고 순차입금 계산을 중단한다", () => {
    const r = netDebt([bs("단기차입금", 100), bs("장기차입금", 200), bs("사채", 50), bs("현금및현금성자산", 80), bs("단기금융상품", 20)]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("유동성장기부채");
  });
  it("공시에서 대시로 명시된 차입금·금융상품은 0으로 읽고 빈 값만 누락 처리한다", () => {
    const r = netDebt([
      { sj_div: "BS", account_nm: "단기차입금", thstrm_amount: "-" },
      { sj_div: "BS", account_nm: "유동성장기차입금", thstrm_amount: "—" },
      bs("장기차입금(사채 포함)", 2233.4),
      bs("현금및현금성자산", 1000),
      { sj_div: "BS", account_nm: "단기금융상품", thstrm_amount: "-" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.totalDebt).toBe(2233.4);
    expect(r.ok && r.value).toBe(1233.4);
  });

  it("약어 정규화와 주석 목차 캡처", () => {
    expect(normalizeQuestion("(주)삼전 순차입금")).toContain("삼성전자");
    expect(chunkByHeading("14. 차입금 내역\n내용")[0].heading).toBe("14. 차입금 내역");
  });
});

import { periodCandidates, looksLikeCompany } from "./dart/engine";
describe("기간·기본기업", () => {
  const now = new Date("2026-10-05");
  it("상반기 → 반기보고서(11012) 누적", () => {
    const [p] = periodCandidates("대한전선 2026년 상반기 연결 기준 매출액", now);
    expect([p.year, p.code, p.mode]).toEqual([2026, "11012", "cum"]);
  });
  it("기간 미지정 → 공개 시점에 맞는 최신 보고기간부터 시도, 과거 연도 명시 → 사업보고서", () => {
    expect(periodCandidates("매출액", now).map((p) => p.code)).toEqual(["11012", "11013", "11011"]);
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

describe("자연어 질의 회귀 테스트", () => {
  const now = new Date("2026-10-17T00:00:00+09:00");

  it("영업이익률·오타 영업이익율을 영업이익과 분리한다", () => {
    expect(parseDartQuery("대한전선 2026년 상반기 영업이익률", now).metrics).toEqual(["operatingMargin"]);
    expect(parseDartQuery("대한전선 영업이익율", now).metrics).toEqual(["operatingMargin"]);
    expect(parseDartQuery("대한전선 영업이익", now).metrics).toEqual(["operatingProfit"]);
  });

  it("순이익률을 순이익 금액으로 오인하지 않는다", () => {
    expect(parseDartQuery("대한전선 순이익률", now).metrics).toEqual(["netMargin"]);
    expect(parseDartQuery("대한전선 당기순이익", now).metrics).toEqual(["netIncome"]);
  });

  it("매출원가가 매출액 지표로 오인되지 않고 직접 계정으로 남는다", () => {
    const parsed = parseDartQuery("대한전선 2025년 매출원가", now);
    expect(parsed.metrics).toEqual([]);
    expect(parsed.directAccount).toBe("매출원가");
  });

  it("올해와 작년을 같이 물으면 올해 최신 보고기간 후보부터 찾는다", () => {
    expect(periodCandidates("대한전선 올해 매출이 작년보다 왜 늘었어?", now).map((p) => [p.year, p.kind])).toEqual([
      [2026, "half"], [2026, "q1"], [2025, "annual"],
    ]);
  });

  it("작년 매출 단독 질의는 전전년 대비 비교로 바뀌지 않도록 연간 후보를 사용한다", () => {
    expect(periodCandidates("대한전선 작년 매출액", now).map((p) => [p.year, p.kind])).toEqual([[2025, "annual"]]);
  });

  it("하반기를 사업보고서 연간 수치와 동일시하지 않는다", () => {
    expect(periodCandidates("대한전선 2025년 하반기 매출액", now)).toEqual([]);
  });
});

import { METRIC_LABELS, metricConfig } from "./dart/engine";
describe("자연어 오인식 방지 및 지표 사전 일치", () => {
  const now = new Date("2026-10-17T00:00:00+09:00");

  it("표시 라벨·조회 설정이 모든 지표에 대해 일치한다", () => {
    expect(Object.keys(METRIC_LABELS).sort()).toEqual(Object.keys(metricConfig).sort());
  });

  it("차입금의존도를 총차입금과 중복 해석하지 않는다", () => {
    expect(parseDartQuery("대한전선 차입금의존도", now).metrics).toEqual(["borrowingsRatio"]);
    expect(parseDartQuery("대한전선 총차입금", now).metrics).toEqual(["borrowings"]);
  });

  it("현금흐름 계정을 기간 추이 요청으로 잘못 분류하지 않는다", () => {
    const parsed = parseDartQuery("대한전선 2026년 투자현금흐름", now);
    expect(parsed.metrics).toEqual(["investmentCashFlow"]);
    expect(parsed.analysis).toBe("single");
    expect(parsed.output).toBe("value");
  });

  it("매출 계정 이름을 모호한 수익 계정과 혼동하지 않는다", () => {
    expect(parseDartQuery("대한전선 2026년 상반기 매출액", now).directAccount).toBeNull();
    expect(parseDartQuery("대한전선 영업수익", now).metrics).toEqual(["revenue"]);
    expect(parseDartQuery("대한전선 수익(매출액)", now).metrics).toEqual(["revenue"]);
  });

  it("하반기 질문을 연간보고서로 해석하지 않는다", () => {
    expect(parseDartQuery("대한전선 2025년 하반기 매출액", now).kind).not.toBe("annual");
  });

  it("FCF와 운전자본 별칭을 인식한다", () => {
    expect(parseDartQuery("대한전선 FCF", now).metrics).toEqual(["freeCashFlow"]);
    expect(parseDartQuery("대한전선 운전자본", now).metrics).toEqual(["workingCapital"]);
  });
});

describe("재무 계정과 회사명 구분", () => {
  it("계정명·재무비율을 미등록 회사명으로 보지 않는다", () => {
    expect(looksLikeCompany("유동성장기부채")).toBe(false);
    expect(looksLikeCompany("재고자산")).toBe(false);
    expect(looksLikeCompany("매입채무")).toBe(false);
    expect(looksLikeCompany("ROE")).toBe(false);
    expect(looksLikeCompany("PER")).toBe(false);
  });

  it("미등록 회사명은 기본 기업으로 조용히 대체하지 않도록 식별한다", () => {
    expect(looksLikeCompany("가짜회사 매출액")).toBe(true);
  });
});


describe("자연어 연도 인식 경계 회귀", () => {
  const now = new Date("2026-10-17T00:00:00+09:00");
  it("4개년 매출액 비교를 4개년 비교로 인식한다", () => {
    const parsed = parseDartQuery("대한전선 4개년 매출액 비교", now);
    expect(parsed.recentYears).toBe(4);
    expect(parsed.metrics).toEqual(["revenue"]);
    expect(parsed.analysis).toBe("comparison");
  });
  it("2025년 같은 명시 연도를 최근 10개년 요청으로 오인하지 않는다", () => {
    const parsed = parseDartQuery("대한전선 2025년 EBITDA", now);
    expect(parsed.years).toEqual([2025]);
    expect(parsed.recentYears).toBeNull();
    expect(parsed.metrics).toEqual(["ebitda"]);
  });
  it("별도 기간 토큰이 없는 최근 4개년 질의는 최근 4개년으로 파싱한다", () => {
    expect(parseDartQuery("최근 4개년 매출액", now).recentYears).toBe(4);
  });
});


describe("실제 원문 계산 및 DART 본문 바로가기 회귀검사", () => {
  it("단기차입부채·유동성전환사채 별칭과 사채 포함 장기차입금의 중복을 방지한다", () => {
    const r = netDebt([
      bs("단기차입부채", 40),
      bs("유동성전환사채", 10),
      bs("장기차입금(사채 포함)", 200),
      bs("현금및현금성자산", 30),
      bs("단기예치금", 5),
    ]);
    expect(r.ok).toBe(true);
    expect(r.ok && r.totalDebt).toBe(250);
    expect(r.ok && r.value).toBe(215);
  });

  it("공시 계정명이 다르더라도 XBRL 계정 ID로 차입금 행을 찾고 금액 없는 중복 행을 건너뛴다", () => {
    const rows: Row[] = [
      { sj_div: "BS", account_nm: "단기차입금", thstrm_amount: "" },
      { sj_div: "BS", account_nm: "차입부채", account_id: "ifrs-full_ShorttermBorrowings", thstrm_amount: "4000000000" },
      { sj_div: "BS", account_nm: "유동성장기차입부채", account_id: "ifrs-full_CurrentPortionOfLongtermBorrowings", thstrm_amount: "1000000000" },
      { sj_div: "BS", account_nm: "비유동차입부채", account_id: "ifrs-full_LongtermBorrowings", thstrm_amount: "20000000000" },
      { sj_div: "BS", account_nm: "사채", account_id: "ifrs-full_BondsIssued", thstrm_amount: "5000000000" },
      bs("현금및현금성자산", 30), bs("단기금융상품", 5),
    ];
    const result = netDebt(rows);
    expect(result.ok).toBe(true);
    expect(result.ok && result.totalDebt).toBe(300);
    expect(result.ok && result.value).toBe(265);
  });

  it("유형·무형 상각비를 XBRL 태그 ID로 식별해 EBITDA를 산출한다", () => {
    const rows: Row[] = [
      { sj_div: "CIS", account_nm: "영업이익", thstrm_amount: "100000000" },
      { sj_div: "CF", account_nm: "감가상각비", account_id: "ifrs-full_AdjustmentsForDepreciationExpense", thstrm_amount: "200000000" },
      { sj_div: "CF", account_nm: "기타 상각비", account_id: "ifrs-full_AdjustmentsForAmortisationExpense", thstrm_amount: "300000000" },
    ];
    const result = pickMetric(rows, P(2025, "annual"), "ebitda");
    expect(result?.value).toBe(6);
    expect(result?.formula).toContain("EBITDA");
  });

  it("DART 목차에 공백이 삽입된 연결재무상태표도 본문 링크로 추출한다", () => {
    const html = `
      treeNode1 = new Tree.TreeNode({
        text: "연 결 재 무 상 태 표",
        id: "3",
        listeners: { click: function() { viewDoc('20260814003722', '10485763', '3', '120', '3400', 'dart3.xsd'); } }
      });
      treeNode1 = new Tree.TreeNode({
        text: "감사보고서",
        id: "4",
        listeners: { click: function() { viewDoc('20260814003722', '10485764', '4', '120', '3400', 'dart3.xsd'); } }
      });
    `;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(true);
    expect(result.url).toContain("/report/viewer.do?");
    expect(result.url).toContain("dcmNo=10485763");
    expect(result.url).toContain("eleId=3");
  });

  it("세부 IS 항목 대신 '연결재무제표' 묶음만 있는 DART 목차도 본문으로 연결한다", () => {
    const html = `treeNode13 = new Tree.TreeNode({ text: "2. 연결재무제표", id: "13", listeners: { click: function() { viewDoc('20260814003722', '10485790', '13', '390551', '115839', 'dart3.xsd'); } } });`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "IS");
    expect(result.deepLinked).toBe(true);
    expect(result.sectionTitle.replace(/[\s.]/g, "")).toContain("연결재무제표");
    expect(result.url).toContain("dcmNo=10485790");
    expect(result.url).toContain("eleId=13");
  });

  it("목차 주변 문장에만 재무상태표가 있고 실제 노드 제목이 표지면 본문 링크로 오인하지 않는다", () => {
    const html = `treeNode1 = new Tree.TreeNode({text: "표지", note: "이 공시에는 연결재무상태표가 포함됩니다", id:"1", listeners:{click:function(){viewDoc('20260814003722','10485761','1','0','120','dart3.xsd');}}});`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(false);
    expect(result.url).toBe("");
  });

  it("TreeNode 제목과 viewDoc 클릭 핸들러가 별도 블록에 있어도 eleId로 정확히 연결한다", () => {
    const html = `
      treeNode1 = new Tree.TreeNode({ text: "표지", id: "1" });
      treeNode2 = new Tree.TreeNode({ text: "연결 재무상태표", id: "7" });
      treeNode3 = new Tree.TreeNode({ text: "감사보고서", id: "8" });
      treeNode1.on('click', function(){ viewDoc('20260814003722','10485761','1','0','120','dart3.xsd'); });
      treeNode2.on('click', function(){ viewDoc('20260814003722','10485763','7','120','3400','dart3.xsd'); });
      treeNode3.on('click', function(){ viewDoc('20260814003722','10485764','8','120','3400','dart3.xsd'); });
    `;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(true);
    expect(result.sectionTitle.replace(/\s/g, "")).toContain("연결재무상태표");
    expect(result.url).toContain("dcmNo=10485763");
    expect(result.url).toContain("eleId=7");
  });

  it("재무상태표 제목이 일반명이어도 상위 연결/별도 재무제표 목차로 구분한다", () => {
    const html = `
      treeNode1 = new Tree.TreeNode({ text: "연결재무제표", id: "2" });
      treeNode2 = new Tree.TreeNode({ text: "재무상태표", id: "7" });
      treeNode3 = new Tree.TreeNode({ text: "별도재무제표", id: "8" });
      treeNode4 = new Tree.TreeNode({ text: "재무상태표", id: "9" });
      treeNode1.on('click', function(){ viewDoc('20260814003722','10485760','2','0','100','dart3.xsd'); });
      treeNode2.on('click', function(){ viewDoc('20260814003722','10485763','7','120','3400','dart3.xsd'); });
      treeNode3.on('click', function(){ viewDoc('20260814003722','10485764','8','0','100','dart3.xsd'); });
      treeNode4.on('click', function(){ viewDoc('20260814003722','10485765','9','120','3400','dart3.xsd'); });
    `;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(true);
    expect(result.url).toContain("dcmNo=10485763");
    expect(result.url).toContain("eleId=7");
  });

  it("DART 목차 제목이 유니코드 이스케이프로 내려와도 본문 링크를 찾는다", () => {
    const html = `treeNode1 = new Tree.TreeNode({text: "\\uc5f0\\uacb0\\uc7ac\\ubb34\\uc0c1\\ud0dc\\ud45c", id:"3", listeners:{click:function(){viewDoc('20260814003722','10485763','3','120','3400','dart3.xsd');}}});`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(true);
    expect(result.url).toContain("dcmNo=10485763");
  });


  it("DART 목차의 빈 offset/length와 공백 있는 viewDoc 인자를 안전하게 처리한다", () => {
    const html = `treeNode9 = new Tree.TreeNode({ text: "연결 손익계산서", id: "9", listeners: { click: function () { viewDoc("20260814003722", "10485771", "9", "", "", "dart3.xsd"); } } });`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "IS");
    expect(result.deepLinked).toBe(true);
    expect(result.url).toContain("dcmNo=10485771");
    expect(result.url).toContain("offset=0");
    expect(result.url).toContain("length=0");
  });

  it("본문 위치를 특정하지 못하면 표지 링크로 되돌리지 않는다", () => {
    const result = parseViewerDeepLinkHtml("<html><body>목차 없음</body></html>", "20260814003722", "CFS", "BS");
    expect(result.deepLinked).toBe(false);
    expect(result.url).toBe("");
    expect(result.url).not.toContain("main.do");
  });

  it("신형 DART node 객체에서 세부 현금흐름표 목차가 없으면 연결재무제표 본문 인자로 이동한다", () => {
    const html = `
      <script>
      var node1 = {};
      node1['text'] = "III. 재무에 관한 사항";
      node1['id'] = "12";
      node1['rcpNo'] = "20260814003722";
      node1['dcmNo'] = "9980000";
      node1['eleId'] = "12";
      node1['offset'] = "0";
      node1['length'] = "1000";
      node1['dtd'] = "dart4.xsd";
      var node2 = {};
      node2['text'] = "2. 연결재무제표";
      node2['id'] = "15";
      node2['rcpNo'] = "20260814003722";
      node2['dcmNo'] = "9981234";
      node2['eleId'] = "15";
      node2['offset'] = "145210";
      node2['length'] = "84320";
      node2['dtd'] = "dart4.xsd";
      node1['children'].push(node2);
      treeData.push(node1);
      viewDoc("20260814003722", "1234567", "1", "0", "100", "dart4.xsd");
      </script>`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "CF");
    expect(result.deepLinked).toBe(true);
    expect(result.sectionTitle).toBe("2. 연결재무제표");
    expect(result.url).toContain("dcmNo=9981234");
    expect(result.url).toContain("eleId=15");
    expect(result.url).toContain("offset=145210");
  });

  it("신형 DART 목차에서 별도 재무제표 요청은 연결재무제표를 선택하지 않는다", () => {
    const html = `
      <script>
      var node1 = {}; node1['text'] = "2. 연결재무제표"; node1['rcpNo'] = "20260814003722"; node1['dcmNo'] = "9981234"; node1['eleId'] = "15"; node1['offset'] = "0"; node1['length'] = "500"; node1['dtd'] = "dart4.xsd";
      var node2 = {}; node2['text'] = "4. 재무제표"; node2['rcpNo'] = "20260814003722"; node2['dcmNo'] = "9985678"; node2['eleId'] = "25"; node2['offset'] = "90000"; node2['length'] = "40000"; node2['dtd'] = "dart4.xsd";
      </script>`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "OFS", "BS");
    expect(result.deepLinked).toBe(true);
    expect(result.sectionTitle).toBe("4. 재무제표");
    expect(result.url).toContain("dcmNo=9985678");
    expect(result.url).toContain("eleId=25");
  });

  it("Tree 네임스페이스가 없는 TreeNode와 인자 공백 차이가 있는 링크도 파싱한다", () => {
    const html = `node42 = new TreeNode("연결 포괄손익계산서", { id: "7", click: function () { viewDoc ( "20260814003722" , "10485770" , "7" , "0" , "54210" , "dart3.xsd" ); } });`;
    const result = parseViewerDeepLinkHtml(html, "20260814003722", "CFS", "IS");
    expect(result.deepLinked).toBe(true);
    expect(result.url).toContain("dcmNo=10485770");
    expect(result.url).toContain("eleId=7");
  });
});


describe("최근 화면 오류 회귀 테스트", () => {
  it("실제 감가상각·상각 합계 계정이 있으면 EBITDA를 산식으로 계산한다", () => {
    const rows: Row[] = [
      { sj_div: "IS", account_nm: "영업이익", thstrm_amount: "1000000000" },
      { sj_div: "CF", account_nm: "감가상각비및무형자산상각비", account_id: "ifrs-full_DepreciationDepletionAndAmortisationExpense", thstrm_amount: "200000000" },
    ];
    const result = pickMetric(rows, P(2025, "annual"), "ebitda");
    expect(result?.value).toBe(12);
    expect(result?.formula).toContain("EBITDA");
  });

  it("카드용 원천계정 추출은 DART 계정코드와 계정명 변형을 함께 사용한다", () => {
    const rows: Row[] = [
      { sj_div: "BS", account_id: "ifrs-full_Assets", account_nm: "자산총계", thstrm_amount: "4009120000000" },
      { sj_div: "BS", account_id: "ifrs-full_CurrentAssets", account_nm: "유동자산", thstrm_amount: "2773842217187" },
      { sj_div: "BS", account_id: "ifrs-full_Inventories", account_nm: "재고자산", thstrm_amount: "1139960000000" },
      { sj_div: "IS", account_id: "ifrs-full_FinanceCosts", account_nm: "금융원가", thstrm_amount: "12000000000", thstrm_add_amount: "12000000000" },
    ];
    expect(pickDirectAccount(rows, P(2025, "annual"), "자산총계")?.value).toBeCloseTo(40091.2, 6);
    expect(pickDirectAccount(rows, P(2025, "annual"), "유동자산")?.value).toBeCloseTo(27738.42217187, 6);
    expect(pickDirectAccount(rows, P(2025, "annual"), "재고자산")?.value).toBeCloseTo(11399.6, 6);
    expect(pickDirectAccount(rows, P(2025, "annual"), "금융원가")?.value).toBeCloseTo(120, 6);
  });

  it("DART가 명시한 총차입금 합계와 자산총계로 차입금의존도를 계산한다", () => {
    const rows: Row[] = [bs("총차입금", 300), bs("자산총계", 1000)];
    expect(pickMetric(rows, P(2025, "annual"), "borrowings")?.value).toBe(300);
    const ratio = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(ratio?.value).toBe(30);
    expect(ratio?.lines?.join(" ")).toContain("자산총계");
    expect(ratio?.lines?.join(" ")).toContain("30.00%");
  });


  it("부채비율은 직접 공시된 비율 행 없이 부채총계와 자본총계로 계산한다", () => {
    const result = pickMetric([bs("부채총계", 700), bs("자본총계", 300)], P(2026, "half"), "debtRatio");
    expect(result?.value).toBeCloseTo(700 / 300 * 100, 6);
    expect(result?.formula).toContain("부채총계");
    expect(result?.formula).toContain("자본총계");
    expect(result?.lines.join(" ")).toContain("분자 · 부채총계");
    expect(result?.lines.join(" ")).toContain("분모 · 자본총계");
  });

  it("자산총계 계정명을 찾지 못해도 부채총계+자본총계로 차입금의존도 분모를 보완한다", () => {
    const rows: Row[] = [bs("단기차입금", 100), bs("총부채", 700), bs("총자본", 300)];
    const result = pickMetric(rows, P(2026, "half"), "borrowingsRatio");
    expect(result?.value).toBeCloseTo(10, 6);
    expect(result?.lines.join(" ")).toContain("자산총계 대체 산식");
    expect(result?.lines.join(" ")).toContain("부채총계 + 자본총계로 계산");
  });

  it("차입금의존도는 총차입성 부채 분자에 유동·비유동 리스부채를 포함한다", () => {
    const rows: Row[] = [
      bs("단기차입금", 100), bs("유동성장기부채", 50), bs("장기차입금", 75), bs("사채", 75),
      bs("유동리스부채", 10), bs("비유동리스부채", 40), bs("자산합계", 1000),
    ];
    const result = pickMetric(rows, P(2026, "half"), "borrowingsRatio");
    expect(result?.value).toBeCloseTo(35, 6);
    expect(result?.lines.join(" ")).toContain("리스부채 포함");
  });

  it("총차입금 의존도는 공시 합계와 자산총계 분자·분모를 모두 표시한다", () => {
    const rows: Row[] = [bs("총차입금", 4133.4), bs("자산총계", 40091.2)];
    const result = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(result?.value).toBeCloseTo(4133.4 / 40091.2 * 100, 6);
    expect(result?.lines?.join(" ")).toContain("분자");
    expect(result?.lines?.join(" ")).toContain("분모");
    expect(result?.lines?.join(" ")).toContain("계산");
  });

  it("반기 누적 손익계정의 영업이익률을 원 단위에서 직접 계산한다", () => {
    const rows: Row[] = [
      { sj_div: "CIS", account_nm: "수익(매출액)", thstrm_amount: "1198700000000", thstrm_add_amount: "2282028700000" },
      { sj_div: "CIS", account_nm: "영업이익(손실)", thstrm_amount: "60800000000", thstrm_add_amount: "121253500000" },
      { sj_div: "CIS", account_nm: "당기순이익(손실)", thstrm_amount: "-40000000000", thstrm_add_amount: "-95024000000" },
    ];
    const half = pickMetric(rows, P(2026, "half", "cum"), "operatingMargin");
    const q2 = pickMetric(rows, P(2026, "half", "qtr"), "operatingMargin");
    const net = pickMetric(rows, P(2026, "half", "cum"), "netMargin");
    expect(half?.value).toBeCloseTo(121253500000 / 2282028700000 * 100, 6);
    expect(q2?.value).toBeCloseTo(60800000000 / 1198700000000 * 100, 6);
    expect(net?.value).toBeCloseTo(-95024000000 / 2282028700000 * 100, 6);
    expect(half?.formula).toContain("영업이익 ÷ 매출액");
  });

  it("총차입금 합계와 구성 계정이 다르면 공시 합계로 계산하되 불일치를 안내한다", () => {
    const rows: Row[] = [
      bs("총차입금", 500), bs("자산총계", 1000),
      bs("단기차입금", 100), bs("유동성장기부채", 50), bs("장기차입금", 75), bs("사채", 75),
    ];
    const result = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(result?.value).toBe(50);
    expect(result?.disclaimer).toContain("불일치");
  });

  it("DART 총차입금 합계가 리스 제외 구성 계정과 일치하면 유동·비유동 리스부채를 추가한다", () => {
    const rows: Row[] = [
      bs("총차입금", 400), bs("자산총계", 1000), bs("부채총계", 700), bs("자본총계", 300),
      bs("단기차입금", 100), bs("유동성장기부채", 100), bs("장기차입금", 100), bs("사채", 100),
      bs("유동리스부채", 10), bs("비유동리스부채", 40),
    ];
    const total = pickMetric(rows, P(2025, "annual"), "borrowings");
    const ratio = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(total?.value).toBe(450);
    expect(ratio?.value).toBe(45);
    expect(total?.lines?.join(" ")).toContain("유동·비유동 리스부채 추가");
  });

  it("유동성 금융기관차입금과 유동성장기부채를 별도 구성계정으로 각각 한 번씩 집계한다", () => {
    const rows: Row[] = [
      bs("총차입금", 11754.5), bs("자산총계", 40107.92),
      bs("유동성 금융기관차입금(사채 제외)", 7621.1),
      bs("유동성장기부채", 1900), bs("장기차입금", 2233.4),
      bs("유동리스부채", 55.6), bs("비유동리스부채", 58),
    ];
    const total = pickMetric(rows, P(2026, "half"), "borrowings");
    const ratio = pickMetric(rows, P(2026, "half"), "borrowingsRatio");
    expect(total?.value).toBeCloseTo(11868.1, 3);
    expect(total?.lines?.join(" ")).toContain("유동성 금융기관차입금");
    expect(total?.lines?.join(" ")).toContain("유동성장기부채");
    expect(ratio?.value).toBeCloseTo(11868.1 / 40107.92 * 100, 4);
  });

  it("구성 계정 없이 차입금및사채와 유동·비유동 리스부채가 있으면 리스부채를 한 번 추가한다", () => {
    const rows: Row[] = [
      bs("차입금및사채", 11754.5), bs("자산총계", 40107.92),
      bs("유동리스부채", 55.6), bs("비유동리스부채", 58),
    ];
    const total = pickMetric(rows, P(2026, "half"), "borrowings");
    expect(total?.value).toBeCloseTo(11868.1, 3);
    expect(total?.lines?.join(" ")).toContain("DART 원문 구성 리스부채 추가");
  });

  it("DART 금액 열의 대시는 명시적 0으로 읽고 빈 칸은 누락으로 유지한다", () => {
    expect(amountOf({ sj_div: "BS", account_nm: "단기차입금", thstrm_amount: "-" })).toBe(0);
    expect(amountOf({ sj_div: "BS", account_nm: "단기차입금", thstrm_amount: "" })).toBeNull();
  });

  it("전체 재무상태표에서 차입금·사채·리스부채를 합산해 차입금의존도를 계산한다", () => {
    const rows: Row[] = [
      bs("자산총계", 40107.92), bs("부채총계", 21000), bs("자본총계", 19107.92),
      bs("단기차입금", 5000), bs("유동성 금융기관 차입금(사채 제외)", 2980), bs("유동성사채", 20),
      bs("장기차입금", 3000), bs("사채", 754.44468),
      bs("유동리스부채", 60), bs("비유동리스부채", 61.149),
    ];
    const borrowings = pickMetric(rows, P(2026, "half"), "borrowings");
    const ratio = pickMetric(rows, P(2026, "half"), "borrowingsRatio");
    expect(borrowings?.value).toBeCloseTo(11875.59368, 5);
    expect(borrowings?.formula).toContain("리스부채 포함");
    expect(ratio?.value).toBeCloseTo(11875.59368 / 40107.92 * 100, 4);
    expect(ratio?.lines?.join(" ")).toContain("비유동리스부채");
    expect(ratio?.lines?.join(" ")).toContain("자산총계");
  });

  it("구성 계정 없이 차입금및사채 한 줄만 있으면 그 값을 총차입금으로 사용한다", () => {
    const result = pickMetric([bs("차입금및사채", 300), bs("자산총계", 1000)], P(2025, "annual"), "borrowingsRatio");
    expect(result?.value).toBe(30);
    expect(result?.disclaimer).toContain("차입금및사채");
  });

  it("구성 계정과 차입금및사채가 함께 있으면 중복 합산하지 않는다", () => {
    const rows: Row[] = [bs("단기차입금", 100), bs("장기차입금", 200), bs("사채", 50), bs("차입금및사채", 350), bs("자산총계", 1000)];
    const result = pickMetric(rows, P(2025, "annual"), "borrowings");
    expect(result?.value).toBe(350);
    expect(result?.lines?.join(" ")).toContain("중복 합산");
  });

  it("일부 차입금 계정만 있어도 확인된 숫자로 합산하고 미확인 계정은 제외 안내한다", () => {
    const rows: Row[] = [bs("장기차입금", 200), bs("사채", 50), bs("자산총계", 1000)];
    const total = pickMetric(rows, P(2025, "annual"), "borrowings");
    const ratio = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(total?.value).toBe(250);
    expect(ratio?.value).toBe(25);
    expect(total?.disclaimer).toContain("제외");
    expect(total?.disclaimer).toContain("단기차입금");
  });

  it("차입금 계정이 전혀 없으면 0으로 꾸미지 않고 누락으로 남긴다", () => {
    const result = pickMetric([bs("현금및현금성자산", 100), bs("자산총계", 1000)], P(2025, "annual"), "borrowingsRatio");
    expect(Number.isFinite(result?.value)).toBe(false);
    expect(result?.disclaimer).toContain("누락");
  });

  it("리스부채는 차입금 의존도 분자에 포함하고 계산식에 구성별 금액을 표시한다", () => {
    const rows: Row[] = [bs("단기차입금", 100), bs("유동성장기부채", 100), bs("장기차입금", 200), bs("사채", 100), bs("유동리스부채", 10), bs("비유동리스부채", 40), bs("자산총계", 1000)];
    const result = pickMetric(rows, P(2025, "annual"), "borrowingsRatio");
    expect(result?.value).toBeCloseTo(55, 6);
    expect(result?.lines?.join(" ")).toContain("비유동리스부채");
    expect(result?.lines?.join(" ")).toContain("55.00%");
  });
});

describe("공시 원문 바로가기: 첫 화면(표지) 대신 재무제표 본문", () => {
  const rcp = "20260814003722";
  const node = (n: number, text: string, dcm: string, ele: string, extra = "") =>
    `var node${n} = {}; node${n}['text'] = "${text}"; node${n}['id'] = "${ele}"; node${n}['rcpNo'] = "${rcp}"; node${n}['dcmNo'] = "${dcm}"; node${n}['eleId'] = "${ele}"; node${n}['offset'] = "1000"; node${n}['length'] = "2000"; node${n}['dtd'] = "dart4.xsd"; ${extra}`;

  it("children 관계 없이 depth만 있는 평면 목차에서도 하위 '재무상태표'를 연결 기준으로 찾는다", () => {
    const html = `<script>
      ${node(1, "III. 재무에 관한 사항", "9990001", "10", "node1['depth']=\"1\";")}
      ${node(2, "2. 연결재무제표", "9990002", "15", "node2['depth']=\"2\";")}
      ${node(3, "재무상태표", "9990003", "16", "node3['depth']=\"3\";")}
      ${node(4, "4. 재무제표", "9990004", "30", "node4['depth']=\"2\";")}
      ${node(5, "재무상태표", "9990005", "31", "node5['depth']=\"3\";")}
    </script>`;
    const cfs = parseViewerDeepLinkHtml(html, rcp, "CFS", "BS");
    expect(cfs.deepLinked).toBe(true);
    expect(cfs.url).toContain("dcmNo=9990003");
    const ofs = parseViewerDeepLinkHtml(html, rcp, "OFS", "BS");
    expect(ofs.deepLinked).toBe(true);
    expect(ofs.url).toContain("dcmNo=9990005");
  });

  it("객체 리터럴(JSON) 형태 목차도 본문 링크로 변환한다", () => {
    const html = `<script>var treeData = [{"text":"2. 연결재무제표","id":"15","rcpNo":"${rcp}","dcmNo":"9991234","eleId":"15","offset":"500","length":"900","dtd":"dart4.xsd"}];</script>`;
    const r = parseViewerDeepLinkHtml(html, rcp, "CFS", "IS");
    expect(r.deepLinked).toBe(true);
    expect(r.url).toContain("viewer.do");
    expect(r.url).toContain("dcmNo=9991234");
    expect(r.url).toContain("eleId=15");
  });

  it("연결재무제표가 없는 회사는 '재무제표' 본문으로 이동하고 기준 차이를 안내한다", () => {
    const html = `<script>${node(1, "4. 재무제표", "9995678", "25")}</script>`;
    const r = parseViewerDeepLinkHtml(html, rcp, "CFS", "BS");
    expect(r.deepLinked).toBe(true);
    expect(r.url).toContain("dcmNo=9995678");
    expect("note" in r && r.note).toContain("기준이 다를 수 있습니다");
  });

  it("재무제표 목차가 전혀 없으면 '재무에 관한 사항' 본문 구간으로 이동한다(표지 아님)", () => {
    const html = `<script>
      ${node(1, "I. 회사의 개요", "9990001", "2")}
      ${node(2, "III. 재무에 관한 사항", "9990009", "12")}
    </script>`;
    const r = parseViewerDeepLinkHtml(html, rcp, "CFS", "BS");
    expect(r.deepLinked).toBe(true);
    expect(r.url).toContain("dcmNo=9990009");
    expect(r.url).not.toContain("dcmNo=9990001");
  });

  it("재무 관련 목차가 전혀 없으면 표지 링크로 대체하지 않고 실패로 남긴다", () => {
    const html = `<script>${node(1, "I. 회사의 개요", "9990001", "2")}</script>`;
    const r = parseViewerDeepLinkHtml(html, rcp, "CFS", "BS");
    expect(r.deepLinked).toBe(false);
    expect(r.url).toBe("");
  });
});
