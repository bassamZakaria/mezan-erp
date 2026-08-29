# The Egyptian مستخلص — what we could confirm, and what we could not

**Read the caveat first.** The sources below are Egyptian contracting-accounting blogs
and a competitor's knowledge base, not primary legislation. The primary text of
قانون تنظيم التعاقدات 182/2018 was unreachable in every attempt, and every secondary
legal source tried returned 404 or refused the connection. Search engines were largely
blocked, so this pass rests on direct page fetches only.

Nothing here is a legal figure this product may hardcode. Every percentage below is a
**default that must be a setting**, and the tax figures in particular need checking
against current ETA guidance before a line is written. The one thing worse than not
knowing a rate is shipping the wrong one with confidence.

## The document

A مستخلص is periodic and **cumulative** — each one restates everything executed to
date and subtracts what previous certificates already claimed. Practitioners describe
it as "the invoice of the contracting trade". This is the single structural fact the
module must honour, and it is confirmed by every source.

Header: project and location, contractor, owner, the named consultant, certificate
number. (An explicit approval-date field is standard practice but was not confirmed in
any fetched source.)

Body, per BOQ line: البند، الوحدة، الكمية، الفئة (unit price), نسبة الصرف, and

> **جملة الأعمال = الكمية × نسبة الصرف × الفئة**

with prior quantities carried forward and subtracted to give this period's figure.
The four-column shape (contracted / cumulative-to-date / previous / this period) is
industry-standard practice; no single fetched source reproduced all four columns in
one worked table, so treat the *shape* as established and the exact column set as a
design choice.

### Types

- **مستخلص جاري** — interim, during execution. One source reports payout capped at
  95%, with 5% retained.
- **مستخلص نهائي** — after completion and التسليم الابتدائي.
- **مستخلص تنفيذي** — an internal engineering reconciliation, never sent to the owner.
  Worth knowing about; probably not worth building.
- **مستخلص المالك** vs **مستخلص مقاول الباطن** — the owner's certificate goes through
  the consultant; the subcontractor's does not, and is described as "بمثابة فاتورة
  المشتريات". That asymmetry is a real design input: the two documents have different
  approval chains.
- Reported by one source only: مستخلص ختامي متوقع (forecast final) and مستخلص توقف
  (issued on suspension).

### The deductions block

| Line | Reported figure | Confidence |
|---|---|---|
| خصم الدفعة المقدمة | Rate matching the advance's share of contract value; advance commonly 10%, one source says up to 25% | Mechanism confirmed; percentage is a range |
| المحتجزات / ضمان حسن التنفيذ | **5%** per certificate; certificates paid "لا تزيد عن 95%" | Two independent sources |
| التأمينات الاجتماعية | On contract value **excluding VAT**. One source 2.9%; another gives 3.6% / 2.7% / 2.16% by activity type. Filed within 15 days of the following month; 1%/month penalty on late *submission* | Mechanism confirmed; rates conflict |
| ضريبة الخصم والتحصيل | 0.5% in one source, 1% in another | **Sources conflict — verify against ETA** |
| ضريبة القيمة المضافة | **Added on top**, not deducted. 14% reported | Treatment confirmed; rate UNVERIFIED against current law |
| التشوينات (materials on site) | Certified at **75%** of material price, then removed once the material is consumed in an executed item, to avoid double counting | Confirmed, single source |
| غرامة التأخير | **UNVERIFIED.** No source gave a construction delay-penalty formula or cap | Do not invent one |
| دمغة | "متغيرة حسب الاتفاقية" — no figure | Unquantified |

Net payable = cumulative work value − previous certificates − deductions + VAT.

The 75% treatment of التشوينات deserves emphasis: it is not a rounding convention, it
is a *reversal obligation*. Material certified at 75% must be un-certified when it is
consumed inside a BOQ item, or the same steel is billed twice. Whatever design we
choose has to carry that link.

### Approval chain

التخطيط والتعاقد → التنفيذ → إعداد المستخلص بالمكتب الفني → مراجعة واعتماد الاستشاري
→ التقديم للمالك → الصرف → التسجيل المحاسبي.

No source gave a typical review or payment cycle in days, and none named المهندس
المقيم as a step distinct from الاستشاري. Do not put a number on the cycle.

### Postings the sources give

Subcontractor certificate: `من ح/ تكاليف عمليات → إلى ح/ جاري مقاولي الباطن +
ح/ تأمين ضمان أعمال`.
Owner certificate: `من ح/ جاري العملاء → إلى ح/ إيرادات العمليات + ح/ تأمين ضمان
أعمال العملاء`.

Note the vocabulary: the market says **تأمين ضمان الأعمال**, not المحتجزات. Our
glossary picked المحتجزات الضمانية; both are understood, and the account label should
probably follow the market.

## Advance payment

Commonly 10% of contract value, cited as high as 25%. Recovered either as a lump sum
from the first certificate (small jobs) or — more commonly — proportionally, deducting
the same percentage from each certificate. The worked example from the source: a
10,000,000 EGP contract with a 1,000,000 advance deducts 100,000 from a 1,000,000
certificate, leaving 900,000 outstanding.

**Recovery is proportional to work done, never accelerated.** No source described an
accelerated variant, which means the running unrecovered balance is a straight-line
consequence of certified value — exactly the invariant the technical office asked for:
it must reach zero and must never go negative.

A خطاب ضمان دفعة مقدمة is required before the advance is released, and is reduced as
the advance is recovered. Whether it is issued at exactly 100% of the advance is
implied but not stated.

## Retention

5% per certificate, confirmed twice. Released after defect correction and handover.

**UNVERIFIED and important:** the ceiling as a percentage of contract value; the split
between التسليم الابتدائي and التسليم النهائي; the defects-liability period; and
whether cash retention can be swapped for a خطاب ضمان. All four are common knowledge
in the trade and none could be sourced this session. They are exactly the kind of
figure to ask a real contractor rather than a search engine.

One adjacent fact that is *not* the same thing: a maintenance guarantee's own term is
reported as one year. That is the guarantee's validity, not proof that the
defects-liability period equals one year.

## Letters of guarantee

Five types, all confirmed by function, **none with a percentage**:

- **خطاب الضمان الابتدائي** (bid bond) — with the tender, lapses if the bid loses.
- **خطاب الضمان النهائي** (performance bond) — from the winner, runs through execution.
- **خطاب ضمان الصيانة** (maintenance bond) — after handover, term reported as one year.
- **خطاب ضمان الدفعة المقدمة** — reduces as the advance is recovered.
- **خطابات ضمان الأشياء المعارة** — for equipment loaned by the owner.

Bank mechanics: the cash margin (الغطاء) may be full or partial depending on the
client's standing — **no percentage found**. Commission is charged, rate not given.
On renewal, المادة 418 discharges the bank if no demand arrives within the guarantee's
validity, and automatic-renewal clauses are characterised as شرط إذعان.

The accounting the source gives:

```
Issue:            من حـ/ غطاء خطاب ضمان        إلى حـ/ نقدية
Expiry unused:    من حـ/ نقدية                 إلى حـ/ غطاء خطاب ضمان
Called, covered:  من حـ/ احتياطي طوارئ         إلى حـ/ غطاء خطاب ضمان
Called, uncovered:من حـ/ احتياطي طوارئ         إلى حـ/ البنك
```

That treats the **cash margin** as a restricted asset. It does **not** describe the
memorandum pair (نظامي مدين / نظامي دائن) that carries the guarantee's full face value
as a contingent liability, and no citation to EAS 28 could be reached. So: the cash
margin's treatment is sourced; the contingent-liability disclosure is not. Do not cite
EAS 28 as verified.

## What is still missing

Genuinely unresearched or unreachable, and worth a second pass or a conversation with
a practising contractor rather than more searching:

- Law 182/2018 itself — advance ceiling, bid and performance bond percentages, delay
  penalty formula and cap, and what a public certificate must carry.
- How variation orders (أعمال إضافية / أوامر تغييرية) are priced and approved. This is
  a real gap: the module needs a rule for a new item that has no contracted rate.
- The retention ceiling, the release split, and the defects-liability period.
- Whether retention can be swapped for a guarantee.
- Contractor classification by the الاتحاد المصري لمقاولي التشييد والبناء and why the
  grade matters commercially.
- The contracting VAT question the tax reviewer flagged as the single most
  consequential unknown: standard rate with full input credit, or a reduced rate with
  input tax disallowed. Every posting, the VAT return and the ETA sub-type mapping
  hinge on it.
