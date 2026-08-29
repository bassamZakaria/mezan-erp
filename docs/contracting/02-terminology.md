# المقاولات — the glossary, settled before the code

Renaming an entity after screens exist is expensive, so the terminology was fixed
first. Egyptian usage wins over Gulf and over MSA everywhere the two differ.

| Concept | Arabic | Note |
|---|---|---|
| Bill of quantities | **جدول الكميات** | Not المقايسة — that is the quantity surveyor's *costing exercise*, a different thing from the contract's item/quantity/rate schedule. Keeping them distinct matters. |
| Progress certificate | **مستخلص** | Universal in Egypt. «شهادة إنجاز» reads as a translation. |
| Interim certificate | **مستخلص دوري** | Not «مستخلص تحت الحساب», which collides with advance wording. |
| Final certificate | **مستخلص ختامي** | ختامي, not نهائي — نهائي is reserved for handover. |
| Executed quantity | **الكمية المنفذة** | |
| Variation order | **أمر تغيير** | One entity with an addition/omission type, not two document kinds. |
| Retention | **المحتجزات الضمانية** | Matches the shipped `contracting.retention_receivable`. |
| Advance | **دفعة مقدمة** | Matches the shipped `contracting.customer_advances`. |
| Advance recovery | **استرداد الدفعة المقدمة** | A deduction line on a مستخلص, never its own document. |
| Subcontractor | **مقاول الباطن** | «مقاول من الباطن» only in printed contract prose. |
| Subcontract certificate | **مستخلص مقاول الباطن** | Same family, tagged by counterparty. |
| Materials on site | **مواد موردة بالموقع** | |
| Delay penalty | **غرامة تأخير** | Matches the shipped `contracting.late_penalty`. |
| Letter of guarantee | **خطاب ضمان** | Subtypes ابتدائي / نهائي / دفعة مقدمة. |
| Tender | **مناقصة** | Gulf says عطاء. Do not use it here. |
| Unit rate analysis | **تحليل الأسعار** | |
| Site store | **مستودع الموقع** | **مستودع**, matching the shipped المستودعات screen — not مخزن. Two words for one concept is exactly the defect this pass exists to prevent. |
| Daily site report | **التقرير اليومي للموقع** | |
| Preliminary / final handover | **التسليم الابتدائي / التسليم النهائي** | Gulf sometimes says الاستلام; Egyptian Ministry of Housing contracts say التسليم. |
| Work in progress | **أعمال تحت التنفيذ** | |
| Unbilled revenue | **إيرادات غير مفوترة** | |

When the subcontractor-side retention slot is added, its label must be
**المحتجزات الضمانية المستحقة لمقاولي الباطن** — same root noun as the customer
side, opposite direction, so the pair never drifts into two different words.

## Units and the numeric grid

BOQ units are a stored enum (`M3`, `M2`, `LM`, `TON`, `EACH`, `LS`) rendered through
the ar/en resource layer, never free text — free text gives you «طن»، «طن.» and
«طن » as three different units. Never compose «م.ط» from fragments at render time;
the internal period inside a mixed run is the classic bidi failure. The unit gets
its own **الوحدة** column and is never concatenated into the quantity cell
(«10 م٣» as one string): the quantity stays a right-aligned numeric column on its
own, the unit sits beside it as one atomic string.

Certificate print lines must be templated strings with named placeholders in the
resource file. Assembling a sentence at runtime from description + quantity + rate
scrambles Arabic word order.
