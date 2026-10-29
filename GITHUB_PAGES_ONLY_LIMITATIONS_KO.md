# GitHub Pages 단독 배포 검토

## 결론

GitHub Pages의 Settings > Pages가 제공하는 링크만으로는 이 애플리케이션의 모든 실시간 기능을 정상 동작시킬 수 없습니다. GitHub Pages는 정적 HTML/CSS/JavaScript 파일만 제공하며 서버 코드를 실행하지 않습니다.

현재 앱의 다음 기능은 서버(`/api/trpc`)가 필요합니다.

- OpenDART 인증키 검증
- 기업코드 ZIP 다운로드 및 기업 검색
- 정기보고서·주석 원문 조회와 파싱
- 연결·별도 재무제표 선택 및 지표 계산
- DART `viewDoc` 목차에서 실제 `dcmNo`, `eleId`, `offset`, `length`를 추출하는 본문 딥링크
- 여러 기업 비교 및 기간별 재무 조회
- 관심기업 신규 공시의 주기적 확인

브라우저에서 GitHub Pages가 OpenDART를 직접 호출하도록 바꾸는 방식은 사용할 수 없습니다. OpenDART 응답에는 브라우저 교차 출처 호출을 허용하는 CORS 헤더가 없고, 인증키를 정적 JavaScript에 넣으면 누구나 키를 볼 수 있습니다. 공시 원문 ZIP과 HTML 파싱도 서버 작업입니다.

## 현재 GitHub Pages workflow의 의미

`.github/workflows/deploy.yml`은 `VITE_API_BASE_URL`을 빌드 변수로 읽습니다. 따라서 GitHub Pages는 프런트엔드를 배포할 수 있지만, `VITE_API_BASE_URL`에는 별도로 실행 중인 HTTPS API 서버 주소가 필요합니다. 그 값을 비워 두면 페이지는 열리지만 실시간 조회·인증·본문 딥링크·공시 알람은 동작하지 않습니다.

GitHub Actions의 Secrets/Variables는 빌드 작업에만 전달됩니다. Pages가 배포된 뒤에는 해당 Secret이 API 서버가 되지 않으며, Actions가 계속 실행되는 상시 HTTP API도 아닙니다.

## 요구사항을 모두 유지하는 유일한 구조

`GitHub Pages + 별도 HTTPS API 서버` 구조가 필요합니다.

1. GitHub Pages는 React 정적 화면을 제공합니다.
2. 별도 API 서버는 OpenDART 인증키를 서버 환경변수로 보관합니다.
3. API 서버가 DART 호출·주석 파싱·본문 딥링크를 수행합니다.
4. GitHub Pages의 `VITE_API_BASE_URL`에 그 API 서버 주소를 넣습니다.
5. API 서버의 CORS 허용 origin에 GitHub Pages 주소를 등록합니다.

Render를 사용하지 않으려면 Cloudflare Workers, AWS Lambda/API Gateway, Vercel Functions, Netlify Functions 같은 서버리스 HTTPS 실행환경 중 하나를 선택해야 합니다. 이들 중 어느 것도 GitHub Pages Settings > Pages 링크만으로 제공되지는 않습니다.

## GitHub 서비스만으로 가능한 축소형 대안

GitHub Actions가 DART 데이터를 주기적으로 수집해 JSON 파일을 생성하고, 그 JSON을 GitHub Pages에 정적 배포하는 방식은 가능합니다. 다만 이 방식은 다음 제약이 있습니다.

- 사용자 입력 직후 임의 기업을 실시간 조회할 수 없습니다.
- 조회 대상 기업을 Actions 변수 또는 저장소 파일에 미리 지정해야 합니다.
- 과거 기간·비상장사·주석·본문 딥링크를 모두 미리 수집해야 합니다.
- 신규 공시는 Actions 실행 후 정적 파일이 다시 배포된 뒤에만 보입니다.
- 브라우저가 닫혀 있으면 팝업 알람을 띄울 수 없습니다.
- 인증키는 Actions Secret에 둘 수 있지만, 그 키로 동작하는 상시 API가 생기는 것은 아닙니다.

따라서 이 대안은 `미리 수집한 기업의 정적 대시보드`에는 적합하지만, 현재 앱의 실시간 DART 탐색기 전체를 대체하지는 못합니다.

## 이번 소스에서 수정한 사항

DART 기업목록에 있고 `stock_code`가 비어 있는 비상장사도 `corp_code`로 조회할 수 있도록 홈 초기 로딩에서 상장코드 필터를 제거했습니다. 정기 재무보고서가 존재하면 비상장사도 DART 수치를 표시하고, 외부 시세·네이버금융 교차검증만 비교 불가 상태로 남겨야 합니다.

이 수정만으로 GitHub Pages가 DART API 서버가 되는 것은 아닙니다. 실시간 기능을 사용하려면 위의 API 서버 주소를 `VITE_API_BASE_URL`에 연결해야 합니다.
