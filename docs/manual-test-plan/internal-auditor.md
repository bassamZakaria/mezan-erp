# Manual test plan — Internal Auditor (fraud & abuse)

Grounded against the running code, read directly for this pass: `packages/api/src/{sales-returns,purchase-returns,vouchers,sales-invoices,purchases,suppliers,customers,users,roles,workflow,fiscal-periods,stock-documents,price-lists,promotions,cheques,audit,reports,financial-reports,items}-routes.ts`;
`packages/api/src/{permission-gate,session-auth}.ts`; domain in
`packages/domain/src/{documents/status.ts,sales-invoices/status.ts,sales-returns/*,roles/save-role.ts,users/save-user.ts,workflow/{gate,config}.ts,permissions/catalog.ts}`;
contracts in `packages/contracts/src/{stock-documents,cheque,users}.ts`; seed roles in
`packages/backend/src/demo-seed/access.ts`; composition root
`packages/backend/src/create-backend.ts`.

This is authorized testing of the product's own controls: every scenario below assumes an
attacker who is an authenticated, legitimately-provisioned employee — never an external
intruder — because that is the actual fraud population a controls review defends against.
Every scenario states both the UI attempt (what a dishonest clerk clicks) and the direct-HTTP
attempt (what the same clerk sends with `curl`/Postman using their own real session token) —
a hidden button is not a control if the route behind it still answers 200.

All scenarios assume the seeded demo tenant (`MEZAN_SEED_DEMO=1`, tenant "Cyag") unless a
scenario builds its own fixture as an explicit step. Seed roles referenced throughout (all in
`access.ts`): `ACCOUNTANT`, `WAREHOUSE_KEEPER`, `SALES_REP`, `SUPERVISOR`, `FINANCE_MANAGER`,
`PURCHASING_OFFICER`, `TREASURY_CASHIER`, `HR_OFFICER`, `PAYROLL_OFFICER`, `BRANCH_MANAGER`,
`AUDITOR`. Seed data: customers `CUST-DEMO-1/2/3`, supplier `SUPP-DEMO-1/2`, invoices
`INV-DEMO-1..6`, purchase invoices `PI-DEMO-1,6,7`, items `ITEM-DEMO-1..8`, warehouses
`WH-MAIN`, `WH-DEMO-2`, `WH-DEMO-VAN`, `WH-DEMO-TRANSIT`, branch `BR-MAIN`.

**Auth model note (read before every scenario below) — CORRECTED 2026-08-30.** An earlier
version of this note said the header-trusting resolver was "not reachable in the shipped
desktop/LAN edition." **That is false**, and a test now proves it:
`apps/desktop/src/main/lan-host.test.ts` builds the app from the exact composition
`apps/desktop/src/main/index.ts` ships — `createApp(uow, { lan })` with no
`resolveAuthContext` — starts the real LAN socket, and posts a journal entry into the books
**with no credential of any kind** (D109, compounding the ungated legacy route D99).

So there are two threat models here, not one:

- **The server edition** (`create-backend.ts`, which `apps/server` runs) does wire
  `createSessionAuthContextResolver`: permissions come from a session token and an
  `x-permissions` header is inert. Against that composition, every "direct HTTP" step below
  means *the same signed-in user's real session token, replayed with a hand-crafted body* —
  an inside job.
- **The desktop edition, and the LAN socket it opens for other tills**, resolves permissions
  from whatever the caller writes in a header. Against that composition the attacker need not
  be an employee at all — anyone on the shop wifi will do. **Read D109 as the most severe
  finding in this plan**, ahead of every insider scenario below, until it is closed.

---

## A — Price, cost and discount abuse

### MTP-FRD-01 — Sell below cost by editing the unit price directly, not through "discount"
- **Attacker / role:** SALES_REP (`sales.invoice.create`) — no `sales.price.override`, no
  `pos.discount.approve`.
- **Preconditions:** seeded tenant. `ITEM-DEMO-1` has a normal sale price well above its WAC.
- **Steps:**
  1. UI: open **فاتورة مبيعات جديدة**, add `ITEM-DEMO-1`, and try typing a unit price far
     below cost directly into the السعر field (not the خصم field).
  2. Direct HTTP: `POST /sales-invoices` with `lines: [{ itemId: "ITEM-DEMO-1", qty: "1",
     unitPrice: "0.01", ... }]` and no `discountType`/`discountPercent`/`discountAmount` on
     the line at all, using the SALES_REP's own session token.
  3. `POST /sales-invoices/:id/confirm`.
- **Expected:** a unit price far under cost with no discount field set should require the
  same elevated permission a discount-to-nothing requires, or at minimum be flagged.
- **Observed:** `refuseUnapprovedDiscount` (`sales-invoices-routes.ts:486-514`) only inspects
  `line.discountType`/`discountPercent`/`discountAmount` and treats a line as a "giveaway"
  only when `unitPrice.scaled === 0n` exactly. A unit price of `0.01` (or any value above
  zero but below cost) trips neither the giveaway check nor the ceiling check — there is no
  price-list cross-check on `unitPrice` at all. The invoice posts at whatever price the
  request names.
- **False pass:** the UI's price field might be disabled/read-only for SALES_REP by a
  front-end guard, making the attack look blocked — the direct-HTTP step proves the route
  accepts it regardless.

### MTP-FRD-02 — Bypass the discount ceiling by using an amount discount instead of a percent one
- **Attacker / role:** SALES_REP, same as above.
- **Preconditions:** tenant's `maxLineDiscountPercent` ceiling is, say, 10% (`discountPolicy`,
  `sales-invoices-routes.ts:491`).
- **Steps:**
  1. Price a line of `ITEM-DEMO-1` at its normal price, qty 1.
  2. Direct HTTP: `POST /sales-invoices` with that line's `discountType: "amount"` and
     `discountAmount` computed to be ~60% of the line's gross (well over the 10% ceiling, but
     under the 100%-giveaway threshold checked at `sales-invoices-routes.ts:496-502`).
  3. Confirm without holding `pos.discount.approve`.
- **Expected:** any discount above the ceiling — percent or amount — should require
  `pos.discount.approve`.
- **Observed:** the ceiling check at `sales-invoices-routes.ts:516-518` reads
  `line.discountType === "percent" && (line.discountPercent ?? 0) > ceiling` — an
  `discountType: "amount"` line is never compared to the ceiling. Only a header-level
  `discount.type === "percent"` is checked too; a header-level `discount.type: "amount"` has
  the same hole. A clerk who knows this needs no elevated permission at all to give away 60%
  of a line.
- **False pass:** the UI's discount widget may only expose a percent input, hiding the amount
  path — the raw request body still accepts `discountType: "amount"`.

### MTP-FRD-03 — Header-level amount discount, same bypass
- **Attacker / role:** SALES_REP.
- **Preconditions:** as MTP-FRD-02.
- **Steps:** `POST /sales-invoices` with `discount: { type: "amount", amount: "<60% of the
  invoice total>" }` at the document level instead of per line.
- **Expected:** same as MTP-FRD-02.
- **Observed:** identical gap — `overCeiling` (`sales-invoices-routes.ts:516-518`) only
  inspects `body.discount?.type === "percent"`.
- **False pass:** same as MTP-FRD-02.

### MTP-FRD-04 — Overbill a supplier with a fabricated purchase-invoice cost, no PO or receipt
- **Attacker / role:** PURCHASING_OFFICER (`purchases.invoice.create`; `purchases.invoice
  .confirm` is not held by this role in the seed — pair with a second colluding
  FINANCE_MANAGER, or see the single-person variant at MTP-FRD-27).
- **Preconditions:** `SUPP-DEMO-1` exists.
- **Steps:**
  1. UI: on **فاتورة مشتريات جديدة**, try to enter a unit cost above the supplier's usual
     price for `ITEM-DEMO-1` with no purchase order or goods receipt behind it.
  2. Direct HTTP: `POST /purchases/invoices` with an explicit `lines` array (not
     `receiptId`) carrying an inflated `unitCost` (`purchases-routes.ts:1002`) for a real
     item and `supplierId: "SUPP-DEMO-1"`.
  3. `POST /purchases/invoices/:id/confirm` (`purchases-routes.ts:1050`, needs
     `purchases.invoice.confirm`).
- **Expected:** an invoice with no PO/receipt lineage and a cost outside a tolerance band
  should be flagged or require extra approval before it posts a payable.
- **Observed:** `purchases-routes.ts:1002-1032` — when the request carries `lines` directly
  rather than `receiptId`, `unitCost` is taken verbatim from the client with no cross-check
  against any PO, RFQ, or catalogue reference cost. This is the AP-side mirror of
  MTP-FRD-01/02: the classic vendor-overbilling / kickback shape, and nothing in the route
  or the domain validator catches it.
- **False pass:** the UI may default to the "from receipt" flow and never expose a bare
  `lines` form — the route still accepts it directly.

### MTP-FRD-05 — Edit a price list silently, with no audit trail
- **Attacker / role:** any role holding `sales.price_list.manage` (a single permission gates
  create, edit, activate and deactivate — `price-lists-routes.ts:127,155,186,195`).
- **Preconditions:** a price list exists (`GET /price-lists`).
- **Steps:**
  1. UI or direct HTTP: `PATCH /price-lists/:id` lowering every line's price by 40%.
  2. `GET /audit?entityType=PRICE_LIST` immediately after.
- **Expected:** a price-list change is master data with revenue impact across every future
  invoice off that list — it should be logged with who changed which price, like the
  supplier/customer/role/user routes are.
- **Observed:** `createPriceListsRoutes` (`price-lists-routes.ts:73-80`) takes no `audit`
  parameter at all and never calls `recordAdminEvent`. The change succeeds and leaves no row
  anywhere in the audit trail.
- **False pass:** none — this is a plain absence, verifiable by reading the route's
  parameter list and the empty `GET /audit` result.

### MTP-FRD-06 — Create a promotion with no discount ceiling and no audit trail
- **Attacker / role:** any role holding `sales.promotion.manage`.
- **Preconditions:** none.
- **Steps:**
  1. Direct HTTP: `POST /promotions` with `type: "percent"`, `percentValue: 90`, no
     `maxDiscountAmount`, `scope` covering all items.
  2. Use `POST /promotions/evaluate` (gated only on `sales.invoice.create`,
     `promotions-routes.ts:277`) or a real invoice to confirm it applies a 90% discount with
     no `pos.discount.approve` check anywhere in the promotions path.
  3. `GET /audit?entityType=PROMOTION`.
- **Expected:** a promotion this aggressive should hit the same discount-ceiling control an
  ad hoc invoice discount does, and its creation should be logged.
- **Observed:** `createPromotionsRoutes` (`promotions-routes.ts:97-106`) never wires an
  `audit` sink, and nothing in the route or `createPromotion` compares `percentValue` against
  `discountPolicy`'s ceiling — the two discount paths (manual line discount vs. a promotion)
  are enforced by two different, inconsistent rules.
- **False pass:** the promotion-builder screen may cap the percent input in the browser —
  the raw request accepts any value the domain validator (`InvalidPromotionError` reasons,
  not ceiling-related) does not reject.

### MTP-FRD-07 — Control check: server-side price/discount override still holds for a zero price
- **Attacker / role:** SALES_REP.
- **Preconditions:** none.
- **Steps:** Direct HTTP `POST /sales-invoices` with a line at `unitPrice: "0"` and the
  SALES_REP's real session (no `sales.price.override`).
- **Expected:** 403 `PERMISSION_DENIED` naming `sales.price.override`.
- **Observed:** this one DOES hold — `sales-invoices-routes.ts:494` catches the exact-zero
  case, so this scenario documents a real control, not a gap. Included to show the auditor
  what "recomputed server-side" looks like when it is done right, in contrast to
  MTP-FRD-01/02/03 where the same idea was left half-built.
- **False pass:** n/a — this is a positive-control verification.

### MTP-FRD-08 — Invented item id on a quote/invoice line (D38, still open)
- **Attacker / role:** SALES_REP.
- **Preconditions:** none.
- **Steps:** `POST /sales-invoices` (or `/sales-quotes`) with `lines[0].itemId: "FAKE-ITEM-X"`,
  a price and quantity of the attacker's choosing.
- **Expected:** an unknown item id should be rejected before it can post revenue with no
  catalogue backing (and no COGS/stock movement to match it).
- **Observed:** per the defect register (`docs/ROADMAP.md §5`, D38, still open at last sweep)
  no route validates `itemId` against the item catalogue; an invented id posts a 201. Combine
  with MTP-FRD-01 and a clerk can invoice a phantom high-value "item" at a price of their
  choosing with no stock ever leaving a warehouse to explain it.
- **False pass:** the item picker in the UI only lists real items — the raw request accepts
  any string.

---

## B — Backdating

### MTP-FRD-09 — Backdate a stock-reducing document into an already-reviewed day, same open period
- **Attacker / role:** WAREHOUSE_KEEPER (`inventory.adjustment.create`, `.confirm`).
- **Preconditions:** fiscal period covering today is `open` (`GET /fiscal-periods`).
- **Steps:**
  1. UI: try to set the تاريخ field on a new stock adjustment to 10 days in the past.
  2. Direct HTTP: `POST /stock-documents/adjustments/draft` (`stock-documents-routes.ts:213`)
     with `date` 10 days before today, `direction: "OUT"`, `reason: "OTHER"`, no memo.
  3. `POST /:id/confirm`.
- **Expected:** a document dated well before its creation date should either be blocked
  outright or trigger something a reviewer would see later (a flag, a report row, a required
  extra approval) — not post identically to a same-day document.
- **Observed:** the only gate is the fiscal-period check (`NoFiscalPeriodForDateError`,
  `PeriodNotOpenForPostingError`) — as long as the target period is open, any past date
  within it is accepted with no extra control, and stock movements post dated to the
  document's `date`, not the wall clock (fixed per the defect register, which cuts both
  ways: correct for accounting, and exactly the mechanism needed to cover a shortage that
  happened days ago by dating the "adjustment" to match). Nothing records `createdAt` vs.
  `date` as a flagged fact anywhere a reviewer would see it (see MTP-FRD-50).
- **False pass:** a UI date-picker that defaults to "today" and requires extra clicks to go
  back does not constitute a control — the direct-HTTP step proves the route accepts any
  in-period date.

### MTP-FRD-10 — Backdate a sales return + refund to cover a shortage discovered late
- **Attacker / role:** SUPERVISOR (`sales.return.confirm`) plus TREASURY_CASHIER
  (`treasury.customer_refund.create`), or one person if a tenant ever combines them (see
  Section E).
- **Preconditions:** `INV-DEMO-1` confirmed, dated in the past.
- **Steps:** `POST /sales-returns/from-invoice` with a `date` matching the original invoice
  date (not today), confirm, then `POST /sales-returns/:id/refund` with the same backdated
  `date`.
- **Expected:** same fiscal-period-only gate as MTP-FRD-09 — a backdated return + cash-out
  pair is exactly the "stock issue + backdating covers theft" combination the review brief
  calls out, and there is no additional control on it.
- **False pass:** none noted beyond the general fiscal-period gate.

### MTP-FRD-11 — Reopen a closed period to slip in a document, then reclose it
- **Attacker / role:** a role holding both `accounting.period.close` and
  `accounting.period.reopen` — FINANCE_MANAGER in the seed holds `.close` but not `.reopen`
  (clean separation in the seeded tenant); test the combination directly.
- **Preconditions:** a fiscal period is `closed`.
- **Steps:**
  1. `POST /fiscal-periods/:id/reopen`.
  2. Post/backdate a document into that period.
  3. `POST /fiscal-periods/:id/close` again.
  4. `GET /audit?entityType=FISCAL_PERIOD`.
- **Expected:** reopen-then-reclose around a single document is legitimate for genuine
  corrections, but is also exactly how a closed, already-reviewed month gets a fraudulent
  entry slipped in after the fact — the audit trail is the only thing that can tell the two
  apart.
- **Observed:** `fiscal-periods-routes.ts:119-128` does log REOPEN/CLOSE with `previousStatus`
  via `recordAdminEvent` — the control that exists is the audit row, not a barrier to the
  reopen itself. This is a genuine, working control (append-only audit, `audit-routes.ts`
  has no PATCH/DELETE) — but it only works if the exception report in Section J actually
  surfaces "period reopened" events, which it does not (no report reads the audit stream).
- **False pass:** believing the audit row alone is a control — without a report that
  surfaces it, the row sits unread until someone happens to query `/audit` by hand.

### MTP-FRD-12 — VAT-filed period refuses a backdated entry (control check)
- **Attacker / role:** ACCOUNTANT.
- **Preconditions:** a VAT period has been filed (per the defect register's "two new locks
  on posting").
- **Steps:** attempt to post a journal entry or invoice dated inside the filed VAT period.
- **Expected:** refused, requiring the filing to be amended first with a reason.
- **Observed:** per the register this control is in place and closed — included here as a
  positive-control check the auditor should re-verify live rather than take on faith.
- **False pass:** n/a.

---

## C — Deletion, cancellation and void integrity

### MTP-FRD-13 — Try to cancel (not reverse) a confirmed, paid sales invoice
- **Attacker / role:** SALES_REP or SUPERVISOR (`sales.invoice.delete_draft`).
- **Preconditions:** `INV-DEMO-1` confirmed and (partially) paid.
- **Steps:**
  1. UI: look for any void/delete control on a paid invoice's detail screen.
  2. Direct HTTP: `POST /sales-invoices/:id/cancel` on a `confirmed`/`partially_paid`/`paid`
     invoice, using a session that holds `sales.invoice.delete_draft`.
- **Expected:** refused — a live invoice may only be corrected via return/reversal, never
  deleted.
- **Observed:** control holds. `SALES_INVOICE_TRANSITIONS` (`sales-invoices/status.ts:15-27`)
  has no `confirmed|partially_paid|paid → cancelled` edge; `assertTransition` throws
  `InvalidSalesInvoiceTransitionError`. There is also no `/reverse` route mounted for sales
  invoices at all (`sales-invoices-routes.ts`'s doc comment lists only create/list/confirm/
  cancel/payments) — the only correction path is a sales return, which is itself a numbered,
  auditable document.
- **False pass:** n/a — genuine control, worth a periodic live re-check since it is the
  single most load-bearing invariant in the whole system.

### MTP-FRD-14 — Try to cancel a confirmed treasury voucher instead of reversing it
- **Attacker / role:** TREASURY_CASHIER (`treasury.cash_voucher.void` — note the seed gives
  cashier only `.create`/`.confirm`, not `.void`; FINANCE_MANAGER holds `.void` by design,
  "reversing money is deliberately here and NOT with the cashier who raised it",
  `access.ts:135-137`).
- **Preconditions:** a confirmed voucher, e.g. `VCH-DEMO-1`.
- **Steps:** `POST /vouchers/:id/cancel` on a confirmed voucher.
- **Expected:** refused; only `/reverse` is legal on a confirmed document.
- **Observed:** control holds — `DocumentService.cancel` → `assertTransition` (generic
  framework, `documents/status.ts:54-61`) has no `confirmed → cancelled` edge.
- **False pass:** n/a.

### MTP-FRD-15 — Delete a role or a workflow config to remove evidence of an override
- **Attacker / role:** a role holding `admin.roles.manage` or `workflow.config.manage`.
- **Preconditions:** a custom role or workflow config exists that this actor's own escalation
  (Section E) depends on.
- **Steps:**
  1. `DELETE /roles/:id` (`roles-routes.ts:147`) on the role just used to self-elevate.
  2. `DELETE /workflow/configs/:id` (`workflow-routes.ts:164`) on the approval chain for
     `PURCHASE_INVOICE_CONFIRM` or `SALES_INVOICE_CONFIRM`, removing the maker-checker gate
     right before posting a fraudulent document, unconfirmed whether it is re-added after.
  3. `GET /audit?entityType=ROLE` / `?entityType=WORKFLOW_CONFIG`.
- **Expected:** deleting a role or a workflow config is itself sensitive and should be logged
  with who and when, and ideally itself require a second approval given what it removes.
- **Observed:** role deletion IS logged (`roles-routes.ts:147-158`, `recordAdminEvent` with
  the deleted role's former permission list) and a role still assigned to a user cannot be
  deleted (`RoleInUseError`) — a real, working control. Workflow-config deletion
  (`workflow-routes.ts:164-171`) has **no audit call at all** — `deleteWorkflowConfig` runs
  and the route returns 204 with nothing recorded anywhere. An approval chain can be silently
  switched off.
- **False pass:** believing "roles are audited" covers workflow configs too — they are two
  different routes with two different (in)fidelities.

### MTP-FRD-16 — Attachments: delete supporting evidence off a posted document
- **Attacker / role:** whoever the attachments module gates on — flagged for live
  confirmation of `attachments-routes.ts:162`'s `DELETE /:id` gate.
- **Preconditions:** an attachment (e.g. a scanned delivery note) is linked to a confirmed
  document.
- **Steps:** `DELETE /attachments/:id`.
- **Expected:** deleting supporting evidence for a posted financial document should be
  logged, ideally blocked once the parent document is confirmed.
- **Observed:** flagged for the auditor to re-check live — `attachments-routes.ts:162` is the
  one `DELETE` route in the codebase whose permission gate was not confirmed in this pass;
  verify it is gated and audited before relying on attachments as evidence.
- **False pass:** an attachment "delete" that is actually a soft-delete/archive in the UI but
  a hard delete over HTTP.

### MTP-FRD-17 — Purchase/sales return cancel, not reverse, on a confirmed return
- **Attacker / role:** whoever holds `sales.return.void` / `purchases.return.void`.
- **Preconditions:** a confirmed return exists.
- **Steps:** `POST /sales-returns/:id/cancel` (`sales-returns-routes.ts:343`) or the purchase
  equivalent on a `confirmed` document.
- **Expected:** refused, same shape as MTP-FRD-13/14.
- **Observed:** control holds — returns use the same generic `DocumentService`/
  `documents/status.ts` state machine as every other document type in this framework.
- **False pass:** n/a.

---

## D — Returns fraud

### MTP-FRD-18 — Return the same goods repeatedly by claiming the full quantity each time (control check)
- **Attacker / role:** SUPERVISOR (`sales.return.create`).
- **Preconditions:** `INV-DEMO-1`, item with a known invoiced quantity, e.g. 40 units of
  `ITEM-DEMO-1`.
- **Steps:**
  1. Direct HTTP: `POST /sales-returns` (the raw shape, not `/from-invoice`) with
     `sourceInvoiceId: "INV-DEMO-1"`, `itemId: "ITEM-DEMO-1"`, `qty: "40"`,
     `availableQty: "40"` (a client-supplied hint), confirm.
  2. Repeat the identical request a second time.
- **Expected:** the second return should be refused — only 40 units were ever sold.
- **Observed:** control holds, and this is the fix for the previously-open defect. The route
  ignores the client's `availableQty` and recomputes it server-side
  (`sales-returns-routes.ts:106-112`, wired at `create-backend.ts:1710-1744` via
  `findConfirmedInvoice`, which subtracts every prior **confirmed** return's quantity for
  that item+invoice). The second call's line fails `qty.compare(line.availableQty) > 0`
  (`sales-return-document.ts:133-139`) since the true remaining is 0.
- **False pass:** testing only through the UI's "من فاتورة" flow, which always calls
  `/from-invoice` and never exercises the raw `POST /sales-returns` a scripted attacker would
  use — both must be tried, per MTP-FRD-19.

### MTP-FRD-19 — Same quantity-cap check via the raw create route with fabricated price and cost
- **Attacker / role:** SUPERVISOR.
- **Preconditions:** as MTP-FRD-18.
- **Steps:** `POST /sales-returns` (raw, not `/from-invoice`) with a valid, server-capped
  `qty`, but `unitPrice` and `unitCost` set far above the invoice's actual per-unit price and
  cost.
- **Expected:** the money on a return should be derived from the source invoice, the same way
  the quantity now is.
- **Observed:** the quantity is capped (MTP-FRD-18), but `unitPrice`/`unitCost`/`taxAmount`
  on the raw `POST /sales-returns` route are taken verbatim from the request
  (`sales-returns-routes.ts:264-280`); the domain validator only checks they are non-negative
  (`sales-return-document.ts:140-142`), never that they match the invoice line. A return at
  an inflated price generates a larger refund entitlement than the goods are worth; at a
  manipulated cost it misstates the inventory value put back on the books. The `/from-invoice`
  route (`sales-returns-routes.ts:295-327`) derives every figure from the invoice correctly —
  it is the raw route, reachable by anyone with `sales.return.create`, that is unguarded.
- **False pass:** the UI only ever calls `/from-invoice`, so this looks closed in a browser —
  the raw route is a first-class part of the same permission surface.

### MTP-FRD-20 — Divert a sales-return refund to a customer who never returned anything
- **Attacker / role:** SUPERVISOR (`sales.return.create`, `.confirm`) plus
  `treasury.customer_refund.create` (TREASURY_CASHIER, or combined via Section E).
- **Preconditions:** create a second customer the attacker controls, `CUST-DEMO-LEAD4` or a
  fresh one via `POST /customers`; `INV-DEMO-1` belongs to `CUST-DEMO-1`.
- **Steps:**
  1. `POST /sales-returns` (raw) with `sourceInvoiceId: "INV-DEMO-1"` (really `CUST-DEMO-1`'s
     invoice), a real `itemId` from that invoice, a server-capped `qty`, but
     `customerId: "<attacker's own customer id>"`.
  2. Confirm the return.
  3. `POST /sales-returns/:id/refund` — the refund posts to whichever customer the return's
     lines carry (`sales-returns-routes.ts:372`, `doc.lines[0]?.customerId`), paying out a
     real رد مبلغ لعميل voucher against `1105` for that customer.
- **Expected:** a return's customer should be pinned to the source invoice's actual customer,
  the same way its quantity is now pinned to the invoice's actual remaining balance.
- **Observed:** nothing does this. `resolveAvailableQty` (`sales-returns-routes.ts:106-112`
  and its wiring at `create-backend.ts:1710-1744`) matches on `itemId` only; the domain
  validator (`sales-return-document.ts:121-144`) only checks every line shares one
  `sourceInvoiceId`, never that `customerId` matches the invoice's `customerId`. This is the
  concrete shape of "a credit note issued to a personal account" the review brief asks for:
  goods sold to and paid for by `CUST-DEMO-1` can be "returned" under any customer id the
  attacker names, and the resulting refund voucher pays that customer — including one the
  attacker just created for themselves (see MTP-FRD-31) or a relative/accomplice.
- **False pass:** the UI's return-from-invoice flow always uses the invoice's own customer,
  hiding this — the raw route is what a scripted attacker uses.

### MTP-FRD-21 — Return goods that were never sold (fabricated source invoice line)
- **Attacker / role:** SUPERVISOR.
- **Preconditions:** an item that exists in the catalogue but was never sold on the target
  invoice.
- **Steps:** `POST /sales-returns` (raw) with `sourceInvoiceId` pointing at a real confirmed
  invoice, but `itemId` for an item not on that invoice at all.
- **Expected:** refused — there is nothing to return.
- **Observed:** control holds for this specific shape — `resolveAvailableQty` looks up
  `invoice.lines.find((il) => il.itemId === itemId)`; if the item is not on the invoice, it
  returns `Qty.zero()` (`sales-returns-routes.ts:106-112`), and the domain validator then
  refuses any `qty > 0` against a zero `availableQty`.
- **False pass:** n/a for this exact shape — but see MTP-FRD-22 for the D38 variant that
  still gets through.

### MTP-FRD-22 — Return an invented item id that was never sold, riding D38
- **Attacker / role:** SUPERVISOR.
- **Preconditions:** none — the "item" need not exist in the catalogue at all.
- **Steps:** `POST /sales-returns` (raw) with `sourceInvoiceId` real, `itemId: "FAKE-ITEM-X"`,
  a claimed `qty`, `unitCost`/`unitPrice` of the attacker's choosing.
- **Expected:** an unknown item id should be rejected the same way a known-but-not-on-this-
  invoice one is.
- **Observed:** untested directly in this pass, but consistent with D38 (no route validates
  `itemId` against the catalogue) — since `resolveAvailableQty` only looks up the item on the
  invoice and returns zero if absent, this specific attempt likely fails the same
  `qty > availableQty` check as MTP-FRD-21 (both return zero for an unmatched item). Included
  because it is the natural next thing an auditor tries after MTP-FRD-21 — verify live rather
  than assume from the code path alone; if it does fail, it is one of the few places D38's
  absence of item validation does not matter because the quantity check happens to catch it
  as a side effect.
- **False pass:** assuming D38 "is always exploitable" without checking this specific,
  quantity-gated path.

### MTP-FRD-23 — Purchase-return mirror of MTP-FRD-19/20 (supplier side)
- **Attacker / role:** PURCHASING_OFFICER (`purchases.return.create`, `.confirm`).
- **Preconditions:** `PI-DEMO-1` confirmed against `SUPP-DEMO-1`.
- **Steps:** `POST /purchase-returns` (raw, `purchase-returns-routes.ts:177-204`) with a
  server-capped `qty` (same fix as sales) but a `supplierId` different from `PI-DEMO-1`'s real
  supplier, and/or a fabricated `unitCost`.
- **Expected:** same as MTP-FRD-19/20 — supplier and cost should derive from the source
  invoice.
- **Observed:** `purchase-returns-routes.ts:177-198` builds the line straight from client
  input for `supplierId`/`unitCost`/`taxAmount`; the domain validator (mirrors
  `sales-return-document.ts`) checks quantity and non-negativity only. Purchase returns
  reduce AP, not cash directly, so the loss shape differs (understating what is owed to a
  real supplier, or crediting a fabricated one) but the code hole is identical, "same defect,
  same fix" per the file's own comment (`purchase-returns-routes.ts:55`, which fixed only
  the quantity half).
- **False pass:** same as MTP-FRD-19.

---

## E — Segregation of duties and self-granted permissions

### MTP-FRD-24 — Self-promote to full tenant admin via `PUT /users/:id`
- **Attacker / role:** any user holding `admin.users.edit` (not seeded on any demo role by
  default — construct the precondition below as a first step, which is the realistic path: a
  tenant that stands up an "Office Manager" role to manage accounts).
- **Preconditions:** as company admin, `POST /roles` a role `OFFICE_MANAGER` with
  `["dashboard.view", "admin.users.view", "admin.users.edit"]`; `POST /users` an account
  under that role; sign in as that account.
- **Steps:**
  1. UI: nothing exposes this — there is no self-edit "make me admin" control.
  2. Direct HTTP: `PUT /users/<own-id>` with `{ ...own fields, roleId: null,
     isCompanyAdmin: true }`, using the OFFICE_MANAGER account's own session.
- **Expected:** refused — a user should never be able to grant themselves (or anyone) tenant
  admin without already holding it, or at minimum without a second approver.
- **Observed:** nothing stops it. `saveUser` (`users/save-user.ts:123-161`) validates email,
  domain policy, the `isCompanyAdmin XOR roleId` shape, and PIN format — it never compares
  `cmd.isCompanyAdmin` against the CALLER's own admin status. The route
  (`users-routes.ts:139-158`) gates only on `admin.users.edit`. The change is logged
  (`auditUser`, `users-routes.ts:84-106`, records `previousIsCompanyAdmin`), so it would be
  visible after the fact to anyone who queries `/audit` — but nothing prevents the act itself,
  and the session grant is baked in at login (`create-backend.ts:1991`), so the attacker only
  needs to sign out and back in once to receive `permissions: ["*"]`.
- **False pass:** believing the audit log is a control rather than a record — it tells you
  who did it, after they already have full admin.

### MTP-FRD-25 — Self-elevate via a custom role's permission list
- **Attacker / role:** any user holding `admin.roles.manage` (again, not seeded by default;
  build the precondition the same way as MTP-FRD-24, granting `admin.roles.manage` instead).
- **Preconditions:** the attacker's own role is a non-system (`isSystem: false`) custom role.
- **Steps:** `PUT /roles/<own-role-id>` with `permissions: ["*"]` added to the existing list.
- **Expected:** refused, or at minimum capped to permissions the caller already holds
  ("cannot grant what you do not have").
- **Observed:** `saveRole` (`roles/save-role.ts:76-112`) checks every permission is
  `isKnownPermission` and, for everything except the literal wildcard, `isModuleLicensed` —
  it explicitly SKIPS the licensing check for `"*"` (`save-role.ts:85`,
  `permission !== "*" && !isModuleLicensed(...)`). There is no ceiling comparing the granted
  set to the caller's own. A role holding only `admin.roles.manage` can add `"*"` to its own
  permission list and, after the caller's next sign-in, become an unrestricted tenant admin.
- **False pass:** the role-editor screen filters out `isPlatformAdminOnly` codes
  (`RoleEditorPage.tsx:121`, `isPlatformAdminOnly` from `permissions/catalog.ts`) — that is a
  UI convenience only. `saveRole` never calls `isPlatformAdminOnly`, so the same
  `PUT /roles/:id` request that the UI would never construct still succeeds over direct HTTP,
  and can grant genuinely platform-admin-only codes (`admin.tenant.settings.edit`,
  `admin.modules.manage`) to an ordinary tenant role, not just `"*"`.

### MTP-FRD-26 — Grant a platform-admin-only permission to a tenant role via direct HTTP
- **Attacker / role:** as MTP-FRD-25.
- **Preconditions:** same.
- **Steps:** `PUT /roles/:id` with `permissions` including `"admin.tenant.settings.edit"` or
  `"admin.modules.manage"` (both `isPlatformAdminOnly: true` per
  `permissions.test.ts:41-42`).
- **Expected:** refused server-side, the same as the UI silently omits it from the picker.
- **Observed:** identical to MTP-FRD-25 — `save-role.ts` never consults
  `isPlatformAdminOnly`. This is the textbook "hidden button is not a control" case: the
  filter exists, but only client-side.
- **False pass:** confirming the UI hides the checkbox and stopping there.

### MTP-FRD-27 — Single-person "create supplier → invoice it → confirm → pay → allocate"
- **Attacker / role:** a custom role combining
  `["purchases.supplier.create", "purchases.supplier.edit", "purchases.invoice.create",
  "purchases.invoice.confirm", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm",
  "treasury.allocation.manage"]`.
- **Preconditions:** as company admin, create this role and assign it to one test account —
  note that no SEEDED role in `access.ts` combines these (PURCHASING_OFFICER has
  `purchases.invoice.create` but not `.confirm`; TREASURY_CASHIER has none of the purchases
  permissions) — the seed's separation is intentional and correct. This scenario tests
  whether the SYSTEM stops the combination, not whether the demo data happens to avoid it.
- **Steps (all as the one account, no second actor):**
  1. `POST /suppliers` — a fabricated supplier.
  2. `POST /purchases/invoices` with `lines` (no receipt/PO) naming that supplier and any
     cost.
  3. `POST /purchases/invoices/:id/confirm`.
  4. `POST /vouchers` — a `supplier_payment` voucher for the invoice amount.
  5. `POST /vouchers/:id/confirm`.
  6. `POST /vouchers/:id/allocations` against the fabricated invoice.
- **Expected:** at least one of these six steps should require a second person — either a
  structural maker-checker in the permission catalog (an explicit mutual-exclusion between
  "can create a payable" and "can pay it"), or a mandatory workflow gate on
  `PURCHASE_INVOICE_CONFIRM`/voucher confirm that names an approver role the creator does not
  hold.
- **Observed:** none of the six routes checks who performed a PRIOR step in the chain — each
  is independently permission-gated only. The only structural stop is the workflow engine
  (below), and workflow gates are **opt-in per action type**
  (`workflow/config.ts:89-111`, `saveWorkflowConfig` — a tenant with no config for
  `PURCHASE_INVOICE_CONFIRM` posts straight through, `held: false`). The permission catalog
  has no declared mutual exclusion between any two codes; segregation exists only as a
  convention the seeded roles happen to follow, never as an enforced rule. A tenant that
  configures its roles differently — plausibly a very small business "to save headcount" —
  gets zero warning that it has removed the control.
- **False pass:** citing the seed's own careful role separation as evidence the product
  enforces this — the seed is a well-behaved EXAMPLE tenant, not a constraint on any other
  tenant's role configuration.

### MTP-FRD-28 — Configure the approval chain to name your own role, or delete it
- **Attacker / role:** a role holding `workflow.config.manage`.
- **Preconditions:** none.
- **Steps:**
  1. `POST /workflow/configs` for `PURCHASE_INVOICE_CONFIRM` with a single step whose `role`
     is the attacker's OWN role code.
  2. Submit a purchase invoice for approval, then approve it themselves.
- **Expected:** self-approval should be refused even if the attacker configured the chain to
  point at their own role.
- **Observed:** control holds at the decision layer — `decide()`
  (`workflow/gate.ts:175-209`) checks `input.actorId === request.submittedBy` BEFORE the
  role/admin bypass logic and throws `SELF_APPROVAL` unconditionally, "the ADMIN BYPASS DOES
  NOT LIFT THIS" (`gate.ts:186-209`, explicit comment). This is one of the strongest controls
  found in this review — worth flagging to the accountant as a genuine strength, not a gap.
  The residual risk is COLLUSION: two people who both hold the attacker's role can submit for
  each other and clear the gate with no independent third check, and (per MTP-FRD-15) the
  whole chain can be deleted by anyone holding `workflow.config.manage` with no audit record
  of the deletion.
- **False pass:** none for self-approval specifically — see MTP-FRD-15 for the adjacent,
  real gap (deleting the config).

### MTP-FRD-29 — Submit a workflow request directly, bypassing the document route
- **Attacker / role:** any authenticated user, even one with no relevant permission at all.
- **Preconditions:** a workflow config exists for some action type.
- **Steps:** `POST /workflow/requests` directly (`workflow-routes.ts:218`, deliberately
  ungated beyond having a resolvable identity — "submitting is a side effect of whatever the
  caller was already allowed to do").
- **Expected:** submitting a request should not itself require no permission, or should at
  minimum be inert unless the caller could have performed the underlying action.
- **Observed:** the route accepts any `actionType` from the 26-entry gateable catalog from
  any signed-in user and creates a pending request under their identity — it does not itself
  post any document or move money (`submitApproval` only writes the request record), so this
  is a nuisance/spoofing vector (polluting the approvals inbox with entries for actions the
  submitter was never entitled to start) rather than a direct financial loss. Still worth
  fixing: an approver who trusts "it's in my queue, so someone with the right permission
  submitted it" is trusting an assumption the route does not enforce.
- **False pass:** assuming the inbox is a trustworthy record of "actions someone with
  permission actually initiated."

### MTP-FRD-30 — Branch/warehouse scope on the user record: widen your own reach
- **Attacker / role:** any user holding `admin.users.edit` (see MTP-FRD-24's precondition).
- **Preconditions:** the attacker's own account is currently scoped to one branch/warehouse.
- **Steps:** `PUT /users/<own-id>` with `branchScope: "*"` / `warehouseScope: "*"` (the
  `ALL_SCOPE` sentinel).
- **Expected:** widening one's own operating scope should require a different, higher
  permission than merely editing user records (`admin.users.edit` is meant for HR-adjacent
  account maintenance, not granting oneself company-wide reach).
- **Observed:** `saveUser` has no check tying scope changes to anything beyond
  `isScopeEmpty` (must be non-empty) — an `admin.users.edit` holder can set their own scope
  to `"*"` exactly as they could `isCompanyAdmin`. This compounds MTP-FRD-24: even short of
  full admin, self-widening scope alone defeats every `withinScope`/`warehouseScopeOf`/
  `branchScopeOf` narrowing used throughout the list routes (Section I).
- **False pass:** none — same route, same missing check as MTP-FRD-24.

---

## F — Master-data abuse

### MTP-FRD-31 — Create a fake customer to route a diverted refund or credit note to
- **Attacker / role:** SALES_REP or SUPERVISOR (`sales.customer.create`).
- **Preconditions:** none.
- **Steps:** `POST /customers` with a plausible-looking Arabic name, no verification of any
  kind (no tax number required, `customers-routes.ts:247-275`).
- **Expected:** fine on its own — customer creation is meant to be lightweight — but ties
  directly into MTP-FRD-20: this is the "personal account" a diverted credit note pays out
  to.
- **Observed:** `POST /customers` succeeds with minimal fields; the real loss is downstream
  at MTP-FRD-20, not here — this scenario only establishes the fixture.
- **False pass:** treating "customer creation is logged" as sufficient — the fraud is in
  where the MONEY goes afterward, not in the customer record's existence.

### MTP-FRD-32 — Create a fake supplier and self-invoice it (ties to MTP-FRD-04/27)
- **Attacker / role:** PURCHASING_OFFICER.
- **Preconditions:** none.
- **Steps:** `POST /suppliers` with a name resembling a real vendor, no tax-number
  verification, no duplicate-name check (only duplicate CODE is checked,
  `suppliers-routes.ts:172-174` — two suppliers can share a display name with different
  codes).
- **Expected:** creation itself logged (it is — `auditSupplier`, `suppliers-routes.ts:74-90`),
  but a name collision with a real supplier should at least warn, since it is the classic
  "SUPP-1 Inc." vs. "SUPPI Inc." typosquat used to intercept a real vendor's payment.
- **Observed:** only the CODE is checked for duplicates, never `nameAr`/`nameEn` — the
  fuzzy `matchesSearch` helper exists elsewhere for lookup but is never invoked as a
  duplicate-name warning on create.
- **False pass:** relying on the code being unique as if that also means the name is
  distinguishable to a human approver skimming a list.

### MTP-FRD-33 — Supplier master data has no bank-account field at all (structural gap, not a defect)
- **Attacker / role:** anyone holding `purchases.supplier.edit`.
- **Preconditions:** none.
- **Steps:** inspect `Supplier`/`updateSupplierSchema` for any bank-account/IBAN field.
- **Expected (per the review brief's dealbreaker list):** supplier bank-detail changes must
  be logged.
- **Observed:** there is no such field to change. `Supplier` carries no `bankName`/
  `bankAccountNumber`/IBAN at all — money paid to a supplier travels only as a treasury
  voucher's `referenceNo` (free text) plus whatever happens physically outside the system.
  This means the classic "change the payee bank account, redirect the wire" attack has no
  system surface here — but it also means the system offers **no control at all** over where
  a real bank transfer actually goes: the reference number is unverified free text a cashier
  types, with no link to any stored, approved bank account. This is a genuine gap (no control
  exists to attack), included in Section "Gaps" as well.
- **False pass:** concluding "bank-detail changes are safe because they can't be tested" —
  the correct reading is "the highest-value fraud vector in any ERP has no representation in
  this data model at all yet," which is worse, not better.

### MTP-FRD-34 — Cheque bank details are fixed at creation with no edit route (control check)
- **Attacker / role:** TREASURY_CASHIER.
- **Preconditions:** a pending cheque exists.
- **Steps:** look for `PATCH`/`PUT /cheques/:id` to alter `bankAccountNumber` after issue.
- **Expected:** no such route.
- **Observed:** control holds — `cheques-routes.ts` exposes only `POST /`, `/:id/deposit`,
  `/:id/collect`, `/:id/bounce`, `/:id/replace` (bounced cheques only). There is no edit
  route on a live cheque's bank details at all.
- **False pass:** n/a.

### MTP-FRD-35 — Weak-reason stock adjustment with no required explanation
- **Attacker / role:** WAREHOUSE_KEEPER.
- **Preconditions:** stock on hand for `ITEM-DEMO-1` at `WH-MAIN`.
- **Steps:** `POST /stock-documents/adjustments/draft` with `reason: "OTHER"`, `memo`
  omitted entirely (`createStockAdjustmentSchema.memo` is `z.string().optional()`,
  `stock-documents.ts:33`), `direction: "OUT"`.
- **Expected:** an outbound adjustment under the vaguest reason code should require a
  free-text explanation, or at minimum be flagged for review.
- **Observed:** neither. `memo` is fully optional at the header level; the reason enum
  (`inventory.ts:18-27`) includes `THEFT` and `SHORTAGE` as first-class options alongside
  `OTHER`, which is honest labeling but does not compensate for the fact that NONE of them
  require a supporting note, and (Section J) there is no report that lists adjustments by
  reason/user/warehouse for a manager to skim.
- **False pass:** the UI may show a memo textbox that "looks" required by placeholder text —
  the schema does not enforce it.

### MTP-FRD-36 — Single-step transfer with no receiving-side confirmation ("goods that never arrive")
- **Attacker / role:** WAREHOUSE_KEEPER (`inventory.transfer.create`, `.confirm` — the seed
  grants both to the same role, `access.ts:65-77`).
- **Preconditions:** stock at `WH-MAIN`.
- **Steps:**
  1. `POST /stock-documents/transfers/draft` moving stock from `WH-MAIN` to `WH-DEMO-2`.
  2. `POST /stock-documents/transfers/:id/confirm` — a SINGLE call.
  3. Physically keep the goods instead of moving them; the books already show them received
     at `WH-DEMO-2`.
- **Expected:** a transfer between two real, physically separate locations should have a
  dispatch step and a SEPARATE receipt-confirmation step, so the receiving side attests goods
  actually arrived — the way a goods receipt is separate from a purchase order.
- **Observed:** `stock-documents-routes.ts:332-360` — one `confirm` call debits the source and
  credits the destination warehouse in the same instant, gated by one permission
  (`inventory.transfer.confirm`). There is no in-transit state, no second confirmation, and
  (per the seed) the same role that creates a transfer is routinely the same role that
  confirms it — the exact "transfers that never arrive" shape the review brief names.
  `WH-DEMO-TRANSIT` exists as a warehouse id in the seed but nothing in the routes forces
  transfers to route through it as an intermediate state.
- **False pass:** the presence of a warehouse literally named "transit" in the seed data
  might read as evidence the product models an in-transit stage — it does not; nothing forces
  its use, and a direct `WH-MAIN → WH-DEMO-2` transfer is equally legal and equally
  one-step.

---

## G — Stock leakage paths

### MTP-FRD-37 — Physical count that "confirms" a shortage into a low-scrutiny adjustment
- **Attacker / role:** WAREHOUSE_KEEPER (`inventory.count.create`), needs
  `inventory.count.confirm` to `generate-adjustment` (BRANCH_MANAGER holds this in the seed,
  not the keeper — check the combination live if a tenant grants both).
- **Preconditions:** none.
- **Steps:** `POST /stock-documents/counts` → `/counts` (enter counted qty below system qty)
  → `/complete` → `/generate-adjustment` (`stock-documents-routes.ts:436-479`).
- **Expected:** the generated adjustment should carry the count's own reason/evidence and be
  distinctly traceable to "count-driven," not indistinguishable from an ad hoc adjustment.
- **Observed:** flagged for live verification of whether `generate-adjustment`'s resulting
  document uses `reason: "PHYSICAL_COUNT"` automatically (good, if so) or lets the caller
  override it — and whether the counted-vs-system quantities that produced the shrinkage are
  visible anywhere outside the count document itself once the adjustment posts. If the
  adjustment reads identically to any other, a count-driven shortage and a covered-up theft
  look the same on the books.
- **False pass:** assuming "it came from a count screen" means it is more trustworthy than a
  freehand adjustment — verify the resulting document actually preserves that provenance.

### MTP-FRD-38 — Inflate an IN adjustment to launder unexplained stock, or value it at a fabricated cost
- **Attacker / role:** WAREHOUSE_KEEPER.
- **Preconditions:** none.
- **Steps:** `POST /stock-documents/adjustments/draft` with `direction: "IN"`,
  `reason: "INITIAL_STOCK"` or `"OTHER"`, and `unitCost` set far above or below the item's
  actual WAC (`stockAdjustmentDocLineSchema.unitCost` is `positiveDecimalString.nullish()`,
  `stock-documents.ts:26` — client-suppliable when present).
- **Expected:** an inbound adjustment's cost should be bounded to a sane range relative to
  the item's existing WAC/cost history, or require `inventory.valuation`-level sign-off for
  large deviations.
- **Observed:** flagged for live verification of what the domain layer does when `unitCost`
  is supplied vs. omitted on an IN adjustment — if supplied, does it get used as-is to seed a
  new WAC layer (letting an inflated cost silently raise the average cost the business
  reports on hand, understating margin on every subsequent sale)? The routes-level schema
  alone does not answer it.
- **False pass:** assuming the WAC engine "must" recompute correctly because it does
  elsewhere in the codebase — the point of this scenario is to check the ADJUSTMENT entry
  point specifically, not the sales/purchase entry points already covered.

### MTP-FRD-39 — Negative stock hides a shortage instead of surfacing it
- **Attacker / role:** WAREHOUSE_KEEPER or SALES_REP.
- **Preconditions:** an item with tight stock.
- **Steps:** confirm a sale/issue that would take an item's on-hand negative; check whether
  the confirm is refused (`NegativeStockError`, seen in `sales-invoices-routes.ts`'s error
  handling) or allowed under some tenant setting.
- **Expected:** if negative stock is ever permitted (a documented tenant setting, mirroring
  `allowNegativeTreasury` for cash), every such event should be exception-reported — a
  negative on-hand quantity is definitionally "sold or issued more than the system thinks you
  have," i.e. either a data problem or exactly what unrecorded shrinkage looks like from the
  books' side.
- **Observed:** `NegativeStockError` exists and is handled as a 422 in at least the
  sales-invoice confirm path — flagged for live confirmation of whether any tenant setting
  can disable it, and regardless, per Section J, there is no report that would surface a
  near-zero or recently-negative-then-corrected item as worth a look.
- **False pass:** treating "the error class exists" as proof the check cannot be
  configuration-relaxed somewhere — verify the actual guard, not just the error type's
  existence.

### MTP-FRD-40 — Stock adjustment reason "SUPPLIER_RETURN" outside the purchase-return document
- **Attacker / role:** WAREHOUSE_KEEPER.
- **Preconditions:** none.
- **Steps:** `POST /stock-documents/adjustments/draft` with `reason: "SUPPLIER_RETURN"`,
  `direction: "OUT"`, entirely disconnected from any actual `purchase-returns` document.
- **Expected:** "supplier return" as a reason code implies a real return happened; if it can
  be selected on a bare adjustment with no link to `/purchase-returns`, it is indistinguishable
  from ordinary stock leaving with a label that sounds legitimate to a reviewer skimming
  reasons.
- **Observed:** the reason is a free enum choice on the generic adjustment route
  (`stockAdjustmentDocLineSchema.reason`, `stock-documents.ts:23`) with no cross-reference to
  an actual purchase-return document id — anyone can pick this label for any OUT movement.
- **False pass:** believing the reason CODE itself is evidence — it is operator-entered text
  from a fixed list, nothing more.

### MTP-FRD-41 — Landed cost with no supplier dimension (D42, open)
- **Attacker / role:** PURCHASING_OFFICER (`purchases.landed_cost.create`).
- **Preconditions:** a purchase invoice/receipt to attach landed costs to.
- **Steps:** `POST` a landed cost allocating freight/customs across several receipt lines.
- **Expected:** the resulting AP credit should be tied to a specific supplier (the freight
  forwarder / customs agent), so it appears on that supplier's own statement.
- **Observed:** per the defect register, D42 is open — a landed cost credits AP with no
  supplier dimension, so the payable exists in the general ledger and on no supplier's
  account at all (2,500.00 on the seed at last measurement). A payable no supplier statement
  ever surfaces is money a reconciliation will never catch as overdue or duplicated.
- **False pass:** checking only the GL trial balance (which balances) and missing that the
  AP sub-ledger, keyed by supplier, never received the entry.

---

## H — Cash, voucher and cheque skimming

### MTP-FRD-42 — "Edit" a confirmed voucher (control check: no edit route exists)
- **Attacker / role:** TREASURY_CASHIER.
- **Preconditions:** a confirmed voucher.
- **Steps:** look for `PATCH`/`PUT /vouchers/:id`.
- **Expected:** none should exist — correction is by reversal only.
- **Observed:** control holds — `vouchers-routes.ts` exposes no update route at all; only
  `POST /`, `/confirm`, `/cancel`, `/reverse`, `/allocations`.
- **False pass:** n/a.

### MTP-FRD-43 — Skim by under-allocating a receipt voucher and leaving the rest "unallocated" as float
- **Attacker / role:** TREASURY_CASHIER (`treasury.allocation.manage`).
- **Preconditions:** a receipt voucher for more than one invoice's worth of cash.
- **Steps:** confirm a large receipt voucher, allocate only PART of it to a real invoice,
  leave the rest sitting in "needs allocation" indefinitely, then quietly pocket cash
  elsewhere on the theory that the float masks the shortfall on any single invoice's balance.
- **Expected:** the needs-allocation queue (`vouchers-routes.ts:249-257`,
  `/vouchers/counts`'s `needs_allocation*` counters) should be reviewed regularly enough that
  aged, unallocated cash is itself an exception.
- **Observed:** the queue and its counts exist and are computed correctly server-side
  (`listFilteredVouchers`, `vouchers-routes.ts:217-259`) — this is a real, working detective
  control, PROVIDED someone looks at it. There is no age-based escalation or report (Section
  J) that would surface "unallocated for N+ days" without a person choosing to open this
  specific screen.
- **False pass:** assuming the queue existing is the same as the queue being reviewed —
  it is a pull mechanism, not a push/alert.

### MTP-FRD-44 — Allocate a payment received from one customer against a different customer's invoice
- **Attacker / role:** TREASURY_CASHIER (`treasury.allocation.manage`).
- **Preconditions:** a confirmed receipt voucher for `CUST-DEMO-1`, an open invoice belonging
  to `CUST-DEMO-2`.
- **Steps:** `POST /vouchers/:id/allocations` with `invoiceId` pointing at `CUST-DEMO-2`'s
  invoice while the voucher's own `partyId` is `CUST-DEMO-1`.
- **Expected:** refused — a voucher should only allocate against invoices belonging to the
  same party.
- **Observed:** control holds — `allocate()` (`voucher-service.ts:283-306`) passes
  `voucherPartyId: partyId` and `expectedKind` into the allocation function, which the
  underlying `allocateFn` is documented to check against the invoice's own party/kind
  (`AllocationMismatchError` is a handled error class in `vouchers-routes.ts:138`). Flagged
  for a live re-check to confirm `AllocationMismatchError` actually fires for a
  cross-customer attempt rather than only a cross-kind (sales vs purchase) one.
- **False pass:** confirming only that CROSS-KIND allocation is blocked (sales voucher onto a
  purchase invoice) and not separately testing CROSS-PARTY within the same kind.

### MTP-FRD-45 — Bounce a cheque, then "collect" it anyway
- **Attacker / role:** TREASURY_CASHIER.
- **Preconditions:** a deposited cheque.
- **Steps:** `POST /cheques/:id/bounce`, then `POST /cheques/:id/collect` on the same id.
- **Expected:** refused — `bounced` should be terminal short of an explicit `/replace`.
- **Observed:** flagged for a live check of `CHEQUE` status transitions (not read in this
  pass) — cheque status logic lives in a separate, cheque-specific state machine
  (`effectiveChequeStatus`), not the shared document framework verified for invoices/
  vouchers/returns in Section C, so the same guarantee cannot be assumed without checking it
  directly.
- **False pass:** assuming "the rest of the app uses `assertTransition` so this does too" —
  cheques are a parallel, not-yet-audited state machine.

### MTP-FRD-46 — Withholding-tax voucher field round-trips (verify GL, not just the API)
- **Attacker / role:** ACCOUNTANT / FINANCE_MANAGER.
- **Preconditions:** a voucher with withholding tax.
- **Steps:** `POST /vouchers` with `withholdingAmount`/`withholdingRatePercent` set; confirm;
  check the posted GL entry and the voucher detail for those fields.
- **Expected:** withholding travels with the posting and is queryable later.
- **Observed:** `vouchers-routes.ts:400-402` does pass `withholdingAmount`/
  `withholdingRatePercent`/`withholdingGlAccountId` through to `createVoucher`, and
  `serialize` (`vouchers-routes.ts:83-84`) returns them back — this looks fixed relative to
  the register's earlier note about wire schemas silently stripping dimensions; re-verify
  live that the GL entry itself carries a distinguishable withholding line rather than just
  the voucher record showing the field.
- **False pass:** the voucher API round-tripping the field is not the same as the GL/tax
  report reflecting it — check both independently.

---

## I — Branch/warehouse scope bypass

### MTP-FRD-47 — Widen warehouse scope via the request header beyond the session grant
- **Attacker / role:** WAREHOUSE_KEEPER scoped to `WH-MAIN` only.
- **Preconditions:** stock exists at `WH-DEMO-2`, outside the attacker's grant.
- **Steps:** direct HTTP `GET /stock-documents/adjustments` (or any scoped list route) with
  header `x-warehouse-scope: WH-DEMO-2` (or `*`), using the attacker's real session token.
- **Expected:** the request is narrowed to the session's granted scope regardless of what the
  header asks for.
- **Observed:** control holds — `narrowScope` (`session-auth.ts:111-121`) explicitly can only
  SHRINK the granted scope, never widen it: `allowed = asked.filter((id) =>
  granted.includes(id))`, falling back to the full granted scope if the requested ids don't
  intersect it at all. This is correct and matches the documented rule ("a limit the caller
  supplies is not a limit," applied to scope here rather than quantity).
- **False pass:** n/a — but re-verify this specifically against the auth-model note at the
  top of this document: if any composition root anywhere still mounts a route on the
  header-trusting `headerAuthContextResolver` instead of the session resolver, that route
  inherits zero scope enforcement.

### MTP-FRD-48 — Confirm a stock document for a warehouse outside the actor's own scope
- **Attacker / role:** WAREHOUSE_KEEPER scoped to `WH-MAIN`.
- **Preconditions:** none.
- **Steps:** `POST /stock-documents/adjustments/draft` naming `warehouseId: "WH-DEMO-2"`
  directly in the line, then confirm — testing whether CREATE (not just LIST) enforces scope.
- **Expected:** refused, or the created document should be invisible/inert outside the
  actor's own warehouse.
- **Observed:** the confirmed pattern in this codebase (per the defect register and the read
  in Sections A/D) is that LIST routes filter by scope (`warehouseScopeOf`,
  `stock-documents-routes.ts` and siblings) but CREATE routes were historically the ones
  found unwired ("the warehouse selector filtered nothing... on the document-layer routes");
  the register marks that class of defect fixed, but this exact create-time enforcement
  should be re-verified live per warehouse-scoped document type rather than assumed fixed
  everywhere by extension.
- **False pass:** verifying only that the LIST screen hides other warehouses' documents and
  concluding creation is equally guarded.

### MTP-FRD-49 — Branch-scoped voucher visible/actionable outside the actor's branch
- **Attacker / role:** a user scoped to one branch via `branchScope`.
- **Preconditions:** vouchers exist across more than one branch.
- **Steps:** `GET /vouchers` and `POST /vouchers/:id/confirm` for a voucher whose `branchId`
  is outside the actor's `branchScope`.
- **Expected:** list is narrowed (`withinScope`, `vouchers-routes.ts:232`); confirm/cancel/
  reverse on an out-of-scope id should also be refused, not merely hidden from the list.
- **Observed:** `GET` is scoped; flagged for a direct-id-guess live check of whether
  `POST /vouchers/:id/confirm` on a KNOWN out-of-scope voucher id (obtained some other way —
  a shared invoice number, a prior screenshot, a guessed sequential id) is refused
  independently, or only absent from what the actor's own list shows them.
- **False pass:** "I can't see it in my list" is not the same claim as "I can't act on it if
  I already have its id" — list-scoping and action-scoping are two different checks and must
  both be verified.

---

## J — Exception reporting

Every scenario in this section asks the same question the review brief poses directly: "would
any report surface this?" — and answers it against the actual route list in
`reports-routes.ts` and `financial-reports-routes.ts`.

### MTP-FRD-50 — Sales below cost: no report exists
- **Steps:** search `reports-routes.ts` for anything comparing invoice `unitPrice` to item
  cost/WAC across a period.
- **Expected:** an exception report listing every sale below cost, by user/customer/item.
- **Observed:** does not exist. The report surface is: `sales/by-period`, `sales/by-item`,
  `sales/by-customer`, `sales/by-salesperson`, `sales/top-products` — all aggregate revenue,
  none compare price to cost at the line level. `sales.invoice.view_cost` exists as a
  PERMISSION (gating who may see cost at all) but no report USES it to flag anything. This
  directly enables MTP-FRD-01 to go unnoticed indefinitely.

### MTP-FRD-51 — Discounts above threshold: no report exists
- **Steps:** search for a report grouping confirmed invoices by discount percentage/amount.
- **Expected:** a report listing every invoice/return whose discount exceeded the configured
  ceiling, or that needed (and who granted) `pos.discount.approve`.
- **Observed:** does not exist anywhere in `reports-routes.ts` or `financial-reports-
  routes.ts`. This directly enables MTP-FRD-02/03/06 to go unnoticed — the ceiling check
  exists at write time but there is no read-time surface for a manager to sample after the
  fact.

### MTP-FRD-52 — Adjustments/voids/backdated documents by user: no report exists
- **Steps:** search for a report grouping stock adjustments, cancellations, or reversals by
  the acting user, or a report of documents whose `date` predates their `createdAt` by more
  than some threshold.
- **Expected:** at minimum a "stock adjustments by reason and user" report and a "documents
  posted with a backdated date" report, both readable from the acting user's own audit rows
  (`AuditSink`/`audit-routes.ts` already captures actor, action, entity, and — per
  `fiscal-periods-routes.ts` — previous status).
- **Observed:** does not exist. `GET /audit` is a raw, filterable log
  (`stream`/`branchId`/`module`/`action`/`actor`/`entityType`/`entityId`/`severity`/`from`/
  `to`) — a genuinely useful primitive — but nothing aggregates or surfaces it as a report; an
  auditor must already know exactly what to search for and query it by hand. This directly
  enables MTP-FRD-09/10/11/35/40 to go unreviewed by default.

### MTP-FRD-53 — Voided/cancelled documents: no report exists
- **Steps:** search for a report listing every document that reached `cancelled`/`reversed`
  status in a period, by type and user.
- **Expected:** a standing "cancellations and reversals" report — the single most obvious
  place fraud concealment attempts would cluster (a document created, then reversed once it
  achieved its purpose, e.g. temporarily inflating a period's sales before period-close, then
  reversed after).
- **Observed:** does not exist. Every document-list route CAN filter by `status=cancelled` or
  `status=reversed` (`sales-invoices-routes.ts`, `vouchers-routes.ts`,
  `stock-documents-routes.ts` etc. all take a `status` query param) — so the DATA is
  retrievable per module, but there is no CROSS-MODULE reversals report and no report ranks
  or ages them for review.

### MTP-FRD-54 — After-hours activity: no report exists
- **Steps:** search for any report or audit query filtering by time-of-day rather than date.
- **Expected:** a report (or at least an `/audit` filter) surfacing documents created/
  confirmed outside normal business hours.
- **Observed:** `auditQuerySchema` (referenced by `audit-routes.ts:25-38`) filters by
  `from`/`to` DATE range only — no time-of-day dimension is exposed anywhere in the reporting
  or audit-query surface. Every document's `createdAt`/`confirmedAt` IS a full ISO timestamp
  (visible in every `serialize()` function read in this pass), so the raw data to build this
  exists — nothing reads it that way.

---

## Gaps — nothing to attack

Per the task brief, journeys with genuinely no control surface to test at all (not "a weak
control" — a scenario simply cannot be constructed because the feature or the field does not
exist):

- **Supplier payee bank details.** `Supplier` has no bank-account/IBAN field anywhere in the
  domain model or contracts (MTP-FRD-33). There is nothing to edit, so "log the edit" cannot
  be tested — but there is also no system-level tie between a treasury voucher's free-text
  `referenceNo` and any verified, approved bank account for the payee. A real bank transfer's
  destination is decided entirely outside Mezan, by whoever executes it. This is the single
  largest blind spot relative to the review brief's stated highest-value fraud vector, and it
  is a design gap, not a bug to reproduce.
- **Exception reporting as a category.** Section J's five scenarios (MTP-FRD-50..54) are all
  "does not exist" findings rather than exploitable attacks — there is no report to attack
  because there is no report. Listed under both J (for completeness against the brief's
  checklist) and here (because there is no request/response pair an auditor can actually
  send).
- **Time-of-day on any document.** No route, filter, or report anywhere in the codebase reads
  a timestamp's TIME component for anything — only the date. After-hours activity cannot even
  be manually queried today, let alone reported.
- **Cheque-register state machine.** Not audited in this pass (MTP-FRD-45 flags it) — no
  attack scenario is written against it beyond the one flagged-for-live-check item, because
  its transition table was not read; this is a coverage gap in THIS review, not a claim that
  the product has no control there.
- **POS module.** Descoped from v1 per `docs/archive/plan.md` / the stakeholder context — its
  permission codes (`pos.discount.approve`, `pos.delivery.cancel`) exist in the catalog and
  are referenced by the sales-invoice discount ceiling (MTP-FRD-01/02/07), but the POS
  selling screen itself is unbuilt. No POS-specific fraud scenarios are written for the same
  reason the stakeholder brief gives for not flagging it as missing elsewhere.
