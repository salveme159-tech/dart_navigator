# Developer Guide — 실제 소스 기준

## 1. 실행

필요: Node.js, pnpm 10.18.0. 프로젝트 루트에서:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm dev
```

`package.json`의 실제 스크립트: {
  "dev": "cross-env NODE_ENV=development tsx watch server/_core/index.ts",
  "check": "tsc --noEmit",
  "test": "vitest run",
  "build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist"
}

## 2. 주요 소스 경로

| 경로 | 코드상 역할 |
|---|---|
| `client/src/pages/Home.tsx` | 메인 화면과 체험/질의 UI |
| `client/src/lib/xlsxExport.ts` | Excel 파일 생성 |
| `server/routers.ts` | tRPC 라우터·입력 검증 |
| `server/dart/client.ts` | OpenDART 호출·질의 처리 |
| `server/dart/engine.ts` | 질의 파싱·지표·순차입금 계산 규칙 |
| `server/dart.test.ts` | 엔진 관련 테스트 |
| `AGENT_FORMULAS.json` | 별도 공식 데이터; 엔진과 자동 동기화된다는 보장 없음 |

## 3. 확인된 API 라우터

`server/routers.ts`에 선언된 publicProcedure: **ask, calculateMetric, validateKey, evidence, searchCompanies, snapshot, compare, refresh, metricLabels**. 실제 인증·전송 및 반환 구조는 이 파일과 `server/dart/client.ts`를 함께 확인하세요. `publicProcedure`라는 이름 자체는 호출자 인증을 보장하지 않습니다.

## 4. 지표 레지스트리

`server/dart/engine.ts`의 FORMULAS 항목: **revenue, operatingProfit, netIncome, operatingMargin, operatingCashFlow, investmentCashFlow, financingCashFlow, capex, freeCashFlow, netWorkingCapital, assetTurnover, netDebt, debtRatio, currentRatio, interestCoverage, roe, roa, eps, ebitda, per, pbr**. 항목 존재는 `queryable=true` 또는 모든 기업에서 계산 성공을 뜻하지 않습니다.

## 5. 인증키

실시간 조회는 브라우저에서 `x-opendart-key` 헤더로 키를 서버에 전달합니다. `server/routers.ts`의 `withDartApiKey` 호출을 확인할 수 있습니다. 운영 배포 시 키를 서버 환경변수로 공유하지 말고, 액세스 로그·프록시 로그·에러 추적 도구에서 쿼리 문자열/헤더 노출을 별도로 점검하세요. 브라우저 저장소에 보관한 키는 XSS에 취약할 수 있습니다.

## 6. 배포

실제 배포 환경 변수, HTTPS, 프록시 설정, CORS, 레이트리밋, 보안 헤더, 로그 마스킹을 확인하세요. Dockerfile은 포함되어 있으나 컨테이너 실행 성공은 별도 검증이 필요합니다.

## 7. 중요한 제한

실제 `pnpm check/test/build` 및 브라우저 E2E는 이 문서 생성 과정에서 수행하지 않았습니다. 원문 특정 행 딥링크, 실시간 DART 일치, 모든 지표 계산 성공은 미인증 상태입니다.
