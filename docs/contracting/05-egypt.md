# The Egyptian مستخلص — sourced, and where it isn't

Two research passes. The second reached primary and near-primary sources (the full
text of Ministerial Decree 74/1988, the live NOSI service pages, legal-database
reproductions of Law 182/2018) and **overturned two premises this project was
carrying**. Both corrections are in bold below.

Standing rule for everything here: **no percentage in this document may be hardcoded.**
Every one is either a contract parameter, a market convention, or an effective-dated
statutory rate. Government hosts `etenders.gov.eg` and `manshurat.org` refused
connections throughout, so the Law 182 article text is from legal databases rather
than the gazette.

## The document

A مستخلص is **not an invoice**. It is a measured, consultant-certified statement of
quantities executed to date, from which an invoice is then derived. The invoice
follows the certificate, never the reverse — and since July 2025 that ordering is
legally load-bearing: the *invoice* triggers VAT, and the *certificate* is what the
invoice must be traceable to.

Certificates are **cumulative**. Each restates work-to-date and deducts everything
already certified. A certificate is a snapshot, not a delta, and the payable is the
difference between two snapshots. Per BOQ item: الوحدة، الكمية التعاقدية، الفئة،
الكميات السابقة، كميات هذا المستخلص، الكميات المنفذة حتى تاريخه، نسبة الصرف، القيمة.

> **جملة الأعمال = الكمية × النسبة × الفئة**

### Two Egyptian mechanics a generic project module has no concept of

**نسبة الممارسة — the tender discount.** An Egyptian contractor typically bids a
percentage *off* the priced BOQ. That percentage is then applied to **every**
certificate as its own line, before deductions. A contract-level uniform discount
applied at certification time exists in no generic module.

**التشوينات — materials on site.** Material delivered and verified by joint
inspection (محضر معاينة) but not yet built in is certified in a **separate column** at
a reduced percentage — conventionally **75%** of material price. When it is later
incorporated, it is entered **as a negative quantity in the current-period column**, so
the value migrates from "stored" to "executed" without double counting. The 75% is
convention, not statute; make it a per-contract parameter.

That one pile of rebar therefore appears in three places at three values: as
تشوينات at 75% on the certificate, as عهدة on the site foreman, and as executed work
once consumed.

### Types

| Arabic | What it is |
|---|---|
| مستخلص جاري | Interim, usually monthly. Disbursed to ~95%, the balance retained |
| مستخلص ختامي / نهائي | Final — closes quantities, releases the first retention tranche |
| **مستخلص تنفيذي** | **Internal only, never presented for payment.** Three price columns — estimated cost, actual cost, selling price — for margin control |
| مستخلص مقاول الباطن | The purchase side; the same deduction machinery in reverse |
| مستخلص المالك | The sales side |
| مستخلص الدفعة المقدمة | Issued to draw the advance itself |

The مستخلص تنفيذي is worth noticing: it is the one document in the set that never
leaves the company, and it is exactly the per-BOQ-item cost-versus-bid view the
project manager and cost controller asked for independently.

### The deductions block, in order

| # | Arabic | Basis | Refundable? |
|---|---|---|---|
| 1 | نسبة الممارسة | Contract % off gross certified value | n/a — a price adjustment |
| 2 | خصم الدفعة المقدمة | Fixed % of each certificate, normally equal to the advance's % of contract value | n/a — repayment |
| 3 | المحتجزات / تأمين الأعمال | 5–10% of each certificate, commonly 5% | **Yes** |
| 4 | التأمينات الاجتماعية | certificate value × deemed-wage % × employer rate | No |
| 5 | ضريبة الخصم والتحصيل | **1%** for contracting | Creditable against CIT |
| 6 | ضريبة القيمة المضافة | **Added, not deducted** — see the VAT section | n/a |
| 7 | غرامة التأخير | Statutory caps under Law 182 for public work | No |
| 8 | استهلاك عهدة المواد | Value of employer-supplied materials | No |
| 9 | استهلاك المياه والكهرباء | Per contract | No |
| 10 | **التعليات** | **Amounts suspended pending rectification of defective work** | **Yes, once rectified** |
| 11 | دمغات ورسوم | Per contract / statute — rates UNVERIFIED | No |
| 12 | الدفعات السابقة | The cumulative-to-delta conversion | n/a |

تعليات is its own state, not a penalty: money held back until specific work is put
right, then released. A design that models only retention will book it as retention
and release it on the wrong clock.

Note the terminology trap for an Arabic UI: **تأمين here means security, not
insurance.** «تأمين الأعمال» (retention) and «التأمينات الاجتماعية» (social insurance)
are unrelated concepts sitting two rows apart in the same block.

A representative Egyptian entry for certifying to the employer:

```
من مذكورين
    ح/ العميل                          (الصافي المستحق)
    ح/ ضمان أعمال محتجز لدى العملاء
    ح/ دفعات مقدمة من العملاء
    ح/ ضرائب مخصومة تحت حساب الضريبة
    ح/ تأمينات المقاولات
    ح/ مصروفات العمليات (دمغات)
        إلى ح/ إيرادات العمليات         (إجمالي قيمة المستخلص)
        إلى ح/ ضريبة القيمة المضافة
```

Beware: the source for that entry shows WHT at 0.5% and social insurance at 2.9%. The
0.5% is the **pre-2018 rate and is wrong today**; the 2.9% is one work mix's effective
rate, not a universal figure. Expect to find both stale numbers in a real customer's
existing books.

### Approval chain

المهندس المقيم measures (حصر) → الاستشاري certifies quantities → the employer's
finance function reviews → payment. Quantities must trace to approved measurement
books (دفاتر حصر معتمدة) and signed acceptance minutes (محاضر استلام). Variation work
needs an **approved change order before it can enter a certificate**, and a new item
outside the BOQ needs a rate analysed and agreed first.

## Social insurance — the most Egypt-specific line in the module

**This is not a payroll deduction. It is a levy on the contract, assessed on a
notional wage.** HR being descoped for v1 does not exempt the contracting module
from it.

```
نسبة التأمين  =  نسبة الأجور الحكمية (deemed-wage % for the work type) × employer rate
مبلغ التأمين  =  قيمة المستخلص × نسبة التأمين
```

Worked deemed-wage percentages from practitioners: تشغيل عمال (labour-only) **60%**,
حفر وردم بالمعدات **12%**, إحلال مع التجهيز **10%**, إحلال بدون تجهيز **20%**.

The design consequence is large and non-obvious: **the same physical work attracts
roughly six times the social-insurance charge when contracted labour-only (~60%) as
when contracted supply-and-install (~10%).** Decree 74/1988's Table 3 makes the rule
explicit — contracts including materials carry low deemed-wage percentages (3–20%),
labour-only contracts carry high ones (25–65%). Whichever schedule is current, the
module must key the rate off *work type and whether the scope includes supply*, not
off a single company-wide number.

**The payment gate is statutory, and the employer is jointly liable.** Law 148/2019
Art. 144 forbids paying a contractor before it produces evidence of social-insurance
payment for the works, and makes the assignor jointly liable otherwise. The executive
regulation (PM Decree 2437/2021, amended by 487/2022) Art. 206 requires the assignor
to notify NOSI of **every certificate due for disbursement** and to **suspend
disbursement until the clearance certificate is produced** — and conditions the final
payment on full contract clearance. Art. 204 requires a monthly worker statement
(Form 39) naming subcontractors' subscription numbers. Art. 214 lists the exemptions,
including pure supply and pure lease contracts and residential buildings with no
reinforced concrete in foundations or columns.

Decree 74/1988 Art. 3(1) closes the obvious loophole: **a main contractor cannot shed
the levy by subcontracting** — where all operations are subcontracted, total
contributions may not fall below what the whole contract value would bear. Art. 4
requires the base to be re-measured against the final account (ختامي الأعمال), which
means variations feed back into it.

Wage bands, effective **1 January 2026**: floor **EGP 2,700**, ceiling **EGP 16,700**.
Headline split 29.75% — 18.75% employer, 11% employee.

**UNVERIFIED and material:** practitioners cite an **18.25%** employer factor for this
regime against the headline **18.75%**, and the 0.5-point difference could not be
reconciled against the regulation. Read the current deemed-wage schedule and the
employer factor off the regulation before encoding either.

## VAT — **the premise we were carrying was wrong**

**The "14% on 36% of value" is not the historical rule. It is the new transitional
rule.**

Historically, contracting and construction sat in the **schedule tax (ضريبة الجدول) at
5%** on full value with **no input credit** — a cascading turnover tax.

**Law 157/2025**, enacted **17 July 2025**, abolished that and moved the sector into
the **general VAT regime at 14% with full input recovery**, effective for construction
from **18 July 2025**. MoF Decrees **417 and 418 of 2025** (23 October 2025) amended
the executive regulations; ETA guidance followed on 27 October 2025.

The 36% basis is engineered so that 14% × 36% = **5.04% ≈ the old 5%**, preserving the
old burden on contracts already in flight.

| | **Legacy** — signed, or with an approved certificate or e-invoice, **before 18 July 2025** | **New** — on or after |
|---|---|---|
| Rate | **14% on 36% of invoice value** → ~5.04% effective | **14% on full value** |
| Input VAT | **Not recoverable** | **Fully recoverable** |
| Basis | 36% of the invoice issued on the consultant-approved مستخلص | Full invoice value |
| Authority | MoF Decree 418/2025 | Law 157/2025 |

Decree 418/2025 also lets the main contractor or subcontractor elect to charge at the
statutory rate on full value with normal input deduction, and relieves subcontractors
of remittance where the main contractor pays, provided formal certification is issued.

Three consequences for the product:

1. **Two VAT regimes run in parallel, keyed on contract date.** Every Egyptian
   contractor alive today has both kinds of contract on its books simultaneously. A
   single company-wide VAT setting produces a wrong return.
2. **VAT is recognised when the electronic invoice is issued** — construction is now a
   continuous service — so **advance payments no longer trigger VAT on receipt**.
3. **An e-invoice is a precondition for VAT recognition and for input recovery.**

UNVERIFIED: the exact mandatory e-invoice field set for a contracting certificate —
EGS/GS1 coding for construction services and the tax-type codes for legacy 36%-basis
lines. ETA's October 2025 دليل خدمات المقاولات وأعمال التشييد والبناء is the primary
source; `eta.gov.eg` refused fetches.

## Withholding tax — 1%, not 0.5%

Article 59 of Income Tax Law 91/2005, rates set by **MoF Decree 405/2018**:

| | Rate |
|---|---|
| **المقاولات والتوريدات والنقل** | **1.0%** |
| الخدمات بجميع أنواعها | 3.0% |
| العمولات والسمسرة | 5.0% |
| المهن الحرة | 5.0% |

Threshold **EGP 300** per invoice. Not a cost — an advance payment of corporate income
tax, credited on the annual return. Filed on **Form 41, quarterly**, during April,
July, October and January for the preceding quarter. Applies identically to
subcontractors: a main contractor withholds 1% on a subcontractor's certificate.

**Many Egyptian sources still publish the pre-2018 rates (0.5% supplies, 2%
services).** Treat any 0.5% found in a customer's books or a competitor's software as
legacy, and make the rate an effective-dated table rather than a constant.

## Advance payment

Typically **5–20% of contract value, most commonly 10%**. Under Law 182/2018 Art. 44
it is permitted against an **unconditional, irrevocable, accredited bank guarantee** in
the percentage and currency stated in the tender conditions.

**Recovery is a fixed percentage, not pro-rata to completion** — each certificate is
deducted at the same percentage the advance bore to contract value. On a 10,000,000
contract with a 1,000,000 advance, a 1,000,000 certificate is deducted 100,000. Because
the recovery rate equals the advance rate, the advance self-liquidates exactly as the
contract completes — *provided certified value equals contract value*. **Variations and
escalation break that identity**, which is precisely why the unrecovered balance must
be a tracked liability rather than a figure inferred from progress.

The advance guarantee reduces in step with recovery and stays live until the advance is
repaid.

**UNVERIFIED: there is no statutory maximum advance percentage.** Commentary sites
circulate 10% as a cap; it could not be corroborated in primary text. Do not hardcode
one.

## Retention

**5–10% withheld from each certificate, commonly 5%** — hence interim certificates
described as disbursing 95%. Released **partially at الاستلام الابتدائي, the balance
after the defects liability period (فترة الضمان) at الاستلام النهائي**, that period
being **typically one year** in Egyptian practice.

Government contracts work differently: Law 182/2018 uses a **5% تأمين نهائي posted up
front**, not cash retained from certificates.

UNVERIFIED: the exact provisional/final split, any ceiling on cumulative retention as a
percentage of contract value, and whether a swap for a خطاب ضمان is a right or a
negotiated term. Model the per-certificate rate and an optional cap as contract
parameters.

## Letters of guarantee

| Type | Rate |
|---|---|
| خطاب ضمان ابتدائي / تأمين مؤقت (bid bond) | **1.5%** of estimated value for movables, contracting works and services; **0.5%** for real estate (Law 182/2018 Art. 16). Valid **30 days beyond** bid validity |
| خطاب ضمان نهائي / حسن تنفيذ (performance bond) | **5%** of contract value (Art. 40) |
| خطاب ضمان دفعة مقدمة | Equal to the advance; reduces as it is recovered (Art. 44) |
| خطاب ضمان صيانة | After handover, roughly one year |
| خطاب ضمان الأشياء المعارة | Secures return of employer-supplied equipment |

The bank requires cash cover (الغطاء النقدي), full or partial depending on standing,
plus commission. Guarantees are renewed periodically and can be called (مصادرة).

**Two things must be recorded, and generic ERPs record only one:**

1. **The guarantee's face value, off balance sheet**, in memorandum accounts
   (نظامي مدين / نظامي دائن), disclosed as a contingent liability.
2. **The cash margin, on balance sheet**, as restricted cash:

```
عند تقديم الغطاء:  من ح/ غطاء خطاب ضمان   إلى ح/ نقدية
عند الإفراج:       من ح/ نقدية            إلى ح/ غطاء خطاب ضمان
عند المصادرة:      من ح/ احتياطي طوارئ    إلى ح/ غطاء خطاب ضمان
```

**The commercial point that makes this a feature rather than a compliance chore: a
contractor's guarantee ceiling at its bank, not its cash, is what caps how many jobs it
can run at once.** A module that reports total guarantees outstanding by bank, by
project and by expiry is reporting the contractor's actual binding constraint. Recall
that not one of fourteen Arabic-market products advertises this.

UNVERIFIED: the EAS number for provisions and contingent liabilities. It is the IAS 37
equivalent; the commonly cited "EAS 28" could not be confirmed against the FRA. Do not
put a standard number in the UI without checking.

## Revenue recognition — EAS 48

**EAS 48 (الإيراد من العقود مع العملاء), the IFRS 15 equivalent, applies. EAS 8
(عقود الإنشاء) is withdrawn**, along with EAS 11 (الإيراد) — both replaced by EAS 48,
issued by **Ministerial Decree 69/2019**. Reported effective 1 January 2020, deferred
to 1 January 2021 (the deferral is UNVERIFIED).

Practically: **an auditor will expect EAS 48 vocabulary.** Building the module on
عقود الإنشاء and طريقة نسبة الإتمام language will read as out of date even though the
arithmetic barely changes.

Construction normally recognises **over time**, on either an **input method**
(cost-to-cost — the Egyptian default) or an **output method** (surveyed completion).

**The design point that settles the panel's biggest disagreement:** the certified value
in a مستخلص is an **output** measure, and it does **not** equal revenue under a
cost-to-cost input method. **Billing is not revenue.** If the module books the
certificate as revenue, it is wrong under the standard the auditor applies — which is
the revenue specialist's and the chartered accountant's position, now with a source.

| Arabic | English | When |
|---|---|---|
| أصل العقد / إيرادات مستحقة غير مفوترة | Contract asset | Revenue recognised > amounts certified |
| التزام العقد / فواتير مقدمة | Contract liability | Amounts certified > revenue recognised |
| أعمال تحت التنفيذ | WIP | The cost accumulation behind both |

Retention under EAS 48 is part of the consideration — a **receivable, not a reduction
of revenue**. The deduction block obscures that; the ledger must not.

**Onerous contracts:** EAS 48 contains no guidance — IFRS 15 deliberately omitted it —
so the provision falls under the provisions standard. The requirement itself is not in
doubt: when total expected cost exceeds total expected revenue, **the entire expected
loss is recognised immediately, not spread**. Which means the module must forecast
cost-to-complete continuously, or it cannot see the loss coming.

## Public procurement — Law 182/2018

**Correction to a second premise: the delay-penalty cap for works is 10%→15%, not the
3%→5% that applies to supply and services.**

| Contract type | Delay ≤ 10% of duration | Delay > 10% of duration |
|---|---|---|
| **أعمال المقاولات (works)** | up to **10%** of contract value | up to **15%** |
| التوريدات والخدمات (supply/services) | up to **3%** | up to **5%** |

Computed on the value of the delayed portion where the contract is severable and the
delay does not defeat its purpose; otherwise on total contract value. Waivable for
force majeure or for delay attributable to the authority.

**Payment (Art. 45): 60 days for works certificates** from submission with supporting
documents, **30 days for supply and services** from inspection and acceptance. **Late
payment by the government entity carries compensation at the CBE's announced credit
and discount rate** — money the contractor is legally owed and, in practice, rarely
invoices for. A module that computes it is handing the customer cash.

Other obligations worth knowing: Art. 23 requires a declaration undertaking to insure
the workforce inside the technical envelope — the hook tying Law 182 to the NOSI
regime. Art. 85 requires each authority to keep a vendor register (commercial and tax
registration, bank account, capacity, track record) plus a blacklist; contracting with
an unregistered party can void the contract. Art. 35 gives local product meeting the
Law 5/2015 threshold preference of up to 15%.

Contracting methods (Art. 7): مناقصة عامة / محدودة / ذات مرحلتين، **مناقصة محلية up to
EGP 4,000,000** restricted to bidders local to the governorate، ممارسة عامة/محدودة،
اتفاق مباشر. **UNVERIFIED: every other threshold.** Also UNVERIFIED: a statutory
deadline to sign after award distinct from the 10/20-working-day guarantee deadline,
and the كراسة الشروط price schedule.

**The portal is `etenders.gov.eg`, not `etpp.gov.eg`** — the latter does not resolve.
Verify before building any integration; the former also refused connections here.

## Contractor classification — الاتحاد المصري لمقاولي التشييد والبناء

Established by **Law 104/1992**. Art. 7: contracting work **exceeding EGP 50,000 per
operation** may not be awarded to a non-member, so membership is effectively
compulsory (that figure is nominal 1992 and may have been amended — UNVERIFIED).
Classification rules are approved by the Ministry of Housing, most recently
**Decree 439/2022**.

**Seven grades**, الأولى (largest) down to السابعة. **There is no ممتازة tier** — do
not import that assumption from Gulf systems. Scoring is a weighted 1,000-point system
across roughly nine criteria with a minimum around 800: capital 50, years of experience
250, technical staff 200, finance department 50, highest annual executed value in five
years 100, completed contracts 100, financial capacity 100, owned equipment 100.
Specialities expanded from 12 to **28**. Membership runs one renewable year and
requires clean tax and social-insurance standing; a foreign contractor needs an
Egyptian partner holding ≥51%.

Capital ceilings were raised in 2022 to track devaluation, and the circulating band
table is UNVERIFIED against the gazette. **Do not ship a hardcoded ceiling table.**

Commercially: Law 182/2018 ties eligibility for government construction tenders to the
EFCBC grade. **The grade is the gate to public work.** UNVERIFIED: how grades combine
in a تحالف/ائتلاف bidding jointly — a real gap for any contractor that partners.

## Cost structure

تحليل سعر البند decomposes into **مواد / عمالة / معدات / مقاول باطن / مصاريف غير
مباشرة / أرباح**. Practitioners report an administrative overhead add-on of **15–25%**
and commonly bundle «المصاريف الإدارية والأرباح» as one markup rather than quoting
profit separately. Indicative, not regulated.

**Labour.** مقاول عمالة / مقاول أنفار (labour-only subcontract) is the dominant
arrangement — he organises and pays his own معلم، صنايعي، مساعد. عمالة يومية is paid
directly and tracked on daily sheets. The choice is not administrative: routing labour
through a subcontract means withholding 1% on his certificates; routing it as daily
labour creates payroll, income tax and direct social-insurance obligations — and, per
the deemed-wage schedule, roughly six times the insurance charge. UNVERIFIED: where
ETA and NOSI draw the line between a genuine subcontract and disguised employment. It
is a known enforcement grey area, which means the module should record the distinction
explicitly rather than let it be implied.

**Equipment.** Owned plant is depreciated and charged to jobs via أمر شغل recording
hours or days per project; rented plant at the rental rate. Charge-out by ساعة معدة or
يومية معدة absorbing سولار، صيانة، إهلاك، and the operator for manned plant. **No
published Egyptian plant-rate book exists** — every contractor builds internal rates,
so ship no defaults.

**Site stores.** مخازن الموقع run on أذون صرف and أذون إضافة, reconciled by periodic
محضر جرد with clean cut-off on the last voucher before counting. عهدة المواد is an
outstanding balance until consumed or returned.

**Price escalation — تعويض فروق الأسعار.** A rolling, **government-tenders-only**
compensation scheme issued as periodic Cabinet decisions covering retrospective time
bands. Verified: **Cabinet Resolutions 45 and 46 of 2025**, gazetted 30 July 2025,
covering 2024 contracts; bands confirmed include 1 Mar 2022–31 Dec 2023, 1 Jan–31 May
2024, 1 Jun–31 Dec 2024, 1 Jan–30 Jun 2025. Materials typically covered: حديد التسليح،
الأسمنت، الخرسانة، الأخشاب، الكابلات. UNVERIFIED: the formula and exact material list
inside each decree. A "Decree 53/2026" surfaced during research and could not be
corroborated by any source — **disregard it.**

Price references: CAPMAS publishes أسعار أهم مواد البناء; the Ministry of Housing
publishes a نشرة أسعار مواد البناء.

## The fifteen things a generic project module cannot do

1. Model the مستخلص as a cumulative, consultant-certified measurement document — not
   an invoice — with certificate approval and invoice issuance as separate, sequenced
   events.
2. Post the full ordered deductions block as first-class ledger entries, each landing
   in a different account with a different lifecycle: refundable, creditable, or gone.
3. Compute social insurance as `certificate value × deemed-wage % × employer rate`,
   keyed on work type and on whether the scope includes materials.
4. Block disbursement of any certificate without NOSI clearance, and the final payment
   without full contract clearance — because the employer is jointly liable.
5. Run two VAT regimes in parallel keyed on contract date, because every contractor
   has both kinds of contract on its books today.
6. Track the advance as a real liability with its own guarantee, recovered at a fixed
   percentage per certificate — never derived from percentage completion.
7. Model retention with two release events on two different clocks, plus an optional
   swap for a guarantee that converts the exposure without extinguishing the receivable.
8. Carry guarantees off balance sheet as contingent liabilities while carrying the cash
   margin on balance sheet as restricted cash — and report exposure by bank, project
   and expiry, which is the contractor's real constraint.
9. Recognise revenue under EAS 48 independently of what was certified, posting the
   difference to contract asset or contract liability. Billing is not revenue.
10. Detect onerous contracts and provide the whole expected loss immediately — which
    requires forecasting cost-to-complete continuously.
11. Handle تشوينات as a separate certificate column at a partial percentage, reversed
    by negative quantity on consumption, while the same stock is tracked as عهدة.
12. Treat variation orders as approved, priced amendments that cascade into the
    advance-recovery schedule, the retention ceiling, the social-insurance base and the
    delay-penalty base.
13. Encode Law 182/2018's arithmetic as configurable, effective-dated rules — including
    the 60-day works payment term and the CBE-rate late-payment compensation the
    contractor is owed and rarely claims.
14. Mirror the whole certificate machinery on the subcontractor side, reconciling
    subcontract certificates line-by-line against the employer certificate they were
    earned under — and never letting subcontracting reduce the social-insurance base.
15. Cost at تحليل سعر البند level and roll it up beside the certificate value, so the
    contractor sees per BOQ item whether the rate he bid still covers his cost. That is
    what the مستخلص تنفيذي is for.

## Re-verify before writing code

**Solid:** the VAT regime change and the 36% transitional basis; WHT at 1% with the
EGP 300 threshold and Form 41; Law 182/2018 Arts. 16, 40, 44, 45, 48; EAS 48
superseding EAS 8 and 11; the social-insurance chain including the payment gate and
joint liability; the 2026 wage floor and ceiling; Decree 74/1988's mechanism; EFCBC's
statutory basis and its link to tender eligibility.

**Read off primary documents first:** the current deemed-wage schedule and whether the
employer factor is 18.25% or 18.75%; the EAS number for provisions; EFCBC's current
grade ceilings; ETA's October 2025 contracting guide for e-invoice fields; the
escalation decrees' formulas; stamp duty; procurement thresholds other than the
EGP 4,000,000 local-tender figure; and whether the portal is `etenders.gov.eg`.

**Never hardcode:** any advance cap, retention ceiling, materials-on-site percentage,
overhead or profit markup, or equipment rate.
