# Production readiness — 2026-10-18

Four reviews (security, legal/compliance, release/QA, customer operations) on `main`, plus the
Contabo deployment lane. Each item says who acts: **code** (we build it), **owner**, **lawyer**,
**accountant**. Status is updated as items close.

## Blockers — before the first paying customer

### Ledger and release
| # | Item | Who | Status |
|---|---|---|---|
| R1 | Run `pnpm scenarios` + `pnpm vitest run` on current main (last scenarios run was before 79 commits / +45k lines of waves C–F) | code | running |
| R2 | Real scenarios for the money-posting features whose scenario files are 3-line stubs: E3-04 van reconciliation, E2-04 expiry write-off, E2-03 count posting, E2-08 price-floor confirm gate — four invariants must stay at exactly 0 | code | open |
| R3 | Bump the desktop version (still `2026.9.0` while the schema moved to v2) or existing installs never receive the update | code | open |
| R4 | Upgrade drill: open a real September books file (schema 1) on the new build, then restore its `pre-update` archive | code + owner (a real file) | open |
| R5 | `FULL=1` pass, every-screen run, browser walk of the ~20 new screens in Arabic/English, 390 px, dark mode | code | open (owner: tests last) |

### Security
| # | Item | Who | Status |
|---|---|---|---|
| S1 | Tenant SMTP host can reach the VPS's internal network (SSRF via "send test") — apply the webhook address check on the cloud | code | in progress (`fix/prod-security`) |
| S2 | No security headers (CSP, HSTS, frame-ancestors, nosniff) | code | in progress (Contabo lane, Caddy) |
| S3 | App port must not be published on the host, or X-Forwarded-For spoofing bypasses rate limits and login lockout | code | in progress (Contabo lane) |
| S4 | No encryption at rest on Contabo — backups must be encrypted before leaving the box; webhook secrets / tenant SMTP passwords encrypted in the DB | code | in progress (both lanes) |
| S5 | Salary allowances/deductions leaked to holders of `hr.employee.view` without `view_salary` | code | **fixed** `3e763a86` |

### Customer operations
| # | Item | Who | Status |
|---|---|---|---|
| O1 | Desktop backups only restore on the original machine unless the key file or a portable export was saved — add a required first-run step and portable off-machine copies | code | open |
| O2 | Licence check-in server not deployed → every shop goes read-only after 7 days. Deploy `apps/licence-server` (Contabo is fine) and bake `MEZAN_LICENSE_CHECKIN_URL` into builds; decide whether a fully offline shop should go read-only at all | owner + code | open |
| O3 | No code-signing certificates (Windows OV/EV, Apple Developer ID), no release pipeline, update feed is a placeholder | owner buys certs; code restores release script | open |
| O4 | "Contact support" appears everywhere but no number/email exists | owner gives contacts; code bakes them in | open |

### Legal / tax (Egypt) — a qualified lawyer / محاسب قانوني must confirm
| # | Item | Who | Status |
|---|---|---|---|
| L1 | Privacy policy says AWS Frankfurt + encrypted disks; production is Contabo — correct region and encryption claims, remove the «مسودة» banner after review | code + lawyer | open |
| L2 | PDPL 151/2020: Data Protection Center licence, cross-border transfer licence (hosting outside Egypt), DPO, 72-hour breach procedure; financial data may be sensitive | owner + lawyer | open |
| L3 | Terms of service, DPA (we are processor), subscription/refund terms; recorded acceptance at signup (Paymob also requires public terms + refund pages) | lawyer drafts; code adds pages + acceptance | open |
| L4 | Our own subscription sales: 14% VAT and ETA e-invoices/e-receipts | accountant + owner | open |
| L5 | Don't claim ETA e-receipts until one is accepted in pre-production; cloud B2B e-invoicing can't work while the e-seal token must sit on the backend machine (a VPS abroad) | owner + tax adviser | open |

## Should — first month
- Cloud: AR dunning has no scheduled timer (only `/collections/scheduled-run`); add one or drop the claim. **code**
- Desktop evidence pack fails above ~8 MiB over IPC; save to disk via a dialog. **code**
- Arabic number agreement: 15 strings say «{n} يوماً» (wrong for 3–10). One plural helper. **code**
- Audit anchors need an off-box object-locked store (Backblaze B2 / Wasabi if Contabo lacks Object Lock) and the signing key provisioned. **owner + code**
- Restrict `/api/platform` to the owner's IPs or add a second factor. **code + owner**
- `pnpm audit --prod`: upgrade hono (in progress); track mobile/desktop toolchain advisories. **code**
- Licence register: `licence:issue` appends to a ledger; renewal reminders. **code + owner**
- Arabic user guide; merge `bassamZakaria/Manuel-testing-plan` (guide + 21 manual test plans). **owner + code**
- LAN host must not sleep while tills are paired. **code**
- Paymob live keys and one real paid renewal end to end. **owner**
- Public status page + support hours. **owner**
- Retention/purge schedule for terminated tenants; sub-processor list in the DPA; mobile privacy text mentions first-party error reports; font OFL licence + third-party notices file. **code + lawyer/accountant**
- Docs out of date: TEST-DEBT misses most waves C–F lanes; ROADMAP §1 still says enhancements "none started"; `.claude/stakeholders/context.md` says cloud is descoped. **code + owner decides which governs**

## Later
- Leave-Mezan export in open formats (CSV/XLSX); tenant self-service export on cloud.
- Save logs from the login screen.
- Validate email addresses (CR/LF) everywhere they reach SMTP (in progress); constant-time demo password compare (in progress).
- Optional cut list until tested: integration API, glance, funnel, digest scheduled send, automatic dunning, desktop evidence pack — none posts to the ledger.
