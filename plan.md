# DART Navigator Manus 서버 연동 계획

## 구현 목표

GitHub Pages는 React 정적 프런트엔드로 유지하고, Manus Webdev 관리 서버는 OpenDART API 호출과 재무 원문 파싱을 담당한다. 프런트엔드는 `VITE_API_BASE_URL`에 Manus HTTPS API 주소를 넣어 `/api/trpc`를 호출한다. OpenDART 키는 브라우저 코드나 GitHub Pages 정적 산출물에 넣지 않고 사용자가 입력한 키를 HTTPS 요청 헤더로 전달하거나 Manus Secret으로 관리한다.

## 구성

- `client/`: GitHub Pages에 배포되는 정적 React 화면
- `server/`: Manus 서버에서 실행되는 Express/tRPC API, DART 조회·파싱·딥링크·공시 확인
- `server/dart/`: 원천 계정·주석·리스부채·보고기간 계산 로직
- `.github/workflows/deploy.yml`: GitHub Pages 빌드. `VITE_API_BASE_URL`은 Manus API 공개 주소로 주입
- `Dockerfile`: Manus 컨테이너 배포용 서버 실행 파일

## 핵심 동작

기업은 상장 여부와 무관하게 DART `corp_code`로 찾는다. `stock_code`가 없는 기업은 DART 수치만 조회하고 시장자료 교차검증은 비교 불가로 표시한다. 차입금 계산은 본문 리스부채와 같은 공시 주석에서 확인한 장부금액을 중복 제거해 포함한다. DART 본문 링크는 검증된 `viewer.do`만 열고 실패 시 공시 첫 화면으로 자동 대체하지 않는다.

## 배포

Manus 서버는 `/api/health`를 공개 상태 확인 경로로 제공하고, GitHub Pages origin을 CORS 허용 목록에 둔다. 서버 공개 후 그 HTTPS URL을 GitHub 저장소 Settings > Secrets and variables > Actions > Variables의 `VITE_API_BASE_URL`에 넣고 Pages workflow를 실행한다.
