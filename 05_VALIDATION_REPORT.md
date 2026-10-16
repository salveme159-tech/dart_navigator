# Validation Report — 증거 수준 명시

## 이번 문서 감사에서 확인
- 압축 파일을 해제하고 `package.json`, `server/routers.ts`, `server/dart/engine.ts`, `client/src/pages/Home.tsx`, `client/src/lib/xlsxExport.ts`를 직접 읽었습니다.
- 소스 트리에 TS/TSX 파일 **81개**, `*.test.ts` 파일 **1개**가 있습니다. 파일 수는 테스트 통과 건수가 아닙니다.
- tRPC 라우터 선언과 pnpm 실행 스크립트의 존재를 확인했습니다.

## 이전 보고서의 검증 주장 (이번에 재실행하지 않음)
원본 `VALIDATION_REPORT.md`는 TS 구문 변환, 특정 엔진 검사, XLSX 수식·캐시값 점검을 주장합니다. 해당 결과를 이 문서에서 재실행 검증한 것으로 취급하지 않습니다.

## 미검증 — 제출 전 필수
- `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`, `pnpm build` 전부 통과
- 실제 브라우저 첫 접속·체험 5개 시나리오·거부 시나리오·실시간 첫 응답 렌더링
- DART 원문과 대한전선 2026 반기 매출·영업이익·순차입금·ROE 일치
- 3개월/누적, 연결/별도, 누락계정 0 처리, 정정공시, 회사명 모호성
- XLSX 모든 파생지표 수식 존재, 외부 계산 엔진으로 재계산, PDF 한글
- 키가 네트워크 로그·서버 로그·오류·PDF·XLSX에 노출되지 않음
- 배포된 HTTPS 서비스, 실제 OpenDART 인증키로 호출 성공

## 검증 기록 양식
| 항목 | 환경/명령 | 기대 결과 | 실제 결과 | 증거 | 판정 |
|---|---|---|---|---|---|
| 타입검사 | `pnpm check` | exit 0 | 미실행 | 없음 | NOT RUN |
| 테스트 | `pnpm test` | exit 0 | 미실행 | 없음 | NOT RUN |
| 빌드 | `pnpm build` | exit 0 | 미실행 | 없음 | NOT RUN |

**판정 기준:** 코드가 존재한다는 사실과 실행 성공을 혼동하지 않습니다.
