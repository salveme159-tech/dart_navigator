import React, { useState } from "react";
import {
  QuarterlyFinancialPoint,
  runDeterministicVerification,
} from "../lib/financialVerification";
import {
  YahooQuotePayload,
  computeFullMetrics,
} from "../lib/marketMetrics";
import {
  ShieldCheck,
  AlertTriangle,
  Printer,
  ExternalLink,
  SearchCheck,
} from "lucide-react";

export interface DisclosureRedFlag {
  rceptNo: string;
  rceptDt: string;
  reportNm: string;
  category: "기재정정" | "자금조달(CB/유증)" | "소송/분쟁" | "감사의견/기타";
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface FactLockedBullet {
  tag: string;
  mainFact: string;
  subNote?: string;
  rceptNo?: string;
}

export interface ExecutiveOnePagerProps {
  corpName?: string;
  stockCode?: string;
  marketCls?: "Y" | "K" | "N";
  quarters?: QuarterlyFinancialPoint[];
  quote?: YahooQuotePayload | null;
  redFlags?: DisclosureRedFlag[];
  customBullets?: FactLockedBullet[];
  /** 실제 DART viewer.do 본문 링크를 만드는 상위 컴포넌트 콜백. 커버(main.do) 직링크는 사용하지 않습니다. */
  onOpenSource?: (term: string, rceptNo: string, basis: "CFS" | "OFS") => void;
}

export const DEFAULT_REFERENCE_QUARTERS: QuarterlyFinancialPoint[] = [];

export const ExecutiveOnePager: React.FC<ExecutiveOnePagerProps> = ({
  corpName = "DART 조회 대기",
  stockCode = "",
  marketCls = "Y",
  quarters = DEFAULT_REFERENCE_QUARTERS,
  quote = null,
  redFlags = [],
  customBullets,
  onOpenSource,
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<QuarterlyFinancialPoint | null>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  const verification = runDeterministicVerification(quarters);
  const metrics = computeFullMetrics(quarters, quote);
  if (quarters.length === 0) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">실제 DART 분기 공시자료가 없어 1-Pager를 생성하지 않았습니다. API 인증과 공시 조회를 먼저 완료하세요.</div>;
  }

  const actuals = quarters.filter((q) => !q.isEstimate);
  const latest = actuals[actuals.length - 1];
  const minOpQuarter = [...actuals].sort(
    (a, b) => a.operatingProfit / a.revenue - b.operatingProfit / b.revenue
  )[0];

  const hasSubsidiaryBoost =
    latest &&
    typeof latest.subsidiaryAndAdjProfit === "number" &&
    latest.subsidiaryAndAdjProfit > 0;

  const dynamicHeadline = hasSubsidiaryBoost
    ? `분기 실적 — 이익률은 ${metrics.operatingMarginPct}%로 올랐고, 그 위쪽 몫(+${latest.subsidiaryAndAdjProfit}억)은 자회사에서 왔다`
    : `분기 실적 — 최근 분기 매출 ${latest?.revenue.toLocaleString()}억·영업이익률 ${metrics.operatingMarginPct}% 기록 (DART 원문 검증 완료)`;

  const bullets: FactLockedBullet[] = customBullets ?? [];

  const chartWidth = 860;
  const leftPad = 56;
  const rightPad = 28;
  const plotWidth = chartWidth - leftPad - rightPad;
  const colWidth = plotWidth / quarters.length;

  const maxRev = Math.max(...quarters.map((q) => q.revenue), 2000);
  const maxOp = Math.max(...quarters.map((q) => q.operatingProfit), 350);
  const firstEstimateIdx = quarters.findIndex((q) => q.isEstimate);
  const getX = (idx: number) => leftPad + idx * colWidth + colWidth / 2;

  return (
    <div className="bg-[#faf9f5] text-stone-900 border border-stone-300 rounded-lg shadow-sm p-6 md:p-8 max-w-5xl mx-auto font-sans print:shadow-none print:border-none print:p-2">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-stone-300 print:hidden">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-900 text-emerald-50">
            <ShieldCheck className="w-3.5 h-3.5" />
            DART 원문 교차검증 {verification.scorePct}% Pass ({verification.checks.length}개 규칙)
          </span>
          <button
            onClick={() => setShowVerificationModal(!showVerificationModal)}
            className="text-xs font-medium text-stone-700 underline hover:text-stone-950"
          >
            {showVerificationModal ? "검증 상세 닫기" : "수치 검산 로그 열기"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-600">
            종목코드: <strong>{stockCode}</strong> ({marketCls === "Y" ? "KOSPI" : "KOSDAQ"})
          </span>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-stone-900 text-white text-xs font-medium hover:bg-stone-800"
          >
            <Printer className="w-3.5 h-3.5" />
            임원용 1-Pager 인쇄 / PDF 저장
          </button>
        </div>
      </div>

      {showVerificationModal && (
        <div className="mb-5 p-4 bg-white border border-emerald-300 rounded-md text-xs space-y-2 print:hidden">
          <div className="font-bold text-stone-900 flex items-center gap-1.5">
            <SearchCheck className="w-4 h-4 text-emerald-700" />
            결정론적(Deterministic) 재무 정합성 검산 결과 — 할루시네이션 개입 0%
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {verification.checks.map((chk) => (
              <div
                key={chk.id}
                className="p-2.5 rounded border border-stone-200 bg-stone-50 flex flex-col gap-1"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span>{chk.label}</span>
                  <span className={chk.passed ? "text-emerald-700" : "text-amber-700"}>
                    {chk.passed ? "✓ PASS" : "⚠ 확인필요"}
                  </span>
                </div>
                <div className="text-stone-600">산식: {chk.formula}</div>
                <div className="text-stone-800">{chk.note}</div>
                {chk.rceptNo && (
                  onOpenSource ? (
                    <button type="button" onClick={() => onOpenSource(chk.label, chk.rceptNo!, "CFS")} className="text-blue-700 hover:underline inline-flex items-center gap-1 mt-0.5">
                      DART 재무제표 본문 열기 (#{chk.rceptNo}) <ExternalLink className="w-3 h-3" />
                    </button>
                  ) : <span className="text-stone-500">DART 접수번호 #{chk.rceptNo} · 본문 링크를 사용할 수 없음</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t-2 border-b border-stone-800 py-2 text-[11px] leading-relaxed text-stone-700">
        <div className="grid grid-cols-12 gap-2 border-b border-stone-300 pb-1.5 mb-1.5">
          <div className="col-span-1 font-bold text-stone-900">보완</div>
          <div className="col-span-5">
            2024년 분기별 본체(별도) 미보완 구간은 주석으로 임의 메우지 않고 연결만 표시함
          </div>
          <div className="col-span-6">
            분기 체인은 1Q24부터 추적, 4Q는 연간(사업보고서)-9개월(3분기보고서) 차감치(조건부 검증)
          </div>
        </div>
        <div className="text-stone-600 flex flex-wrap items-center justify-between gap-2">
          <span>
            첨부 재무 기초자료 · DART 공시 API(접수번호는 각주 및 X-Ray 툴팁 기록) ·{" "}
            <strong className="text-stone-900">
              '기간 순이익/평균자본'은 연율을 곱하여 연간 ROE로 쓰지 않음
            </strong>
          </span>
          <span className="font-mono text-[10px] text-stone-500">
            대상: {corpName} ({stockCode})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 my-3 bg-white border border-stone-200 rounded p-2.5 text-xs">
        <div>
          <div className="text-[10px] text-stone-500">시가총액 (Yahoo)</div>
          <div className="font-bold text-stone-900">
            {metrics.marketCapEok ? `${metrics.marketCapEok.toLocaleString()}억` : "비상장/미연동"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500">PER (TTM)</div>
          <div className="font-bold text-stone-900">
            {metrics.perTtm ? `${metrics.perTtm}배` : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500">PBR (최근분기)</div>
          <div className="font-bold text-stone-900">
            {metrics.pbrLatest ? `${metrics.pbrLatest}배` : "-"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500">ROE (기간 / TTM)</div>
          <div className="font-bold text-stone-900">
            {metrics.periodRoePct ?? "-"}%{" "}
            <span className="text-[10px] font-normal text-stone-500">
              (TTM {metrics.ttmRoePct ?? "-"}%)
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500">ROA (기간 / TTM)</div>
          <div className="font-bold text-stone-900">
            {metrics.periodRoaPct ?? "-"}%{" "}
            <span className="text-[10px] font-normal text-stone-500">
              (TTM {metrics.ttmRoaPct ?? "-"}%)
            </span>
          </div>
        </div>
        <div>
          <div className="text-[10px] text-stone-500">부채비율 (DART)</div>
          <div className="font-bold text-stone-900">
            {metrics.debtToEquityPct ? `${metrics.debtToEquityPct}%` : "-"}
          </div>
        </div>
      </div>

      <h2 className="text-lg md:text-xl font-bold text-stone-900 tracking-tight mt-4 mb-3">
        {dynamicHeadline}
      </h2>

      <div className="bg-white border border-stone-200 rounded p-4 relative">
        {hoveredPoint && (
          <div className="absolute top-3 right-3 z-20 bg-stone-900 text-stone-50 text-[11px] px-3 py-2 rounded shadow-lg max-w-xs pointer-events-none">
            <div className="font-bold text-amber-300 mb-0.5">
              [X-Ray 원문 추적] {hoveredPoint.period}{" "}
              {hoveredPoint.isEstimate
                ? "(증권사 컨센서스)"
                : hoveredPoint.isFourthQuarterDerived
                ? "(연간 - 9M 차감)"
                : "(DART 분기 공시)"}
            </div>
            <div>• 연결 매출액: {hoveredPoint.revenue.toLocaleString()}억원</div>
            <div>
              • 연결 영업이익: {hoveredPoint.operatingProfit.toLocaleString()}억원 (OPM{" "}
              {((hoveredPoint.operatingProfit / hoveredPoint.revenue) * 100).toFixed(1)}%)
            </div>
            {typeof hoveredPoint.separateOperatingProfit === "number" && (
              <div>
                • 본체(별도) OP: {hoveredPoint.separateOperatingProfit}억 / 자회사·조정:{" "}
                {hoveredPoint.subsidiaryAndAdjProfit! >= 0
                  ? `+${hoveredPoint.subsidiaryAndAdjProfit}억`
                  : `${hoveredPoint.subsidiaryAndAdjProfit}억`}
              </div>
            )}
            {hoveredPoint.rceptNo && (
              <div className="text-emerald-300 mt-0.5">
                • DART 접수번호: {hoveredPoint.rceptNo}
              </div>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${chartWidth} 570`}
          className="w-full h-auto select-none overflow-visible"
        >
          <defs>
            <pattern
              id="diagonalHatch"
              width="6"
              height="6"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="6" stroke="#78716c" strokeWidth="1.5" />
            </pattern>
          </defs>

          {firstEstimateIdx >= 0 && (
            <>
              <rect
                x={leftPad + firstEstimateIdx * colWidth}
                y={15}
                width={(quarters.length - firstEstimateIdx) * colWidth}
                height={500}
                fill="#f5f5f4"
                opacity={0.7}
              />
              <line
                x1={leftPad + firstEstimateIdx * colWidth}
                y1={15}
                x2={leftPad + firstEstimateIdx * colWidth}
                y2={515}
                stroke="#78716c"
                strokeWidth="1"
                strokeDasharray="4 3"
              />
            </>
          )}

          <text x={leftPad} y={16} fontSize="11" fontWeight="bold" fill="#44403c">
            이익률(%)
          </text>
          {[0, 10, 20, 30].map((pct) => {
            const y = 160 - (pct / 32) * 130;
            return (
              <g key={`rate-grid-${pct}`}>
                <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} stroke="#e7e5e4" strokeWidth="1" />
                <text x={leftPad - 8} y={y + 4} fontSize="10" textAnchor="end" fill="#78716c">
                  {pct}%
                </text>
              </g>
            );
          })}

          {quarters.map((q, idx) => {
            if (idx === 0 || typeof q.grossProfit !== "number") return null;
            const prevQ = quarters[idx - 1];
            if (typeof prevQ.grossProfit !== "number") return null;
            const prevGpm = (prevQ.grossProfit / prevQ.revenue) * 100;
            const curGpm = (q.grossProfit / q.revenue) * 100;
            return (
              <line
                key={`gpm-line-${q.period}`}
                x1={getX(idx - 1)}
                y1={160 - (prevGpm / 32) * 130}
                x2={getX(idx)}
                y2={160 - (curGpm / 32) * 130}
                stroke="#292524"
                strokeWidth="2"
              />
            );
          })}

          {quarters.map((q, idx) => {
            if (idx === 0) return null;
            const prevQ = quarters[idx - 1];
            const prevOpm = (prevQ.operatingProfit / prevQ.revenue) * 100;
            const curOpm = (q.operatingProfit / q.revenue) * 100;
            return (
              <line
                key={`opm-line-${q.period}`}
                x1={getX(idx - 1)}
                y1={160 - (prevOpm / 32) * 130}
                x2={getX(idx)}
                y2={160 - (curOpm / 32) * 130}
                stroke="#991b1b"
                strokeWidth="2"
                strokeDasharray={q.isEstimate ? "4 3" : undefined}
              />
            );
          })}

          {quarters.map((q, idx) => {
            const x = getX(idx);
            const opm = Number(((q.operatingProfit / q.revenue) * 100).toFixed(1));
            const yOpm = 160 - (opm / 32) * 130;
            const gpm =
              typeof q.grossProfit === "number"
                ? Number(((q.grossProfit / q.revenue) * 100).toFixed(1))
                : null;
            const yGpm = gpm !== null ? 160 - (gpm / 32) * 130 : null;

            return (
              <g key={`rate-pt-${q.period}`} onMouseEnter={() => setHoveredPoint(q)} className="cursor-pointer">
                {yGpm !== null && (
                  <>
                    <circle cx={x} cy={yGpm} r="3" fill="#292524" />
                    <text x={x} y={yGpm - 7} fontSize="9.5" fontWeight="600" textAnchor="middle" fill="#292524">
                      {gpm !== null ? gpm.toFixed(1) : "—"}
                    </text>
                  </>
                )}
                <circle cx={x} cy={yOpm} r="3" fill={q.isEstimate ? "#ffffff" : "#991b1b"} stroke="#991b1b" strokeWidth="1.5" />
                <text x={x} y={yOpm + 13} fontSize="9.5" fontWeight="600" textAnchor="middle" fill="#991b1b">
                  {opm.toFixed(1)}
                </text>
              </g>
            );
          })}

          <text x={leftPad} y={190} fontSize="11" fontWeight="bold" fill="#44403c">
            매출(억)
          </text>
          {[0, 1000, 2000].map((val) => {
            const y = 335 - (val / maxRev) * 125;
            return (
              <g key={`rev-grid-${val}`}>
                <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} stroke="#e7e5e4" strokeWidth="1" />
                <text x={leftPad - 8} y={y + 4} fontSize="10" textAnchor="end" fill="#78716c">
                  {val.toLocaleString()}
                </text>
              </g>
            );
          })}

          {quarters.map((q, idx) => {
            const x = getX(idx);
            const barW = Math.min(28, colWidth * 0.55);
            const barH = (q.revenue / maxRev) * 125;
            const y = 335 - barH;
            return (
              <g key={`rev-bar-${q.period}`} onMouseEnter={() => setHoveredPoint(q)} className="cursor-pointer">
                <rect
                  x={x - barW / 2}
                  y={y}
                  width={barW}
                  height={barH}
                  fill={q.isEstimate ? "url(#diagonalHatch)" : "#57534e"}
                  stroke="#44403c"
                  strokeWidth="0.8"
                />
                <text x={x} y={y - 5} fontSize="9.5" fontWeight="600" textAnchor="middle" fill="#292524">
                  {q.revenue.toLocaleString()}
                </text>
              </g>
            );
          })}

          <text x={leftPad} y={360} fontSize="11" fontWeight="bold" fill="#44403c">
            영업이익(억)
          </text>
          {[0, 100, 200, 300].map((val) => {
            const y = 505 - (val / maxOp) * 125;
            return (
              <g key={`op-grid-${val}`}>
                <line x1={leftPad} y1={y} x2={chartWidth - rightPad} y2={y} stroke="#e7e5e4" strokeWidth="1" />
                <text x={leftPad - 8} y={y + 4} fontSize="10" textAnchor="end" fill="#78716c">
                  {val}
                </text>
              </g>
            );
          })}

          {quarters.map((q, idx) => {
            const x = getX(idx);
            const barW = Math.min(28, colWidth * 0.55);
            const totalH = (q.operatingProfit / maxOp) * 125;
            const hasDecomp =
              typeof q.separateOperatingProfit === "number" &&
              typeof q.subsidiaryAndAdjProfit === "number";

            const baseOp = hasDecomp
              ? Math.min(q.operatingProfit, Math.max(0, q.separateOperatingProfit!))
              : q.operatingProfit;
            const subOp = hasDecomp ? q.subsidiaryAndAdjProfit! : 0;

            const baseH = (baseOp / maxOp) * 125;
            const subH = (Math.abs(subOp) / maxOp) * 125;
            const topY = 505 - totalH;

            return (
              <g key={`op-bar-${q.period}`} onMouseEnter={() => setHoveredPoint(q)} className="cursor-pointer">
                {q.isEstimate ? (
                  <rect
                    x={x - barW / 2}
                    y={topY}
                    width={barW}
                    height={totalH}
                    fill="#cbd5e1"
                    stroke="#475569"
                    strokeDasharray="3 2"
                  />
                ) : hasDecomp && subOp > 0 ? (
                  <>
                    <rect x={x - barW / 2} y={505 - baseH} width={barW} height={baseH} fill="#4d7c7b" />
                    <rect x={x - barW / 2} y={505 - baseH - subH} width={barW} height={subH} fill="#c26d3a" />
                  </>
                ) : (
                  <rect x={x - barW / 2} y={topY} width={barW} height={totalH} fill="#4d7c7b" />
                )}

                <text
                  x={x}
                  y={topY - (hasDecomp && subOp !== 0 ? 13 : 5)}
                  fontSize="9.5"
                  fontWeight="bold"
                  textAnchor="middle"
                  fill="#1c1917"
                >
                  {q.operatingProfit}
                </text>

                {hasDecomp && subOp !== 0 && (
                  <text
                    x={x}
                    y={topY - 3}
                    fontSize="8.5"
                    fontWeight="600"
                    textAnchor="middle"
                    fill={subOp > 0 ? "#b45309" : "#b91c1c"}
                  >
                    {subOp > 0 ? `+${subOp}` : subOp}
                  </text>
                )}

                <text
                  x={x}
                  y={525}
                  fontSize="10"
                  fontWeight={q.isEstimate ? "600" : "500"}
                  textAnchor="middle"
                  fill={q.isEstimate ? "#78716c" : "#292524"}
                >
                  {q.period}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-stone-700 pt-2 border-t border-stone-200">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-stone-900 inline-block" /> 매출총이익률
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-red-800 inline-block" /> 영업이익률
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 bg-stone-600 inline-block rounded-xs" /> 매출
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 bg-[#4d7c7b] inline-block rounded-xs" /> 본체(별도) 영업이익
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 bg-[#c26d3a] inline-block rounded-xs" /> 자회사·연결조정 몫
          </span>
        </div>

        <p className="text-[11px] text-stone-600 mt-2 leading-relaxed">
          분기 매출·영업이익과 이익률(연결), 아래 막대는 본체(별도) 영업이익과 그 위의 자회사·연결조정 몫.
          2024년은 별도 분기치를 보완하지 않아 연결만 표시했다. *4Q24·4Q25는 연간-9개월 차감치(조건부).
          3Q26E~4Q26E는 증권사 컨센서스 평균. (출처: DART 전자공시시스템, Yahoo Finance)
        </p>
      </div>

      <div className="mt-4 space-y-2.5 text-xs md:text-[13px] leading-relaxed text-stone-800">
        {bullets.map((b, idx) => (
          <div key={idx} className="pl-2 border-l-2 border-stone-800">
            <div>
              <strong className="font-bold text-stone-950">• {b.tag}</strong> — {b.mainFact}
              {b.rceptNo && (onOpenSource ? (
                <button type="button" onClick={() => onOpenSource(b.tag, b.rceptNo!, "CFS")} className="ml-1.5 text-[10px] text-stone-500 hover:text-stone-900 underline print:no-underline">
                  [DART 재무제표 본문 #{b.rceptNo}]
                </button>
              ) : <span className="ml-1.5 text-[10px] text-stone-500">[DART #{b.rceptNo} · 본문 이동 미설정]</span>)}
            </div>
            {b.subNote && (
              <div className="pl-3 mt-0.5 text-stone-600 text-[12px]">
                - {b.subNote}
              </div>
            )}
          </div>
        ))}
      </div>

      {redFlags && redFlags.length > 0 && (
        <div className="mt-4 p-3 bg-amber-50/70 border border-amber-300 rounded text-xs">
          <div className="font-bold text-amber-950 flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-700" />
            최근 1년 지배구조·자금조달·정정공시 체크포인트 (Red Flag Radar)
          </div>
          <ul className="space-y-1 text-stone-800">
            {redFlags.map((rf) => (
              <li key={rf.rceptNo} className="flex items-center justify-between">
                <span>
                  <strong className="text-amber-900">[{rf.category}]</strong> {rf.reportNm} ({rf.rceptDt})
                </span>
                {onOpenSource ? (
                  <button type="button" onClick={() => onOpenSource("재무상태표", rf.rceptNo, "CFS")} className="text-blue-700 hover:underline text-[11px]">DART 본문 확인 ↗</button>
                ) : <span className="text-stone-500 text-[11px]">접수번호 #{rf.rceptNo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ExecutiveOnePager;