# Test fixtures

Files the app ingests, for local development and manual testing **only**. Nothing
here ships, and nothing here is read by application code at runtime — these exist
to be picked from a file dialog while exercising an import screen.

| Folder | Feeds | Format |
|---|---|---|
| `data-migration/` | Settings → نقل البيانات (the go-live wizard) | `.xlsx`, one sheet per step |
| `bank-statements/` | Treasury → تسوية كشوف البنك | `.csv` |
| `images/` | Company logo, and anywhere an image is accepted | `.png` |

## Regenerating

The workbooks are **generated, not hand-authored**:

```bash
pnpm --filter @mezan/ui exec tsx scripts/build-test-fixtures.ts
```

The generator (`packages/ui/scripts/build-test-fixtures.ts` — it lives there
because that is where `exceljs` resolves) imports `STEPS` from
`apps/web/src/settings/data-migration-steps.ts`
— the same spec the wizard parses uploads against. A hand-copied fixture would
drift the first time a column changed, and the import would then fail for a
reason that looked like a product bug rather than a stale file. Re-run it after
changing any step's columns.

## Rows

Each workbook carries several rows, not one, and deliberately includes values
that exercise the validation path — a duplicate code, a malformed date, a
negative quantity — so the preview step has errors to report. Importing one of
these should NOT be silently clean; that is the point.

The party and item ids referenced match the demo seed
(`packages/backend/src/demo-seed/`), so an import can be run against a seeded
tenant and resolve to real records.
