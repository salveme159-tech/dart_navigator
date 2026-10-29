# DART Navigator 연동 작업

## Manus API 서버

- [ ] Manus 서버에서 `pnpm build`와 `pnpm start`로 Express/tRPC API가 실행된다.
- [ ] `/api/health`가 2xx를 반환한다.
- [ ] OpenDART 인증키가 정적 프런트엔드 번들에 포함되지 않는다.
- [ ] GitHub Pages origin이 CORS 허용 목록에 등록된다.

## DART 재무 데이터

- [ ] 상장·비상장 기업을 모두 `corp_code`로 검색·조회한다.
- [ ] 같은 보고서·기간·연결/별도 기준의 원천 계정으로 지표를 계산한다.
- [ ] 재무상태표 또는 같은 접수번호의 주석에만 있는 유동·비유동 리스부채를 중복 없이 차입성 부채에 포함한다.
- [ ] DART 본문 위치 확인 실패 시 공시 첫 화면으로 자동 이동하지 않는다.

## GitHub Pages

- [ ] `VITE_API_BASE_URL`이 Manus 서버 HTTPS 주소로 주입된다.
- [ ] Pages 정적 빌드가 `dist/public/index.html`을 생성한다.
- [ ] 배포 후 키 검증·기업 검색·재무 조회·공시 확인이 Manus API를 통해 동작한다.
