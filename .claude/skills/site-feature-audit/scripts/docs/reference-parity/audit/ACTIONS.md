# Action catalogue — reference

Round 3, brute-force interaction pass. Every non-destructive control was clicked,
every dropdown enumerated, every row overflow menu opened, create and edit forms
opened and their sections/fields/dropdowns read. **No submit control was ever
activated and no write left this session.**

Coverage of this pass is **partial** — see `COVERAGE.md`. The routes below are the
ones driven to full depth so far.

## Global chrome (present on every screen)

| Control | Behaviour |
|---|---|
| بحث سريع (Ctrl+K) | A **command palette**, not a search box. Two sections: quick actions (إنشاء فاتورة مبيعات، تحصيل دفعة، إنشاء سند نقدي، استلام بضائع، صرف دفعة) and go-to entries for every screen in the product. |
| Branch switcher | جميع الفروع / الفرع الرئيسي / test1 — a global scope, not a per-list filter |
| Warehouse switcher | كل المستودعات / مستودع الفرع الرئيسي / مستودع test1 / سياره نقل |
| Notifications | Panel with الكل / غير مقروء tabs, a تحديد الكل action and عرض جميع الإشعارات |
| System status | Header indicator backed by `GET status/summary` — "جميع الأنظمة تعمل بشكل طبيعي" |
| الدعم الفني | Support entry point in the header |
| User menu | الملف الشخصي / الإعدادات / تسجيل الخروج |
| Page size | 10 / 25 / 50 / 100 on every list |

## Row overflow menus are state-dependent

This is a behavioural rule, not a layout detail: the row menu is computed from the
document's state.

| Screen | Row menu |
|---|---|
| عروض الأسعار — converted quote | عرض / طباعة |
| عروض الأسعار — draft quote | عرض / طباعة / تعديل / حذف |
| فواتير المبيعات — open invoice | عرض / طباعة / **إنشاء مرتجع مبيعات** / **إنشاء خطة أقساط** / إلغاء الفاتورة |
| فواتير المبيعات — fully paid / voided | عرض / طباعة / إنشاء مرتجع مبيعات / إنشاء خطة أقساط (no cancel) |
| الأصناف | عرض / تعديل / تعطيل / حذف |
| حسابات الخزينة | تعديل / **إضافة رصيد افتتاحي** |

Two consequences for Mezan: rows need an overflow menu at all, and its contents must
be derived from the document's lifecycle state rather than rendered statically.

## Cross-document creation is reachable from the row

`إنشاء مرتجع مبيعات` and `إنشاء خطة أقساط` sit in the invoice's row menu, so a user
never has to navigate to the returns screen and search for the source invoice. This
is the same affordance the invoice detail exposes from its المرتجعات and الأقساط tabs.

## Document detail — actions

| Screen | Header actions | Tabs |
|---|---|---|
| عرض سعر | تعديل / **مشاركة** / المزيد / إرسال للعميل / **عرض الفاتورة** (when converted) | تفاصيل العرض / المرفقات / السجل |
| فاتورة مبيعات | تحصيل / فتح في صفحة كاملة | بنود / المدفوعات / المرتجعات / الأقساط / القيود المحاسبية / الفاتورة الإلكترونية / المرفقات / سجل المراجعة |
| صنف | تعديل / المزيد / تعديل المخزون / نقل إلى مستودع آخر / طلب شراء / عرض سجل الحركات | المخزون حسب المستودع / المواصفات / التكلفة / قوائم الأسعار / المرفقات / السجل |
| أمر تصنيع | استلام المنتج / تسجيل تكلفة / صرف إضافي / إرجاع مواد / تسجيل فاقد | المواد / التكاليف / استخدام المواد / حركة المواد / الاستلامات / القيود المحاسبية / السجل |
| عميل | إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد / كشف حساب / المزيد | الفواتير / كشف حساب / الأقساط / المرتجعات / نقاط الولاء / المرفقات / سجل المراجعة |
| مورد | إنشاء فاتورة مشتريات / صرف دفعة / إنشاء أمر شراء / عرض كشف الحساب / المزيد | فواتير المشتريات / كشف حساب المورد / مرتجعات المشتريات / أوامر الشراء / المرفقات / سجل المراجعة |
| موظف | إعادة توظيف / المزيد | المعلومات الشخصية / العقد / الإجازات / كشوف الرواتب / سلف الموظفين / الحضور / المرفقات / السجل |

**مشاركة (Share)** on the quote opens: مشاركة PDF / مشاركة عبر… / نسخ الرابط. A
shareable document link is a feature Mezan has no equivalent of.

## Document line grids

Observed on the quote and invoice editors — all absent from Mezan:

- **متاح: 100** — live available stock shown next to the line
- **غير متوفر** — an out-of-stock badge on the line
- **Per-line unit of measure** picker (قطعة (PCS) / كرتونة) — multi-UoM selling
- **Per-line discount type**: نسبة مئوية / مبلغ ثابت
- **Document currency**: 11 currencies (EGP, SAR, AED, QAR, KWD, BHD, OMR, JOD, USD, EUR, GBP)

## Creation methods

`طريقة الإنشاء` is a first step on the invoice, with two cards:
- إنشاء فاتورة جديدة — أدخل بنود الفاتورة يدوياً
- إنشاء من عرض سعر — اختر عرض سعر مقبول لتحويله إلى فاتورة

The quote has no such step. The purchase invoice has the same step. Returns have a
different shape again: the first and only section is **فاتورة المصدر / معلومات
الفاتورة الأصلية** — a return cannot exist without a source document.

## Filters and list behaviour

- Status chips are **routes**, not client state: clicking one changes the query string
  and re-fetches. Row counts confirmed to change per chip.
- `تصفية النتائج` carries an **active-filter count badge** (`تصفية النتائج 1`).
- Sales invoices carry a **channel filter**: الكل / مباشرة (مكتب / محل) / مبيعات الڤان.
- Items carry facet filters: نوع الصنف chips, `مخزون منخفض`, `نفد المخزون`, a price
  range, **إخفاء المتغيرات** and **إظهار الأصناف التلقائية (المنتجات حسب الطلب)** toggles.
- Empty states carry a call to action, not just a message: "لا توجد فواتير بعد — ابدأ
  بإنشاء…", "لا توجد أصناف بعد — أضف أصنافك أو خدماتك لبدء…".

## Validation

The reference's forms carry **almost no HTML validation attributes**. The sales
invoice form has no `required` at all; the only declarative constraint found was
`min` on the due date (set to today) and `inputmode="decimal"` on money inputs.
Validation is implemented in JavaScript and can only be observed by submitting,
which the read-only rule forbids. Treat the absence of attributes as *unknown rules*,
not *no rules*.

## Stock-adjustment reasons (a wizard, not a field)

`/inventory/adjustments/new` opens a reason picker before any form:
رصيد افتتاحي (تسجيل رصيد المخزون الأولي) · تصحيح جرد (تعديل المخزون بناءً على الجرد
الفعلي) · تلف · سرقة · انتهاء صلاحية · نقص / فقدان (خصم العجز غير المبرر) ·
مرتجع للمورد · أخرى (حدد الاتجاه والكمية).

## Voucher types (11, each a card with an explanation)

تحصيل من عميل · دفع لمورد · رد مبلغ لعميل · **دفعة مقدمة من عميل مقاولات** ·
استرداد من مورد · إيراد آخر · مصروف آخر · **ضخ رأس مال من الشريك** ·
**سحب شخصي للشريك** · **دفع لمصلحة الضرائب** · تحويل بين الخزائن.

The type filter on the list exposes ten of them; the eleventh (دفعة مقدمة من عميل
مقاولات) appears only in the create picker.
