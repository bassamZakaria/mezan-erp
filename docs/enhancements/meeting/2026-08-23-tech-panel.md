# Mezan (ميزان) — Tech Stakeholder Panel (Beyond Parity)

> **Meeting date:** 2026-08-23 · **Half:** TECH (the engineering counterpart to the business-persona meeting captured in `requirements.md`).
> **Frame:** parity is on `main`; enhancements live only on `feature-enhancements`, which tracks `main`. This panel channels seven engineering voices — security, ops, on-call, reviewer, tester, team-lead, tech-writer — and turns each one's concerns into concrete hardening/enhancement requirements grounded in the *actual* codebase as it stands on this branch.
>
> **Grounding:** `docs/plan.md` (architecture: one TS core, Hono, Drizzle, SQLite/Electron, Ed25519 licensing, LAN multi-till), `docs/enhancements/{requirements,backlog,workflows}.md`, and a read of the tree at `53577b3`.
>
> **Sizing legend:** S = ≤1 week · M = 1–3 weeks · L = 3–6 weeks · XL = >6 weeks (multi-engineer). Sizes are relative to the already-built parity module. **Every `TECH-###` item is a candidate, not a commitment** — it needs a team call before it becomes a tracker ticket.
>
> **ID scheme:** `TECH-Snn` security · `TECH-Onn` ops · `TECH-Nnn` on-call · `TECH-Rnn` reviewer · `TECH-Tnn` tester · `TECH-Lnn` team-lead · `TECH-Wnn` tech-writer. Where a tech item hardens or blocks a business enhancement, it cross-references the `ENH-###` from `requirements.md`.

---

## Codebase reality check (what this panel is reacting to)

Facts established by reading the branch, because every voice below is grounded in them rather than in the plan's aspirations:

- **Persistence is SQLite-only.** `packages/persistence/src/` contains `schema.ts` and `sqlite-connection.ts` — there is **no `schema.pg.ts`, no dual-dialect codegen, no `SqlDialect` shim**. The dual-engine conformance suite that `plan.md` §2.2/§2.7 calls "the core safety net" and "non-negotiable from day one" **does not exist yet**. This is a deliberate v1 scope cut (`plan.md` §"v1 Scope": Postgres/dual-engine deferred) — but it means the cloud edition's central guarantee is unproven, and every query written today is written against one engine's behaviour.
- **The document framework is used by 3 stores out of ~27.** Only `inventory-ops-store.ts`, `physical-count-store.ts` (and the barrel `index.ts`) consume `framework-document-store.ts`; the other ~24 (`crm-store.ts`, `fixed-assets-store.ts`, `cheque-repository.ts`, `bank-reconciliation-repository.ts`, …) are bespoke. Two persistence idioms coexist.
- **The SQLite cross-connection deadlock was real and is fixed** (`plan.md` build status; `packages/persistence/src/sqlite-connection.ts` → `openSqliteConnection` WAL + shared `busy_timeout`, `withSqliteTransaction` savepoint re-entrancy). No regression test yet exercises concurrent numbering allocation or LAN multi-till writers.
- **CI is single-job, ubuntu-only, SQLite-only** (`.github/workflows/ci.yml`): typecheck → lint → `vitest` (SQLite) → build. Playwright E2E is a **separate `continue-on-error: true` job**, Chromium-web only. `ELECTRON_SKIP_BINARY_DOWNLOAD=1` everywhere — **Electron never launches in CI**, so backup/restore and the IPC adapter are never exercised end-to-end, despite `plan.md` §3.7 promising "restore is E2E-tested every release."
- **Backup/restore is genuinely built** (`apps/desktop/src/backup/`: archive, manifest, checksum, retention, pre-migration-hook, restore-service — each with a `.test.ts`). Good foundation; it is just not wired into a release gate.
- **Licensing exists** (`packages/domain/src/licensing/`: `license.ts`, `encoding.ts`, `ports.ts`; Ed25519; `entitlements.ts` in the desktop main; clock-rollback vocabulary present in `licensing/` and `backup-hooks.ts`).
- **Audit is append-only but not tamper-evident.** `packages/persistence/src/audit-sink.ts` and `packages/domain/src/audit` exist; **no hash-chain / `prevHash` / tamper-evidence** anywhere. `ENH-050` (immutable searchable audit ledger) is a *net-new* substrate, not an extension of what's there.
- **No `docs/runbook/`, no admin/deploy guide, no user manual (AR or EN).** `docs/` is planning and catalog material only.

These seven facts are why the panel exists. Each persona now speaks to them.

---

## P-SEC — Security (offline license tamper-resistance · data-at-rest · audit · secrets · supply-chain)

> Lens: the desktop edition ships financial data onto a machine we do not control, gated by a client-side check we cannot fully trust, with no server behind it. The threat surface is *the customer's own disk and the customer's own clock.*

**Top concerns**

1. **Data-at-rest is plaintext.** The SQLite file, the attachment blobs under `{userData}/files/`, and the backup archives are readable by anyone with the machine. For an ERP holding salaries, margins, and customer PII this is the single largest exposure. `plan.md` seals the *session token* with `safeStorage` but says nothing about sealing the *database*.
2. **License verification is bypassable and centralised in JS** — accepted by `plan.md` §6.2, but the mitigation ("keep it tiny and centralised") has to actually hold. If entitlement checks leak into 40 call sites, hardening later is impossible.
3. **Audit trail is append-only but not tamper-evident** — a determined insider with disk access can rewrite `audit-sink` rows. For a compliance product that's a credibility hole (and exactly what `ENH-050` promises but hasn't built).
4. **Supply-chain: pure-JS crypto + native `better-sqlite3` + Electron/Chromium** — three very different patch cadences, no SBOM, no pinned-and-verified dependency policy visible.
5. **Secrets:** ETA credentials, optional cloud-backup credentials (Google Drive/OneDrive/S3 per `plan.md` §3.7), and SMTP live somewhere on desktop — must be `safeStorage`-sealed and write-only, never in the DB in clear, never in logs.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-S01 | **Data-at-rest encryption for the SQLite file + attachments + backups.** Adopt SQLCipher (or an app-layer envelope) with the key sealed in OS keychain via `safeStorage`; key never in the DB or a backup manifest. First-run and restore flows provision/unseal the key. | Turns a stolen laptop from "full books leaked" into "encrypted blob." Table-stakes for salaries/PII. | L |
| TECH-S02 | **Tamper-evident audit ledger (hash-chain).** Extend `audit-sink.ts` so each row carries `prevHash`+`rowHash` (SHA-256 over canonical payload); a verify pass detects any insert/edit/delete. This is the substrate `ENH-050` needs — build it here, not as app sugar. | Makes the audit trail *evidence*, not just a log. Directly enables ENH-050/ENH-052. | M |
| TECH-S03 | **Confine the entitlement check to one port + assert it.** Keep every gate reading `entitlements.has(...)` (per `plan.md` §2.5); add a lint/CI rule that fails if `licensing`/`entitlements` internals are imported outside the one port. Add clock-rollback proof: persist `highestSeenUtc` in `safeStorage` and cover it with a rollback test. | Keeps license hardening a one-file job later; closes the "set the clock back" free-time hole. | M |
| TECH-S04 | **Secrets vault + log-redaction pass.** Route ETA/SMTP/cloud-backup credentials through one sealed store; add a redaction layer + a test that greps logs/error payloads for token-shaped strings. | No credential ever lands in the DB clear or in a support screenshot. | S–M |
| TECH-S05 | **Supply-chain gate:** SBOM (CycloneDX) per release, `pnpm audit`/OSV in CI as a blocking check, pinned lockfile with integrity, and a documented Electron/Chromium patch-tracking cadence (Chromium ships its own attack surface). | Known-CVE Chromium in a shipped desktop app is a real, recurring risk; catch it before release. | M |
| TECH-S06 | **Restore-path trust boundary.** A backup archive is executable trust — restoring one loads arbitrary rows. Verify manifest signature + checksum (already have `checksum.ts`/`manifest.ts`) *and* reject archives whose schema/app version is newer than the running app before mounting. | Stops a malicious/corrupt archive from becoming a code-path or data-integrity incident. | S |

**If the change is clean, say so:** the money layer (scaled int64, `money.ts`/`qty.ts`) and the single-write-path numbering engine are the right shape and I have no findings there. My findings are all at the *storage and trust* boundary, not the arithmetic.

---

## P-OPS — Ops / SRE (packaging · signing · notarization · auto-update · backup ops · telemetry · install/upgrade)

> Lens: what happens on install day, on upgrade day, and on the day a shop with a 5-year SQLite file opens a report at 9am. There is no ops team behind a desktop install — the *installer and the upgrader* are the ops team.

**Top concerns**

1. **The release pipeline promised in `plan.md` §2.7/Phase 8 does not exist.** CI is ubuntu-only, no Windows/mac runners, no code-signing, no notarization, no `electron-updater` artifacts, `ELECTRON_SKIP_BINARY_DOWNLOAD=1`. We cannot currently produce a signed installer for any OS. This is the biggest gap between plan and repo.
2. **Upgrade-migration safety is unproven at the pipeline level.** `plan.md` §2.3 wants "restore an old SQLite fixture, migrate to head" in CI. Not present. A desktop install can be many versions behind; a bad forward migration on launch is a data-loss event.
3. **No telemetry, by design (offline-first) — but that means zero fleet visibility.** We won't know an install is on a broken version, out of disk, or failing nightly backups. `ENH-063` (system-health console) is the *only* eyes we'll have; ops needs to shape it.
4. **Backup is built but not *operated*.** Retention (`retention.ts`) and scheduling exist; there's no proof backups actually run on a customer machine, no "last successful backup" surfaced, no off-device verification.
5. **SQLite performance at 5-year scale** (`plan.md` §6.2) — no seeded large-dataset perf fixture in CI; report latency is unmeasured.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-O01 | **Release pipeline on a matrix (win/mac/linux):** `electron-rebuild` for `better-sqlite3` per ABI, Windows EV code-signing, macOS notarization, Linux AppImage/deb, `electron-updater` channels gated by `updateChannelUntil`. Prove it on the current stub app first (cheaper than at first real release, per `plan.md` §7.5). | Without this there is no shippable product. De-risks the single hardest release chore early. | L |
| TECH-O02 | **Migration-upgrade test in CI:** restore a committed old SQLite fixture → migrate to head → run the ledger self-audit. Wire the existing `pre-migration-hook.ts` backup into the launch upgrade path. | Turns "upgrade might corrupt the books" into a gated invariant. | M |
| TECH-O03 | **Operated backups + surfaced status.** Scheduler runs default daily + on close (`plan.md` §3.7); surface "last successful backup / next run / off-device copy age" in-app; alert on N missed backups. Hardens `ENH-060`. | Backups that silently stopped are the classic desktop disaster; make silence visible. | M |
| TECH-O04 | **System-health & multi-till console telemetry contract** (shapes `ENH-063`): per-till connectivity, offline-queue depth, DB size, backup status, license/seat usage, app version — all **local/LAN only**, no phone-home, preserving offline-first. | The only fleet visibility a self-hosted product gets; ops-defined so it's actionable, not decorative. | M |
| TECH-O05 | **Seeded 5-year perf fixture + k6/report-latency budget in CI** (e.g. GL and heavy ledger reports `<2s` p95 on the large SQLite file). | Catches the "app becomes unusable for established businesses" regression before a customer does. | M |
| TECH-O06 | **Install/upgrade observability without a server:** structured local log with rotation, a one-click "export diagnostics bundle" (versions, migration history, integrity-check result, last errors — secrets redacted per TECH-S04). | Gives support something to ask for besides a screenshot; feeds on-call's forensics. | S–M |

**Migration risk, stated per the ops lens:** every schema change on a desktop file is a forward-only, additive-preferred change against a DB that may be years old and full of real books. Additive columns and backfill-on-read beat destructive rewrites every time; TECH-O02 is the gate that enforces it.

---

## P-ONC — On-call (crash reporting · diagnostics · safe-mode · DB corruption recovery)

> Lens: I carry the (metaphorical) pager for a fleet of machines I can't SSH into. My fear is a shop that can't open the till at 9am and a support call with nothing but "it's broken."

**Failure-mode table**

| What breaks | User sees | On-call signal (today) | Fix path we need |
|---|---|---|---|
| SQLite file corrupted (bad shutdown, disk error) | App won't open / reports wrong | **None** — no crash report, no integrity signal | Safe-mode boot + `PRAGMA integrity_check` + guided restore (TECH-N01/N02) |
| Forward migration throws on launch | App bricked mid-upgrade | Pre-migration backup exists but no auto-rollback surfaced | Auto-rollback to pre-migration backup + clear message (TECH-N03) |
| Cross-connection deadlock regresses (`SQLITE_BUSY`) | Confirm hangs/fails | Was invisible until the bug-hunt found it | Regression test (TECH-T0x) + a "busy/lock" diagnostic counter |
| Offline ETA queue silently stops forwarding | Legal deadline missed | No age-of-oldest-unsent surfaced | Unsent-queue age alert (ties ENH-011b, `plan.md` §5.5) |
| Desktop scheduler misses month-end (shop closed a week) | Accruals/depreciation unposted | Catch-up semantics claimed (`plan.md` §3.5) but unproven | Catch-up idempotency test + "jobs skipped/caught-up" log line |
| LAN till loses the host | Till dead, no writes | Invisible until someone notices | Health console (ENH-063 / TECH-O04) |

**Top concerns**

1. **There is no runbook directory and no crash reporting.** A desktop crash today produces nothing an engineer can read.
2. **No safe-mode.** If the DB or a migration is bad, the user has no way to boot far enough to reach backup/restore.
3. **DB corruption recovery is undocumented** despite backup/restore being built — recovery has to be a *guided in-app flow*, not "find your backup folder and hope."

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-N01 | **Safe-mode boot:** if DB open / migration / integrity check fails, launch a minimal shell that can *only* run integrity-check, list backups, and restore. | The difference between "guided 10-minute recovery" and "shop is down, call the vendor." | M |
| TECH-N02 | **Startup DB health gate:** `PRAGMA integrity_check` + ledger self-audit (trial balance nets to zero; sub-ledgers = control accounts, per `plan.md` §3.7) on launch/schedule, surfaced in `/accounting/reconciliation`; auto-trigger safe-mode on failure. | Detects corruption before the user posts onto a broken file. | S–M |
| TECH-N03 | **Auto-rollback on failed migration:** wrap the launch upgrade in the pre-migration backup (`pre-migration-hook.ts`) with automatic restore-and-report if migration throws. | No bricked install from a bad upgrade — the highest-severity 3am page. | M |
| TECH-N04 | **Local crash reporting + correlation id:** capture main/renderer crashes to a local rotating file with a request/correlation id threaded through the IPC adapter, folded into the diagnostics bundle (TECH-O06). | Every incident becomes reconstructable from one machine's logs alone — the only forensics we get offline. | M |
| TECH-N05 | **Runbook seeds (`docs/runbook/`):** one page per pageable failure above — symptom → likely cause → verification command (`PRAGMA integrity_check`, ledger self-audit, queue-age query) → recovery/rollback. | Turns tribal knowledge into a checklist; prerequisite for anyone but the author being on call. | S |

**Blast radius (one paragraph):** the two things that must never go down are *posting* (the business stops) and *the backup subsystem* (recovery becomes impossible). Everything else can degrade. The desktop edition has one process, so a crash in the report engine can take the whole app with it unless report execution is isolated and failing-report-safe. There is no feature-flag system to turn a bad feature off without a deploy (`plan.md` has none) — so a bad release *is* the incident, which makes TECH-O01's signed-update rollback channel an on-call tool, not just an ops nicety.

---

## P-REV — Reviewer (architecture debt · document-framework vs bespoke inconsistency · dual-engine conformance · test gaps)

> Lens: I keep "one core, two products" a structural fact rather than an aspiration (`plan.md` §3.2). I care about the debt that will make the *cloud* edition a rewrite instead of an addition.

**Top concerns**

1. **The document-framework/bespoke split is real and quantified: 3 of ~27 stores use `framework-document-store.ts`.** Two persistence idioms coexist. New modules land bespoke because that's the local majority, so the framework's leverage (uniform effects/hooks/audit/numbering) is unrealised and the divergence widens. This is the top architecture-debt item.
2. **The dual-engine safety net does not exist.** `plan.md` calls it "non-negotiable from day one" (§2.2/§2.7/§6.2) and it's the guarantee the whole cloud story rests on — yet persistence is SQLite-only, and every query is written against SQLite semantics (`LIKE ... COLLATE NOCASE`, FTS5, `BEGIN IMMEDIATE`, no `RETURNING`/window-fn assumptions checked). The longer we defer it, the more dialect-specific code accretes silently. **The debt compounds daily even though the work is descoped.**
3. **Domain-boundary erosion risk:** the rule "`packages/domain` imports no `api`/`persistence`/`node:*`" is only as good as its enforcement. Lint runs in CI (`pnpm lint` = layer boundaries) — good — but the entitlement/licensing confinement (TECH-S03) isn't a boundary rule yet.
4. **Test gaps concentrate where refactors are riskiest:** concurrency (no numbering-under-contention or LAN-writer test), the IPC-vs-HTTP adapter parity (`plan.md` §2.7 wants byte-identical — no such test), and golden-ledger breadth.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-R01 | **Converge on the document framework: decide and enforce.** Either migrate bespoke stores onto `framework-document-store.ts` (uniform effects/hooks/audit/numbering) or formally scope the framework to document-shaped entities and document why the ~24 others are bespoke. Add an ADR so new modules pick the right idiom by rule, not by copy-paste. | Stops the split widening with every new module; unlocks the framework's ~24× leverage or honestly retires it. | L (migration) / S (ADR + boundary) |
| TECH-R02 | **Dual-engine conformance harness — even while Postgres ships later.** Introduce the `SqlDialect` capability shim now and route the divergent bits (upsert, `RETURNING`, `LIKE`/`ILIKE`, JSON, locking) through it, so today's SQLite code is dialect-aware by construction. Add the pg codegen + conformance matrix when cloud starts. | Prevents the cloud edition from being a query rewrite; makes "additive, not rewrite" true. Cheapest now, brutal to retrofit (`plan.md` §4 Phase 0). | L |
| TECH-R03 | **Adapter-parity test:** the same command through the HTTP adapter (`apps/server`) and the IPC adapter (`apps/desktop`) returns byte-identical payloads (`plan.md` §2.7). | Guarantees the React data layer's "one implementation, swappable fetch" assumption holds. | M |
| TECH-R04 | **Effects/invariant conformance across stores:** a shared test kit asserting every posting path is atomic (document + stock + cost layer + journal in one `withSqliteTransaction`) and every sensitive mutation emits an audit event — run against all ~27 stores, not just the framework three. | Catches the "bespoke store forgot the journal / forgot the audit row" class before it's a customer's wrong books. | M |
| TECH-R05 | **Boundary lint for entitlement + secrets** (supports TECH-S03/S04): fail the build if `licensing`/`entitlements`/secret stores are imported outside their ports. | Makes the plan's "tiny centralised verification surface" a checked invariant, not a hope. | S |

**Review verdict:** the foundations I can see (money value objects, single-write numbering, the concurrency fix in `sqlite-connection.ts`, append-only journals) are sound — I'm not flagging the engine. My criticals are all *architectural drift* items: the framework split (TECH-R01) and the missing dialect abstraction (TECH-R02) are the two that decide whether the cloud edition is additive or a rewrite.

---

## P-TST — Tester (E2E coverage · golden-ledger fixtures · RTL/print regression · migration testing)

> Lens: real SQLite, no DB mocking (mocks masked migration drift once — `plan.md` §2.7). I run the narrowest suite first and I trust green only when green is *gating*.

**Top concerns**

1. **E2E is non-gating.** `.github/workflows/ci.yml` runs Playwright as `continue-on-error: true`, Chromium-web only. A real UI regression turns the job orange, not red — so E2E protects nothing today. And several `test/e2e-*` worktrees are still mid-flight (`plan.md` build status), so the suite isn't consolidated.
2. **No Electron E2E at all** (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`). The IPC adapter, activation/first-run wizard, backup/restore, and `printToPDF` — the desktop-only critical paths — have **zero** end-to-end coverage, contradicting `plan.md` §3.7 ("restore is E2E-tested every release").
3. **Golden-ledger fixtures** (the regression tests that make the accounting engine safe to refactor, `plan.md` §2.7) — unit tests exist per module, but I need a *named corpus* asserted to the exact minor unit: invoice→stock+COGS+AR+VAT, landed-cost distribution, FX revaluation with auto-reversal.
4. **No print/RTL visual regression.** Print bugs are invisible until a customer complains (`plan.md` §2.7); there are no print-view screenshot baselines, and RTL is the top regression class for this app category.
5. **No migration-upgrade test** (see TECH-O02) and **no concurrency test** for the deadlock class that already bit once.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-T01 | **Make E2E gating and consolidate the `test/e2e-*` worktrees** into one deterministic Playwright suite; drop `continue-on-error` for the critical-path specs. | A non-gating suite is theatre; this makes green mean green. | M |
| TECH-T02 | **Electron E2E project:** login/activation, invoice lifecycle, backup→restore round-trip, `printToPDF` snapshot — on a real Electron build in CI (needs TECH-O01's rebuild). | Covers the desktop-only paths that currently have zero E2E, incl. the restore promise. | M–L |
| TECH-T03 | **Golden-ledger fixture corpus** asserted to the minor unit, run in CI on every change; grows with each posting path. Add the dual-engine assertion the day Postgres lands (pairs with TECH-R02). | The safety net that makes refactoring the ledger safe; catches cent-level drift that destroys trust. | M |
| TECH-T04 | **Print + RTL visual regression:** Playwright screenshot baselines for A4/A5 documents, thermal receipt, and label sheets, in RTL *and* LTR; diff on every PR. | Turns invisible print/RTL regressions into a red build instead of a customer complaint. | M |
| TECH-T05 | **Concurrency regression test:** concurrent numbering-sequence allocation + simulated LAN multi-till writers against `withSqliteTransaction`, asserting no gap and no `SQLITE_BUSY` (locks in the `sqlite-connection.ts` fix). | Stops the exact cross-connection deadlock class from silently reappearing (`plan.md` remaining-hardening). | S–M |
| TECH-T06 | **Migration-upgrade + integrity test** (shared with TECH-O02): old fixture → migrate → ledger self-audit passes. | Proves years-old customer files survive an upgrade. | S (once O02 exists) |

**Headline:** the unit layer is in decent shape after the recent backfill pass; the gap is entirely in *gating E2E, desktop coverage, golden fixtures, and visual/print regression* — i.e. the tests that catch the bugs a customer actually sees.

---

## P-LEAD — Team-lead (delivery sequencing · tech-debt paydown · contributor docs)

> Lens: I answer "is it on track?" and I decide what to escalate, nudge, or leave alone. I hate dashboards that look green when they shouldn't — and a `continue-on-error` E2E job is exactly that.

**What I'd act on tomorrow**

1. **Sequence the tech-debt items *underneath* the E1 business phase, not after it.** Two items are load-bearing substrate and must land before the features that depend on them: **TECH-S02 (hash-chain audit)** is a hard prerequisite for `ENH-050`/`ENH-052`, and **TECH-O01 (signed release pipeline)** blocks shipping *anything* — including the E1 backup-drill (`ENH-060`). Pull both into E1.
2. **Close the branch/worktree sprawl.** The repo shows ~20 branches and ~18 worktrees, several `phase*` and `test/e2e-*` mid-flight (`plan.md` build status flags this). This is where "90% done" hides. One reconciliation pass to confirm-landed-or-merge, so the branch list reflects `main`.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-L01 | **Fold the substrate tech items into E1.** TECH-S02 (audit hash-chain) + TECH-O01 (release pipeline) + TECH-R02-shim become E1 exit criteria, since E1's own `ENH-050`/`ENH-060` depend on them. | Prevents building E1 features on substrate that isn't there; removes the biggest hidden dependency. | S (planning) |
| TECH-L02 | **Branch/worktree reconciliation pass:** for each open `phase*`/`test/e2e-*` branch, confirm-landed or merge-or-close; delete stale worktrees. | Kills the "is this done?" ambiguity; makes the release-readiness question answerable. | S |
| TECH-L03 | **Debt register with explicit paydown budget:** track TECH-R01 (framework convergence) and TECH-R02 (dual-engine) as scheduled line items with an owner, not "someday." Both compound daily if unowned. | Converts architecture debt from a wiki bullet into a scheduled decision with a name on it. | S |
| TECH-L04 | **Contributor docs (`CONTRIBUTING.md` + architecture ADRs):** the ports/layer rules, the "which store idiom" decision (TECH-R01), the money/rounding invariants, and the test-discipline (real SQLite, gating E2E). Today a new contributor learns these by reading `plan.md` cover to cover. | Faster, correct-by-default onboarding; stops new modules landing bespoke by accident. | S–M |
| TECH-L05 | **Definition-of-done gate per enhancement:** each `ENH-###` ships only with its golden-ledger fixture (TECH-T03) or E2E (TECH-T02) green, its audit events emitted (TECH-R04), and a doc line (TECH-W0x). | Stops the endless-90%-done failure mode `plan.md` §6.2 warns about. | S |

**Risks I'm watching:** false-green CI (TECH-T01), the two compounding-debt items with no owner (TECH-R01/R02), and scope creep from 28 business enhancements landing before their tech substrate. My asks of product: agree that E1 includes its substrate (TECH-L01), and give TECH-R01/R02 a named owner.

---

## P-DOC — Tech-writer (user manual AR/EN · in-app help · admin/deploy docs · API docs)

> Lens: vocabulary is load-bearing and there is **no user-facing documentation of any kind yet** — `docs/` is all planning/catalog. For an Arabic-first offline product sold to SMBs with no IT staff, the manual *is* part of the product.

**Top concerns**

1. **No user manual, in either language.** An Arabic-first ERP needs an **Arabic-primary** manual (EN secondary), covering the daily loops — invoice, voucher, month-end close, backup/restore. This is a shipping gap, not a nicety.
2. **No admin/deploy guide.** Install, activation (online + air-gapped challenge-response, `plan.md` §2.5), LAN multi-till setup, backup targets, upgrade. IT admins (`ENH-061`/`ENH-063`) have nothing to follow.
3. **No in-app help / empty-state discipline documented.** `plan.md` §5.1 makes the "تأثيرات هذا المستند" effects-explainer a design-system component; there's no glossary keeping *effects*, *reconciliation*, *period lock*, *entitlement* single-named across AR/EN.
4. **API docs:** `ENH-062` promises a documented API "via the emitted OpenAPI doc" — but nothing publishes or human-annotates it yet.
5. **Naming drift risk in the enhancements themselves:** `requirements.md` already mixes *cockpit*/*dashboard*, *glance*/*remote view*, *dunning*/*collections*. Pick one term per concept per language before these become UI strings.

**Concrete requirements**

| ID | Requirement | Value | Size |
|---|---|---|---|
| TECH-W01 | **User manual, Arabic-primary + English:** task-based chapters for the core loops (sales invoice, treasury voucher, month-end close via `ENH-010`, backup/restore via `ENH-060`), screenshots in RTL. | The manual is part of an offline SMB product; reduces support load from day one. | L |
| TECH-W02 | **Admin/deploy guide:** install per OS, online + air-gapped activation, LAN multi-till enrollment, backup targets/retention, safe-mode & restore (TECH-N01), upgrade path. | The only thing standing between an IT admin and a broken rollout; pairs with `ENH-061`/`ENH-063`. | M |
| TECH-W03 | **Bilingual glossary + string-freeze for the enhancements:** one canonical AR/EN term per concept (cockpit, cash-runway, dunning, evidence-pack, SoD…), checked against existing entity field names before they become UI copy. | Stops synonyms leaking into UI/docs; keeps AR/EN consistent. | S |
| TECH-W04 | **In-app help + empty/error copy standard:** wire the effects-explainer as reusable help (`plan.md` §5.1); a copy rule that empty/error states say what to do next ("تعذّر تحميل … أعد المحاولة"), not internal state. | Discoverability without a manual open; fewer "what does this do?" calls. | M |
| TECH-W05 | **API reference from the OpenAPI doc** (enables `ENH-062`): publish + human-annotate the emitted OpenAPI, with auth, webhook events (the event taxonomy), and starter-connector examples. | Makes the integration API usable by third parties without vendor hand-holding. | S–M |
| TECH-W06 | **Release notes / changelog discipline:** each shipped `ENH-###` lands a one-line AR/EN changelog entry a customer can read. | Customers see the product improving; feeds TECH-L05's definition-of-done. | S |

**Docs surface:** none of the above exists today, so the first ask is simply that documentation gets a named owner and a `docs/manual/` + `docs/admin/` + `docs/runbook/` (shared with TECH-N05) home in the tree.

---

## Roll-up

| Persona | Items | Sizes |
|---|---|---|
| Security (P-SEC) | 6 | 2×L, 3×M, 1×S–M |
| Ops (P-OPS) | 6 | 1×L, 4×M, 1×S–M |
| On-call (P-ONC) | 5 | 3×M, 2×S–M/S |
| Reviewer (P-REV) | 5 | 2×L, 2×M, 1×S |
| Tester (P-TST) | 6 | 1×M–L, 4×M, 1×S–M |
| Team-lead (P-LEAD) | 5 | 1×S–M, 4×S |
| Tech-writer (P-DOC) | 6 | 1×L, 2×M, 3×S/S–M |
| **Total** | **39** | — |

**Cross-cutting substrate (the items multiple personas depend on):**
- **TECH-S02 (hash-chain audit)** → unlocks `ENH-050`, `ENH-052`; wanted by security, reviewer, auditor-facing work.
- **TECH-O01 (signed release pipeline)** → blocks *all* shipping incl. `ENH-060`; needed for TECH-T02.
- **TECH-R02 (dialect shim / dual-engine)** → the cloud edition's "additive not rewrite" guarantee; compounds daily.
- **TECH-T01 (gating E2E)** → makes every other test-backed guarantee real.

**Standing recommendations to product/lead:** pull TECH-S02, TECH-O01, and the TECH-R02 shim into E1 (they are substrate for E1 business items), give TECH-R01/R02 a named owner (they are the compounding-debt items), and adopt TECH-L05's definition-of-done so no `ENH-###` ships without its fixture, audit events, and doc line.

> Beyond-parity; `feature-enhancements` branch only; tracks `main`. Every `TECH-###` is a candidate for the tracker, grounded in the tree at `53577b3`, and traces to `plan.md` and/or a business `ENH-###` in `requirements.md`.
