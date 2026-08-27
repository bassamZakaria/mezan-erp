# Mezan — the customer-facing workflows, per bundle

> The everyday flow behind each bundle, written the way a business owner would describe
> it — no accounting vocabulary, no screen names, no document-status enums. This is the
> copy that goes in front of a prospect during a demo.
>
> **Category: durable reference**, except §3.5 (the verification table), which is a
> point-in-time measurement — see the date on it and re-run before trusting it.
>
> Bundle definitions, pricing and licensing live in `distribution.md`; this file is only
> about what the user *does*.

---

## 1. Why this file is written in Arabic

The buyer is an Egyptian SMB owner or their accountant. Every step below is phrased in
the words they already use («قبضت الفلوس», «حمّل العربية الصبح», «المندوب يبيع في السوق»)
rather than in the words the system uses («سند قبض», «تحويل مخزني», «فاتورة من مستودع
متنقل»). An English gloss sits beside each step for anyone presenting in English.

The rule when editing: if a step needs the reader to already understand double-entry
bookkeeping, it is written wrong. Rewrite it as the physical thing that happened in the
shop.

---

## 2. Daily flows, per bundle

### 2.1 الباقة الأساسية — Core · **جاهزة**

For any business that buys and sells: a bookshop, a phone shop, a spare-parts supplier.

| # | الخطوة | التفصيل | English |
|---|---|---|---|
| 1 | اشتريت بضاعة | تسجّل فاتورة المورّد وتقول دخلت أنهي مخزن | Record the supplier invoice |
| 2 | المخزن بيزيد لوحده | الكميات بتتحدّث فورًا، والتكلفة بمتوسط السعر | Stock updates automatically |
| 3 | بعت لعميل | فاتورة بيع، والكمية بتنزل من المخزن على طول | Issue a sales invoice |
| 4 | قبضت الفلوس | سند قبض في الخزنة أو البنك، ورصيد العميل بيتظبط | Collect the payment |
| 5 | كام كسبت؟ | تقرير الأرباح جاهز في أي وقت | See your profit, any time |

**The pitch line:** إنت مش محتاج تعرف يعني إيه «مدين» و«دائن» — كل خطوة بتكتب قيودها
لوحدها والدفاتر بتفضل متزنة.

### 2.2 باقة الجملة والتوزيع — Wholesale · **جاهزة**

For a distributor with reps in vans, credit customers, and post-dated cheques to chase.

| # | الخطوة | التفصيل | English |
|---|---|---|---|
| 1 | تحميل العربية الصبح | بضاعة ونقدية بتتحوّل من المخزن الرئيسي لعهدة المندوب | Load the van, on the rep's account |
| 2 | المندوب يبيع في السوق | فواتير من العربية، والمخزون بينقص من عهدته هو | Sell from van stock |
| 3 | العميل يدفع | كاش، أو شيك مؤجّل، أو على الحساب لو ليه حد ائتمان | Cash, cheque, or credit |
| 4 | العربية ترجع بالليل | تعدّ الكاش والبضاعة الفاضلة، والفرق يبان بالمليم | Count cash and stock; variance shows |
| 5 | تتابع فلوسك | مين متأخر، وأنهي شيك استحق، ومين عدّى حد الائتمان | Chase what is still owed |

**The pitch line:** الشيك بيتتابع لوحده لحد ما يتحصّل أو يرتد، والعميل اللي عدّى حد
الائتمان البرنامج بينبّهك قبل ما تبيعله تاني.

### 2.3 باقة التصنيع — Manufacturing · **جاهزة**

For small workshops: a plastics plant, a furniture workshop, a packing line.

| # | الخطوة | التفصيل | English |
|---|---|---|---|
| 1 | اكتب مكوّنات المنتج | الوحدة بتاخد كام خامة وكام ساعة شغل | Define what one unit takes |
| 2 | افتح أمر تشغيل | عايز تنتج كام قطعة وإمتى | Open a work order |
| 3 | اصرف الخامات | تنزل من المخزن بتكلفتها الفعلية وتتحمّل على الأمر | Issue raw materials |
| 4 | استلم المنتج التام | يدخل المخزن جاهز للبيع، والهالك بيتسجّل لوحده | Receive finished goods |
| 5 | تكلفة الوحدة الحقيقية | خامات + تشغيل + مصاريف ÷ اللي طلع فعلًا | The real cost per unit |

**The pitch line:** التكلفة مش تخمين — الخامات بتتحمّل بسعرها اللي اشتريتها بيه فعلًا.

### 2.4 باقة المقاولات — Contracting · **جاهزة بتحفّظ**

For a contractor or developer running several projects at once.

| # | الخطوة | التفصيل | English |
|---|---|---|---|
| 1 | افتح المشروع | العميل، والقيمة، والمدة | Set up the project |
| 2 | اشترِ للمشروع | كل خامة ومصروف على مشروعه مش على الشركة كلها | Costs land on the project |
| 3 | قدّم مستخلص | فاتورة بنسبة اللي خلص من الشغل | Bill by milestone |
| 4 | حصّل الدفعة | وتتابع المتبقّي على العميل | Collect and track the balance |
| 5 | ربح كل مشروع لوحده | مش رقم إجمالي للشركة | Profit per project |

**Caveat to state before selling:** suits a contractor who bills in milestones. BOQ-line
billing and retention (ضمان أعمال) are thin — raise it in the sales call, do not let it
surface at implementation.

### 2.5 Bundles blocked on unbuilt modules

These have flows designed but must not be sold — see `distribution.md` §2.

| Bundle | Flow summary | Blocked on |
|---|---|---|
| التجزئة — Retail | الزبون على الكاشير ← امسح الباركود ← ادفع واطبع ← تقفيل الدرج | POS screen |
| المطاعم — Restaurants | اكتب وصفة الطبق ← الطلب يتسجّل ← المطبخ بينزل لوحده ← ربح كل صنف | POS screen |
| الصيدليات — Pharmacy | استلام بلوط وصلاحية ← البيع بالأقرب انتهاءً ← تنبيه قبل الانتهاء ← مرتجع للمورّد | POS + FEFO |
| مكاتب المحاسبة — Accounting office | ملف لكل عميل ← سجّل حركاته ← راجع واقفل الشهر ← اطبع القوائم | Multi-company |

Note for the retail/restaurant/pharmacy three: everything *behind* the till — stock,
pricing, treasury, the ledger — is built and working. Only the selling screen is missing.
Say exactly that; it is both true and reassuring.

---

## 3. الإجراءات الدورية — Advanced actions

The things done weekly, monthly or yearly rather than daily. These are what separate an
invoicing tool from an accounting system, and they are the strongest part of a demo to an
accountant.

### 3.1 تحصيل الفواتير — Collecting what you are owed · *كل أسبوع*

| # | الخطوة | التفصيل |
|---|---|---|
| 1 | شوف مين عليه إيه | كشف بيرتّب العملاء حسب تأخيرهم |
| 2 | اتواصل مع العميل | وتسجّل إنك كلّمته وإمتى وعد يدفع |
| 3 | اكتب سند القبض | دخل كام، وفي أنهي خزنة أو بنك |
| 4 | حدّد الفلوس بتسدّد إيه | الدفعة ممكن تتقسّم على كذا فاتورة أو تسدّد واحدة جزئيًا |
| 5 | الرصيد بيتظبط | الفاتورة تتقفل، والباقي يفضل ظاهر |

**Step 4 is the differentiator.** Most cheap tools record that a customer paid, not
*which invoice* they paid. Demo this step explicitly to an accountant.

### 3.2 دورة الشيك — The cheque cycle · *مستمرة*

Status names below are the real ones the app shows, so the demo and the screen agree.

| # | الخطوة | حالة الشيك |
|---|---|---|
| 1 | استلمت شيك | بانتظار الاستحقاق |
| 2 | جه ميعاده | استحق ولم يُودع |
| 3 | ودّعته البنك | تحت التحصيل بالبنك |
| 4 | اتحصّل ✓ | محصّل |
| 5 | أو ارتد ✗ | مرتد ← ثم شيك بديل |

**The pitch line:** الشيك المرتد مش بيتمسح — بيفضل في السجل ومربوط بالبديل، عشان تعرف بعد
سنة مين العميل اللي شيكاته بترتد.

### 3.3 مطابقة البنك — Bank reconciliation · *كل شهر*

| # | الخطوة | التفصيل |
|---|---|---|
| 1 | هات كشف البنك | تنزّل الملف من موقع البنك وترفعه |
| 2 | البرنامج يطابق لوحده | بيقارن المبالغ والتواريخ |
| 3 | شوف الفروقات | مصاريف بنك، أو شيك لسه متحصّلش |
| 4 | اقفل المطابقة | الرصيدين بقوا واحد |

### 3.4 إقفال الشهر والسنة — Closing the period and the year · *شهري وسنوي*

| # | الخطوة | التفصيل |
|---|---|---|
| 1 | راجع الشهر | كل الفواتير مسجّلة، والخزنة والبنك متطابقين |
| 2 | اقفل الشهر | محدش يقدر يسجّل بتاريخ الشهر ده تاني |
| 3 | لسه تقدر ترجع فيه | تفتح الشهر تاني طالما مقفلتوش نهائي |
| 4 | القفل النهائي | مفيش رجوع فيها أبدًا |
| 5 | إقفال آخر السنة | الأرباح تترحّل لحساب «الأرباح المرحّلة»، والإيراد والمصروف يصفّروا |

**The pitch line:** الترحيل بيحصل بقيد بتاريخ آخر يوم في السنة. أرصدة العملاء والموردين
والمخزون بتكمل زي ما هي — اللي بيصفّر هو الإيراد والمصروف بس.

### 3.5 Verification — measured 2026-08-27

Driven end to end against a freshly seeded backend (`MEZAN_SEED_DEMO=1`), through the
same HTTP routes the screens call. **Do not demo an item marked ⚠ without re-checking it
first.**

| Flow | Result | Evidence |
|---|---|---|
| تحصيل الفواتير | ✅ works | Receipt voucher 5,000 → confirm → posted `JE-000057` → allocated to `INV-000002`; outstanding fell 9,747.00 → 4,747.00 |
| دورة الشيك | ✅ works | `CHQ-DEMO-1` moved `pending → deposited → collected` cleanly |
| إقفال الشهر | ✅ works | `fp-2026-01` closed; a journal entry dated 15 Jan was then rejected with `PERIOD_NOT_OPEN_FOR_POSTING` |
| الإقفال السنوي | ⚠ **no UI** | Engine correct — closed 14 accounts, rolled 150,579.36 into `3900`, trial balance still balanced exactly (461,261.03 Dr = Cr). But **no screen calls `POST /gl/year-end-close`** |
| مطابقة البنك | ✅ works | Seeded statement `BSTMT-DEMO-1` (8 lines) → auto-match paired 6 against real GL movements, left exactly the 2 bank-only lines unmatched; book 137,956.00 − statement 137,891.00 = 65.00, fully explained by those two lines; finalize moved it to `completed` |

**Seed added 2026-08-27** — `seedBankStatement()` in `packages/backend/src/demo-seed/treasury.ts`.
One August statement for `TR-DEMO-BANK` whose six dated rows carry the exact amount and
date of bank movements the seed already posts, so auto-match has something real to pair;
plus two deliberately bank-only rows (service charges −150.00, credit interest +85.00)
that stay unmatched. Those two are the point of the fixture — a statement where
everything matches proves nothing, because the reconciliation screen would have no work
to do and the 65.00 difference that makes the flow worth demoing would not exist.

Gates after the change: `tsc --noEmit` clean, `eslint` clean, `check:seed` 129 populated /
0 unexpectedly empty, `scenarios` **3,740 passed / 0 failed** with trial balance,
inventory, AP and AR all reconciling to 0.000000.

One gap still open, worth filing in `defects.md`:

1. **Year-end close has no screen.** `POST /gl/year-end-close` (`packages/api/src/gl-routes.ts:344`)
   is mounted, permission-gated and correct, and nothing in `apps/web/src` calls it. This
   is the "built but not wired" pattern — step 5 of §3.4 has no button. It blocks the
   first customer who reaches their own year end.

One observation, not filed as a defect: `POST /bank-statements/:id/finalize` succeeds
while lines are still unmatched. That is defensible — an accountant finalises *after*
deciding what the unmatched items are — but if the intent is that finalising requires
every line resolved, the gate does not exist.

---

## 4. When editing this file

- Keep the Arabic in the register the buyer speaks, not the register the system speaks.
- If a flow changes, change §3.5's verdict too, or delete the row — a stale ✅ here will
  end up in a sales call.
- Never add a flow for a module that does not exist. The blocked bundles in §2.5 are
  listed with their blocker for exactly that reason.
