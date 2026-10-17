# Beyond-parity enhancements E1–E3 — build plan (un-deferred 2026-09-19)

Sources: `docs/ROADMAP.md` §7 (backlog, sequencing), §6.4 (DEC-10, 14, 15, 17, 19, 20), §4.4 (claims),
§3.3 (outbound channels), §5.2 (key-card residual); `docs/archive/enhancements/requirements.md`
(ENH-###) and `workflows.md` (WF-##). Measured against `plan/deferred` = `origin/main` @ eed0cd2b.
**§7's banner "none is started" is wrong** — 17 of the 23 non-POS items exist in part (below);
correct it at Wave-1 close.

Out of scope here — **planned with POS**: ENH-E2-05, E2-06, E2-07, E3-05.

## 0. Ground rules for every lane

- Money is `Money` (bigint 1e-6); never `Number()`. Every stock/cash movement posts a balanced entry.
  Limits are recomputed server-side, never read from the request.
- Domain refusals in Arabic. Pickers bind real ids. Empty states honest. No mocked data; demo data only in
  a seed fragment behind `MEZAN_SEED_DEMO=1`.
- **No timers that act on the shop's behalf** (§3.3): anything that sends or drafts is an operator action or
  is computed on read, unless a new DEC says otherwise.
- **DEC-14**: a permission code lands in the same PR as the route it gates.
- **DEC-20**: any branch-filtered figure shows the «غير مخصص» bucket.
- **Hotspot rule**: lanes never edit the shared registries directly; they fill their own Wave-0 fragment file.
  ROADMAP.md / TESTING.md are updated by the wave-close integrator from each lane's PR notes.

### Standard done-definition (every lane)
1. Unit tests beside every changed file with a sibling test; `pnpm test`, `typecheck`, `lint`, `build` green.
2. Scenarios in `scripts/scenarios/enh-<id>.ts` driving the real HTTP routes, including refusals and the
   reverse path; `pnpm scenarios` ends with **the four invariants exactly 0.000000** (TB, stock vs 1200,
   AP vs 2100, AR vs 1105) at baseline and final.
3. `pnpm smoke` + `pnpm check:seed` (new read paths in the lane's smoke fragment; demo seed fragment so no
   new list is empty).
4. `pnpm test:every-screen` (new screens found via nav) and `pnpm test:responsive` at 390/360 px — no page
   overflow; ar/RTL + en/LTR, both themes; reload proves persistence.
5. Stakeholder review by the named `.claude/agents` personas; findings fixed or filed in ROADMAP §5.
6. Lane PR notes carry: §7 status line, TESTING.md scenario ids, any defect filed.

## 1. Status on main

| ID | Status | Evidence on main | Missing |
|---|---|---|---|
| E1-01 Owner cockpit | partial | `backend/src/dashboard-routes.ts` (`/dashboard/summary`), `apps/web/src/dashboard/*` (KpiStrip, AgingMatrix, TopItems, AttentionQueue, widget registry, §8.5 layouts) | same-weekday-last-week deltas, 7-day sparklines, GM% trend, top movers, overdue-AR & low-stock tiles with drill, runway tile, live refresh |
| E1-02 Cash runway | missing | `reports/cash-flow.ts` is historical only; sources exist: `reports/aging-open-items.ts`, cheque register, `installments/schedule.ts` | forecast engine, screen, low-cash alert |
| E1-03 Smart bank rec | partial | `domain/bank-reconciliation/{csv,adapters,matching,reconciliation-service}.ts`; routes import/auto-match/match/unmatch/finalize (+force reason, D82) | OFX/MT940, confidence score (amount+date+reference), suggest-then-confirm, 1:N match, create-entry from line, bank rules, live difference |
| E1-04 Guided close | missing | `fiscal-periods-routes.ts` close/reopen/lock with no checks; inputs exist (`domain/reconciliation`, FX reval runs, depreciation runs, bank statements) | checklist engine, lock gate + override-with-reason, close summary |
| E1-05 Audit ledger | partial | `persistence/audit-sink.ts` append-only triggers + SHA-256 chain + HMAC head; `GET /audit` filters + `/audit/verify`; `AuditLogScreen.tsx` verify button; `admin-audit.ts` `changedKeys` (used only by settings) | uniform `changes[{field,from,to}]` on price lists, accounts, promotions, tax/exchange rates, treasury accounts, items; field search; entity-history panel on 360s; export |
| E1-06 Backup drills | partial | `apps/desktop/src/backup/*`: daily + on-close + pre-update backups, light verify, weekly `integrity_check`, verified restore, portable export (`portable-export.ts`); cloud `server/backup-scheduler.ts` | sandbox test-restore drill with pass/fail + timing + invariants, drill history, stale-backup alert, second target folder; **portable-archive import is unwired** (`decryptFile` has no non-test caller; restore only accepts names in backupsDir) |
| E2-01 ETA pre-validation | partial | `domain/eta/*`, queue statuses, `/submissions/submit-all`, exclude, item/unit/tax-subtype mappings | rule engine before enqueue/submit, fix-&-requeue, rejection-reason report |
| E2-02 Recurring journals | missing | none (depreciation runs exist) | templates, schedule, generate-due-drafts, save-as-template |
| E2-03 Scanner count | partial | `inventory/physical-count*.ts`, blind mode, cost snapshot, variance → adjustment | scan-to-count mode, zones, multi-counter, live variance, recount flag |
| E2-04 Expiry/FEFO | partial | batch/expiry on GRN lines (`GoodsReceiptsScreen`), FEFO in `cost-layer.ts`, `ExpiredStockError`, `reports/inventory-expiring.ts`, `EXPIRY` reason | `trackBatches/trackExpiry` enforced nowhere; per-batch stock view; FEFO pick preview; near-expiry alert; batch on printed invoice |
| E2-08 Price floor | partial | `settings.maxLineDiscountPercent` + `sales.discount.approve`, giveaway guard | floor price / min-margin rules vs WAC, live line margin, route-to-approval, override report |
| E2-09 AR dunning | partial | installment `collection_follow_up`, statements, SMTP outbox (`notifications/dispatcher.ts`, operator drain). `server/dunning.ts` is **subscription** dunning, not AR | dunning policy/run, worklist over invoice AR, promise-to-pay, customer-addressed email, wa.me link |
| E2-10 SoD | partial | `workflow/gate.ts` SELF_APPROVAL; contracting segregation errors; `/security-reports/*` | permission-pair rule set, role/user-save warnings, SoD violation report from the audit trail |
| E2-11 Provisioning | partial | role editor copy-from (`RoleEditorPage` `template` prop), LAN pairing & seats | role templates, CSV user import, clone user |
| E3-01 Remote glance | missing | cloud edition is responsive (§9) but no glance surface | glance screen/role (cloud); desktop form undecided |
| E3-02 Digest | missing | notification rules on 39 events | digest composer, anomaly thresholds, owner scope |
| E3-03 Reorder | partial | `Item.reorderPoint/reorderQty/defaultSupplierId`, low-stock chip; `LOW_STOCK_DETECTED` in catalog **never emitted** | per-warehouse min/max + lead time, velocity, worklist, draft POs by supplier |
| E3-04 Van reconciliation | partial | `field-sales/*` open (load transfer), cash movements, settle (cash variance posting + treasury return) | expected stock net of van sales; return transfer; SHORTAGE adjustment on van (DEC-19); approval; rep/day report |
| E3-06 CRM pipeline | partial | leads→opportunities, stages w/ default probability, kanban, activities | weighted forecast, quote linkage, owner/rep, lost reason, reminders; `PipelineScreen.tsx:255` Number() money |
| E3-07 Funnel/leaderboard | partial | `reports/sales-by-salesperson.ts`, quote `convertedInvoiceId` | funnel with stage aging, leaderboard (margin, conversion, collection), commission export |
| E3-08 Evidence pack | partial | exportable reports, `/reconciliation`, audit verify, security reports | time-boxed auditor, sequence-gap report, one-click signed pack |
| E3-09 Integration API | missing | removed by DEC-17; event bus kept | cloud-only module |
| E3-10 Health console | partial | `SystemStatusScreen` (API+DB), `ConnectedDevicesScreen`, `MaintenancePanel`, `/lan/sessions` | one console: per-till last-seen/version, seats/licence, DB size, backup/drill age, ETA & outbox depth, chain status, alerts |

## 2. Designs

Each block: build · references · reviewers · flags. New domain modules go in `packages/domain/src/<name>/`,
stores in `packages/persistence/src/<name>-store.ts` on the shared `sqlite` handle, routes in
`packages/api/src/<name>-routes.ts` mounted from the lane's backend fragment.

**E1-05 Audit ledger** — `recordFieldChanges(audit, c, {entity, before, after, fields})` in `admin-audit.ts`
writes `details.changes=[{field,from,to}]` (money as strings). Wire into price-lists, accounts, promotions,
tax-rates, exchange-rates, treasury-accounts, items (replace ad hoc `previous*`), suppliers, customers. Field
search: an append-only side table `audit_event_field(event_id, field)` with the same triggers, filled in the
same transaction. **The chain's canonical tuple does not change** (audit-sink.ts:59 warns against it).
`auditQuerySchema` gains `field`. `AuditLogScreen`: before→after column, field filter, Excel/CSV export.
New `EntityHistoryPanel` on customer/supplier/item/account 360s (`GET /audit?entityType&entityId`).
Ref: QBO Audit Log (before/after per transaction), Odoo field tracking in chatter plus the hash-locked
posted entries. Reviewers: internal-auditor, chartered-accountant, security-officer.

**E1-06 Backup drills + key-card path** — `backup/drill-service.ts`: restore the newest archive into a temp
sandbox with the existing verified-restore steps, open it keyed, check `integrity_check`, schema version and
row counts vs manifest, and compute the four ledger invariants read-only through `domain/reconciliation` and
trial-balance. The result goes to `drills.jsonl` beside the backups (pass/fail, ms, failing check). IPC
`mezan:backup:drill` plus a weekly drill after the scheduled backup (it only verifies and reports, so it
doesn't break the no-timer rule). **Portable import**: `mezan:backup:importPortable(path, passphrase)`
→ `decryptFile` → the same verified restore. It runs on the first-run screen too, which closes §5.2's residual.
Optional second target folder (USB/share) copied after each backup. Cloud: the scheduler restores a copy
into temp and runs `integrity_check`. `BackupRestorePage`: drill button, history, "last good drill" age, import.
Ref: QB Desktop Verify Data + portable company file; Odoo DB manager restore/duplicate. Reviewers: it-admin,
owner, security-officer, support-agent. Flags: DEC-15 prerequisite for E3-01/E3-09; off-site/S3 target = owner money.

**E1-02 Cash runway** — pure `cash-forecast/`: daily buckets over 30/60/90 from opening cash (GL 13xx via
treasury accounts), open AR by due date (`aging-open-items`), open AP by due date, cheques in hand and issued
by maturity, installment schedule, and a `CommitmentSource` port (E2-02 fills it later). Output: series, first
day below zero or below the threshold, and the drivers of each dip. `GET /cash-forecast` (treasury gate via
fragment), threshold in its own table, alert computed on read → notification once per crossing.
`CashForecastScreen`. Ref: QBO Cash flow planner, Xero short-term cash flow, Odoo expected payment dates.
Reviewers: owner, treasury-cashier, credit-controller, chartered-accountant.

**E1-03 Smart bank rec** — adapters `ofx.ts`, `mt940.ts` (Excel is converted client side through the
existing xlsx lib). `matching.ts` scoring 0–100: exact amount (required), date distance, reference/cheque-no
token overlap, counterparty name. Suggestions are stored, then accepted or rejected, never auto-applied
below 90. 1:N match (one statement line to N entries summing exactly). `POST /:id/lines/:lineId/create-entry`
posts a bank-charges or interest voucher through the voucher service, dated the line's date. `bank_rule`
table (memo pattern → account, cost centre). Header shows the statement closing balance minus the book
balance, to the micro-unit. Ref: QBO bank feeds "For review" + rules; Odoo reconciliation models; no Egyptian
bank-feed API (file import only). Reviewers: accountant, treasury-cashier, chartered-accountant, internal-auditor.

**E1-01 Owner cockpit** — `reports/cockpit.ts` + `GET /dashboard/cockpit`: today vs the same weekday last
week, 7-day sparklines, GM% trend (revenue vs COGS lines), top movers, cash by treasury, overdue AR, low-stock
count, runway (E1-02). Every tile drills to a URL-state-filtered list. Live refresh: an event-bus subscriber
bumps a `bookVersion` counter; the UI polls `GET /dashboard/version` (15 s) and refetches on change. That
avoids SSE through IPC. Widgets are added to `widget-registry.ts`, with an owner default layout.
Ref: QBO Business overview, Odoo dashboards, Daftra home widgets. Reviewers: owner, reports-analyst, designer,
a11y, performance-engineer.

**E2-02 Recurring journals** — template (lines, monthly/quarterly/yearly, day, start/end, auto-reverse next
period for accruals), `POST /gl/recurring/generate-due` is idempotent per (template, period) and creates
**draft** journals only. "Save as template" on `JournalsScreen`. Due depreciation runs are listed and link to
`DepreciationRunsScreen`. Registers a `CommitmentSource` for E1-02. Ref: QBO recurring (reminder type),
Xero repeating journals, Odoo auto-post. Reviewers: accountant, chartered-accountant, fixed-assets-accountant.
Flag: no timer, per §3.3.

**E2-01 ETA pre-validation** — `eta/prevalidate.ts` rules: issuer config, activity/branch codes, EGS/GS1 code
per item, unit and tax-subtype mapped, buyer TIN (B2B) / national id above threshold, and the payload
recomputed against the invoice totals. Runs at confirm (warns) and before enqueue/submit (blocks).
`POST /eta/submissions/:id/requeue` regenerates the payload after a fix; bulk requeue+submit;
`GET /eta/reports/rejections`. Ref: ETA portal validation, Odoo l10n_eg_edi. Reviewers: tax-expert, accountant,
chartered-accountant. Flags: DEC-10 (no compliance claim; production filing still waits for the signing agent);
the owner's preprod ETA credentials are needed to prove resubmission.

**E2-10 SoD** — `permissions/sod.ts`: conflicting pairs (voucher create/approve, invoice create/void, journal
post/period close-reopen, bank-rec match/finalize, user/role admin vs any posting, item price edit vs sale,
adjustment create/approve). Role save and user assignment return 409 listing the conflicts unless the request
carries `acknowledge + reason`, which is audited. `GET /security-reports/sod`: role-level conflicts plus
transactional conflicts from the audit trail (same actor on both sides of one entity). The report is rendered
through `ReportRunner` (DEC-22). Ref: QB Enterprise roles, COSO/ISA 315; SMB comparators lack it.
Reviewers: internal-auditor, security-officer, chartered-accountant, it-admin.

**E1-04 Guided close** — `period-close/` check registry: drafts dated in the period, sub-ledger ties = 0 at
period end, bank statements finalized through period end per bank, FX reval run if foreign balances,
recurring drafts posted, depreciation posted if assets, no sequence gaps, no ETA errors. The lock route refuses
while any check fails, unless given an override reason (audited). The close summary stores a trial balance
snapshot + SHA-256 + closer. `PeriodCloseScreen`, where each red check links to the screen that fixes it.
Ref: QBO closing date + override password, Odoo lock dates, NetSuite close checklist. Reviewers: accountant,
chartered-accountant, internal-auditor, fixed-assets-accountant.

**E2-08 Price floor** — `pricing-guard/` rules by item/category/customer group: floor price, min margin % over
the **server-side** WAC at the document date. Evaluated at quote save/confirm and invoice confirm; modes are
block or route to the approval workflow (`DocumentWorkflowGate`). `POST /pricing-guard/evaluate` is preview
only. The quote and invoice forms show live line margin. Below-floor override report. Ref: Odoo margins +
pricelists, Daftra minimum selling price. Reviewers: sales-manager, internal-auditor, cost-accountant, owner.
The POS use of these rules belongs to the POS plan.

**E2-04 Expiry/FEFO** — enforce `trackBatches/trackExpiry` on GRN confirm, work-order output and positive
adjustments. `GET /reports/inventory/batches`; `GET /inventory/fefo-preview` on transfers; near-expiry event
+ notification rule; batch/expiry on the printed invoice (print templates, not `SalesInvoicesScreen`); the
EXPIRY write-off flow from the expiring report. Ref: Odoo lots + FEFO removal strategy, QB Enterprise lot +
expiry, Daftra batches. Reviewers: warehouse-keeper, client-pharmacy, cost-accountant, client-restaurant.

**E2-09 AR dunning** — `collections/`: policy steps (days overdue → channel + Arabic template), a
`POST /collections/dunning-run` that prepares reminders idempotently per (invoice, step), a worklist over
invoice AR and installments, promise-to-pay (kept or broken, read from allocations), and a statement send.
The dispatcher gains customer-addressed email. WhatsApp is a `wa.me` link (no provider); SMS waits on a
provider. The customer 360 gets a collections tab. Ref: Odoo follow-up levels, QBO invoice reminders.
Reviewers: credit-controller, sales-manager, owner, accountant, arabic-linguist. Flags: §3.3 auto-send, SMS/WhatsApp API money.

**E2-03 Scanner count** — count sessions get zones (item category or ad hoc) and assigned counters; a
`CountModeScreen` built for keyboard-wedge scanners and big keypads, usable on a paired till at 360 px;
per-scan audit, live variance, recount flag, approve, then post through the existing reasons. Ref: Odoo
Barcode, QB Enterprise mobile barcode. Reviewers: warehouse-keeper, client-wholesale, internal-auditor, a11y,
designer. Flag: no phone-over-LAN on desktop.

*Built (2026-10-17).* Sessions are zoned (`physical_count.zoned`, `physical_count_zone`, append-only `physical_count_scan`); the
count-mode API lives at `/inventory/count-mode` and the screens at `count-mode` (counters) and `count-review` (supervisors).
A zoned count accepts quantities only as scans (the classic sheet refuses typed totals), counters see only their assigned
zones, a blind count shows live variance only to a reviewer who is not counting, a zone cannot be reviewed or approved by
anyone who counted in it, and `complete` waits for every zone to be approved before the existing `generate-adjustment` posts
the variance. Permissions: `inventory.count.scan`, `.assign`, `.review`, `.approve` (SoD pair scan/approve). **Flag, not built:**
phones are not supported over the desktop LAN (the screen is for a paired till or a cloud tenant), and weight- or
price-embedded EAN barcodes are not parsed — only the item's stored barcodes and its code resolve.

**E2-11 Provisioning** — `roles/templates.ts` (Cashier, Accountant, Warehouse keeper, Sales rep, Manager,
Auditor-read-only), each validated against the catalog and **SoD-clean** (E2-10). `POST /roles/from-template`,
`POST /users/import` (dry run, row errors, one-time PIN sheet), `POST /users/:id/clone`. Ref: QB Enterprise
predefined roles, QBO role templates, Odoo CSV import. Reviewers: it-admin, security-officer,
implementation-consultant, internal-auditor.

**E3-03 Reorder** — `item_warehouse_policy(min,max,leadDays)`; velocity from sales-by-item over N days;
suggested qty = max − (on hand + on order − reserved), rounded to the purchase unit; a worklist ranked by days
of cover; draft POs grouped by (supplier, warehouse) through the PO domain service. Emit `LOW_STOCK_DETECTED`
on a posting that crosses the point (fixes the unwired event). Ref: Odoo reordering rules, QB Enterprise
reorder points. Reviewers: procurement, warehouse-keeper, client-wholesale, owner.

**E3-04 Van reconciliation** — expected qty = loaded − van-warehouse invoices + returns during the trip;
expected cash includes rep collections. Settle, then approve, which posts a TRANSFER van→main for the counted
stock and a SHORTAGE adjustment on the van (DEC-19, approval gate). Rep/day performance report. Removes the
stale "MVP simplification" comment. Ref: DEC-19 (Daftra's receiving side), distribution packages.
Reviewers: client-wholesale, warehouse-keeper, treasury-cashier, internal-auditor, cost-accountant.

**E3-06 CRM pipeline** — opportunity `ownerUserId`, `lostReason`; "create quote from opportunity"
(`quote.opportunityId`); a subscriber marks the opportunity won on quote accept/convert; weighted forecast by
close month; activity-due reminders; fix the `Number()` money. Ref: Odoo CRM (expected revenue × probability,
lost reasons). Reviewers: sales-manager, owner, end-user, designer.

**E3-08 Evidence pack** — `User.accessExpiresAt`, enforced in `session-auth.ts`, plus the auditor template;
a sequence-gap report (issued numbers vs documents, including voids); `POST /audit/evidence-packs` builds CSVs
(TB, GL detail, sub-ledger reconciliation, aging, sequence gaps, audit extract + chain verdict, SoD, close
summaries), a `manifest.json` of SHA-256 hashes, and an Ed25519 signature from a per-install evidence key.
It is zipped with **`fflate` (new dependency)** and checked by `pnpm evidence:verify`. Ref: QBO accountant
access, QB Accountant's Copy, Odoo audit trail/FEC. Reviewers: chartered-accountant, internal-auditor,
security-officer, tax-expert. Flag: "signed" ≠ legally qualified signature.

**E3-02 Digest** — `owner-digest/` composes the cockpit figures + exceptions (voids, large discounts,
negative-margin and below-floor lines, after-hours activity, van variances). Owner-scoped threshold rules;
the in-app digest is built at first open after day end; email goes to the outbox (see conflict). Ref: Odoo
KPI digest emails. Reviewers: owner, product, arabic-linguist, it-admin.

**E3-10 Health console** — `GET /system/health` (outbox depth, ETA queue/errors, audit chain, licence/seats,
LAN sessions with `appVersion` and last seen) + IPC `mezan:health:snapshot` (DB/WAL size, last backup and
drill). Degraded rules raise notifications. `SystemStatusScreen` is rebuilt as the console. Ref: QB Database
Server Manager, Foodics device status. Reviewers: it-admin, support-agent, performance-engineer, implementation-consultant.

**E3-09 Integration API (cloud only)** — a licensable module `integrations`. (a) Hashed, scoped API keys per
tenant, `/api/v1` REST (customers, items, stock, draft sales invoices), OpenAPI, mounted **only in
`apps/server/src/cloud-app.ts`**. (b) Signed webhooks from the event bus with retries and a delivery log, a
generic e-commerce order import, and an integration log. Guard test: `createBackend` exposes no
`/api/v1`, `/api-keys` or `/webhooks`, and `lan-host.ts` allow-list unchanged. Ref: DEC-17 (Daftra
REST+Zapier, QBO/Xero webhooks). Reviewers: security-officer, it-admin, product, owner, client-accounting-office.

**E3-01 Remote glance** — cloud edition: `GlanceScreen` (phone-first, read-only, cockpit DTO), permission
`dashboard.glance.view`, glance role template. Desktop: the E3-02 digest email is the remote view until a DEC
chooses a relay. Reviewers: owner, client-accounting-office, security-officer, designer, a11y.

**E3-07 Funnel/leaderboard** — `reports/sales-funnel.ts` (opportunity→quote→accepted→invoiced→collected,
with aging per stage) and `reports/rep-leaderboard.ts` (revenue, GM from COGS lines, conversion, collection %,
DSO), plus a commission-basis CSV, via `ReportRunner`. Ref: Odoo pipeline/sales analysis. Reviewers:
sales-manager, reports-analyst, owner.

## 3. Waves (≤4 lanes; same-wave lanes share no file)

W0 (1 day): **seams**. Per-lane fragment files and one import each in `create-backend.ts`
(`mountEnhancements(ctx)` with typed stores + `sqlite` + `addCloser`), `packages/{domain,persistence,contracts}/src/index.ts`,
`api/module-gate.ts` (prefix fragment), `permissions/catalog.ts` + `permission-labels.ts`, `i18n/catalog.ts`
(spread `ar`/`en` fragments), `nav-config.tsx` + `nav-icons.tsx` + `router/screens.ts`,
`e2e/support/screen-catalog.ts` (parse the nav fragments), `demo-seed.ts`, `scripts/run-scenarios.ts`,
`scripts/smoke.ts`. Every fragment starts empty; there are no placeholder screens.

| Wave | Lane | IDs | Days |
|---|---|---|---|
| 1 | L1 / L2 / L3 / L4 | E1-05 / E1-06 / E1-02 / E1-03 | 3 / 3 / 2 / 3 |
| 2 | L1 / L2 / L3 / L4 | E1-01 / E2-02 / E2-01 / E2-10 | 3 / 2 / 3 / 3 |
| 3 | L1 / L2 / L3 / L4 | E1-04 / E2-08 / E2-04 / E2-09 | 3 / 3 / 3 / 3 |
| 4 | L1 / L2 / L3 / L4 | E2-03 / E2-11 / E3-03 / E3-04 | 3 / 2 / 3 / 3 |
| 5 | L1 / L2 / L3 | E3-06 / E3-08 / E3-02 | 3 / 3 / 2 |
| 6 | L1 / L2 / L3 / L4 | E3-10 / E3-09a / E3-01 / E3-07 | 2 / 3 / 2 / 2 |
| 7 | L1 | E3-09b | 3 |

Main files per lane are in §2. The overlaps that decide placement: E2-10 (W2) and E2-11 (W4) both edit
`roles-routes.ts`/`users-routes.ts`; E2-08 (W3) owns `SalesInvoicesScreen.tsx`, so E2-04 prints batches through
the print templates instead; E2-04 (W3) and E3-02 (W5) both edit `events/catalog.ts`; E3-09a and 09b both
edit `cloud-app.ts`. Why things land when they do: E1-04 waits for E1-03, E2-02 and E1-05. E3-02 waits for
E1-01 and E2-08. E3-08 waits for E1-05, E2-10, E1-04 and E2-11. E3-01 and E3-09 wait for E1-06 (DEC-15).
E2-04, E3-03 and E3-04 ship close together (§7 principle 4).

Wave close (integrator, not a lane): merge, rerun the full done-definition on the merged tree, update ROADMAP
§7/§5 and TESTING.md §16 from the lane notes.

## 4. Decision conflicts
E3-09 vs DEC-17 (cloud-only module; a new DEC re-opens it; §4.4 claim changes only when it ships).
E3-01 vs DEC-15 (after E1-06; desktop relay undecided). E2-09/E3-02 vs §3.3 operator-drain.
E2-03 phone scanner vs the LAN allow-list. E2-01 vs DEC-10 claims. DEC-14 codes land with their routes.
DEC-20 «غير مخصص» on any branch view.

## 5. Needs the owner's accounts or money
SMS gateway; WhatsApp Business API via a BSP; an off-site/S3 backup target; relay hosting for a desktop glance;
cloud hosting; e-commerce partner accounts (Shopify/Salla/Zid); ETA preprod credentials; test scanners; a
licensed CA certificate if the evidence pack must be legally signed. Bank feeds are not available (no Egyptian
SMB open-banking API).

## 6. Defects found while planning (file on main per §5.1)
1. The portable backup cannot be imported (`decryptFile` has no non-test caller; INSTALL.md claims it restores on new hardware). Fixed in W1-L2.
2. `LOW_STOCK_DETECTED` can be selected in a rule and is never emitted. Fixed in W4-L3.
3. `PipelineScreen.tsx:255` `Number()` on money. Fixed in W5-L1.
4. Van settlement's expected stock ignores van sales. Fixed in W4-L4.
5. `trackBatches/trackExpiry` are enforced nowhere. Fixed in W3-L3.
6. `.claude/skills/mezan-erp/SKILL.md` says tests are disabled, which TESTING.md §1 reversed. Fix in W0.
