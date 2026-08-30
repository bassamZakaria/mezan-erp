# Manual Test Plan — Warehouse Keeper (أمين مخزن)

Scope: everything the person who is physically accountable for the stock count
would run to accept the inventory module. Grounded against the code actually
in this worktree — every scenario below exercises a real screen
(`apps/web/src/screens/*.tsx`) and a real route (`packages/api/src/*-routes.ts`),
not the archived catalog aspiration at `docs/archive/catalog/03-inventory.md`.
Screens/routes verified present: `GoodsReceiptsScreen.tsx` (+ `purchases-routes.ts`
`/purchases/receipts*`), `StockAdjustmentsScreen.tsx` (+ `stock-documents-routes.ts`
`/inventory/stock-adjustments*`), `StockTransfersScreen.tsx` (+
`/inventory/stock-transfers*`), `PhysicalCountsScreen.tsx` (+
`/inventory/physical-counts*`), `StockBalanceScreen.tsx` (+
`/inventory/stock-balance`), `LabelPrintingScreen.tsx`, `VanTripsScreen.tsx` (+
`field-sales` routes), `WritedownRunsScreen.tsx` (+ `inventory-writedown-routes.ts`),
`WarehousesPage.tsx` (+ `warehouses-routes.ts`), and the eight report screens in
`apps/web/src/screens/reports/InventoryReportsScreens.tsx`.

Every stock-quantity assertion below is paired with its money consequence
(weighted-average unit cost and/or the `1200 — المخزون` GL balance) per the
brief — never quantity alone.

Preconditions common to all scenarios unless stated otherwise:
- Backend seeded with `MEZAN_SEED_DEMO=1`.
- Signed in as a user holding `inventory.adjustment.*`, `inventory.transfer.*`,
  `inventory.count.*`, `purchases.receipt.*` and `admin.warehouses.*` (the demo
  seed's default admin has all of these; see the "scoping" section for a
  narrower role).
- Tenant settings (`Settings → عام` / `SettingsGeneral.tsx`) at their seeded
  defaults: «يجب وجود أمر شراء قبل استلام البضاعة» ON, «السماح بالمخزون
  السالب» OFF, «السماح بالطلبات المؤجلة» OFF, «توليد أرقام الدفعات تلقائيًا»
  OFF — scenarios that flip one of these say so explicitly and must flip it
  back afterward.

---

## Goods receipt (إذن استلام) — against a purchase order

### MTP-WHS-01 — Receive the full outstanding quantity of a sent PO
- **Persona / permission:** أمين مخزن with `purchases.receipt.create` + `purchases.receipt.confirm`.
- **Preconditions:** seeded demo tenant; at least one purchase order with status
  «مرسل» (sent) and unreceived lines (`GoodsReceiptsScreen.tsx` only offers
  orders where `status === "sent" || "partially_received"`).
- **Steps:**
  1. Open «إيصالات الاستلام» and click **"إيصال استلام جديد"**.
  2. Click **"من أمر شراء"**, then **"متابعة"**.
  3. Pick the sent PO in the order picker.
  4. Confirm the auto-filled preview lines match the PO's outstanding qty × unit price.
  5. Enter today's date and click **"حفظ كمسودة"**.
  6. Open the new draft receipt and click **"تأكيد الاستلام"**.
- **Expected:** the receipt moves to «مؤكد». Item on-hand in the receipt's
  warehouse rises by exactly the received qty. The item's weighted-average
  cost updates toward the receipt's unit cost (a new cost layer is created at
  that unit cost — check the item's «التكلفة» tab). GL: `1200 — المخزون` is
  debited and `بضاعة واردة لم تُفوتر` (GRNI) is credited by qty × unit cost —
  no tax and no supplier payable yet (`buildGoodsReceiptPosting` in
  `packages/domain/src/purchasing/goods-receipt.ts`). The PO's status advances
  to «مستلم جزئياً» or «مستلم بالكامل».
- **False pass:** the receipt shows «مؤكد» and the PO status changed, but you
  never checked `أرصدة المخزون` — a receipt that moved the PO's status without
  moving stock (or that moved stock without posting the GRNI credit) looks
  identical from the receipt screen alone.

### MTP-WHS-02 — Receive a DIFFERENT quantity than the PO ordered (the UI cannot do this)
- **Persona / permission:** same as MTP-WHS-01.
- **Preconditions:** a sent PO with an outstanding line qty of, say, 50 units.
- **Steps:**
  1. Start a new receipt, choose **"من أمر شراء"**, pick the PO.
  2. Look for any input on the preview-lines table to change the received qty
     to something other than the PO's outstanding qty (e.g. 40 instead of 50 —
     a real short shipment).
- **Expected:** there is no editable qty field anywhere in the "from-order"
  create flow — `previewLines` in `GoodsReceiptsScreen.tsx` renders a read-only
  table, and `save()` sends only `{ purchaseOrderId, date }` with no `lines`.
  The domain (`createGoodsReceipt` in `goods-receipt.ts`) does accept an
  explicit `lines` array that can carry any qty/cost different from the PO —
  this is a real, working capability at the API layer that the screen never exposes.
- **False pass:** concluding "partial/different-quantity receiving works"
  because the domain function supports it. It does not work from the
  keeper's screen — a delivery short by 10 units can only be received as if
  the full 50 arrived, silently manufacturing 10 units of stock and cost that
  were never delivered. This is the dealbreaker item from the brief
  ("receive against a purchase order, partially, with a different quantity
  than ordered, and record why") and it fails on the UI the keeper actually uses.

### MTP-WHS-03 — Confirming rolls the PO forward, not the receipt backward
- **Persona / permission:** same as MTP-WHS-01.
- **Steps:** confirm two separate receipts against the same PO's two different lines.
- **Expected:** the PO's per-line received qty accumulates correctly across
  both receipts (`applyReceiptToOrder`); the PO reaches «مستلم بالكامل» only
  once every line's outstanding qty is zero. Each receipt posts its own GRNI
  entry at its own unit cost.
- **False pass:** the second receipt silently re-receives the first line too
  because the outstanding-qty computation was not re-read from the just-updated PO.

### MTP-WHS-04 — Cancel a draft receipt (no stock effect to reverse)
- **Steps:** create a draft receipt, do not confirm it, use the row menu to
  cancel/discard it (if exposed) or simply leave it as draft and re-open it.
- **Expected:** a draft receipt has posted nothing — its detail page shows
  effects «سيتم إضافة الكمية إلى المخزون عند التأكيد» (draft-only effect
  text), not the confirmed stock-in text. No stock ledger row, no GL entry,
  no PO update exists for it yet.
- **False pass:** stock or the PO changed before you ever clicked «تأكيد الاستلام».

### MTP-WHS-05 — Cancel a CONFIRMED, un-invoiced receipt reverses stock
- **Persona / permission:** `purchases.receipt.void`.
- **Steps:** confirm a receipt, then cancel it via the domain's
  `cancelGoodsReceipt` path (exposed wherever the "المزيد" / row menu wires
  `POST /purchases/receipts/:id/cancel` — confirm the control exists on the
  screen before running this; if it is not wired, this becomes a gap, see below).
- **Expected:** stock IN is reversed (`stock.reverseReceipt`), the PO's
  received qty rolls back (`revertReceiptFromOrder`), on-hand and the
  weighted-average cost return to their pre-receipt values, and the GRNI/
  inventory GL entry is reversed.
- **False pass:** the receipt shows «ملغي» but on-hand did not drop back —
  check `أرصدة المخزون` for the item, not just the receipt's own status pill.

### MTP-WHS-06 — Cancel is blocked once the receipt has been invoiced
- **Steps:** confirm a receipt, raise a purchase invoice against it (marks it
  `invoiced: true`), then attempt to cancel the receipt.
- **Expected:** rejected with `GoodsReceiptAlreadyInvoicedError`. Stock and GL
  are untouched.
- **False pass:** the cancel button is simply absent, which reads as "not
  supported" rather than "correctly blocked" — check for the specific error,
  not just the absence of a button.

### MTP-WHS-07 — Cancel is blocked once the received stock has been drawn down
- **Preconditions:** `trackSoldPurchaseItems` policy ON; a confirmed,
  un-invoiced receipt whose stock has since been sold or transferred out.
- **Steps:** attempt to cancel that receipt.
- **Expected:** rejected with `PurchaseItemsAlreadyConsumedError` — the code
  checks whether any cost layer sourced from this receipt has
  `remainingQty !== originalQty` before allowing the reversal.
- **False pass:** the cancel succeeds and leaves the item's on-hand quantity
  negative or its cost layers inconsistent — that is exactly the silent
  drift this guard exists to prevent.

### MTP-WHS-08 — Receive an ad-hoc (PO-less) delivery — only when the policy allows it
- **Preconditions:** `Settings → عام` → «يجب وجود أمر شراء قبل استلام
  البضاعة» switched OFF.
- **Steps:**
  1. New receipt → the **"استلام مباشر"** tile is now clickable (its hint text
     when the policy is ON reads exactly **"غير متاح: سياسة «إلزام أمر الشراء
     قبل الاستلام» مفعّلة"**).
  2. Pick a supplier, a warehouse, one item line with qty and unit cost, save, confirm.
- **Expected:** a receipt with `purchaseOrderId: null` is created and posts
  stock IN / GRNI exactly like a PO-sourced one. Reset the policy to ON afterward.
- **False pass:** the ad-hoc tile is clickable even with the policy ON — verify
  the disabled/greyed state and its exact copy first.

### MTP-WHS-09 — Ad-hoc receipt is refused server-side even if the UI is bypassed
- **Steps:** with the policy ON, call `POST /purchases/receipts` directly
  (devtools/API client) with no `purchaseOrderId`.
- **Expected:** `400`/`422` `PurchaseOrderRequiredError` — the gate is the
  server's, not just a disabled button (`createGoodsReceipt` checks
  `policy.requirePoForGrn` before falling through to the ad-hoc path).
- **False pass:** relying on the UI's disabled tile as proof the rule is enforced.

### MTP-WHS-10 — Receiving a batch/expiry item captures both, once, at the receipt
- **Preconditions:** an item with «تتبع الدفعات وتواريخ الصلاحية» on; ad-hoc
  receipt path (batch fields only render for tracked items on that form).
- **Steps:** add a line for the batch-tracked item; the **"رقم التشغيلة"** and
  **"تاريخ انتهاء الصلاحية"** fields appear; fill both; save and confirm.
- **Expected:** a cost layer is created carrying that exact batch number and
  expiry date. This is the only moment either can be captured — the code
  comment in `GoodsReceiptsScreen.tsx` notes "Receiving is the ONLY moment a
  batch and its expiry can be captured."
- **False pass:** leaving batch/expiry blank on a tracked item still lets the
  receipt confirm (only checked when `autoGenerateBatchNumbers` is on) — a
  batch-tracked item can receive stock with no batch identity at all if the
  keeper skips the field, which then has nothing for FEFO or the
  expiring-soon report to key off.

### MTP-WHS-11 — Auto-generated batch numbers, when the setting is on
- **Preconditions:** «توليد أرقام الدفعات تلقائيًا» ON.
- **Steps:** receive an ad-hoc line for a batch-tracked item, leaving «رقم
  التشغيلة» blank.
- **Expected:** the confirmed receipt's line carries a system-generated batch
  number (`autoBatchNo` hook), not a blank one.
- **False pass:** the setting is on but the line still shows no batch on the
  item's cost-layers tab afterward.

### MTP-WHS-12 — Over-receipt is blocked when the tenant's policy says so
- **Preconditions:** `blockOverReceipt` policy on (check current tenant
  default in Settings; this is separate from `requirePoForGrn`).
- **Steps:** attempt (via the API, since the UI never lets you edit qty per
  MTP-WHS-02) to receive more than a PO line's outstanding qty.
- **Expected:** `OverReceiptError`.
- **False pass:** none possible from the UI alone — this is an API-level check
  the keeper cannot trigger by clicking, which is itself worth flagging: the
  UI removed the only path (editable qty) that would ever hit this guard.

### MTP-WHS-13 — Receiving posts stock BEFORE the GL entry, and both roll back together on failure
- **Steps:** (developer-assisted) force the GL posting step to fail after
  stock has posted (e.g. a missing GRNI account mapping) and confirm a receipt.
- **Expected:** per the code comment in `confirmGoodsReceipt`, "Stock first
  here... the GL entry is what must not be left behind if something later
  fails" — but there is no visible transaction wrapper around `postReceipt`+
  `gl.post` in that function; verify empirically whether a GL failure leaves
  stock moved with no matching GL entry (a genuine drift) or whether the
  composition root wraps both in one DB transaction.
- **False pass:** assuming atomicity from the comment alone without forcing the failure.

---

## Issuing (صرف) and stock adjustments — the only OUT mechanism a keeper has

There is no dedicated «إذن صرف» screen in this codebase. Every outward,
non-sale, non-transfer movement — damage, theft, expiry, shortage, supplier
return, or "other" — goes through **تسويات المخزون** (Stock Adjustments),
picking one of 8 reasons (`ADJUSTMENT_REASON_DEFINITIONS` in
`packages/domain/src/inventory/reasons.ts`). Opening balances use the same
screen with reason `INITIAL_STOCK`.

### MTP-WHS-14 — Post an opening balance (رصيد افتتاحي)
- **Persona / permission:** `inventory.adjustment.create` + `.confirm`.
- **Preconditions:** an item with zero recorded stock in the target warehouse.
- **Steps:**
  1. Open «تسويات المخزون» → **"تسوية جديدة"**.
  2. Pick the **"رصيد افتتاحي"** reason card (description: "تسجيل رصيد المخزون الأولي").
  3. Pick the warehouse, add a line for the item, enter qty and unit cost.
  4. Click **"اعتماد التسوية"**.
- **Expected:** on-hand rises by qty at that unit cost; a new cost layer is
  created at that unit cost (this becomes the item's weighted-average since it
  had none before). GL: `1200 — المخزون` debited, `3100 — رأس مال الملاك`
  credited (`counterpartAccountId: "3100"` for `INITIAL_STOCK`) — the opening
  balance is funded by owner's capital, never a purchase.
- **False pass:** the opening balance shows on the item card but no GL entry
  exists under the adjustment's «المحاسبة» tab — that would mean the balance
  sheet and the item's stock quantity disagree about where the value came from.

### MTP-WHS-15 — Damage write-off (تلف)
- **Steps:** new adjustment, reason **"تلف"** ("خصم الأصناف التالفة", direction
  OUT), warehouse, item, qty (unit cost disabled/derived — OUT lines don't
  take one), اعتماد.
- **Expected:** on-hand drops by qty; write-off posts Dr `5070` / Cr
  `1200 — المخزون` at the item's current weighted-average cost for that qty
  (the OUT line's value is computed by the engine, not typed by the keeper).
- **False pass:** the line's «القيمة الإجمالية» column shows "يُحسب بمتوسط
  التكلفة الحالي" and you never verified the GL tab actually posted that
  computed number.

### MTP-WHS-16 — Theft write-off (سرقة) posts to its own account, not damage's
- **Steps:** same as MTP-WHS-15 with reason **"سرقة"**.
- **Expected:** Cr `1200`, Dr `5071` (theft's own counterpart account, distinct
  from damage's `5070`) — the reasons are not cosmetically different labels
  on one GL line; verify the account differs from MTP-WHS-15's.
- **False pass:** both damage and theft post to the same GL account, making
  the two indistinguishable in the trial balance despite being different reasons.

### MTP-WHS-17 — Expiry write-off (انتهاء صلاحية)
- **Preconditions:** a batch-tracked item with an expired batch (receive one
  with `expiryDate` in the past — MTP-WHS-10 — or use a seeded one).
- **Steps:** new adjustment, reason **"انتهاء صلاحية"**, item, qty ≤ the
  expired batch's remaining qty, اعتماد.
- **Expected:** on-hand drops; ideally the specific expired batch/layer is the
  one consumed (verify against the item's «طبقات التكلفة» before/after — does
  the expiry-reason adjustment target the expired layer specifically, or just
  the oldest/FEFO layer generically? If it is the latter, an expiry write-off
  could consume FRESH stock while the expired batch sits untouched — record
  what actually happens).
- **False pass:** the write-off reduces on-hand by the right total qty while
  leaving the actually-expired batch's remaining qty untouched — the count
  matches, the rot is still on the shelf.

### MTP-WHS-18 — Shortage/loss (نقص / فقدان)
- **Steps:** reason **"نقص / فقدان"** ("خصم العجز غير المبرر"), OUT.
- **Expected:** Dr `5073` / Cr `1200`.
- **False pass:** same account as theft/damage (verify distinctness).

### MTP-WHS-19 — Return to supplier via adjustment (مرتجع للمورد) clears to a suspense account, not AP
- **Steps:** reason **"مرتجع للمورد"** ("خصم الأصناف المرتجعة للمورد"), OUT, item, qty.
- **Expected:** Cr `1200 — المخزون` / Dr `2110` (a clearing account — NOT
  `2100` trade payables, per the code comment: "this adjustment names no
  supplier, so the AP sub-ledger could never learn about it"). This is
  distinct from the dedicated **Purchase Returns** document, which does name
  a supplier and settle against `2100` — the two must not be confused.
- **False pass:** treating this adjustment-reason return as if it reduced the
  named supplier's AP balance — it never touches AP at all; only the Purchase
  Returns screen does that (see MTP-WHS-63/64).

### MTP-WHS-20 — Other (أخرى) lets you pick direction manually
- **Steps:** reason **"أخرى"** (direction `EITHER`), add a line, use the
  per-line direction selector to pick «زيادة» or «نقصان».
- **Expected:** the direction column only appears for this reason (and
  `PHYSICAL_COUNT`, also `EITHER`) — every other reason has a fixed,
  reason-implied direction the keeper cannot override. Cr/Dr posts to `5075`.
- **False pass:** every reason silently offers a direction picker — that
  would mean the reason no longer determines the correct GL account, and a
  keeper could post a "damage" that's actually an increase.

### MTP-WHS-21 — An adjustment with no reason cannot be created
- **Steps:** navigate directly to the adjustment create URL segment without a
  valid reason in the path/state (or try posting `POST
  /inventory/stock-adjustments/draft` with a bogus `reason` value).
- **Expected:** the screen keeps showing the reason-picker grid until a real
  one is chosen (`selectedReason === null` short-circuits before the form
  renders); the server schema rejects an unknown reason code with `400`.
- **False pass:** none likely — this is the dealbreaker check ("an adjustment
  with no reason and no name attached to it") and the reason step is
  structurally required before any line can be entered. Confirm the
  `createdBy` field on the confirmed document is the real logged-in user's id.

### MTP-WHS-22 — Confirming an adjustment is one-way; correct by reversal
- **Steps:** confirm an adjustment, then look for any edit/re-open/undo control on it.
- **Expected:** none exists — the detail page shows no controls once
  confirmed; the only stated remedy is "أنشئ تسوية جديدة بالاتجاه المعاكس"
  (create a new adjustment in the opposite direction) mirrored from the
  transfer pattern.
- **False pass:** a row menu item that edits a confirmed adjustment's lines in place.

### MTP-WHS-23 — Adjustment OUT is refused if it would drive stock negative (default policy)
- **Preconditions:** `allowNegativeStock` OFF (seeded default). Item with 5 on-hand.
- **Steps:** new adjustment, reason «تلف», qty 10 (more than on-hand), اعتماد.
- **Expected:** rejected with `NegativeStockError` (`negativeAllowedFor` in
  `stock-ledger-service.ts` checks the tenant's `allowNegativeStock` for any
  non-backorderable source type — an adjustment is never in the narrower
  `BACKORDERABLE_SOURCES` list, so `allowNegativeStock` is the ONLY switch
  that can ever license a negative adjustment). On-hand stays at 5, no GL
  entry posts.
- **False pass:** the adjustment confirms and on-hand shows -5 — check this
  first on every negative-stock scenario, since it is the brief's #1 dealbreaker.

### MTP-WHS-24 — Adjustment OUT succeeds and goes negative when the tenant explicitly allows it
- **Preconditions:** admin flips «السماح بالمخزون السالب» ON.
- **Steps:** repeat MTP-WHS-23.
- **Expected:** the adjustment confirms; on-hand goes to -5; the GL still
  posts a balanced entry at whatever unit cost the WAC engine can still
  compute (verify what unit cost a negative-position OUT actually uses — the
  deficit-costing path in `wac.ts` is where a WAC engine can most easily
  misprice a movement it has no layers left to cost). Reset the setting to
  OFF afterward.
- **False pass:** the adjustment is silently blocked anyway despite the
  setting being on — or it posts a $0 cost line, hiding real financial exposure.

### MTP-WHS-25 — Warehouse and reason live on the LINE, not a shared document header, but must agree
- **Steps:** inspect an adjustment with multiple lines; confirm all lines
  share the warehouse picked once at document level (the form only offers one
  warehouse field for the whole document) and the one reason picked in step 1.
- **Expected:** consistent — the UI structurally cannot produce a
  multi-warehouse or multi-reason adjustment in one document.
- **False pass:** n/a — structural; only worth checking that `headerOf()`
  reading `lines[0]` for the list/detail display doesn't silently misreport a
  line 2+ that (via direct API use) carries a different warehouse.

### MTP-WHS-26 — Confirming an adjustment dated in a CLOSED fiscal period is blocked, atomically
- **Preconditions:** a fiscal period closed via `Settings → الفترات المالية`.
- **Steps:** create a draft adjustment dated inside the closed period, attempt
  to confirm it.
- **Expected:** rejected (`NoFiscalPeriodForDateError` / period-closed, via
  `assertPeriodOpen` inside the shared `postJournalEntry` the inventory GL
  hook wraps). Critically: the item's on-hand qty must be UNCHANGED after the
  failed confirm — `DocumentService.confirm` runs the stock plan before
  building the GL posting inside one `repo.transaction`, so a GL failure
  should roll the stock movement back too.
- **False pass:** the confirm fails with a period-closed toast, but
  `أرصدة المخزون` already shows the increased/decreased quantity — that is a
  partial-effect bug (stock moved, nothing posted, in a period that is
  supposed to be immutable) and is exactly the kind of silent drift this
  scenario exists to catch. Verify explicitly; do not assume the transaction
  wrapper covers both the document repo and the stock ledger's own repo.

---

## Transfers (تحويل مخزني) — two warehouses, one atomic confirm

### MTP-WHS-27 — Basic transfer between two real warehouses
- **Steps:** «تحويلات المخزون» → **"تحويل جديد"**, pick distinct source/destination
  warehouses, add a line (item + qty), **"حفظ"**.
- **Expected:** unlike adjustments, the create screen calls `createTransfer`
  then IMMEDIATELY `confirmTransfer` in the same click (`handlePost` in
  `StockTransfersScreen.tsx`) — there is no separate draft-review step from
  this screen even though the domain models draft→confirm. Source warehouse
  on-hand drops by qty, destination on-hand rises by qty, at the SAME unit
  cost (the OUT leg's resolved cost is reused for the IN leg —
  `StockLedgerService.postTransfer`). Total company-wide inventory value
  (`1200 — المخزون` balance) is UNCHANGED — no GL entry posts for a transfer at all.
- **False pass:** checking only the destination warehouse's on-hand went up —
  also check the source dropped by the exact same qty and that total value
  (qty×cost summed across both warehouses) is identical before/after.

### MTP-WHS-28 — Transfer to itself is blocked in the UI and the domain
- **Steps:** pick the same warehouse as both source and destination.
- **Expected:** UI shows the inline error **"يجب أن يختلف المستودع المصدر عن
  مستودع الوجهة."** and disables **"حفظ"**; even bypassing the UI, the domain's
  `stockTransferDocumentType.validate` and `StockLedgerService.postTransfer`
  both independently throw (`SameWarehouseTransferError` /
  `InvalidDocumentError`) — double-enforced.
- **False pass:** the client-side disabled button is the only guard — confirm
  the server rejects it too via a direct API call.

### MTP-WHS-29 — Transfer is instant, not a two-state "in transit" — this is a real gap
- **Steps:** confirm a transfer with a large qty and immediately check both
  warehouses' balances.
- **Expected (actual behaviour):** both the OUT and IN legs post inside ONE
  transaction in `postTransfer` — there is no intermediate «تحت التحويل» /
  in-transit status anywhere in the codebase (confirmed: no `IN_TRANSIT`
  state, no "تحت التحويل" string, anywhere in `packages/domain`,
  `packages/api`, or `apps/web`). A transfer is atomic and instantaneous —
  goods teleport the moment «تأكيد» is clicked, with no goods-in-a-van/on-a-
  dock state in between.
- **False pass:** none — this is a documented gap, not a bug to reproduce. It
  is a genuine miss against the brief's explicit requirement ("in transit is
  a real state, not an instant teleport") even though the atomicity itself
  means stock can never be LOST mid-transfer (good) — it just can never be
  "on the way" either (bad). Record this as a finding, not a pass/fail.

### MTP-WHS-30 — A confirmed transfer cannot be edited, cancelled, or un-confirmed
- **Steps:** open a confirmed transfer's detail page; look for edit/cancel controls.
- **Expected:** the detail page shows only the notice **"لا يمكن إلغاء تحويل
  مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً
  بالاتجاه المعاكس."** — no cancel route exists for a confirmed transfer at all.
- **False pass:** a hidden/disabled cancel button that a direct API call still succeeds against.

### MTP-WHS-31 — Reversing a transfer means creating a brand-new opposite one
- **Steps:** transfer 10 units A→B, then create a second transfer 10 units B→A to "undo" it.
- **Expected:** two independent transfer documents exist in the list, both
  «مؤكد»; net effect on A and B on-hand returns to the pre-transfer values, but
  the unit cost used on the return leg is B's CURRENT weighted-average at the
  time of the second transfer, which may differ from the original if B
  received other stock in between (transfers never re-derive the original cost).
- **False pass:** assuming the reversal is cost-neutral by definition — verify
  the actual unit costs on both transfer documents' lines if B's WAC moved between them.

### MTP-WHS-32 — Transfer OUT respects the negative-stock policy exactly like an adjustment
- **Preconditions:** `allowNegativeStock` OFF. Item with 3 on-hand in the source warehouse.
- **Steps:** attempt to transfer 10 units out.
- **Expected:** rejected with `NegativeStockError` before either leg posts —
  `TRANSFER` is not in `BACKORDERABLE_SOURCES`, so only `allowNegativeStock`
  (not `allowBackorder`) can ever license this.
- **False pass:** the OUT leg posts (source goes negative) while the IN leg
  fails separately, leaving the destination unchanged but the source short —
  since both legs run inside one `runInTransaction`, this should be
  impossible; verify it actually is by forcing the scenario and checking BOTH
  warehouses, not just the one that errored.

### MTP-WHS-33 — Load a delivery van (سياره نقل / VAN warehouse) via a transfer
- **Persona / permission:** any of the roles above, or the field-sales flow via `VanTripsScreen.tsx`.
- **Preconditions:** a warehouse of type **ڤان** exists (see MTP-WHS-38).
- **Steps:** open «رحلات المندوبين» → open a new van trip, choosing the van
  and a source (main) warehouse, add loaded-stock lines.
- **Expected:** `openVanTrip` calls the exact same `stock.postTransfer` engine
  ("loading stock onto the van is a valuation-neutral warehouse transfer" per
  the code comment) — this is not a bespoke van-stock mechanism, it is a
  regular transfer under a friendlier form. Source warehouse on-hand drops,
  van warehouse on-hand rises, at the source's WAC, no GL impact.
- **False pass:** treating the van trip's stock loading as something
  independently verified from the ordinary transfer engine — it is literally
  the same function; a defect found in MTP-WHS-27–32 reproduces here too.

### MTP-WHS-34 — Settling a van trip reconciles counted-vs-expected stock like a mini physical count
- **Steps:** after MTP-WHS-33, settle the van trip, entering counted quantities
  for what remains on the van (`settle-van-trip.ts`).
- **Expected:** any shortfall between expected and counted stock is surfaced,
  and counted cash/stock returns from the van warehouse back toward the
  source treasury/warehouse. Note the code comment on the expected-qty
  computation: "there's no 'van sale stock consumption' line item yet, so
  expected does not net out" — read this literally.
- **False pass:** assuming "expected" already nets out van sales — the code
  comment explicitly warns it may not; verify what the settlement screen
  actually shows as the variance baseline before trusting it.

---

## Warehouse types (5) and branch/warehouse master data

### MTP-WHS-35 — Create one warehouse of each of the 5 catalog types
- **Persona / permission:** `admin.warehouses.create`.
- **Steps:** `Settings → المستودعات` → **"إضافة مستودع"**, create one warehouse
  per type: رئيسي (MAIN), مستودع وسيط (staging), مرتجعات (returns), إنتاج
  (production), ڤان (van) — `WAREHOUSE_TYPE_DEFINITIONS` in `@mezan/domain`
  drives both the type dropdown and the filter chips in `WarehousesPage.tsx`.
- **Expected:** all 5 save and appear as filter chips; each can independently
  be marked «افتراضي» (default) per branch.
- **False pass:** all 5 types save fine but behave IDENTICALLY afterward —
  see MTP-WHS-36, because a "type" field with no behavioural difference is cosmetic.

### MTP-WHS-36 — Do the 5 warehouse types actually behave differently, or is `type` decorative?
- **Steps:** compare what an adjustment/transfer/receipt/count against a
  رئيسي warehouse can do vs. against a مرتجعات or إنتاج warehouse (e.g. can a
  goods receipt target a production or returns warehouse? Can a stock count
  be started against a van?).
- **Expected (per the code actually grepped):** `WAREHOUSE_TYPE_DEFINITIONS`
  supplies the label/description only; no code path in
  `stock-documents-routes.ts`, `stock-ledger-service.ts`, or
  `purchases-routes.ts` branches on `warehouse.type` to restrict which
  documents may target which type. Every warehouse type accepts receipts,
  adjustments, transfers, and counts identically.
- **False pass:** none — record plainly, per the brief's instruction to "say
  plainly whether it should be blocked... and what the current behaviour is":
  `type` is currently a LABEL, not a behavioural gate. A production warehouse
  can be directly received into from a supplier, and a returns warehouse can
  originate a normal sale-fulfilling transfer — neither is stopped.

### MTP-WHS-37 — A warehouse's code is immutable after creation
- **Steps:** edit an existing warehouse via `WarehousesPage.tsx`; look for the code field.
- **Expected:** verify whether `code` is actually excluded from the update
  payload or disabled in an edit form. Note: only a create `SidePanel` was
  confirmed present in the code read for this plan — if there is no dedicated
  edit dialog at all (only create + the `PUT /warehouses/:id` route, which
  does accept `code` per `updateWarehouseSchema` unless the screen omits the
  field), record which is actually true; a route that accepts a field the
  screen never renders is not evidence the field is protected.
- **False pass:** assuming immutability from the catalog description alone
  without checking the current screen's actual fields.

### MTP-WHS-38 — Only branch scope narrows the warehouse picker; warehouse scope does not
- **Persona / permission:** a user whose `warehouseScope` (set via `Settings
  → المستخدمون` / `UsersPage.tsx`) is ONE specific warehouse inside a branch
  that has two or more warehouses.
- **Steps:** sign in as that user; open any create form with a warehouse
  picker (goods receipt ad-hoc, stock adjustment, stock transfer, physical count).
- **Expected (actual code):** `GET /warehouses` (`warehouses-routes.ts`) only
  applies `withinScope(..., branchScopeOf(c), w => w.branchId)` — there is no
  equivalent narrowing by `warehouseScopeOf(c)`. A user scoped to exactly one
  warehouse still sees and can pick EVERY warehouse in their branch in these dropdowns.
- **False pass:** confusing "the dropdown is short because the branch only
  has 2 warehouses" with "the dropdown is correctly scoped" — add a third
  warehouse to the branch and confirm it still appears for the narrowly-scoped user.

### MTP-WHS-39 — Warehouse scope is not enforced on WRITE for any inventory document either
- **Persona / permission:** same narrowly-scoped user as MTP-WHS-38.
- **Steps:** using that user's session, submit `POST
  /inventory/stock-adjustments/draft` (or `/inventory/stock-transfers/draft`,
  or `/purchases/receipts`) with a `warehouseId` belonging to a DIFFERENT
  warehouse than the user's scope (via devtools/API client, since the UI
  dropdown in MTP-WHS-38 already offers it).
- **Expected (actual code):** it succeeds. `warehouseScopeOf(c)` is used only
  inside the `GET` list/filter handlers in `stock-documents-routes.ts`,
  `purchases-routes.ts` and `inventory-routes.ts` (confirmed by grep — every
  usage is on a list-returning route); none of the `POST /draft`, `POST
  /:id/confirm`, or `POST /receipts` handlers check the submitted
  `warehouseId` against the caller's scope.
- **False pass:** believing the keeper is contained to their assigned
  warehouse because the reports correctly hide other warehouses from them —
  the WRITE path has no such check, so a warehouse-scoped keeper (or anyone
  who can reach the API with their session) can post an adjustment, transfer,
  or receipt into any warehouse in the tenant, and it simply will not show up
  in their own filtered list afterward — a textbook place for real-world
  stock to drift silently between the physical count and the system, exactly
  the dealbreaker category the brief calls out. This is the single most
  important finding in this test plan.

---

## Physical count (الجرد الفعلي)

### MTP-WHS-40 — Start a count; every non-zero item in the warehouse is loaded automatically
- **Steps:** «الجرد الفعلي» → **"جرد جديد"**, pick a warehouse, leave «جرد
  أعمى» off, click **"إضافة"**.
- **Expected:** the count is created pre-populated with one line per item that
  currently has non-zero on-hand in that warehouse (`balanceQuery` filters
  `Number(r.onHand) !== 0` client-side before calling `start`); status is «قيد التنفيذ».
- **False pass:** an item with exactly 0 recorded on-hand but real physical
  stock on the shelf (e.g. never received through the system) is silently
  NOT on the count sheet — the count can only ever find variance on items the
  system already believes exist.

### MTP-WHS-41 — Enter counted quantities and finish an OPEN (non-blind) count
- **Steps:** in the counting grid, the system qty column is visible; type a
  counted qty different from system qty for at least one line; **"إنهاء الجرد"**.
- **Expected:** status → «مكتمل»; the count's `variance` object populates
  (`overLines`/`shortLines`/`overValue`/`shortValue`/`netValue`) computed
  server-side from `(countedQty − systemQty) × unitCost` per line — the
  screen never recomputes this itself, only formats the exact strings the API returns.
- **False pass:** the variance shown client-side doesn't match a manual
  qty×cost check — since the screen deliberately never recomputes, any
  mismatch here is a genuine server bug, not a display rounding artifact.

### MTP-WHS-42 — Blind count hides system quantities during entry
- **Steps:** start a new count with «جرد أعمى» toggled on; open the counting grid.
- **Expected:** the system-qty and variance columns are hidden while
  `count.status === "IN_PROGRESS"` (`blindOpen` in `CountEntryView`); the
  banner reads the blind-count copy; variance only appears after **"إنهاء الجرد"**.
- **False pass:** the system qty is hidden in the table but still visible by
  inspecting the network response in devtools — check whether the API itself
  withholds `systemQty` while blind+in-progress, or only the UI hides it (a
  determined keeper trying to game their own count would see it either way
  if it's a client-side hide only).

### MTP-WHS-43 — Generate the reconciling adjustment from a completed count
- **Steps:** on a «مكتمل» count's detail page, click **"توليد تسوية"**.
- **Expected:** status → «تم إنشاء التسوية»; a new Stock Adjustment document
  is created and CONFIRMED with reason `PHYSICAL_COUNT` ("تصحيح جرد"), whose
  lines' net qty change matches each count line's variance exactly; on-hand
  now matches what was counted; GL posts to `PHYSICAL_COUNT`'s counterpart
  account (`5074`) for the net value. The count detail's «التسوية الناتجة»
  field shows «تم الإنشاء».
- **False pass:** the count shows «تم إنشاء التسوية» but on-hand still shows
  the OLD system qty, not the counted qty — check `أرصدة المخزون` for at
  least one varied item, not just the count/adjustment status pills.

### MTP-WHS-44 — Generating the adjustment twice is refused (a count posts variance once, not history-overwriting)
- **Steps:** having already generated the adjustment in MTP-WHS-43, click
  **"توليد تسوية"** again if still reachable, or re-POST
  `/inventory/physical-counts/:id/generate-adjustment`.
- **Expected:** rejected — the count is already in status
  `ADJUSTMENT_GENERATED`, which is terminal for that action; only a `COMPLETED`
  count shows the generate button in the UI at all.
- **False pass:** a second adjustment silently posts, doubling the variance
  correction and moving stock a second time for the same physical event —
  this is precisely the dealbreaker "a count that overwrites history instead
  of posting a variance," inverted: check it does NOT double-post either.

### MTP-WHS-45 — Cancel an in-progress count abandons it without touching stock
- **Steps:** start a count, do not finish it, use the row menu's **"إلغاء"**.
- **Expected:** status → «ملغي»; no adjustment, no stock change, no GL entry —
  a count only affects stock once it reaches `ADJUSTMENT_GENERATED`.
- **False pass:** cancelling still leaves a variance value cached and visible
  somewhere in the UI, implying a phantom correction happened.

### MTP-WHS-46 — Counting the same item twice in one session is structurally impossible; two OVERLAPPING counts on the same warehouse are not prevented
- **Steps:** (a) in the counting grid, confirm each item appears exactly once
  (the grid is keyed by `itemId`, one row per item — no "add item" control
  exists on an open count, so a duplicate entry cannot occur within one count).
  (b) Start a SECOND count on the SAME warehouse while the first is still «قيد
  التنفيذ» / «مكتمل» and not yet adjustment-generated.
- **Expected for (a):** impossible to duplicate a line within one count —
  pass by construction. For (b): verify whether the system blocks a second
  concurrent count on the same warehouse, or allows two counts to both
  propose adjustments against the same, now-stale, system snapshot.
- **False pass:** assuming (a)'s guarantee also covers (b) — they are
  different questions; check (b) explicitly, since two live counts on one
  warehouse is exactly how a keeper could "count twice" and post two
  different variances for the same physical stock.

---

## Batch, expiry, FEFO

### MTP-WHS-47 — FEFO picking: the earlier-expiring batch is consumed first
- **Preconditions:** an item with two batches in the same warehouse, batch A
  expiring sooner than batch B, both with remaining qty, received via two
  separate ad-hoc receipts per MTP-WHS-10.
- **Steps:** post a stock-adjustment OUT (any OUT reason) or a sale for a qty
  that only needs batch A's remaining qty.
- **Expected:** the cost layer consumed is batch A's (earliest `expiryDate`
  first — `compareLayersForConsumption` in `cost-layer.ts`: "a layer that
  expires is consumed before one that never does, earliest expiry before
  later"). Verify via the item's «طبقات التكلفة» tab: batch A's remaining qty
  drops, batch B's does not.
- **False pass:** total on-hand drops by the right amount but batch B (the
  later-expiring one) was the one actually drawn down — this silently
  accelerates spoilage of the batch that should have been sold/used first.

### MTP-WHS-48 — An item with no expiry date on any layer falls back to FIFO ordering
- **Steps:** repeat MTP-WHS-47 for a non-expiry-tracked item with two receipt-dated layers.
- **Expected:** the layer received FIRST (earlier receipt date) is consumed first.
- **False pass:** consumption order is receipt-id order rather than
  chronological, which happens to match in the simple case but diverges once
  documents are entered out of date order.

### MTP-WHS-49 — Expiring-soon report surfaces batches nearing expiry
- **Steps:** open «تقارير المخزون» → the aging report's «قريب من الانتهاء»
  tab (`InventoryExpiringReportScreen` inside `InventoryAgingReportScreen`'s tabs).
- **Expected:** lists batches with an `expiryDate` within the report's
  horizon, keyed to the real cost layers created in MTP-WHS-10/47 — not a
  static/mock list.
- **False pass:** the report is empty even though MTP-WHS-47's batch A is
  genuinely close to expiring — confirm the report's date horizon and
  warehouse filter aren't silently excluding it.

### MTP-WHS-50 — Receiving with an expiry date in the PAST is not blocked
- **Steps:** ad-hoc receipt, batch-tracked item, enter an expiry date before today.
- **Expected:** record actual behaviour — does the form or the API reject a
  past expiry date, or does it happily create an already-expired cost layer?
  (No such validation was found in `goods-receipt.ts`'s `validateLines`.)
- **False pass:** assuming this is blocked without having tried it — the
  domain code inspected has no such check.

---

## Serial numbers — gap, see final section

No serial-number tracking exists anywhere in this codebase (confirmed by
repository-wide grep for "serial" across `packages/domain`, `packages/api`,
`apps/web` — zero matches outside this document). See "Gaps" below.

---

## Negative stock — setting-driven, verified above per-document

The policy is `allowNegativeStock` (tenant setting, default OFF) plus the
narrower `allowBackorder` (also default OFF, and ONLY applies to
`SALES_INVOICE`/`POS_SALE` source types per `BACKORDERABLE_SOURCES` in
`stock-ledger-service.ts` — never to an adjustment, transfer, or receipt).
See MTP-WHS-23/24/32 for the adjustment/transfer cases. The remaining case:

### MTP-WHS-51 — Backorder allows a SALE to go short even with `allowNegativeStock` OFF
- **Preconditions:** `allowNegativeStock` OFF, `allowBackorder` ON. Item with 2 on-hand.
- **Steps:** confirm a sales invoice or POS sale for qty 5 of that item.
- **Expected:** the sale confirms (its source type is in
  `BACKORDERABLE_SOURCES`), on-hand goes to -3; a subsequent stock adjustment
  or transfer OUT on the same item, by contrast, is STILL blocked at
  `NegativeStockError` even in this state, since `allowBackorder` is narrower
  by design ("it never licenses an adjustment or a transfer" per the code comment).
- **False pass:** concluding "negative stock is allowed" or "blocked" as one
  global fact — it is per-source-type; test the sale and an adjustment
  side-by-side in the same negative-on-hand state and expect them to disagree.

---

## Barcodes and labels

### MTP-WHS-52 — All three catalog label sizes are selectable and render correctly
- **Steps:** «طباعة الملصقات», add an item, cycle the **"قالب الملصق"**
  dropdown through all three: **"ملصق حراري — 40×30mm"**, **"ملصق رف —
  50×25mm"**, **"ملصق منتج — 100×50mm"** (`LABEL_TEMPLATES` in
  `label-template.ts`, codes `THERMAL_40x30` / `SHELF_50x25` / `PRODUCT_100x50`).
- **Expected:** the preview tile resizes to each template's exact mm
  dimensions (`width: ${template.widthMm}mm`); the print `@page` CSS rule
  updates to match; the barcode SVG renders via `bwip-js` (code128).
- **False pass:** all three options exist in the dropdown but the preview
  tile never visually changes size between them — check the rendered `style`
  width/height, not just the label text.

### MTP-WHS-53 — A barcode too long for the chosen template is flagged, not silently truncated
- **Steps:** add an item whose barcode is long relative to a small template
  (e.g. `THERMAL_40x30`); observe the row and the preview.
- **Expected:** `line.messageAr` renders in red under the barcode value (a
  "too long to fit legibly" warning from `buildLabelBatch`/`checkBarcodeFit`);
  **"معاينة وطباعة"** is disabled while `batch.hasBlockingIssues` is true.
- **False pass:** the label prints anyway with an illegibly squeezed barcode
  that a warehouse scanner cannot read — verify the print button is actually
  disabled, not just the warning text shown.

### MTP-WHS-54 — Printing a label never changes any price
- **Steps:** print a label for an item, then check the item's «سعر البيع» before and after.
- **Expected:** unchanged — the screen's own disclaimer states this
  explicitly ("الطباعة لا تغير أي سعر" — verify the exact printed price shown
  matches the item's live `salePrice`, since this is a pure read/render path
  with no mutation).
- **False pass:** n/a — this is a read-only screen by construction; only
  worth confirming no `PATCH`/`POST` fires when **"معاينة وطباعة"** is
  clicked (devtools network tab).

### MTP-WHS-55 — Scanning a barcode into a document does not work — a real gap
- **Steps:** in the goods-receipt ad-hoc item picker, the stock-adjustment
  line item picker, or the stock-transfer line item picker, focus the item
  field and type/scan a barcode value (not the item's Arabic name).
- **Expected (actual code):** it fails to find the item. `GoodsReceiptsScreen.tsx`'s
  `itemOptions` builds `EntityPicker` options as `{ id, label: i.nameAr }` —
  no `sublabel` carrying the code or barcode — and `EntityPicker`'s own
  filter (`packages/ui/src/primitives/EntityPicker.tsx`) matches only against
  `label + sublabel`. `StockAdjustmentsScreen.tsx` and `StockTransfersScreen.tsx`
  use a plain `<Select>` (native dropdown) for the item field, not a
  search-as-you-type control at all. Only the server-side items search
  (`GET /inventory/items?search=`, used by the Items list itself) actually
  matches against `item.barcodes`.
- **False pass:** believing barcode scanning "should work" because the
  backend CAN match barcodes — the document-entry screens never call that
  endpoint with the scanned text; they filter an already-loaded, name-only
  option list client-side. Test this literally: scan/type a real barcode
  value into each of the three pickers above and confirm nothing matches.

---

## Reports — balance, movement, valuation, and their money

### MTP-WHS-56 — أرصدة المخزون (Stock Balance) totals match the sum of a document's effects
- **Steps:** note an item's on-hand/available/reorder-point/avg-cost/total-value
  before and after confirming one of MTP-WHS-01/14/27; open «أرصدة المخزون»,
  expand the item's per-warehouse row if it spans more than one warehouse.
- **Expected:** the delta in on-hand and total value exactly matches the
  document's own effect (qty × unit cost, or qty only for a transfer since
  value is unchanged there). Available = on-hand − reserved.
- **False pass:** the top-level row's total matches but the expanded
  per-warehouse breakdown doesn't sum to it — this can happen if the rollup
  and the per-warehouse query disagree about which warehouses to include.

### MTP-WHS-57 — Stock movement / ledger report shows every posted movement with a running balance
- **Steps:** open «تقارير المخزون» → السجل والحركة, filter to one item/warehouse,
  compare against every document confirmed in this test run (receipts,
  adjustments, transfers' both legs, count-generated adjustment).
- **Expected:** one ledger row per posted movement (`StockMovement`), each
  tagged with its `sourceDocType`/`sourceDocId`; the running balance column
  reconciles to the current `أرصدة المخزون` figure at the last row.
- **False pass:** a transfer only shows its OUT leg in this item/warehouse
  view and you forget to also check the destination warehouse's IN leg —
  both must be present as separate ledger rows (same `sourceDocId`, different
  `warehouseId`/direction).

### MTP-WHS-58 — Valuation report reconciles against the GL, and says so when it does not
- **Steps:** open «تقييم المخزون». Read the reconciliation card: قيمة المخزون
  من السجلات المحاسبية (from GL) vs. المحسوب من المخزون × التكلفة (computed)
  vs. الفرق.
- **Expected:** after a clean run of receipts/adjustments/transfers above, the
  difference should trend toward the values your own scenarios produced; if a
  drift banner appears (`inventoryReports.driftBanner`), it names how many
  items disagree and links to the drift tab.
- **False pass:** treating a nonzero «الفرق» as "the report is broken" instead
  of what it is — a real accounting-vs-subledger disagreement the GL is
  authoritative for; the correct response is investigating the named items on
  the drift tab, not distrusting the report.

### MTP-WHS-59 — Drift tab names the specific items whose WAC disagrees with their own cost layers
- **Steps:** open the «تقييم المخزون» → الفروقات (drift) tab.
- **Expected:** `createInventoryDriftReport` lists, per item, where the live
  weighted-average cost diverges from what the item's remaining cost layers
  would price it at (`checkDrift` in `wac.ts`) — this is the sub-ledger vs
  control-account pairing the brief demands, applied to costing itself.
- **False pass:** an empty drift tab immediately after a fresh negative-stock
  scenario (MTP-WHS-24) — a negative-position OUT is exactly where a WAC
  engine is most likely to drift from its layers; specifically re-check drift
  after running MTP-WHS-24.

### MTP-WHS-60 — Aging / slow-moving reports use real receipt and movement dates, not "now"
- **Steps:** open «تقارير المخزون» → الأعمار, its أعمار / بطيء الحركة tabs.
- **Expected:** age/slow-moving buckets are computed from each layer's actual
  receipt date and last-movement date (`aging.ts`) — an item received via
  MTP-WHS-01 today should show age 0, not aged, and should not appear on the
  slow-moving list.
- **False pass:** a freshly-received item already shows up as aged/slow-moving
  — check whether `occurredAt` on the movement is the document's own date or
  a wall-clock stamp (the `occurredAtFromDocumentDate` helper exists
  specifically to avoid this class of bug; confirm it's actually used on the
  path you just exercised).

---

## Reorder points — flagged, not actioned

### MTP-WHS-61 — Reorder point drives the "low stock" badge everywhere, consistently
- **Steps:** set an item's «نقطة إعادة الطلب» in الأصناف; bring its on-hand
  at or below that point via an OUT adjustment; check the badge on: الأصناف
  list, أرصدة المخزون, and the item detail page.
- **Expected:** all three read the SAME `item.reorderPoint` and the SAME
  live `onHand` and agree on «مخزون منخفض» — `StockBalanceScreen.tsx`'s own
  `reorderPointOf` explicitly notes "an item without a reorder point is
  never low," so an item with `reorderPoint: null` must NEVER show low-stock
  regardless of how close to zero it is.
- **False pass:** an item with no reorder point set still shows a low-stock
  badge somewhere (inconsistent with the documented rule above) — or one
  screen flags low while another doesn't for the identical item.

### MTP-WHS-62 — «كمية إعادة الطلب» (reorder qty) is stored but drives nothing
- **Steps:** set both reorder point AND reorder qty on an item; bring it
  below the reorder point; look for any suggested-PO-quantity surface (a
  purchase order draft, a reorder report, a "create PO" quick action prefilled
  with the reorder qty).
- **Expected (actual code):** `reorderQty` is persisted on the item
  (`create-item.ts`/`update-item.ts`/`items-routes.ts`) and editable in the
  item form, but no purchasing route, report, or screen was found reading it
  back to suggest anything — it is validated (`>= 0`) and stored, full stop.
- **False pass:** assuming the low-stock badge's presence means "reorder
  suggestions work" — the badge only reads `reorderPoint`; `reorderQty` has
  no consumer anywhere in the grepped codebase. Record this as a gap: the
  field exists, looks actionable in the item form, and does nothing downstream.

---

## Purchase returns — bounded by what was actually received

### MTP-WHS-63 — Returning goods never received is blocked, and the cap is server-computed
- **Preconditions:** a confirmed purchase invoice with a known received/invoiced qty.
- **Steps:** open «مرتجعات الشراء», create a return against that invoice for
  a qty greater than what was actually invoiced/received.
- **Expected:** rejected. `purchase-returns-routes.ts` explicitly recomputes
  `availableQty` server-side via `resolveAvailableQty(sourceInvoiceId, itemId,
  ...)` rather than trusting the qty the client sends — the code comment
  states this directly: "the client's `availableQty` is a hint, never the
  cap," fixing a prior defect where "the same goods could be returned repeatedly."
- **False pass:** trusting the UI's displayed «الكمية المتاحة» number as proof
  of the cap — that number is a hint the client shows for convenience; the
  actual test is submitting MORE than it via direct API and confirming the
  server still refuses.

### MTP-WHS-64 — Two partial returns against the same invoice cannot together exceed what was received
- **Steps:** return half the invoiced qty of an item, confirm it, then attempt
  to return the same qty again (which would total more than 100%).
- **Expected:** the second return is capped by the REMAINING available qty
  (invoice qty minus already-returned qty), not the original invoice qty again.
- **False pass:** the second return's «الكمية المتاحة» resets to the full
  original amount instead of the remainder — this would reproduce exactly
  the "same goods returnable forever" defect the code comment says was
  already fixed elsewhere.

---

## Gaps — no screen to test

These are journeys named in the brief with no operable screen and no route
found anywhere in `apps/web/src/screens` or `packages/api/src/*-routes.ts`
(repository-wide grep, confirmed empty):

1. **Serial numbers.** No serial-number field, no serial-tracked item flag, no
   serial-scan-on-receipt/issue UI, and no `serial` occurrence anywhere in
   `packages/domain`, `packages/api`, or `apps/web` outside this document.
   Only batch/lot + expiry (FEFO) is built; item-unique serial tracking for
   high-value goods (electronics, equipment) does not exist.

2. **Warehouse-type-specific behaviour.** All 5 types (`MAIN`, staging,
   returns, production, van) are selectable master data (MTP-WHS-35) but no
   code path restricts which documents may target which type (MTP-WHS-36) —
   there is no screen or rule to test because none exists; `type` is a label only.

3. **In-transit transfer state.** No screen, status, or domain state models a
   transfer as "on the way" — confirm is instantaneous (MTP-WHS-29). Nothing
   to test because the state itself was never built.

4. **Reorder-driven purchasing.** No "suggested reorder" report, no
   auto-drafted purchase order from a low-stock/below-reorder-point
   condition, and no screen reads `item.reorderQty` back out (MTP-WHS-62).
   The only reorder consumer is the low/out-of-stock badge, which uses
   `reorderPoint` alone.

5. **Barcode scan-to-find in a document.** No item picker on Goods Receipts,
   Stock Adjustments, or Stock Transfers searches by barcode/code — only by
   the item's Arabic name (MTP-WHS-55). There is no dedicated "scan mode" UI
   anywhere in these three screens.

6. **A dedicated warehouse-scoped write guard.** `warehouseScopeOf` exists as
   a concept and IS enforced on every list/read route in the inventory
   domain, but there is no equivalent check anywhere a document is CREATED or
   CONFIRMED (MTP-WHS-39) — this is not a missing screen so much as a missing
   half of an existing mechanism, listed here because there is nothing on any
   screen a tester could click to exercise a guard that was never wired.

7. **Standalone «إذن صرف» (issue) document.** There is no issue-to-department/
   kitchen/production-floor document distinct from Stock Adjustments — every
   non-sale, non-transfer OUT movement is modelled as an adjustment with a
   reason. If the product intends a distinct, non-valuation-affecting "issue
   to internal consumption" document (as opposed to a value-affecting
   adjustment), it does not exist; only the adjustment mechanism does.
