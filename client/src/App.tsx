import React, { useState } from "react";
import OriginalApp from "./OriginalApp";
import { ExecutiveOnePager } from "./components/ExecutiveOnePager";

export function App() {
  const [viewMode, setViewMode] = useState<"ONE_PAGER" | "LEGACY_DART">("ONE_PAGER");

  return (
    <div className="min-h-screen bg-stone-100">
      {/* 상단 고정 모드 전환 네비게이션 바 (인쇄 시 자동 숨김) */}
      <div className="sticky top-0 z-50 bg-stone-900 text-stone-100 px-4 py-2.5 shadow-md flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-400 text-stone-950 rounded">
            AI 공모전 V6
          </span>
          <span className="font-bold text-sm tracking-tight">
            Disclosure Navigator — Fact-Locked 리서치 에이전트
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("ONE_PAGER")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
              viewMode === "ONE_PAGER"
                ? "bg-emerald-500 text-stone-950 shadow"
                : "bg-stone-800 text-stone-300 hover:bg-stone-700"
            }`}
          >
            📊 임원용 1-Pager 종합분석 (3단 차트·교차검증)
          </button>
          <button
            onClick={() => setViewMode("LEGACY_DART")}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
              viewMode === "LEGACY_DART"
                ? "bg-emerald-500 text-stone-950 shadow"
                : "bg-stone-800 text-stone-300 hover:bg-stone-700"
            }`}
          >
            🔍 실시간 DART 공시 수집·검증 패널
          </button>
        </div>
      </div>

      {viewMode === "ONE_PAGER" ? (
        <div className="py-6 px-4">
          <ExecutiveOnePager corpName="대한전선" stockCode="001440" marketCls="Y" />
        </div>
      ) : (
        <OriginalApp />
      )}
    </div>
  );
}

export default App;