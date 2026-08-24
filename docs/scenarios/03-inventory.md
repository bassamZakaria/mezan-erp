# Inventory & Manufacturing — UI Test Scenarios

Sources: `docs/catalog/03-inventory.md` (reference product) and
`docs/catalog/07-mfg-projects-assets.md` (manufacturing half) against the
actual build (`apps/web/src/screens/*`, `apps/web/src/nav-config.ts`). Where
the catalog describes something the build does not have, the scenario is
written against the catalog's expectation and marked **`[NOT IMPLEMENTED]`**
— its Assert is "the feature is absent," not a click path.

Seed data used throughout (`packages/backend/src/demo-seed.ts`,
`demo-seed/inventory-ops.ts`):

- **Items**: IT-0001 أرز أبيض ٥ كجم, IT-0002 زيت عباد الشمس ١ لتر, IT-0003 سكر
  أبيض ١ كجم, IT-0004 شاي أسود ٥٠٠ جم (4 plain) · IT-0005 خليط شاي بالسكر
  (BOM-DEMO-1), IT-0006 خليط شاي بالنعناع (BOM-DEMO-2) (2 manufacturable) ·
  IT-0007 لبن كامل الدسم ١ لتر, IT-0008 زبادي طبيعي ١٠٠ جم (2 batch/expiry —
  batches `MLK-2607`/exp 2026-10-20 and `MLK-2708`/exp 2026-09-05 for IT-0007;
  `YOG-2607`/exp 2026-09-30 and `YOG-2708`/exp 2026-08-27 for IT-0008 — in both
  pairs the **second-received batch expires first**).
- **Warehouses**: WH-MAIN (مستودع الفرع الرئيسي, default), WH-GIZA (مستودع فرع
  الجيزة), WH-TRANSIT (مخزون بالطريق), plus one van-type warehouse.
- **BOMs**: BOM-DEMO-1 → IT-0005 (materials: IT-0004 ×4, IT-0003 ×6),
  BOM-DEMO-2 → IT-0006 (materials: IT-0004 ×5, IT-0003 ×5).
- Work orders WO-DEMO-1/2/3, adjustments across the 8 reason cards (opening
  balance, physical-count correction, damage, other, expiry among them),
  confirmed transfers, physical counts, product templates, item
  specifications, and one write-down run, per the task brief.

Known, already-filed defects that these scenarios will hit — **note them, do
not re-file them** (see `docs/defects.md`):

- **D2** — a `PHYSICAL_COUNT` adjustment posts no GL journal entry (only
  `INITIAL_STOCK` has a GL account mapping in `adjustmentGlAccountsForReason`)
  — measured drift 122.00.
- **D3** — `completeWorkOrder` never posts to GL 1200 — measured drift 80.00 at
  BOM-DEMO-1 qty 10. **Do not run WO-D3 on a database you need reconciled
  afterward.**
- **D4** — the drift report replays movements in `occurredAt` order with
  confirms stamped at `now()`, reporting gaps that are not real. Out of scope
  for this file (it lives in the Reports domain) — noted here only so a
  reconciliation scenario doesn't mistake the report's noise for a new
  inventory defect.

---

## 1. مركز المخزون (Inventory Hub) — `/inventory/hub`

INV-001 · **Pre**: logged in, any tenant with items. **Steps**: افتح القائمة الجانبية → المخزون → مركز المخزون (topmost `inventory-hub` entry, un-expanded submenu). **Assert**: page title "المخزون"; four stat cards render — عدد الأصناف، أصناف نشطة، قيمة المخزون (from the real stock-levels report, not a client re-derivation), أصناف تحتاج انتباه.

INV-002 · **Pre**: on hub. **Steps**: read "أصناف تحتاج انتباه" card. **Assert**: lists up to 5 rows sourced from `/inventory/stock-levels`, each showing item name, SKU, remaining qty, and a "نافد"/"منخفض" tag; if none are out/low, shows "لا توجد أصناف تحتاج انتباهاً حالياً."

INV-003 · **Pre**: on hub. **Steps**: click each quick-action button — "صنف جديد", "أرصدة المخزون", "تحويل مخزون", "جرد فعلي". **Assert**: each navigates to Items / Stock Balance / Stock Transfers / Physical Counts respectively; "صنف جديد" lands on the Items list (it does not itself open the add-item panel).

INV-004 · **Pre**: backend `/items` or `/inventory/stock-levels` returns an error (simulate via network block). **Steps**: load hub. **Assert**: card shows "تعذّر تحميل بيانات المخزون." with no crash; stat values fall back to "—" while loading.

INV-005 `[NOT IMPLEMENTED]` · Catalog describes a "مناطق العمل" tile grid (stock balance / items / transfers / adjustments / physical counts / two report links) and an "آخر الحركات" recent-transfers/adjustments panel. **Assert**: neither exists — the build's hub is a 4-stat-card + needs-attention layout only, no workspace tile grid, no recent-movements panel.

---

## 2. الأصناف (Items) — `/inventory/items`

### List

INV-010 · **Pre**: on Items list. **Steps**: read header stats. **Assert**: إجمالي الأصناف = 8 (seed), نشط = 8, أصناف مخزون and أصناف خدمية sum to 8.

INV-011 · **Pre**: list loaded. **Steps**: click status chips الكل / نشط / غير نشط / منتج مخزون / خدمة in turn. **Assert**: rows filter accordingly; page resets to 1 on each chip change.

INV-012 `[NOT IMPLEMENTED]` · Catalog describes چips مخزون منخفض and نفد المخزون plus an out-of-stock attention banner on this screen. **Assert**: neither chip nor banner exists on Items — stock-level filtering only exists on Stock Balance.

INV-013 · **Pre**: list loaded. **Steps**: open "تصفية حسب التصنيف" select, pick a category; separately, open "تصفية حسب الوحدة" select, pick PCS. **Assert**: rows filter by category/unit respectively; combining both narrows further.

INV-014 `[NOT IMPLEMENTED]` · Catalog's filters panel also has سعر البيع من/إلى, سعر التكلفة من/إلى range inputs and an "إخفاء المتغيرات" checkbox. **Assert**: none of these three controls exist — only the category and unit selects.

INV-015 · **Pre**: list loaded. **Steps**: type "أرز" into "بحث بالاسم أو الكود...". **Assert**: only IT-0001 (أرز أبيض ٥ كجم) row remains; clearing the box restores all rows.

INV-016 · **Pre**: list loaded. **Steps**: type "IT-0003" into search. **Assert**: matches by code too — سكر أبيض row shown (search checks nameAr, code, and nameEn).

INV-017 · **Pre**: list has >5 rows (8 seeded, PAGE_SIZE=5). **Steps**: click column header "اسم الصنف", then "سعر البيع", then "سعر التكلفة". **Assert**: each toggles ascending/descending sort on that column; a second click on the same header reverses direction.

INV-018 · **Pre**: 8 items, page size fixed at 5. **Steps**: read pager footer, click next page. **Assert**: footer reads "عرض 1–5 من 8 صنف" on page 1, "عرض 6–8 من 8 صنف" on page 2; no page-size selector is offered (catalog describes one, default 25 — `[NOT IMPLEMENTED]`).

INV-019 · **Pre**: search matches zero rows. **Steps**: type "xyz-nonexistent". **Assert**: empty state "لا توجد أصناف مطابقة" renders in place of the table.

INV-020 · **Pre**: list loaded. **Steps**: click the row for IT-0005 (خليط شاي بالسكر) anywhere except the edit icon. **Assert**: opens the item detail view (not the edit form).

INV-021 · **Pre**: list loaded. **Steps**: click the pencil icon button on a row. **Assert**: opens the edit SidePanel pre-filled with that item's data directly, without navigating to detail first.

INV-022 `[NOT IMPLEMENTED]` · Catalog describes a row kebab menu (تعديل/تعطيل/حذف) and, for zero-stock rows, an inline "تحديد الرصيد الافتتاحي" quick action. **Assert**: the row's only action is the single edit pencil icon — no menu, no deactivate/delete from the list, no opening-balance shortcut button.

INV-023 `[NOT IMPLEMENTED]` · Catalog's header has a second action "تصنيفات الأصناف" opening a category-management dialog (list + add/edit/delete categories). **Assert**: only "إضافة صنف" exists in the header; no categories dialog is reachable from Items (categories can only be *chosen*, not managed, via the التصنيف picker in the form).

### Add / edit form

INV-030 · **Pre**: on Items list. **Steps**: انقر "إضافة صنف". **Assert**: SidePanel titled "إضافة صنف" opens; كود الصنف is pre-filled and disabled (`ITM-000009`-style auto code), نوع الصنف defaults to "منتج مخزون", طريقة التكلفة defaults to "متوسط التكلفة (WAC)", نسبة الضريبة % defaults to 14, تتبع المخزون is on.

INV-031 · **Pre**: add-item panel open. **Steps**: leave اسم الصنف blank, انقر "إضافة". **Assert**: inline alert "اسم الصنف مطلوب." — panel stays open, no request sent.

INV-032 · **Pre**: add-item panel open. **Steps**: set نوع الصنف to "خدمة" while تتبع المخزون remains on (toggle it back on after the type switch auto-clears it), then submit. **Assert**: alert "لا يمكن لصنف من نوع (خدمة) أن يتتبع المخزون." — note the type-switch itself already flips trackInventory off, so this path requires re-enabling the toggle to trigger the message.

INV-033 · **Pre**: add-item panel open, name filled. **Steps**: click "+ إضافة وحدة" under وحدات القياس البديلة, set كود الوحدة to the same value as الوحدة الأساسية (e.g. PCS), submit. **Assert**: alert `الوحدة البديلة "PCS" لا يمكن أن تطابق الوحدة الأساسية.`

INV-034 · **Pre**: same, two alternate-unit rows added with identical كود الوحدة (e.g. both "CTN"). **Steps**: submit. **Assert**: alert `كود الوحدة البديلة "CTN" مكرر.`

INV-035 · **Pre**: one alternate-unit row, عامل التحويل set to 0 or left negative via manual entry. **Steps**: submit. **Assert**: alert `عامل تحويل الوحدة "..." يجب أن يكون رقماً موجباً.` — non-positive conversion factors are rejected.

INV-036 · **Pre**: alternate-unit row with كود الوحدة or اسم الوحدة left blank. **Steps**: submit. **Assert**: alert "كود واسم الوحدة البديلة مطلوبان."

INV-037 · **Pre**: add-item panel, click "+ إضافة باركود آخر" twice, leave one barcode input blank. **Steps**: submit. **Assert**: alert "لا يمكن ترك الباركود فارغاً."

INV-038 · **Pre**: two barcode rows with the same value. **Steps**: submit. **Assert**: alert `الباركود "..." مكرر.`

INV-039 · **Pre**: نقطة إعادة الطلب field — type a negative number. **Steps**: submit. **Assert**: alert "نقطة إعادة الطلب لا يمكن أن تكون سالبة." Repeat for كمية إعادة الطلب → "كمية إعادة الطلب لا يمكن أن تكون سالبة." and for نسبة الضريبة % → "نسبة الضريبة لا يمكن أن تكون سالبة."

INV-040 · **Pre**: valid item, code left at its auto-generated value. **Steps**: submit twice in two separate "إضافة صنف" flows without reloading between (simulating a race) so the second create reuses the first draft's code before the item list refetches. **Assert**: alert `الكود "..." مستخدم بالفعل — أعد المحاولة.` — code-uniqueness is only checked on *create*, never on edit (كود الصنف is disabled/unchangeable on edit).

INV-041 · **Pre**: add-item panel, all required fields valid (name, base unit, costing method). **Steps**: fill سعر البيع=100, سعر التكلفة=60, add one alternate unit كرتونة/CTN factor 12, add barcode "6221234567890", submit "إضافة", **reload the page**. **Assert**: new item appears in the list with the entered name/prices; opening it shows the alternate unit and barcode preserved on the "الوحدات والباركود" tab.

INV-042 · **Pre**: add-item panel open with unsaved changes. **Steps**: انقر "إلغاء". **Assert**: panel closes, no item created, list unchanged.

INV-043 · **Pre**: editing IT-0001 (existing item). **Steps**: open edit panel. **Assert**: كود الصنف field shows IT-0001 disabled; حالة select is visible (only shown when editingId is set) with نشط/غير نشط options — not present when creating.

INV-044 · **Pre**: editing IT-0001. **Steps**: change الحالة to "غير نشط", save, **reload**. **Assert**: item now shows status pill غير نشط in the list and on its detail header; reappears under the "غير نشط" filter chip.

INV-045 · **Pre**: editing an item with existing stock movements (e.g. IT-0001, which has purchase/sale history). **Steps**: change سعر التكلفة in the form and save. **Assert**: catalog claims cost price becomes read-only/derived once an item has stock movements — the build's form does **not** enforce this (`[NOT IMPLEMENTED]`): سعر التكلفة remains a freely-editable MoneyInput regardless of movement history.

INV-046 · **Pre**: add/edit panel. **Steps**: set حساب الإيراد / حساب التكلفة / حساب المخزون EntityPickers, leave one unset. **Assert**: unset ones display "الافتراضي حسب نوع الصنف" both in the picker and later on the detail "الحسابات" tab.

INV-047 · **Pre**: add/edit panel. **Steps**: set نوع الكود (ETA) to EGS, type كود الصنف لدى المصلحة and كود GPC, save, reload, reopen detail. **Assert**: "الحسابات" tab shows نوع كود ETA=EGS and both codes persisted verbatim.

INV-048 `[NOT IMPLEMENTED]` · Catalog's identity section includes: وصف الصنف (description textarea), المورد الأساسي (primary supplier), الموسم (season, gated on supplier), صورة الصنف (image upload), "إضافة تصنيف"/"إضافة ماركة" inline-create affordances on the التصنيف/الماركة pickers, POS-visibility switch "متاح في نقطة البيع", and kitchen-waste switch "يعتبر هدراً عند التقديم". **Assert**: none of these fields/toggles exist in the build's add/edit form — only نوع الصنف, كود, اسم عربي/إنجليزي, الوحدة الأساسية, التصنيف (pick-only), الماركة (plain text, not an autocomplete-with-add), وحدات بديلة, باركود, الأسعار, نسبة الضريبة, تتبع المخزون/الدفعات, نقاط إعادة الطلب, حسابات GL, وحقول ETA.

INV-049 `[NOT IMPLEMENTED]` · Catalog describes 6 item-type button-group options (منتج/خدمة/مادة خام/منتج نهائي/مستهلك/الوصفة). **Assert**: the build's نوع الصنف is a 2-option dropdown — منتج مخزون / خدمة only. Raw-material, finished-product, consumable and recipe types do not exist as item types (BOMs model "raw material" and "finished product" purely through which item is referenced where, not a type field).

INV-050 `[NOT IMPLEMENTED]` · Catalog's item form separates "تتبع الدفعات وتواريخ الصلاحية" (batches) conceptually from expiry, and describes cost-layer records. **Assert**: the build has a single combined toggle "تتبع الدفعات وتواريخ الصلاحية" that sets both `trackBatches` and `trackExpiry` together — no independent batch-only mode, and no batch/lot entry UI anywhere on this screen (no batch number field, no per-batch listing).

### Detail page

INV-060 · **Pre**: open IT-0005 detail (خليط شاي بالسكر, WAC costed, is a BOM's finished product). **Steps**: read header/summary. **Assert**: title "IT-0005 — خليط شاي بالسكر", status pill نشط, summary row shows نوع الصنف/التصنيف/الوحدة/طريقة التكلفة/سعر البيع/سعر التكلفة.

INV-061 · **Pre**: on IT-0005 detail. **Steps**: click tab "عام". **Assert**: two-column card lists نوع الصنف, التصنيف, الماركة, طريقة التكلفة, تتبع المخزون (نعم), تتبع الدفعات وتواريخ الصلاحية (لا for this item), نقطة/كمية إعادة الطلب.

INV-062 · **Pre**: on detail. **Steps**: click "الوحدات والباركود". **Assert**: shows base unit; alternate-units table if any exist, else "لا توجد وحدات قياس بديلة"; barcode chips if any, else "لا يوجد باركود مسجل".

INV-063 · **Pre**: on detail. **Steps**: click "التسعير". **Assert**: shows سعر البيع and سعر التكلفة with a note "يصبح مشتقاً تلقائياً من حركات المخزون فور ربط دفتر التكاليف (المرحلة الثانية)" — i.e. the tab openly states cost derivation from movement history is not yet wired.

INV-064 · **Pre**: on detail. **Steps**: click "الحسابات". **Assert**: shows حساب الإيراد/التكلفة/المخزون (resolved to "code — name" or the default label) and the ETA code-type/item-code/GPC-code trio.

INV-065 · **Pre**: on detail. **Steps**: click "المخزون". **Assert**: placeholder text "ستُعرض أرصدة المخزون حسب المستودع هنا فور ربط حركات المخزون بدفتر المخزون (المرحلة الثانية)." — **this tab is explicitly unimplemented, not a bug**: the item detail page does not show per-warehouse stock at all (use Stock Balance instead, INV-070+).

INV-066 `[NOT IMPLEMENTED]` · Catalog describes an "التكلفة" tab with a cost-layers table (warehouse, remaining qty, unit cost, source doc, date) and a landed-cost allocation log, plus separate "المرفقات" and "السجل" (audit) tabs. **Assert**: none of these exist in the build — only عام / الوحدات والباركود / التسعير / الحسابات / المخزون (placeholder) tabs are present; no attachments tab, no audit-log tab, no cost-layers anywhere in this screen.

INV-067 `[NOT IMPLEMENTED]` · Catalog describes detail-page quick actions تعديل المخزون / نقل إلى مستودع آخر / طلب شراء / عرض سجل الحركات, and a "المزيد" more-menu with طباعة الملصقات / تحديد الرصيد الافتتاحي / تعطيل / حذف. **Assert**: the detail header only offers "رجوع للقائمة" and "تعديل" — no quick actions, no more-menu, no deep links from the item into Labels/Adjustments/Transfers/Purchases.

INV-068 · **Pre**: detail open for a service-type item (create one first per INV-032's type toggle, without the trackInventory conflict). **Steps**: check تسعير and المخزون tabs. **Assert**: تتبع المخزون in "عام" reads لا; no stock-related fields render differently — service items simply carry trackInventory=false end to end.

---

## 3. المواصفات (Item Specifications) — `/inventory/item-specifications`

Not described in `docs/catalog/03-inventory.md` at all — a **build-only addition** feeding Product Templates' attribute picker. Documented fully, no `[NOT IMPLEMENTED]` markers apply to its own existence.

INV-070 · **Pre**: empty tenant, no specifications defined. **Steps**: open screen. **Assert**: empty state "لا توجد مواصفات — أضف مواصفة جديدة" (or "جارِ التحميل…" while loading); a correctly-empty registry is a valid state, not a bug.

INV-071 · **Pre**: ≥5 specifications exist (per task's seed count). **Steps**: read stats. **Assert**: إجمالي المواصفات and قابلة للتصفية counts match the data; type chips الكل/قائمة اختيار/رقم/نص show correct per-type counts.

INV-072 · **Pre**: list loaded. **Steps**: click type chips in turn. **Assert**: rows filter by exact `type` match.

INV-073 · **Pre**: list loaded. **Steps**: search by code and separately by (partial) Arabic name. **Assert**: both match — code search is case-insensitive substring, name search is substring on nameAr.

INV-074 · **Pre**: on screen. **Steps**: انقر "مواصفة جديدة". **Assert**: SidePanel opens, defaults: النوع="قائمة اختيار", نشطة=on, قابلة للتصفية=off.

INV-075 · **Pre**: create panel open, code field. **Steps**: type lowercase letters or symbols outside `[A-Z0-9_-]` (e.g. "size!"). **Assert**: input auto-uppercases as typed (`onChange` forces `.toUpperCase()`), but submitting a value with an illegal character (e.g. "SIZE!") still fails validation: `الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى).`

INV-076 · **Pre**: create panel, code left blank. **Steps**: submit. **Assert**: same code-format alert (blank fails the same regex).

INV-077 · **Pre**: create panel, code valid, الاسم بالعربية left blank. **Steps**: submit. **Assert**: alert "الاسم بالعربية مطلوب."

INV-078 · **Pre**: create panel, النوع left at "قائمة اختيار", القيم المسموح بها left blank. **Steps**: submit. **Assert**: alert "قائمة الاختيار تحتاج قيمة واحدة على الأقل."

INV-079 · **Pre**: create panel, type="قائمة اختيار". **Steps**: type "أحمر، أخضر, أزرق\nأصفر" (mixing Arabic comma، Latin comma, and newline) into القيم. **Assert**: on save the values parse into 4 distinct entries (splits on `،`, `,`, and `\n`, trims, drops empties).

INV-080 · **Pre**: create panel, type="رقم". **Steps**: fill الوحدة="كجم", save, reload. **Assert**: list's "القيم / الوحدة" column shows "كجم" for that row; switching back to detail confirms unit persisted (numeric specs show unit, not a values chip list).

INV-081 · **Pre**: create panel, type="نص". **Steps**: save without touching القيم/الوحدة (neither field renders for type=نص). **Assert**: saves fine; list column shows "—" for that row.

INV-082 · **Pre**: valid new specification filled in, all fields correct. **Steps**: انقر "حفظ", **reload**. **Assert**: appears in the list with correct type badge/values/unit; usage count column ("الاستخدام") starts at 0.

INV-083 · **Pre**: editing an existing specification. **Steps**: open edit via row "تعديل" button. **Assert**: الكود and النوع fields are disabled (`editingCode !== null`); only name (ar/en), values/unit, قابلة للتصفية, نشطة remain editable.

INV-084 · **Pre**: editing an active specification. **Steps**: toggle نشطة off, save, reload. **Assert**: row now shows a "غير نشطة" pill next to the name in the list.

INV-085 · **Pre**: a specification with usageCount = 0 (unused by any Product Template attribute). **Steps**: click its row delete (trash) icon. **Assert**: deletes successfully with no confirmation dialog; row disappears from the list.

INV-086 · **Pre**: a specification with usageCount > 0 (attached to a Product Template attribute — see INV-160). **Steps**: inspect its trash icon. **Assert**: icon is disabled (usage-guard `disabled={... || s.usageCount > 0}`) — deletion is blocked client-side while in use.

INV-087 · **Pre**: attempting delete triggers a server-side rejection despite the client guard (e.g. a race). **Steps**: (server returns an error). **Assert**: a page-level alert banner shows "تعذّر حذف المواصفة." or the server's message, and `deletingCode` resets so other rows remain actionable.

INV-088 · **Pre**: create/edit panel open with unsaved edits. **Steps**: انقر "إلغاء". **Assert**: panel closes without saving; list unchanged.

---

## 4. أرصدة المخزون (Stock Balance) — `/inventory/stock-balance`

Read-only rollup; the same `rollupStockBalance` domain function the server runs.

INV-090 · **Pre**: on screen. **Steps**: read stats. **Assert**: إجمالي الأصناف = distinct items with a stock row; نفد المخزون = items whose on-hand across all warehouses is exactly 0.

INV-091 · **Pre**: on screen. **Steps**: search "شاي" (partial name match against multiple items, e.g. IT-0004/0005/0006). **Assert**: all matching item-name rows appear; search is name-only (no code match on this screen, unlike Items).

INV-092 `[NOT IMPLEMENTED]` · Catalog describes filter chips الكل/مخزون منخفض/نفد المخزون, a filters panel (warehouse, category, unit, total-qty range, reorder-point range), and an attention banner "يحتاج انتباه". **Assert**: none of these exist — Stock Balance in the build is search + a flat table only, no status chips, no filters panel, no banner.

INV-093 · **Pre**: table loaded. **Steps**: click "إجمالي المخزون" column header. **Assert**: toggles sort by on-hand quantity ascending/descending (the only sortable column on this screen).

INV-094 · **Pre**: table loaded. **Steps**: read columns for IT-0007 (milk, batch-tracked). **Assert**: shows الصنف, إجمالي المخزون (on-hand summed across all batches/warehouses), متوسط التكلفة (a single blended WAC figure — no per-batch breakdown), القيمة الإجمالية, عدد المستودعات; no batch/expiry columns appear anywhere on this screen.

INV-095 `[NOT IMPLEMENTED]` · Catalog says "نقطة إعادة الطلب" is a column here. **Assert**: the build has no reorder-point column on Stock Balance (reorder point is only visible on the Items form/detail).

INV-096 · **Pre**: search matches nothing. **Steps**: search "zzz". **Assert**: empty state "لا توجد أصناف مطابقة".

---

## 5. تحويلات المخزون (Stock Transfers) — `/inventory/transfers`

Value-neutral: moves quantity between warehouses without touching total inventory value.

INV-100 · **Pre**: list loaded. **Steps**: read stats and status chips. **Assert**: إجمالي التحويلات / مسودة / مؤكد chips show consistent counts; in this build, drafts should be 0 or near-0 — creation always auto-confirms (see INV-102).

INV-101 `[NOT IMPLEMENTED]` · Catalog describes an attention banner "N تحويلات مسودة". **Assert**: no such banner exists in the build.

INV-102 · **Pre**: on list. **Steps**: انقر "تحويل جديد", fill المستودع المصدر=WH-MAIN, المستودع الوجهة=WH-GIZA, add one line الصنف=IT-0001, كمية التحويل=5, انقر "حفظ". **Assert**: the single "حفظ" action both creates **and confirms** the transfer in one call (`createTransfer` then `confirmTransfer` chained) — there is **no separate draft-then-confirm step in this UI**, unlike the catalog's two-stage مسودة → مؤكد flow with an explicit "تأكيد" button on draft rows.

INV-103 · **Pre**: new-transfer form. **Steps**: pick the same warehouse for both source and destination. **Assert**: inline alert "يجب أن يختلف المستودع المصدر عن مستودع الوجهة." and the حفظ button is disabled (`canPost` false) until they differ.

INV-104 · **Pre**: new-transfer form, one line with item selected but كمية التحويل left at 0. **Steps**: attempt save. **Assert**: حفظ stays disabled — `allLinesValid` requires `qty > 0` for every line.

INV-105 · **Pre**: new-transfer form, line's الصنف left unselected ("اختر صنف..."). **Steps**: attempt save. **Assert**: حفظ disabled — blank itemId fails `allLinesValid`.

INV-106 · **Pre**: new-transfer form. **Steps**: type a negative number directly into كمية التحويل (bypassing the spinner, e.g. via keyboard). **Assert**: the input has `min={0}`; a negative value fails `l.qty > 0` and حفظ remains disabled — negative transfer quantities cannot be submitted.

INV-107 · **Pre**: new-transfer form, one line. **Steps**: انقر "إضافة بند" three times, then remove two via the ✕ icon. **Assert**: lines add/remove freely down to a minimum of 1 row (the ✕ button is disabled when only one line remains).

INV-108 · **Pre**: new-transfer form. **Steps**: transfer a quantity of IT-0001 that exceeds WH-MAIN's actual on-hand. **Assert**: the client performs **no available-stock check at all** (no "المخزون المتاح" column, no cap) — save is attempted and the server's `NegativeStockError` rejects it; the error banner shows the raw server message (English: `Issuing ... would drive on-hand (...) below zero; negative stock is disallowed.`), **not** a translated Arabic message — worth flagging as a UX gap even though it is correctly blocked.

INV-109 `[NOT IMPLEMENTED]` · Catalog's transfer lines table has a read-only "المخزون المتاح" (available stock) column and a header "استيراد من إكسل" (import from Excel) action. **Assert**: neither exists — the line table is صنف / كمية التحويل / remove-row only, no available-stock hint, no Excel import.

INV-110 · **Pre**: leave ملاحظات blank on a valid transfer. **Steps**: save. **Assert**: memo auto-fills to `تحويل من {source} إلى {destination}` when left blank.

INV-111 · **Pre**: an existing confirmed transfer. **Steps**: open its detail row. **Assert**: status stepper shows مسودة→مؤكد with مؤكد active; summary shows المستودع المصدر/الوجهة/التاريخ/عدد البنود; "تأثيرات هذا التحويل" (effects) card lists the real per-line quantity deductions/additions plus "لا يتغير إجمالي قيمة المخزون".

INV-112 · **Pre**: confirmed transfer detail open. **Steps**: read the banner below the detail card. **Assert**: exact text "لا يمكن إلغاء تحويل مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً بالاتجاه المعاكس." — no cancel/edit control is offered anywhere on a confirmed transfer.

INV-113 · **Pre**: confirmed transfer detail. **Steps**: click tab "البنود". **Assert**: table lists each line's item name and quantity; no "المرفقات" or "سجل التدقيق" tabs exist (`[NOT IMPLEMENTED]` vs. catalog, which describes both).

INV-114 · **GL/value assertion — Pre**: total inventory value (Stock Balance sum, or the Valuation report) recorded before a confirmed transfer of qty 10 of IT-0003 from WH-MAIN to WH-GIZA. **Steps**: perform the transfer per INV-102 with those values, then re-check total value across all warehouses combined. **Assert**: company-wide total inventory value is unchanged to the cent — the transfer only redistributes quantity/value *between* warehouses (WH-MAIN's value drops by qty×WAC, WH-GIZA's rises by the identical amount); no GL journal entry is created for a transfer (there is no "المحاسبة"/GL tab on this screen, and none should exist per the domain's valuation-neutral design).

INV-115 · **Pre**: list with ≥1 confirmed transfer. **Steps**: search by transfer number ("TRF-"), and separately by memo text. **Assert**: both match (search checks `docNo` and `memo`).

INV-116 · **Pre**: list loaded. **Steps**: click column header "رقم التحويل" and "التاريخ". **Assert**: both are sortable and toggle direction on repeated clicks.

---

## 6. تسويات المخزون (Stock Adjustments) — `/inventory/adjustments`

The only inventory document type in the reference product (and the one place
in the build) that both moves quantity **and** may post a balancing GL entry —
except for `PHYSICAL_COUNT` (D2). The 8 reasons are real code
(`packages/domain/src/inventory/reasons.ts`), transcribed verbatim from the
catalog: رصيد افتتاحي (IN), تصحيح جرد (EITHER), تلف (OUT), سرقة (OUT), انتهاء
صلاحية (OUT), نقص / فقدان (OUT), مرتجع للمورد (OUT), أخرى (EITHER).

INV-120 · **Pre**: list loaded. **Steps**: read stats. **Assert**: إجمالي التسويات / مسودة / مؤكد counts are internally consistent; all seeded adjustments are مؤكد (creation auto-confirms, same one-shot pattern as Transfers — INV-102).

INV-121 · **Pre**: on list. **Steps**: انقر "تسوية جديدة". **Assert**: navigates to the 8-card reason picker "اختر سبب التسوية", each card showing exact labelAr + descriptionAr from `ADJUSTMENT_REASON_DEFINITIONS` (e.g. "رصيد افتتاحي" / "تسجيل رصيد المخزون الأولي").

INV-122 · **Pre**: reason picker open. **Steps**: انقر "إلغاء" in the header. **Assert**: returns to the adjustments list without creating anything.

INV-123 · **Pre**: reason picker open. **Steps**: انقر card "رصيد افتتاحي". **Assert**: navigates to the create form titled "الرصيد الافتتاحي" (special-cased header text, not "تسوية — رصيد افتتاحي" like every other reason); line direction is forced IN (no direction column rendered, since `direction !== "EITHER"`); سعر التكلفة is required and enabled per line (IN lines always need a unit cost).

INV-124 · **Pre**: create form for رصيد افتتاحي, one line: item=IT-0001, كمية=0. **Steps**: attempt "اعتماد التسوية". **Assert**: button stays disabled — `qty > 0` required for every line regardless of reason.

INV-125 · **Pre**: create form, IN-direction line, سعر التكلفة left at 0. **Steps**: attempt submit. **Assert**: disabled — `allLinesValid` requires `unitCost > 0` when `direction === "IN"`.

INV-126 · **Pre**: reason picker → "تلف" (OUT-only). **Steps**: open create form. **Assert**: title "تسوية — تلف"; no اتجاه column (direction fixed OUT); سعر التكلفة input is **disabled** on every line (`disabled={line.direction === "OUT"}` — unit cost for an OUT movement is computed server-side from the costing engine, not entered).

INV-127 · **Pre**: same as INV-126. **Steps**: fill item + qty>0, submit. **Assert**: since OUT lines don't require a unitCost>0, the line is valid with cost left at 0 — submit succeeds (server derives the actual cost).

INV-128 · **Pre**: reason picker → "تصحيح جرد" or "أخرى" (both EITHER). **Steps**: open create form. **Assert**: an "الاتجاه" column appears per line with a زيادة/نقصان select; changing a line to نقصان disables that line's سعر التكلفة input, changing to زيادة re-enables it and requires >0.

INV-129 · **Pre**: create form, any reason, warehouse left unselected. **Steps**: attempt submit. **Assert**: disabled — `warehouseId !== ""` required (though the select always defaults to the first warehouse if any exist, so this only triggers with zero warehouses configured).

INV-130 · **Pre**: create form, valid line. **Steps**: leave ملاحظات blank, submit. **Assert**: memo auto-fills to `{reason.labelAr} — {warehouse name}`.

INV-131 · **Pre**: create form for "تلف". **Steps**: انقر "إضافة بند" to add a second line for a different item, fill both, submit, **reload**. **Assert**: both lines persist; adjustment appears in the list with عدد البنود = 2 and القيمة الإجمالية reflecting the summed line values.

INV-132 · **Pre**: create form open with data entered. **Steps**: انقر "رجوع". **Assert**: returns to the reason picker (not the list) — allows switching reason without re-entering warehouse/date from scratch is **not** preserved (form state resets on reason re-pick, since `CreateAdjustmentView` is a fresh mount).

INV-133 · **Pre**: an existing confirmed "رصيد افتتاحي" adjustment (opening balance). **Steps**: open detail. **Assert**: summary shows السبب="رصيد افتتاحي"; "تأثيرات هذه التسوية" effects card shows "ارتفعت قيمة المخزون..." (since direction IN) plus "لا تأثير على المورد أو العميل" and "ينشئ قيداً محاسبياً موازناً عند وجود فرق قيمة".

INV-134 · **Pre**: same opening-balance adjustment detail. **Steps**: click tab "المحاسبة". **Assert**: **a real journal entry renders** — a Dr/Cr table with account names and amounts (opening balance is the one reason with a GL mapping in `adjustmentGlAccountsForReason`); confirms the sub-ledger/GL link is real for this reason.

INV-135 · **GL gap — D2 — Pre**: a confirmed "تصحيح جرد" (PHYSICAL_COUNT reason) adjustment exists (created directly, or via Physical Counts §7's "توليد تسوية" flow). **Steps**: open its detail, click tab "المحاسبة". **Assert**: shows "لا يوجد قيد محاسبي لهذه التسوية (لا يوجد فرق قيمة)." — **this message is misleading**: there usually *is* a value difference (a nonzero variance), but no GL account mapping exists for `PHYSICAL_COUNT` in `adjustmentGlAccountsForReason`, so the 404 the tab receives is mis-read as "no value difference" rather than "no mapping configured." This is defect **D2** — the sub-ledger moved (check the item's Stock Balance before/after — quantity and average cost did change) while GL 1200 did not. Do not re-file; just confirm the exact symptom and move on.

INV-136 · **GL gap — Pre**: same as INV-135, but for any of DAMAGE / THEFT / EXPIRY / SHORTAGE / SUPPLIER_RETURN / OTHER. **Steps**: open detail → "المحاسبة" tab for a confirmed adjustment of one of these reasons. **Assert**: same "لا يوجد قيد محاسبي..." message — **every reason except `INITIAL_STOCK` posts no GL entry** in this build. This is the general form of D2 (the demo seed's two PHYSICAL_COUNT adjustments happen to net to zero across warehouses, which is *not* evidence this path is sound — see `docs/defects.md`).

INV-137 · **Pre**: confirmed adjustment detail. **Steps**: click tab "بنود التسوية". **Assert**: columns الصنف / الاتجاه (زيادة green / نقصان red pill) / الكمية / سعر التكلفة / القيمة; for lines whose value can't be resolved from the DTO it shows "يُحسب بمتوسط التكلفة الحالي" instead of a blank.

INV-138 · **Pre**: confirmed adjustment detail. **Steps**: read the banner below the summary. **Assert**: same one-way wording pattern as transfers — "لا يمكن إلغاء تسوية مؤكدة — ... لعكس الأثر، أنشئ تسوية جديدة بالاتجاه المعاكس." (implied by the shared `describeEffects`/status pattern — confirm the exact string rendered matches transfers' analogous notice).

INV-139 `[NOT IMPLEMENTED]` · Catalog describes the Items list's "تحديد الرصيد الافتتاحي" quick-action deep-linking into `/inventory/adjustments/new?itemId=...&reason=INITIAL_STOCK`. **Assert**: no such deep link exists anywhere in the build (see INV-022) — reaching the opening-balance form always goes through the full reason-picker flow.

INV-140 · **Pre**: list loaded. **Steps**: search by adjustment number, and separately filter by status chip. **Assert**: both work identically to Transfers (same `DocumentList` component, same filtering pattern).

---

## 7. الجرد الفعلي (Physical Counts) — `/inventory/physical-counts`

Backed by a real 4-state machine: قيد التنفيذ → مكتمل → تم إنشاء التسوية, plus ملغي.

INV-150 · **Pre**: list loaded. **Steps**: read stats/chips. **Assert**: إجمالي عمليات الجرد / قيد التنفيذ / مكتمل / تم إنشاء التسوية all present; a fifth chip ملغي also exists though its stat isn't in the header KPI row.

INV-151 · **Pre**: on list. **Steps**: انقر "جرد جديد". **Assert**: opens "جرد جديد" form; المستودع defaults to the first warehouse, التاريخ defaults to today, جرد أعمى toggle defaults **off**.

INV-152 · **Pre**: new-count form, warehouse selected. **Steps**: read the helper line. **Assert**: shows "سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية (N صنف)." where N = count of items with nonzero on-hand in that warehouse (`itemIds` is pre-computed from Stock Balance, filtered to `onHand !== 0`).

INV-153 · **Pre**: new-count form, a warehouse with **zero** nonzero-stock items selected (e.g. an empty/new warehouse). **Steps**: attempt "إضافة". **Assert**: button disabled (`itemIds.length === 0`) — a count cannot be started with no items to count.

INV-154 · **Pre**: new-count form. **Steps**: toggle "جرد أعمى" on, read its hint. **Assert**: hint reads "يُخفي كميات النظام عن القائم بالجرد حتى إنهاء الجلسة — الرصيد يُلتقط عند الفتح في الحالتين." — i.e. the system quantity snapshot is captured at open time regardless, only its *display* is withheld.

INV-155 · **Blind counting — the feature under test — Pre**: start a new count on WH-MAIN with جرد أعمى ON. **Steps**: land on the count-entry grid. **Assert**: a banner reads "جرد أعمى — كميات النظام والفروقات مخفية حتى إنهاء الجرد."; the table renders **without** the "النظام" (system qty) column and **without** the "الفرق" (variance) column at all — they are not present-but-masked, the `<th>`/`<td>` elements are conditionally omitted from the DOM entirely (`blindOpen ? null : <th>...`). This is real hiding, not CSS-only obscuring — the feature works as intended.

INV-156 · **Pre**: same blind count in progress. **Steps**: inspect the initial value of the "المعدود" input for each line. **Assert**: pre-fills to "0" for a blind count (not the real system quantity) — `count.blind ? "0" : (l.systemQty ?? "0")` — confirming the counter genuinely cannot infer system qty from a pre-filled input either.

INV-157 · **Pre**: start a new count with جرد أعمى OFF (plain/"visible" count). **Steps**: land on the entry grid. **Assert**: النظام and الفرق columns both render; المعدود pre-fills to the real system quantity for each line, and الفرق live-updates as the counted value is edited (computed client-side from the two scaled values).

INV-158 · **Pre**: count-entry grid, any mode. **Steps**: type a non-numeric value into a المعدود input (e.g. "abc"). **Assert**: `toScaled()` returns null for unparseable strings, so `allCounted` becomes false and "إنهاء الجرد" stays disabled until every line holds a valid decimal.

INV-159 · **Pre**: count-entry grid, in progress. **Steps**: انقر "حفظ ومتابعة لاحقاً" without finishing all lines. **Assert**: returns to the list, count status remains قيد التنفيذ — no data is submitted yet (this button only closes the local view, it does not call `recordCounts`).

INV-160 · **Pre**: a count left قيد التنفيذ (from INV-159). **Steps**: reopen it from the list (row click → detail). **Assert**: detail shows "متابعة الجرد" action (not "توليد تسوية") since status is still IN_PROGRESS; clicking it resumes the same entry grid with previously-typed local values lost (component remounts fresh from server state) — counted values not yet submitted via "إنهاء الجرد" do **not** persist across a resume.

INV-161 · **Pre**: count-entry grid, all lines given valid counted quantities (some matching system qty, some over, some under). **Steps**: انقر "إنهاء الجرد". **Assert**: calls `recordCounts` then `completePhysicalCount` in sequence; on success returns to the list; the count's status is now مكتمل.

INV-162 · **Pre**: a مكتمل count. **Steps**: open its detail. **Assert**: summary shows المستودع/التاريخ/عدد الأصناف/نوع الجرد (جرد أعمى or جرد ظاهر) plus أصناف بها فروقات, قيمة الزيادة (green), قيمة العجز (red), صافي قيمة الفرق (VarianceBeam-colored), التسوية الناتجة="—" (not yet generated).

INV-163 · **Pre**: same مكتمل count detail. **Steps**: click tab "بنود الجرد". **Assert**: full table — الصنف / النظام / المعدود / الفرق / تكلفة الوحدة / قيمة الفرق — is now visible for **every** line regardless of whether the count was blind (blindness only hides during entry, not on the finished record).

INV-164 · **Pre**: مكتمل count detail. **Steps**: انقر "توليد تسوية". **Assert**: calls `generateAdjustmentFromCount`; on success the count's status becomes تم إنشاء التسوية, التسوية الناتجة flips to "تم إنشاؤها", and a new Stock Adjustment record (reason `تصحيح جرد` / PHYSICAL_COUNT) is created and confirmed automatically — visible under Stock Adjustments.

INV-165 · **D2, concretely — Pre**: complete INV-164 for a count with a nonzero net variance (e.g. the seed's main-warehouse count with a genuine shortfall). **Steps**: open the generated adjustment's "المحاسبة" tab (per INV-135). **Assert**: "لا يوجد قيد محاسبي لهذه التسوية..." — the physical count correctly computed and applied the variance to stock quantity/value, but posted **no journal entry**, so GL 1200 and the inventory sub-ledger now disagree by exactly the variance value. This is the exact D2 symptom (measured elsewhere as 122.00) — confirm it reproduces, do not re-file.

INV-166 · **Pre**: generate-adjustment call fails server-side (simulate). **Steps**: انقر "توليد تسوية". **Assert**: error banner "تعذر توليد التسوية." (or server message) renders inside the detail card, above the lines table; status remains مكتمل, retry is possible.

INV-167 · **Pre**: list has counts across all 4 statuses (seed at least قيد التنفيذ/مكتمل/تم إنشاء التسوية; ملغي may be absent). **Steps**: click each status chip. **Assert**: filters correctly; searching by count number ("PC-"/"CNT-") also narrows the list.

INV-168 · **Pre**: list empty (fresh tenant). **Steps**: load screen. **Assert**: empty state "لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام."

---

## 8. المنتجات القابلة للتهيئة (Configurable Products) — `/manufacturing/configurable-products`

Nav-grouped under Inventory, routed and modeled under Manufacturing — matches the catalog's documented information-architecture oddity.

INV-170 · **Pre**: list loaded. **Steps**: read stats/chips الإجمالي/نشط/غير نشط. **Assert**: counts match seeded data.

INV-171 · **Pre**: on list. **Steps**: انقر "إضافة منتج قابل للتهيئة". **Assert**: SidePanel "منتج قابل للتهيئة جديد" opens; حفظ disabled until code, name, output item, ≥1 valid input row, and ≥1 valid material row are all present (`canSave`).

INV-172 · **Pre**: create panel. **Steps**: pick المنتج الناتج (output item), e.g. an item with base unit "كجم". **Assert**: وحدة المنتج النهائي field auto-fills to that item's base unit code.

INV-173 · **Pre**: create panel, one مدخلات التهيئة row. **Steps**: fill المعرف="width", التسمية="العرض", leave الحد الأدنى/الحد الأقصى blank. **Assert**: row is valid (min/max are optional — only id+label are required per `validInputs` filter); a click on "إضافة مدخل" adds another blank row; "حذف المدخل" appears once ≥2 rows exist.

INV-174 · **Pre**: create panel, materials section. **Steps**: انقر "إضافة خامة", pick a item via EntityPicker, type معادلة الكمية = "width*height/10000", نسبة الهالك % = 5. **Assert**: row is valid (`validMaterials` requires itemId + non-blank formula); "حذف الخامة" appears once ≥2 rows exist.

INV-175 · **Pre**: create panel, طريقة التسعير left at default "بدون — سعر يدوي". **Steps**: check for a معادلة السعر field. **Assert**: not rendered — the price-formula field only appears when طريقة التسعير = "معادلة".

INV-176 · **Pre**: create panel, طريقة التسعير switched to "معادلة", معادلة السعر left blank. **Steps**: attempt save. **Assert**: disabled — `canSave` requires a non-blank price formula whenever pricingMethod is "formula".

INV-177 · **Pre**: create panel, all required fields + one input + one material filled validly. **Steps**: fill معادلة تكلفة العمالة="width/10", معادلة التكاليف الإضافية="5", سياسة الأصناف left at default "صنف لكل أمر", save, **reload**. **Assert**: new product appears in the list; opening it shows all formulas preserved verbatim on the "التسعير والتكلفة" tab.

INV-178 · **Pre**: a saved configurable product open in detail. **Steps**: read the "effects" explainer. **Assert**: shows "المعادلات تُقيَّم عبر مُقيِّم آمن (Sandbox) — لا يستخدم eval إطلاقاً." and "كل أمر تصنيع مخصص يُقيّم هذه المعادلات..." — confirms formulas are sandboxed, not raw `eval`.

INV-179 · **Pre**: detail open. **Steps**: click tab "مدخلات التهيئة (N)". **Assert**: table shows المعرف/التسمية/الحد الأدنى/الحد الأقصى per input row.

INV-180 · **Pre**: detail open. **Steps**: click tab "خامات التصنيع (N)". **Assert**: table shows الصنف/معادلة الكمية/نسبة الهالك per material row.

INV-181 · **Pre**: detail open. **Steps**: click tab "التسعير والتكلفة". **Assert**: shows معادلة السعر (or "— (سعر يدوي)" if manual pricing), معادلة العمالة, معادلة المصاريف, each falling back to "—" when null.

INV-182 · **Pre**: an active configurable product open in detail. **Steps**: انقر "تعطيل". **Assert**: status flips to غير نشط; the تعطيل button disappears (only shown `status === "active"`); product remains visible under the "غير نشط" chip on the list.

INV-183 `[NOT IMPLEMENTED]` · Catalog describes a list row quick-action "أمر تصنيع مخصص جديد" that jumps straight into a pre-scoped custom-order creation, and a form section for التسمية بالعربية (Arabic label distinct from name) and نوع المنتج (product-type combobox). **Assert**: none of these three exist in the build — no per-row quick-create button on this list, no separate Arabic-label field, no product-type selector (the form has only code/nameAr/nameEn/output item/unit/description).

INV-184 · **Pre**: search box. **Steps**: search by code, then by (partial) name. **Assert**: both match (`code.includes` case-insensitive, `nameAr.includes` case-sensitive substring).

---

## 9. قوالب المنتجات (Product Templates) — `/inventory/product-templates`

Attribute-driven variant/SKU generator — distinct mechanism from Configurable Products (fixed enumerated SKUs vs. formula-computed made-to-order).

INV-190 · **Pre**: list loaded. **Steps**: read stats. **Assert**: single stat "إجمالي القوالب" only — no نشط/غير نشط breakdown stat exists here (unlike most other list screens), though a status pill still renders per row.

INV-191 · **Pre**: on list. **Steps**: انقر "قالب جديد". **Assert**: SidePanel opens with اسم المنتج*, الكود*, وحدة القياس الأساسية* (defaults "PCS"), السعر الافتراضي, التكلفة الافتراضية (both optional plain text, placeholder "0.00").

INV-192 · **Pre**: create panel, leave الكود blank. **Steps**: submit. **Assert**: alert "الكود والاسم ووحدة القياس مطلوبة." (single combined message covering all three required fields, not per-field).

INV-193 · **Pre**: create panel, all three required fields filled, prices left blank. **Steps**: submit, **reload**. **Assert**: template created with defaultSalePrice/defaultCost stored as null; newly-created template auto-opens (its SidePanel detail) immediately after creation (`setSelectedId(created.id)`).

INV-194 · **Pre**: a new template just created, its attribute panel open (attributes list empty). **Steps**: read empty state. **Assert**: "لا توجد خصائص بعد."

INV-195 · **Pre**: attribute panel, specification registry has ≥1 active "select"-type specification (from §3, e.g. SIZE). **Steps**: open "من سجل المواصفات" select. **Assert**: shows "خاصية خاصة بهذا القالب" plus each eligible specification as `nameAr (code)`; picking one switches the form to spec-linked mode (hides الاسم/القيم free-text inputs).

INV-196 · **Pre**: attribute panel, "من سجل المواصفات" left at "خاصية خاصة بهذا القالب" (i.e. blank spec code). **Steps**: leave اسم الخاصية blank, انقر "إضافة خاصية". **Assert**: alert "اسم الخاصية والقيم (مفصولة بفواصل) مطلوبة."

INV-197 · **Pre**: same, fill اسم الخاصية="اللون", القيم مفصولة بفواصل="أحمر, أزرق, أخضر". **Steps**: انقر "إضافة خاصية". **Assert**: new attribute card appears with 3 value chips; usageCount on any linked specification (if this had used one) would increment — this custom-typed attribute has no specification link, so no specification's usage count changes.

INV-198 · **Pre**: attribute panel, using "من سجل المواصفات" and picking SIZE. **Steps**: انقر "إضافة خاصية". **Assert**: succeeds without the free-text name/values inputs ever being shown; SIZE's usageCount on the Item Specifications screen (§3, INV-086) increments by 1, which is what later blocks its deletion there.

INV-199 · **Pre**: an attribute with 3 values exists. **Steps**: click the inline "+ قيمة" field next to the chips, type "أصفر", press Enter. **Assert**: adds a 4th value chip; the input clears and stays focused for rapid successive adds.

INV-200 · **Pre**: an attribute value chip. **Steps**: click its "×" remove button. **Assert**: value removed from that attribute; any variant already generated for a combination using that value is unaffected (deleting a value does not retroactively delete generated Items).

INV-201 · **Pre**: an attribute. **Steps**: click "حذف الخاصية". **Assert**: deletes the whole attribute — **no client-side guard against deleting an attribute already used by generated variants** was found in this screen (`[NOT IMPLEMENTED]` vs. catalog, which describes a disabled delete with tooltip "هذه الخاصية مستخدمة في N متغير — احذف المتغيرات أولاً"); if the server rejects it, `attrError` surfaces "تعذّر حذف الخاصية." instead.

INV-202 · **Pre**: a template with 2 attributes, sizes {S,M} × colors {أحمر,أزرق} = 4 combinations, 0 generated yet. **Steps**: read "توليد المتغيرات" heading. **Assert**: "4 تركيبة ممكنة، 0 موجودة بالفعل".

INV-203 · **Pre**: same, combination table rendered. **Steps**: check a combination's checkbox (e.g. S/أحمر), leave others unchecked. **Assert**: "توليد (1)" button label updates live to reflect selection count; combos already existing show a locked, checked, disabled checkbox with status pill "موجود" — cannot be unchecked or re-selected.

INV-204 · **Pre**: 1 combination selected. **Steps**: انقر "توليد (1)". **Assert**: calls generate-variants; on success, selection clears, the combination's row flips to "موجود"/disabled, and a new card appears under "المتغيرات (N)" showing the combo label and its generated SKU (itemCode) — a real Item was created (verify it now appears on the Items screen, §2, with a variant-style code).

INV-205 · **Pre**: all possible combinations already generated. **Steps**: check the "توليد المتغيرات" section. **Assert**: shows "تم توليد كل التركيبات الممكنة." beneath the table; every checkbox is locked "موجود".

INV-206 `[NOT IMPLEMENTED]` · Catalog describes a "تحديد الكل" (select-all) checkbox in the combination-table header, per-combination SKU/سعر البيع/التكلفة/الباركود preview columns, and — separately — an alternate-units section ("الوحدات البديلة") on the template form. **Assert**: none of these exist — the combination table only has a checkbox + التركيبة + الحالة columns (no per-row price/cost/barcode preview), there's no select-all, and Product Templates has no alternate-unit editor at all (unlike Items' own alternate-unit rows).

INV-207 · **Pre**: template with 0 attributes. **Steps**: check for the "توليد المتغيرات" section. **Assert**: not rendered at all (`selected.attributes.length > 0` guards the whole block) — matches catalog's expectation that variant generation needs at least one attribute defined first.

---

## 10. طباعة الملصقات (Label Printing) — `/inventory/labels`

Stateless print builder; barcode is rendered as a **real Code 128 SVG** via `bwip-js` (`bwipjs.toSVG({ bcid: "code128", ... })`), not placeholder text or an image.

INV-210 · **Pre**: on screen. **Steps**: read the disclaimer card. **Assert**: exact text "السعر المطبوع هو السعر الفعلي الذي تحسبه نقطة البيع للعميل العادي (بعد قوائم الأسعار والشرائح). الطباعة لا تغير أي سعر."

INV-211 `[NOT IMPLEMENTED]` · Catalog describes a صنف/مستند mode toggle (label items individually, or pull all lines from a document like a goods receipt). **Assert**: no mode toggle exists in the build — this screen only supports adding items individually via the "إضافة صنف" EntityPicker; there is no "by document" mode.

INV-212 · **Pre**: on screen. **Steps**: انقر "إضافة صنف", search "أرز", pick IT-0001. **Assert**: a row appears in the "الأصناف المختارة" table showing name, barcode (first registered barcode, or falling back to the item's code if it has none), printed price (from salePrice), عدد النسخ defaulting to 1; the item disappears from the picker's own options list (already-added items are excluded from re-selection).

INV-213 · **Pre**: one line added for an item **with no registered barcode**. **Steps**: check the الباركود column. **Assert**: falls back to displaying the item's code as the "barcode" value (`item.barcodes[0] ?? item.code`); the label tile preview will still attempt to render *something* as a Code 128 barcode for that code string.

INV-214 · **Pre**: one line added, item has a barcode whose encoded width exceeds the selected template's printable area. **Steps**: check for the fit warning. **Assert**: `line.messageAr` renders in red under the barcode cell — condition triggers from `buildLabelBatch`'s barcode-fit check (`checkBarcodeFit` in `@mezan/domain`) comparing barcode length against template dimensions; switching to a larger template (e.g. from THERMAL_40x30 to the largest option) should clear the warning if width was the limiting factor.

INV-215 · **Pre**: one line added. **Steps**: open قالب الملصق dropdown. **Assert**: exactly 3 options render, matching the catalog's documented templates (thermal 40×30mm default, shelf 50×25mm, product 100×50mm) — confirm exact labelAr text and default selection.

INV-216 · **Pre**: 2 lines added, copies set to 3 and 2 respectively. **Steps**: read "الإجمالي: N ملصق". **Assert**: N = 5 (sum of all copies across lines), matching `batch.totalLabelCount`.

INV-217 · **Pre**: a line's عدد النسخ QtyInput. **Steps**: attempt to set it below 1 or above 999. **Assert**: input is bounded `min={1} max={999} step={1}` — cannot go below 1 or above 999 via the control.

INV-218 · **Pre**: ≥1 item added, no blocking barcode-fit issues. **Steps**: check "معاينة وطباعة" button state. **Assert**: enabled (`!batch.hasBlockingIssues && batch.lines.length > 0`); clicking calls `window.print()` — this test does not need to complete an actual print, just confirm the button is reachable and not disabled.

INV-219 · **Pre**: 0 items added. **Steps**: check "معاينة وطباعة". **Assert**: disabled; table shows placeholder row "لم تتم إضافة أي صنف بعد."

INV-220 · **Pre**: ≥1 item queued with a blocking barcode-fit issue on the selected template. **Steps**: check "معاينة وطباعة". **Assert**: disabled even though items exist (`batch.hasBlockingIssues` short-circuits it) — printing is blocked until either the item is removed or a template that fits is chosen.

INV-221 · **Real Code 128 rendering — Pre**: an item with a known barcode value, e.g. "6221234567890" (assign via §2's item form if the seed item lacks one). **Steps**: add it to the label builder; inspect the rendered "معاينة الملصق" tile. **Assert**: an inline `<svg>` renders inside `.mz-label-barcode` (from `bwipjs.toSVG`) — this is a genuine Code 128 barcode encoding the exact barcode string, scannable by a real barcode reader, not a decorative image or plain text; if the barcode string is empty/whitespace-only, `renderBarcodeSvg` returns null and the tile shows "لا يوجد باركود" instead.

INV-222 · **Pre**: ≥7 items queued. **Steps**: check the "معاينة الملصق" preview panel. **Assert**: shows only the first 6 tiles (`lines.slice(0, 6)`) — this cap is a preview-only limit; the print sheet itself (`.mz-print-sheet`, rendered only under `@media print`) still includes every queued copy of every line, uncapped.

INV-223 · **Pre**: a line in the table. **Steps**: انقر "إزالة". **Assert**: line removed from both the table and (if within the first 6) the preview panel; the removed item reappears as selectable in the "إضافة صنف" picker.

---

## 11. هبوط قيمة المخزون (Inventory Writedowns) — `/inventory/writedown-runs`

**Not in either catalog file** — a build-only monthly aging-based write-down batch: Dr 5060 (write-down expense) / Cr 1190 (contra-asset provision), never touching the item's recorded WAC/cost layers. Documented in full; no `[NOT IMPLEMENTED]` markers apply to its existence.

INV-230 · **Pre**: on screen. **Steps**: read the description line under the title. **Assert**: exact text describing it as an optional monthly aging-based batch that provisions Dr expense / Cr provision "دون المساس بتكلفة المخزون المسجلة" — confirms it is deliberately non-invasive to WAC.

INV-231 · **Pre**: on screen. **Steps**: انقر "تشغيل عملية جديدة". **Assert**: SidePanel "تشغيل عملية هبوط قيمة جديدة" opens; السنة and الشهر default to the current calendar year/month; المستودع defaults to "كل المستودعات".

INV-232 · **Pre**: create form. **Steps**: type السنة = 1999. **Steps (cont.)**: submit. **Assert**: alert "السنة غير صحيحة." (valid range enforced 2000–2100).

INV-233 · **Pre**: create form. **Steps**: type الشهر = 13 or 0. **Steps (cont.)**: submit. **Assert**: alert "الشهر يجب أن يكون بين 1 و12."

INV-234 · **Pre**: create form, year/month valid, warehouse left "كل المستودعات". **Steps**: انقر "تشغيل", **reload**. **Assert**: new run appears in the list with period formatted `YYYY-MM`, status مسودة, warehouse showing "كل المستودعات".

INV-235 · **Pre**: same, but with a specific warehouse chosen instead. **Steps**: run and reload. **Assert**: warehouse column shows that warehouse's name instead of "كل المستودعات".

INV-236 · **Pre**: a draft (مسودة) run in the list. **Steps**: انقر the row's "ترحيل" button. **Assert**: button shows "جارٍ الترحيل..." while pending, disabled during that time; on success status flips to مرحل and a journal-entry id appears in the row's action cell (replacing the ترحيل button, since it now only renders for drafts).

INV-237 · **Pre**: posting fails server-side (simulate, e.g. a period already posted for that warehouse — idempotency guard). **Steps**: انقر "ترحيل". **Assert**: a page-level card shows the error message (`postError`), status remains مسودة, the row stays actionable for retry.

INV-238 · **Pre**: a posted run. **Steps**: click its row (opens SidePanel, not a full detail page). **Assert**: shows status pill مرحل, الفترة/المستودع/تاريخ الإنشاء/تاريخ الترحيل, قيمة المخصص الإجمالية (large money figure) with قيد اليومية id beneath it, and a per-item breakdown table (الصنف/أيام التقادم/نسبة المخصص/المبلغ).

INV-239 · **Pre**: the per-item breakdown table (INV-238). **Steps**: read the "الصنف" column values. **Assert**: renders the raw internal item **id** string, not the resolved item name — this screen has no item-name lookup for write-down lines (unlike every other inventory screen, which resolves `itemId` through `useItems()`); worth flagging as a display gap even though the underlying data is correct.

INV-240 · **Pre**: empty tenant, no runs yet. **Steps**: load screen. **Assert**: empty state "لا توجد عمليات هبوط قيمة — لم يتم تشغيل أي عملية بعد."

INV-241 · **Pre**: create form open, unsaved. **Steps**: انقر "إلغاء". **Assert**: closes without creating a run.

---

## 12. مركز التصنيع (Manufacturing Hub) — `/manufacturing/hub`

INV-250 · **Pre**: navigate to Manufacturing → مركز التصنيع. **Steps**: read the 4 KPI tiles. **Assert**: أوامر تصنيع نشطة / قيمة الإنتاج تحت التشغيل / الوحدات المنتجة هذا الشهر / متوسط تكلفة الوحدة — all sourced from the same `/manufacturing/dashboard` payload the Production Dashboard (§13) uses (no client-side recomputation).

INV-251 · **Pre**: on hub. **Steps**: click each quick action — "أمر تصنيع جديد", "لوحة الإنتاج", "قوائم المواد", "التصنيع المخصص". **Assert**: navigates to Work Orders / Production Dashboard / BOMs / Config Instances respectively.

INV-252 · **Pre**: on hub. **Steps**: read "أوامر التصنيع النشطة" card. **Assert**: shows up to 5 active orders with number, priority label, produced/planned fraction, and either a "متأخر" (danger) or `{progress}%` (info) pill; a subtitle line reads "N أمر متأخر عن الموعد المجدول"; "عرض لوحة الإنتاج الكاملة" navigates to §13.

INV-253 · **Pre**: dashboard API errors. **Steps**: load hub. **Assert**: card "تعذّر تحميل بيانات التصنيع." renders; KPI values fall back to "—".

---

## 13. لوحة الإنتاج (Production Dashboard) — `/manufacturing/dashboard`

Exception/action dashboard, no filters — matches the catalog's description closely.

INV-260 · **Pre**: on screen. **Steps**: read the 4 KPI cards. **Assert**: أوامر نشطة / قيمة الإنتاج تحت التشغيل / الوحدات المنتجة هذا الشهر / أوامر متأخرة (the last rendered in danger-red text when >0, plain ink otherwise).

INV-261 · **Pre**: seed has WO-DEMO-1/2/3 at various stages. **Steps**: read the three bucket cards "بانتظار صرف المواد", "بانتظار استلام المنتج", "جاهزة للإنهاء". **Assert**: each order chip shows its number, a "متأخر" pill if overdue, and a produced/planned + priority line; a bucket with no orders shows "لا توجد أوامر في هذه المرحلة."

INV-262 · **Pre**: on screen. **Steps**: read "جميع الأوامر النشطة" table. **Assert**: columns الأمر / التقدّم (% + fraction) / الأولوية / الموعد المجدول / الإجراء التالي; the last column renders a labeled button (بدء التنفيذ / صرف المواد / استلام المنتج / إنهاء الأمر per `NEXT_ACTION_LABEL`) that navigates to Work Orders when clicked — it does **not** perform the action inline from this screen, only deep-links.

INV-263 · **Pre**: header. **Steps**: click "أوامر التصنيع" and "قوائم المواد" buttons. **Assert**: navigate to §14 and §15 respectively.

INV-264 · **Pre**: zero active work orders. **Steps**: check the table area. **Assert**: "لا توجد أوامر تصنيع نشطة حالياً."

---

## 14. أوامر التصنيع (Work Orders) — `/manufacturing/work-orders`

**`completeWorkOrder` never posts to GL 1200 (defect D3).** Any scenario that
runs a work order through to completion will unbalance the books — run on a
throwaway database, and never immediately before a reconciliation scenario.

### List

INV-270 · **Pre**: list loaded (WO-DEMO-1/2/3 seeded). **Steps**: read stats. **Assert**: الإجمالي / مخطط / جار التنفيذ / متأخر (the last valueTone="danger" when >0).

INV-271 · **Pre**: list loaded. **Steps**: click each status chip الكل/مخطط/قيد التنفيذ/مكتمل/ملغي. **Assert**: filters by exact status match — note there is **no** separate "متأخر" filter chip on this screen (unlike the catalog's documented "متأخر" derived chip) — overdue is only shown as the KPI card + a badge on rows, not filterable via chip; the header stat "متأخر" links nowhere.

INV-272 · **Pre**: list loaded. **Steps**: search by WO number ("WO-"), and separately by (partial) product name. **Assert**: both match.

INV-273 · **Pre**: list loaded. **Steps**: click a row (anywhere). **Assert**: opens that work order's own detail page directly — **unlike the catalog's documented UX quirk** (row click opens the *product's* item quick-view, requiring the kebab menu to reach the WO itself), the build's row click goes straight to the work order detail; there is no separate product quick-view and no kebab menu at all on this list.

INV-274 `[NOT IMPLEMENTED]` · Catalog describes a row kebab menu with عرض / تكرار أمر التصنيع (duplicate) / إلغاء أمر التصنيع (cancel). **Assert**: none exist — rows have no menu, no duplicate action, and **no cancel action anywhere in the build** (`ملغي` is a defined status/chip with presumably 0 rows, but no UI path sets it).

### Create

INV-280 · **Pre**: on list. **Steps**: انقر "أمر عمل جديد". **Assert**: SidePanel "أمر عمل جديد" opens; قائمة المواد* EntityPicker only lists **active** BOMs (`boms.filter(b => b.status === "active")`); الأولوية defaults "عادية"; تاريخ البدء defaults to today; الكمية المخططة defaults 1.

INV-281 · **Pre**: create form, BOM unselected. **Steps**: attempt "حفظ أمر العمل". **Assert**: disabled — `canSave` requires `bom !== null`.

INV-282 · **Pre**: create form, BOM selected, الكمية المخططة set to 0. **Steps**: attempt save. **Assert**: disabled — `plannedQty > 0` required.

INV-283 · **Pre**: create form. **Steps**: attempt to type a negative number into الكمية المخططة. **Assert**: input has `min={0}`; a negative value fails `> 0` and حفظ stays disabled.

INV-284 · **Pre**: create form, BOM selected, مستودع الخامات or مستودع المنتجات left unpicked. **Steps**: attempt save. **Assert**: disabled — both warehouse EntityPickers are required.

INV-285 · **Pre**: create form, all required fields valid: BOM=BOM-DEMO-1 (IT-0005), الكمية المخططة=10, مستودع الخامات=WH-MAIN, مستودع المنتجات=WH-MAIN. **Steps**: leave تاريخ الانتهاء المتوقع blank, save, **reload**. **Assert**: new order appears in list with status مخطط, stage "not_started"; scheduledEndDate stored as null (does not default to start date).

### Stage machine

INV-290 · **Pre**: a newly-created order at stage not_started (status مخطط). **Steps**: open its detail; read المرحلة الحالية stepper and the primary action button. **Assert**: stepper shows بدء العمل as the current step; action button reads "بدء العمل" (from `STAGE_ACTION.not_started`).

INV-291 · **Pre**: same order. **Steps**: انقر the action button. **Assert**: calls `startWorkOrder`; on success status becomes قيد التنفيذ, stage becomes "started", stepper advances, and the action button now reads "صرف المواد".

INV-292 · **Pre**: order at stage started. **Steps**: انقر "صرف المواد". **Assert**: calls `issueWorkOrderMaterials` directly (**no confirmation/quantity dialog** — issuing is all-or-nothing against the BOM's required quantities, unlike the catalog's described partial-issue behavior); on success stage becomes "materials_issued", action label becomes "استلام المنتج"; check the "المواد" tab — الصادرة (issued) column now reflects the full required quantity per line.

INV-293 · **Pre**: order at stage materials_issued. **Steps**: انقر "استلام المنتج". **Assert**: unlike the two prior stages, this opens a SidePanel "استلام المنتج" (asks for الكمية المنتجة, prefilled to the order's plannedQty) rather than acting immediately — the only stage transition with an intermediate form.

INV-294 · **Pre**: receive-product panel open, الكمية المنتجة set to 0. **Steps**: attempt "تأكيد الاستلام". **Assert**: disabled (`receiveQty <= 0`).

INV-295 · **Pre**: receive-product panel, الكمية المنتجة changed to a value **less than** plannedQty (e.g. 8 of 10 planned, a partial/short receipt). **Steps**: تأكيد الاستلام. **Assert**: succeeds — receiving under the planned quantity is allowed (no minimum-equal-to-planned guard found); order's produced qty updates to 8, progress fraction reflects 8/10, stage becomes "product_received".

INV-296 · **Pre**: order at stage product_received. **Steps**: انقر "إكمال أمر العمل". **Assert**: calls `completeWorkOrder`; on success status becomes مكتمل, stage "completed", the action button disappears (`STAGE_ACTION.completed === null`).

INV-297 · **D3, concretely — Pre**: capture GL 1200's balance and the item's Stock Balance value for the finished product (IT-0005) immediately before INV-296. **Steps**: complete the order per INV-296 with a known material cost (e.g. BOM-DEMO-1 at qty 10 — the demo's own measured case is 80.00). **Steps (cont.)**: re-check GL 1200's balance and the finished-product's on-hand value after completion. **Assert**: the finished product's Stock Balance value **increased** by the WIP-capitalized amount (materials + labor + overhead consumed), but GL 1200 did **not** move by the same amount — the sub-ledger and GL now disagree by exactly the material cost consumed. This is defect D3; confirm the exact discrepancy amount and stop — **do not run any reconciliation-assertion scenario against this same database afterward** without first resetting it.

INV-298 · **Pre**: same completed order detail. **Steps**: read the "effects" explainer text at the top of the detail page. **Assert**: it states "...وعند الإكمال تُرحَّل قيود رسملة الإنتاج تحت التشغيل تلقائياً" (on completion, WIP-capitalization journal entries are posted automatically) — **this claim is false per D3**: no such journal entry is posted to GL 1200. The UI's own copy overstates what the backend does; worth noting precisely, not filing as a second defect.

INV-299 · **Pre**: any order detail, any stage. **Steps**: click tab "المواد". **Assert**: columns الصنف/المطلوبة/الصادرة/المرجعة/الصافي — no "النقص" (shortage) column was found in the code (`[NOT IMPLEMENTED]` vs. the catalog, which lists a shortage column too).

INV-300 · **Pre**: same order detail. **Steps**: click tab "التكاليف". **Assert**: shows تكلفة المواد / العمالة / المصاريف / إجمالي الإنتاج تحت التشغيل as a 2×2 definition list — figures accumulate as the order progresses through material issue.

INV-301 `[NOT IMPLEMENTED]` · Catalog describes an "إجراءات إضافية" card with تسجيل تكلفة (log cost, enabled early) / صرف إضافي / إرجاع مواد / تسجيل فاقد (extra issue / return materials / log waste, gated by stage), a "صفحة التنفيذ" (execution page) button, and tabs استخدام المواد / حركة المواد / الاستلامات / القيود المحاسبية / السجل. **Assert**: none exist in the build — the only actions are the single stage-advance button plus the create/receive panels; only المواد and التكاليف tabs are present. Critically, **there is no "القيود المحاسبية" (journal entries) tab anywhere on Work Orders** — confirms D3 is invisible from the UI itself, not just under-tested.

INV-302 · **Pre**: header stats. **Steps**: check "متأخر" count computation. **Assert**: derived client-side as `status in {in_progress, planned} && scheduledEndDate !== null && scheduledEndDate < today()` — an order with no scheduledEndDate set (per INV-285) can never count as overdue regardless of age.

---

## 15. قوائم المواد (BOMs) — `/manufacturing/boms`

The recipe template a Work Order is built from — no stock/GL impact of its own.

INV-310 · **Pre**: list loaded (BOM-DEMO-1/2 seeded). **Steps**: read stats/chips. **Assert**: الإجمالي/نشط/غير نشط.

INV-311 · **Pre**: on list. **Steps**: انقر "قائمة مواد جديدة". **Assert**: SidePanel opens; picking المنتج النهائي auto-fills الوحدة to that item's base unit.

INV-312 · **Pre**: create form, المنتج النهائي unselected. **Steps**: attempt "حفظ قائمة المواد". **Assert**: disabled — `canSave` requires a product plus ≥1 line with a non-blank item and qty>0.

INV-313 · **Pre**: create form, product picked, all material lines left with blank items or qty=0. **Steps**: attempt save. **Assert**: disabled — `lines.some(l => l.itemId !== "" && l.qty > 0)` fails.

INV-314 · **Pre**: create form. **Steps**: type a negative تكلفة العمالة or تكلفة المصاريف الإضافية. **Assert**: both NumberFields have `min={0}` — negative labor/overhead cost cannot be submitted via the spinner controls.

INV-315 · **Pre**: create form, one material line, نسبة الهالك % set to 20, الكمية set to 10. **Steps**: save, open detail, check the لines tab's "الكمية بعد الهالك" column. **Assert**: shows 12.00 (`effectiveQty = qty × (1 + wastePercent/100)` = 10 × 1.20).

INV-316 · **Pre**: create form, valid product + ≥1 line, "إضافة صنف" clicked to add a second material line for a different item. **Steps**: save, **reload**. **Assert**: BOM appears in list with عدد البنود=2, and both lines persist with their individual qty/waste values.

INV-317 · **Pre**: BOM detail open. **Steps**: read summary. **Assert**: shows المنتج النهائي, الإصدار (starts at 1 for a first-time product), الكمية القياسية, عدد البنود, تكلفة المواد, إجمالي التكلفة, تكلفة الوحدة — all computed server-side (`bom.estimate`).

INV-318 · **Pre**: BOM detail open. **Steps**: read the "effects" explainer. **Assert**: exact 3 lines — "قائمة المواد وصفة تصنيع فقط — لا تؤثر على المخزون أو الحسابات حتى يُنشأ أمر تصنيع منها.", "الكمية المطلوبة تُضخَّم تلقائياً بنسبة الهالك...", "إنشاء إصدار جديد يُلغي تنشيط الإصدار السابق (لا يُعدّله)."

INV-319 · **Versioning — Pre**: an active BOM for product IT-0006 (e.g. BOM-DEMO-2, v1, نشط). **Steps**: create a **new** BOM for the same product IT-0006 (different material lines/qty) and save. **Assert**: per the effects text in INV-318, the new BOM should post as v2 نشط and the prior v1 should flip to غير نشط automatically. **Verify this actually happens** (open both BOM detail pages and check status pills / version numbers) — the effects copy is a claim about backend behavior the UI itself does not enforce or display a warning about, so confirm it rather than trusting the label.

INV-320 · **Pre**: an active BOM. **Steps**: open detail, انقر "تعطيل". **Assert**: status flips غير نشط; the button disappears; a work order can no longer select this BOM (per INV-280's active-only filter).

INV-321 `[NOT IMPLEMENTED]` · Catalog describes a "سجل الإصدارات" (version history) tab and "اختياري" (optional-material) checkbox per line, plus a "ملاحظات" per-line notes field. **Assert**: none exist in the build — only "بنود المواد الخام" tab is present (no version-history tab), and lines have no optional flag or per-line notes field (only item/qty/waste%).

INV-322 · **Pre**: BOM detail. **Steps**: check for a "أمر عمل جديد" shortcut button on the BOM detail page (catalog describes one). **Assert**: `[NOT IMPLEMENTED]` — the build's BOM detail has no such button; creating a work order from a BOM requires going to Work Orders' own "أمر عمل جديد" form and picking the BOM there (§14, INV-280) rather than a BOM-scoped shortcut.

---

## 16. التصنيع المخصص (Custom Manufacturing / Config Instances) — `/manufacturing/config-instances`

Make-to-order execution layer pairing with Configurable Products (§8); each instance can auto-spawn a linked Work Order.

INV-330 · **Pre**: list loaded. **Steps**: read stats/chips. **Assert**: الإجمالي, مهيأة, في التنفيذ (combines `in_progress` **and** `produced` statuses in its count, matching the catalog's documented "تم الإنتاج is a sub-state of في التنفيذ"), مغلقة; a 5th chip ملغاة also filters but isn't in the KPI row.

INV-331 · **Pre**: on list. **Steps**: انقر "أمر تصنيع مخصص جديد". **Assert**: SidePanel opens; المنتج* EntityPicker only lists **active** configurable products.

INV-332 · **Pre**: create form, product unselected. **Steps**: check "معاينة الاحتياجات والتكلفة" panel. **Assert**: shows "أنشئ أمرًا جديدًا باختيار منتج قابل للتهيئة وإدخال المواصفات."

INV-333 · **Pre**: create form. **Steps**: pick a configurable product with 2 config inputs (e.g. width/height). **Assert**: a "المواصفات" sub-card appears with one text field per input, each labeled `{labelAr} ({min} – {max})` when min/max are set, else just `{labelAr}`.

INV-334 · **Pre**: create form, product picked, one spec input left blank. **Steps**: check حفظ button state. **Assert**: disabled — `canSave` requires every product input to have a non-blank spec value.

INV-335 · **Pre**: create form, product picked, all spec inputs filled with valid values. **Steps**: observe the preview panel. **Assert**: a `useEffect` auto-fires `preview.mutate` as soon as every input is non-blank (no manual "preview" button) — panel shows "جارِ الحساب…" then a live materials breakdown (item × effective qty × unit cost = line cost) plus تكلفة الوحدة and, if the product uses formula pricing, السعر المقترح.

INV-336 · **Pre**: preview panel showing a computed breakdown. **Steps**: change one spec input value. **Assert**: preview recomputes automatically (effect re-fires on `spec` change) — no stale data lingers from the prior input.

INV-337 · **Pre**: preview computation fails server-side (e.g. formula references an out-of-bounds input value). **Steps**: observe panel. **Assert**: shows the server's error message directly (`preview.error.message`) in red, in place of the breakdown.

INV-338 · **Pre**: create form, product+specs valid. **Steps**: leave سعر البيع (للوحدة) blank, leave العميل at "بدون عميل", fill مستودع الخامات and مستودع المنتجات, save. **Assert**: sellUnitPrice submits as null (product's own pricing formula/manual price governs instead); order created with status مهيأة (configured).

INV-339 · **Pre**: create form, sourceWarehouse or destinationWarehouse left unpicked. **Steps**: attempt save. **Assert**: disabled — both are required per `canSave`.

INV-340 · **Pre**: create form, الكمية set to 0. **Steps**: attempt save. **Assert**: disabled — `qty > 0` required.

INV-341 · **Pre**: valid order created. **Steps**: open its detail. **Assert**: summary shows المنتج, العميل ("بدون عميل" if none), الكمية, المواصفات (rendered as `key=value | key=value`), إجمالي البيع, هامش الربح (colored danger if negative, success if positive — computed client-side as sellTotal − actualCost, falling back to estimatedUnitCost×qty when actualCost is still null).

INV-342 · **Pre**: same detail. **Steps**: read the "effects" explainer. **Assert**: "يُنشأ أمر تصنيع (Work Order) مرتبط تلقائياً عند إنشاء أمر التصنيع المخصص..." and "عند إغلاق الأمر تُحفظ التكلفة الفعلية من أمر التشغيل المرتبط." — confirm a real linked Work Order id shows on the "التكلفة الفعلية" tab (أمر التشغيل row) and that it is genuinely a separate, navigable Work Order record (cross-check on §14's list).

INV-343 · **Pre**: order detail, status not yet closed/cancelled. **Steps**: انقر "إغلاق الأمر". **Assert**: calls `closeConfigInstance`; on success status becomes مغلقة, actual cost pulled from the linked work order populates "التكلفة الفعلية" (no longer "—"), and both الإغلاق/الإلغاء buttons disappear (only shown while `canAct`).

INV-344 · **Pre**: order detail, open. **Steps**: انقر "إلغاء" instead. **Assert**: status becomes ملغاة; same button-disappearance behavior.

INV-345 · **Pre**: closing/cancelling fails server-side. **Steps**: attempt either action. **Assert**: an alert banner renders above the detail ("تعذّر إغلاق الأمر."/"تعذّر إلغاء الأمر.") without navigating away; instance stays actionable for retry.

INV-346 · **Pre**: order detail. **Steps**: click tab "الخامات المطلوبة (N)". **Assert**: table الصنف/الكمية (للوحدة)/نسبة الهالك/الإجمالي.

INV-347 · **Pre**: order detail. **Steps**: click tab "التكلفة الفعلية". **Assert**: shows تكلفة المواد/العمالة/المصاريف (all per-unit), التكلفة التقديرية (للوحدة), التكلفة الفعلية ("—" until closed), أمر التشغيل (linked WO id).

INV-348 `[NOT IMPLEMENTED]` · Catalog describes list row quick-action "أمر التشغيل" jumping directly to the linked work order, and a kebab menu with عرض. **Assert**: neither exists on this build's list — rows have no menu and no per-row jump-to-WO shortcut; reaching the linked work order requires opening the instance detail first and separately navigating to Work Orders (§14) with the id read from the "التكلفة الفعلية" tab (INV-347) — there is no clickable link on that id either, it's plain text.

INV-349 · **Pre**: list search. **Steps**: search by order number, product name, and customer name in turn. **Assert**: all three match per the `filtered` predicate.

---

## 17. سيناريوهات عابرة للشاشات (Cross-cutting)

INV-360 · **Reconciliation baseline — Pre**: a fresh demo-seeded database, no additional actions taken (i.e. before running any D2/D3-triggering scenario above). **Steps**: total the inventory sub-ledger (sum of Stock Balance's "القيمة الإجمالية" across all items) and compare to GL account 1200's balance. **Assert**: the two figures match exactly — this is the documented baseline the task brief asserts ("The inventory sub-ledger reconciles to GL 1200 exactly on seeded data"). Run this **first**, before any other scenario in this file that posts adjustments/completes work orders, so a later mismatch can be attributed to a specific scenario rather than pre-existing drift.

INV-361 · **Transfer neutrality, company-wide — Pre**: baseline value from INV-360. **Steps**: perform any confirmed transfer (§5). **Assert**: reconciliation from INV-360 still holds exactly — transfers must never move the sub-ledger/GL relationship, only redistribute value between warehouses.

INV-362 · **Adjustment reconciliation break — Pre**: baseline value from INV-360 (re-run after INV-361 if that scenario ran). **Steps**: confirm any Stock Adjustment whose reason is **not** `رصيد افتتاحي` (§6). **Assert**: the sub-ledger total changes by the adjustment's value, GL 1200 does not — reconciliation now shows a gap equal to that adjustment's value. This is D2's general form (INV-136); confirm and record the gap amount, then treat the database as dirty for further reconciliation scenarios.

INV-363 · **Work order reconciliation break — Pre**: a clean/reset database (do not chain onto INV-362's already-dirty state, to keep the measured gap attributable). **Steps**: complete any work order through all 4 stages (§14, INV-290–296). **Assert**: reconciliation breaks by exactly the material cost consumed (D3, INV-297) — record the gap, then discard/reset this database rather than continuing further scenarios against it.

INV-364 · **FEFO — earliest-expiry-first, even when received last — Pre**: IT-0007 (لبن كامل الدسم) has two batches from the seed: `MLK-2607` (received 2026-07-28, expires 2026-10-20, qty 150, cost 27) and `MLK-2708` (received **later**, 2026-08-06, but expires **earlier**, 2026-09-05, qty 100, cost 29). **Steps**: create and confirm a Stock Adjustment (§6) with reason "نقص / فقدان" (or "أخرى"/OUT direction), item IT-0007, warehouse matching where these batches sit, quantity ≤100 (so it fits inside the smaller/earlier-expiring batch alone). **Assert**: open the confirmed adjustment's "بنود التسوية" tab and read سعر التكلفة for that line — it should read **29.00** (MLK-2708's cost), not 27.00 (MLK-2607's cost) — proving the engine consumed the earliest-expiring batch first even though it was received second. This is the only UI-observable way to verify FEFO in this build: **there is no batch/lot visibility screen anywhere** (no cost-layers tab on Items — INV-066 — no batch column on Stock Balance — INV-094 — no batch picker on Transfers/Adjustments lines), so batch selection is entirely implicit in the server-computed unit cost shown after confirmation.

INV-365 · **FEFO — spillover across batches — Pre**: same item, but issue a quantity **greater than** the smaller/earlier-expiring batch (e.g. 130 of the 100-qty MLK-2708). **Steps**: confirm an OUT adjustment for qty 130. **Assert**: the resulting line's سعر التكلفة reflects a blended cost across both batches (100 units at 29.00 from MLK-2708, then 30 units at 27.00 from MLK-2607) rather than a single flat rate — confirms FEFO correctly spills over to the next-earliest-expiring batch once the first is exhausted, not just "always cheapest" or "always first-created."

INV-366 · **Pure FIFO for non-expiry items — Pre**: choose a plain, non-batch-tracked item with two purchase receipts at different unit costs and dates (e.g. IT-0001 أرز أبيض, purchased at 140 on 2026-07-06 — check for a second, later receipt at a different cost if the seed has one; if not, create one via an IN-direction adjustment at a distinct cost before running this scenario). **Steps**: issue a quantity that only partially drains the first (earliest-received) cost layer via an OUT adjustment. **Assert**: the consumed unit cost matches the **earliest-received** layer's cost (pure FIFO by receipt order, since there is no expiry date to override it) — contrast directly with INV-364/365, where expiry date overrides receipt order.

INV-367 · **Blind counting integrity — Pre**: none. **Steps**: re-run INV-155 and additionally attempt to derive the system quantity indirectly during a blind count — e.g. open a second browser tab to Stock Balance (§4) while the blind count is قيد التنفيذ. **Assert**: Stock Balance (a separate, always-visible screen) **does** still show the live system quantity — blindness is scoped to the count-entry grid's own columns only, not a tenant-wide freeze of stock visibility. This is expected (the catalog/brief's "blind counting must hide the system quantity **while counting**" refers to the count session's own UI, not every other screen) — write this down as confirmed-expected, not a leak, but flag it explicitly so nobody mistakes Stock Balance's normal visibility for a blind-count bypass bug.

INV-368 · **Label barcode scan-check — Pre**: an item with barcode "6221234567890" queued in Label Printing (§10, INV-221). **Steps**: export/screenshot the rendered SVG tile and decode it with a real Code 128 reader (or a barcode-decoding library) against the source string. **Assert**: the decoded value exactly matches "6221234567890" — the SVG is not merely barcode-*shaped* decoration, it is a correctly-encoded, scannable Code 128 symbol for the real item barcode, per `bwipjs.toSVG`'s Code 128 encoder.

INV-369 · **Reason-picker completeness — Pre**: none. **Steps**: open the Stock Adjustments reason picker (§6, INV-121) and count the cards. **Assert**: exactly 8 cards render, in the exact order and wording transcribed in `packages/domain/src/inventory/reasons.ts` (رصيد افتتاحي, تصحيح جرد, تلف, سرقة, انتهاء صلاحية, نقص / فقدان, مرتجع للمورد, أخرى) — matches the catalog's documented reason list verbatim; this is one of the very few areas where the build's data model is a *complete* match to the reference product rather than a reduced subset.

---

## Summary of `[NOT IMPLEMENTED]` gaps (catalog → build)

Grouped by screen, for quick reference — each also appears inline above as its
own scenario:

- **Items**: no image upload, primary-supplier/season fields, POS-visibility
  toggle, kitchen-waste toggle, description field, inline category/brand
  creation; item type is a 2-option dropdown (منتج/خدمة) not the catalog's
  6-type button group; no cost-layers table, no landed-cost log, no
  attachments tab, no audit-log tab; no row kebab menu (edit icon only), no
  opening-balance shortcut, no "تصنيفات الأصناف" management dialog, no
  detail-page quick actions or more-menu; no low-stock/out-of-stock filter
  chips or attention banner; no price-range filters or hide-variants
  checkbox; no page-size selector (fixed at 5/page).
- **Stock Balance**: no filter chips/panel/attention banner, no reorder-point
  column.
- **Stock Transfers**: no draft-then-confirm two-step flow (auto-confirms on
  save); no attention banner; no available-stock column; no Excel import; no
  attachments/audit-log tabs.
- **Stock Adjustments**: no opening-balance deep link from Items; GL posting
  exists for only 1 of 8 reasons (D2, confirmed not re-filed).
- **Physical Counts**: matches the catalog closely; D2 applies to its
  generated adjustments.
- **Configurable Products**: no list-row quick-create-order action, no
  Arabic-label field, no product-type selector.
- **Product Templates**: no attribute-in-use delete guard, no select-all on
  variant generation, no per-combination price/cost/barcode preview columns,
  no alternate-units editor, no per-template نشط/غير نشط stat breakdown.
- **Label Printing**: no by-document mode (item mode only).
- **Work Orders**: no row kebab menu (no duplicate, no cancel anywhere in the
  build), no partial-issue dialog, no "صفحة التنفيذ", no
  extra-issue/return-materials/log-waste actions, no
  استخدام المواد/حركة المواد/الاستلامات/القيود المحاسبية/السجل tabs — **no GL
  tab at all**, which is why D3 is invisible from the UI; no shortage ("النقص")
  column on the materials tab; no overdue filter chip.
- **BOMs**: no version-history tab, no per-line optional/notes fields, no
  BOM-scoped "new work order" shortcut.
- **Custom Manufacturing**: no row kebab menu, no list-row jump-to-linked-WO
  shortcut.
- **Inventory Hub**: no workspace tile grid, no recent-movements panel.

No `[NOT IMPLEMENTED]` markers apply to **Item Specifications** or **Inventory
Writedowns** — both are build-only additions absent from the catalog
entirely, documented here on their own terms.
