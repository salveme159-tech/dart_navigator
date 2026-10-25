# 재무 수치 정확도 점검 검증 보고서

작성일: 2026-10-21
대상: `dart-navigator-crossvalidated-20261021.zip`

## 결과 요약

| 검사 | 결과 | 의미 |
|---|---|---|
| 정확도 점검 엔진·DART 계산 엔진의 분리 타입 검사 | 통과 | `server/dart/engine.ts`, `server/dart/crossValidation.ts` 대상 `tsc --noEmit` |
| 수정한 7개 TS/TSX 파일의 구문 전환 검사 | 통과 | TypeScript `transpileModule`에서 구문 오류 없음. 전체 프로젝트 타입검사는 아님 |
| 네이버 Financial Highlight 모의 HTML 파싱 | 통과 | 여러 지표 행 및 `2025/12` 기간 파싱 |
| FnGuide 모의 응답 파싱 | 통과 | 원화 금액의 억원 변환, EPS 원 단위 유지, 비-KRW 값 제외 |
| Yahoo 하나의 응답 객체에 여러 시계열이 함께 있는 경우 | 통과 | 매출·영업이익·순이익을 모두 파싱 |
| DART와 외부값이 일치해 보이나 Yahoo 연결/별도 기준이 불명확한 경우 | 통과 | `MATCH`가 아니라 `PARTIAL`/`NOT_COMPARABLE`로 제한 |
| DART와 외부값 불일치 | 통과 | `MISMATCH` 상태를 주고 DART 값을 덮어쓰지 않음 |
| DART 본문 수치가 없고 외부값만 있는 경우 | 통과 | 외부 참고값은 표시하되 `MATCH`로 표시하지 않음 |
| 차입금 계정 범위 불명확 | 통과 | 자동 일치 판정을 거부함 |
| 연간 값에 12월 단독 분기값 사용 방지 | 통과 | 분기값을 연간값으로 대체하지 않음 |
| 반기 누계 영업이익률 | 통과 | 누계 이익÷누계 매출로 재계산 |
| 실제 네이버/Yahoo 실시간 응답 | 미실행 | 작업 환경의 네트워크 제한으로 실제 웹사이트 값 조회 불가 |
| 전체 Vitest | 미실행 | 프로젝트 의존성이 설치되지 않았고 설치 시 네트워크 연결 실패 |
| 전체 `pnpm check` 및 프로덕션 빌드 | 미실행 | 의존성 부재로 전체 앱 단위 검증을 완료하지 못함 |
| 전체 회사·기간·지표의 실제 값 일치 확인 | 미완료 | 모의 테스트만으로 실데이터 정확성을 주장할 수 없음 |

## 실행한 검사

1. 정확도 점검 엔진과 계산 엔진에 대해 다음 명령을 실행해 타입 오류가 없는 것을 확인했습니다.

```bash
tsc --noEmit --pretty false --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM --types node --typeRoots /opt/nvm/versions/node/v22.16.0/lib/node_modules/ts-node/node_modules/@types --skipLibCheck server/dart/engine.ts server/dart/crossValidation.ts
```

2. 변경한 7개 TS/TSX 파일에 대해 TypeScript 구문 변환 검사를 실행했습니다.
3. 네이버/Yahoo의 응답 형식을 흉내 낸 로컬 모의 응답으로 9개 정확도 점검 시나리오를 실행했고 모두 통과했습니다.
4. `pnpm install --offline --frozen-lockfile`은 패키지 레지스트리 접근 오류(`EAI_AGAIN`)로 완료되지 않았습니다. 따라서 전체 Vitest, 전체 앱 타입 검사, 프로덕션 빌드 결과를 보고하지 않습니다.

## 정확도 해석

- `MATCH`는 해당 출처의 기준을 요청한 CFS/OFS 기준과 비교할 수 있고, 지표 정의·기간·단위가 대응된 값이 허용오차 안에 들어간 경우에만 허용합니다.
- `MISMATCH`는 비교 가능한 출처 값이 허용오차를 벗어난 경우입니다. 불일치는 숨기지 않습니다.
- `PARTIAL`은 일부 출처만 비교 가능하거나, 독립적인 기준 확인이 충분하지 않은 경우입니다.
- `NOT_COMPARABLE`는 데이터가 있더라도 기간·기준·계정 정의가 달라 안전하게 대조할 수 없는 경우입니다.
- `UNAVAILABLE`는 출처에 자료가 없거나 조회에 실패한 경우입니다.

**중요:** 이 보고서는 코드와 모의 입력의 검증 보고서입니다. 실제 운영 환경에서 DART·네이버 금융·FnGuide의 실시간 수치가 모든 회사와 기간에 대해 이미 일치함을 의미하지 않습니다. 배포 환경에서 실제 요청이 성공하는지와 회사별 실데이터 비교 결과를 별도로 확인해야 합니다.
