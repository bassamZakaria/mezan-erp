# Mezan stakeholder review — shared context

Every stakeholder agent reads this file first. It is the ground truth for what
Mezan is, what is actually built today, and what a review is allowed to assume.

## What Mezan is

An Arabic-first, RTL, Egypt-focused ERP for SMB trading, retail, restaurant and
light-manufacturing businesses. It is an authorized rebuild of a captured
system: the target is **parity with the feature catalog in `docs/archive/catalog/`**,
not feature invention. One TypeScript domain core compiles into a fully-offline
Electron desktop app and (later) a multi-tenant cloud web app.

## v1 scope — do not review against descoped work

- **v1 = Electron desktop only, SQLite.** LAN multi-till stays (one license,
  several tills on a shop's local network).
- **Descoped for now:** the POS module including the net-new `/pos/sell` selling
  screen. (The cloud/SaaS edition is no longer descoped: it is live at
  https://mezan.cyag.net since 2026-10-21 with self-serve `/signup` and the
  DEC-31 reverse trial.) **HR is only partly
  descoped** — employees, contracts, attendance, leave, payroll runs, payslips
  and advances are built and routable; what is deliberately absent is *statutory
  payroll computation* (social insurance, income-tax brackets, end-of-service).
  Judge the HR screens that exist; do not judge the numbers they would produce.
- The `apps/web` Vite dev server renders the *same* React UI the desktop shell
  wraps. Reviewing it in a browser is reviewing the desktop app's UI, not a
  separate website product.

## What is actually built today

**Do not review this as a Phase-1 slice. It is a whole product.** As of
2026-09-07 there are **123 routable screens** (`apps/web/src/router/screens.ts`,
plus three addresses `AppLayout` mounts itself) reached from **123 nav
destinations**, each gated by a permission and a licensed module. Every screen
reads and writes a **real backend** over HTTP — double-entry GL, weighted-average
costing, treasury, sales, purchases, inventory, manufacturing, CRM, projects,
assets, instalments, HR (minus statutory payroll), 23 operational reports and 8
financial statements, and the ~286-permission matrix behind all of it.

**There are no «قريباً» placeholders left.** The three `قريباً` strings in the
i18n catalog are "due soon" date labels, not stubs. There is also **no mocked
data anywhere in `apps/web`** — no sample-data modules, no in-browser store; the
demo tenant lives in `packages/backend/src/demo-seed.ts` and reaches the UI
through the API like everything else.

So "module X is missing" is only a finding when the module is genuinely absent —
check `docs/ROADMAP.md` §2 (what exists) and §4 (descoped by decision) before
calling something a gap, and drive the running app before calling something
broken.

**Licensing and the LAN, as they now are.** The install verifies a signed
`license.mezan` (Ed25519, machine-bound, expiry + grace) against a vendor public
key **compiled into the build**; that verdict is the single source of both write
permission and module entitlements, and it is re-read on every request. A lapse
never withholds data: past grace, and past 7 days without an online check-in, the
install goes read-only — every record still viewable, printable and exportable —
and past 30 days it adds a blocking notice. **It never refuses to start.** The
LAN multi-till socket is HTTPS-only with a pinned self-signed certificate; a till
pairs from its own login screen by comparing that fingerprint on screen, and one
machine holds the books with no synchronisation anywhere.

## Non-negotiable invariants

- **RTL by construction.** Logical CSS properties only — no hardcoded
  `left`/`right`. Enforced by `pnpm lint:rtl`
  (`scripts/check-logical-css.mjs`).
- **Money and quantities** are scaled int64 (10⁻⁶) via `Money`/`Qty` value
  objects. Never floats. Rounding only at documented boundaries.
- **Arabic is the primary language**, English is secondary (ar/en i18n). Arabic
  copy must read as native accounting Arabic, not as translated English.
- **Offline is the differentiator.** Nothing in the desktop edition may require
  connectivity **to do the work** — every screen, posting, report and print runs
  with the network unplugged. The one exception is the periodic licence check-in,
  which degrades to read-only rather than blocking, and whether that is
  compatible with the sales promise is an open owner decision, not a settled
  fact.
- **Design identity:** light-first, **Cyag blue** `#003ce1` (`--brand`, the
  primary action) on a slate `#1e293b` chrome rail, with `#0099f3` as the
  non-text accent. Any note describing a teal-and-gold identity is stale — teal
  and gold survive only inside `--chart-*`, which is a categorical data scale and
  not identity. Type is Zain for display, IBM Plex Sans for Latin, IBM Plex Mono
  for figures. Tokens live in `packages/ui/src/tokens/tokens.css`; dark mode is
  supported both via `prefers-color-scheme` and an explicit `[data-theme]`.

## Where to look

| Question | File |
|---|---|
| What is built, what is open, defects, decisions | `docs/ROADMAP.md` (§2 built, §3 open, §4 descoped, §5 defects, §6 decisions) |
| Install, rollout, licensing, LAN, release | `docs/INSTALL.md` |
| Testing policy and every scenario | `docs/TESTING.md` |
| Per-domain feature catalog (parity target) | `docs/archive/catalog/*.md` |
| Architecture and the deferred HR/POS/cloud plans | `docs/archive/plan.md` |
| Approved visual direction | `docs/artifacts/mezan-enhanced-mockups.html` — the design source of truth |
| Shared UI primitives and tokens | `packages/ui/src/` |
| Screens under review | `apps/web/src/screens/`, `apps/web/src/settings/` |

## How to run it

```
MEZAN_SEED_DEMO=1 MEZAN_DB=./dev.db PORT=3187 pnpm exec tsx apps/server/src/index.ts
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3187 pnpm exec vite --port 5183
```

Sign in as `admin@cyag.example`, password `Cyag@2026` — the login field is the email and
only the email. `pnpm --filter web dev` alone gives a UI with no backend behind
it, which will read as a hundred broken screens.

Run the app and read the screens directly. Reviews are done against the running
app, not against captures — a screenshot goes stale the day after it is taken —
and **reload the page to confirm a save actually persisted**.

## What this review must decide

> Working bar set by the reviewer running this session, not yet confirmed by the
> owner. If it is wrong, correct it here and re-run the panel.

**The question:** is Mezan simpler to work in — fewer steps, fewer decisions,
less to learn — than what an Egyptian SMB uses today, and can its books be
signed? Completeness is no longer the question it was: the shell and the engine
are built, so "X is missing" is now the exception rather than the expected
finding.

**Blocker for this review** = anything that makes a daily task slower, more
confusing or less trustworthy than the same task on a competitor, that produces
a wrong number, or that a buyer would reject in a demo. **Not a blocker** = a
module descoped by decision (§4 of the roadmap).

**Demo audience:** an Egyptian SMB owner and their accountant, evaluating a
switch. Buyer and user in the same room.

**Known and already reported — do not re-report:**
- POS, statutory payroll computation, HR depth and the cloud/web edition are
  descoped from v1 by decision (`docs/ROADMAP.md` §4).
- No installer has ever been code-signed: the certificates are a business
  purchase nobody has made (`docs/INSTALL.md` §8.1).
- Everything already filed in `docs/ROADMAP.md` §5 (D66–D191) and in
  `docs/artifacts/audit-2026-09-07.md`. Read both before filing anything.

**What every finding must carry:** the screen or `file:line`, what it costs the
user, and a concrete simpler alternative. A complaint without a proposed
simplification does not count for this review.

## Observed in the app (verified, use freely)

The four readings that used to sit here — an invoice row that opened nothing,
three dead accounting nav items, a dark-by-default shell, and a login field that
ignored a pasted string — are **all closed**, and re-reporting any of them is a
false finding. Documents open as pages, accounting is fully wired,
`apps/web/index.html` ships `data-theme="light"` so the OS preference cannot
override the light-first direction, and the password field accepts a paste.

Two things worth knowing before you drive the app:

- **Sign-in is email + password.** Fill both fields and press Enter; a seeded or
  console-created account with a temporary password lands on the change-password screen first.
- **Documents are pages, not drawers.** Only short master-data forms stay as
  overlays. A document that opens in a drawer is a finding.

Add a reading here only after driving it in the running app, and date it.

## Decisions already made

- 2026-10-22 (landing-page panel, `meeting-2026-10-22-landing-page.md`): the public page leads with the
  reverse trial + Free plan + "never locked"; prices are read live from `/api/signup/plans`; no ETA
  e-invoicing claim (DEC-10), e-receipt may be claimed; "offline" only for the desktop edition; no
  data-in-Egypt claim; no named-competitor comparison; copy in plain MSA reusing the app's strings.
  Daftra's 489.5/977.58/1,960 are its annual-billed rates (monthly 733/1,225/2,448).
- 2026-10-30 (owner, superseding the 2026-10-29 provider choices): **no external auth provider** (Supabase,
  Cognito, Firebase, Google all dropped). **Email + password is the only sign-in on every edition — web,
  desktop, LAN tills; the PIN is removed completely.** Sensitive actions re-ask the password. Admin-created
  users get a random temporary password and must change it at first sign-in (emailed on web, shown once on
  desktop). Existing test users and the demo seed use `Cyag@2026`, not forced to change. No 2FA for now.
  Mobile moves to password in a later lane (mobile sign-in is broken until then).
