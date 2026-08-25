# Mezan — business scenarios

> **Archived — point-in-time.** This was the first pass of business scenarios — 29 lifecycles taken from the catalog. Retired 2026-08-25, superseded by `../scenarios/01..09`, which are per-domain, roughly 25× the size, and each paired with an executable suite. Kept for its evidence, not its conclusions.

Phase 3 of `testing-plan.md`. Where the plan proves a control *reacts*, these
prove the business *did the right thing*.

Every lifecycle below is taken from `docs/catalog/01..09`, which was captured
from the running reference product — the states and transitions are the
reference's, not invented. The catalog records 84 status definitions; the ~30
that are real multi-step document lifecycles become the scenarios here. POS is
excluded (deferred by decision).

## The two invariants every money scenario asserts

Check both **before and after** each scenario. They are what caught three of the
four open defects in `defects.md`.

1. **Trial balance balances** — `debit == credit` exactly.
2. **The inventory sub-ledger reconciles to GL 1200** exactly, and AP too.
   AR will not, until D1 is fixed.

If a scenario moves stock or money and *neither* invariant moves, that is itself
the finding: the document posted nothing.

## Reading a scenario

**Pre** — what must exist first. The demo seed provides all of it.
**Steps** — the user's path, through the UI.
**Assert** — what must be true afterwards. A step with no assertion is a click,
not a test.
**Reload and re-check** anything that claims to have persisted.

---

## Order to cash

### S1 — Quote → accepted → invoice → collected
Catalog: مسودة → مرسل → مقبول → محول, with مرفوض and منتهي as side states.

- **Pre**: a customer, an item with stock, a price list.
- **Steps**: create quote → send → accept → convert to invoice → confirm → collect a partial payment → collect the remainder.
- **Assert**: the quote reaches محول and links to the invoice it became; the invoice's price comes from the price list, not the item's default; stock falls by the sold quantity; AR rises by the grand total; after the first collection the invoice reads مدفوع جزئياً, after the second مدفوع.
- **Known**: the collection will *not* move `amountPaid` (**D1**). Record the AR delta you observe; do not file it again.

### S2 — Quote rejected, and quote expired
- **Steps**: create and send two quotes; reject one; let the other pass its validity date.
- **Assert**: both reach a terminal state, neither is convertible afterwards, and neither has posted anything to the ledger.

### S3 — Sales return against a confirmed invoice
Catalog: مسودة → مؤكد → بانتظار دفع المبلغ.

- **Steps**: create a return from a confirmed invoice, for part of one line → confirm.
- **Assert**: returnable quantity is capped at what was actually invoiced (try to exceed it — it must be refused); stock comes back; AR falls by the return's grand total; the invoice detail shows the return under إجمالي المرتجع and the net after returns; the return sits at بانتظار دفع المبلغ, having **not** auto-refunded cash.

### S4 — Promotion applied at confirm
- **Steps**: create an invoice whose lines qualify for an active promotion → confirm.
- **Assert**: the discount is deducted before VAT; the invoice records *which* promotion applied; the promotions report counts it; deactivating the promotion afterwards does **not** change what the historical invoice says it granted.

---

## Procure to pay

### S5 — RFQ → PO → receipt → invoice
Catalog: RFQ مسودة → مرسل → مغلق; PO مسودة → مرسل → مستلم جزئياً / مستلم بالكامل.

- **Steps**: create an RFQ with two supplier quotes → close it on the cheaper → convert to a PO → confirm → receive part of it → invoice the receipt → confirm.
- **Assert**: the PO shows مستلم جزئياً, not مستلم بالكامل; stock rises only by what was received; AP rises by the invoice total; the receipt moves to "invoiced".
- **Watch**: confirming a goods receipt moves stock with **no GL entry** — the offsetting entry only posts when its invoice confirms. A receipt left confirmed-but-uninvoiced puts the sub-ledger ahead of GL 1200. If you see that gap, it is this, not a new defect.

### S6 — Landed cost distributed over a receipt
- **Steps**: create a landed cost against a confirmed receipt, two cost items, distributed BY_VALUE → confirm.
- **Assert**: the allocated amounts sum to exactly the total entered (no rounding leak); each item's unit cost rises; inventory valuation rises by the same total; AP rises by it too.

### S7 — Purchase return
- **Steps**: return part of a received quantity → confirm.
- **Assert**: stock falls; AP falls by the return's total; returning more than is on hand is refused.

---

## Inventory

### S8 — Transfer between warehouses
Catalog: مسودة → مؤكد, one-way; reversal needs a new transfer in the opposite direction.

- **Steps**: transfer part of an item's stock to a second warehouse → confirm → attempt to reverse it by editing.
- **Assert**: source falls, destination rises, total unchanged; **inventory still reconciles to GL 1200 exactly** (a transfer moves no value out of the company); editing after confirm is refused.

### S9 — Physical count with a variance
Catalog: قيد التنفيذ → مكتمل → تم إنشاء التسوية.

- **Steps**: start a count, enter a counted quantity below the system quantity, complete it, generate the adjustment.
- **Assert**: the variance equals system − counted; the adjustment moves stock by exactly that.
- **Known**: the adjustment posts **no journal entry** (**D2**), so the sub-ledger moves and GL 1200 does not — by exactly the variance's value. Expect it; do not re-file it.

### S10 — Blind count
- **Steps**: start a count with blind counting on.
- **Assert**: the system quantity is not visible while counting. This is the entire point of the feature — if it shows, that is a real defect.

---

## Manufacturing

### S11 — Work order through completion
Catalog: مخطط → قيد التنفيذ → مكتمل.

- **Steps**: create a work order from a BOM → start → issue components → complete.
- **Assert**: components leave stock, the finished item enters it, and the BOM's labour and overhead land in cost.
- **Known**: `completeWorkOrder` never touches GL 1200 (**D3**) — measured at 80.00 off for BOM-DEMO-1 at qty 10. **This scenario will unbalance the books.** Run it on a throwaway database, and do not run it before a scenario that asserts reconciliation.

---

## Accounting

### S12 — Journal entry, posted then reversed
Catalog: مسودة → بانتظار الموافقة → مرحل → معكوس.

- **Steps**: create an unbalanced draft (must be refused) → balance it → post → reverse.
- **Assert**: the original is marked معكوس and **not** mutated or deleted; the reversal is a new posted entry with debit and credit mirrored; trial balance balances at every step.

### S13 — Fiscal period closed, then locked
Catalog: مفتوحة → مغلقة → مقفلة.

- **Steps**: close a period → attempt to post into it → lock it → attempt to reopen.
- **Assert**: posting into a closed period is refused with a period error, not a generic failure; a locked period cannot be reopened.

### S14 — Comparative income statement
- **Steps**: run the income statement over a window with activity in both it and the preceding one, in both comparison modes.
- **Assert**: the prior column for a window equals the current column when that prior window is run directly — this is the check that catches an off-by-one in the comparison range. An account active in only one window still appears, with zero on the empty side.

---

## Treasury

### S15 — Voucher through approval
Catalog: مسودة → بانتظار الموافقة → مؤكد.

- **Steps**: create a receipt voucher over the approval threshold → submit → approve as the role-holder → confirm.
- **Assert**: it cannot be confirmed while pending; the GL entry posts only on confirm; trial balance balances.

### S16 — Cheque collected, and cheque bounced
- **Steps**: register an incoming cheque → mark collected. Register a second → mark bounced.
- **Assert**: the collected one increases the bank balance; the bounced one reverses cleanly and the customer's balance returns to what it was.

### S17 — Installment plan and its overdue state
- **Steps**: create a plan against a confirmed invoice → let a due date pass.
- **Assert**: the schedule's instalments sum to exactly the invoice total (no rounding leak on the final line); the overdue report lists the late instalment and no other.

### S18 — Bank statement import and matching
- **Steps**: import `test-fixtures/bank-statements/august-2026.csv` → map columns → match rows to vouchers.
- **Assert**: the header row drives the mapping; the unmatchable row stays unmatched rather than being force-matched; the match percentage reflects reality.

---

## HR

### S19 — Payroll run through disbursement
Catalog: مسودة → محتسب → معتمد → مصروف.

- **Steps**: create a run → calculate → approve → disburse.
- **Assert**: an employee with no active contract is **excluded with a named warning**, not silently skipped or given a zero payslip; unpaid-leave days reduce the net; an outstanding advance is recovered by instalment; the disbursement posts a balanced entry.
- **Assert the scope notice**: every payslip must show that the net excludes income tax, social insurance and the other statutory items. A payslip presenting a confident net with no qualifier is a defect.

### S20 — Leave request approved, and its balance effect
Catalog: بانتظار الموافقة → موافق عليه / مرفوض / ملغى.

- **Steps**: submit a request → approve it → check the balance → submit one exceeding the balance.
- **Assert**: the balance falls by the days taken; the over-balance request is refused or flagged, not silently accepted.

### S21 — Employee advance recovered through payroll
Catalog: بانتظار الاعتماد → معتمدة → مصروفة → مسددة.

- **Steps**: request → approve → disburse → run the next payroll.
- **Assert**: disbursement reduces the treasury account; the payroll recovers one instalment; the outstanding figure falls by exactly that; the advance reaches مسددة only when fully recovered.

---

## CRM and projects

### S22 — Lead converted
Catalog: جديد → تم التواصل → مؤهل → محول.

- **Steps**: progress a lead to qualified → convert.
- **Assert**: conversion creates both a customer and an opportunity, and the lead links to what it became. A conversion that leaves a dangling reference is a defect.

### S23 — Opportunity won and lost
- **Steps**: move one opportunity to a win-type stage, another to a loss-type stage.
- **Assert**: status follows the stage's type rather than being set independently; the pipeline report's totals move accordingly.

### S24 — Project through completion
Catalog: مخطط → نشط → مكتمل, with متوقف مؤقتاً and ملغي as side branches.

- **Steps**: activate → put on hold → resume → complete.
- **Assert**: each transition is allowed from the right state and refused from the wrong one.

### S25 — Asset depreciation and disposal
Catalog: نشط → تحت الصيانة / مهلك بالكامل → تم التخلص.

- **Steps**: run depreciation for a period → post it → dispose of an asset.
- **Assert**: depreciation matches the category's method and useful life; accumulated depreciation never exceeds cost minus salvage; disposal posts the gain or loss to the right account.

---

## Platform

### S26 — Approval workflow, all three outcomes
- **Steps**: submit a document that needs approval → approve one, reject another, request modification on a third.
- **Assert**: a rejected document does **not** post; a modification request returns it to its submitter editable; the audit trail records who decided and when.
- **Watch**: acting as a company admin (`*` permissions) auto-approves on submit, so the inbox looks empty. Use a role-holding non-admin actor, or you will conclude the inbox is broken when it is not.

### S27 — Data migration import
- **Steps**: import each workbook from `test-fixtures/data-migration/` through the wizard.
- **Assert**: the preview reports the deliberately-invalid rows (duplicate department code, employee in a non-existent department, negative opening balance, non-numeric price) and **refuses to commit them**, while the valid rows commit. A preview that reports nothing means the validation is not running.

### S28 — Webhook delivery
- **Steps**: register a webhook on an emitted event → trigger it.
- **Assert**: it can only subscribe to events this build actually emits; a delivery to an unreachable target retries a bounded number of times and stops; a failing webhook does **not** roll back the business operation that triggered it.

### S29 — Audit trail and branch scoping
- **Steps**: perform a sensitive action → open the audit log → filter by branch.
- **Assert**: the action appears with the right actor and branch; filtering by a branch excludes other branches' events; historical events with no branch appear only under "all branches".

---

## After every run

Update `defects.md` — new findings added with their measured evidence, fixed
ones moved to FIXED with their commit, false alarms moved to NOT A DEFECT with
what actually caused the reading.

---

## Cross-module money trails

`docs/scenarios/09-cross-module.md` — the seams between modules: buying takes
money out of the خزنة, selling puts it in the bank, and every sub-ledger stays in
step with the GL along the way. Executable as
`pnpm scenarios cross-module`. Written after the module suites, because a trail
that crosses four modules cannot be proved inside any one of them.

The same file's second half — currency, tax, Egypt compliance, rounding at scale,
concurrent numbering, permission tiers, Arabic search, the audit trail, pricing
order of operations and year-end — is executable as `pnpm scenarios seams`
(`scripts/scenarios/seams.ts`). It runs last of all: it closes periods, opens a
fiscal year and sweeps forty documents through the ledger.
