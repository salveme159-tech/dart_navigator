# TypeScript 검사 오류 수정 기록 (2026-10-17)

## 수정한 항목

1. `server/dart/client.ts`에서 `debtRatio`와 `currentRatio`를 처리하는 중복 분기를 제거했습니다. 앞쪽 분기에서 이미 두 지표를 완전히 계산하고 반환하므로, 뒤쪽의 동일 조건은 도달할 수 없으며 TypeScript TS2367 오류를 발생시켰습니다.
2. 같은 파일의 공통 계정 처리부에서 `metric === "capex" ? Math.abs(value) : value`를 `value`로 변경했습니다. `capex`는 앞쪽에서 별도로 처리하고 반환하므로 공통 처리부의 `capex` 조건은 타입 범위상 도달 불가능했고, TS2367 오류를 발생시켰습니다.

## 검증 상태

- 제공된 사용자 로그 기준 수정 전 `pnpm test`: 51개 테스트 통과.
- 제공된 사용자 로그 기준 수정 전 `pnpm dev`: 서버가 포트 3000에서 기동.
- 수정 후 `server/dart/client.ts`는 TypeScript `transpileModule` 구문 변환 검사를 통과했습니다.
- 이 환경에 `pnpm` 실행 파일과 프로젝트 의존성 `node_modules`가 없고, npm 레지스트리 접속도 실패해 수정 후 `pnpm check` 및 `pnpm test`를 직접 재실행하지 못했습니다. 따라서 전체 타입 검사가 통과했다고 주장하지 않습니다.

## 사용자 측 재검증

프로젝트 루트에서 아래 명령을 실행하세요.

```bat
pnpm check
pnpm test
pnpm dev
```

`pnpm check`가 더 이상 오류를 내지 않는지 확인하고, 다른 오류가 나오면 전체 출력을 공유하면 됩니다.
