# Mezan — self-hosted distribution, bundling and branching

> **Archived 2026-08-29 — a record, not current state.** Read `../ROADMAP.md` for what is
> built and open, and `../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `./README.md` in the archive root maps them.


> How one desktop product is sold to several industries at different prices, and how its
> code is branched so that a fix reaches every customer who paid for it.
>
> **Category: durable reference.** The three blockers in §1 are code observations made
> against the working tree on `main` at `128f92e` (2026-08-27), not claims copied from
> `ROADMAP.md`. Re-verify them before treating any as still open — they are the kind of
> thing that gets fixed without this file being updated.
>
> Scope: the **desktop edition sold self-hosted**. The cloud/SaaS edition (`plan.md` §9)
> is out of scope here; where it differs, the difference is noted.

---

## The short version

Never create a branch for a customer. Customer differences live in a signed license file
— `activeModules[]`, `features{}`, `seats` — not in git. Git carries exactly one trunk
plus a maintenance branch per shipped minor version, and fixes always travel one
direction: land on `main`, then cherry-pick down to every release branch a customer is
still running.

That model only works once three things are built, and none of them are built now.
Everything else in this document is downstream of §1.

This document also resolves the open row *"licensing mechanism finalization"* in
`ROADMAP.md` §6.2 — §3 and §5-B are the proposed decision.

---

## 1. Three things block every sale

Each was verified in the code, not inferred from the docs. The pattern is the same in all
three, and it is defect pattern #2 from the working skill: **the hard part is written and
correct, and nothing calls it.**

### 1.1 The bundle boundary is not enforced anywhere — UNWIRED

`createModuleGate()` in `packages/api/src/module-gate.ts` is a correct, fail-closed 403
gate. It is mounted on **zero routes**. The only hits across the repo are its own
definition, its export line in `packages/api/src/index.ts`, and two comments in
`permission-gate.ts` and `lan/gate.ts` that refer to its shape.

On the front end, only `apps/web/src/pages/RoleEditorPage.tsx` ever calls
`licensedModules()` / `licensedPermissions()`. The nav registry in
`apps/web/src/nav-config.tsx` never consults entitlements at all.

**Consequence.** Every install today serves and displays all twenty catalog modules. You
can invoice a customer for a Core bundle and will hand them manufacturing, projects, CRM
and field sales for free — and will show a retail customer POS screens that were descoped
and do not work.

**Blocks:** every bundle in §2. Until the gate is mounted, "bundles" are a price list,
not a product.

### 1.2 The license is an environment variable — STUBBED

`apps/desktop/src/main/entitlements.ts` resolves entitlements by reading
`MEZAN_ENTITLEMENTS_JSON`. Its own doc comment calls it a "STUBBED SEAM". Any customer
who sets one environment variable owns every module in the product.

Meanwhile `packages/domain/src/licensing/license.ts` is genuinely good work and entirely
unreachable. `verifyLicense()` runs the full chain — Ed25519 signature → monotonic
clock-rollback guard → `notBefore` → machine-fingerprint binding → expiry → `GRACE` →
`READ_ONLY` — with the right ethic baked in: a lapsed license still reads, prints and
exports the customer's books, and only blocks new postings.

What is missing is the plumbing around it:

- an offline signing CLI that mints `license.mezan` files
- a per-OS machine `FingerprintSource`
- a persisted `MonotonicClockStore`
- the signing public key compiled into the build
- a first-run activation screen (online **and** air-gapped challenge/response)
- a license-transfer flow for "my PC died"

**Blocks:** charging differently for different bundles. Also renewals, seat limits, and
every trial you hand out.

### 1.3 You cannot ship v1.0.1 to a customer running v1.0.0 — MISSING

There is no migration system. 61 files under `packages/persistence/src` open with
`CREATE TABLE IF NOT EXISTS`, and about sixteen bolt on ad-hoc `ALTER TABLE` calls behind
hand-rolled `pragma table_info` probes — `stock-ledger-store.ts`, `sales-invoice-store.ts`,
`audit-sink.ts`, `purchasing-stores.ts`, `customer-repository.ts`, `promotion-store.ts`,
`manufacturing-stores.ts`, `price-list-store.ts`, `sequence-config-store.ts`,
`van-trip-store.ts`, `physical-count-store.ts` and others.

Nothing records what version a database is at. `CURRENT_SCHEMA_VERSION = 1` in
`apps/desktop/src/backup/manifest.ts` is a constant that no migration ever increments.

Adding a nullable column happens to survive this arrangement. A table rewrite, a data
backfill, a changed constraint, or any two changes with an ordering dependency does not.
Self-hosted makes it worse than it sounds: every customer's database is an un-inspectable
file on a shop laptop you cannot reach, each at a different unknown state.

One piece of good news — `apps/desktop/src/backup/pre-migration-hook.ts` already exists.
The safety net is built. There is simply nothing yet for it to guard.

**Blocks:** every bug fix after the first customer installs. This is the one that turns
into refunds.

---

## 2. What can honestly be sold today

Bundles are sets of `activeModules[]` stamped into the license file. The core surface —
`dashboard`, `admin`, `audit`, `workflow`, `transactions` — is never licensable
(`ALWAYS_LICENSED_MODULES` in `packages/domain/src/permissions/module-licensing.ts`) and
ships in every bundle.

One rule governs this table, and it comes from the working skill:
**never license a module that does not exist.** Selling POS today buys a support
obligation that cannot be met.

| Bundle | | Adds to Core | Status |
|---|---|---|---|
| Core | النواة | `accounting` `sales` `purchases` `inventory` `treasury` | **Ship now** |
| Wholesale & distribution | الجملة والتوزيع | `field` `cheques` `crm` `installments` | **Ship now** |
| Manufacturing | التصنيع | `manufacturing` `assets` | **Ship now** |
| Contracting | المقاولات | `projects` `assets` | Ship with caveat |
| Accounting office | مكاتب المحاسبة | `accounting` + *multi-company* | Needs multi-company |
| Retail | التجزئة | *pos* `cheques` | **Blocked — POS** |
| Restaurants | المطاعم | `manufacturing` *pos* | **Blocked — POS** |
| Pharmacy | الصيدليات | *pos* *FEFO* `inventory` | **Blocked — POS, FEFO** |

*Italic* entries do not exist yet. Contracting ships with a caveat because BOQ, progress
certificates and retention billing are thin (`plan.md` §8 catalog gaps) — sell it to a
developer who bills by milestone, not one who bills by BOQ line.

`cheques` maps to the `financial_papers` entitlement id via
`CATALOG_TO_ENTITLEMENT_MODULE`; the license must carry the entitlement id, not the
catalog id.

### 2.1 POS is the single highest-value unblock

Three of the eight bundles — retail, restaurants, pharmacy — are gated on one descoped
module. Nothing else in the backlog unlocks three verticals at once. If the goal is
breadth of market rather than depth in wholesale, POS comes before everything except the
three blockers in §1.

### 2.2 Priced add-ons, sold as feature flags rather than modules

These ride in the license's `features{}` map and cut across bundles.

| Add-on | State | Notes |
|---|---|---|
| LAN multi-till | **Ready** | Built and already gated; satisfies one-license-many-devices |
| Extra seats / branches / warehouses | **Ready** | Capacity axes already in the license payload |
| Fixed assets | **Ready** | The `assets` module, sellable standalone |
| ETA e-invoicing | Partial | Confirming an invoice queues a submission (F33); clearance past the queue is manual. Sell as "queued and printed with QR", not "cleared" |
| Multi-currency | **Do not sell** | D24 — documents take a currency label and no rate is ever applied. The revaluation engine behind it is correct and unreachable |
| HR & payroll | **Do not sell** | Income tax, social insurance, Article 47 seniority and gratuity are uncomputed; the payslip correctly declares its own net incomplete. Right behaviour, unsellable product |

---

## 3. Where customer difference lives

Four layers, none of them git. Work down this list; the earlier the layer, the cheaper
the customer is to serve forever.

| Difference | Mechanism | Lives in |
|---|---|---|
| Which modules they get | `activeModules[]` | signed license file |
| Sub-module behaviour | `features{}` flags | signed license file |
| Capacity | `seats`, branches, warehouses, tills | signed license file |
| Look, chart of accounts, numbering, print, tax profile | settings + templates | the customer's own database |

Entitlements have the same shape in both editions (`plan.md` §2.5), so a cloud
subscription that also issues a desktop license is a licensing-service concern with zero
application changes.

---

## 4. Branching

The failure mode this avoids is specific and common: eight customer branches that each
drift a little, until a single security fix has to be written eight times against eight
slightly different files, and two of them silently do not get it.

```
main    ──●────●──────────●────────●──────────●────●──►   always releasable
              │           ⊗ fix lands here    │
              │           ┊ cherry-pick -x    │
              ▼           ┊                   ▼
   release/1.0 ●──────────┊──●───────►        release/1.1 ●────●──►
              v1.0.0      ┊  v1.0.1                       v1.1.0 v1.1.1
                          ┊                                 ▲
                          └─────────────────────────────────┘
```

Every customer runs a tagged build off a release branch. No customer runs `main`, and no
customer has a branch of their own. Fixes travel **down only** — nothing is ever merged
from a release branch back into `main`.

### 4.1 The six rules

1. **Nothing is branched per customer.** If two customers differ, that difference is a
   license field, a setting, or a print template — three things that live in the
   customer's own data, not in this repository.

2. **`main` is always releasable.** Feature branches are short — one to three days — and
   merge back fast. This is close to what the repo already does; the discipline to add is
   that a red `main` is stopped work.

3. **Cut `release/1.N` at feature freeze.** It lives exactly as long as one paying
   customer is still on that minor. After the last one upgrades, delete it.

4. **Fix forward, then backport down.** Every fix lands on `main` first and is verified
   there. Then `git cherry-pick -x` onto each supported release branch. The `-x` records
   the original commit, which is how you audit six months later which customers actually
   received a fix.

5. **Never merge a release branch into `main`.** The moment that happens, a release
   branch has become a fork with its own history, and rule 4 stops being possible.

6. **Tags live only on release branches.** `v1.2.3` drives `package.json`, which drives
   the installer filename and the `latest.yml` update feed. One tag, one build, one
   artifact — never rebuild a tag.

### 4.2 When a customer genuinely needs bespoke code

It will happen — a client wants a specific invoice layout, an unusual approval rule, a
report nobody else asked for. Stop at the first rung that fits.

| | Approach | Why |
|---|---|---|
| **Prefer** | A feature flag in the trunk — add it to `features{}` and gate the behaviour | Every customer's code stays identical; only their license differs. Covers most requests |
| **Then** | Configuration in their own database — print templates, COA presets, numbering, tax profiles | No code ships at all; the implementation consultant does this at install time |
| **Last** | An overlay package `packages/custom-<client>`, loaded only when an entitlement names it | Still on the trunk, still gets every fix, still builds in the same pipeline. Price it as bespoke work, because it is |
| **Never** | A customer branch | If forced into one, be honest: it is a permanent fork maintained forever, at your cost, on your margin |

### 4.3 Clean the repo before any of this

There are 45 remote branches on `origin`, including roughly fourteen `worktree-agent-*`
refs and a set of `backup/2026-08-26/*` tags. That noise makes "which branches are
supported?" unanswerable — the exact question this strategy depends on.

- Prune to `main`, live release branches, and open feature branches
- Protect `main` so nothing lands without review
- Write the six rules into `CONTRIBUTING.md` so they survive any one person leaving

---

## 5. The release train

Predictable cadence matters more when self-hosted, because every update costs a customer
an interruption and possibly a phone call.

| Release | Cadence | Carries | Schema |
|---|---|---|---|
| Patch `1.2.x` | Monthly, or same-week for anything touching money | Bug fixes cherry-picked from `main` | No migration if avoidable |
| Minor `1.x.0` | Quarterly | New modules, features, bundles | Migrations allowed |
| Major `x.0.0` | Only when an upgrade needs a human | Breaking changes, data restructuring | Assisted upgrade |

### 5.1 Support window

Support the current minor and the one before it. A customer two minors behind gets an
upgrade visit, not a backported patch — otherwise the number of live release branches
grows without limit and rule 4 becomes a full-time job. Put this in the contract, so the
third-minor conversation is a renewal rather than an argument.

### 5.2 Windows signing is a purchase, not a task

`apps/desktop/electron-builder.yml` already targets `nsis` on x64, and the Linux build
host has Wine, so the installer builds today. It is unsigned, with two consequences worth
budgeting for now:

- SmartScreen warns "unknown publisher" on every install — brutal for a finance product
  sold on trust
- `electron-updater` auto-updates are unsafe and widely refused when unsigned, which
  quietly removes the ability to push a fix at all

An OV certificate is cheaper and earns SmartScreen reputation slowly; an EV certificate
is dearer and trusted immediately. For an ERP whose first impression is a security
warning, EV usually pays for itself.

The update feed also needs a real host — `publish.url` currently points at the
placeholder `https://updates.mezan.example/desktop/`.

---

## 6. Build order

**A is not optional and nothing after it matters without it.** Each phase names what
"done" means as something observable in the running app — the standard this codebase
already holds itself to (`TESTING.md` §1).

### A — Enforce the bundle

Mount `createModuleGate()` on every licensable router in
`packages/backend/src/create-backend.ts`, resolving entitlements per request. Filter the
nav through `licensedModules()` so an unlicensed module is absent rather than a dead
link. Give an unlicensed route a real Arabic "not in your plan" surface with an upgrade
path, not a raw 403.

> **Done means** launching with a Core-only license: wholesale, manufacturing and
> projects routes return `MODULE_NOT_LICENSED`, their nav entries are gone, and every
> Core flow — invoice, voucher, stock movement, trial balance — still posts correctly.

### B — Make the license real

Replace the `MEZAN_ENTITLEMENTS_JSON` stub with `verifyLicense()`. Build the three ports
it needs — a per-OS machine `FingerprintSource`, a persisted `MonotonicClockStore`, a
real `Clock` — and compile the public key into the build. Then the two pieces outside the
app: an offline signing CLI that mints `license.mezan` files, and a first-run activation
wizard covering both the online path and the air-gapped challenge/response. Plan the "my
PC died" transfer flow now, not after the first call.

> **Done means** a tampered license file refuses to open; an expired one enters grace
> with a banner, then read-only — where the books still open, print and export. The env
> var is deleted from the codebase.

### C — Make upgrades survivable

Add a real migration ledger: a `schema_migration` table, numbered forward-only migrations
applied in order inside the existing `withSqliteTransaction`, and
`CURRENT_SCHEMA_VERSION` derived from it rather than hardcoded. Fold the scattered ad-hoc
`ALTER TABLE` probes into numbered migrations so the history is one ordered list. Run the
whole thing behind `pre-migration-hook.ts`, which already knows how to take a backup
first.

> **Done means** a CI job restores a real v1.0 database fixture, migrates it to head, and
> asserts the trial balance still balances and every sub-ledger still agrees with its
> control account. Keep one fixture per shipped version, forever.

### D — Sign and publish

Buy the Windows certificate, wire `CSC_LINK` / `CSC_KEY_PASSWORD` into a release
workflow, point `publish` at a real host, and split the feed into stable and beta
channels so there is somewhere to pilot a risky change with one friendly customer.

> **Done means** a tagged commit produces a signed installer that installs on clean
> Windows with no SmartScreen warning, and an existing install picks up the next patch
> through the updater without a manual download.

### E — Clean the repo, write the policy

Prune the 45 remote branches and the agent worktree refs, protect `main`, and put the six
branching rules in `CONTRIBUTING.md` next to the support window.

> **Done means** `git branch -r` answers "which versions are supported?" without anyone
> having to remember.

---

## 7. The part that is not code

Self-hosted means there is no dashboard. You are blind to your own installed base unless
you deliberately write things down.

### 7.1 Keep a customer registry from the first sale

A spreadsheet is fine to start, but start it before customer one — reconstructing it
later is guesswork. One row per install:

- Licensee, license id, bundle, and the exact `activeModules[]` that was signed
- App version **and** schema version currently installed — both are needed to answer
  "can I send them this patch?"
- Machine fingerprints bound to the license, and how many seats were paid for
- `supportUntil` and `updateChannelUntil` — already fields in the license payload
- When a successful backup was last seen, because when a shop laptop dies that is the
  whole conversation

### 7.2 Guard the signing key like the product

The Ed25519 private key never enters the repository and never enters CI. It lives offline
and mints licenses on a controlled machine. If it leaks, every license becomes forgeable
and there is no revocation path — an offline product cannot phone home to be told a key
was rotated. Key rotation means shipping a new app version with a new public key and
reissuing every customer's license.

### 7.3 Be honest about what the gate is for

Any license check inside a JavaScript app is bypassable by someone determined, and
`plan.md` §2.5 already says so plainly. Obfuscation buys time, not safety. What actually
protects the revenue is commercial: signed updates only for current customers, support
entitlement, and the fact that a business running its books on a cracked ERP has no
upgrade path and no one to call.

Build the gate well, keep it small and centralized so it can be hardened later, and do
not spend a quarter trying to make it unbreakable.
