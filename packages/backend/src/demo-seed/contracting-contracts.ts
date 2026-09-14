import type { App } from "@mezan/api";
import { step, CORE } from "./shared.js";

/**
 * العقود وجداول الكميات وأوامر التغيير — slice 1 of المقاولات. Seeded through
 * the real routes, so every figure the screens show (قيمة العقد، قيمة العقد
 * بعد أوامر التغيير، الكمية التعاقدية) is derived by the server from these
 * documents rather than typed in here.
 *
 * The BOQ of CTR-DEMO-1 is the design's own worked example
 * (docs/artifacts/mezan-contracting-designs.html §04), so the certificate
 * slice measures against numbers that already tie.
 */

const TOWER = "PRJ-DEMO-1";
const WAREHOUSE_EXPANSION = "PRJ-DEMO-2";
const FITOUT = "PRJ-DEMO-3";
const VILLAS = "PRJ-DEMO-9";

const TOWER_CONTRACT = "CTR-DEMO-1";
const PUBLIC_CONTRACT = "CTR-DEMO-2";
const FITOUT_CONTRACT = "CTR-DEMO-3";
const VILLAS_CONTRACT = "CTR-DEMO-9";

export async function seedContractingContracts(app: App): Promise<void> {
  await step(app, "POST", "/contracting/contracts", {
    id: TOWER_CONTRACT,
    projectId: TOWER,
    customerId: CORE.customers[1],
    titleAr: "عقد إنشاء برج الأمل السكني",
    titleEn: "Al Amal Residential Tower — construction contract",
    contractType: "private",
    signedDate: "2026-02-15",
    startDate: "2026-03-01",
    plannedEndDate: "2027-02-28",
    notes: "عقد مقاولة بالباطن الكامل لأعمال الهيكل والتشطيبات.",
    estimatedTotalCost: "20300000",
    tenderDiscountPercent: "4.5",
    retentionPercent: "5",
    advancePercent: "10",
    advanceRecoveryPercent: "10",
    materialsOnSitePercent: "75",
    deemedWagePercent: "20",
    socialInsuranceRatePercent: "18.75",
    socialInsuranceNote: "جدول الأجر الافتراضي — قرار ٧٤ لسنة ١٩٨٨ وتعديلاته.",
    withholdingTaxPercent: "1",
    paymentTermDays: 30,
    defectsLiabilityMonths: 12,
    recognitionPolicy: "cost_to_cost",
  });

  await step(app, "PUT", `/contracting/contracts/${TOWER_CONTRACT}/boq`, {
    lines: [
      { id: `${TOWER_CONTRACT}-B1`, code: "1", descriptionAr: "أعمال الحفر والردم", unit: "m3", qty: "12000", unitRate: "185.00", estimatedUnitCost: "120", costCategory: "equipment" },
      { id: `${TOWER_CONTRACT}-B2`, code: "2", descriptionAr: "الخرسانة العادية", unit: "m3", qty: "1450", unitRate: "1980.00", estimatedUnitCost: "1320", costCategory: "materials" },
      { id: `${TOWER_CONTRACT}-B3`, code: "3", descriptionAr: "الخرسانة المسلحة", unit: "m3", qty: "3200", unitRate: "3450.00", estimatedUnitCost: "1930", costCategory: "materials" },
      { id: `${TOWER_CONTRACT}-B4`, code: "4", descriptionAr: "أعمال المباني", unit: "m2", qty: "9800", unitRate: "260.00", estimatedUnitCost: "175", costCategory: "materials" },
      { id: `${TOWER_CONTRACT}-B5`, code: "5", descriptionAr: "أعمال البياض", unit: "m2", qty: "18500", unitRate: "95.00", estimatedUnitCost: "62", costCategory: "labour" },
      { id: `${TOWER_CONTRACT}-B6`, code: "6", descriptionAr: "أعمال التشطيبات", unit: "lump_sum", qty: "1", unitRate: "1895000.00", estimatedUnitCost: "1400000", costCategory: "subcontract" },
    ],
  });

  await step(app, "POST", `/contracting/contracts/${TOWER_CONTRACT}/activate`, { activatedAt: "2026-03-01" });

  await step(app, "POST", "/contracting/variation-orders", {
    id: "VO-DEMO-1",
    contractId: TOWER_CONTRACT,
    date: "2026-05-28",
    titleAr: "إضافة بند حديد التسليح بعقد التوريد",
    reason: "تحوّل توريد حديد التسليح من العميل إلى المقاول بعد تعذّر التوريد.",
    requestedBy: "employer",
    lines: [
      {
        kind: "add",
        newLine: { code: "7", descriptionAr: "حديد التسليح", unit: "ton", qty: "210", unitRate: "46500.00", estimatedUnitCost: "38000", costCategory: "materials" },
      },
    ],
  });
  await step(app, "POST", "/contracting/variation-orders/VO-DEMO-1/approve", { approvedAt: "2026-06-10" });

  await step(app, "POST", "/contracting/variation-orders", {
    id: "VO-DEMO-2",
    contractId: TOWER_CONTRACT,
    date: "2026-07-21",
    titleAr: "زيادة كميات الحفر والردم",
    reason: "منسوب التأسيس نزل ٤٠ سم عن المخططات بعد الجسات التكميلية.",
    requestedBy: "consultant",
    lines: [{ kind: "change", boqLineId: `${TOWER_CONTRACT}-B1`, qtyDelta: "600" }],
  });
  await step(app, "POST", "/contracting/variation-orders/VO-DEMO-2/approve", { approvedAt: "2026-08-02" });

  await step(app, "POST", "/contracting/variation-orders", {
    id: "VO-DEMO-3",
    contractId: TOWER_CONTRACT,
    date: "2026-08-30",
    titleAr: "خفض كميات البياض",
    reason: "استبعاد بياض الأدوار المتكررة من نطاق العقد.",
    requestedBy: "contractor",
    lines: [{ kind: "change", boqLineId: `${TOWER_CONTRACT}-B5`, qtyDelta: "-1200" }],
  });

  await step(app, "POST", "/contracting/contracts", {
    id: PUBLIC_CONTRACT,
    projectId: WAREHOUSE_EXPANSION,
    customerId: CORE.customers[0],
    titleAr: "عقد توسعة مستودع الوادي الأخضر",
    titleEn: "Green Valley Warehouse Expansion",
    contractType: "public",
    signedDate: "2025-03-20",
    startDate: "2025-04-15",
    plannedEndDate: "2027-01-31",
    notes: "عقد أشغال عامة خاضع للقانون ١٨٢ لسنة ٢٠١٨.",
    estimatedTotalCost: "8100000",
  });

  await step(app, "PUT", `/contracting/contracts/${PUBLIC_CONTRACT}/boq`, {
    lines: [
      { id: `${PUBLIC_CONTRACT}-B1`, code: "1", descriptionAr: "الخرسانة المسلحة لهيكل التوسعة", unit: "m3", qty: "1500", unitRate: "3400.00", estimatedUnitCost: "2050", costCategory: "materials" },
      { id: `${PUBLIC_CONTRACT}-B2`, code: "2", descriptionAr: "أعمال المباني والتشطيبات", unit: "m2", qty: "6000", unitRate: "450.00", estimatedUnitCost: "300", costCategory: "subcontract" },
      { id: `${PUBLIC_CONTRACT}-B3`, code: "3", descriptionAr: "الأرضيات الصناعية والعزل", unit: "lump_sum", qty: "1", unitRate: "1500000.00", estimatedUnitCost: "1100000", costCategory: "subcontract" },
    ],
  });
  await step(app, "POST", `/contracting/contracts/${PUBLIC_CONTRACT}/activate`, { activatedAt: "2025-04-15" });

  await step(app, "POST", "/contracting/contracts", {
    id: FITOUT_CONTRACT,
    projectId: FITOUT,
    customerId: CORE.customers[2],
    titleAr: "عقد تجهيز فرع جديد — سموحة",
    contractType: "private",
    signedDate: "2026-03-10",
    startDate: "2026-04-01",
    plannedEndDate: "2026-07-15",
    notes: "سُلّم الفرع وشُغّل بالكامل.",
    estimatedTotalCost: "520000",
    advancePercent: "0",
    advanceRecoveryPercent: "0",
  });

  await step(app, "PUT", `/contracting/contracts/${FITOUT_CONTRACT}/boq`, {
    lines: [
      { id: `${FITOUT_CONTRACT}-B1`, code: "1", descriptionAr: "أعمال الكهرباء والتكييف", unit: "lump_sum", qty: "1", unitRate: "420000.00", estimatedUnitCost: "330000", costCategory: "subcontract" },
      { id: `${FITOUT_CONTRACT}-B2`, code: "2", descriptionAr: "أعمال النجارة والديكور", unit: "m2", qty: "260", unitRate: "850.00", estimatedUnitCost: "610", costCategory: "materials" },
    ],
  });
  await step(app, "POST", `/contracting/contracts/${FITOUT_CONTRACT}/activate`, { activatedAt: "2026-04-01" });
  await step(app, "POST", `/contracting/contracts/${FITOUT_CONTRACT}/complete`, { completedAt: "2026-07-15" });

  /**
   * العقد الخاسر — value 4,150,000 against an estimated total cost of
   * 4,600,000. EAS 48 requires the WHOLE 450,000 foreseen loss to be provided
   * the month it is foreseen, so the first recognition run on this contract
   * raises «عقد خاسر — مخصّص واجب» and posts the provision. Every other seeded
   * contract is profitable, so nothing could raise that flag before.
   */
  await step(app, "POST", "/contracting/contracts", {
    id: VILLAS_CONTRACT,
    projectId: VILLAS,
    customerId: CORE.customers[2],
    titleAr: "عقد تشطيبات فيلات — الشيخ زايد",
    titleEn: "Sheikh Zayed Villas — fit-out contract",
    contractType: "private",
    signedDate: "2026-04-18",
    startDate: "2026-05-01",
    plannedEndDate: "2027-04-30",
    notes: "سُعِّر قبل موجة أسعار مواد التشطيب؛ التكلفة المقدرة تتجاوز قيمة العقد.",
    estimatedTotalCost: "4600000",
    retentionPercent: "5",
    advancePercent: "0",
    advanceRecoveryPercent: "0",
    paymentTermDays: 30,
    recognitionPolicy: "cost_to_cost",
  });

  await step(app, "PUT", `/contracting/contracts/${VILLAS_CONTRACT}/boq`, {
    lines: [
      { id: `${VILLAS_CONTRACT}-B1`, code: "1", descriptionAr: "أعمال المحارة والبياض", unit: "m2", qty: "7000", unitRate: "180.00", estimatedUnitCost: "205", costCategory: "labour" },
      { id: `${VILLAS_CONTRACT}-B2`, code: "2", descriptionAr: "توريد وتركيب أرضيات رخام", unit: "m2", qty: "2600", unitRate: "650.00", estimatedUnitCost: "720", costCategory: "materials" },
      { id: `${VILLAS_CONTRACT}-B3`, code: "3", descriptionAr: "أعمال الدهانات والديكور", unit: "lump_sum", qty: "1", unitRate: "1200000.00", estimatedUnitCost: "1330000", costCategory: "subcontract" },
    ],
  });
  await step(app, "POST", `/contracting/contracts/${VILLAS_CONTRACT}/activate`, { activatedAt: "2026-05-01" });
}
