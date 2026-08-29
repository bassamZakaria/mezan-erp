# المقاولات — what twenty-odd reviewers said

Every stakeholder read the same brief and the same code. Where they agree, treat it
as settled. Where they disagree, the disagreement is the design decision, and it is
recorded here rather than resolved.

## Unanimous

**The مستخلص (progress certificate) is the module.** Not an invoice with extra
fields — its own document. Every reviewer who bills, books or buys said the same
thing, and the buyer's exact words were that a certificate implemented as a
sales-invoice variant is a walk-away.

**It stores cumulative-to-date, never the period.** Per BOQ line: previously
certified quantity, this period, cumulative. The period value is a *subtraction*.
A hard `previousCertificateId` and a strictly increasing serial per project, with
no edit or void while a later certificate exists. Storing the period figure instead
is how the same work gets billed twice.

**Every deduction is a posted line, not a print-time formula.** Retention, advance
recovery, withholding, social insurance, delay penalty, materials on site. A
certificate that is right on screen while the ledger recorded none of it is this
codebase's most familiar failure, and the panel named it independently four times.

**Retention needs a direction.** `contracting.retention_receivable` (1150) ships
today; there is no payable counterpart, so retention withheld *from a
subcontractor* has nowhere to go and would be booked into AP, where it silently
drifts. The subcontracts manager put the question most sharply: is retention one
concept with a direction, or are we about to ship the receivable alone and call
المقاولات done?

**Retention ages from its release date, not the certificate date.** Aged as ordinary
AR, every retention balance reads as 120-days-overdue the day it is created, which
trains the collector to ignore the one signal that matters.

**Withholding tax has a hole on the side that faces the customer.** It exists
payable-side on vouchers and posts to 2210. What is missing is the *suffered* side —
a debtor account for the tax a client deducts from our own certificate. Without it
the certificate's net payable reconciles to nothing that ever arrives.

**Nothing works without a cost dimension.** See `00-baseline.md`. Five separate
reviewers reached this independently from five different directions.

## Contested — these are decisions, not gaps

### 1. Is there a BOQ in v1?

- **For** (quantity surveyor, technical office, project manager, owner, the buyer):
  the certificate measures *against* something. Without a BOQ there is nothing to
  hold cumulative quantity per item, cost cannot be compared to an item-level
  budget, and variations cannot be told apart from base scope. The owner made an
  Excel BOQ import the second item on the demo list.
- **Against** (product): the captured catalog evidences one screen and no BOQ.
  Ship the certificate with a free description line and an amount; a BOQ is a
  net-new domain and belongs behind an explicit owner decision.
- The estimator adds a third consideration: if the tender's priced BOQ is not the
  project's BOQ, the estimate-versus-actual loop the module exists for never closes.

### 2. Is revenue the certified value, or percentage of completion?

- **Certified value** (buyer, owner, treasury, staff accountant, product,
  subcontracts): an SMB contractor recognises what the consultant signed. Simple,
  honest at this size, and it ships.
- **Percentage of completion** (revenue-recognition specialist, chartered
  accountant): Egypt applies EAS 48 (الإيراد من العقود مع العملاء), which superseded
  EAS 8 — *decree and effective date UNVERIFIED, confirm before shipping any copy
  that claims conformance*. On a certified-value basis every contract asset and
  contract liability is zero by construction, and the module cannot claim standards
  conformance.
- The revenue specialist framed the deciding question well: if the owner answers
  "the certificate is the truth", then WIP, contract asset, contract liability and
  cost-to-complete are dead weight and should not be funded at all.

### 3. Are subcontractor certificates in the first release?

The buyer says release 1 and would pay double for it. Product says out of scope.
Both are defensible; note only that the subcontract side is usually the *larger*
half of a contractor's money, and that building retention receivable-only now makes
the payable side more expensive later, not less.

### 4. Is the real-estate developer the same module?

No — and the developer persona and product agree for once. Unit inventory,
reservation, sale contract and a 7-year instalment book share no structure with
BOQ-and-certificate billing. The developer also found that the existing Installments
domain cannot express an off-plan plan: `schedule.ts` generates equal splits only
(no annual frequency, no milestone percentages), every line binds to one
`sourceInvoiceId`, `computeLateFee` is a stub returning zero, and no operation moves
a plan to a new buyer (تنازل).

## An in-phase defect this review surfaced

`packages/domain/src/vouchers/voucher-types.ts` ships the voucher type
«دفعة مقدمة من عميل مقاولات», posting to 2160, whose own subtitle reads
«دفعة مقدمة يدفعها العميل على عقد مقاولة (تُسترد من المستخلصات)». It is
`allocatable: false`, and the مستخلصات it says the advance is recovered from do not
exist. The product owner is right to call this an in-phase defect rather than a
feature request: a shipped voucher records a liability the product has no way to
discharge. The `CONTRACT` numbering sequence (`CTR-`) exists with no consumer for
the same reason.

Related: `projects` carries exactly two permissions (`view`, `manage`), which cannot
express the segregation of duties an auditor tests — prepare, certify, approve and
collect must be four different rights, with preparer ≠ approver enforced.

## The questions the owner has to answer before design

Collected verbatim in substance from each reviewer; ordered by how much downstream
work each one settles.

1. **Is `projectId` a first-class dimension on every purchase, stock and treasury
   document — or are we hanging contracting off the cost center again, which cannot
   reach a GRN or a material issue?** And relatedly: one dimension or two? Cost
   center *and* cost category, because retrofitting a dimension after immutable
   entries exist is not possible.
2. **Is the مستخلص a document that generates a sales invoice, or the invoice itself
   with extra columns?** Retention, advance recovery, AR aging, ETA submission and
   voucher allocation all fall out of this one answer.
3. **Does an approved certificate recognise revenue, or only bill it?** (Decision 2
   above.)
4. **Is retention one concept with a direction, or receivable-only?**
5. **Is contracting a vertical Mezan sells, or a ledger hole we are closing?** If the
   second, it is a Phase-7 amendment; if the first, it needs its own catalog pass
   against a real contractor's مستخلص.
6. **Is the buyer the contractor's accountant or his site engineer?** They produce
   different products; the owner's own answer was: build for the accountant, let the
   engineer import from Excel.
7. **Does contracting VAT run at the standard rate with full input credit, or a
   reduced rate with input tax disallowed?** Every posting, the VAT return and the
   ETA sub-type mapping change on this. UNVERIFIED — must be settings-driven either
   way, never hardcoded.
8. When an approved variation order raises contract value *after* certificates were
   issued at the old value, does the retention ceiling recompute retrospectively or
   apply forward only?
9. Is a site material issue a first-class document with a mandatory `projectId`, or a
   stock adjustment with the project typed into a note? (The latter makes "material
   cost by project" unqueryable.)
10. Does "approved" mean the consultant signed, or the client's finance department
    cleared it for payment? Those are weeks apart, and that gap is where collections
    go blind.

## Commercial read

The owner would price المقاولات at ~500 EGP/month à la carte, seats-only, never per
project — a per-project or per-BOQ-line axis is unforecastable and would not be
signed. The contracting buyer independently said 1,500–2,000 EGP/month, and double
that if subcontractor certificates and withholding are in release 1. The gap between
those two numbers is itself worth a conversation.

The owner also ranked contracting above both POS and HR for the next module: higher
ticket, stickier, and far fewer credible Arabic competitors — against POS as a
hardware-support treadmill in a price war, and payroll as an annual legal-churn tax
on the support team.
