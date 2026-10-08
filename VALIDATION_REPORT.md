# Disclosure Navigator validation report

Date: 2026-10-08

## Checked
- All production `.ts`/`.tsx` files transpile successfully with TypeScript syntax diagnostics disabled for type resolution.
- Engine targeted checks: half-year cumulative field selection, BS point-in-time field selection, period mode parsing, ROE denominator guard, net-debt complete-BS rule, bond parent/detail de-duplication, unsupported metric refusal, 2015 floor, multi-company ambiguity guard.
- XLSX export inspected with openpyxl: derived result cells contain real spreadsheet formulas and cached numeric values.
- No `Manus`, OAuth template, or deleted `publicConfig` references remain in production source.
- No real API key is included in the repository tree.

## Not fully executable in this environment
`pnpm install` / full Vite production build could not be run because package installation/network access is unavailable in the execution environment. A final deployment environment must run:

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

## Competition demo policy
- Demo Snapshot is deterministic and does not call OpenDART API endpoints.
- Live OpenDART requires the user's own 40-character key.
- Production shared-key fallback is disabled unless `ALLOW_DEV_KEY=true` is explicitly enabled in a non-production development environment.
