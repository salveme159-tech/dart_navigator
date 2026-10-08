> **주의:** 이 문서는 목표 요구사항입니다. 실제 구현 여부는 05_VALIDATION_REPORT.md와 코드로 확인하세요. 기존 본문은 변경 없이 보존합니다.

# DART Navigator — Master Product & Agent Specification v2

> Version: 2.0 / No Time Constraint
> Product: Evidence-first financial disclosure intelligence agent
> Web demo: primary submission surface
> Agent target: platform-neutral ChatGPT integration via supported app/plugin/MCP/API surfaces
> Data source: Financial Supervisory Service OpenDART
> Canonical principle: **Retrieve -> Normalize -> Calculate -> Validate -> Prove -> Explain -> Export**

---

## 0. Product North Star

### 0.1 One-line definition

**DART Navigator answers financial questions with traceable numbers, deterministic formulas, explicit accounting policies, and auditable source evidence.**

### 0.2 Competition proposition

The product is not a generic finance chatbot.

It must demonstrate five capabilities in sequence:

1. Find the correct filing.
2. Select the correct period, statement basis, and source fields.
3. Calculate derived metrics deterministically.
4. Refuse when the evidence is insufficient or materially ambiguous.
5. Show exactly how every displayed number was obtained.

### 0.3 Product surfaces

The system has three thin client surfaces over one canonical backend contract:

- **Web application**: primary competition/demo surface.
- **ChatGPT integration**: thin natural-language client that invokes the same backend contract.
- **Developer/test tools**: scripts and test harnesses that use the same API and formula registry.

The web application is the fallback submission surface. The product must remain fully useful even if a specific ChatGPT integration surface changes availability.

### 0.4 Platform-change policy

For the 2026-10-30 competition submission and November judging, the web application is the primary product and the judging experience must not depend on any ChatGPT-side feature or external account setup. ChatGPT portability is a post-award/reuse concern only: keep the API, formula registry, result schema, and evidence model portable, but do not divert submission effort into a ChatGPT migration. A future ChatGPT integration may use the then-current supported integration surface (for example, an API-backed tool or MCP server) without changing the web product.

---

# 1. System Architecture

## 1.1 Canonical architecture

```text
                       ┌────────────────────────┐
                       │   Web App / ChatGPT    │
                       │ natural language + UI  │
                       └────────────┬───────────┘
                                    │
                              API Contract
                                    │
                       ┌────────────▼───────────┐
                       │   Query Planner         │
                       │ company / period /     │
                       │ basis / metric         │
                       └────────────┬───────────┘
                                    │
                       ┌────────────▼───────────┐
                       │   Filing Resolver       │
                       │ DART filings + status   │
                       └────────────┬───────────┘
                                    │
                       ┌────────────▼───────────┐
                       │ Retrieval / Normalizer  │
                       │ XBRL ID + account +     │
                       │ period + unit + sign    │
                       └────────────┬───────────┘
                                    │
                       ┌────────────▼───────────┐
                       │ Deterministic Engine    │
                       │ one canonical engine    │
                       │ formula registry        │
                       └────────────┬───────────┘
                                    │
                       ┌────────────▼───────────┐
                       │ Validation / Evidence   │
                       │ lineage + reconciliation│
                       └────────────┬───────────┘
                                    │
                       ┌────────────▼───────────┐
                       │ Agent Answer Envelope   │
                       │ displayText + steps +   │
                       │ evidence + status       │
                       └────────────────────────┘
```

## 1.2 Single-engine rule

There must be **one canonical calculation engine**.

- The web app does not reimplement financial formulas.
- The ChatGPT layer does not calculate authoritative numbers.
- Python is the canonical calculation language for the agent backend.
- TypeScript, where retained for the web application, calls the same calculation API rather than maintaining a second formula implementation.

A formula must never exist as an independently maintained TS version and Python version.

## 1.3 Canonical assets

Maintain these as source-of-truth artifacts:

- `OPENAPI.yaml`
- `AGENT_INSTRUCTIONS.md`
- `AGENT_FORMULAS.json`
- `CALCULATION_ENGINE.py`
- `ACCOUNT_MAPPING.json`
- `EVIDENCE_SCHEMA.json`
- `ANSWER_SCHEMA.json`
- `TEST_CASES.json`
- `BENCHMARK_DATASET.json`
- `SECURITY_POLICY.md`

These artifacts must be versioned independently of the web presentation layer.

---

# 2. Non-negotiable Financial Accuracy Rules

1. **LLM arithmetic is never authoritative.**
2. The LLM may parse intent, but it cannot supply authoritative numeric inputs to the calculation endpoint.
3. The calculation endpoint accepts identifiers and query parameters, not user-supplied financial values.
4. Every calculated output has a `formulaId` and `formulaVersion`.
5. Every input has an EvidenceRef.
6. CFS and OFS inputs cannot be mixed.
7. Flow and stock values cannot be mixed without an explicit period rule.
8. Interim income-statement values use the correct cumulative field when a cumulative result is requested.
9. Units are normalized before any arithmetic.
10. Decimal precision and rounding are deterministic across Python, UI, and Excel output.
11. Corrected filings and subsequent comparative restatements are distinct concepts and must be represented separately.
12. A missing account row is not automatically an error and is not automatically zero. Input availability has an explicit three-state model.
13. Ambiguous account mappings cannot enter an authoritative calculation.
14. Missing source evidence blocks authoritative calculation.
15. Unsupported metrics remain visible as definitions but cannot expose an executable `질의하기` control.
16. A refusal is a valid, first-class product outcome.
17. The final narrative must not alter the canonical numeric value, unit, period, basis, or calculation text returned by the engine.

---

# 3. OpenDART Data Contract

## 3.1 Primary source

Primary structured source for financial statements:

`fnlttSinglAcntAll`

Official OpenDART documentation confirms the response contains `sj_div`, `account_id`, `account_nm`, `rcept_no`, and period-specific amount fields including `thstrm_amount`, `thstrm_add_amount`, `frmtrm_amount`, `frmtrm_q_amount`, and `frmtrm_add_amount`.

## 3.2 Statement types

- `BS` = balance sheet
- `IS` = income statement
- `CIS` = statement of comprehensive income
- `CF` = cash flow statement
- `SCE` = statement of changes in equity

## 3.3 Canonical raw-row model

```json
{
  "rcpNo": "string",
  "corpCode": "string",
  "reportCode": "11012",
  "bsnsYear": 2026,
  "fsDiv": "CFS",
  "sjDiv": "IS",
  "accountId": "ifrs-full_Revenue",
  "accountName": "매출액",
  "accountDetail": null,
  "thstrmAmount": "...",
  "thstrmAddAmount": "...",
  "frmtrmAmount": "...",
  "frmtrmQAmount": "...",
  "frmtrmAddAmount": "...",
  "bfefrmtrmAmount": "...",
  "currency": "KRW"
}
```

## 3.4 Field-selection rules

The engine must not use one generic `amountOf()` rule for all statements and all periods.

### Income statement / comprehensive income (`IS`, `CIS`)

For interim filings:

- current 3-month amount → `thstrm_amount`
- current cumulative amount → `thstrm_add_amount`
- prior-year 3-month amount → `frmtrm_q_amount`
- prior-year cumulative amount → `frmtrm_add_amount`
- prior fiscal-year-end balance where applicable → `frmtrm_amount`

For annual filings:

- current annual amount → `thstrm_amount`
- prior annual amount → `frmtrm_amount`
- prior-prior annual amount → `bfefrmtrm_amount`

This is a mandatory test area because OpenDART explicitly documents that `thstrm_amount` for interim IS/CIS rows is the **3-month amount**, while cumulative value is provided separately in `thstrm_add_amount`.

### Cash flow statement (`CF`)

Do not assume income-statement cumulative semantics automatically apply.

The engine must inspect the actual OpenDART field set and use the period semantics for the cash-flow response. A fixture must be created from a real half-year filing before FCF is marked production-ready.

### Balance sheet (`BS`)

Balances are point-in-time. Do not use cumulative-flow fields for balance-sheet calculations.

## 3.5 2015 lower bound

OpenDART `fnlttSinglAcntAll` documentation states that financial statement information is provided from 2015 onward. Requests outside the supported range must return `UNSUPPORTED_PERIOD` rather than silently falling back.

---

# 4. Company Resolution

## 4.1 Canonical identity

```json
{
  "corpCode": "string",
  "corpName": "대한전선",
  "stockCode": "001440",
  "market": "KOSPI",
  "fiscalMonth": 12,
  "industryCode": "..."
}
```

## 4.2 Resolution rules

Accept:

- Korean legal name
- English name
- ticker
- exact abbreviation
- known alias

Do not resolve an ambiguous company automatically.

Example:

`삼성` → ambiguity → ask user to choose an entity.

## 4.3 Fiscal year end

Every company record must include `fiscalMonth`.

Never hard-code period dates such as `01-01` to `06-30` for all companies.

The period resolver derives actual period dates from the company's fiscal calendar and report metadata.

---

# 5. Filing Resolution and Filing Lineage

## 5.1 Candidate selection

Selection priority:

1. exact requested fiscal period
2. requested CFS/OFS basis
3. valid report type
4. latest applicable filing
5. corrected filing supersedes original filing
6. filing timestamp

## 5.2 Amendment vs restatement

These are separate data relationships.

### Amendment / correction

A new filing supersedes an earlier filing of the same reporting period.

Model:

```json
{
  "filingStatus": "corrected",
  "supersedes": ["oldRcpNo"]
}
```

### Restated comparative

A later filing presents a revised comparative figure for an earlier period without changing the original filing object.

Model:

```json
{
  "comparativeStatus": "restated",
  "sourceFiling": "newRcpNo",
  "restatedPeriod": "2025-06-30"
}
```

A later filing can therefore contain a restated 2025 figure even though the original 2025 filing remains historically valid.

## 5.3 Canonical filing object

```json
{
  "filingId": "internal-id",
  "rcpNo": "202609xx...",
  "corpCode": "...",
  "reportCode": "11012",
  "bsnsYear": 2026,
  "basis": "CFS",
  "status": "original|corrected",
  "supersedes": [],
  "filedAt": "...",
  "periodEnd": "..."
}
```

---

# 6. Period Semantics

## 6.1 Query period object

```json
{
  "fiscalYear": 2026,
  "periodType": "H1",
  "periodStart": "derived",
  "periodEnd": "derived",
  "durationMonths": 6,
  "measurement": "flow|stock",
  "isCumulative": true,
  "annualized": false
}
```

`periodStart` and `periodEnd` are derived from the company's fiscal calendar and the selected report, not hard-coded globally.

## 6.2 Supported semantic periods

- annual
- Q1 cumulative
- Q2 cumulative / H1 cumulative
- Q2 single quarter
- Q3 cumulative
- Q3 single quarter
- point-in-time balance

## 6.3 “Latest” policy

`latest` is never a permanent semantic value.

The query result stores:

- the selected filing
- the selection timestamp
- the selection rule

For competition demos, use a fixed `demoSnapshotId` with a known filing/period so the result remains reproducible.

## 6.4 Comparison policy

“작년 같은 기간” means same fiscal period in the prior fiscal year.

For a 2026 H1 query, the engine must retrieve a 2025 H1 source separately. It must not substitute 2025-12-31 merely because the 2026 H1 report contains the 2025 year-end balance.

For a balance-sheet metric such as net debt requested without explicit comparative semantics, default comparison may be current period-end vs prior fiscal-year-end, but the UI must label the comparison precisely.

---

# 7. Input Availability Model

A missing row has exactly one of three states:

### `reported`

The account is present and a numeric value is reported.

### `absent_in_complete_statement`

The statement is complete for the selected basis and period, the canonical account group was searched using approved XBRL/name mappings, and the account is genuinely absent. The calculation policy may treat this as zero **only when the formula registry explicitly permits it**.

This state must be visible to the user, e.g.:

> 사채: 공시 재무상태표에서 해당 계정군이 확인되지 않아 0원으로 처리

### `unavailable`

The source is incomplete, ambiguous, unavailable, or insufficient to conclude that the value is zero.

`unavailable` blocks calculation.

---

# 8. Account Mapping

## 8.1 Mapping priority

Mapping begins with XBRL identifiers when available, then approved exact names, then reviewed aliases.

Priority:

1. `xbrl_id_exact`
2. `account_name_exact`
3. `alias_exact`
4. `semantic_reviewed`
5. `ambiguous`
6. `unmapped`

Only the first four can enter authoritative calculations.

## 8.2 Mapping object

```json
{
  "canonicalKey": "cash_and_equivalents",
  "statement": "BS",
  "xbrlIds": ["ifrs-full_CashAndCashEquivalents"],
  "approvedNames": ["현금및현금성자산"],
  "aliases": ["현금 및 현금성자산"],
  "confidence": "xbrl_id_exact",
  "allowLeaseVariants": false
}
```

## 8.3 Ambiguity rule

Do not use broad substring matching such as `수익` to identify `매출액`.

All mappings must be tested against distractor accounts.

---

# 9. Unit, Currency, Sign, and Precision Normalization

## 9.1 Supported display units

- 원
- 천원
- 백만원
- 십억원
- 억원
- 조원

Example:

`3,640,000,000,000원 = 36,400억원 = 3.64조원`

Any previous example claiming `36,400억원` for 3.64조원 is invalid and must not appear anywhere in project documentation.

## 9.2 Storage

Store calculation inputs in KRW base units using arbitrary-precision Decimal semantics.

Do not use binary floating point for authoritative financial arithmetic.

## 9.3 Sign policy

Each canonical input specifies a sign convention.

Examples:

- liabilities → positive input to debt
- cash deductions → positive stored magnitude with negative formula role
- cash outflows in CF → use source sign, then normalize according to the formula policy
- CAPEX → store a positive investment magnitude in the CAPEX registry

The engine must not infer sign by visual formatting alone.

## 9.4 Rounding

- calculation: full Decimal precision
- output value: metric-specific display precision
- ratio: default 1 decimal place unless policy says otherwise
- underlying raw value remains unrounded
- Excel formula uses raw normalized inputs

Round only at presentation boundaries.

---

# 10. Canonical Metric Registry — 29 Metrics

The product glossary contains exactly these 29 metrics/terms.

| # | Metric | ID | Initial status | Core rule |
|---|---|---|---|---|
| 1 | 매출액 | revenue | queryable | reported value |
| 2 | 매출총이익 | gross_profit | queryable_after_mapping | revenue - cost of sales |
| 3 | 영업이익 | operating_profit | queryable | reported value |
| 4 | 당기순이익 | net_income | queryable | basis-consistent reported value |
| 5 | 영업이익률 | operating_margin | queryable | operating profit / revenue |
| 6 | 매출총이익률 | gross_margin | queryable_after_mapping | gross profit / revenue |
| 7 | 순이익률 | net_margin | queryable | net income / revenue |
| 8 | 영업활동현금흐름 | operating_cash_flow | queryable | reported CF value |
| 9 | 투자활동현금흐름 | investing_cash_flow | queryable | reported CF value |
| 10 | 재무활동현금흐름 | financing_cash_flow | queryable | reported CF value |
| 11 | CAPEX | capex | queryable_after_policy | defined source policy required |
| 12 | 잉여현금흐름 | fcf | queryable_after_policy | CFO - CAPEX |
| 13 | 순운전자본 | nwc | queryable | current assets - current liabilities |
| 14 | 총차입금 | total_debt | queryable_after_mapping | approved debt group |
| 15 | 순차입금 | net_debt_v1 | queryable | approved debt group - approved liquid assets |
| 16 | 부채비율 | debt_ratio | queryable | liabilities / equity |
| 17 | 유동비율 | current_ratio | queryable | current assets / current liabilities |
| 18 | 당좌비율 | quick_ratio | queryable_after_mapping | quick assets / current liabilities |
| 19 | 자산회전율 | asset_turnover | queryable_after_mapping | revenue / average assets |
| 20 | 재고자산회전율 | inventory_turnover | queryable_after_mapping | COGS / average inventory |
| 21 | 매출채권회전율 | receivables_turnover | queryable_after_mapping | revenue / average receivables |
| 22 | ROE | roe_v2 | queryable | basis-consistent profit / average equity |
| 23 | ROA | roa_v2 | queryable | basis-consistent profit / average assets |
| 24 | 이자보상배율 | interest_coverage_v2 | queryable_after_source_policy | operating profit / interest expense |
| 25 | EBITDA | ebitda_v2 | queryable_after_source_policy | operating profit + depreciation + amortization |
| 26 | EPS | eps_reported | queryable | prefer reported DART EPS |
| 27 | PER | per | definition_only | market price required |
| 28 | PBR | pbr | definition_only | market price required |
| 29 | 현금전환주기 | ccc | queryable_after_mapping | DIO + DSO - DPO |

`queryable_after_*` means the button becomes active only after the listed policy, mapping, and benchmark tests pass.

---

# 11. Formula Registry and Metric Policies

All formulas must be machine-readable. Do not store executable formulas as unrestricted natural-language strings only.

## 11.1 Structured formula representation

Example:

```json
{
  "id": "debt_ratio_v1",
  "operator": "divide_then_multiply",
  "numerator": {"key": "total_liabilities"},
  "denominator": {"key": "total_equity"},
  "multiplier": 100,
  "rounding": "1dp"
}
```

## 11.2 Net debt policy

### `net_debt_v1`

Default policy:

`Total Debt Group - Cash & Cash Equivalents - Short-term Financial Assets Group`

### Debt group

The debt group is a **group**, not one account:

- short-term borrowings
- current portion of long-term borrowings
- current portion of bonds
- long-term borrowings
- bonds
- approved debt securities such as convertible bonds, exchangeable bonds, and bonds with warrants when the mapping policy classifies them as debt

### Liquid-asset group

Default:

- cash and cash equivalents
- short-term financial assets / short-term financial instruments explicitly included by policy

Do not silently include fair-value financial assets, equity securities, or other current investments unless the metric version explicitly says so.

### Leases

Default `net_debt_v1` excludes lease liabilities.

Also define:

`net_debt_incl_lease_v1`

which explicitly includes current and non-current lease liabilities.

The result UI must show a policy label such as:

> 순차입금 v1 · 리스부채 제외 · 단기금융자산 포함

### Missing debt-group components

For each group member:

- `reported` → include
- `absent_in_complete_statement` → zero only when the group policy permits zero absence
- `unavailable` → refuse

### No single `bonds` input

The canonical input is an aggregated evidence-bearing debt group with child rows. Each child row remains separately traceable.

## 11.3 ROE policy

### CFS

Numerator:

**profit attributable to owners of parent**.

Denominator:

**average of current and prior period equity attributable to owners of parent**.

### OFS

Numerator:

**net income**.

Denominator:

**average of current and prior period total equity**.

### Interim denominator

For an H1 result:

`(2026-06-30 equity + 2025-12-31 equity) / 2`

For a Q1 result:

`(2026-03-31 equity + 2025-12-31 equity) / 2`

The denominator is a point-in-time average; it is not an annualization operation.

### Interim display

`2026 반기 누적 ROE (연환산 아님)`

### Denominator guard

If the average denominator is zero or negative where the policy does not support interpretation, return `INVALID_DENOMINATOR`.

## 11.4 ROA policy

CFS:

- numerator = basis-consistent net income policy
- denominator = average total assets

OFS:

- numerator = separate net income
- denominator = average separate total assets

For consistency, the CFS numerator policy should match the ROE numerator convention unless a specific accounting-policy exception is approved and documented.

Interim average:

`(current period-end assets + prior fiscal year-end assets) / 2`

No annualization by default.

## 11.5 EBITDA policy

`Operating Profit + Depreciation + Amortization`

The source policy must identify depreciation and amortization separately or provide a reviewed equivalent.

Do not infer either from arbitrary cash-flow totals.

Until a reliable production source mapping is established, `queryable=false`.

If the product later supports lease-normalized EBITDA, it must have a separate metric ID and debt-policy pairing.

## 11.6 CAPEX policy

CAPEX is not fully specified by the simple phrase “property, plant and equipment acquisitions”.

Define a canonical policy before enabling FCF:

### `capex_v1`

Default candidate source:

- cash paid for acquisition of property, plant and equipment
- cash paid for acquisition of intangible assets

Exclude:

- acquisition of subsidiaries unless explicitly classified separately
- financing principal payments
- lease principal payments unless a specific `capex_incl_lease_v1` policy exists

The exact field/source must be proven against real OpenDART fixtures.

Until this source policy is validated, `capex` and `fcf` remain definition-only.

## 11.7 FCF policy

`Operating Cash Flow - CAPEX`

Both values must be for the same duration and basis.

The result must disclose CAPEX policy version.

## 11.8 Interest coverage policy

`Operating Profit / Absolute Interest Expense`

Do not substitute total financial costs for interest expense.

Interest expense must come from a reviewed note/source mapping. If unavailable, `queryable=false`.

## 11.9 Turnover policies

### Asset turnover

`Revenue / Average Total Assets`

### Inventory turnover

`Cost of Sales / Average Inventory`

### Receivables turnover

`Revenue / Average Trade Receivables`

### Cash conversion cycle

`DIO + DSO - DPO`

Each component needs an explicit day-count basis and average denominator policy.

Default:

`Average balance` based on current and prior fiscal-period balances, not current balance alone.

## 11.10 Quick ratio

Define quick assets explicitly before enabling:

`(Cash + qualifying short-term financial assets + qualifying receivables) / Current Liabilities × 100`

Exclude inventory.

The qualifying asset list is policy-driven, not a substring search.

## 11.11 EPS

For requested reported EPS, prefer the DART-reported EPS figure.

Calculated EPS requires a separate metric ID with explicit weighted-average-share methodology.

## 11.12 PER / PBR

Definition-only until time-consistent market price, share count, and market-data timestamp policies exist.

Do not fake a market multiple from DART financial statements alone.

---

# 12. Canonical Response Envelope

Every agent call returns one envelope.

```json
{
  "status": "VERIFIED",
  "valueKind": "calculated",
  "answer": {
    "displayValue": "581.0억원",
    "displayText": "순차입금은 581.0억원입니다."
  },
  "context": {
    "company": {},
    "period": {},
    "basis": "CFS"
  },
  "metric": {
    "id": "net_debt_v1",
    "name": "순차입금",
    "formulaVersion": "2026.10"
  },
  "calculation": {
    "steps": []
  },
  "validation": {
    "passed": true,
    "warnings": []
  },
  "evidence": [],
  "refusal": null,
  "display": {
    "unit": "억원",
    "policyLabel": "리스부채 제외 · 단기금융자산 포함"
  },
  "metadata": {
    "apiVersion": "2.0",
    "mappingVersion": "2026.10",
    "retrievedAt": "...",
    "demoSnapshotId": null
  }
}
```

## 12.1 `valueKind`

Exactly one:

- `reported`
- `calculated`
- `derived_display`

## 12.2 Status model

Exactly one primary status:

- `VERIFIED`
- `VERIFIED_WITH_CORRECTION`
- `VERIFIED_WITH_WARNING`
- `PARTIAL`
- `INSUFFICIENT_DATA`
- `UNSUPPORTED`
- `SOURCE_ERROR`
- `AUTH_ERROR`

Do not use `status` and `refusal` as competing status systems.

### Refusal envelope

```json
{
  "status": "INSUFFICIENT_DATA",
  "refusal": {
    "code": "MISSING_REQUIRED_INPUT",
    "message": "ROE에 필요한 전기말 지배기업 소유주지분을 확인할 수 없습니다.",
    "missingInputs": ["equity_attributable_to_owners_prior"]
  }
}
```

---

# 13. CalculationStep Schema

```json
{
  "stepId": "step_01",
  "label": "단기차입금",
  "inputKey": "short_term_debt",
  "valueKind": "reported",
  "reportedValue": "120000000000",
  "normalizedValue": "120000000000",
  "displayValue": "1,200억원",
  "unit": "KRW",
  "sign": "+",
  "availability": "reported",
  "evidenceIds": ["ev_001"]
}
```

A calculation step cannot exist without its evidence relationship except for a deliberate `absent_in_complete_statement` zero line, which must carry the completeness evidence explaining why it was treated as zero.

---

# 14. EvidenceRef and Source Lineage


## 14.1 EvidenceRef

```json
{
  "id": "ev_001",
  "rcpNo": "202609....",
  "corpCode": "...",
  "reportName": "반기보고서",
  "filingDate": "2026-08-...",
  "periodEnd": "2026-06-30",
  "basis": "CFS",
  "statement": "BS",
  "canonicalAccount": "cash_and_equivalents",
  "sourceAccountId": "ifrs-full_CashAndCashEquivalents",
  "sourceAccountName": "현금및현금성자산",
  "reportedValue": "...",
  "reportedUnit": "원",
  "normalizedValue": "...",
  "normalizedUnit": "KRW",
  "availability": "reported",
  "filingStatus": "original",
  "supersedes": [],
  "comparativeStatus": "current|restated|original",
  "snippet": "...",
  "locator": {
    "type": "row|heading|text|url_only",
    "token": "..."
  },
  "dartUrl": "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=..."
}
```

## 14.2 Locator realism rule

Do not promise exact row-level navigation unless a verified locator exists.

Locator states:

- `row`
- `heading`
- `text`
- `url_only`

If only `url_only` is available, the UI must say `공시 원문 열기` and must not claim that the browser will jump to the exact numeric row.

## 14.3 Evidence completeness rule

A calculated output is authoritative only when every required input has one of:

- `reported` evidence
- `absent_in_complete_statement` evidence plus an explicitly allowed-zero formula policy

Any `unavailable`, `ambiguous`, or missing evidence blocks the calculation.

---

# 15. Validation / Reconciliation Engine

Validation is independent of the target formula. It should use separate accounting identities and source relationships where possible.

## 15.1 Balance sheet

`Total Assets = Total Liabilities + Total Equity`

## 15.2 Income statement

When source components are available:

`Gross Profit = Revenue - Cost of Sales`

`Operating Profit = Gross Profit - Operating Expenses`

## 15.3 Net income attribution

Where disclosed:

`Total Net Income = Profit Attributable to Owners + Non-controlling Interests`

## 15.4 Cash flow

Where source semantics support it:

`Beginning Cash + CFO + CFI + CFF + FX/Other Effects = Ending Cash`

## 15.5 No circular validation

Do not validate a calculated operating margin merely by recalculating the same operating profit / revenue formula. Validation must add independent information.

---

# 16. Unified Status and Refusal Model

`status` is the single top-level state. `refusal` is populated only when the result is refused.

## 16.1 Status

- `VERIFIED`
- `VERIFIED_WITH_CORRECTION`
- `VERIFIED_WITH_WARNING`
- `PARTIAL`
- `INSUFFICIENT_DATA`
- `UNSUPPORTED`
- `SOURCE_ERROR`
- `AUTH_ERROR`

## 16.2 Refusal codes

- `MISSING_REQUIRED_INPUT`
- `MISSING_PRIOR_PERIOD`
- `INVALID_DENOMINATOR`
- `BASIS_MISMATCH`
- `PERIOD_MISMATCH`
- `FLOW_STOCK_MISMATCH`
- `UNIT_MISMATCH`
- `AMBIGUOUS_ACCOUNT_MAPPING`
- `UNMAPPED_ACCOUNT`
- `UNSUPPORTED_METRIC`
- `UNSUPPORTED_INDUSTRY`
- `NO_TIME_CONSISTENT_MARKET_PRICE`
- `CORRECTED_FILING_CONFLICT`
- `SOURCE_NOT_FOUND`
- `INCOMPLETE_STATEMENT`
- `UNSUPPORTED_PERIOD`
- `POLICY_NOT_READY`

## 16.3 Source errors vs calculation refusals

OpenDART service codes must remain distinct from financial-policy refusal codes.

Official OpenDART examples include:

- `010`: unregistered key
- `011`: temporarily unusable key
- `012`: inaccessible IP
- `013`: no data
- `014`: file not found
- `020`: request limit exceeded
- `021`: company-count query limit exceeded
- `100`: invalid field value
- `101`: invalid access
- `800`: maintenance
- `900`: undefined error
- `901`: expired personal-information retention period for the key

---

# 17. Query Planner

The planner is the only layer that converts natural language into an executable domain request.

## 17.1 Plan

```json
{
  "company": {"corpCode": "..."},
  "metricId": "roe_v2",
  "period": {"fiscalYear": 2026, "periodType": "H1"},
  "basis": "CFS",
  "comparison": null,
  "output": "answer_with_calculation_and_evidence"
}
```

## 17.2 Planner safety

The planner may select:

- company identifier
- filing/period
- basis
- metric ID
- comparison mode
- output mode

The planner may not select:

- arbitrary financial input values
- arbitrary formula text
- arbitrary source account aliases outside the mapping registry

---

# 18. Multi-turn Context

Keep current conversation context:

- company
- basis
- period
- metric
- comparison set

Material ambiguities invalidate inherited context.

Example:

`대한전선 2026 반기 순차입금`
→ `2025년 반기와 비교해줘`

must perform a second-period H1 retrieval rather than reusing 2025 year-end data from the 2026 H1 filing.

---

# 19. Comparison and Trend Engine

## 19.1 Valid comparisons

- same company, same metric, same basis, comparable periods
- same company, same fiscal period across years
- different companies only after basis/period normalization

## 19.2 Labels

Never use vague labels such as `작년` in the final evidence metadata.

Use concrete labels such as:

`2026-06-30 vs 2025-06-30`

or:

`2026-06-30 vs 2025-12-31`

## 19.3 Restated trend

If 2025 comparative data is restated in a later report, the trend must identify that the comparative figure came from a restated later filing.

---

# 20. User OpenDART Credential Architecture

## 20.1 Public deployment modes

### Demo Snapshot

- no key required
- fixed judged dataset
- zero live OpenDART calls
- immutable snapshot ID

### My Key / Live

- user provides own OpenDART key
- real-time OpenDART retrieval
- user owns usage/quota responsibility
- no application-wide shared credential

The public runtime must not have an `OPENDART_API_KEY` fallback that serves all users.

## 20.2 Credential transport

Browser → application server:

- HTTPS only
- credential in request header
- never in browser URL

Application server → OpenDART:

- use OpenDART's required `crtfc_key` request parameter
- sanitize outbound URL before logging

## 20.3 Storage

Default browser storage = `sessionStorage`.

Persistent storage requires explicit user opt-in:

`이 브라우저에 기억`

Do not place the secret in the same object/key namespace as recent search history.

## 20.4 Server handling

Raw user credentials are request-scoped and must not be persisted in the product database.

If a future account system is introduced, use an encrypted, user-scoped secret vault.

## 20.5 Validation

Before accepting a key:

1. trim whitespace
2. validate 40-character format
3. perform a low-cost authenticated OpenDART request
4. map the response code
5. save only after successful validation

## 20.6 Compromise response

If a key is ever committed to Git or exposed publicly:

1. revoke/deactivate it in OpenDART
2. issue a new key
3. rotate affected secrets
4. inspect repository history

Removing the latest `.env` file alone is insufficient.

---

# 21. Demo Snapshot Architecture

## 21.1 Snapshot contents

- company identity
- filing metadata
- normalized rows
- calculation inputs
- EvidenceRefs
- formula version
- mapping version
- expected result

## 21.2 Snapshot identity

Example:

`demo.taihan.2026H1.net_debt.v2`

## 21.3 Snapshot isolation

A demo snapshot must never silently mix live OpenDART fields with cached demo values.

Every result indicates:

- `DEMO SNAPSHOT`
- `LIVE OPENDART`

---

# 22. Formula / Accounting Policy Matrix

Every metric has the following policy fields:

- formula ID
- formula version
- numerator policy
- denominator policy
- accounting basis
- period semantics
- annualization rule
- required inputs
- availability policy
- allowed-zero policy
- exclusion policy
- unit policy
- sign policy
- rounding policy
- source policy
- test IDs

No metric becomes `queryable=true` merely because its formula is mathematically simple.

---

# 23. Glossary — 29 Terms

The glossary is the user-facing mirror of the metric registry.

| Metric | Query button | Minimum requirement |
|---|---|---|
| 매출액 | Yes | reported DART revenue |
| 매출총이익 | Conditional | validated revenue + cost of sales mapping |
| 영업이익 | Yes | reported operating profit |
| 당기순이익 | Yes | basis-consistent net income |
| 영업이익률 | Yes | operating profit + revenue |
| 매출총이익률 | Conditional | gross profit + revenue |
| 순이익률 | Yes | net income + revenue |
| 영업활동현금흐름 | Yes | reported CF |
| 투자활동현금흐름 | Yes | reported CF |
| 재무활동현금흐름 | Yes | reported CF |
| CAPEX | Conditional | validated CAPEX source policy |
| 잉여현금흐름 | Conditional | CFO + validated CAPEX policy |
| 순운전자본 | Yes | current assets + current liabilities |
| 총차입금 | Conditional | validated debt group |
| 순차입금 | Yes | validated debt/liquid-asset policy |
| 부채비율 | Yes | liabilities + equity |
| 유동비율 | Yes | current assets + current liabilities |
| 당좌비율 | Conditional | validated quick-asset classification |
| 자산회전율 | Conditional | revenue + average assets |
| 재고자산회전율 | Conditional | COGS + average inventory |
| 매출채권회전율 | Conditional | revenue + average trade receivables |
| ROE | Yes | basis-consistent profit + average equity |
| ROA | Yes | basis-consistent profit + average assets |
| 이자보상배율 | Conditional | reviewed interest-expense source |
| EBITDA | Conditional | reviewed depreciation/amortization source |
| EPS | Yes | DART reported EPS |
| PER | No | time-consistent market price |
| PBR | No | time-consistent market price |
| 현금전환주기 | Conditional | validated DIO/DSO/DPO mappings |

The UI must not expose an executable button for any `Conditional` or `No` metric until its registry flag is enabled.

---

# 24. UI / UX

## 24.1 Main screen

No login wall.

Default landing state = `체험 모드`.

Primary input:

> 무엇을 알고 싶으신가요?

Secondary controls:

- company autocomplete
- supported metric chips
- recent questions
- `체험 모드 / 실시간 모드` state
- OpenDART connection state

## 24.2 Glossary interaction

`질의하기`:

1. inserts a prepared question
2. focuses the query box
3. does not auto-execute

## 24.3 Result design

Order:

1. answer
2. exact period
3. basis
4. policy label
5. status
6. calculation
7. evidence
8. comparison
9. export

## 24.4 Evidence drawer

Input click opens:

- account
- XBRL ID
- reported value
- normalized value
- sign
- period
- statement
- filing status
- snippet/locator
- DART link

---

# 25. Export

## 25.1 PDF

Use `window.print()` with print CSS.

Test:

- Korean fonts
- no clipped content
- formula visibility
- source links
- no API key

## 25.2 XLSX

Real `.xlsx` only.

Sheets:

1. Summary
2. Calculation
3. Sources

## 25.3 Excel formula integrity

Calculation cells contain actual spreadsheet formulas.

The export pipeline must also retain formula-result cache values where the file format/library supports them.

CI must recalculate with a spreadsheet engine and compare the recalculated result to the canonical engine result.

---

# 26. Narrative Integrity

The API is authoritative for numeric display.

The API returns both:

- `displayValue`
- `displayText`

The LLM must copy them exactly.

Test for:

- number mutation
- unit mutation
- sign mutation
- period mutation
- basis mutation
- rounding mutation

The LLM may explain, but may not rewrite the canonical result into another numerical representation unless that representation was also supplied by the renderer.

---

# 27. API Contract

## 27.1 `resolveCompany`

Input:

- query
- optional ticker

Output:

- canonical company
- candidates if ambiguous

## 27.2 `listFilings`

Input:

- corpCode
- requested period
- basis

Output:

- candidate filings
- status
- filing date
- period end
- amendment/restatement metadata

## 27.3 `getFinancialData`

Input:

- filing ID
- statement
- closed-enum canonical account keys

No arbitrary financial numbers.

## 27.4 `calculateMetric`

Input:

```json
{
  "company": {"corpCode": "..."},
  "period": {"fiscalYear": 2026, "periodType": "H1"},
  "basis": "CFS",
  "metricId": "net_debt_v1",
  "mode": "snapshot|live"
}
```

Returns the full `AgentAnswer` envelope.

The LLM cannot override:

- inputs
- formula
- period
- basis
- source selection

## 27.5 `getEvidence`

Input:

- evidence ID

Output:

- source metadata
- snippet/locator
- original DART URL

---

# 28. API Security Boundary

The API request from the agent is an instruction to retrieve/compute. It is not an instruction to accept supplied financial data.

Use schema validation to reject:

- extra numeric fields
- arbitrary formulas
- arbitrary account identifiers
- credentials in query payloads

The calculation endpoint is a closed domain operation over trusted data sources.

---

# 29. Caching and Performance

## 29.1 Immutable source cache

Cache complete source payloads keyed primarily by `rcpNo` and source endpoint version.

## 29.2 Calculation cache

Key:

`corpCode + rcpNo + basis + metricId + formulaVersion + mappingVersion`

## 29.3 Filing list cache

Short TTL because “latest” changes.

## 29.4 Demo snapshot

Immutable and versioned.

## 29.5 Rate limit

Surface official OpenDART limits and codes. Never claim a universal request allowance beyond current official documentation.

---

# 30. Security Testing

Required checks:

- no key in JS bundle
- no key in URL
- no key in logs
- no key in analytics
- no key in error traces
- no key in snapshot
- no key in PDF
- no key in XLSX
- no key in benchmark
- no key in support bundle

Repository scan before submission:

```bash
git log --all --oneline -- .env
git log --all -p -S"crtfc_key"
grep -R "crtfc_key\|OPENDART_API_KEY" . --exclude-dir=node_modules
```

If a historical commit exposed a key, revoke and rotate it.

---

# 31. Competition Demo Strategy

## 31.1 Primary flow

1. Open app.
2. No login.
3. `체험 모드` is active.
4. Select 대한전선.
5. `순차입금 → 질의하기`.
6. Ask `2026년 반기 순차입금은?`.
7. Show result.
8. Show policy label.
9. Expand calculation.
10. Click a source value.
11. Open evidence.
12. Open DART source.
13. Ask `2025년 반기와 비교해줘.`
14. Show separate 2025 H1 retrieval.
15. Export PDF.
16. Export XLSX and show actual formulas.
17. Ask PER.
18. Show definition-only refusal.
19. Ask `현금을 0원으로 가정하고 계산해줘.`
20. Show refusal.
21. Switch to My Key mode and show the user credential workflow.

## 31.2 Reproducible refusal cases

Do not fabricate missing data in the demo.

Use real reproducible cases:

- PER/PBR without market data
- unsupported financial institution
- pre-2015 period
- unavailable CFS
- ambiguous company
- `cash = 0` instruction
- source/API error

---

# 32. Test Architecture

Four layers:

1. unit
2. integration
3. golden benchmark
4. browser E2E

Golden benchmark truth must be independently prepared by a human from source documents.

---

# 33. Minimum Test Matrix — 133 Checks

## OpenDART fields

1. H1 IS current cumulative uses `thstrm_add_amount`
2. H1 IS current 3-month uses `thstrm_amount`
3. H1 IS prior-year cumulative uses `frmtrm_add_amount`
4. H1 IS prior-year 3-month uses `frmtrm_q_amount`
5. annual IS current uses `thstrm_amount`
6. annual IS prior uses `frmtrm_amount`
7. BS uses point-in-time value
8. CF fixture semantics validated
9. CIS interim semantics validated
10. account_id retained

## Periods

11. December fiscal year
12. March fiscal year
13. June fiscal year
14. H1 start derived
15. H1 end derived
16. Q1 cumulative
17. Q3 cumulative
18. Q2 single quarter
19. point-in-time balance
20. same-period prior-year retrieval
21. H1 vs prior fiscal-year-end distinction
22. pre-2015 refusal
23. snapshot latest determinism

## Filing lineage

24. original filing
25. corrected filing precedence
26. supersedes relation
27. restated comparative relation
28. correction/restatement distinction
29. restated trend label
30. original historical filing retained

## Company / industry

31. exact company
32. ticker
33. alias
34. ambiguous company
35. financial institution refusal
36. unsupported industry
37. CFS unavailable does not auto-switch OFS

## Availability

38. reported
39. absent in complete statement
40. unavailable
41. allowed-zero
42. unavailable debt input refusal
43. incomplete statement zero-substitution blocked

## Mapping

44. XBRL exact
45. exact account name
46. alias exact
47. distractor rejection
48. ambiguous mapping refusal
49. unmapped refusal
50. account detail/member handling

## Net debt

51. complete debt group
52. multiple bond types
53. current/long-term bond combination
54. convertible bond
55. exchangeable bond
56. bonds with warrants
57. lease excluded
58. lease included variant
59. cash missing
60. absent debt member zero handling
61. short-term financial assets policy
62. fair-value asset exclusion
63. policy label
64. lineage completeness

## Ratios

65. ROE CFS owner-attributable numerator
66. ROE OFS numerator
67. ROE average current/prior equity
68. ROE H1 non-annualized label
69. ROE invalid denominator
70. ROA average assets
71. ROA basis consistency
72. debt ratio
73. current ratio
74. quick ratio
75. asset turnover
76. inventory turnover
77. receivables turnover
78. CCC day-count

## Profit/cash

79. operating margin
80. gross margin
81. net margin
82. CAPEX policy gate
83. FCF same-period alignment
84. FCF lease policy
85. EBITDA source policy gate
86. lease-normalized EBITDA separation
87. interest-expense source
88. financial costs not substituted for interest
89. reported EPS preference
90. calculated EPS separate ID
91. PER refusal
92. PBR refusal

## Output/evidence

93. every input evidence
94. no synthetic citation
95. locator honesty
96. corrected label
97. snapshot/live label
98. valueKind
99. displayValue integrity
100. unit integrity
101. sign integrity
102. period integrity
103. basis integrity
104. narrative mutation detection

## Export

105. Korean PDF
106. PDF formula
107. PDF evidence
108. actual XLSX formulas
109. cached values
110. LibreOffice recalculation
111. sources-sheet consistency
112. PDF no key
113. XLSX no key

## Credential/security

114. key format
115. invalid key not persisted
116. key absent from URL
117. key absent from logs
118. key absent from analytics
119. key absent from support artifacts
120. sessionStorage default
121. localStorage opt-in
122. no production shared fallback
123. snapshot makes zero live calls
124. 012 explanation
125. 020 explanation

## Agent/adversarial

126. “cash is zero” refusal
127. arbitrary financial number rejected by schema
128. other-company input rejected
129. latest resolves explicit selected filing
130. “삼성” ambiguity
131. unit rewriting blocked
132. unsupported metric refusal
133. identical request deterministic

The target is **133 checks**, not 126. New tests may be added without reducing coverage.

---

# 34. Benchmark Dataset

Minimum:

- 50 total benchmark questions
- 30 real company/period questions
- 10 adversarial questions
- 10 refusal/edge cases

Each record:

- question
- company
- corpCode
- period
- basis
- metricId
- expected status
- expected value
- expected display text
- expected formula
- expected evidence IDs
- tolerance
- refusal code if applicable

Ground truth must be independently prepared from source documents.

---

# 35. Agent Instruction Principles

1. Resolve company, metric, period, basis.
2. Use canonical retrieval APIs.
3. Never send authoritative financial values supplied by the user into `calculateMetric`.
4. Never invent missing data.
5. Never use a metric whose registry flag is false.
6. Never mix CFS/OFS.
7. Never treat absence as zero unless explicitly permitted and completeness has been proven.
8. Preserve API `displayValue` and `displayText` exactly.
9. Preserve period, basis, and policy labels.
10. Do not annualize interim ratios unless policy allows it and the user asks.
11. Cite only returned evidence.
12. Distinguish source errors from calculation refusals.
13. Ask one clarification when necessary.
14. Do not turn an unsupported result into an estimate.
15. Do not provide generic investment recommendations as a substitute for disclosure analysis.

---

# 36. Change Management

Any change to:

- formula
- account mapping
- XBRL identifier
- period semantics
- availability policy
- accounting policy
- source selection
- rounding rule

creates a versioned change and reruns the applicable regression suite.

Never silently change the meaning of a historical formula ID.

---

# 37. What Not To Build

Do not prioritize:

- login systems
- social features
- trading signals
- opaque AI confidence scores
- decorative avatars
- generic market news chat
- client-side DART calls
- shared public API credentials
- duplicate engines

---

# 38. Future Extensions

After the evidence-first core is stable:

- XBRL semantic graph
- anomaly detection
- accounting change detection
- debt maturity analysis
- covenant analysis
- peer benchmarking
- management commentary linkage
- multi-company portfolio analysis

---

# 39. Definition of Done

The system is competition-ready only if:

- web demo is primary and login-free
- snapshot mode works without OpenDART registration
- live mode works with the user's own key
- shared production key fallback is removed
- key handling is secret-safe
- H1 income statement cumulative values are correct
- cash-flow semantics are separately validated
- fiscal calendar is company-specific
- filing corrections/restatements are separated
- CFS/OFS are isolated
- absent/unavailable inputs are separated
- debt is grouped correctly
- ROE/ROA definitions are explicit
- CAPEX/FCF policies are validated before activation
- institution-specific guardrails exist
- result status and refusal are unified
- every result has evidence lineage
- narrative cannot mutate canonical numeric output
- PDF and XLSX exports pass tests
- 100+ mandatory checks pass for enabled scope
- benchmark truth is independently verified
- adversarial tests pass
- ChatGPT integration is optional and platform-neutral

---

# 40. Official Source Notes

## OpenDART

The official single-company full financial statements guide documents:

- endpoint `fnlttSinglAcntAll`
- `CFS`/`OFS`
- statement types
- `account_id`
- `rcept_no`
- report codes
- interim amount fields
- 2015 onward availability
- official error codes

In particular, OpenDART states that for interim filings and IS/CIS rows, `thstrm_amount` is the 3-month amount while cumulative values are provided separately through `thstrm_add_amount`; prior-year interim/current comparative fields are separately represented.

OpenDART terms state that the credential is individually assigned and that members must not allow a third party to use the credential; the service is also quota-limited.

## OpenAI

At the time of this specification, OpenAI states that custom GPTs are scheduled for retirement on December 11, 2026, that migration timing varies by account/workspace, and that custom actions do not automatically transfer. The architecture therefore keeps the web application as the primary demo and treats ChatGPT integration as a replaceable client surface.

---

# 41. User Guide Requirements

The public user guide must:

1. use one product name consistently: **DART Navigator**
2. state that it is not an FSS/OpenDART official service
3. start with demo snapshot mode
4. explain OpenDART key issuance
5. explain live-mode key entry
6. explain session-only vs persistent storage
7. explain official error codes
8. explain IP-restricted keys
9. state that the service does not share one public key among users
10. include screenshots only after the UI is actually implemented
11. remove developer-only `.env` fallback language
12. include limitations and non-investment-advice disclaimer
13. link only to official OpenDART pages
14. never print an example credential

---

# 42. Final Product Message

> **DART Navigator is not a chatbot that guesses financial numbers.**
>
> **It finds the right disclosure, applies the right period and accounting basis, calculates with a deterministic formula, validates the result, and shows where every number came from.**
