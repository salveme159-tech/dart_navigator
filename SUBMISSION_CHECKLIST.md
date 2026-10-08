# Disclosure Navigator - Submission Checklist

## Before 2026-10-30

- [ ] Deploy the web application over HTTPS.
- [ ] Confirm the landing page opens directly without login.
- [ ] Confirm Demo Snapshot mode performs no OpenDART API call.
- [ ] Confirm the exact demo prompts replay the intended fixture only.
- [ ] Confirm an unrelated company question is refused in demo mode rather than returning a wrong fixture.
- [ ] Confirm OpenDART key entry validates a real 40-character key.
- [ ] Confirm live queries use the user's key and not a shared production fallback.
- [ ] Confirm no key appears in browser screenshots, PDF, XLSX, errors, or application logs.
- [ ] Confirm half-year revenue/profit uses DART cumulative fields.
- [ ] Confirm EPS cumulative requests never silently fall back to 3-month values.
- [ ] Confirm ROE/ROA interim labels state that the result is not annualized.
- [ ] Confirm unsupported metrics do not expose an active `질의하기` action.
- [ ] Confirm net debt requires a complete reconciled balance sheet before treating a missing debt group as zero.
- [ ] Confirm net debt parent/detail bond rows are not double counted.
- [ ] Confirm DART evidence links open the relevant financial-statement subdocument when available.
- [ ] Confirm generated XLSX opens in Excel or LibreOffice and derived cells retain formulas and cached values.
- [ ] Confirm three headline demo flows on a fresh browser profile.
- [ ] Confirm `pnpm install --frozen-lockfile && pnpm check && pnpm test && pnpm build` succeeds in the deployment environment.

## Judge-facing story

**Find -> Calculate -> Verify -> Prove -> Export**

The differentiator is deterministic financial analysis with evidence lineage and correct refusal behavior, not generic chat quality.
