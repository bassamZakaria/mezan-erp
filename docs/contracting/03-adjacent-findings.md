# Findings outside the contracting module

The reviewers read real code, and several came back with things that are wrong
today, in shipped paths, independent of whether contracting is ever built. They are
recorded here rather than in the contracting design, and each needs its own
reproduction before it earns a place in `docs/defects.md`.

## Confirmed by hand

**The contracting advance voucher recovers from a document that does not exist.**
`packages/domain/src/vouchers/voucher-types.ts` ships `customer_advance`, labelled
«دفعة مقدمة من عميل مقاولات», with the subtitle «دفعة مقدمة يدفعها العميل على عقد
مقاولة (تُسترد من المستخلصات)». It posts to 2160 and is `allocatable: false`. The
مستخلصات it names do not exist, so the liability it records can never be discharged
inside the product. This is an in-phase defect, not a feature request.

**The `CONTRACT` numbering sequence has no consumer.** `CTR-` is defined in
`numbering/sequences.ts` and nothing calls it.

**`projects` has two permissions.** `projects.project.view` and
`.manage` — one right covers creating the project, the BOQ, the variation order, the
certificate and the subcontractor. No segregation of duties is expressible.

**Retention is receivable-only.** `account-routing.ts` has
`contracting.retention_receivable` with no payable counterpart.

## Candidates — plausible, and each needs a reproduction before it is called a defect

**Landed cost arriving after the goods are fully consumed.** In
`packages/domain/src/inventory/wac.ts`, a revaluation movement adds its `valueDelta`
to `totalValue` unconditionally. If a receipt is fully issued and customs then
arrives, the position holds value against zero quantity and the cost never reaches
whatever consumed the goods. Worth driving end to end; it is the shape of a real
money bug, not a reading error.

**Caller-supplied cost and date on stock documents.** `postAdjustmentSchema` accepts
a per-line `unitCost`, and both the adjustment and transfer schemas accept
`occurredAt` and a caller-supplied document number and id. The skill's first rule —
never trust a number the caller supplied — applies directly; the reported absence of
a fiscal-period check on stock movements while the GL enforces one would let the
sub-ledger be backdated into a period the journal refuses.

**Supplier master has no bank field and no audit write.** `supplierSchema` carries no
bank account, and `updateSupplierSchema` is a partial of the create schema with no
audit event. Every payee detail is silently editable — the ghost-supplier control an
internal auditor tests for.

**There are no exception reports anywhere in the product.** 33 reports and not one
adjustments-by-user, voided-documents, edited-after-posting or after-hours-activity
report. For a contracting customer this is not a gap in a module, it is the missing
half of the control environment.

**The print renderer cannot paginate.** `PrintView.tsx` renders one
`overflow-hidden` column with a single header and a totals block at the bottom.
There is no page-break handling, no repeated table header and no carried-forward
subtotal. A multi-page BOQ certificate — the central document of this module — cannot be
printed correctly today, and `pageSize` is `A4 | A5` with no orientation field even
though the Electron print path already carries an unused `landscape` flag.

**Cost Center P&L does not roll up.** It buckets on the exact `costCenterId` with no
parent aggregation, though cost centers are hierarchical.
