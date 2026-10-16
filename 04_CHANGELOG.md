# Changelog — 코드 확인과 기존 변경 주장 구분

## 이번 문서 정비
- 6개 문서의 역할과 명칭을 분리하고 README 인덱스를 추가했습니다.
- 요구사항(Master Spec)과 구현/테스트 증거(Validation Report)를 분리했습니다.
- 실제 API 경로, 핵심 파일, 명령어를 소스에서 추출했습니다.

## 코드 판독으로 확인 가능한 구현 요소
- 서버 tRPC 라우터에 `ask`, `calculateMetric`, `evidence`, `refresh`가 선언되어 있습니다.
- `engine.ts`에 기간 필드 선택, 순차입금 정책, 지표 레지스트리 및 질의 파서가 있습니다.
- `xlsxExport.ts`에 Excel 내보내기 로직이 있습니다.
- 키 전달 관련 `x-opendart-key` 경로가 있습니다.

## 기존 UPGRADE_CHANGELOG의 주장
원본 `UPGRADE_CHANGELOG.md`를 보존합니다. 이 문서에 기재된 항목은 자동으로 전체 통합 테스트 통과를 의미하지 않습니다. 실제 기능별 검증은 `05_VALIDATION_REPORT.md`에 기록해야 합니다.
