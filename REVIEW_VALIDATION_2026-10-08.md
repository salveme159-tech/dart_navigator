# 수정 및 검증 현황 (2026-10-08)

## 반영된 코드 수정
- 첫 방문(인증키 없음) 시 인증키 연결 모달을 첫 화면으로 표시. 신청 바로가기, 발급키 확인/복사/붙여넣기 안내 버튼, 체험 모드 계속하기 제공.
- 기존 서비스 로그인 단계는 사용하지 않음. 기존 대시보드로 바로 진입하는 흐름은 인증키 연결 또는 체험 선택 뒤로 이동.
- snapshotDart의 미존재 기업 -> 기본 기업 대체 제거.
- DART 기업코드/재무제표 fetch에 15초 타임아웃 적용.
- client.ts의 누락된 normalizeQuestion import, N 보조 함수 추가.
- XLSX Blob 생성 시 Uint8Array 복사.
- 조회 기간 후보 중 2015년 이전 연도 스킵.

## 검증 상태 및 한계
- 압축 파일 생성 및 ZIP CRC 검사는 수행.
- `tsc --noEmit` 실행 결과 의존성 부재로 @types/node 및 vite/client를 찾지 못함. 따라서 전체 TypeScript 검사 통과를 주장하지 않음.
- Vitest 전체 실행, production build, 브라우저 E2E, 실 DART API와 체험 fixture 원문 대조, XLSX 재계산, PDF 출력은 수행하지 못함.
- 이전 검토에서 제기된 Demo fixture 출처 검증, API key 저장 전에 인증 검증, rate limit 분산환경, 재무계정 매핑, query parser 회귀 등은 추가 검증/개선 필요.
- 이 패치는 배포 검증 완료본이 아니라 기능 수정 및 리뷰 대상임.

## 반드시 실행할 명령
`pnpm install --frozen-lockfile && pnpm check && pnpm test && pnpm build`

이후 새 브라우저 프로필에서 인증키 연결, 체험 모드, 잘못된 기업명, 기간 2014년, 순차입금/ROE, PDF/XLSX, 원문 이동을 확인할 것.
