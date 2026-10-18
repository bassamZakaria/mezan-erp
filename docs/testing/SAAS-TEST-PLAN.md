# Test Plan: Mezan cloud (SaaS) edition — 2026-10-18

Provisional: built from `docs/TESTING.md` §11 (PLT-SAAS-01..08), the e2e suite in `e2e/saas/`, and the
features merged 2026-10-17/18 — no fresh `scenario-mapper` discovery pass yet.

## Scope
**In scope:** the cloud server (`apps/server/src/cloud.ts`) served locally by `pnpm env:testing`
(http://localhost:4101); platform console `/platform/*`; tenant app; public signup and billing; the
features merged 2026-10-17/18 (listed under P1); desktop 1440 px and phone 390 px; Arabic RTL and
English; light and dark.
**Out of scope:** the desktop Electron shell and LAN tills; POS (deferred, DEC-29); real Paymob,
SMTP, S3 and the Contabo VPS (test doubles and local stubs only); load testing.

## Risk-based priorities
**P0 — money, access, tenancy**
1. Signup → trial tenant → first login (cookie session, CSRF, device binding).
2. Tenant isolation: a session, cookie, API key or export link never reaches another tenant.
3. Platform console: owner login + step-up, tenant suspend/resume, plan change, backup export (single use) and restore drill.
4. Billing: subscription state, card checkout in Paymob test mode, manual payment, trial expiry → read-only.
5. Core books on a tenant: sales invoice → receipt, purchase → payment, stock movements; the ledger stays balanced (scenarios cover the arithmetic; here we check the screens).
6. Credentials: login lockout, email change needs the current password, wrong current password does not sign out, sign-out clears the session.

**P1 — features merged 2026-10-17/18:** pricing guard (E2-08), expiry/FEFO (E2-04), collections (E2-09), provisioning (E2-11), count mode (E2-03), reorder (E3-03), van reconciliation (E3-04), CRM pipeline (E3-06), funnel/leaderboard (E3-07), owner digest (E3-02), glance `/glance` (E3-01), health console (E3-10), evidence pack (E3-08), integration API keys + webhooks (E3-09), client error reporting + operations page (logging), HR bank file / scheduled accrual (4D).
**P2:** layout at 390 px, dark mode, English copy completeness, empty states, breadcrumbs.

## Cadence
| Check | Frequency | Trigger |
|---|---|---|
| `pnpm test` + `pnpm scenarios` | every merge to main | pre-push hook |
| `pnpm test:saas` (PLT-SAAS-01..08) | before every cloud deploy | release |
| Manual browser walk of P0 | before every cloud deploy | release |
| Manual browser walk of P1 + P2 | after a feature wave, before a release | wave merge |
| accessibility / cross-browser grid | not yet established | — |

## Exit criteria (gates a cloud release)
- `pnpm test` 0 failed (a known load flake must pass when re-run alone); `pnpm scenarios` 0 failed with every invariant exactly 0.
- `pnpm test:saas` 0 failed.
- Every P0 item walked in the browser with no open defect.
- Every P1 screen opens with no error block, no console error, no 4xx/5xx it did not ask for, at 1440 and 390, Arabic and English.
- No open defect that loses data, leaks across tenants or shows another user's salary/cost.

## Environment & data strategy
**Environment:** local only, `pnpm env:testing` (fresh platform dir each run with `env:testing:fresh`), demo password gate. Never against a real server.
**Accounts (test values from `docs/ENVIRONMENTS.md`):** Basic auth `demo` / `local-demo-password`; platform owner `owner@mezan.local` / `owner-password-123`; tenant `demo`, `admin@cyag.example`, PIN `123456`.
**Data:** new signups use `qa+<timestamp>@example.test` and tenant codes `qa<timestamp>`; Paymob test provider only; exports are intercepted in the page, not saved to disk.

## Coverage ledger
| Scenario | Priority | Automated? | Last verified |
|---|---|---|---|
| PLT-SAAS-01..08 (console, isolation, resolution, signup, card checkout, trial expiry, screen walk, demo tenant) | P0 | ✅ `e2e/saas/*.spec.ts` | running 2026-10-18 |
| Every tenant screen the nav reaches (route table × entitlements, incl. P1 screens, integrations tabs, payroll bank-file tab, van-trip reconciliation, `/glance`) × 8 looks on the seeded Enterprise demo; English copy of the P1 screens | P0 | ✅ `e2e/saas/07-screen-walk.spec.ts` | 2026-10-18 |
| Cookie session + CSRF + email-change guard + sign-out | P0 | ❌ manual (walked 2026-10-17) | 2026-10-17 |
| Backup export single-use link | P0 | ❌ manual (walked 2026-10-17) | 2026-10-17 |
| P1 features (16 areas) | P1 | ❌ manual only; ledger arithmetic of E3-04/E2-04/E2-03/E2-08 in `scripts/scenarios` | — |

## Changelog
- 2026-10-18: first version.
- 2026-10-18: screen walk extended to every tenant screen in all eight looks; the demo server pair boots once from `playwright.saas.config.ts`.
- 2026-10-18 (end of day): full pass on main. `pnpm vitest run` 16,762 passed (1 print snapshot updated for `lang="ar"`); `pnpm scenarios` 8,144/0, every invariant 0; `pnpm test:saas` 1,547 passed + the two console checks re-run green after the trial-end label fix (186 tenant screens × 8 looks, English check on every screen). Hand-tested P0 (signup → activation → login, tenant isolation, lockout, suspend/resume read-only, console operations, backup export + restore drill) and P1 actions (API keys + /api/v1 idempotency + revoke, reorder → draft PO, dunning idempotency, client error → health console, evidence pack verify + tamper). 8 defects found and fixed; signup plan wording decided as an honest reverse trial (DEC-31 kept).
