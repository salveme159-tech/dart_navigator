# Validation branch repair

- Removed unused legacy OAuth SDK, callback, cookie, and obsolete auth/platform tests. Active server context is anonymous and appRouter exposes DART routes only.
- Fixed demo snapshot metrics type to use the full MetricKey index signature.
- Removed unused legacy client authentication files.
- Removed browser error logging that might expose sensitive request context.

## Verification limits

This is a source repair, **not** a passed CI/build certification. Run the validation workflow. Any new errors must be addressed before merging to main.

## GitHub web upload deletion list

Delete these existing paths on validation (GitHub web upload does not remove absent files):
- server/_core/sdk.ts
- server/_core/oauth.ts
- server/_core/cookies.ts
- server/platform.test.ts
- server/auth.logout.test.ts
- client/src/const.ts
- client/src/_core/hooks/useAuth.ts
- client/src/components/DashboardLayout.tsx
- client/src/components/DashboardLayoutSkeleton.tsx

## DART v3 user-test fixes — 2026-10-08

- API 인증키 안내를 항상 펼쳐 표시하고 신청 링크 바로 아래에 입력/복사 절차를 노출.
- 첫 화면 커스텀 지표 카드 간격을 축소하고 삭제 X를 추가. 카드 우측 상단의 장식 아이콘 및 불필요한 상태/신뢰 문구 제거.
- 커스텀 지표의 차입금·CAPEX·FCF 계산 경로를 보강하고, 체험 모드에도 대한전선 2026 H1 검증값을 표시.
- 질문하기에서 영업이익률 우선 인식, 숫자 우측 정렬, 계산기 아이콘 제거, PDF/Excel 결과표 포함.
- 자연어/카테고리 검색 기준을 명확히 하고 세부 검색어가 선택 지표를 덮어쓰지 않도록 정리.
- 비교분석을 기업 검색/등록/선택/삭제 + 2~5개 지표 칩 선택 방식으로 개편하고 기업별 지표값·출처 테이블 제공.
- 비교/질문용 계산 지표에서 순운전자본·순차입금 명칭을 운전자본·차입금으로 정리하고, 지정된 투자지표(이자보상배율·ROE·ROA·EPS·PER·PBR)를 비교 선택에서 제거.
- 재무용어 목록을 사용자 요청 목록으로 정리하고 자본총계·부채총계·금융원가·차입금·운전자본 등 질의 기능을 추가.
- 브랜드/메뉴를 DART 중심으로 정리하고 Workspace/FACT-CHECKER/OpenDART 연결 상태 문구 제거.
- 순이익 계정 별칭을 확대하고 금융원가 별칭을 보강하여 회사별 계정명 차이를 흡수.

## Verification limits

Local dependencies are not installed in this environment, so a full `pnpm build`/`pnpm check` was not executed successfully here. Changed TypeScript sources were parse-checked with the available global TypeScript compiler; only expected missing dependency/type-definition errors were reported.
