# DART 조회 서버 연결 가이드

## 왜 필요한가
이 앱은 브라우저가 OpenDART를 직접 호출하지 않고, 서버(`/api/trpc/...`)를 거쳐 조회합니다(OpenDART가 브라우저 직접 호출을 허용하지 않고, 공시 원문 파싱도 서버에서 하기 때문).
GitHub Pages는 정적 파일만 올릴 수 있어 서버가 없으므로, 인증키를 입력해도 검증이 실패합니다.
→ 서버를 어딘가에 따로 띄우고 그 주소를 앱에 알려 주어야 합니다.

## 방법 A (권장): 서버가 사이트까지 함께 서비스 — 설정이 가장 단순
1. GitHub 저장소를 Render(render.com)에 연결하고 `New + > Blueprint`로 이 저장소의 `render.yaml`을 선택합니다.
   (Dockerfile로 빌드되며 `VITE_BASE=/`로 사이트가 루트 경로에 올라갑니다.)
2. 배포가 끝나면 나오는 주소(`https://dart-navigator-xxxx.onrender.com`)로 접속해 인증키를 입력합니다.
   - 같은 주소에서 사이트와 API가 함께 동작하므로 CORS 설정이 필요 없습니다.
3. 무료 플랜은 일정 시간 미사용 시 잠들어 첫 접속이 30~60초 걸릴 수 있습니다. 심사·시연 전에는 미리 한 번 열어 두세요.

## 방법 B: GitHub Pages 유지 + API 서버만 별도 배포
1. 방법 A의 1번처럼 Render에 서버를 배포하고, 서비스 환경변수에 아래를 추가합니다.
   - `CORS_ALLOWED_ORIGINS` = `https://salveme159-tech.github.io`
2. GitHub 저장소 `Settings > Secrets and variables > Actions > Variables`에 변수를 등록합니다.
   - 이름: `VITE_API_BASE_URL`, 값: 서버 주소(예: `https://dart-navigator-xxxx.onrender.com`, 끝의 `/` 없이)
3. `Actions`에서 `Deploy to GitHub Pages`를 다시 실행하면 새 주소가 빌드에 반영됩니다.

## 확인 방법
- 서버 주소 뒤에 `/api/health`를 붙여 열었을 때 `{"status":"ok"}`가 보여야 합니다.
- 인증키 입력 후 입력창으로 돌아오면 이제 화면 상단 노란 안내 상자에 사유가 표시됩니다.
  - 「서버가 연결되어 있지 않습니다 / 정상 응답하지 않았습니다」 → 서버 주소·CORS·서버 실행 상태 문제
  - 「DART 인증키 검증에 실패했습니다」 → 키 자체 문제
