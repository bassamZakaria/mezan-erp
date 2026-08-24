# Scenarios — Inventory & Manufacturing

Exhaustive UI test scenarios for the Inventory and Manufacturing screens, built against
**this build** (`apps/web/src/screens/*`, `apps/web/src/nav-config.ts`) and checked line
by line against the captured reference product (`docs/catalog/03-inventory.md` and the
manufacturing half of `docs/catalog/07-mfg-projects-assets.md`). Every screen listed in
the task brief is covered: Items, Item Specifications, Product Templates, Configurable
Products, Stock Balance, Stock Transfers, Stock Adjustments, Physical Counts, Label
Printing, Inventory Write-downs, Work Orders, Bills of Materials, Custom Manufacturing
(Config Instances), Production Dashboard.

Where the catalog describes something this build does not have, the scenario is written
anyway and marked **`[NOT IMPLEMENTED]`** — with the exact code fact that proves it's
missing, not a guess.

## Conventions

- **ID** — `INV-001`… sequential across the whole file.
- **Pre** — state required before the first step (seed data, existing records, filters).
- **Steps** — the Arabic click path exactly as the UI renders it (button/label text is
  quoted verbatim from source, not paraphrased).
- **Assert** — what must be true afterward. A step with no assertion is a click, not a
  test. Money and Qty are scaled integers; assert on the persisted value, not just the
  toast.
- **"reload"** means a hard browser reload (F5 / re-navigate from a fresh app boot), not
  just leaving and re-entering the SPA screen — it is the only way to prove a save
  reached the API instead of living in local component state.
- Every screen in this build is a flat, unpaginated client-side list (`page=1,
  pageCount=1` hardcoded) **except Items**, which page real API-shaped data at
  `PAGE_SIZE = 5`. Where a screen has no server pagination, "pagination" scenarios are
  replaced with "all rows render at once" assertions instead.
- None of these 14 screens has a row-level kebab/"more" menu unless explicitly said so
  below — the reference catalog documents kebab menus (عرض/تعديل/تعطيل/حذف/تكرار…) on
  almost every list; this build's row click opens that row's own detail directly, and
  secondary actions live as buttons on the detail page. Actions the catalog describes
  that have **no button anywhere** in this build are marked `[NOT IMPLEMENTED]`.

## Seed data used throughout (from `packages/backend/src/demo-seed.ts` and
`packages/backend/src/demo-seed/inventory-ops.ts`)

| | |
|---|---|
| Items | ITEM-DEMO-1…4 (`IT-0001`…`IT-0004`, plain: rice/oil/sugar/tea), ITEM-DEMO-5/6 (`IT-0005`/`IT-0006`, manufacturable — BOM-DEMO-1/2 build them), ITEM-DEMO-7/8 (`IT-0007`/`IT-0008`, batch+expiry tracked: milk/yoghurt) |
| Warehouses | `WH-MAIN` (main), `WH-GIZA` (مستودع فرع الجيزة), `WH-TRANSIT` (مخزون بالطريق), `WH-VAN` (عربة توزيع رقم ١) |
| Adjustments | `ADJ-DEMO-1` INITIAL_STOCK (posts GL: Dr 1200 / Cr 3100), `ADJ-DEMO-2` DAMAGE, `ADJ-DEMO-3` OTHER, `ADJ-DEMO-4` EXPIRY, `ADJ-DEMO-5`/`ADJ-DEMO-6` PHYSICAL_COUNT (generated from counts) — 6 documents, 5 distinct reasons |
| Transfers | `TRF-DEMO-1` (confirmed, → الجيزة), `TRF-DEMO-2` (confirmed, → بالطريق), `TRF-DEMO-3` (**draft**, seeded through a backend-only endpoint the UI never exposes — see INV-078) |
| Physical counts | `PC-DEMO-1` (main, completed, generated `ADJ-DEMO-5`), `PC-DEMO-2` (الجيزة, completed, generated `ADJ-DEMO-6`, cancels PC-DEMO-1's variance to zero), `PC-DEMO-3` (main, **blind**, still `IN_PROGRESS`, one line uncounted) |
| Work orders | `WO-DEMO-1` (BOM-DEMO-1, planned, not started), `WO-DEMO-2` (BOM-DEMO-2, started — materials not yet issued), `WO-DEMO-3` (BOM-DEMO-1, cancelled) |
| BOMs | `BOM-DEMO-1` → ITEM-DEMO-5 (4×ITEM-DEMO-4 + 6×ITEM-DEMO-3, labor 50, overhead 30), `BOM-DEMO-2` → ITEM-DEMO-6 (5×ITEM-DEMO-4 + 5×ITEM-DEMO-3, labor 40, overhead 20) |
| Product templates | `TPL-TEA` (SIZE×PACK, 3 variants generated), `TPL-RICE` (SIZE×ORIGIN, 2 variants generated) |
| Item specifications | `SIZE`, `PACK`, `ORIGIN` (select), `NET-WEIGHT` (number, unit جم), `STORAGE` (text) |
| Write-down runs | one, period `2026-08`, already posted, against ITEM-DEMO-6 (aged past 180 days from its 2026-02-15 opening) |

## Defects this run **will** hit — reference `docs/defects.md`, do not re-file

- **D2** — a `PHYSICAL_COUNT` adjustment posts **no journal entry**
  (`adjustmentGlAccountsForReason` in `packages/backend/src/create-backend.ts` maps GL
  accounts for `INITIAL_STOCK` only). Verified directly in code: **every reason except
  `INITIAL_STOCK`** — `DAMAGE`, `THEFT`, `EXPIRY`, `SHORTAGE`, `SUPPLIER_RETURN`,
  `PHYSICAL_COUNT`, `OTHER` — posts no GL entry, so `ADJ-DEMO-2` through `ADJ-DEMO-6`'s
  "المحاسبة" tab all hit the same "لا يوجد قيد محاسبي" branch as D2's `PHYSICAL_COUNT`
  case. The seed's two physical counts (`PC-DEMO-1`/`PC-DEMO-2`) are engineered to net to
  zero across warehouses — that is *evidence the gap is avoided*, not evidence it is
  safe.
- **D3** — `completeWorkOrder` never posts to GL 1200. This build's own work-order detail
  page *claims otherwise* — its effects copy reads "وعند الإكمال تُرحَّل قيود رسملة
  الإنتاج تحت التشغيل تلقائياً" (on completion, WIP-capitalisation entries post
  automatically) — which is false per D3. **Completing a work order will unbalance the
  books.** No work order in the seed is completed. Run INV-206 only on a throwaway
  database, and never before a scenario that asserts reconciliation.
- **D4** — the drift report is out of this file's scope (it lives under Reports, not in
  the 14 screens assigned here); noted only so a tester doesn't mistake a
  timestamp-ordering artifact for a real gap if they cross-reference it.

## Scope boundary

This file's 14 screens do not include a Chart-of-Accounts/GL-balance screen or the
Inventory Valuation/Drift reports (`/reports/inventory/*`), so a scenario cannot show
"GL 1200's live balance" on-screen — only the per-document journal entry inside a Stock
Adjustment's "المحاسبة" tab. Reconciliation scenarios below check what these 14 screens
can show: the Stock Balance rollup total, and adjustment-by-adjustment GL presence, per
D2's exact mechanism.

---

## 1. الأصناف (Items)

### List

#### INV-001 — Header stats on load
- **Pre:** none.
- **Steps:** افتح المخزون ← الأصناف.
- **Assert:** "إجمالي الأصناف" = 8، "نشط" = 8، "أصناف مخزون" = 8، "أصناف خدمية" = 0 (كل الأصناف المزروعة `type: "stock"`، لا يوجد صنف خدمي).

#### INV-002 — Status chip "نشط"
- **Pre:** في شاشة الأصناف.
- **Steps:** اضغط شريحة "نشط".
- **Assert:** كل الصفوف الظاهرة تحمل شارة "نشط"؛ العدد = 8.

#### INV-003 — Status chip "غير نشط" (empty state via filter)
- **Steps:** اضغط شريحة "غير نشط".
- **Assert:** لا صفوف؛ نص الحالة الفارغة "لا توجد أصناف مطابقة".

#### INV-004 — Type chip "منتج مخزون"
- **Steps:** اضغط شريحة "منتج مخزون".
- **Assert:** 8 صفوف (كل الأصناف).

#### INV-005 — Type chip "خدمة"
- **Steps:** اضغط شريحة "خدمة".
- **Assert:** لا صفوف؛ حالة فارغة.

#### INV-006 — Category filter dropdown
- **Steps:** افتح القائمة المنسدلة "تصفية حسب التصنيف" (aria-label).
- **Assert:** لا توجد تصنيفات مزروعة لهذا التينانت — القائمة تعرض فقط "كل التصنيفات"؛ اختيارها لا يغيّر النتائج.

#### INV-007 — Unit filter dropdown
- **Steps:** افتح القائمة المنسدلة "تصفية حسب الوحدة"، اختر "قطعة (PCS)".
- **Assert:** تبقى كل الأصناف الثمانية ظاهرة (كلها بوحدة PCS).

#### INV-008 — Search by Arabic name substring
- **Steps:** اكتب "أرز" في "بحث بالاسم أو الكود...".
- **Assert:** صف واحد فقط: "أرز أبيض ٥ كجم" (ITEM-DEMO-1).

#### INV-009 — Search by code
- **Steps:** اكتب "IT-0005".
- **Assert:** صف واحد: "خليط شاي بالسكر ١ كجم".

#### INV-010 — Search no match
- **Steps:** اكتب "xyz-none".
- **Assert:** حالة فارغة "لا توجد أصناف مطابقة".

#### INV-011 — Sort by "اسم الصنف"
- **Steps:** اضغط رأس العمود "اسم الصنف" مرتين.
- **Assert:** الاتجاه الأول تصاعدي أبجدياً (عربي)، الثاني تنازلي.

#### INV-012 — Sort by "سعر البيع"
- **Steps:** اضغط رأس العمود "سعر البيع".
- **Assert:** الترتيب تصاعدي حسب القيمة الرقمية للسعر، ليس نصياً (12 قبل 260).

#### INV-013 — Sort by "سعر التكلفة"
- **Steps:** اضغط رأس العمود "سعر التكلفة".
- **Assert:** نفس السلوك الرقمي.

#### INV-014 — Pagination (real, `PAGE_SIZE = 5`)
- **Pre:** لا فلاتر مفعّلة (8 صفوف).
- **Steps:** لاحظ تذييل الصفحة "عرض 1–5 من 8 صنف"؛ اضغط "التالي".
- **Assert:** الصفحة الثانية تعرض "عرض 6–8 من 8 صنف" والصفوف الثلاثة المتبقية.

#### INV-015 — Row edit icon vs. row click
- **Steps:** اضغط زر التعديل (أيقونة القلم، aria-label "تعديل <اسم الصنف>") على أي صف.
- **Assert:** تفتح لوحة "تعديل صنف" جانبياً معبأة ببيانات الصنف — النقر على الأيقونة لا يفتح صفحة التفاصيل (event.stopPropagation).

#### INV-016 — Header action "إضافة صنف"
- **Steps:** اضغط "إضافة صنف".
- **Assert:** تفتح لوحة "إضافة صنف"؛ حقل "كود الصنف" معطّل ومعبأ تلقائياً بكود مولّد (`ITM-000009` مع 8 أصناف موجودة) — لاحظ أنه بصيغة مختلفة عن أكواد البيانات المزروعة (`IT-000x`)، وهذا سلوك متوقع لا خطأ.

#### INV-017 — List load error + retry
- **Pre:** حاكِ فشل `GET /items`.
- **Steps:** افتح شاشة الأصناف.
- **Assert:** بطاقة خطأ "تعذّر تحميل الأصناف." مع زر "إعادة المحاولة"؛ الضغط عليه يعيد الطلب.

### Create / Edit form

#### INV-018 — Required name rejected
- **Steps:** افتح "إضافة صنف"، اترك "اسم الصنف" فارغاً، اضغط "إضافة".
- **Assert:** تنبيه "اسم الصنف مطلوب."؛ اللوحة تبقى مفتوحة؛ لا طلب `POST` يُرسل.

#### INV-019 — Item type toggle to "خدمة" hides inventory policy
- **Steps:** في "إضافة صنف"، غيّر "نوع الصنف" إلى "خدمة".
- **Assert:** بطاقة "تتبع المخزون / طريقة التكلفة / تتبع الدفعات / نقطة إعادة الطلب" تختفي بالكامل؛ الوحدة الأساسية تتحول تلقائياً إلى "SVC" إن كانت لا تزال "PCS".

#### INV-020 — Toggle back to "منتج مخزون" restores policy card
- **Steps:** من نفس اللوحة، أعد "نوع الصنف" إلى "منتج مخزون".
- **Assert:** بطاقة سياسة المخزون تظهر من جديد، "تتبع المخزون" مفعّل افتراضياً.

#### INV-021 — Alternate unit: blank code/name rejected
- **Steps:** أضف وحدة بديلة عبر "+ إضافة وحدة"، اترك الحقلين فارغين، اضغط "إضافة".
- **Assert:** خطأ "كود واسم الوحدة البديلة مطلوبان."

#### INV-022 — Alternate unit matching base unit rejected
- **Steps:** أضف وحدة بديلة بكود "PCS" (نفس الوحدة الأساسية)، اضغط "إضافة".
- **Assert:** خطأ "الوحدة البديلة \"PCS\" لا يمكن أن تطابق الوحدة الأساسية."

#### INV-023 — Duplicate alternate unit code rejected
- **Steps:** أضف وحدتين بديلتين بنفس الكود "CTN".
- **Assert:** خطأ "كود الوحدة البديلة \"CTN\" مكرر."

#### INV-024 — Non-positive conversion factor rejected
- **Steps:** أضف وحدة بديلة "CTN" بعامل تحويل = 0.
- **Assert:** خطأ "عامل تحويل الوحدة \"CTN\" يجب أن يكون رقماً موجباً."

#### INV-025 — Alternate unit save + reload
- **Steps:** أضف وحدة صحيحة "CTN" / "كرتونة" / عامل 12، احفظ، أعد تحميل الصفحة (F5)، افتح الصنف ← تبويب "الوحدات والباركود".
- **Assert:** الجدول يظهر "1 CTN = 12 PCS".

#### INV-026 — Blank barcode rejected
- **Steps:** أضف باركوداً عبر "+ إضافة باركود آخر"، اتركه فارغاً، اضغط "إضافة".
- **Assert:** خطأ "لا يمكن ترك الباركود فارغاً."

#### INV-027 — Duplicate barcode rejected
- **Steps:** أضف نفس قيمة الباركود مرتين.
- **Assert:** خطأ "الباركود \"...\" مكرر."

#### INV-028 — Barcode save + reload (feeds label printing — see INV-140)
- **Steps:** أضف باركوداً صحيحاً طويلاً (مثال: `1234567890123456789012345`, 25 خانة)، احفظ، أعد التحميل، افتح تبويب "الوحدات والباركود".
- **Assert:** الباركود ظاهر كشريحة؛ هذا هو نفس الباركود الذي ستستخدمه شاشة طباعة الملصقات لاحقاً.

#### INV-029 — Negative sale price — **not rejected** (gap)
- **Steps:** اكتب "-50" في "سعر البيع"، احفظ.
- **Assert (expected):** يجب أن تُرفض القيمة السالبة. **الفعلي:** `MoneyInput` يقبل علامة السالب صراحةً (`sanitizeDraft` تحافظ على `-`) و`validateDraft` في `ItemsScreen.tsx` لا يتحقق من `salePrice`/`costPrice` إطلاقاً — لا حارس عميل ولا خادم ظاهر من الشاشة. القيمة تُحفظ سالبة وتبقى بعد إعادة التحميل. سجّل كخلل مكتشف عند التنفيذ.

#### INV-030 — Negative cost price — same gap
- **Steps:** كرر INV-029 على "سعر التكلفة".
- **Assert:** نفس النتيجة — لا رفض.

#### INV-031 — Negative reorder point rejected
- **Pre:** نوع الصنف = "منتج مخزون".
- **Steps:** اكتب "-5" في "نقطة إعادة الطلب"، احفظ.
- **Assert:** خطأ "نقطة إعادة الطلب لا يمكن أن تكون سالبة."؛ لا حفظ.

#### INV-032 — Negative reorder qty rejected
- **Steps:** كرر على "كمية إعادة الطلب".
- **Assert:** خطأ "كمية إعادة الطلب لا يمكن أن تكون سالبة."

#### INV-033 — Negative tax rate rejected
- **Steps:** اكتب "-1" في "نسبة الضريبة %".
- **Assert:** خطأ "نسبة الضريبة لا يمكن أن تكون سالبة."

#### INV-034 — trackBatches disabled when trackInventory off
- **Steps:** أطفئ مفتاح "تتبع المخزون".
- **Assert:** مفتاح "تتبع الدفعات وتواريخ الصلاحية" يصبح معطّلاً ويُطفأ تلقائياً.

#### INV-035 — Costing method save + reload
- **Steps:** غيّر "طريقة التكلفة" إلى "FIFO"، احفظ، أعد التحميل، افتح تبويب "عام".
- **Assert:** "طريقة التكلفة" = "الأقدم أولاً (FIFO)".

#### INV-036 — GL account override save + reload
- **Steps:** في بطاقة الحسابات، اختر حساباً مخصصاً لـ"حساب المخزون" بدل "الافتراضي حسب نوع الصنف"، احفظ، أعد التحميل، افتح تبويب "الحسابات".
- **Assert:** يظهر الحساب المختار بصيغة "الكود — الاسم"، وليس "الافتراضي حسب نوع الصنف".

#### INV-037 — ETA fields save + reload
- **Steps:** اختر "نوع الكود (ETA)" = EGS، اكتب كوداً بصيغة `EG-XXXXXXXXX-SKU`، احفظ، أعد التحميل.
- **Assert:** تبويب "الحسابات" يعرض القيم المحفوظة بدل "—".

#### INV-038 — Full happy-path create + reload
- **Steps:** أنشئ صنفاً جديداً كاملاً (اسم، وحدة، سعر بيع/تكلفة، ضريبة)، احفظ، أعد تحميل الصفحة، ابحث عنه بالاسم.
- **Assert:** يظهر في القائمة بنفس الاسم/الكود/النوع/الوحدة/الأسعار المُدخلة.

#### INV-039 — Cancel discards draft
- **Steps:** افتح "إضافة صنف"، اكتب اسماً، اضغط "إلغاء".
- **Assert:** اللوحة تُغلق؛ لا طلب `POST`؛ الاسم لا يظهر في القائمة حتى بعد إعادة التحميل.

#### INV-040 — Edit status dropdown (edit-only field)
- **Pre:** فتح صنف موجود للتعديل.
- **Steps:** لاحظ حقل "الحالة" يظهر فقط في وضع التعديل (غير موجود في نموذج الإضافة)؛ غيّره إلى "غير نشط"، احفظ، أعد التحميل.
- **Assert:** الصف يحمل شارة "غير نشط"؛ إحصائية "نشط" تنقص بواحد.

#### INV-041 — Save-time server error keeps draft open
- **Pre:** حاكِ رفض الخادم لطلب `PATCH`/`POST`.
- **Steps:** احفظ صنفاً صالحاً ظاهرياً.
- **Assert:** تنبيه بنص خطأ الخادم (أو الرسالة الافتراضية "تعذّرت العملية.")؛ اللوحة تبقى مفتوحة ببيانات المستخدم كما هي (لا فقدان للمُدخلات).

### Detail

#### INV-042 — Tab "عام"
- **Steps:** افتح أي صنف، تبويب "عام" (الافتراضي).
- **Assert:** يعرض نوع الصنف، التصنيف، الماركة، طريقة التكلفة، تتبع المخزون (نعم/لا)، تتبع الدفعات (نعم/لا)، نقطة/كمية إعادة الطلب.

#### INV-043 — Tab "الوحدات والباركود" empty states
- **Pre:** صنف بلا وحدات بديلة وبلا باركود (أي صنف مزروع لم يُعدَّل).
- **Steps:** افتح التبويب.
- **Assert:** "لا توجد وحدات قياس بديلة" و"لا يوجد باركود مسجل".

#### INV-044 — Tab "التسعير"
- **Steps:** افتح التبويب.
- **Assert:** يعرض سعر البيع وسعر التكلفة الحاليين + ملاحظة "يصبح مشتقاً تلقائياً من حركات المخزون فور ربط دفتر التكاليف (المرحلة الثانية)". **`[NOT IMPLEMENTED]`** مقارنةً بالكتالوج: لا جدول "طبقات التكلفة"، لا مطابقة متوسط التكلفة مقابل الطبقات، لا سجل تكاليف إضافية موزعة (landed costs) — كل هذا نص مرحلة ثانية معلّق.

#### INV-045 — Tab "الحسابات"
- **Steps:** افتح التبويب.
- **Assert:** يعرض حساب الإيراد/التكلفة/المخزون + حقول ETA (نوع الكود، كود الصنف لدى المصلحة، كود GPC).

#### INV-046 — Tab "المخزون" — `[NOT IMPLEMENTED]`
- **Steps:** افتح التبويب.
- **Assert:** نص ثابت فقط: "ستُعرض أرصدة المخزون حسب المستودع هنا فور ربط حركات المخزون بدفتر المخزون (المرحلة الثانية)." لا جدول مستودع/متاح/محجوز/إجمالي كما يصف الكتالوج — لا توجد طريقة من هذه الشاشة لرؤية توزيع مخزون صنف عبر المستودعات الأربعة.

#### INV-047 — Header actions "رجوع للقائمة" / "تعديل"
- **Steps:** من صفحة التفاصيل، اضغط "تعديل".
- **Assert:** تفتح لوحة التعديل معبأة؛ "رجوع للقائمة" يعيد لقائمة الأصناف بدون فتح أي لوحة.

#### INV-048 — `[NOT IMPLEMENTED]` catalog features absent from Items entirely
- **Assert (no UI path exists for any of):** قائمة "المزيد" (طباعة ملصقات / تحديد رصيد افتتاحي / تعطيل / حذف من صفحة الصنف)، حوار "تصنيفات الأصناف" من رأس القائمة، فلتر "إخفاء المتغيرات"، نطاقات سعر البيع/سعر التكلفة في لوحة الفلاتر، حقل صورة الصنف، حقل الموسم المرتبط بالمورد، مفتاحا "متاح في نقطة البيع" و"يعتبر هدراً عند التقديم"، تبويبا "المرفقات" و"السجل"، وأنواع الأصناف الست الكاملة (هذا البناء يقتصر على `stock`/`service` فقط، بلا "مادة خام" أو "منتج نهائي" أو "مستهلك" أو "الوصفة" كخيارات مستقلة).

---

## 2. المواصفات (Item Specifications)

`[NOT IN CATALOG]` — build-only feature, absent from `docs/catalog/03-inventory.md`
entirely; documented here from code alone. Feeds the "من سجل المواصفات" attribute
shortcut on Product Templates (see INV-060).

#### INV-049 — Header stats and chips on load
- **Pre:** 5 مواصفات مزروعة (SIZE, PACK, ORIGIN — اختيار؛ NET-WEIGHT — رقم؛ STORAGE — نص).
- **Steps:** افتح المخزون ← المواصفات.
- **Assert:** "إجمالي المواصفات" = 5؛ "قابلة للتصفية" = 3 (SIZE/PACK/ORIGIN، الوحيدة بـ`filterable: true`).

#### INV-050 — Chip "قائمة اختيار"
- **Steps:** اضغط شريحة "قائمة اختيار".
- **Assert:** 3 صفوف (SIZE, PACK, ORIGIN).

#### INV-051 — Chip "رقم"
- **Steps:** اضغط شريحة "رقم".
- **Assert:** صف واحد (NET-WEIGHT) بعمود "القيم / الوحدة" = "جم".

#### INV-052 — Chip "نص"
- **Steps:** اضغط شريحة "نص".
- **Assert:** صف واحد (STORAGE) بعمود "القيم / الوحدة" = "—".

#### INV-053 — Search by code/name
- **Steps:** اكتب "SIZE" في "بحث بالكود أو الاسم…".
- **Assert:** صف واحد فقط.

#### INV-054 — Values cell for select type
- **Steps:** لاحظ عمود "القيم / الوحدة" لصف SIZE.
- **Assert:** شرائح "صغير"، "وسط"، "كبير".

#### INV-055 — Usage count column
- **Steps:** لاحظ عمود "الاستخدام" لصفوف SIZE/PACK/ORIGIN (مستخدمة في قوالب TPL-TEA/TPL-RICE).
- **Assert:** رقم > 0 لكل من SIZE/PACK/ORIGIN؛ 0 لـ NET-WEIGHT وSTORAGE.

#### INV-056 — Delete guarded when in use
- **Pre:** SIZE مستخدمة (usageCount > 0).
- **Steps:** اضغط زر الحذف (سلة المهملات) على صف SIZE.
- **Assert:** الزر معطّل (`disabled={... || s.usageCount > 0}`) — لا يمكن النقر عليه إطلاقاً.

#### INV-057 — Delete unused specification
- **Steps:** أنشئ مواصفة جديدة غير مستخدمة (كود `TEST-1`)، ثم اضغط حذفها.
- **Assert:** تختفي من القائمة؛ لا خطأ.

#### INV-058 — Create: code pattern validation
- **Steps:** اضغط "مواصفة جديدة"، اكتب كوداً بحروف صغيرة أو رموز غير مسموحة (مثال "size!"), احفظ.
- **Assert:** خطأ "الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى)." (الحقل نفسه يحوّل الإدخال لحروف كبيرة تلقائياً `.toUpperCase()`، فالرمز "!" هو ما يُسقط الفحص).

#### INV-059 — Create: name required
- **Steps:** اترك "الاسم بالعربية" فارغاً، احفظ.
- **Assert:** خطأ "الاسم بالعربية مطلوب."

#### INV-060 — Create: select type requires ≥1 value
- **Steps:** اختر النوع "قائمة اختيار"، اترك "القيم المسموح بها" فارغة، احفظ.
- **Assert:** خطأ "قائمة الاختيار تحتاج قيمة واحدة على الأقل."

#### INV-061 — Create: number type shows unit field
- **Steps:** اختر النوع "رقم".
- **Assert:** يظهر حقل "الوحدة" بدل "القيم المسموح بها".

#### INV-062 — Create: text type shows neither
- **Steps:** اختر النوع "نص".
- **Assert:** لا حقل قيم ولا حقل وحدة.

#### INV-063 — Create full round-trip + reload
- **Steps:** أنشئ مواصفة اختيار جديدة (كود، اسم، قيم "أحمر, أزرق"), فعّل "قابلة للتصفية في الكتالوج", احفظ, أعد تحميل الصفحة.
- **Assert:** تظهر في القائمة بنفس القيم والعلم "نعم" في عمود "قابلة للتصفية".

#### INV-064 — Edit: code and type locked
- **Steps:** افتح مواصفة موجودة للتعديل (زر "تعديل").
- **Assert:** حقلا "الكود" و"النوع" معطّلان (توضيح اللوحة: "النوع والكود لا يتغيران بعد الحفظ — قوالب المنتجات ترتبط بهما").

#### INV-065 — Edit: toggle "نشطة" off + reload
- **Steps:** عدّل مواصفة غير مستخدمة، أطفئ "نشطة"، احفظ، أعد التحميل.
- **Assert:** الصف يحمل شارة "غير نشطة" بجانب الاسم.

---

## 3. قوالب المنتجات (Product Templates)

#### INV-066 — Header stat and list columns
- **Pre:** قالبان مزروعان (TPL-TEA بثلاثة متغيرات مولّدة، TPL-RICE باثنين).
- **Steps:** افتح المخزون ← قوالب المنتجات.
- **Assert:** "إجمالي القوالب" = 2؛ الأعمدة: اسم المنتج، الكود، الخصائص (عدد)، الحالة. **`[NOT IMPLEMENTED]`**: لا عمود "المتغيرات" كما يصف الكتالوج، ولا مربع بحث على هذه الشاشة إطلاقاً (لا `searchValue` في الكود)، ولا فلاتر حالة (نشط/غير نشط).

#### INV-067 — Create: required fields
- **Steps:** اضغط "قالب جديد"، اترك "الكود" فارغاً، احفظ.
- **Assert:** خطأ "الكود والاسم ووحدة القياس مطلوبة." (فحص واحد مشترك للحقول الثلاثة).

#### INV-068 — Create: no numeric guard on default price/cost — gap
- **Steps:** اكتب "-100" في "السعر الافتراضي".
- **Assert (expected):** رفض القيمة السالبة. **الفعلي:** الحقل `TextField` نصي بحت، بلا `NumberField` وبلا فحص علامة في `handleCreateSubmit` — القيمة تُحفظ كما كُتبت.

#### INV-069 — Create full round-trip
- **Steps:** أنشئ قالباً (اسم، كود، وحدة "PCS")، احفظ.
- **Assert:** ينتقل تلقائياً لفتح لوحة تفاصيل القالب الجديد (`setSelectedId(created.id)`).

#### INV-070 — Add attribute from free text
- **Pre:** قالب جديد بلا خصائص.
- **Steps:** اترك "من سجل المواصفات" على "خاصية خاصة بهذا القالب"، اكتب "اسم الخاصية" = "اللون"، "القيم مفصولة بفواصل" = "أحمر, أزرق, أخضر"، اضغط "إضافة خاصية".
- **Assert:** بطاقة خاصية جديدة "اللون (3)" بثلاث شرائح قيم.

#### INV-071 — Add attribute: blank name/values rejected
- **Steps:** اترك اسم الخاصية والقيم فارغين، اضغط "إضافة خاصية".
- **Assert:** خطأ "اسم الخاصية والقيم (مفصولة بفواصل) مطلوبة."

#### INV-072 — Add attribute from specification registry
- **Steps:** افتح "من سجل المواصفات"، اختر "الحجم (SIZE)"، اضغط "إضافة خاصية".
- **Assert:** خاصية جديدة تحمل قيم SIZE الثلاث (صغير/وسط/كبير) بلا كتابة يدوية.

#### INV-073 — Add value inline
- **Pre:** خاصية موجودة.
- **Steps:** اكتب قيمة في حقل "+ قيمة" داخل بطاقة الخاصية، اضغط Enter.
- **Assert:** شريحة القيمة الجديدة تظهر فوراً؛ عداد "(N)" يزيد بواحد.

#### INV-074 — Delete attribute value — **no client guard** (gap vs. catalog)
- **Pre:** TPL-TEA، خاصية SIZE مستخدمة في 3 متغيرات موجودة.
- **Steps:** افتح TPL-TEA، اضغط × على قيمة "صغير" ضمن خاصية "الحجم".
- **Assert (expected per catalog):** يجب أن يكون الزر معطّلاً بتلميح "هذه الخاصية مستخدمة في N متغير — احذف المتغيرات أولاً". **الفعلي:** الزر دائماً قابل للنقر (`handleDeleteValue` يستدعي مباشرة بلا أي شرط)؛ الرفض إن وُجد يأتي فقط من استجابة الخادم كرسالة خطأ عامة "تعذّر حذف القيمة." — لا حارس على مستوى الواجهة.

#### INV-075 — Delete attribute — same gap
- **Steps:** اضغط "حذف الخاصية" على خاصية مستخدمة في متغيرات موجودة.
- **Assert:** نفس الملاحظة — لا تعطيل عميل؛ الاعتماد كليًا على رفض الخادم (رسالة "تعذّر حذف الخاصية." إن رُفض).

#### INV-076 — Variant generator: combination count and locking
- **Pre:** TPL-TEA (SIZE×PACK = 3×3 = 9 تركيبة ممكنة نظرياً لكن القيم المزروعة مختلفة الحجم لكل — تحقق العدد الفعلي من `combos.length`).
- **Steps:** افتح TPL-TEA.
- **Assert:** العنوان "توليد المتغيرات — N تركيبة ممكنة، 3 موجودة بالفعل"؛ الصفوف الثلاثة المولّدة مسبقاً معطّلة الصندوق ومحدّدة تلقائياً بشارة "موجود"؛ الباقي بشارة "جديد".

#### INV-077 — Generate new variant combinations
- **Pre:** TPL-RICE (تركيبتان موجودتان من أصل 4 ممكنة إن كان SIZE له قيمتان × ORIGIN له 3 قيم — تحقق العدد الفعلي).
- **Steps:** حدد صندوق تركيبة "جديد" غير موجودة، اضغط "توليد (1)".
- **Assert:** يظهر متغير جديد في قسم "المتغيرات" بكود صنف (`itemCode`) حقيقي؛ الصنف الجديد يظهر أيضاً في شاشة الأصناف بعد تحديثها.

#### INV-078 — All combinations already generated
- **Pre:** كل التركيبات الممكنة لقالب موجودة.
- **Steps:** افتح ذلك القالب.
- **Assert:** رسالة "تم توليد كل التركيبات الممكنة."؛ زر "توليد (0)" معطّل.

#### INV-079 — Variants list
- **Steps:** افتح TPL-TEA، مرر لقسم "المتغيرات (3)".
- **Assert:** ثلاث بطاقات، كل واحدة بتسمية التركيبة (مثال "صغير / كيس") وكود الصنف المولّد.

#### INV-080 — `[NOT IMPLEMENTED]` alternate units UI
- **Assert:** لا يوجد أي عنصر واجهة لتعريف "وحدات بديلة" على مستوى القالب كما يصف الكتالوج ("لفة = 12 متر" تُورث لكل متغير) — لا حقل، لا زر "إضافة وحدة" على هذه الشاشة إطلاقاً.

---

## 4. المنتجات القابلة للتهيئة (Configurable Products)

Nav item lives under "المخزون" في الشريط الجانبي لكنها منطقياً وحدة تصنيع؛ الشاشة نفسها
تُصنَّف "Manufacturing · Configurable products" في الكود.

#### INV-081 — Header stats and chips
- **Pre:** لا منتجات قابلة للتهيئة مزروعة في هذا التينانت (القائمة `WORK_ORDERS`/`BOMS` لا تُنشئ منتجاً قابلاً للتهيئة).
- **Steps:** افتح المخزون ← المنتجات القابلة للتهيئة.
- **Assert:** "الإجمالي" = 0؛ حالة فارغة "لا توجد منتجات قابلة للتهيئة مطابقة — أضف منتجاً جديداً".

#### INV-082 — Create: required fields
- **Steps:** اضغط "إضافة منتج قابل للتهيئة"، اترك "الكود" و"الاسم بالعربية" و"المنتج الناتج" فارغة، لاحظ زر "حفظ".
- **Assert:** الزر معطّل (`canSave` يتطلب الثلاثة + مدخل واحد صالح على الأقل + خامة واحدة صالحة على الأقل).

#### INV-083 — Output item auto-fills unit
- **Steps:** اختر "المنتج الناتج" من قائمة الأصناف.
- **Assert:** حقل "وحدة المنتج النهائي" يتحدث تلقائياً لوحدة الصنف الأساسية.

#### INV-084 — Config input rows: add/remove
- **Steps:** اضغط "إضافة مدخل"، ثم "حذف المدخل" على الصف الأول (يظهر الزر فقط عند وجود أكثر من صف واحد).
- **Assert:** الصف الأول (الوحيد الآن) لا يحمل زر حذف — لا يمكن ترك القائمة بلا صف واحد على الأقل.

#### INV-085 — Material rows: add/remove
- **Steps:** كرر نفس السلوك على قسم "خامات التصنيع".
- **Assert:** نفس القاعدة — صف أخير غير قابل للحذف.

#### INV-086 — Pricing method "معادلة" requires price formula
- **Steps:** اختر "طريقة التسعير" = "معادلة"، اترك "معادلة السعر (للوحدة)" فارغة، لاحظ "حفظ".
- **Assert:** الزر معطّل حتى تُملأ معادلة السعر.

#### INV-087 — Full happy-path create + reload
- **Steps:** أنشئ منتجاً قابلاً للتهيئة كاملاً: كود، اسم عربي، منتج ناتج (اختر ITEM-DEMO-4)، مدخل واحد (`width`/"العرض"), خامة واحدة (اختر ITEM-DEMO-3 بمعادلة `width*2`), التسعير "معادلة" بصيغة `width*3.5`, احفظ, أعد تحميل الصفحة.
- **Assert:** يظهر في القائمة بنفس الكود والاسم؛ عمود "مدخلات التهيئة" = "العرض"؛ عمود "خامات التصنيع" = 1.

#### INV-088 — Detail tabs
- **Steps:** افتح المنتج الذي أُنشئ في INV-087.
- **Assert:** تبويب "مدخلات التهيئة (1)" يعرض المعرف/التسمية/الحد الأدنى/الأقصى؛ تبويب "خامات التصنيع (1)" يعرض الصنف/معادلة الكمية/نسبة الهالك؛ تبويب "التسعير والتكلفة" يعرض معادلة السعر `width*3.5` ومعادلتي العمالة/المصاريف كـ"—" إن لم تُدخلا.

#### INV-089 — Effects copy — sandboxed formulas
- **Steps:** لاحظ نص "تأثيرات" أسفل ملخص التفاصيل.
- **Assert:** "المعادلات تُقيَّم عبر مُقيِّم آمن (Sandbox) — لا يستخدم eval إطلاقاً." و"كل أمر تصنيع مخصص يُقيّم هذه المعادلات مقابل مواصفات العميل لحساب الخامات والسعر."

#### INV-090 — Deactivate
- **Steps:** من صفحة التفاصيل لمنتج نشط، اضغط "تعطيل".
- **Assert:** الحالة تتحول "غير نشط"؛ زر "تعطيل" يختفي (الشرط `status === "active"`); لا حوار تأكيد.

#### INV-091 — `[NOT IMPLEMENTED]` no edit action
- **Pre:** منتج قابل للتهيئة موجود.
- **Steps:** ابحث عن أي طريقة لتعديل الصيغ/المدخلات/الخامات بعد الإنشاء.
- **Assert:** لا يوجد — الشاشة توفر فقط "إنشاء" و"تعطيل"؛ لا `useUpdateConfigurableProduct` ولا زر تعديل في `ProductDetail`.

#### INV-092 — `[NOT IMPLEMENTED]` no row menu / no quick "new custom order"
- **Assert:** لا قائمة كيباب على صفوف القائمة، ولا زر سريع "أمر تصنيع مخصص جديد" على كل صف كما يصف الكتالوج — للوصول لإنشاء أمر تصنيع مخصص يجب الانتقال يدوياً لشاشة "التصنيع المخصص" (قسم 13).

#### INV-093 — Status chips and search
- **Steps:** بعد إنشاء منتجين (أحدهما مُعطَّل)، اضغط شريحة "نشط" ثم "غير نشط"، ثم ابحث بالكود.
- **Assert:** كل فلتر يعزل الصف الصحيح؛ لا صفحات (كل النتائج تُعرض دفعة واحدة).

---

## 5. أرصدة المخزون (Stock Balance)

Read-only rollup — no create/edit, no filter chips, no filters panel
(**`[NOT IMPLEMENTED]`** مقارنة بالكتالوج: لا فلاتر مستودع/تصنيف/وحدة/نطاق كمية، لا
شرائح "الكل/مخزون منخفض/نفد المخزون").

#### INV-094 — Header stats and columns
- **Steps:** افتح المخزون ← أرصدة المخزون.
- **Assert:** "إجمالي الأصناف" و"نفد المخزون" يطابقان عدد الأصناف ذات رصيد صفري عبر كل المستودعات؛ الأعمدة: الصنف، إجمالي المخزون، متوسط التكلفة، القيمة الإجمالية، عدد المستودعات.

#### INV-095 — Search
- **Steps:** ابحث بجزء من اسم صنف (مثال "شاي").
- **Assert:** تظهر فقط الأصناف المطابقة (ITEM-DEMO-4/5/6).

#### INV-096 — Sort by "إجمالي المخزون"
- **Steps:** اضغط رأس العمود.
- **Assert:** ترتيب رقمي تصاعدي/تنازلي عند التبديل.

#### INV-097 — Reconciliation check — INITIAL_STOCK-only GL evidence
- **Pre:** لا وصول من هذه الشاشة نفسها لرصيد حساب 1200 (خارج نطاق هذا الملف — راجع "Scope boundary").
- **Steps:** لاحظ "متوسط التكلفة" و"القيمة الإجمالية" لصف ITEM-DEMO-1.
- **Assert:** القيمة الإجمالية = المخزون الحالي × متوسط التكلفة المعروض على نفس الصف (فحص حسابي بسيط داخل هذه الشاشة وحدها)؛ أي مطابقة أعمق مع حساب 1200 تتطلب شاشة خارج نطاق هذا الملف.

#### INV-098 — Empty search
- **Steps:** ابحث بنص لا يطابق أي صنف.
- **Assert:** حالة فارغة "لا توجد أصناف مطابقة".

#### INV-099 — Load error + retry
- **Pre:** حاكِ فشل `GET /inventory/stock-balance`.
- **Steps:** افتح الشاشة.
- **Assert:** "تعذّر تحميل أرصدة المخزون." + "إعادة المحاولة".

#### INV-100 — No row navigation to per-warehouse breakdown — `[NOT IMPLEMENTED]`
- **Steps:** اضغط على صف صنف.
- **Assert:** لا شيء يحدث (لا `onRowClick` معرَّف في هذه الشاشة) — لا انتقال لتفاصيل الصنف أو لوحة جانبية، خلافاً لما يفترضه الكتالوج ("النقر على الصف يفتح صفحة الصنف").

---

## 6. تحويلات المخزون (Stock Transfers)

**أهم فجوة في هذا القسم:** زر "حفظ" في نموذج الإنشاء ينفّذ `createStockTransfer` ثم
`confirmStockTransfer` في نفس الاستدعاء — لا توجد مرحلة "مسودة" قابلة للمراجعة، ولا زر
"تأكيد" مستقل، ولا زر إلغاء لمسودة قائمة. التحويل المسودة الوحيد في البيانات المزروعة
(`TRF-DEMO-3`) أُنشئ عبر مسار خلفي مخصّص للبذر (`/inventory/stock-transfers/draft`) لا
تستخدمه الواجهة إطلاقاً — وبمجرد وجوده، **لا يوجد أي زر في الواجهة لتأكيده**.

#### INV-101 — Header stats and attention banner
- **Pre:** TRF-DEMO-1/2 مؤكدان، TRF-DEMO-3 مسودة.
- **Steps:** افتح المخزون ← تحويلات المخزون.
- **Assert:** "إجمالي التحويلات" = 3، "مسودة" = 1، "مؤكد" = 2.

#### INV-102 — Status chip "مسودة"
- **Steps:** اضغط شريحة "مسودة".
- **Assert:** صف واحد فقط (TRF-DEMO-3).

#### INV-103 — Draft row has no confirm action — `[NOT IMPLEMENTED]`
- **Pre:** من INV-102.
- **Steps:** افتح صف TRF-DEMO-3.
- **Assert:** تفتح صفحة التفاصيل، لكن لا يوجد أي زر "تأكيد" في الرأس ولا في أي مكان آخر بالصفحة (فحص الكود: الإجراء الوحيد الشرطي هو نص تنبيه يظهر فقط عندما `status === "confirmed"`؛ لا إجراء مقابل لحالة `draft`). هذا التحويل **عالق دون تأكيد بشكل دائم** عبر الواجهة.

#### INV-104 — Status chip "مؤكد"
- **Steps:** اضغط شريحة "مؤكد".
- **Assert:** صفان (TRF-DEMO-1/2).

#### INV-105 — Route column
- **Steps:** لاحظ عمود "المسار" لـTRF-DEMO-1.
- **Assert:** "مستودع الفرع الرئيسي ← مستودع فرع الجيزة" (أو الاسم المكافئ لـWH-MAIN وWH-GIZA).

#### INV-106 — Search by transfer number / memo
- **Steps:** ابحث بجزء من رقم التحويل.
- **Assert:** يعزل الصف الصحيح.

#### INV-107 — Create: warehouse required + same-warehouse rejected
- **Steps:** اضغط "تحويل جديد"، اختر نفس المستودع في "المستودع المصدر" و"المستودع الوجهة".
- **Assert:** تنبيه "يجب أن يختلف المستودع المصدر عن مستودع الوجهة."؛ زر "حفظ" معطّل.

#### INV-108 — Create: line qty must be > 0
- **Steps:** اختر صنفاً في السطر الأول، اترك "كمية التحويل" = 0.
- **Assert:** "حفظ" معطّل (`allLinesValid` يتطلب `qty > 0`).

#### INV-109 — Create: service items excluded from item picker
- **Steps:** افتح قائمة اختيار الصنف في أي سطر.
- **Assert:** لا يظهر أي صنف من نوع "خدمة" (فلتر `i.type !== "service"` في `itemOptions`) — لا صنف خدمي مزروع أصلاً في هذا التينانت، لكن الفلتر موجود في الكود بغض النظر.

#### INV-110 — Add / remove line
- **Steps:** اضغط "إضافة بند" مرتين، ثم احذف أحد السطور الجديدة (✕)، اترك سطراً واحداً، تحقق أن زر الحذف معطّل عليه.
- **Assert:** لا يمكن حذف آخر سطر متبقٍ.

#### INV-111 — Non-numeric quantity — native browser rejection
- **Steps:** حاول كتابة حروف في حقل "كمية التحويل" (type=number).
- **Assert:** المتصفح يرفض إدخال الحروف أصلاً؛ القيمة تبقى دون تغيير.

#### INV-112 — Effects panel text
- **Steps:** لاحظ بطاقة "تأثيرات هذا التحويل" أثناء الإنشاء.
- **Assert:** "خصم الكميات من المستودع المصدر وإضافتها للمستودع الوجهة" و"لا يتغير إجمالي قيمة المخزون".

#### INV-113 — Full create → auto-confirm → reload (value-neutral transfer)
- **Pre:** لاحظ "متوسط التكلفة" و"القيمة الإجمالية" لـITEM-DEMO-1 في أرصدة المخزون قبل التحويل.
- **Steps:** أنشئ تحويلاً من WH-MAIN إلى WH-GIZA لـ10 وحدات من ITEM-DEMO-1، اضغط "حفظ"، أعد تحميل شاشة أرصدة المخزون.
- **Assert:** رقم التحويل الجديد يظهر مباشرة بحالة "مؤكد" (لا حالة مسودة وسيطة مرئية للمستخدم رغم أن الطلبين منفصلان في الشبكة)؛ "متوسط التكلفة" لـITEM-DEMO-1 لا يتغير؛ "القيمة الإجمالية" الكلية (مجموع كل الصفوف في أرصدة المخزون) لا تتغير — القيمة انتقلت بين مستودعين فقط، لم تخرج من الشركة.

#### INV-114 — Cancel discards draft
- **Steps:** افتح "تحويل جديد"، عبّئ بعض الحقول، اضغط "إلغاء".
- **Assert:** لا طلب شبكة يُرسل؛ العودة لقائمة التحويلات بلا تغيير.

#### INV-115 — Confirmed transfer detail: cannot-cancel notice
- **Steps:** افتح TRF-DEMO-1.
- **Assert:** نص "لا يمكن إلغاء تحويل مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً بالاتجاه المعاكس."

#### INV-116 — Detail: lines tab only — `[NOT IMPLEMENTED]`
- **Steps:** افتح تفاصيل أي تحويل.
- **Assert:** تبويب واحد فقط "البنود"؛ لا تبويبي "المرفقات" أو "سجل التدقيق" كما يصف الكتالوج.

#### INV-117 — Detail: status stepper
- **Steps:** لاحظ شريط الحالة أعلى التفاصيل.
- **Assert:** خطوتان: "مسودة" ← "مؤكد"؛ للتحويلات المؤكدة تظهر الخطوة الثانية مكتملة.

#### INV-118 — `[NOT IMPLEMENTED]` no Excel import
- **Steps:** ابحث عن زر "استيراد من إكسل" في نموذج الإنشاء كما يصف الكتالوج.
- **Assert:** غير موجود.

#### INV-119 — Empty search / no results
- **Steps:** ابحث برقم غير موجود.
- **Assert:** حالة فارغة "لا توجد تحويلات مطابقة".

---

## 7. تسويات المخزون (Stock Adjustments)

Same one-click create+confirm pattern as Transfers: زر "اعتماد التسوية" ينفّذ الإنشاء
والتأكيد معاً؛ لا مرحلة مسودة مرئية، ولا زر تأكيد منفصل.

#### INV-120 — Header stats
- **Pre:** 6 تسويات مزروعة، كلها مؤكدة.
- **Steps:** افتح المخزون ← تسويات المخزون.
- **Assert:** "إجمالي التسويات" = 6، "مسودة" = 0، "مؤكد" = 6.

#### INV-121 — Reason picker: all 8 cards
- **Steps:** اضغط "تسوية جديدة".
- **Assert:** 8 بطاقات بالترتيب: رصيد افتتاحي، تصحيح جرد، تلف، سرقة، انتهاء صلاحية، نقص / فقدان، مرتجع للمورد، أخرى — كل بطاقة بوصف سطر واحد مطابق تماماً لـ`ADJUSTMENT_REASON_DEFINITIONS` (`packages/domain/src/inventory/reasons.ts`).

#### INV-122 — Reason "رصيد افتتاحي" → IN-only form
- **Steps:** اختر "رصيد افتتاحي".
- **Assert:** عنوان الصفحة يتحول "الرصيد الافتتاحي"؛ لا عمود "الاتجاه" في جدول البنود (الاتجاه IN ثابت)؛ حقل "سعر التكلفة" مفعّل (مطلوب لأي سطر IN).

#### INV-123 — Reason "تلف" → OUT-only form
- **Steps:** اختر "تلف".
- **Assert:** لا عمود "الاتجاه"؛ حقل "سعر التكلفة" معطّل تلقائياً (الاتجاه OUT ثابت، والتكلفة تُحسب من متوسط التكلفة الحالي لا تُدخل يدوياً).

#### INV-124 — Reason "تصحيح جرد" → EITHER, direction picker per line
- **Steps:** اختر "تصحيح جرد".
- **Assert:** يظهر عمود "الاتجاه" لكل سطر (زيادة/نقصان)؛ اختيار "نقصان" يعطّل حقل سعر التكلفة لذلك السطر، واختيار "زيادة" يفعّله ويطلبه.

#### INV-125 — Line validation: qty must be > 0
- **Steps:** اترك "الكمية" = 0 لسطر، لاحظ "اعتماد التسوية".
- **Assert:** الزر معطّل.

#### INV-126 — Line validation: IN direction requires unit cost > 0
- **Steps:** في تسوية "أخرى"، اختر اتجاه "زيادة"، اترك "سعر التكلفة" = 0.
- **Assert:** "اعتماد التسوية" معطّل حتى يُدخل سعر موجب.

#### INV-127 — Add / remove line, minimum one line
- **Steps:** أضف سطرين، احذف واحداً، حاول حذف السطر الأخير المتبقي.
- **Assert:** لا يمكن حذف آخر سطر.

#### INV-128 — Effects panel text — direction-dependent
- **Steps:** أنشئ تسوية بسطر واحد اتجاهه "زيادة"، لاحظ بطاقة "تأثيرات هذه التسوية".
- **Assert:** "ارتفعت قيمة المخزون حسب بنود التسوية"؛ لو كان الاتجاه "نقصان" يظهر "انخفضت قيمة المخزون..." بدلاً منها. في الحالتين: "لا تأثير على المورد أو العميل" و"ينشئ قيداً محاسبياً موازناً عند وجود فرق قيمة" (**هذا السطر الثالث مضلل لغير INITIAL_STOCK — راجع INV-133**).

#### INV-129 — Opening balance full round-trip + GL check (D2's positive case)
- **Steps:** أنشئ تسوية "رصيد افتتاحي" لصنف جديد أو موجود، مستودع WH-MAIN، كمية 50، سعر تكلفة 20، اضغط "اعتماد التسوية"، افتح التفاصيل ← تبويب "المحاسبة".
- **Assert:** التسوية تظهر مؤكدة فوراً؛ تبويب "المحاسبة" يعرض قيداً بمدين "المخزون — 1200" 1000.00 ودائن "رأس مال الملاك — 3100" 1000.00 (50 × 20).

#### INV-130 — Existing DAMAGE adjustment: GL tab shows D2-pattern gap
- **Pre:** ADJ-DEMO-2 (DAMAGE, OUT 6× ITEM-DEMO-2).
- **Steps:** افتح ADJ-DEMO-2 ← تبويب "المحاسبة".
- **Assert:** "لا يوجد قيد محاسبي لهذه التسوية (لا يوجد فرق قيمة)." — رغم أن التسوية غيّرت الكمية والقيمة فعلياً. هذا نفس آلية D2 (`adjustmentGlAccountsForReason` تُرجع `null` لأي سبب غير `INITIAL_STOCK`)، وليس حالة استثنائية.

#### INV-131 — Existing OTHER adjustment: same gap
- **Pre:** ADJ-DEMO-3 (OTHER, IN 18× ITEM-DEMO-3 @ 31).
- **Steps:** افتح تبويب "المحاسبة".
- **Assert:** نفس رسالة "لا يوجد قيد محاسبي..." رغم أن هذه تسوية IN بقيمة موجبة واضحة (18 × 31 = 558.00) ظاهرة في تبويب "بنود التسوية".

#### INV-132 — Existing EXPIRY adjustment: same gap
- **Pre:** ADJ-DEMO-4 (EXPIRY, OUT 20× ITEM-DEMO-8).
- **Steps:** افتح تبويب "المحاسبة".
- **Assert:** نفس الرسالة.

#### INV-133 — PHYSICAL_COUNT-generated adjustments: D2 itself
- **Pre:** ADJ-DEMO-5 وADJ-DEMO-6 (مولّدتان من PC-DEMO-1/PC-DEMO-2 على نفس الصنف بنفس الكمية باتجاهين متعاكسين).
- **Steps:** افتح كل تسوية على حدة ← تبويب "المحاسبة".
- **Assert:** كلتاهما "لا يوجد قيد محاسبي..." — هذا هو D2 حرفياً. لاحظ أن صافي قيمتهما معاً = صفر بسبب تصميم البيانات المزروعة (نفس الصنف، نفس الكمية، اتجاه معاكس) — **هذا لا يثبت أن المسار آمن**، فقط أن البيانات المزروعة تتجنبه. أنشئ تسوية PHYSICAL_COUNT بقيمة صافية غير صفرية (وليس عبر شاشة الجرد الفعلي، بل مباشرة من "تسوية جديدة" ← "تصحيح جرد") لإثبات أن الفجوة تدفع مخزون فرعي غير متطابق مع حساب 1200 لأي مبلغ غير صفري.

#### INV-134 — Bench: lines tab shows before/change/after — `[partial vs. catalog]`
- **Steps:** افتح أي تسوية ← تبويب "بنود التسوية".
- **Assert:** الأعمدة الفعلية: الصنف، الاتجاه، الكمية، سعر التكلفة، القيمة. **`[NOT IMPLEMENTED]`**: لا عمودي "قبل" و"بعد" الكمية كما يصف الكتالوج — فقط الكمية المتحركة نفسها، لا الرصيد قبل/بعد.

#### INV-135 — Confirmed-adjustment cannot-cancel notice
- **Steps:** افتح أي تسوية مؤكدة.
- **Assert:** نص "لا يمكن إلغاء تسوية مؤكدة — ... لعكس الأثر، أنشئ تسوية جديدة بالاتجاه المعاكس."

#### INV-136 — Detail: only 2 tabs — `[NOT IMPLEMENTED]`
- **Assert:** لا تبويبي "المرفقات" أو "سجل التدقيق" كما يصف الكتالوج — فقط "بنود التسوية" و"المحاسبة".

#### INV-137 — `[NOT IMPLEMENTED]` no opening-balance shortcut from Items
- **Steps:** ابحث في شاشة الأصناف عن زر "تحديد الرصيد الافتتاحي" على صف صنف برصيد صفري كما يصف الكتالوج.
- **Assert:** غير موجود (راجع INV-048) — المسار الوحيد لرصيد افتتاحي هو بطاقة "رصيد افتتاحي" في منتقي الأسباب مباشرة.

#### INV-138 — Warehouse / reason filters
- **Steps:** لاحظ عمود "المستودع / السبب" لكل صف، ابحث برقم التسوية.
- **Assert:** كل صف يعرض "اسم المستودع — تسمية السبب"، مثال "مستودع الفرع الرئيسي — تلف".

#### INV-139 — Cancel discards draft
- **Steps:** ادخل منتقي الأسباب، اختر سبباً، عبّئ سطراً، اضغط "رجوع" ثم "إلغاء".
- **Assert:** لا طلب شبكة؛ العودة لقائمة التسويات.

---

## 8. الجرد الفعلي (Physical Counts)

Fully implemented — the catalog's read-only pass never reached a filled session; this
build's is real end-to-end.

#### INV-140 — Header stats
- **Pre:** PC-DEMO-1/2 مكتملتان بتسوية مولّدة، PC-DEMO-3 قيد التنفيذ.
- **Steps:** افتح المخزون ← الجرد الفعلي.
- **Assert:** "إجمالي عمليات الجرد" = 3، "قيد التنفيذ" = 1، "مكتمل" = 0 (كلتا PC-DEMO-1/2 انتقلتا لحالة "تم إنشاء التسوية" وليس "مكتمل" بعد توليد التسوية)، "تم إنشاء التسوية" = 2.

#### INV-141 — Status chip "تم إنشاء التسوية"
- **Steps:** اضغط الشريحة.
- **Assert:** صفان (PC-DEMO-1/2).

#### INV-142 — Variance column shows "جرد أعمى" for blind, in-progress session
- **Pre:** PC-DEMO-3 (أعمى، قيد التنفيذ).
- **Steps:** لاحظ عمود "صافي قيمة الفرق" لصف PC-DEMO-3.
- **Assert:** نص "جرد أعمى" بدل أي رقم — لا فرق محسوب أو ظاهر قبل الإنهاء.

#### INV-143 — New count dialog: warehouse required, item count preview
- **Steps:** اضغط "جرد جديد"، اختر مستودعاً.
- **Assert:** نص "سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية (N صنف)." يتحدث حسب عدد الأصناف ذات رصيد ≠ صفر في ذلك المستودع؛ زر "إضافة" معطّل إن كان N = 0.

#### INV-144 — Blind toggle hint text
- **Steps:** فعّل مفتاح "جرد أعمى".
- **Assert:** نص التلميح: "يُخفي كميات النظام عن القائم بالجرد حتى إنهاء الجلسة — الرصيد يُلتقط عند الفتح في الحالتين."

#### INV-145 — Blind counting genuinely hides system quantity — positive proof
- **Pre:** PC-DEMO-3 (أعمى، قيد التنفيذ، سطر ITEM-DEMO-3 لم يُعدّ بعد).
- **Steps:** افتح PC-DEMO-3 (زر "متابعة الجرد" من تفاصيلها، أو مباشرة إن كانت الجلسة النشطة).
- **Assert:** بانر "جرد أعمى — كميات النظام والفروقات مخفية حتى إنهاء الجرد."؛ عمودا "النظام" و"الفرق" **غير موجودين إطلاقاً** في الجدول (لا يُعرضان مموّهين — العمود نفسه غير مُصيَّر عند `blindOpen`)؛ العمود الوحيد الظاهر بجانب الصنف هو "المعدود". هذا يثبت أن الميزة تعمل كما ينبغي — لو ظهر أي رقم نظام هنا، فتلك هي الميزة وهي تفشل.

#### INV-146 — Blind count: counted input starts blank/zero, not pre-biased
- **Steps:** لاحظ القيمة الابتدائية لحقل "المعدود" لسطر لم يُعدّ بعد ضمن PC-DEMO-3.
- **Assert:** القيمة الابتدائية "0" (`count.blind ? "0" : systemQty`) — لا تحيّز نحو رقم النظام، خلافاً لجلسة غير عمياء (راجع INV-147).

#### INV-147 — Non-blind count: counted input pre-filled with system qty — worth flagging
- **Pre:** أنشئ جرداً غير أعمى جديداً.
- **Steps:** ابدأ الجرد، لاحظ القيمة الابتدائية لحقل "المعدود" لأي سطر.
- **Assert:** الحقل معبأ مسبقاً بكمية النظام نفسها (`l.systemQty`) — القائم بالجرد يرى الرقم المتوقع منذ اللحظة الأولى حتى في جرد "ظاهر" عادي؛ هذا سلوك مقصود لغير الأعمى لكنه يستحق الإشارة له كفرق تصميم واضح عن الجرد الأعمى.

#### INV-148 — "إنهاء الجرد" disabled until every line has a valid quantity
- **Pre:** PC-DEMO-3، سطر ITEM-DEMO-3 فارغ.
- **Steps:** لاحظ زر "إنهاء الجرد".
- **Assert:** معطّل (`!allCounted`) حتى تُدخل قيمة رقمية صالحة لكل سطر، بما فيها ITEM-DEMO-3.

#### INV-149 — "حفظ ومتابعة لاحقاً" pauses without completing
- **Steps:** أدخل بعض القيم في جلسة جرد نشطة، اضغط "حفظ ومتابعة لاحقاً".
- **Assert:** يعود لقائمة الجرد؛ حالة الجرد تبقى "قيد التنفيذ"؛ القيم المُدخلة **لا تُحفظ للخادم** (لا استدعاء `recordPhysicalCounts` عند هذا الزر — فقط `onDone()` محلي) — عند العودة لاحقاً عبر "متابعة الجرد" تُعاد تعبئة الحقول من قيم النظام/الفارغة الأصلية، وليس مما كُتب سابقاً. سجّل هذا كخلل محتمل عند التنفيذ (فقدان تقدّم الجرد الجزئي).

#### INV-150 — Complete a fresh (non-blind) count end to end
- **Pre:** جرد جديد على WH-MAIN لأصناف معروفة الكمية.
- **Steps:** أدخل كميات معدودة تختلف عن كمية النظام لسطر واحد على الأقل (زيادة 3 وحدات)، اضغط "إنهاء الجرد".
- **Assert:** الحالة تتحول "مكتمل"؛ التفاصيل تعرض "أصناف بها فروقات" ≥ 1، "قيمة الزيادة" > 0، "صافي قيمة الفرق" موجب.

#### INV-151 — Generate adjustment from a completed count
- **Pre:** من INV-150 (الحالة "مكتمل").
- **Steps:** من تفاصيل الجرد، اضغط "توليد تسوية".
- **Assert:** الحالة تتحول "تم إنشاء التسوية"؛ حقل "التسوية الناتجة" يتحول من "—" إلى "تم إنشاؤها"؛ التسوية الجديدة تظهر في شاشة تسويات المخزون بسبب "تصحيح جرد"، وتبويب "المحاسبة" لها يعرض نفس فجوة D2 (لا قيد) إن كانت قيمتها الصافية غير صفرية — راجع INV-133.

#### INV-152 — PC-DEMO-1 / PC-DEMO-2 concrete cross-warehouse variance
- **Pre:** PC-DEMO-1 (الرئيسي) أنقص ITEM-DEMO-2 بمقدار 4 عن النظام؛ PC-DEMO-2 (الجيزة) أزاد نفس الصنف بنفس المقدار.
- **Steps:** افتح تفاصيل PC-DEMO-1 ثم PC-DEMO-2.
- **Assert:** PC-DEMO-1: "قيمة العجز" > 0، "صافي قيمة الفرق" سالب. PC-DEMO-2: "قيمة الزيادة" > 0، "صافي قيمة الفرق" موجب، بنفس القيمة المطلقة تقريباً (نفس الصنف، نفس الكمية، ومتوسط تكلفة الجيزة يساوي متوسط تكلفة الرئيسي وقت الجرد لأن كل مخزون الجيزة من هذا الصنف جاء من TRF-DEMO-1 بلا إعادة توسيط منذ ذلك الحين).

#### INV-153 — Resume an in-progress count from detail
- **Pre:** PC-DEMO-3 (قيد التنفيذ).
- **Steps:** افتح تفاصيل PC-DEMO-3، اضغط "متابعة الجرد".
- **Assert:** يعود لشاشة إدخال الجرد بنفس القيم المسجلة (ITEM-DEMO-7/8 المعدودتان مسبقاً، ITEM-DEMO-3 فارغة).

#### INV-154 — Cancel/empty search
- **Steps:** ابحث برقم جرد غير موجود.
- **Assert:** حالة فارغة (النص الفعلي هو رسالة الخطأ إن فشل الطلب، أو "لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام" إن كانت القائمة فارغة أصلاً؛ هنا فقط لا نتائج بحث فتُستخدم قائمة `filtered` الفارغة بنفس مكوّن الحالة الفارغة).

#### INV-155 — Warehouse filter / date range — `[NOT IMPLEMENTED]`
- **Assert:** لا فلتر مستودع ولا نطاق تاريخ في هذه الشاشة رغم أن الكتالوج يذكرهما ("Filters: المستودع، من/إلى تاريخ") — فقط شرائح الحالة والبحث بالرقم.

---

## 9. طباعة الملصقات (Label Printing)

Stateless single-page builder; barcode rendering verified real (Code128 SVG via
`bwip-js`), not placeholder text.

#### INV-156 — Disclaimer banner
- **Steps:** افتح المخزون ← طباعة الملصقات.
- **Assert:** "السعر المطبوع هو السعر الفعلي الذي تحسبه نقطة البيع للعميل العادي (بعد قوائم الأسعار والشرائح). الطباعة لا تغير أي سعر."

#### INV-157 — `[NOT IMPLEMENTED]` no item/document mode toggle
- **Steps:** ابحث عن مبدّل "صنف / مستند" كما يصف الكتالوج.
- **Assert:** غير موجود — الشاشة في وضع "صنف" فقط دائماً.

#### INV-158 — Add item populates table row from live item data
- **Steps:** ابحث عن "أرز أبيض" في "إضافة صنف"، اخترها.
- **Assert:** سطر جديد بالاسم/الكود/الباركود (`item.barcodes[0] ?? item.code`، هنا الكود "IT-0001" لأن الصنف بلا باركود مسجل)/السعر المطبوع (سعر البيع الحالي 180.00)/عدد النسخ = 1 افتراضياً.

#### INV-159 — Already-added items excluded from picker
- **Pre:** من INV-158.
- **Steps:** افتح "إضافة صنف" مجدداً.
- **Assert:** "أرز أبيض ٥ كجم" لم تعد ضمن الخيارات.

#### INV-160 — Copies QtyInput bounds
- **Steps:** غيّر "عدد النسخ" لسطر إلى 0 ثم 1000.
- **Assert:** الحقل يفرض `min=1, max=999` — لا يقبل قيمة أقل من 1 ولا أكبر من 999.

#### INV-161 — Remove line
- **Steps:** اضغط "إزالة" على سطر.
- **Assert:** يختفي من الجدول؛ الإجمالي "N ملصق" يتحدث.

#### INV-162 — Template dropdown default + switch
- **Steps:** لاحظ "قالب الملصق" الافتراضي، ثم غيّره.
- **Assert:** الخيارات الثلاثة بنصها الحرفي: "ملصق حراري — 40×30mm" (افتراضي)، "ملصق رف — 50×25mm"، "ملصق منتج — 100×50mm"؛ تغيير القالب يعيد رسم "معاينة الملصق" بأبعاد جديدة فوراً.

#### INV-163 — Barcode-too-long warning appears and clears
- **Pre:** أضف باركوداً طويلاً (25+ خانة) لصنف عبر شاشة الأصناف أولاً (راجع INV-028)، مثال `1234567890123456789012345`.
- **Steps:** في طباعة الملصقات، أضف ذلك الصنف مع القالب الافتراضي "ملصق حراري — 40×30mm" (العرض 40mm؛ الحد الأقصى لعدد خانات باركود يناسبه ≈ 22 خانة عند 1.5mm/خانة + هامش 6mm).
- **Assert:** تحذير أحمر تحت قيمة الباركود بنص "الباركود لا يناسب هذا القالب"؛ زر "معاينة وطباعة" معطّل (`hasBlockingIssues`).

#### INV-164 — Switching to a bigger template clears the warning
- **Pre:** من INV-163.
- **Steps:** غيّر القالب إلى "ملصق منتج — 100×50mm" (العرض 100mm يستوعب حتى ≈62 خانة).
- **Assert:** التحذير يختفي؛ "معاينة وطباعة" يصبح مفعّلاً (إن لم يوجد سطر آخر معطِّل).

#### INV-165 — Print button disabled with zero items
- **Steps:** أزل كل الأصناف من الجدول.
- **Assert:** "معاينة وطباعة" معطّل؛ صف الجدول يعرض "لم تتم إضافة أي صنف بعد."

#### INV-166 — Running total sums copies across lines
- **Steps:** أضف صنفين بعدد نسخ 3 و5.
- **Assert:** "الإجمالي: 8 ملصق".

#### INV-167 — Live preview renders real Code128 SVG barcode
- **Pre:** صنف بباركود صالح مضاف للجدول.
- **Steps:** لاحظ لوحة "معاينة الملصق" أسفل الصفحة.
- **Assert:** بلاطة المعاينة تحتوي عنصر SVG حقيقي مُدرج عبر `bwip-js` (`bcid: "code128"`) — وليس نصاً بديلاً أو صورة ثابتة؛ يمكن مسحه ضوئياً بقارئ Code 128 حقيقي. يظهر اسم الصنف فوقه (مقصوص RTL) والكود والسعر أسفله.

#### INV-168 — Preview shows at most 6 tiles
- **Steps:** أضف 8 أصناف.
- **Assert:** لوحة المعاينة تعرض أول 6 فقط (`lines.slice(0, 6)`)؛ ورقة الطباعة الفعلية (`.mz-print-sheet`, مخفية إلا عند الطباعة) تحتوي كل النسخ من كل الأصناف الثمانية.

#### INV-169 — Print triggers real `window.print()`
- **Steps:** مع سطر واحد صالح، اضغط "معاينة وطباعة".
- **Assert:** يُستدعى `window.print()` مباشرة — لا خطوة "معاينة" منفصلة رغم اسم الزر؛ `@page` تُضبط ديناميكياً بأبعاد القالب المختار (مم).

---

## 10. هبوط قيمة المخزون (Writedown Runs)

`[NOT IN CATALOG]` — build-only feature. Monthly batch: Dr 5060 (مصروف هبوط القيمة) /
Cr 1190 (مخصص هبوط — عكس أصل)، منفصل تماماً عن حساب المخزون 1200 ولا يمسّ متوسط
التكلفة المسجل.

#### INV-170 — Header stats + existing posted run
- **Pre:** عملية واحدة مزروعة، فترة `2026-08`، مرحّلة.
- **Steps:** افتح المخزون ← هبوط قيمة المخزون.
- **Assert:** "إجمالي العمليات" = 1، "مسودة" = 0، "مرحل" = 1.

#### INV-171 — Status chip "مرحل"
- **Steps:** اضغط الشريحة.
- **Assert:** الصف الوحيد يظهر.

#### INV-172 — Detail: period, warehouse, total, journal link
- **Steps:** افتح الصف المرحّل.
- **Assert:** "الفترة" = 2026-08، "المستودع" = "كل المستودعات" (لم يُحدَّد مستودع عند الإنشاء)، "تاريخ الترحيل" ≠ "—"، "قيد اليومية" يظهر معرّفاً حقيقياً.

#### INV-173 — Detail line table shows raw item id — `[NOT IMPLEMENTED gap]`
- **Steps:** لاحظ عمود "الصنف" في جدول "تفاصيل البنود".
- **Assert:** يعرض `itemId` الخام (مثال "ITEM-DEMO-6") **وليس** اسم الصنف بالعربية — لا استدعاء لخريطة تسمية هنا، خلافاً لكل شاشة أخرى في هذا الملف.

#### INV-174 — Detail line: aging days and rate for ITEM-DEMO-6
- **Pre:** ITEM-DEMO-6 استُلم 2026-02-15، تجاوز عتبة 180 يوماً بحلول أغسطس 2026 ولم يتحرك منذ ذلك الحين.
- **Steps:** لاحظ سطر ITEM-DEMO-6.
- **Assert:** "أيام التقادم" > 180؛ "نسبة المخصص" > 0%؛ "المبلغ" > 0.

#### INV-175 — Create: year/month bounds validation
- **Steps:** اضغط "تشغيل عملية جديدة"، اكتب سنة خارج 2000–2100 (مثال 1999)، اضغط "تشغيل".
- **Assert:** خطأ "السنة غير صحيحة."

#### INV-176 — Create: month bounds validation
- **Steps:** اكتب شهراً = 13.
- **Assert:** خطأ "الشهر يجب أن يكون بين 1 و12."

#### INV-177 — Create: defaults to current period
- **Steps:** افتح "تشغيل عملية جديدة" دون تعديل.
- **Assert:** السنة/الشهر معبآن تلقائياً بالسنة/الشهر الحاليين.

#### INV-178 — Create: warehouse optional, defaults "كل المستودعات"
- **Steps:** لاحظ حقل "المستودع".
- **Assert:** الخيار الافتراضي "كل المستودعات"؛ يمكن تحديد مستودع واحد صراحة.

#### INV-179 — Create a new draft run for a different period + reload
- **Steps:** أنشئ عملية لفترة `2026-07` (شهر لم يُشغَّل بعد)، احفظ ("تشغيل")، أعد تحميل الصفحة.
- **Assert:** صف جديد بحالة "مسودة"؛ "إجمالي العمليات" = 2، "مسودة" = 1.

#### INV-180 — Post a draft run — per-row pending state
- **Pre:** من INV-179 (مسودة موجودة).
- **Steps:** اضغط "ترحيل" على صف المسودة الجديدة فقط.
- **Assert:** أثناء التنفيذ يظهر النص "جارٍ الترحيل..." **على هذا الصف فقط** — لا تعطيل لبقية الصفوف (نمط pending صحيح لكل عنصر على حدة)؛ بعد النجاح تتحول الحالة "مرحل" ويظهر معرّف قيد اليومية بدل زر "ترحيل".

#### INV-181 — Post error surfaces without disabling other rows
- **Pre:** حاكِ فشل `POST .../post`.
- **Steps:** اضغط "ترحيل" على صف مسودة.
- **Assert:** بطاقة خطأ منفصلة أعلى القائمة (`postError`)؛ الصف يعود لحالة قابلة لإعادة المحاولة (`postingId` يُصفَّر في `finally`)؛ صفوف أخرى غير متأثرة.

#### INV-182 — Empty state
- **Pre:** حاكِ تينانت بلا أي عملية.
- **Steps:** افتح الشاشة.
- **Assert:** "لا توجد عمليات هبوط قيمة — لم يتم تشغيل أي عملية بعد".

#### INV-183 — Reconciliation note: write-down never touches 1200/WAC
- **Steps:** لاحظ وصف الشاشة أسفل العنوان.
- **Assert:** "...تُنشئ مخصصاً محاسبياً (مدين مصروف / دائن مخصص هبوط) للأصناف بطيئة الحركة — دون المساس بتكلفة المخزون المسجلة." — أي أن هذه العملية لا يجب أن تُحدث أي فرق في مطابقة حساب المخزون 1200 (تذهب لحسابي 5060/1190 بدلاً منه)؛ تحقق من أرصدة المخزون لـITEM-DEMO-6 قبل وبعد ترحيل العملية المزروعة — "متوسط التكلفة" و"القيمة الإجمالية" في شاشة أرصدة المخزون يجب ألا يتغيرا بسبب هذه العملية.

---

## 11. أوامر التصنيع (Work Orders)

Row click opens the WO's own detail directly (fixes the catalog's documented "clicking
opens the item, not the WO" outlier). No kebab menu anywhere — so catalog actions
(تكرار/إلغاء أمر التصنيع) have **no button to click** in this build.

#### INV-184 — KPI strip and status chips
- **Pre:** WO-DEMO-1 (مخطط)، WO-DEMO-2 (قيد التنفيذ، بدأ)، WO-DEMO-3 (ملغي).
- **Steps:** افتح التصنيع ← أوامر التصنيع.
- **Assert:** "الإجمالي" = 3، "مخطط" = 1، "جار التنفيذ" = 1، "مكتمل هذا الشهر" = 0. شرائح الحالة: الكل/مخطط/قيد التنفيذ/مكتمل/ملغي — **`[NOT IMPLEMENTED]`** لا شريحة "متأخر" منفصلة (فقط بانر عددي).

#### INV-185 — Overdue banner
- **Pre:** أي أمر بتاريخ انتهاء مجدول ماضٍ وحالة غير مكتملة/ملغاة.
- **Steps:** لاحظ بانر "تحتاج متابعة" أعلى القائمة.
- **Assert:** يعرض عدد الأوامر المتأخرة الفعلي.

#### INV-186 — Search by number or product name
- **Steps:** ابحث "WO-DEMO-2".
- **Assert:** صف واحد.

#### INV-187 — `[NOT IMPLEMENTED]` filters panel
- **Steps:** ابحث عن "تصفية النتائج" (مستودع/أولوية/منتج نهائي/نطاق كمية/نطاق تاريخ) كما يصف الكتالوج.
- **Assert:** غير موجود — فقط شرائح الحالة والبحث النصي.

#### INV-188 — Row click opens WO detail (not item)
- **Steps:** اضغط على أي صف.
- **Assert:** تفتح صفحة تفاصيل أمر التصنيع نفسه مباشرة (`أمر تصنيع WO-000x`) — لا لوحة صنف جانبية.

#### INV-189 — Create: BOM picker only shows active BOMs
- **Steps:** اضغط "أمر عمل جديد"، افتح "قائمة المواد *".
- **Assert:** فقط قوائم المواد النشطة تظهر.

#### INV-190 — Create: required fields gate save
- **Steps:** اترك "مستودع الخامات" أو "مستودع المنتجات" فارغاً، لاحظ "حفظ أمر العمل".
- **Assert:** معطّل حتى تُملأ قائمة المواد + كلا المستودعين + كمية > 0.

#### INV-191 — Create: same warehouse both sides — no rejection (gap)
- **Steps:** اختر نفس المستودع لـ"مستودع الخامات" و"مستودع المنتجات".
- **Assert (expected):** رفض مشابه لتحويلات المخزون. **الفعلي:** لا فحص من هذا النوع في `canSave` — يُقبل بلا تنبيه.

#### INV-192 — Create: planned qty min 0, no required asterisk despite being required
- **Steps:** لاحظ تسمية "الكمية المخططة" (بلا `*` رغم أن `canSave` يتطلبها > 0).
- **Assert:** غياب النجمة تناقض بصري صغير مع القاعدة الفعلية — سجّله كملاحظة اتساق.

#### INV-193 — Create: date fields are free text, no format validation
- **Steps:** اكتب نصاً عشوائياً (مثال "غداً") في "تاريخ البدء المجدول".
- **Assert (expected):** رفض أو تنسيق تلقائي. **الفعلي:** حقل نصي حر بلا أي تحقق من الصيغة — يُقبل أي نص ويُرسل كما هو.

#### INV-194 — Full create + reload
- **Steps:** أنشئ أمر تصنيع جديداً على BOM-DEMO-1، كمية 5، مستودعا خامات/منتجات مختلفين، احفظ، أعد تحميل الصفحة.
- **Assert:** يظهر في القائمة بحالة "مخطط"، الكمية المخططة 5، المنتج النهائي = اسم ITEM-DEMO-5.

#### INV-195 — Cancel discards draft
- **Steps:** افتح النموذج، عبّئ حقولاً، اضغط "إلغاء".
- **Assert:** لا طلب شبكة.

#### INV-196 — Detail: effects copy contradicts D3
- **Steps:** افتح أي أمر تصنيع ← لاحظ قسم "تأثيرات أمر التصنيع".
- **Assert:** السطر الأخير يقرأ: "المنتج النهائي لا يدخل المخزون إلا عند الاستلام؛ وعند الإكمال تُرحَّل قيود رسملة الإنتاج تحت التشغيل تلقائياً." — هذا **خطأ** وفق D3 (`completeWorkOrder` لا يلمس حساب 1200 إطلاقاً). النص نفسه يوثّق سلوكاً غير موجود.

#### INV-197 — Detail: summary omits scheduled end date / BOM version — gap
- **Steps:** لاحظ حقول الملخص أعلى صفحة التفاصيل.
- **Assert:** لا حقل "تاريخ الانتهاء المجدول" ولا "قائمة المواد (الإصدار)" في الملخص، رغم أنهما مُدخلان وقت الإنشاء وموصوفان في الكتالوج.

#### INV-198 — Detail: only 2 tabs — `[NOT IMPLEMENTED]`
- **Steps:** لاحظ التبويبات.
- **Assert:** فقط "المواد" و"التكاليف". لا "استخدام المواد"، "حركة المواد"، "الاستلامات"، "القيود المحاسبية"، "السجل" كما يصف الكتالوج — **لا توجد أي طريقة من هذه الشاشة لرؤية القيود المحاسبية التي أنشأها أمر التصنيع فعلياً**.

#### INV-199 — Materials tab columns
- **Steps:** افتح تبويب "المواد" لأمر بدأ صرف مواده.
- **Assert:** الأعمدة: الصنف، المطلوبة، الصادرة، المرجعة، الصافي — **`[NOT IMPLEMENTED]`**: لا عمودي "الكمية المتاحة" أو "النقص" كما يصف الكتالوج.

#### INV-200 — Stage 1: بدء العمل (single click, no dialog)
- **Pre:** WO-DEMO-1 (مخطط، لم يبدأ).
- **Steps:** افتح WO-DEMO-1، اضغط الزر الأساسي "بدء العمل" في رأس الصفحة.
- **Assert:** المرحلة تتحول "بدء العمل"؛ نص زر الإجراء يتغير فوراً إلى "صرف المواد"؛ لا حوار تأكيد ولا حقل إدخال.

#### INV-201 — Stage 2: صرف المواد (single click, opaque full-qty issue)
- **Pre:** من INV-200.
- **Steps:** اضغط "صرف المواد".
- **Assert:** يصرف كامل الكمية المطلوبة دفعة واحدة (لا حقل كمية جزئية)؛ نص الزر يتحول "استلام المنتج"؛ عمود "الصادرة" في تبويب المواد يتحدث.

#### INV-202 — Stage 3: استلام المنتج opens a side panel
- **Pre:** من INV-201.
- **Steps:** اضغط "استلام المنتج".
- **Assert:** تفتح لوحة "استلام المنتج" بحقل "الكمية المنتجة" معبأ مسبقاً بالكمية المخططة كاملة؛ اضغط "تأكيد الاستلام".
- **Assert (after):** المرحلة تتحول "استلام المنتج"؛ زر رأس الصفحة يتحول "إكمال أمر العمل".

#### INV-203 — Receive panel: qty must be > 0
- **Pre:** لوحة "استلام المنتج" مفتوحة.
- **Steps:** اضبط "الكمية المنتجة" = 0.
- **Assert:** "تأكيد الاستلام" معطّل.

#### INV-204 — Receive panel: cancel
- **Steps:** افتح اللوحة، اضغط "إلغاء".
- **Assert:** اللوحة تُغلق؛ المرحلة تبقى دون تغيير.

#### INV-205 — Cancelled work order shows no action button
- **Pre:** WO-DEMO-3 (ملغي).
- **Steps:** افتح تفاصيله.
- **Assert:** شريط الحالة يظهر بلون تحذيري ("danger")؛ لا يظهر أي زر إجراء أساسي في الرأس (`order.status !== "cancelled"` شرط لعرضه).

#### INV-206 — Stage 4: إكمال أمر العمل — **D3, throwaway DB only**
- **Pre:** ⚠️ **نفّذ هذا السيناريو فقط على قاعدة بيانات مؤقتة قابلة للحذف، وليس قبل أي سيناريو مطابقة GL 1200.** أمر وصل مرحلة "استلام المنتج" (مثال: أكمل WO-DEMO-1 عبر INV-200→INV-202، أو استخدم WO-DEMO-2 بعد صرف مواده).
- **Steps:** اضغط "إكمال أمر العمل" في رأس صفحة التفاصيل.
- **Assert:** نقرة واحدة، بلا حوار تأكيد وبلا أي حقل إدخال؛ المرحلة تتحول "مكتمل". **هذا يُفعِّل D3** — `completeWorkOrder` لا يرحّل أي قيد على حساب 1200 رغم أن كمية الكلفة تحت التشغيل (`قيمة الإنتاج تحت التشغيل` في الملخص) تُصفَّر ظاهرياً؛ أي مطابقة لاحقة بين المخزون الفرعي وحساب 1200 ستنحرف بمقدار قيمة هذا الأمر (قِس بمقارنة "القيمة الإجمالية" الكلية في أرصدة المخزون قبل/بعد — مرجع القياس السابق في defects.md: BOM-DEMO-1 بكمية 10 ينحرف بمقدار 80.00).

#### INV-207 — Silent error on advance actions outside the receive panel — gap
- **Pre:** حاكِ فشل `POST .../start` أو `.../issue-materials` أو `.../complete`.
- **Steps:** اضغط زر الإجراء الأساسي أثناء الفشل المحاكى.
- **Assert (expected):** رسالة خطأ ظاهرة للمستخدم. **الفعلي:** `advance()` يلتقط الخطأ في حالة داخلية (`actionError`) لكن `WorkOrderDetail` لا يعرض هذه الحالة إطلاقاً خارج لوحة الاستلام — الفشل صامت تماماً من منظور المستخدم على الأزرار الثلاثة الأخرى (بدء/صرف/إكمال).

---

## 12. قوائم المواد (BOMs)

#### INV-208 — KPI strip and chips
- **Pre:** BOM-DEMO-1/2 نشطتان.
- **Steps:** افتح التصنيع ← قوائم المواد.
- **Assert:** "الإجمالي" = 2، "نشط" = 2، "غير نشط" = 0.

#### INV-209 — Search by number or product name
- **Steps:** ابحث "BOM-DEMO-2".
- **Assert:** صف واحد.

#### INV-210 — List cost estimate column
- **Steps:** لاحظ عمود "التكلفة التقديرية" لـBOM-DEMO-1.
- **Assert:** رقم غير صفري (مواد + عمالة 50 + مصاريف 30).

#### INV-211 — Create: product picker auto-fills unit
- **Steps:** اضغط "قائمة مواد جديدة"، اختر "المنتج النهائي".
- **Assert:** حقل "الوحدة" يتحدث تلقائياً لوحدة الصنف الأساسية.

#### INV-212 — Create: cannot save with zero valid material lines
- **Steps:** اترك سطر المواد الوحيد بصنف فارغ، لاحظ "حفظ قائمة المواد".
- **Assert:** معطّل (`canSave` يتطلب سطراً واحداً صالحاً على الأقل).

#### INV-213 — Create: negative labor/overhead cost — native min guard only
- **Steps:** اكتب "-10" في "تكلفة العمالة" (حقل رقمي بـ`min=0`).
- **Assert:** الحقل من نوع `number` بخاصية `min=0` (حماية متصفح بصرية فقط ما لم يُستخدم تحقق فعلي عبر `<form>`)؛ لا فحص JS إضافي في `save()` يمنع قيمة سالبة صراحة إن أُدخلت.

#### INV-214 — Create: waste % has no upper bound — gap
- **Steps:** اكتب "500" في "نسبة الهالك %" لسطر مادة.
- **Assert (expected):** رفض قيمة غير منطقية (> 100%). **الفعلي:** لا سقف أعلى (`min={0}` فقط) — القيمة تُقبل وتُغذّي `effectiveQty = qty × (1 + 500/100)` بلا اعتراض.

#### INV-215 — Material line: cannot remove last remaining line
- **Steps:** أضف سطر مادة ثانياً، احذفه، حاول حذف السطر الأخير المتبقي.
- **Assert:** زر "حذف البند" لا يظهر إلا عند وجود أكثر من سطر واحد.

#### INV-216 — Full create + reload
- **Steps:** أنشئ قائمة مواد جديدة لمنتج ITEM-DEMO-4 (خامتان: ITEM-DEMO-1 كمية 2، ITEM-DEMO-3 كمية 1)، احفظ، أعد تحميل الصفحة.
- **Assert:** تظهر بحالة "نشط"، إصدار v1، عدد بنود = 2.

#### INV-217 — Detail: waste-adjusted quantity column
- **Steps:** افتح BOM-DEMO-1 ← تبويب "بنود المواد الخام".
- **Assert:** عمود "الكمية بعد الهالك" = الكمية × (1 + نسبة الهالك/100) لكل سطر (نسبة الهالك = 0% لسطور BOM-DEMO-1 المزروعة، فتساوي الكمية الأصلية تماماً).

#### INV-218 — Detail: cost breakdown summary
- **Steps:** افتح BOM-DEMO-1 ← الملخص.
- **Assert:** "تكلفة المواد"، "إجمالي التكلفة"، "تكلفة الوحدة" مبنية من `bom.estimate` — تكلفة المواد = مجموع (كمية السطر × تكلفة وحدة الصنف)، إجمالي التكلفة = تكلفة المواد + 50 (عمالة) + 30 (مصاريف).

#### INV-219 — Effects copy — versioning semantics
- **Steps:** لاحظ قسم "تأثيرات" في التفاصيل.
- **Assert:** "قائمة المواد وصفة تصنيع فقط — لا تؤثر على المخزون أو الحسابات حتى يُنشأ أمر تصنيع منها."، "الكمية المطلوبة تُضخَّم تلقائياً بنسبة الهالك..."، "إنشاء إصدار جديد يُلغي تنشيط الإصدار السابق (لا يُعدّله)."

#### INV-220 — Deactivate — no confirmation dialog
- **Pre:** قائمة مواد نشطة غير مستخدمة في أمر تصنيع حالي.
- **Steps:** من التفاصيل، اضغط "تعطيل".
- **Assert:** الحالة تتحول "غير نشط" فوراً، **بلا أي حوار تأكيد** رغم أن قوائم المواد نشطة تُستخدم في إنشاء أوامر تصنيع.

#### INV-221 — `[NOT IMPLEMENTED]` no "أمر عمل جديد" shortcut from BOM detail
- **Steps:** ابحث عن زر "أمر عمل جديد" على صفحة تفاصيل قائمة المواد كما يصف الكتالوج.
- **Assert:** غير موجود — يجب الذهاب لشاشة أوامر التصنيع والبحث عن قائمة المواد يدوياً من هناك.

#### INV-222 — `[NOT IMPLEMENTED]` no "إصدار جديد" versioning action
- **Steps:** ابحث عن أي طريقة لإنشاء إصدار جديد من قائمة مواد موجودة (النص التوضيحي يذكر الإصدارات لكن لا زر لإنشاء واحد).
- **Assert:** غير موجود — `createBom` تُنشئ دائماً قائمة جديدة كاملة، لا مسار "إصدار جديد" من داخل شاشة قائمة مواد قائمة.

#### INV-223 — Detail: single tab only — `[NOT IMPLEMENTED]`
- **Assert:** لا تبويبي "سجل الإصدارات" أو "سجل التدقيق" كما يصف الكتالوج — تبويب واحد فقط "بنود المواد الخام (N)"، وبلا صف تذييل "إجمالي تكلفة المواد" داخل الجدول نفسه.

---

## 13. التصنيع المخصص (Custom Manufacturing / Config Instances)

#### INV-224 — Empty state (no seeded config instances)
- **Steps:** افتح التصنيع ← التصنيع المخصص.
- **Assert:** "لا توجد أوامر تصنيع مخصص — أنشئ أمراً جديداً" — لا أوامر مزروعة (لا يوجد منتج قابل للتهيئة أصلاً في البيانات المزروعة، راجع INV-081).

#### INV-225 — Create: product picker active-only
- **Pre:** أنشئ منتجاً قابلاً للتهيئة أولاً (راجع INV-087).
- **Steps:** اضغط "أمر تصنيع مخصص جديد"، افتح "المنتج *".
- **Assert:** فقط المنتجات القابلة للتهيئة النشطة تظهر.

#### INV-226 — Dynamic spec fields render per product input
- **Pre:** من INV-225، منتج بمدخل واحد "width"/"العرض".
- **Steps:** اختر المنتج.
- **Assert:** يظهر حقل نصي بتسمية "العرض" (أو "العرض (min – max)" إن كانت الحدود معرّفة).

#### INV-227 — Spec fields accept non-numeric text — no validation gap
- **Steps:** اكتب "abc" في حقل مواصفة رقمية.
- **Assert (expected):** رفض قيمة غير رقمية. **الفعلي:** الحقل `TextField` نصي بحت رغم أن نوع المدخل معرّف "رقم" — يُقبل أي نص ويُرسل كما هو لمُقيّم المعادلات لاحقاً (قد يفشل هناك بدلاً من الواجهة).

#### INV-228 — Live preview fires only when every spec field is non-blank
- **Steps:** أدخل قيمة في مدخل واحد من أصل اثنين مطلوبين.
- **Assert:** لوحة "معاينة الاحتياجات والتكلفة" تبقى على "أكمل المواصفات لعرض المعاينة." حتى تُملأ كل الحقول.

#### INV-229 — Preview loading and success states
- **Steps:** أكمل كل حقول المواصفات بقيم صالحة.
- **Assert:** "جارِ الحساب…" أولاً، ثم قائمة الخامات (صنف × معادلة الكمية × تكلفة الوحدة = تكلفة السطر)، وسطر "تكلفة الوحدة" الإجمالي، وسطر "السعر المقترح (للوحدة)" إن كانت طريقة التسعير معادلة.

#### INV-230 — Preview error shows raw formula error message
- **Pre:** منتج بمعادلة كمية تقسم على متغير قد يساوي صفراً (أو أي معادلة تفشل عند قيم معينة).
- **Steps:** أدخل قيمة مواصفات تُسقط تقييم المعادلة.
- **Assert:** لوحة المعاينة تعرض نص الخطأ الخام من `preview.error.message` مباشرة — لا رسالة عربية موحّدة، بل أياً كان ما يرجعه المُقيّم.

#### INV-231 — Save is allowed even while preview is erroring — gap
- **Pre:** من INV-230 (معاينة في حالة خطأ).
- **Steps:** أكمل بقية الحقول المطلوبة (الكمية، المستودعان)، لاحظ زر "حفظ".
- **Assert (expected):** تعطيل الحفظ حتى تنجح المعاينة. **الفعلي:** `canSave` لا يتحقق من نجاح `preview` إطلاقاً — يمكن حفظ أمر تصنيع مخصص رغم أن معاينة تكلفته/خاماته تفشل.

#### INV-232 — Create: warehouses required, no distinct-warehouse check
- **Steps:** اختر نفس المستودع لـ"مستودع الخامات" و"مستودع المنتجات"، احفظ.
- **Assert:** يُقبل بلا تنبيه (نفس فجوة INV-191).

#### INV-233 — Customer optional, defaults "بدون عميل"
- **Steps:** لاحظ حقل "العميل" الافتراضي.
- **Assert:** "بدون عميل"؛ الحفظ ممكن بدونه.

#### INV-234 — Full create + reload
- **Steps:** أكمل نموذجاً صالحاً كاملاً، احفظ، أعد تحميل الصفحة.
- **Assert:** أمر جديد يظهر بحالة "مهيأة" (`configured`)، رقم بصيغة `CM-...`.

#### INV-235 — Detail: profit margin tone
- **Steps:** افتح أمراً حُفظ بتكلفة فعلية أو تقديرية أعلى من إجمالي البيع.
- **Assert:** "هامش الربح" يُعرض بلون تحذيري (`danger`) عند القيمة السالبة، وبلون نجاح عند الموجبة.

#### INV-236 — Detail effects copy — auto work order + cost capture
- **Steps:** لاحظ قسم "تأثيرات".
- **Assert:** "يُنشأ أمر تصنيع (Work Order) مرتبط تلقائياً عند إنشاء أمر التصنيع المخصص لتنفيذ الإنتاج الفعلي." و"عند إغلاق الأمر تُحفظ التكلفة الفعلية من أمر التصنيع المرتبط."

#### INV-237 — Detail: linked work order id is inert text, not a link — gap
- **Steps:** افتح تبويب "التكلفة الفعلية"، لاحظ سطر "أمر التشغيل".
- **Assert (expected):** زر قابل للنقر ينقل لتفاصيل أمر التصنيع كما يصف الكتالوج ("WO-0007" كزر). **الفعلي:** نص ثابت يعرض معرّف أمر التصنيع الخام (`instance.workOrderId`) بلا أي إجراء نقر.

#### INV-238 — Close order — no confirmation dialog
- **Pre:** أمر بحالة قابلة للإجراء (`configured`/`in_progress`/`produced`).
- **Steps:** من التفاصيل، اضغط "إغلاق الأمر".
- **Assert:** الحالة تتحول "مغلقة" فوراً بلا حوار تأكيد؛ أزرار "إغلاق الأمر"/"إلغاء" تختفي تماماً بعدها (وليس فقط تُعطَّل).

#### INV-239 — Cancel order — no confirmation dialog
- **Pre:** أمر آخر بحالة قابلة للإجراء.
- **Steps:** اضغط "إلغاء".
- **Assert:** الحالة تتحول "ملغاة" فوراً بلا حوار تأكيد.

#### INV-240 — Status chips and search on list
- **Pre:** بعد إنشاء عدة أوامر بحالات مختلفة.
- **Steps:** اضغط كل شريحة حالة (مهيأة/في التنفيذ/تم الإنتاج ضمن "في التنفيذ"/مغلقة/ملغاة)، ثم ابحث برقم الأمر أو المنتج أو العميل.
- **Assert:** كل فلتر يعزل الصفوف الصحيحة.

---

## 14. لوحة الإنتاج (Production Dashboard)

Pure read-only dashboard — no create/edit surface of its own.

#### INV-241 — KPI strip
- **Pre:** WO-DEMO-1 (مخطط)، WO-DEMO-2 (قيد التنفيذ)، WO-DEMO-3 (ملغي).
- **Steps:** افتح التصنيع ← لوحة الإنتاج.
- **Assert:** "أوامر نشطة" يعكس عدد الأوامر غير المكتملة/الملغاة؛ "قيمة الإنتاج تحت التشغيل" > 0 (WO-DEMO-2 بدأ)؛ "الوحدات المنتجة هذا الشهر" = 0 (لا أمر أُكمل)؛ "أوامر متأخرة" يعتمد على تواريخ الانتهاء المجدولة مقابل تاريخ اليوم. **`[NOT IMPLEMENTED]`**: لا بطاقة رابعة "متوسط التكلفة للوحدة" كما يصف الكتالوج — بديلها هنا "أوامر متأخرة".

#### INV-242 — Bucket lists are non-interactive — gap
- **Steps:** اضغط على أي بطاقة ضمن "بانتظار صرف المواد" أو "بانتظار استلام المنتج" أو "جاهزة للإنهاء".
- **Assert (expected):** ينقل لتفاصيل ذلك الأمر. **الفعلي:** لا `onClick` على هذه البطاقات إطلاقاً — عرض فقط.

#### INV-243 — Bucket: "بانتظار صرف المواد"
- **Pre:** WO-DEMO-2 بدأ لكن لم يُصرف له مواد بعد.
- **Steps:** لاحظ هذه القائمة.
- **Assert:** WO-DEMO-2 يظهر فيها بشريحة الأولوية وكسر التقدّم "0/15".

#### INV-244 — Empty bucket state
- **Steps:** لاحظ قائمة "جاهزة للإنهاء" إن لم يوجد أمر بهذه المرحلة.
- **Assert:** "لا توجد أوامر في هذه المرحلة."

#### INV-245 — Active orders table: next-action button only navigates, doesn't act — gap
- **Steps:** في جدول "جميع الأوامر النشطة"، اضغط زر "الإجراء التالي" (مثال "صرف المواد") لصف WO-DEMO-2.
- **Assert (expected):** ينفّذ خطوة الصرف مباشرة من لوحة الإنتاج. **الفعلي:** الزر يستدعي فقط `navigate("work-orders")` — ينقل لقائمة أوامر التصنيع العامة بلا تنفيذ أي إجراء ولا حتى فتح ذلك الأمر تحديداً؛ يجب على المستخدم البحث عن الأمر من جديد هناك.

#### INV-246 — Label mismatch across screens — gap
- **Pre:** أمر بمرحلة "استلام المنتج" (جاهز للإكمال).
- **Steps:** قارن نص زر "الإجراء التالي" هنا مع نص الزر المكافئ في تفاصيل أمر التصنيع (قسم 11).
- **Assert:** هنا "إنهاء الأمر"؛ هناك "إكمال أمر العمل" — نفس الإجراء بتسمية مختلفة بين الشاشتين.

#### INV-247 — Overdue badge on bucket cards and table rows
- **Pre:** أمر بتاريخ انتهاء ماضٍ وحالة غير مكتملة.
- **Steps:** لاحظه في كل من قوائم "المراحل" وجدول "الأوامر النشطة".
- **Assert:** شارة حمراء "متأخر" في كلا الموضعين لنفس الأمر.

#### INV-248 — Quick-nav header buttons
- **Steps:** اضغط "أوامر التصنيع" ثم عد، اضغط "قوائم المواد".
- **Assert:** كل زر ينقل للشاشة المقابلة مباشرة.

#### INV-249 — Load error + retry
- **Pre:** حاكِ فشل `GET /manufacturing/dashboard`.
- **Steps:** افتح الشاشة.
- **Assert:** "تعذّر تحميل لوحة الإنتاج." + "إعادة المحاولة".

#### INV-250 — No filters/date range — `[expected, matches catalog]`
- **Steps:** ابحث عن أي فلتر أو نطاق تاريخ على هذه الشاشة.
- **Assert:** لا يوجد — هذا متوقع ومطابق للكتالوج (لوحة استثناءات تشغيلية فقط، وليست تقريراً قابلاً للتصفية).

---

## Appendix — consolidated `[NOT IMPLEMENTED]` gaps vs. the reference catalog

Grouped by screen, for a tester who wants the punch list without re-reading every
scenario:

- **Items**: item type limited to `stock`/`service` only (catalog: 6 types); no item-categories dialog; no "hide variants" / price-range filters; no season/image/POS-visibility/kitchen-waste fields; no cost-layers or stock-by-warehouse tab (both are literal "Phase 2" placeholders); no attachments/log tabs; no "more" menu (print labels / opening balance / deactivate / delete shortcuts); no client-side negative-number guard on sale/cost price.
- **Item Specifications**: not in the catalog at all — build-only.
- **Product Templates**: no search box; no variant-count list column; no client-side guard on deleting an in-use attribute/value (server-error-only); no alternate-units UI; base unit is free text, not a dropdown; no numeric guard on default price/cost.
- **Configurable Products**: no row kebab menu, no per-row "new custom order" shortcut, no edit action on an existing product (create + deactivate only).
- **Stock Balance**: no filter chips, no filters panel, no row-click navigation.
- **Stock Transfers**: create always auto-confirms (no draft stage reachable through the UI); a pre-existing draft (like the seeded `TRF-DEMO-3`) has no confirm button anywhere; no Excel import; only a "lines" detail tab (no attachments/audit).
- **Stock Adjustments**: same auto-confirm pattern as Transfers; only 2 detail tabs (no attachments/audit); no before/after quantity columns; no opening-balance shortcut from Items.
- **Physical Counts**: pausing a session ("حفظ ومتابعة لاحقاً") does not persist entered counts to the server; no warehouse/date-range filters.
- **Label Printing**: no item/document mode toggle (item mode only).
- **Inventory Write-downs**: not in the catalog at all — build-only; line table shows raw item ids, not names.
- **Work Orders**: no filters panel; no kebab menu (so no duplicate/cancel action); only 2 detail tabs (materials, costs) — no way to see the GL entries a work order posted; the detail page's own effects copy claims GL 1200 posts on completion, which is false (D3); silent error on start/issue/complete outside the receive panel; no distinct-warehouse check.
- **BOMs**: no "new work order" or "new version" shortcut from a BOM's own detail page; only 1 detail tab; deactivate has no confirmation; waste % has no upper bound.
- **Custom Manufacturing**: spec inputs are unvalidated free text; save is allowed even when the cost/material preview is erroring; linked work order id is inert text, not a link; close/cancel have no confirmation dialogs; no distinct-warehouse check.
- **Production Dashboard**: bucket cards are not clickable; the "next action" button on the active-orders table only navigates to the Work Orders list, it never executes the step; inconsistent action labels between this screen ("إنهاء الأمر") and the Work Order detail page ("إكمال أمر العمل"); no average-cost-per-unit KPI tile.

FEFO note: this build has **no UI surface anywhere** in these 14 screens for viewing or
selecting a batch/cost-layer (no cost-layers tab on Items, no batch column on Label
Printing, no batch selector on Adjustments/Transfers/Physical Counts). Every batch-
tracked item in the seed (`ITEM-DEMO-7`/`ITEM-DEMO-8`) is costed WAC, so even a correct
FEFO consumption order produces an identical unit cost to FIFO — nothing in the UI would
visibly differ either way. The seed does plant a real FEFO test fixture at the data
layer (milk batch `MLK-2708`, received second on 2026-08-21, expires 2026-09-05 —
*before* `MLK-2607`, received first, which expires 2026-10-20), but proving which batch
a movement actually drew from requires reading the domain/API layer directly, not this
build's UI. Scenario **`[NOT IMPLEMENTED]`**.
