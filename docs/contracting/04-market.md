# What the market treats as table stakes

Research passes against QuickBooks, Odoo and the dedicated construction tools. The
short version: **the two products this repo is usually measured against both fail at
contracting in the same place**, and it is the place an Egyptian contractor cares
about most.

## QuickBooks

QuickBooks Online (Plus/Advanced) has Projects: per-project profitability, progress
invoicing by percentage or by line, estimates converted to invoices, time tracked to
jobs with an employee hourly cost rate, bills and POs tagged to a project.
Estimate-versus-actual is Advanced only. Desktop Enterprise **Contractor Edition**
goes further — a Job Costing Centre, item-level cost codes, billing rate levels, and
a real report set: Job Profitability Summary/Detail, Job Estimates vs Actual
Summary/Detail, Item Estimates vs Actuals, Unbilled Costs by Job, Time by Job,
Job WIP Summary, Committed Costs by Job, Job Costs by Vendor, Profit and Loss by Job.
Committed Costs by Job — open POs plus unprocessed payroll as forward-looking
obligation — is the one worth copying and is Desktop-only.

**Retainage is not a feature in either.** It is a chart-of-accounts convention the
contractor builds themselves: a Retainage Receivable account and a negative line on
each progress invoice; a Retainage Payable liability and a negative line on each
subcontractor bill. There is no field that computes and carries a running retained
balance. Change orders are equally thin — no object in QBO at all, and in Desktop
only an auto-note when a saved estimate is edited. Neither produces the AIA G702/G703
progress-billing forms natively.

Ignore as US-specific: certified payroll and WH-347, 1099-NEC tracking, the AIA forms
themselves, and Davis-Bacon prevailing-wage tables. An Egyptian module needs the
مستخلص, not the G702.

## Odoo

Odoo has a genuinely reusable costing backbone and almost no contracting billing.

Reusable: `account.analytic.account` with plans and `analytic_distribution` (a JSON
percentage split) mixed into purchase order lines, journal items, sale order lines and
expenses; timesheets that *are* analytic lines carrying an employee hourly cost;
milestone-based and down-payment invoicing; a service product that auto-creates a
project or task on sale-order confirmation.

Missing, and confirmed missing rather than merely unfound:

- **BOQ.** Nothing. Sale-order "sections" are presentation subtotals with no quantity,
  unit, rate, hierarchy, revision or locking.
- **Progress certificates.** No certified-quantity document, no approval stage, no BOQ
  linkage. The nearest native tool is percentage-of-order invoicing.
- **Retention.** Absent. Down payments run forward only — collect then deduct — and
  cannot withhold-then-release. Several localisation charts ship a dormant "holdbacks"
  account with no workflow behind it.
- **Advance recovery** works one invoice at a time; there is no pro-rata amortisation
  across every subsequent certificate.
- **Variation orders.** Sale order lines are edited in place with only a chatter log.
- **Percentage-of-completion.** Odoo's "revenue recognition" is deferred revenue
  spread evenly *over time*, subscription-style — not by work completed. No
  cost-to-complete input, no WIP, no over/under-billing.
- **Equipment costing.** `maintenance.equipment` has no rate, no usage log and no link
  to a project or analytic account.
- **Stock is analytically blind.** `stock.move` and `stock.picking` do not carry
  `analytic_distribution`. Material issued to a site cannot reach a project natively —
  the same hole this repo has, in the same place.

The gap is real enough to support a paid app market: BOQ modules at ~$150–300, interim
payment certificate bundles at ~$200, retention and change-order modules at ~$50–200,
and a job-costing mega-bundle at ~$2,500. No single app is complete; a real deployment
stacks three to five. Odoo's own first-party "Construction Builder" template stays
generic and includes none of BOQ, IPC or region-specific retention. *That ecosystem's
existence is the market validation for this module.*

## The dedicated tools

Enterprise tier — Sage 300 CRE and Sage Intacct Construction, Procore, CMiC, Trimble
Viewpoint, Foundation, Deltek ComputerEase, Premier Construction Software — treats as
must-have: job costing to cost codes, progress/AIA billing, POC and WIP with
over/under-billing, change orders, subcontractor management, retainage both ways, and
committed cost.

The SMB tier is more instructive, because it is the tier Mezan sells into, and it is
inconsistent in a revealing way. **Retainage and lien waivers — non-negotiable one tier
up — are patchy among dedicated SMB construction tools.** Buildertrend's retainage is a
manual spreadsheet workaround; Premier and Deltek ComputerEase have no confirmed
lien-waiver support; Knowify's is unconfirmed. Contractor Foreman has no POC/WIP at all.

Two further SMB observations worth carrying into pricing:

- **Tier-gating is aggressive.** Knowify's $149/mo entry plan has no job costing, no
  WIP, no subcontractor management and no client portal — those unlock at $329–399/mo.
  Naming a competitor without naming the tier is meaningless.
- **Published SMB pricing**, where vendors publish at all: Knowify $99–329/mo
  (annual, 1 and 10 users), Contractor Foreman $49–332/mo (annual, 1 user to
  unlimited), Buildertrend last published $449–1,099/mo before going quote-only in
  early 2025, Deltek ComputerEase quote-only with a $5,000 starting fee, Premier
  roughly $125–249/user/mo plus a $10k–50k implementation (third-party figure,
  UNVERIFIED).

Two corrections to the usual competitor list: Jonas is now two products (legacy Jonas
Enterprise and the rebuilt Premier Construction Software); Deltek Vantagepoint is A/E
professional-services accounting, not a jobsite peer, and Deltek's own site sends
contractors to ComputerEase instead. CoConstruct is mid-sunset into Buildertrend with a
new-project cutoff in March 2027.

Not researched, and honestly so: ERPNext/Frappe construction verticals, Dynamics 365
Business Central construction add-ons, SAP Business One construction add-ons.

## The Arabic market — the one that matters

Fourteen Egyptian, Saudi and Gulf products were checked against seven Arabic feature
terms on their own pages: مستخلصات، جدول الكميات، المحتجزات، الدفعة المقدمة،
مقاولي الباطن، أوامر التغيير، خطابات الضمان.

A ✗ below means "not advertised where we looked", not "confirmed absent" — these are
marketing pages, and several vendors blocked automated reading.

| Product | مستخلصات | جدول الكميات | Retention | دفعة مقدمة | مقاولي الباطن | أوامر التغيير | خطابات ضمان |
|---|---|---|---|---|---|---|---|
| **DoubleClick** (EG) | ✅ عملاء + باطن | ✅ + تحليل | ~ as تأمين الأعمال | ✅ خصم الدفعة المقدمة | ✅ عقود باطن | ✗ | ✗ |
| **Daftra** (EG, SaaS) | ✅ مستخلصات المقاولات | ✗ | ✅ خصم ضمان الأعمال | ✗ | ✗ | ✗ | ✗ |
| **Odoo Construction** (MENA partner vertical) | ✅ مالك + باطن | ✅ BOQ | ✗ | ✗ | ✅ | ✗ | ✗ |
| **AccFlex** (EG) | ✅ مستخلصات مقاولي الباطن والمالكين | ✗ | ✗ | ✗ | ✅ implied | ✗ | ✗ |
| **DEXEF** (EG/SA/IQ) | ✗ | ✗ | ✗ | ✗ | ✅ متابعة مقاولي الباطن | ✅ أوامر التغيير | ✗ |
| **Namasoft** (SA) | ✅ باطن, billed independently | ✗ | ✗ | ✗ | ✅ | ~ ملاحق only | ✗ |
| **Babel ERP** (EG/SA) | ~ article text only | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Focus Softnet**, **Horizon EBS** (Gulf) | English marketing only; retention and subcontractor management named in English | | | | | | |
| **Onyx Pro** | ✗ verified negative — none of the seven terms appear | | | | | | |
| **Al Motammem / المتمم** (Microtech) | ✗ verified negative — generic توجيه القيود للمشروعات only | | | | | | |

Three leads did not resolve: "Delta" is a school-management vendor (the contracting
"Delta" is a *client* in a Babel case study, not a vendor); "TSS" matched no
contracting product; "Elmohasib / المحاسب" is a blog and Excel-template site, not a
packaged product.

### What this changes

**Daftra ships مستخلصات المقاولات and خصم ضمان الأعمال today.** That is a correction
to this repo's standing competitive note, which lists contracting among Daftra's
gaps. It is not a gap. The honest position is the one already recorded elsewhere:
Mezan's edge is deployment model and execution quality, not features the nearest
competitor lacks.

**The Egyptian market defines contracting software as مستخلصات.** The two
best-verified products both lead with progress certificates and subcontractor
certificates, not with scheduling, WBS or field management. That independently
confirms what every stakeholder in our own panel said, and it settles the priority
question: the certificate is the product.

**Only one product pairs مستخلصات with an explicit BOQ** — the Odoo MENA vertical,
priced at $3,500 for source or $11,000 implemented. Coverage of جدول الكميات,
retention and advance recovery is thin across the rest. Thin advertising is not proof
of a thin product, but it does say what these vendors think sells.

**Nobody in the entire scan advertises خطابات الضمان.** Bid bonds, performance bonds
and advance-payment guarantees are central to Egyptian government and large-private
contracting, and not one of fourteen products markets them. Either the whole local
market treats guarantees as a bank back-office matter outside the software, or this is
an unserved need. Worth asking a real contractor which — it is the cheapest possible
differentiator if it is the second.

## What this means for Mezan

The differentiator is not "features they lack" — that is the overstated claim the
reference product's own comparison page makes, and it should not be reused. It is
narrower and more defensible:

1. **QuickBooks and Odoo both fail at retainage and progress certificates**, and both
   fail at getting material cost onto a project from the stock ledger. Those are the
   three things an Egyptian contractor needs first.
2. **Nobody in this market has an Arabic, offline, Egypt-compliant مستخلص** with the
   local deduction block — advance recovery, retention, withholding, social insurance,
   delay penalty — posted rather than printed.
3. The Odoo app market proves contractors will pay separately for exactly the pieces
   this module would ship as one coherent domain.
