# Disclosure Navigator - Competition Submission Upgrade

## 2026-10-08 validation revision

### Demo
- Replaced broad hardcoded demo matching with exact deterministic snapshot fixtures.
- Demo answers are labeled as preloaded snapshots, never as live or verified API results.
- Added an explicit refusal fixture for net debt rather than fabricating live evidence.

### Financial data correctness
- Half-year / quarter income statement and cash-flow cumulative requests use `thstrm_add_amount`.
- Balance sheet values always use point-in-time fields.
- ROE / ROA use current and prior period ending balances; interim results are not annualized.
- EPS refuses silent fallback to the 3-month amount when cumulative data is requested.
- Interest coverage uses explicit interest expense only.
- Net debt distinguishes reported, absent-in-complete-statement, and unavailable input states.
- Net debt excludes lease liabilities and defined bond-accounting adjustment rows; parent/detail rows are deduplicated.

### Export
- PDF uses `window.print()` with print CSS.
- XLSX export writes actual spreadsheet formulas and cached values.
- Formula cell references were corrected and validated with openpyxl.

### Security / deployment
- User OpenDART key is passed in `x-opendart-key`.
- Production shared-key fallback is disabled unless an explicit non-production `ALLOW_DEV_KEY=true` flag is set.
- API keys are not logged, persisted server-side, or included in exports.
- Request rate limit and payload limits are applied to the public tRPC surface.
- DART receipt numbers are validated as 14-digit values.

### Cleanup
- Removed template OAuth/database/Manus/debug runtime residue from the production source.
- Standardized product name to `Disclosure Navigator`.

## Remaining deployment check
Run in an environment with dependencies and network access:

`pnpm install --frozen-lockfile`
`pnpm check`
`pnpm test`
`pnpm build`
