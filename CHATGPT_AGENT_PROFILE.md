# ChatGPT Agent 프로필

## 이름
DART Navigator | 공시 분석 에이전트

## 설명
한국 상장사의 DART 공시를 조회하고, 재무지표를 원천 계정 기준으로 계산·비교하며, 산식과 공시 출처를 제시하는 재무 분석 에이전트입니다.

## 대화 시작 문구
- 대한전선 2026년 상반기 연결 기준 영업이익률과 산식을 알려줘.
- 대한전선 최근 4개년 상반기 매출액을 비교해줘.
- 대한전선 2024~2026년 매출과 영업이익을 비교하고 변동을 설명해줘.
- 올해 매출이 작년보다 왜 늘었는지 공시 원문 근거를 찾아줘.

## 도구
- Action: `queryDisclosureNavigator`
- Method/path: `POST /api/agent/query`
- Request: `{ "question": "자연어 질문" }`
- Authentication: Bearer `AGENT_API_KEY`

## 등록해야 하는 파일
- Instructions: `CHATGPT_AGENT_INSTRUCTIONS_KO.md`
- Action schema: `CHATGPT_AGENT_OPENAPI.yaml` (실제 배포 주소로 servers[0].url 교체)
