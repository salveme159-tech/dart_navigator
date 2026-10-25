# Validation Report — 증거 및 실행 상태

작성일: 2026-10-17

## 이번 변경에서 실행한 검증
- TypeScript/TSX 소스 218개 구문 변환 검사: 0 syntax diagnostics.
- 자연어 질의 8개 대표 케이스 실행: 기간, 추이, 비교, 원인, 영업이익률, 투자현금흐름, 차입금의존도 해석 통과.
- 실제 계정 행으로 순차입금 완전성 가드 테스트: 모든 필수 계정이 있으면 계산, 하나라도 누락되면 실패.
- 정적 검사에서 실행 코드에서 스냅샷 상수, 임의 접수번호, CAPEX 비율 추정, 억원 정수 강제 반올림을 찾지 못함(문서의 변경 설명 문구는 제외).

## 이번 실행 환경에서 실행하지 못한 검증
- 전체 `pnpm check`, 전체 Vitest, 프로덕션 Vite 빌드.
- 실 OpenDART 인증키를 사용한 실제 조회와 원문 숫자 대조.
- DART 문서 뷰어의 실시간 `dcmNo`/`eleId` 딥링크와 문서 API의 사업보고서 원인 문장 추출 실검증.

## 사용자의 이전 로컬 로그에 대해 수정한 원인
`tsconfig.json`의 `baseUrl: "."`가 `vite`, `sonner`, `input-otp` 패키지 이름을 프로젝트 루트의 동명 TS 파일과 충돌시키고 잘못된 `vite.config` 경로를 해석하도록 한 문제를 제거했다. 추가로 nullable `gpm` 표시, `pickMetric` 타입 추론, 자연어 엔진 문자열 길이 정렬 오류를 수정했다.

## 제출 전 필수 명령
```bat
pnpm install
pnpm check
pnpm test
pnpm dev
```
실제 OpenDART 인증키로 실행한 뒤 대표 질의의 기간·CFS/OFS 기준·접수번호·숫자를 원문과 대조해야 검증 완료로 판단한다.

세부 변경사항은 [NATURAL_LANGUAGE_REPAIR_REPORT.md](NATURAL_LANGUAGE_REPAIR_REPORT.md)를 참조한다.
