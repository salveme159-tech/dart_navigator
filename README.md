# Disclosure Navigator

DART(OpenDART) 공시자료를 기반으로 회사별 재무지표를 조회하고, 기간·추이·비교 질문에 답하는 공모전용 웹앱입니다.

## 문서

- [프로젝트 명세](01_MASTER_SPEC.md)
- [사용자 가이드](02_USER_GUIDE.md)
- [개발자 가이드](03_DEVELOPER_GUIDE.md)
- [OpenDART API 안내](DART_API_USER_GUIDE.md)
- [자연어 엔진 수정·검증 보고서](NATURAL_LANGUAGE_REPAIR_REPORT.md)
- [ChatGPT Agent 시스템 지침 초안](CHATGPT_AGENT_INSTRUCTIONS_KO.md)
- [ChatGPT Agent Action OpenAPI 명세](CHATGPT_AGENT_OPENAPI.yaml)
- [ChatGPT Agent 구성·배포 가이드](CHATGPT_AGENT_SETUP_KO.md)
- [ChatGPT 이식 메모](CHATGPT_AGENT_MIGRATION.md)

## 로컬 개발 실행

필요 환경: Node.js 22 이상, pnpm 10.x, 인터넷 연결.

1. 프로젝트 폴더에서 `.env.example`을 복사해 `.env`를 만듭니다.
2. `.env`의 `OPENDART_API_KEY`에 본인의 OpenDART 인증키를 입력합니다. 키는 GitHub에 올리지 마세요.
3. 의존성을 설치하고 검사합니다.

```bash
pnpm install
pnpm check
pnpm test
pnpm dev
```

4. 브라우저에서 `http://localhost:3000`을 엽니다.

## 공개 배포 / ChatGPT Agent

> 현재 저장소는 웹앱 소스와 ChatGPT Action API 준비물을 포함합니다. ChatGPT 계정 안에 사용자 정의 GPT를 자동 생성하거나 서버를 대신 배포한 상태는 아닙니다. 실제 ChatGPT Agent로 사용하려면 API 서버 배포, 환경변수 설정, GPT Action 연결 및 테스트가 필요합니다. 자세한 순서는 [ChatGPT Agent 구성·배포 가이드](CHATGPT_AGENT_SETUP_KO.md)를 따르세요.

- **같은 서버에서 화면과 API를 함께 서비스**하면 기본 설정(`/api/trpc`)을 그대로 사용합니다.
- **GitHub Pages + 별도 API 서버** 구조라면 프런트엔드를 빌드할 때 `VITE_API_BASE_URL=https://실제-API-도메인`을 지정하고, API 서버 환경변수 `CORS_ALLOWED_ORIGINS`에는 `https://계정.github.io`처럼 실제 화면의 origin만 넣습니다. API 서버를 HTTPS로 배포하세요.
- ChatGPT GPT Action에는 `CHATGPT_AGENT_OPENAPI.yaml`을 사용합니다. `servers[0].url`을 실제 API 주소로 바꾸고, 서버에 `OPENDART_API_KEY`와 별도 무작위 `AGENT_API_KEY`를 설정한 뒤 Action 인증을 Bearer로 구성합니다. OpenDART 키를 GPT 지침이나 YAML에 직접 넣지 마세요.
- 배포 환경의 공개 tRPC DART 조회는 사용자 자신의 40자리 `X-OpenDART-Key`가 있어야 합니다. GPT Action은 서버의 OpenDART 키를 사용하는 인증된 `/api/agent/query`만 호출합니다.

> GitHub Pages는 정적 호스팅이므로 그 자체로는 서버 코드를 실행하지 않습니다. 화면만 배포한 상태에서는 실시간 자연어 조회가 동작하지 않으며, 서버 API 배포와 정확한 주소 설정이 모두 필요합니다.

## 정확성 정책 및 검증 주의사항

운영 경로에 재무 수치/접수번호 스냅샷을 두지 않습니다. 미확인 원천 계정, DART 조회 실패, 미지원 지표는 `자료 없음`으로 남깁니다. EBITDA 감가상각비를 CAPEX 비율로 추정하지 않고, 하반기는 동일 CFS/OFS 기준의 연간 누계에서 상반기 누계를 빼서 계산합니다. 사업보고서 원인 검색은 실제 문장과 접수번호를 제시하며, 직접 인과 문장이 없으면 원인을 단정하지 않습니다.

작업 환경에서 전체 타입검사·빌드와 실제 OpenDART 네트워크 검증은 실행하지 못했습니다. 최종 제출 전 반드시 위 명령을 실행하고 실제 인증키로 계정·기간·기준·접수번호를 DART 원문과 대조하세요. 상세한 검증 경계는 `NATURAL_LANGUAGE_REPAIR_REPORT.md`와 `VALIDATION_REPORT.md`를 확인하세요.
