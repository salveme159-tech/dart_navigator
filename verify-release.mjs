// 메뉴와 서버 파일이 함께 적용됐는지 빌드 전에 검사합니다. 외부 패키지가 필요하지 않습니다.
import {readFileSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const checks = [
 ['client/src/pages/Home.tsx', /import ArticleFactCheckPanel/, '기사 팩트 체크 화면 import'],
 ['client/src/pages/Home.tsx', /setActiveTab\("ARTICLE_FACT_CHECK"\)/, '추가 기능 메뉴 연결'],
 ['client/src/pages/Home.tsx', /activeTab === "ARTICLE_FACT_CHECK" && <ArticleFactCheckPanel/, '화면 표시 연결'],
 ['client/src/pages/Home.tsx', /15초 간격/, '공시 갱신 안내'],
 ['client/src/pages/Home.tsx', /startFilingPolling\(check\)/, '알람 자동 갱신 연결'],
 ['client/src/components/ArticleFactCheckPanel.tsx', /dart\.articleFactCheck/, '기사 검증 API 호출'],
 ['client/src/lib/realDartClient.ts', /export const EMPTY_DART_RECORD/, '초기 레코드 export'],
 ['client/src/lib/apiBase.ts', /export (?:const|function) apiUrl\b/, 'apiUrl export'],
 ['client/src/lib/apiBase.ts', /export const apiBaseUrl\b/, 'apiBaseUrl export'],
 ['client/src/lib/apiBase.ts', /export (?:async )?function apiFetch\b/, '기존 apiFetch 호환'],
 ['client/src/lib/filingPolling.ts', /FILING_POLL_MS = 15_000/, '15초 갱신 주기'],
 ['server/routers.ts', /articleFactCheck: publicProcedure/, '서버 API 등록'],
 ['server/dart/client.ts', /export async function financialFactSource/, '공시 원천값 조회'],
 ['server/dart/articleFactCheck.ts', /export async function factCheckArticle/, '기사 검증 처리'],
 ['server/dart/articleClaims.ts', /export function extractArticleClaims/, '기사 수치 추출'],
 ['shared/articleFactCheck.ts', /export type FactCheckResult/, '공통 응답 형식'],
 ['.github/workflows/deploy.yml', /name: github-pages/, 'Pages 배포 환경'],
 ['Dockerfile', /pnpm install --no-frozen-lockfile/, '서버 설치 설정'],
];
let failures=0;
for (const [path,pattern,label] of checks) {
 try {if(!pattern.test(readFileSync(new URL(path,root),'utf8')))throw new Error('필요 코드 미확인');console.log(`PASS ${label}`);}
 catch {failures++;console.error(`FAIL ${label}: ${path}를 통합 적용본의 파일로 교체하세요.`);}
}
if(failures)process.exitCode=1;
else console.log('Release 20261027-factcheck-integrated: 기사 팩트 체크·공시 갱신 연결 검사 18건 통과');
