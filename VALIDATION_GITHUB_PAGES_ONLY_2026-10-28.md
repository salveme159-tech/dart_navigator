# GitHub Pages 단독 배포 검증 결과

## 실행 결과

- `pnpm test`: 112개 테스트 통과
- `pnpm check`: TypeScript 통과
- `pnpm build:pages`: Vite 정적 빌드 통과
- `dist/public/index.html`: 생성 확인
- `dist/public/manus-routes.json`: 생성 확인

Vite가 `/api/platform/config.js`를 모듈로 번들할 수 없다는 경고와 번들 크기 경고는 있으나 정적 빌드는 성공했습니다.

## 이번 수정

- DART 기업목록에 `stock_code`가 없는 비상장사도 `corp_code`로 조회하도록 홈 초기 로딩의 상장코드 필터를 제거했습니다.
- 차입금 구성계정에 `유동성 금융기관차입금` 변형을 추가했습니다.
- 총차입금 합계와 구성계정이 불일치할 때 불일치 안내를 복원했습니다.
- 구성계정과 `차입금및사채` 합계행이 함께 있을 때 중복 합산 방지 안내를 표시합니다.
- 리스부채가 포함된 차입금 합계 경로에서도 구성계정명을 계산식에 표시합니다.
- GitHub Pages만으로 서버 기능을 대체할 수 없는 이유와 가능한 축소형 Actions 대안을 `GITHUB_PAGES_ONLY_LIMITATIONS_KO.md`에 기록했습니다.

## 중요한 배포 조건

GitHub Pages는 정적 파일만 호스팅합니다. 현재 앱의 실시간 DART API 호출, 주석·공시 원문 파싱, `viewDoc` 딥링크 생성, 임의 기업 조회, 자동 공시 알람은 `/api/trpc` 서버가 필요합니다.

따라서 `VITE_API_BASE_URL`이 비어 있는 GitHub Pages 링크는 화면은 열리지만 실시간 기능 전체가 정상 동작하지 않습니다. Render를 사용하지 않으려면 별도의 HTTPS 서버리스 API(예: Cloudflare Workers, AWS Lambda/API Gateway, Vercel Functions, Netlify Functions)가 필요합니다. GitHub Settings > Pages 링크만으로는 이 서버를 만들 수 없습니다.
