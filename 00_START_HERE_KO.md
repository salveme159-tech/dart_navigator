# DART Navigator | ChatGPT 에이전트 최종 적용·테스트 안내

이 패키지는 **웹앱 소스코드 + ChatGPT GPT Action 설정 파일 + API 점검 스크립트**를 함께 제공합니다. 아직 외부 서버 배포와 ChatGPT 계정 내 GPT 생성은 완료된 상태가 아닙니다. 다음 순서대로 진행해야 실전 테스트가 가능합니다.

## 1. 패키지 구성

- `../DART-Navigator/` : 웹앱, DART 조회 엔진, REST API, Docker/Render 배포 설정
- `01_GPT_PROFILE_KO.txt` : GPT 이름·설명·대화 시작 문구
- `02_GPT_INSTRUCTIONS_KO.txt` : GPT 편집기의 Instructions에 넣을 지침
- `03_GPT_ACTION_OPENAPI.yaml` : Actions에 등록할 OpenAPI 스키마
- `04_TEST_CASES_KO.md` : 공모전 시연/정확성 검증 질문
- `05_TEST_API.ps1` : Windows PowerShell로 배포 API를 직접 테스트하는 스크립트
- `06_SUBMISSION_CHECKLIST_KO.md` : 제출 전 체크리스트

## 2. 먼저 서버를 배포해야 합니다

ChatGPT Action은 사용자의 `localhost`를 호출할 수 없으므로 공개 HTTPS 주소가 필요합니다.

1. ZIP을 새 폴더에 압축 해제합니다.
2. `DART-Navigator` 폴더의 파일을 본인의 GitHub 저장소에 올립니다. `.env` 파일과 실제 키는 올리지 않습니다.
3. Render에서 새 Blueprint 서비스를 만들고 해당 저장소를 연결합니다. 루트에 있는 `render.yaml`을 사용합니다.
4. Render 환경 변수에 다음 값을 설정합니다.
   - `OPENDART_API_KEY`: OpenDART에서 발급한 실제 40자리 인증키
   - `AGENT_API_KEY`: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 명령으로 생성한 무작위 비밀키
5. 배포 완료 후 서비스 주소를 메모합니다. 예: `https://내-서비스.onrender.com`
6. 아래 URL을 확인합니다.
   - `https://내-서비스.onrender.com/api/health` → `status: ok`
   - `https://내-서비스.onrender.com/api/agent/health` → `status: ready`, 두 `...Configured` 값이 `true`

`AGENT_API_KEY`와 `OPENDART_API_KEY`는 반드시 서로 다른 값이어야 합니다. 비밀키를 GPT 지침, OpenAPI 파일, 소스코드, 공모전 화면 캡처에 노출하지 마세요.

## 3. API가 먼저 동작하는지 테스트합니다

Windows PowerShell에서 다음을 실행합니다.

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\GPT_AGENT_SETUP\05_TEST_API.ps1 -BaseUrl "https://내-서비스.onrender.com" -Question "대한전선 2026년 상반기 연결 기준 영업이익률과 산식을 알려줘"
```

스크립트가 `AGENT_API_KEY` 입력을 요청합니다. 키를 입력하면 health 검사 후 실제 DART 질문을 보냅니다. 정상 응답에서 `found`, 회사명, 기간, 연결/별도 기준, headline, 산식·lines, citation을 확인합니다. `found: false`면 값을 만들어 채우지 말고 반환 사유를 먼저 해결합니다.

## 4. GPT 편집기에 적용합니다

GPT 생성 권한이 있는 계정/워크스페이스에서 아래 순서로 설정합니다.

1. `https://chatgpt.com/gpts`에 들어가 새 GPT를 엽니다.
2. `01_GPT_PROFILE_KO.txt`의 이름, 설명, 대화 시작 문구를 입력합니다.
3. `02_GPT_INSTRUCTIONS_KO.txt` 전체를 Instructions에 붙여 넣습니다.
4. Actions에서 새 Action을 만들고 `03_GPT_ACTION_OPENAPI.yaml` 내용을 붙여 넣습니다.
5. YAML의 `servers[0].url`을 실제 배포 주소로 교체합니다. 예를 들어 `https://내-서비스.onrender.com`처럼 도메인만 입력하고 `/api/agent/query`를 URL 끝에 넣지 않습니다.
6. Authentication은 `API Key` → `Bearer`로 선택하고, 값에 서버의 `AGENT_API_KEY`를 입력합니다. OpenDART 키를 입력하면 안 됩니다.
7. `queryDisclosureNavigator`를 테스트합니다. 그 다음 `04_TEST_CASES_KO.md`의 질문들을 GPT Preview에서 테스트합니다.
8. 공개 공유/게시를 할 경우 개인정보 처리방침 URL을 요구할 수 있습니다. 서비스의 `/privacy-policy.html` 페이지에서 운영자 연락처·실제 로그 보관정책 등을 먼저 완성하세요.

### 계정 권한 참고

OpenAI의 최신 도움말에 따르면 개인용 ChatGPT Free/Go/Plus/Pro 계정은 새 GPT 생성·게시를 지원하지 않습니다. Business/Enterprise/Edu 워크스페이스도 관리자 설정과 사용자 권한이 허용되어야 합니다. 편집기에 `만들기/Create`가 없으면 파일 문제가 아니라 계정/워크스페이스 권한 문제일 수 있습니다. 이 경우 권한이 있는 워크스페이스에서 설정하거나, 아래 PowerShell/API 테스트를 먼저 사용하세요.

공식 안내: https://help.openai.com/ko-kr/articles/8554397-creating-and-editing-gpts
Action 설정 안내: https://help.openai.com/ko-kr/articles/9442513-configuring-actions-in-gpts

## 5. 완료 기준

공모전에서 “ChatGPT 에이전트 구현 완료”라고 설명하기 전에 다음을 확인하세요.

- [ ] 서버가 HTTPS로 배포되어 있음
- [ ] `/api/agent/health`가 `ready`를 반환함
- [ ] PowerShell API 질문 테스트에서 실제 OpenDART 응답이 반환됨
- [ ] GPT Actions에 OpenAPI 스키마가 등록되고 인증 테스트가 성공함
- [ ] GPT Preview에서 테스트 케이스가 통과함
- [ ] 각 숫자의 기준기간, 연결/별도, 산식, DART 원문을 대조함
- [ ] 개인정보 처리방침과 공유 권한을 검토함

**이 패키지는 적용 가능한 구현 결과물입니다. 외부 서비스 배포, 계정 안의 GPT 생성/게시, 실제 인증키로 한 실시간 DART 검증은 사용자 계정·키가 필요한 외부 단계이므로 여기서 완료했다고 주장하지 않습니다.**
