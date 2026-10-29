# 처음 적용하는 순서 (2026-10-29)

## 두 ZIP의 용도

- DART-Navigator-Webapp-Persistent-20261029.zip: 웹앱과 API 서버 전체 소스입니다. GitHub dart_navigator 저장소에 이 ZIP의 **내용물**을 기존과 같은 경로로 덮어씁니다. ZIP명 폴더를 통째로 올리지 마세요. 이번 변경 때문에 기존 파일을 먼저 삭제할 필요는 없습니다. .github 폴더도 포함되어 있습니다.
- DART-Agent-Persistent-20261029.zip: GPT 편집기에 넣는 지침과 Action 스키마, 적용 안내입니다. 이 ZIP 자체를 GitHub 소스로 올릴 필요는 없습니다.

## 1. 웹앱 전체 파일 적용

웹앱 ZIP을 풀고 package.json이 보이는 위치의 파일·폴더를 GitHub 저장소의 같은 경로에 반영한 뒤 커밋합니다. Home.tsx만 바꾸는 작업이 아닙니다. 서버 코드와 새 userAgent.ts를 함께 적용해야 합니다. .env 파일이나 비밀값은 GitHub에 업로드하지 마세요. GitHub·Render에 이미 등록한 다른 환경변수는 유지하세요.

이번 코드 변경: server/_core/index.ts(Agent 경로 연결), server/_core/userAgent.ts(만료 없는 암호화 연결), scripts/test-agent-user-key.mjs(검증). .env.example/env.example/render.yaml와 에이전트 설정 안내도 새 방식으로 갱신했습니다. 기존 client 전체·재무 계산·공시 조회·알람 코드·패키지와 잠금파일은 유지했습니다. 기사 팩트 체크는 제외된 상태입니다.

## 2. Render에 암호화용 비밀값을 처음 한 번 설정

Render → 해당 서비스 → Environment → Add Environment Variable:

- Key: AGENT_CONNECTION_SECRET
- Value: 무작위 영문·숫자 64자리 권장(최소 32자).

동봉된 01_GENERATE_SERVER_SECRET.ps1의 명령을 본인 PC의 PowerShell에서 실행하면 무작위 값이 나옵니다. 비밀번호 관리자의 무작위 생성 기능을 사용해도 됩니다. 1만 반복하거나 예시 문구를 값으로 넣지 마세요.

이 값은 사용자에게 요구하는 AGENT_API_KEY가 아닙니다. 서버가 연결코드를 암호화하고 나중에 읽기 위해 필요한 관리자용 비밀값입니다. **재배포할 때도 같은 값을 유지**하세요. GitHub·GPT 지침·스키마·사용자 대화에는 넣지 않습니다. 서버에 고정된 암호화 비밀값 없이 무료 Render의 메모리만 사용하면 재시작 후 코드를 유지할 수 없어서 추가한 설정입니다. DB·유료 디스크는 필요하지 않습니다.

Save and deploy 후 최신 GitHub 커밋이 배포됐는지 확인합니다. 필요하면 Manual Deploy → Deploy latest commit을 사용합니다. 기존 AGENT_API_KEY는 이 에이전트에서 더 이상 읽지 않습니다. 운영자의 OPENDART_API_KEY도 이 에이전트에는 필요 없습니다. 다른 용도로 쓰는 환경변수는 삭제하지 마세요.

새 Render 서비스를 Blueprint로 만들면 render.yaml의 generateValue 설정으로 비밀값이 자동 생성됩니다. 기존 서비스에 ZIP만 올리는 경우에는 위 환경변수를 직접 추가해야 합니다.

## 3. GPT 설정 교체

GPT_SETUP/01_GPT_PROFILE_KO.txt → 이름·설명·대화 시작 문구
GPT_SETUP/02_GPT_INSTRUCTIONS_KO.txt → 지침 전체 교체
GPT_SETUP/03_GPT_ACTION_OPENAPI.yaml → 기존 Action 스키마 전체 교체
Authentication → None(인증 없음). 예전 API Key/Bearer 설정은 제거합니다.

설정 파일에는 실제 인증키나 연결코드를 넣지 않습니다. 서버 주소가 달라지면 스키마 servers.url과 지침의 연결창 링크를 함께 변경하세요. 현재 주소는 https://dart-navigator-v69n.onrender.com 입니다.

## 4. 사용자 이용

1. https://dart-navigator-v69n.onrender.com/agent-connect 접속.
2. 본인의 40자리 DART 키 입력.
3. dn1.로 시작하는 연결코드 전체를 복사해 비밀번호 관리자 등에 보관.
4. 본인의 GPT 대화에 코드를 붙여 넣고 질문.

**시간 만료와 정기 재발급은 없습니다.** 같은 서버 비밀값을 유지하면 재시작·재배포·절전 후에도 같은 코드가 동작합니다. 새 GPT 대화에서는 보관한 같은 코드를 다시 붙여 넣습니다. GPT가 모든 대화에서 자동 로그인 상태를 기억하도록 만든 것은 아닙니다. 대화가 길어져 코드가 문맥에서 빠진 경우에도 같은 코드를 다시 제공하면 됩니다.

과거 1시간 코드(64자리)는 최초 한 번 새 코드로 전환해야 합니다. 이후 정기 재발급은 없습니다. DART 키를 폐기·변경하거나 서버 암호화 비밀값을 바꾸면 기존 코드가 유효하지 않게 됩니다. 코드를 잃어버리면 다시 만들 수 있습니다. 같은 DART 키로 여러 번 만들면 이전 코드도 계속 유효합니다.

## 처리 및 보관

코드에는 사용자 DART 키가 AES-256-GCM으로 암호화되어 들어 있습니다. 서버 DB·디스크·세션 Map에 원본 키를 보관하지 않습니다. 발급과 조회 요청을 처리하는 동안은 서버 메모리에서 원본 키를 처리하며, 기존 조회 엔진의 메모리 캐시는 변경하지 않았습니다. 원본 키가 영구 저장되거나 모든 메모리에서 즉시 지워진다고 보장하지 않습니다.

이 코드도 원본 키를 대신하는 비밀값입니다. 다른 사람에게 공개하거나 공용 지침에 넣지 마세요. GPT 대화와 Action 요청에는 연결코드가 전달됩니다. 서버 비밀값과 코드가 함께 노출되면 원본 키도 복호화될 수 있습니다. 완전히 폐기하려면 사용자가 OpenDART에서 원본 키를 폐기·변경해야 합니다. 대화에서 연결 해제나 코드 삭제만으로는 폐기되지 않습니다. 서버 비밀값 변경은 모든 사용자의 기존 코드를 무효화합니다.

사용자는 화면을 닫아도 코드가 폐기되지 않습니다. 연결창은 브라우저 저장소나 URL에 원본 키·코드를 저장하지 않습니다. 사용자가 본인 코드를 별도로 보관합니다. 발급은 IP별 분당20회, 조회는 IP별 분당60회로 제한합니다. 프록시 뒤에서는 여러 사용자가 같은 IP로 계산될 수 있고, 여러 인스턴스의 요청 제한은 인스턴스별입니다. 이는 DART 자체 호출 한도를 늘리지 않습니다.

## 배포 확인

https://dart-navigator-v69n.onrender.com/api/agent/health

status=ready / mode=user_dart_key_persistent / connectionExpires=false 확인. 503이면 환경변수 설정과 새 배포를 확인합니다. /api/health는 일반 서버 생존 확인이며 GPT 설정 검증과 다릅니다.

GitHub Pages만 배포해서는 API 서버가 갱신되지 않습니다. GitHub Pages를 계속 사용하는 경우 기존 VITE_API_BASE_URL, CORS_ALLOWED_ORIGINS를 유지합니다. Render 주소로 웹앱을 쓰면 같은 서버에서 화면과 API를 제공합니다.

Render 무료 서버의 절전·초기 대기 시간은 유지됩니다. 연결코드는 없어지지 않지만, 서버가 깨어나는 동안 대기하거나 첫 GPT 요청이 시간 초과될 수 있습니다. 서버 접속 후 다시 질의하세요. 이 변경으로 콜드 스타트까지 없어진 것은 아닙니다.

## 검증

로컬 자동 테스트 19개 통과(새 연결 방식14개 + 기존 공시 폴링5개). 시간 경과, 다른 서버 인스턴스에 같은 코드 사용, 사용자 키 분리, 변조 거부, 잘못된 입력과 요청 제한을 확인했습니다. 소스127개의 구문과 로컬 import468개 검사에서 오류가 없었습니다.

전체 프로덕션 빌드는 의존성 다운로드 제한으로 완료하지 못했습니다. 실제 Render 배포·DART 인증키 통신·GPT Preview·실공시 숫자 정확도는 미검증입니다. 로컬 테스트에서 DART 질의 함수는 고정 응답을 주입했습니다. 현재 서버에 자동 배포를 실행한 것은 아닙니다.

공식 참고: https://developers.openai.com/api/docs/actions/authentication
https://developers.openai.com/api/docs/actions/production
