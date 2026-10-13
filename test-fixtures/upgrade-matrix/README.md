# Upgrade matrix — books written by earlier builds

`packages/backend/src/upgrade-matrix.test.ts` opens every `*.db.gz` here with the
current code and asserts that it opens, that every upgrade step runs once and a
second open changes nothing, that the control accounts, the trial balance, the
stock positions and the audit chain hold afterwards, and that a failed upgrade
leaves the file as it was. A fixture is never opened in place: the test unpacks
it into a temporary directory first.

Each file is the **whole SQLite database** the named commit wrote, not a dump: its
own schema, its own indexes and its own `PRAGMA user_version`. It was produced by
that commit's own `createBackend({ seedDemoData: true })` in a scratch clone, then
`PRAGMA journal_mode = DELETE; VACUUM;` and `gzip -9 -n`. Raw, the three files are
8.8–11.5 MB; compressed, 1.3–1.8 MB each.

| Fixture | Source commit | Commit date | `user_version` | What it covers |
|---|---|---|---|---|
| `2026-09-14-dd151ec1.db.gz` | `dd151ec1` (tag `saas-complete-2026-09-14`) | 2026-09-14 | 0 | before the version stamp, before `bank_statement.branch_id` and `import_fingerprint` (2026-09-20), before a bounced cheque went back onto the customer (2026-09-18), before the audit chain |
| `2026-09-24-bff272ac.db.gz` | `bff272ac` | 2026-09-24 | 1 | schema 1 with the audit chain, before the branch dimension on approvals and journal lines |
| `2026-10-13-1a59ef4e.db.gz` | `1a59ef4e` | 2026-10-13 | 1 | the last commit before schema version 2 (`c5aa5107`) |

`*.audit-chain.key` is the per-install key the same run minted beside its
database (`packages/persistence/src/audit-sink.ts`). It signs nothing but that
fixture's own audit chain head and exists so `/audit/verify` can be asserted;
the September 14 build had no chain and so has no key.

The demo seed dates some documents relative to the day it runs, which for all
three was 2026-10-13.

## What the old builds left that an upgrade does not change

The two September fixtures hold six stock movements that those builds stamped
with the confirm clock instead of the document date (`LC-DEMO-1`, `PRT-DEMO-1`,
`PRET-DEMO-1`, `SRT-DEMO-1`, `SRET-DEMO-1`, `SRET-DEMO-2`). The stock ledger is
append-only, so they keep that date; the reconciliation lists them and the test
asserts the list is exactly those six and never grows.

## Regenerating, or adding a build

```bash
git clone --no-checkout . /tmp/mezan-old && cd /tmp/mezan-old
git checkout --detach <commit> && CI=true pnpm install --prefer-offline --ignore-scripts
# in apps/server: createBackend({ dbPath, seedDemoData: true, resolveEntitlements: every module, 60 seats })
sqlite3 mezan.db "PRAGMA journal_mode = DELETE; VACUUM;"
gzip -9 -n -c mezan.db > test-fixtures/upgrade-matrix/<date>-<commit>.db.gz
```

Add a fixture whenever `CURRENT_SCHEMA_VERSION` is bumped, taken from the commit
before the bump.
