# Mezan (ميزان) — Enhancement Workflows (Beyond Parity)

> **These are ENHANCEMENT workflows beyond 1:1 parity with the reference app.** They live **only on the `enhancements` branch**, which **tracks `main`** (parity). Nothing here is merged into `main`.
>
> Each workflow is end-to-end and step-by-step, with **bilingual screen names** (English / العربية). Screen names in **bold** are net-new or materially-changed surfaces introduced by an enhancement; plain names are existing parity screens. Each workflow cites the requirements it realizes (`ENH-###`, see `requirements.md`).

---

## Index

| ID | Workflow | Personas | Realizes |
|---|---|---|---|
| WF-01 | Owner morning glance & anomaly response | Business Owner | ENH-001, ENH-002, ENH-004 |
| WF-02 | Guided month-end close | Chief Accountant | ENH-010, ENH-012 |
| WF-03 | Smart bank reconciliation | Chief Accountant | ENH-011 |
| WF-04 | ETA e-invoice pre-validation & bulk resubmit | Accountant, Compliance | ENH-011b |
| WF-05 | Scanner-driven physical stock count | Warehouse Manager | ENH-020 |
| WF-06 | Receiving with batch/expiry & FEFO dispatch | Warehouse Manager | ENH-021 |
| WF-07 | Reorder suggestion → draft PO | Warehouse Manager | ENH-022 |
| WF-08 | Van load-out & end-of-day settlement | Warehouse Manager, Sales | ENH-023 |
| WF-09 | Fast-lane POS sale with in-till discount approval | Cashier, Retail Lead | ENH-030, ENH-031, ENH-032 |
| WF-10 | Shift open/close & cash-drawer reconciliation | Cashier, Retail Lead | ENH-033 |
| WF-11 | Lead → opportunity → quote → won (pipeline) | Sales Manager | ENH-040, ENH-041, ENH-042 |
| WF-12 | Automated AR dunning & collections | Sales Manager, Accountant | ENH-043 |
| WF-13 | SoD-guarded maker-checker payment | Compliance, Accountant | ENH-051, ENH-050 |
| WF-14 | External-audit evidence handoff | Auditor | ENH-052, ENH-050 |
| WF-15 | Backup & verified test-restore drill | IT Admin | ENH-060 |
| WF-16 | Till/user onboarding & health monitoring | IT Admin | ENH-061, ENH-063 |
| WF-17 | E-commerce order import via API | IT Admin, Sales | ENH-062 |

---

## WF-01 — Owner morning glance & anomaly response
**Realizes:** ENH-001, ENH-002, ENH-004 · **Persona:** Business Owner (صاحب العمل)

1. Owner opens **Owner Cockpit** (لوحة صاحب العمل). Tiles load live: Today's Sales, Gross Margin, Cash on Hand (all treasuries), Overdue AR, Low-Stock Items — each vs. same-day-last-week.
2. A red **Anomaly** (تنبيه شذوذ) badge shows "3 invoices with negative margin". Owner clicks it → drills into a filtered Sales list (المبيعات).
3. Owner opens **Cash Runway** (توقّع السيولة): 30/60/90-day line shows a dip in week 3 driven by a supplier cheque due (from the cheque register).
4. Owner taps a due inflow → jumps to the customer's overdue invoice; triggers **Send Reminder** (إرسال تذكير) (see WF-12).
5. At day end, owner receives the **Daily Digest** (الملخّص اليومي) in-app/email: sales, cash, margin, exceptions (big discounts, voids).

**Outcome:** owner manages by exception in minutes; no report-building.

---

## WF-02 — Guided month-end close
**Realizes:** ENH-010, ENH-012 · **Persona:** Chief Accountant (المحاسب الرئيسي)

1. Accountant opens **Close Workspace** (مساحة الإقفال) and selects the period (الفترة المالية).
2. The checklist auto-evaluates each gate red/green: All documents posted · Sub-ledgers tie to GL · Banks reconciled · FX revaluation run · Recurring entries posted · No sequence gaps.
3. "Recurring entries posted" is red. Accountant opens **Recurring Journals** (القيود الدورية) → the due templates (rent, depreciation) are pre-drafted → **Review & Post** (مراجعة وترحيل) each.
4. "Banks reconciled" is red → jumps to WF-03; on return the gate turns green.
5. All green → **Lock Period** (إقفال الفترة). If any gate is still red, locking requires an override with a typed reason (logged to the audit ledger).
6. A **Close Summary** (ملخّص الإقفال) is produced: trial balance snapshot + who closed and when.

**Outcome:** repeatable, evidence-backed close; the fiscal-period lock is actually safe.

---

## WF-03 — Smart bank reconciliation
**Realizes:** ENH-011 · **Persona:** Chief Accountant (المحاسب الرئيسي)

1. Accountant opens **Bank Reconciliation** (التسوية البنكية), picks a bank account, clicks **Import Statement** (استيراد كشف الحساب) (CSV/OFX/MT940).
2. Engine auto-matches statement lines to book entries on amount+date+reference; matched rows show a confidence score and go green.
3. Unmatched book entries and statement lines sit in two columns; the engine **suggests** likely pairs → accountant confirms or rejects each.
4. For a bank fee with no book entry, accountant clicks **Create Entry** (إنشاء قيد) → a pre-filled journal to Bank Charges → post.
5. Header shows **Unreconciled Difference** (الفرق غير المسوّى) counting down to 0.00.
6. At 0.00, **Finalize Reconciliation** (اعتماد التسوية) → statement archived; the close gate (WF-02) flips green.

**Outcome:** reconciliation in minutes with an auditable match record.

---

## WF-04 — ETA e-invoice pre-validation & bulk resubmit
**Realizes:** ENH-011b · **Personas:** Accountant, Compliance

1. On saving a sales invoice, **ETA Pre-Check** (فحص مسبق للفاتورة الإلكترونية) validates tax/unit/item (EGS/GS1) codes and totals locally; issues are shown inline before submission.
2. Accountant opens **ETA Submission Queue** (طابور إرسال مصلحة الضرائب): columns for status (Valid / Submitted / Accepted / Rejected).
3. Filter to **Rejected** (مرفوضة); each row shows the ETA rejection reason.
4. Accountant fixes a batch (e.g. missing item code) via **Fix & Requeue** (إصلاح وإعادة الطابور), then selects all and clicks **Bulk Resubmit** (إعادة إرسال جماعي).
5. If offline, submissions queue and auto-send when connectivity returns.
6. **ETA Compliance Report** (تقرير الالتزام الضريبي) shows acceptance rate and outstanding rejections.

**Outcome:** near-zero surprise rejections; faster, defensible filing.

---

## WF-05 — Scanner-driven physical stock count
**Realizes:** ENH-020 · **Persona:** Warehouse Manager (مدير المخزن)

1. Manager opens **Stock Count Sessions** (جلسات الجرد) → **New Session** (جلسة جديدة), picks a warehouse and zones, assigns counters.
2. On a handheld/tablet **Count Mode** (وضع الجرد): scan item barcode → enter counted qty. Blind mode hides system qty.
3. Multiple counters work zones concurrently; progress bar per zone.
4. Manager opens **Variance Review** (مراجعة الفروقات): counted vs. system, variance value highlighted; recount flag for outliers.
5. Approved variances **Post Adjustments** (ترحيل التسويات) using the standard 8 adjustment reasons; GL cost impact posted via costing layers.
6. **Count Report** (تقرير الجرد) archived with counter names for audit.

**Outcome:** faster, more accurate counts; less downtime and shrink.

---

## WF-06 — Receiving with batch/expiry & FEFO dispatch
**Realizes:** ENH-021 · **Persona:** Warehouse Manager

1. On a goods receipt (إذن استلام), receiver captures **Batch/Expiry** (الدفعة/تاريخ الصلاحية) per line.
2. Stock is stored by batch; **Expiry Aging** (أعمار الصلاحية) report lists near-expiry lots with a configurable window.
3. On a sales dispatch, **FEFO Suggestion** (اقتراح الأقرب انتهاءً) proposes the earliest-expiry batch first; picker confirms.
4. Expired lots are auto-flagged and **Quarantined** (حجر) — blocked from sale until written off via adjustment.
5. **Near-Expiry Alert** (تنبيه قرب انتهاء الصلاحية) notifies the manager to run a promotion or return.

**Outcome:** reduced write-offs; pharma/F&B compliance.

---

## WF-07 — Reorder suggestion → draft PO
**Realizes:** ENH-022 · **Persona:** Warehouse Manager

1. Manager opens **Replenishment Worklist** (قائمة إعادة الطلب): items below reorder point, ranked by urgency, with suggested qty from sales velocity + lead time.
2. Manager reviews suggested quantities and preferred supplier per line.
3. Selects lines → **Draft Purchase Orders** (إنشاء أوامر شراء) — grouped by supplier automatically.
4. Draft POs land in Purchases (أوامر الشراء) for normal approval and sending.

**Outcome:** proactive purchasing; fewer stock-outs and less overstock.

---

## WF-08 — Van load-out & end-of-day settlement
**Realizes:** ENH-023 · **Personas:** Warehouse Manager, Sales rep

1. Morning: **Van Load-Out** (تحميل السيارة) transfers stock from main to the van warehouse for a rep.
2. Rep sells through the day (invoices post against the van stock and rep AR).
3. Evening: **Van Settlement** (تسوية السيارة) shows expected remaining stock vs. returned, and expected cash vs. collected.
4. Variances flagged; manager approves → auto stock transfer back + AR/treasury postings reconciled.
5. **Van Performance** (أداء المندوب) report per rep/day.

**Outcome:** van-sales leakage eliminated; clean daily settlement.

---

## WF-09 — Fast-lane POS sale with in-till discount approval
**Realizes:** ENH-030, ENH-031, ENH-032 · **Personas:** Cashier, Retail Lead

1. Cashier opens **POS Sell** (نقطة البيع). Scans items — each scan adds a line (no mouse). Qty multiplier via keypad; hotkeys tender cash/card.
2. Customer asks for a discount below the floor. Cashier presses the discount hotkey → **Discount Request** (طلب خصم) with reason.
3. Retail lead approves on the same or a paired device via PIN/badge (**Approve Discount** / اعتماد الخصم); decision written to the audit ledger.
4. Mid-sale the PC restarts; on relaunch **Recover Cart** (استعادة السلة) restores the exact cart from autosave.
5. Cashier presses tender hotkey → split cash/card → **Print Receipt** (طباعة الإيصال) + drawer opens.
6. Busy? **Hold Sale** (تعليق البيع) parks the cart; **Resume** (استئناف) later.

**Outcome:** faster lines, controlled discounts, zero lost carts.

---

## WF-10 — Shift open/close & cash-drawer reconciliation
**Realizes:** ENH-033 · **Personas:** Cashier, Retail Lead

1. Start of shift: cashier **Opens Shift** (فتح الوردية), declares opening float.
2. Sales run through WF-09 during the shift.
3. End of shift: **Close Shift** (إغلاق الوردية) → blind **Cash Count** (جرد النقدية) by denomination; card/other tenders auto-summed.
4. System shows expected vs. counted per tender; over/short posted to a variance account (فروقات الصندوق).
5. **Z-Report** (تقرير الوردية Z) generated per cashier; handover to next shift.

**Outcome:** per-cashier cash accountability; instant variance visibility.

---

## WF-11 — Lead → opportunity → quote → won (pipeline)
**Realizes:** ENH-040, ENH-041, ENH-042 · **Persona:** Sales Manager

1. Rep captures a lead in **CRM Pipeline** (خط الفرص) → converts to an **Opportunity** (فرصة) with stage, value, expected close.
2. Rep builds a quote (عرض سعر); **Price-Floor Guard** (حارس السعر الأدنى) shows live margin and blocks below-floor lines (or routes to approval).
3. Opportunity advances stages on the kanban; **Weighted Forecast** (التوقّع المرجّح) updates.
4. Customer accepts → **Convert to Order** (تحويل إلى أمر بيع) → invoice.
5. Manager opens **Conversion Funnel** (قمع التحويل) and **Rep Leaderboard** (لوحة ترتيب المندوبين): quote→won rates, margin, collection per rep.

**Outcome:** managed pipeline, protected margin, objective performance data.

---

## WF-12 — Automated AR dunning & collections
**Realizes:** ENH-043 · **Personas:** Sales Manager, Accountant

1. Nightly, aging rules scan AR; invoices crossing 7/30/60-day buckets queue reminders.
2. **Collections Worklist** (قائمة التحصيل) shows overdue accounts ranked by amount/age.
3. Collector clicks **Send Reminder** (إرسال تذكير) (in-app/email/SMS/WhatsApp link) or the rule auto-sends per policy.
4. On a customer call, collector logs a **Promise to Pay** (وعد بالسداد) with date; the worklist tracks kept/broken promises.
5. **Customer Statement** (كشف حساب العميل) sent on request.

**Outcome:** consistent collections; the owner's cash-runway (WF-01) improves.

---

## WF-13 — SoD-guarded maker-checker payment
**Realizes:** ENH-051, ENH-050 · **Personas:** Compliance, Accountant

1. Clerk creates a payment voucher (سند صرف) → status **Pending Approval** (بانتظار الاعتماد).
2. **SoD Guard** (حارس فصل المهام) blocks the *same* user from approving (create-vs-approve conflict) and warns on any other conflicting pair.
3. A different authorized user opens **Approvals Inbox** (صندوق الاعتمادات) → reviews → **Approve** (اعتماد); only then does the voucher post.
4. Every step (create, approve, any field change) is written to the **Audit Ledger** (سجل التدقيق) with before/after and user.
5. Monthly **SoD Violation Report** (تقرير مخالفات فصل المهام) surfaces any overrides.

**Outcome:** enforced maker-checker; fraud-resistant, fully evidenced.

---

## WF-14 — External-audit evidence handoff
**Realizes:** ENH-052, ENH-050 · **Persona:** Auditor / Compliance

1. Admin grants a time-boxed **Auditor (Read-Only)** (مراجِع - قراءة فقط) role.
2. Auditor opens **Audit Ledger Search** (بحث سجل التدقيق): filters by user/entity/field/date; verifies the hash chain (tamper-evidence).
3. Auditor opens **Evidence Pack** (حزمة أدلة المراجعة) → selects period → one-click export: trial balance, GL detail, sub-ledger reconciliations, sequence-gap report, audit-ledger extract.
4. The pack exports as a **signed bundle** (حزمة موقّعة) for the external auditor.

**Outcome:** audit prep collapses to one click; clean, verifiable handoff.

---

## WF-15 — Backup & verified test-restore drill
**Realizes:** ENH-060 · **Persona:** IT Admin

1. Admin opens **Backup Center** (مركز النسخ الاحتياطي): sets schedule and targets (local + USB/external + optional cloud), encryption on.
2. Each backup runs an automatic **Integrity Check** (فحص السلامة); a failed check raises an alert.
3. Admin clicks **Test Restore** (اختبار الاستعادة) → the backup restores into an isolated sandbox and runs smoke checks.
4. A **Restore Drill Report** (تقرير اختبار الاستعادة) records pass/fail and timing.

**Outcome:** disaster recovery proven, not assumed — vital for offline single-shop installs.

---

## WF-16 — Till/user onboarding & health monitoring
**Realizes:** ENH-061, ENH-063 · **Persona:** IT Admin

1. Admin opens **User Provisioning** (إدارة المستخدمين) → applies a **Role Template** (قالب صلاحيات) (Cashier/Accountant/Warehouse/Manager) or **Bulk Import** (استيراد جماعي) via CSV.
2. For a new till, **Device Enrollment** (تسجيل جهاز) pairs it to the LAN and consumes a licensed terminal seat.
3. Admin opens **System Health Console** (لوحة صحة النظام): per-till connectivity, offline-queue depth, last-sync, DB size, license/seat usage, backup status.
4. A degraded till (deep queue / stale sync) raises an alert → admin acts before it fails.

**Outcome:** fast consistent onboarding; proactive multi-till operations.

---

## WF-17 — E-commerce order import via API
**Realizes:** ENH-062 · **Personas:** IT Admin, Sales

1. Admin opens **API & Integrations** (الربط والتكامل) → issues an **API Key** (مفتاح API) and enables the e-commerce connector.
2. The webshop posts orders to the local/LAN REST API; each becomes a draft sales order (أمر بيع) with stock check.
3. Outbound **Webhooks** (خطافات ويب) fire on invoice-posted/shipment events back to the webshop.
4. Errors surface in an **Integration Log** (سجل التكامل) for retry.

**Outcome:** the data silo is broken; online and in-store share one ledger.

---

## Summary

**17 end-to-end enhancement workflows** spanning all 7 personas, each mapped to the requirements in `requirements.md` and sequenced in `../ROADMAP.md` §7. All are beyond-parity and live only on the `enhancements` branch.
