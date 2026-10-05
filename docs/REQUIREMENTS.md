# [Project Requirements] DART-Copilot Agent 핵심 비즈니스 로직 구현 명세서

@Manus, 이 프로젝트는 DART(전자공시시스템) API를 활용하여 재무 데이터를 정확하게 검색하고 계산하는 AI 에이전트입니다. LLM의 환각(Hallucination)을 원천 차단하기 위해 아래의 5가지 핵심 비즈니스 로직을 백엔드 코드(TypeScript/Python)와 System Prompt에 엄격하게 반영하여 구현해 주세요.

## 1. Entity Mapping: 기업명 ↔ DART 고유번호(corp_code) 매핑 로직
사용자의 자연어 입력값(기업명)을 DART API 호출을 위한 8자리 고유번호로 변환해야 합니다.
*   **Data Source:** DART API의 '공시대상회사 고유번호(CORPCODE.xml)' 데이터 활용.
*   **Implementation Logic:**
    1. 시스템 초기화 시 XML 데이터를 파싱하여 내부 DB(또는 JSON Dict)에 `[기업명(corp_name) - 종목코드(stock_code) - 고유번호(corp_code)]` 형태로 매핑 테이블을 구축하세요.
    2. 사용자 쿼리에서 기업명 Entity를 추출한 후, 내부 DB를 조회하여 매핑된 `corp_code`를 DART API 파라미터로 전달하세요.
    3. **예외 처리:** "삼전", "현차" 등 흔히 쓰이는 약어나 "(주)"가 포함된 경우를 대비해 LLM이 사전에 기업명을 공식 명칭으로 정규화(Normalize)하도록 System Prompt에 지시하세요.

## 2. API Params: 연결/별도 기준 정책 (Consolidated vs Separate)
재무제표 데이터 추출 시 명확한 기준 설정이 필요합니다.
*   **Default Rule:** 기본값은 무조건 **'연결재무제표(CFS)'**를 호출하도록 API 파라미터(`fs_div`)를 하드코딩하세요.
*   **Routing Logic:** 사용자의 프롬프트에 "별도", "개별"이라는 키워드가 명시적으로 포함된 경우에만 `fs_div` 파라미터를 **'별도(OFS)'**로 변경하여 호출하세요.
*   **UI/Output Rule:** 최종 데이터 출력 시, 해당 수치가 `(연결 기준)`인지 `(별도 기준)`인지 텍스트 반환값에 반드시 포함되도록 포맷팅하세요.

## 3. Formula Engine: '순차입금(Net Debt)' 정의 및 계산 로직
'순차입금'은 DART 계정에 존재하지 않으므로, LLM이 임의로 암산하지 못하도록 백엔드에 독립된 연산 함수(Formula Engine)를 구현하세요.
*   **Formula Function:** DART '단일회사 주요계정 API' 또는 'XBRL 재무제표 API'를 호출하여 아래 계정의 값을 변수에 할당한 뒤 연산하세요.
    *   `total_debt` (총차입금) = `단기차입금` + `유동성장기부채` + `장기차입금` + `사채`
    *   `liquid_assets` (유동성 자산) = `현금및현금성자산` + `단기금융상품(단기투자자산)`
    *   `net_debt` (순차입금) = `total_debt` - `liquid_assets`
*   **System Prompt:** "수치 계산이 필요한 지표(순차입금 등)는 절대 LLM 내부 파라미터로 계산하지 말고, 반드시 내장된 함수(Tool/Function)를 호출하여 결과값을 받아 출력하라."

## 4. Accounting Treatment: 세부 계정 포함/제외 기준
재무 분석의 일관성을 위해 차입금 세부 항목 기준을 아래와 같이 강제(Hard-rule)합니다. 연산 로직(Formula)에 정확히 반영하세요.
*   **리스부채 (제외):** 총차입금 연산 시 '리스부채' 항목은 검색/합산 대상에서 제외하세요.
*   **전환사채/신주인수권부사채 (포함):** 미전환 사채는 차입금의 성격을 가지므로 '사채' 계정에 포함하여 합산하세요.
*   **단기금융상품 (포함):** 차감 대상인 유동성 자산 연산 시, '단기금융상품'을 포함하여 계산하세요.
*   **UI/Output Rule:** 순차입금 결과 출력 시 하단에 면책 조항(Disclaimer)으로 다음 문구를 자동 삽입하세요.
    *   `※ 본 순차입금 계산은 리스부채를 제외하고, 단기금융상품을 포함한 보수적 기준을 적용하였습니다.`

## 5. Traceability & RAG: 출처(Citation) 추출 및 딥링킹(Deep-linking)
신뢰성 확보를 위해 데이터의 원문 위치를 정확히 안내해야 합니다.
*   **Link Generation (Deep-linking):**
    *   API 응답값에 포함된 접수번호(`rcp_no`)를 활용하세요.
    *   출처 링크 URL 조합 공식: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo={rcp_no}`
*   **RAG Parsing Logic (주석 추출):**
    *   재무제표 주석이나 사업의 내용 HTML/XML 문서를 Chunking할 때, 정규식(Regex)을 사용하여 `^\d+\.\s.*` 형태의 목차(예: "14. 차입금 내역")를 Metadata(Heading)로 캡처하세요.
    *   응답 시 `📄 출처: [2026 반기보고서] > [주석 14. 차입금 내역] (원문 링크)` 형태로 렌더링되도록 구현하세요.
