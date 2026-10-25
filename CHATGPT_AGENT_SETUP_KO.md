# DART Navigator — ChatGPT Agent 구성·배포 가이드

## 먼저 확인할 점

현재 소스 저장소에는 DART 재무 조회 엔진, ChatGPT Action용 REST API(`/api/agent/query`), OpenAPI 명세, GPT 지침 초안이 들어 있습니다. **하지만 이것만으로 ChatGPT 안에 GPT가 생성된 것은 아닙니다.** 공개 HTTPS 서버 배포, 서버 비밀키 설정, GPT 편집기에서 Action 연결 및 테스트가 끝나야 ChatGPT에서 사용하는 Agent가 됩니다.

또한 OpenAI 도움말의 2026년 10월 현재 안내에 따르면 개인용 ChatGPT 계정(Free/Go/Plus/Pro)에서는 새 GPT를 만들거나 게시할 수 없으며, 권한이 허용된 Business/Enterprise/Edu 워크스페이스에서 생성해야 합니다. 계정/워크스페이스 기능은 공식 안내를 확인하세요: https://help.openai.com/en/articles/8554397-creating-and-editing-gpts

## 1. 서버 배포

가장 쉬운 구성은 Render에서 GitHub 저장소를 연결하고 프로젝트의 `render.yaml`을 Blueprint로 배포하는 것입니다. 이 프로젝트의 `Dockerfile`은 웹앱과 서버 API를 한 주소에서 제공합니다.

Render 서비스의 Environment에 다음 두 비밀값을 설정합니다.

| 변수 | 값 | 용도 |
|---|---|---|
| `OPENDART_API_KEY` | OpenDART에서 발급한 영문·숫자 40자리 실제 인증키 | DART 원천 조회용. GPT에게 노출하지 않음 |
| `AGENT_API_KEY` | 아래 명령으로 만든 무작위 64자리 16진수 | ChatGPT Action 인증용. DART 키와 반드시 별도 |

Windows CMD에서 Action 비밀키를 생성하려면 프로젝트와 관계없이 다음을 실행합니다.

```cmd
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

출력된 값을 `AGENT_API_KEY`에 넣습니다. 이 키를 공개 채팅, 코드 저장소, OpenAPI 파일에 적지 마세요. `.env.example`은 예시일 뿐 실제 키를 저장하지 않습니다.

배포 후 아래 주소를 브라우저에서 엽니다.

```text
https://실제-배포-도메인/api/health
https://실제-배포-도메인/api/agent/health
```

첫 번째 응답이 `{"status":"ok"}`이어야 하고, 두 번째 응답의 `status`가 `ready`, `agentKeyConfigured`와 `openDartKeyConfigured`가 모두 `true`여야 합니다. `configuration_required`라면 서버 환경변수를 수정하고 다시 배포합니다.

## 2. API를 먼저 시험

PowerShell을 열고 아래 예시에서 도메인과 `AGENT_API_KEY`를 실제 값으로 바꿔 실행합니다.

```powershell
$base = "https://실제-배포-도메인"
$agentKey = "실제_AGENT_API_KEY"
$body = @{ question = "대한전선 2026년 상반기 연결 기준 영업이익률" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/agent/query" -Headers @{ Authorization = "Bearer $agentKey" } -ContentType "application/json" -Body $body
```

정상이라면 `found`, `company`, `period`, `basis`, `headline`, `lines`, `formula`, `citation` 등이 포함된 JSON이 반환됩니다. `found: false`는 조회할 공시/계정이 없거나 지표를 지원하지 않는다는 의미일 수 있으므로, 수치를 임의로 채우지 않습니다.

## 3. GPT 편집기 구성 (생성 권한이 있는 워크스페이스에서)

1. ChatGPT의 GPT 편집기를 엽니다: https://chatgpt.com/gpts
2. 새 GPT를 만들고 아래 프로필을 입력합니다.
3. Configure/설정의 Instructions에 `CHATGPT_AGENT_INSTRUCTIONS_KO.md` 전체 내용을 붙여 넣습니다.
4. Actions에서 새 Action을 생성하고 `CHATGPT_AGENT_OPENAPI.yaml`의 내용을 가져옵니다.
5. YAML의 `servers[0].url`을 `https://실제-배포-도메인`으로 바꿉니다. `/api/agent/query` 경로는 그대로 둡니다.
6. Authentication을 **API Key → Bearer**로 설정하고, 키 값에는 서버의 `AGENT_API_KEY` 값만 넣습니다. `OPENDART_API_KEY`를 넣으면 안 됩니다.
7. Action 테스트에서 `queryDisclosureNavigator`를 실행하고 정상 JSON 응답을 확인합니다.
8. GPT Preview에서 아래 평가 질문을 테스트하고, 숫자·기간·연결/별도 기준·출처가 원천 응답과 일치하는지 검사합니다.

공개 공유/스토어 게시를 하는 GPT라면 유효한 개인정보 처리방침 URL이 필요할 수 있습니다. 같은 서버에 이 프로젝트의 `client/public/privacy-policy.html`을 배포한 뒤 `https://실제-배포-도메인/privacy-policy.html`을 사용하세요. 조직의 공유 정책도 확인해야 합니다.

## 4. GPT 프로필 (복사해 사용)

**이름**

`DART Navigator | 공시 분석 에이전트`

**설명**

`한국 상장사의 DART 공시를 조회하고, 재무지표를 원천 계정 기준으로 계산·비교하며, 산식과 공시 출처를 제시하는 재무 분석 에이전트입니다.`

**대화 시작 문구**

- `대한전선 2026년 상반기 연결 기준 영업이익률과 산식을 알려줘.`
- `대한전선 최근 4개년 상반기 매출액을 비교해줘.`
- `대한전선 2024~2026년 매출과 영업이익을 비교하고 변동을 설명해줘.`
- `올해 매출이 작년보다 왜 늘었는지 공시 원문 근거를 찾아줘.`

## 5. 공모전 시연용 검증 질문

| 질문 | 확인할 내용 |
|---|---|
| 대한전선 2026년 상반기 연결 기준 영업이익률 | 영업이익·매출액·계산식·공시 링크 |
| 대한전선 최근 4개년 상반기 매출액 | 각 연도 값, 기간 누락 여부, 연결 기준의 일관성 |
| 대한전선 2024~2026 매출과 영업이익 비교 | 표/시계열 값, 단위, 연도 범위 |
| 대한전선 2025년 하반기 매출액 | 연간 누계−상반기 누계, 접수번호 두 개 |
| 대한전선 2026년 상반기 차입금 의존도 | 차입금 구성·자산총계·산식 및 누락 계정 경고 |
| 회사명을 지정하지 않은 “최근 영업이익률” | 임의로 회사를 단정하지 않는지 |
| PER/PBR 계산 요청 | 지원 범위/주가 데이터 부재를 정직하게 알리는지 |
| 과거 데이터가 없는 기업의 10개년 요청 | 없는 연도를 만들지 않고 누락을 공개하는지 |

## 완료 기준

아래 항목이 모두 완료되어야 “ChatGPT 안에서 실제로 사용할 수 있는 Agent”라고 말할 수 있습니다.

- [ ] 공개 HTTPS 서버 배포
- [ ] `/api/agent/health`에서 `ready` 확인
- [ ] 인증된 `/api/agent/query` 요청 성공
- [ ] GPT 편집기에서 Action OpenAPI 등록 및 Bearer 인증 설정
- [ ] Preview에서 검증 질문 통과
- [ ] 원천 계정, 연결/별도 기준, 기간, 산식, DART 링크를 대조

**이 가이드와 소스코드는 구성 준비물입니다. GPT 생성/배포가 자동으로 끝났다는 뜻은 아닙니다.**
