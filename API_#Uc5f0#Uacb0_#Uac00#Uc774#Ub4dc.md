# DART Navigator API 연결 가이드

## 보안 원칙
- 발급키는 프로젝트 루트의 `.env`에만 저장합니다. 브라우저 코드, `VITE_*`, GitHub 저장소, 스크린샷에 넣지 않습니다.
- 이미 채팅·공개 저장소에 노출된 키는 제공처에서 재발급/폐기하는 것이 안전합니다.
- `.env` 수정 후 `pnpm dev`를 중지하고 다시 실행해야 합니다.

## 환경변수
`.env.example`을 참고해 프로젝트 루트의 `.env`에 다음 항목을 설정합니다.

```dotenv
OPENDART_API_KEY=기존_OpenDART_인증키
ECOS_API_KEY=보유한_ECOS_인증키
EXIM_EXCHANGE_API_KEY=한국수출입은행_환율_API_인증키
```

실제 키를 이 문서나 코드에 복사하지 마세요. `OPENDART_API_KEY`는 기존 앱이 이미 지원하는 환경변수입니다. `ECOS_API_KEY`, `EXIM_EXCHANGE_API_KEY`는 이번 연결에서 서버 전용으로 추가한 변수입니다.

## OpenDART
- 인증키 신청/관리: https://opendart.fss.or.kr/
- 공식 개발가이드: https://opendart.fss.or.kr/guide/main.do
- 별도의 세부 API 인증키는 필요하지 않습니다. 같은 OpenDART 키를 각 엔드포인트의 `crtfc_key`로 사용합니다.
- 구현 대상: `corpCode.xml`(회사 고유번호), `list.json`(공시 검색), `fnlttSinglAcntAll.json`(전체 재무제표), `document.xml`(공시 원문).
- 이번 코드에서는 기존 DART 클라이언트를 유지하고 API 키가 필요한 곳을 기존 `OPENDART_API_KEY` 설정과 연결합니다. 투자계획 공시의 계획/정정/실제 CAPEX 자동 매칭은 별도 분석 로직이 필요하며 단순 API 키 설정만으로 완성되지 않습니다.

## ECOS
- API 안내: https://ecos.bok.or.kr/api/
- 통계 검색: https://ecos.bok.or.kr/
- 보유한 ECOS 키를 `ECOS_API_KEY`로 저장합니다.
- 고급 분석 화면에서 통계표 코드, 항목 코드, 주기, 기간을 입력해 조회합니다. 잘못된 통계 코드로 금리·환율 수치를 단정하지 않도록 코드 선택을 사용자에게 명시적으로 요구합니다.

## 환율
- 공공데이터포털: https://www.data.go.kr/
- 이번 구현은 한국수출입은행 환율 API 형식(`exchangeJSON`)을 대상으로 합니다. 제공받은 키가 다른 환율 서비스의 키라면 이 엔드포인트에 사용할 수 없으므로 해당 제공처의 API 명세에 맞춰 어댑터를 바꿔야 합니다.
- 서버 라우트: `/api/market/exchange`. 현재 날짜 기준 조회 결과를 연결 시험에 표시합니다.

## 구리 가격
- 출처: https://www.nonferrous.or.kr/stats/?act=sub3
- 별도 API 키가 없는 공개 페이지를 서버에서 읽고 정적 HTML 표를 추출하도록 했습니다.
- 서버 라우트: `/api/market/copper`. 15분 캐시를 사용합니다.
- 사이트가 JavaScript로 표를 렌더링하거나 접근을 제한하면 정적 HTML 파서가 데이터를 찾지 못할 수 있습니다. 이 경우 실제 페이지 구조에 맞춰 수집 방식을 조정해야 합니다. 표를 읽지 못했을 때 가격을 임의 생성하지 않습니다.
- 자동 수집 전 사이트 이용약관/robots 정책과 재배포 조건을 확인하고, 과도한 요청을 보내지 않습니다.

## 점검 엔드포인트
- `GET /api/market/status`: 키 원문을 반환하지 않고 환경변수 설정 여부만 반환합니다.
- `GET /api/market/ecos?statCode=...&itemCode=...&cycle=M&start=202501&end=202610`
- `GET /api/market/exchange`
- `GET /api/market/copper`

상태 화면의 “설정됨”은 환경변수 값이 있다는 뜻이며 인증 성공을 보장하지 않습니다. 각 연결 시험의 실제 응답을 확인해야 합니다.
