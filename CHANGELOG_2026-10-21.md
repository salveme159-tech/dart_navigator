# DART Navigator 수정 내역 — 2026-10-21

## 1. 공시 원문 바로가기 (표지가 아니라 재무제표 본문으로)
- `server/dart/viewerLink.ts`
  - 목차(main.do)가 `children.push` 관계 없이 `depth` 속성만 가진 평면 구조여도 상위 '연결/별도 재무제표'를 판별.
  - `var nodeN = {}` 방식이 아닌 객체 리터럴(JSON) 목차도 파싱. `eleId`가 없으면 `id` 사용.
  - 세부 재무제표 목차가 없을 때의 단계적 대체: ① 연결/별도 재무제표 묶음 → ② 반대 기준 재무제표(기준 차이 안내) → ③ '재무에 관한 사항' 본문 구간. 어느 단계도 공시 표지로 보내지 않음.
  - 기존 타입 오류(`selectBestFinancialStatementNode`의 flatMap 반환 타입) 수정.
- `client/src/pages/Home.tsx`
  - 본문 이동 시 지표명이 아니라 실제 계정과목명(예: 차입금 → '차입금', 순이익 → '당기순이익')을 클립보드에 복사하고, 안내 문구에 "표에서 '○○' 행을 확인" 표시.
  - 기준 차이/재무 구간 대체 링크를 허용하고 안내 문구 표시.
- 한계: 이 환경에서는 DART 실서버에 접속하지 못해 실제 공시 화면으로 검증하지 못했습니다. 모의 HTML 테스트만 통과했습니다. DART 뷰어는 표 행 단위 주소를 제공하지 않으므로 '해당 재무제표 본문' 단위로 이동합니다.

## 2. 차입금·차입금 의존도 계산 (공시에 있는 숫자로 계산)
- `server/dart/client.ts` `pickGrossBorrowingMetric`
  - 재무상태표에서 확인된 차입금·사채·리스부채 계정을 그대로 합산. 일부 계정이 없어도 값을 숨기지 않고, 없는 계정은 0으로 넣지 않고 합계에서 제외한다는 안내를 표시.
  - '총차입금' 합계 계정이 있으면 그 값을 사용. 구성 계정 합계와 1%/1억원 이상 다르면 값은 표시하되 불일치 안내.
  - 구성 계정 없이 '차입금및사채' 한 줄만 있으면 그 값을 총차입금으로 사용(구성 계정과 함께 있으면 중복 방지를 위해 제외).
  - 차입금 계정이 전혀 없을 때만 '누락'으로 계산 중단.
  - 기존 정책 유지: 차입금 의존도 분자에는 리스부채 포함, 순차입금 계산은 변경 없음.
- 정책 변경에 맞춰 테스트 3건을 수정하고 5건을 추가.

## 3. 빌드·테스트 설정
- `package.json`에 `build` 스크립트 추가(Dockerfile이 `pnpm build`를 호출하나 스크립트가 없었음).
- `vitest.config.ts`가 `client/src/**/*.test.ts`도 실행하도록 수정.
- 루트에 흩어져 있던 중복 파일 93개 삭제, 내용이 다른 옛 사본은 `_archive_stray_root_files/`로 이동(불필요하면 폴더째 삭제).

## 4. 인증키 입력 후 입력창으로 되돌아가는 문제
- 원인: 키 검증이 서버(`/api/trpc/dart.validateKey`)에 의존하는데 GitHub Pages에는 서버가 없어 검증이 실패했고, 실패 시 저장된 키를 지우고 입력창으로 되돌렸습니다. 그 입력창에는 오류 메시지를 보여줄 자리도 없어 이유가 보이지 않았습니다.
- 수정: 키 오류(invalid/format)와 서버 미연결(no-server/network)을 구분. 서버 문제일 때는 저장된 키를 지우지 않음. 입력창 상단에 사유를 노란 안내 상자로 표시. GitHub Pages에서 서버 주소가 없으면 호출 전에 바로 안내.
- 배포: `deploy.yml`이 저장소 변수 `VITE_API_BASE_URL`을 빌드에 주입. `render.yaml`, `DEPLOY_BACKEND_KO.md` 추가. `vite.config.ts`의 `base`를 `VITE_BASE`로 바꿀 수 있게 하고 Dockerfile은 `/`로 빌드(서버가 사이트까지 서비스).
- 서버를 실제로 배포하고 `VITE_API_BASE_URL`을 설정해야 사이트가 동작합니다. 이 환경에서는 서버 배포·실접속을 하지 못했습니다.

## 5. 검증 상태
- 오프라인 환경에서 간이 vitest 러너로 `server/dart.test.ts` 68건 전부 통과, `realDartClient.test.ts` 통과.
- `pnpm install`, `pnpm check`(전체 타입체크), 빌드, 실제 DART 응답 대조는 실행하지 못했습니다. 로컬에서 `pnpm install && pnpm test && pnpm check` 확인이 필요합니다.

- 로컬 `pnpm test` 81건 통과 확인 후, `pnpm check`에서 나온 타입 오류 2건(Home.tsx `apiBaseUrl` import 누락, client.ts 비교 행의 `basis` 타입 누락)을 수정했습니다.
