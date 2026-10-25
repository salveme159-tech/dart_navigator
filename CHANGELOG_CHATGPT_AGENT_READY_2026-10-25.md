# ChatGPT Agent 준비 작업 변경 내역 — 2026-10-25

## 현재 상태를 명확히 분리
- 기존 프로젝트는 DART 분석 웹앱과 ChatGPT Action용 서버 엔드포인트/설정 초안을 포함했지만, ChatGPT 계정 안의 GPT 생성과 외부 서버 배포까지 완료된 것은 아니었습니다.
- README에 준비된 코드와 실제 GPT 생성/배포 완료의 차이를 명시했습니다.

## 변경 사항
- `GET /api/agent/health` 추가: `AGENT_API_KEY`와 `OPENDART_API_KEY` 설정 여부만 확인합니다. 비밀값을 응답하지 않습니다.
- `render.yaml`에 별도 `AGENT_API_KEY` secret 설정 항목을 추가했습니다.
- `.env.example`과 `env.example`에 Agent API secret 항목을 추가했습니다.
- `CHATGPT_AGENT_SETUP_KO.md` 추가: 배포, 키 생성, API 시험, GPT Action 등록, 검증 질문 및 완료 기준을 안내합니다.
- `CHATGPT_AGENT_PROFILE.md` 추가: 이름·설명·대화 시작 문구·Action 연결 정보를 제공합니다.
- `client/public/privacy-policy.html` 추가: 공개 공유 시 배포 주소로 노출할 개인정보 처리 안내 초안입니다. 실제 운영 연락처/보관 정책은 게시 전에 운영자가 완성해야 합니다.
- Agent 시스템 지침에 Action 호출·응답 검증·누락 기간 처리 순서를 명시했습니다.

## 검증
- `CHATGPT_AGENT_OPENAPI.yaml`과 `render.yaml`을 YAML parser로 읽고 OpenAPI의 `/api/agent/query` 및 `queryDisclosureNavigator` 정의를 확인했습니다.
- TypeScript 전체 검사는 실행 환경에 `@types/node`와 `vite/client` 타입 패키지가 없어 시작 단계에서 중단됐습니다.
- 실제 서버 배포, 유효한 OpenDART 키를 통한 요청, ChatGPT GPT 편집기 내 Action 테스트는 아직 수행하지 않았습니다.

## 미완료된 외부 단계
실제 ChatGPT 안에서 동작하는 Agent가 되려면 HTTPS 서버 배포, 서버 환경변수 설정, GPT 편집기에서 OpenAPI Action 등록 및 Bearer 인증, Preview 시험이 필요합니다. ChatGPT 계정에 GPT 생성 권한이 없는 경우 권한이 허용된 Business/Enterprise/Edu 워크스페이스가 필요할 수 있습니다.
