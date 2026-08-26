import type { App } from "@mezan/api";
import { ACCOUNTS, BRANCH_ID, VAT_PERCENT, WAREHOUSE_ID, step } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Covers عمليات المخزون: a second stock location and a transit store, the
 * المواصفات registry and the product templates built on it, stock adjustments
 * in both directions, warehouse transfers, physical counts (one still being
 * counted, two closed with real variances), the aging write-down batch, and
 * أوامر التصنيع.
 */

const GIZA_WAREHOUSE_ID = "WH-DEMO-2";
const TRANSIT_WAREHOUSE_ID = "WH-DEMO-TRANSIT";

/**
 * Inventory shrinkage/overage counterpart. The standard COA has no dedicated
 * write-off leaf, so an adjustment's value change lands on the inventory
 * write-down expense — debited for damage/expiry, credited for goods found.
 */
const SHRINKAGE_ACCOUNT = "5060";

/**
 * The aged position the write-down batch provisions against. Received in
 * February and never touched since, so it ages past the 180-day band while
 * every other position stays inside the 90-day floor.
 */
const SLOW_MOVING_OPENING = {
  adjustmentId: "ADJ-DEMO-1",
  itemId: "ITEM-DEMO-6",
  qty: "40",
  unitCost: "124",
  occurredAt: "2026-02-15",
};

const WAREHOUSES = [
  { id: GIZA_WAREHOUSE_ID, code: "WH-GIZA", name: "مستودع فرع الجيزة", type: "MAIN" as const },
  { id: TRANSIT_WAREHOUSE_ID, code: "WH-TRANSIT", name: "مخزون بالطريق", type: "TRANSIT" as const },
];

const SPECIFICATIONS = [
  { code: "SIZE", nameAr: "الحجم", nameEn: "Size", type: "select" as const, values: ["صغير", "وسط", "كبير"], filterable: true },
  { code: "PACK", nameAr: "نوع العبوة", nameEn: "Packaging", type: "select" as const, values: ["كيس", "علبة", "برطمان"], filterable: true },
  { code: "ORIGIN", nameAr: "بلد المنشأ", nameEn: "Country of Origin", type: "select" as const, values: ["مصر", "الهند", "سريلانكا"], filterable: true },
  { code: "NET-WEIGHT", nameAr: "الوزن الصافي", nameEn: "Net Weight", type: "number" as const, values: [], unit: "جم", filterable: false },
  { code: "STORAGE", nameAr: "طريقة التخزين", nameEn: "Storage", type: "text" as const, values: [], filterable: false },
];

/**
 * العلامات التجارية والمواسم (R5.10). Seeded so the item form's pickers and
 * the items list's facet filters have real records to bind to — the brand was
 * free text before, which is how one brand becomes three spellings.
 */
const BRANDS = [
  { id: "BRD-DEMO-1", code: "MEZAN", nameAr: "ميزان", nameEn: "Mezan" },
  { id: "BRD-DEMO-2", code: "ALAHRAM", nameAr: "الأهرام", nameEn: "Al Ahram" },
  { id: "BRD-DEMO-3", code: "ELNILE", nameAr: "النيل", nameEn: "El Nile" },
];

const SEASONS = [
  { id: "SSN-DEMO-1", code: "RAMADAN-2026", nameAr: "موسم رمضان ٢٠٢٦", nameEn: "Ramadan 2026", startDate: "2026-02-17", endDate: "2026-03-19" },
  { id: "SSN-DEMO-2", code: "SUMMER-2026", nameAr: "موسم الصيف ٢٠٢٦", nameEn: "Summer 2026", startDate: "2026-06-01", endDate: "2026-09-30" },
];

/** Which seeded items carry which facets, so the filters return rows. */
const ITEM_FACETS = [
  { itemId: "ITEM-DEMO-1", brandId: "BRD-DEMO-2", seasonId: "SSN-DEMO-1", defaultSupplierId: "SUPP-DEMO-1", description: "أرز مصري حبة طويلة، عبوة ٥ كجم", specifications: [{ code: "ORIGIN", value: "مصر" }, { code: "PACK", value: "كيس" }] },
  { itemId: "ITEM-DEMO-4", brandId: "BRD-DEMO-1", seasonId: "SSN-DEMO-1", defaultSupplierId: "SUPP-DEMO-2", description: "شاي أسود مستورد، عبوة ٥٠٠ جم", specifications: [{ code: "ORIGIN", value: "سريلانكا" }, { code: "SIZE", value: "وسط" }] },
  { itemId: "ITEM-DEMO-5", brandId: "BRD-DEMO-1", seasonId: null, specifications: [{ code: "ORIGIN", value: "مصر" }, { code: "SIZE", value: "كبير" }] },
  { itemId: "ITEM-DEMO-6", brandId: "BRD-DEMO-1", seasonId: "SSN-DEMO-2", specifications: [{ code: "ORIGIN", value: "الهند" }] },
  { itemId: "ITEM-DEMO-2", brandId: "BRD-DEMO-3", seasonId: "SSN-DEMO-2", specifications: [{ code: "PACK", value: "برطمان" }] },
];

const TEMPLATES = [
  {
    code: "TPL-TEA",
    nameAr: "شاي ميزان المعبأ",
    nameEn: "Mezan Packed Tea",
    brandId: "BRD-DEMO-1",
    defaultSalePrice: "260",
    defaultCost: "205",
    specificationCodes: ["SIZE", "PACK"],
    variants: [
      { SIZE: "صغير", PACK: "كيس" },
      { SIZE: "وسط", PACK: "علبة" },
      { SIZE: "كبير", PACK: "علبة" },
    ],
  },
  {
    code: "TPL-RICE",
    nameAr: "أرز ميزان المعبأ",
    nameEn: "Mezan Packed Rice",
    brandId: "BRD-DEMO-1",
    defaultSalePrice: "180",
    defaultCost: "140",
    specificationCodes: ["SIZE", "ORIGIN"],
    variants: [
      { SIZE: "وسط", ORIGIN: "مصر" },
      { SIZE: "كبير", ORIGIN: "الهند" },
    ],
  },
];

/** Free-standing adjustments. Each carries its own GL mapping so the inventory sub-ledger and account 1200 move together. */
const ADJUSTMENTS = [
  {
    id: "ADJ-DEMO-2",
    reason: "DAMAGE",
    occurredAt: "2026-08-13",
    counterpartAccountId: SHRINKAGE_ACCOUNT,
    lines: [{ itemId: "ITEM-DEMO-2", direction: "OUT" as const, qty: "6" }],
  },
  {
    id: "ADJ-DEMO-3",
    reason: "OTHER",
    occurredAt: "2026-08-14",
    counterpartAccountId: SHRINKAGE_ACCOUNT,
    lines: [{ itemId: "ITEM-DEMO-3", direction: "IN" as const, qty: "18", unitCost: "31" }],
  },
  {
    id: "ADJ-DEMO-4",
    reason: "EXPIRY",
    occurredAt: "2026-08-22",
    counterpartAccountId: SHRINKAGE_ACCOUNT,
    lines: [{ itemId: "ITEM-DEMO-8", direction: "OUT" as const, qty: "20" }],
  },
];

/** Posted warehouse transfers: one delivered to الجيزة, one still sitting in the transit store. */
const TRANSFERS = [
  {
    id: "TRF-DEMO-1",
    toWarehouseId: GIZA_WAREHOUSE_ID,
    occurredAt: "2026-08-12",
    lines: [
      { itemId: "ITEM-DEMO-1", qty: "25" },
      { itemId: "ITEM-DEMO-2", qty: "30" },
      { itemId: "ITEM-DEMO-3", qty: "60" },
    ],
  },
  {
    id: "TRF-DEMO-2",
    toWarehouseId: TRANSIT_WAREHOUSE_ID,
    occurredAt: "2026-08-21",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "6" },
      { itemId: "ITEM-DEMO-2", qty: "10" },
    ],
  },
];

/** The item both closed counts disagree on, short in الرئيسي and over by the same quantity in الجيزة. */
const MISPLACED = { itemId: "ITEM-DEMO-2", qty: 4 };

const WORK_ORDERS = [
  {
    id: "WO-DEMO-1",
    bomId: "BOM-DEMO-1",
    plannedQty: "20",
    priority: "high" as const,
    scheduledStartDate: "2026-08-25",
    scheduledEndDate: "2026-08-27",
    notes: "دفعة خليط الشاي بالسكر لطلبية شركة الأمل",
    action: "plan" as const,
  },
  {
    id: "WO-DEMO-2",
    bomId: "BOM-DEMO-2",
    plannedQty: "15",
    priority: "normal" as const,
    scheduledStartDate: "2026-08-20",
    scheduledEndDate: "2026-08-24",
    notes: "خليط الشاي بالنعناع — تشغيلة أسبوعية",
    action: "start" as const,
  },
  {
    id: "WO-DEMO-3",
    bomId: "BOM-DEMO-1",
    plannedQty: "10",
    priority: "low" as const,
    scheduledStartDate: "2026-08-15",
    scheduledEndDate: "2026-08-16",
    notes: "أُلغي بعد سحب العميل للطلب",
    action: "cancel" as const,
  },
  {
    id: "WO-DEMO-4",
    bomId: "BOM-DEMO-1",
    plannedQty: "5",
    priority: "normal" as const,
    scheduledStartDate: "2026-08-18",
    scheduledEndDate: "2026-08-19",
    notes: "تشغيلة صغيرة صُرفت موادها على خط الخلط",
    action: "issue" as const,
  },
];

/** محطات العمل — the shop floor a work order's issues and receipts are recorded at (R9.1). */
const WORK_STATIONS = [
  { id: "WST-DEMO-1", code: "WST-01", nameAr: "خط الخلط", nameEn: "Blending line", notes: "خلاط أفقي ٢٠٠ كجم" },
  { id: "WST-DEMO-2", code: "WST-02", nameAr: "خط التعبئة", nameEn: "Packing line", notes: "تعبئة وتغليف" },
  { id: "WST-DEMO-3", code: "WST-03", nameAr: "مراقبة الجودة", nameEn: "Quality control", notes: null },
];

interface CountLine {
  readonly itemId: string;
  readonly systemQty: string | null;
}

interface CountResponse {
  readonly lines: readonly CountLine[];
}

interface TemplateAttribute {
  readonly id: string;
  readonly specificationCode: string | null;
}

interface TemplateResponse {
  readonly id: string;
  readonly attributes: readonly TemplateAttribute[];
}

interface WritedownRunResponse {
  readonly id: string;
}

const QTY_SCALE = 1_000_000n;

/** Whole-unit shift of an exact decimal quantity string, done on scaled integers — never on a float. */
function shiftQty(qty: string, deltaUnits: number): string {
  const [whole = "0", fraction = ""] = qty.split(".");
  const scaled = BigInt(whole + fraction.padEnd(6, "0").slice(0, 6)) + BigInt(deltaUnits) * QTY_SCALE;
  if (scaled < 0n) throw new Error(`[demo-seed] counted quantity would be negative for "${qty}"`);
  return `${scaled / QTY_SCALE}.${(scaled % QTY_SCALE).toString().padStart(6, "0")}`;
}

/**
 * Counted quantities for a whole count session: the system snapshot it opened
 * with, shifted by `deltas` on the named items. Reading the snapshot back off
 * the session rather than restating it keeps each variance exactly as large as
 * intended however the core profile's quantities change.
 */
function entriesFor(count: CountResponse, deltas: Readonly<Record<string, number>> = {}) {
  return count.lines.map((line) => {
    if (line.systemQty === null) {
      throw new Error(`[demo-seed] physical count has no system quantity for ${line.itemId}`);
    }
    return { itemId: line.itemId, countedQty: shiftQty(line.systemQty, deltas[line.itemId] ?? 0) };
  });
}

async function seedSpecificationsAndTemplates(app: App): Promise<void> {
  for (const specification of SPECIFICATIONS) {
    await step(app, "POST", "/item-specifications", specification);
  }
  for (const brand of BRANDS) {
    await step(app, "POST", "/item-brands", brand);
  }
  for (const season of SEASONS) {
    await step(app, "POST", "/item-seasons", season);
  }
  // Bind the facets onto real items — an empty registry filters to nothing and
  // proves nothing.
  for (const facets of ITEM_FACETS) {
    await step(app, "PATCH", `/items/${facets.itemId}`, {
      brandId: facets.brandId,
      seasonId: facets.seasonId,
      specifications: facets.specifications,
      ...("defaultSupplierId" in facets ? { defaultSupplierId: facets.defaultSupplierId } : {}),
      ...("description" in facets ? { description: facets.description } : {}),
    });
  }

  for (const template of TEMPLATES) {
    const created = (await step(app, "POST", "/inventory/product-templates", {
      code: template.code,
      nameAr: template.nameAr,
      nameEn: template.nameEn,
      baseUnitCode: "PCS",
      brandId: template.brandId,
      costingMethod: "WAC",
      defaultSalePrice: template.defaultSalePrice,
      defaultCost: template.defaultCost,
      taxRatePercent: VAT_PERCENT,
    })) as TemplateResponse;

    let attributes: readonly TemplateAttribute[] = [];
    for (const specificationCode of template.specificationCodes) {
      const updated = (await step(
        app,
        "POST",
        `/inventory/product-templates/${created.id}/attributes`,
        { specificationCode },
      )) as TemplateResponse;
      attributes = updated.attributes;
    }

    // The generator keys a selection by ATTRIBUTE ID, not by name, and the ids
    // are server-generated — so they have to come back off the template.
    const attributeIdFor = (specificationCode: string): string => {
      const attribute = attributes.find((a) => a.specificationCode === specificationCode);
      if (!attribute) throw new Error(`[demo-seed] template ${template.code} lost attribute ${specificationCode}`);
      return attribute.id;
    };

    await step(app, "POST", `/inventory/product-templates/${created.id}/variants/generate`, {
      selections: template.variants.map((variant) => ({
        values: Object.fromEntries(
          Object.entries(variant).map(([specificationCode, value]) => [attributeIdFor(specificationCode), value]),
        ),
      })),
    });
  }
}

async function seedPhysicalCounts(app: App): Promise<void> {
  const mainCount = (await step(app, "POST", "/inventory/physical-counts", {
    id: "PC-DEMO-1",
    warehouseId: WAREHOUSE_ID,
    date: "2026-08-17",
    memo: "جرد دوري — المستودع الرئيسي",
    itemIds: ["ITEM-DEMO-1", MISPLACED.itemId, "ITEM-DEMO-4"],
  })) as CountResponse;
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-1/counts", {
    entries: entriesFor(mainCount, { [MISPLACED.itemId]: -MISPLACED.qty }),
  });
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-1/complete", {});
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-1/generate-adjustment", {
    adjustmentId: "ADJ-DEMO-5",
  });

  /**
   * The counterpart to the shortage above: the same item, the same quantity,
   * found in الجيزة. Its whole stock of that item arrived on TRF-DEMO-1 and
   * nothing has re-averaged it since, so الجيزة's moving-average cost still
   * equals الرئيسي's — which is what makes the two generated adjustments cancel
   * to zero in value. A PHYSICAL_COUNT adjustment posts NO journal entry
   * (create-backend.ts maps GL accounts for INITIAL_STOCK only), so a count
   * whose net value were non-zero would silently push the inventory sub-ledger
   * off its GL control account.
   */
  const gizaCount = (await step(app, "POST", "/inventory/physical-counts", {
    id: "PC-DEMO-2",
    warehouseId: GIZA_WAREHOUSE_ID,
    date: "2026-08-18",
    memo: "جرد فرع الجيزة",
    itemIds: ["ITEM-DEMO-1", MISPLACED.itemId, "ITEM-DEMO-3"],
  })) as CountResponse;
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-2/counts", {
    entries: entriesFor(gizaCount, { [MISPLACED.itemId]: MISPLACED.qty }),
  });
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-2/complete", {});
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-2/generate-adjustment", {
    adjustmentId: "ADJ-DEMO-6",
  });

  // Left قيد التنفيذ, blind, with one line still uncounted.
  await step(app, "POST", "/inventory/physical-counts", {
    id: "PC-DEMO-3",
    warehouseId: WAREHOUSE_ID,
    date: "2026-08-23",
    memo: "جرد أعمى — قسم المبردات",
    itemIds: ["ITEM-DEMO-3", "ITEM-DEMO-7", "ITEM-DEMO-8"],
    blind: true,
  });
  await step(app, "POST", "/inventory/physical-counts/PC-DEMO-3/counts", {
    entries: [
      { itemId: "ITEM-DEMO-7", countedQty: "188" },
      { itemId: "ITEM-DEMO-8", countedQty: "326" },
    ],
  });
}

export async function seedInventoryOps(app: App): Promise<void> {
  for (const warehouse of WAREHOUSES) {
    await step(app, "POST", "/warehouses", { ...warehouse, branchId: BRANCH_ID, active: true });
  }

  await seedSpecificationsAndTemplates(app);

  await step(app, "POST", "/inventory/adjustments", {
    adjustmentId: SLOW_MOVING_OPENING.adjustmentId,
    adjustmentNumber: SLOW_MOVING_OPENING.adjustmentId,
    warehouseId: WAREHOUSE_ID,
    reason: "INITIAL_STOCK",
    occurredAt: SLOW_MOVING_OPENING.occurredAt,
    gl: { inventoryAccountId: ACCOUNTS.inventory, counterpartAccountId: "3100" },
    lines: [
      {
        itemId: SLOW_MOVING_OPENING.itemId,
        direction: "IN",
        qty: SLOW_MOVING_OPENING.qty,
        unitCost: SLOW_MOVING_OPENING.unitCost,
      },
    ],
  });

  for (const adjustment of ADJUSTMENTS) {
    await step(app, "POST", "/inventory/adjustments", {
      adjustmentId: adjustment.id,
      adjustmentNumber: adjustment.id,
      warehouseId: WAREHOUSE_ID,
      reason: adjustment.reason,
      occurredAt: adjustment.occurredAt,
      gl: {
        inventoryAccountId: ACCOUNTS.inventory,
        counterpartAccountId: adjustment.counterpartAccountId,
      },
      lines: adjustment.lines,
    });
  }

  // Before the counts below: they snapshot what is on hand when they open.
  for (const transfer of TRANSFERS) {
    await step(app, "POST", "/inventory/transfers", {
      transferId: transfer.id,
      transferNumber: transfer.id,
      fromWarehouseId: WAREHOUSE_ID,
      toWarehouseId: transfer.toWarehouseId,
      occurredAt: transfer.occurredAt,
      lines: transfer.lines,
    });
  }

  // A transfer request still awaiting confirmation — no stock has moved yet.
  await step(app, "POST", "/inventory/stock-transfers/draft", {
    id: "TRF-DEMO-3",
    date: "2026-08-23",
    memo: "طلب تحويل خليط الشاي لفرع الجيزة — بانتظار الاعتماد",
    lines: [
      {
        itemId: "ITEM-DEMO-5",
        fromWarehouseId: WAREHOUSE_ID,
        toWarehouseId: GIZA_WAREHOUSE_ID,
        qty: "8",
      },
    ],
  });

  await seedPhysicalCounts(app);

  // The batch runs on the tenant's own bands (settings §سياسة المخزون), so the
  // demo tenant has to be one that actually provisions its slow-moving stock.
  const settings = (await step(app, "GET", "/settings")) as Record<string, unknown>;
  await step(app, "PUT", "/settings", {
    ...settings,
    agingWritedownEnabled: true,
    agingWritedownMonths: 3,
    agingWritedownRatePercent: 10,
  });

  const writedownRun = (await step(app, "POST", "/inventory/writedown-runs", {
    period: "2026-08",
  })) as WritedownRunResponse;
  await step(app, "POST", `/inventory/writedown-runs/${writedownRun.id}/post`, {});

  for (const station of WORK_STATIONS) {
    await step(app, "POST", "/manufacturing/work-stations", station);
  }

  for (const order of WORK_ORDERS) {
    await step(app, "POST", "/manufacturing/work-orders", {
      id: order.id,
      bomId: order.bomId,
      plannedQty: order.plannedQty,
      sourceWarehouseId: WAREHOUSE_ID,
      destinationWarehouseId: WAREHOUSE_ID,
      priority: order.priority,
      scheduledStartDate: order.scheduledStartDate,
      scheduledEndDate: order.scheduledEndDate,
      notes: order.notes,
    });
    if (order.action === "start" || order.action === "issue") {
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/start`, {});
    }
    if (order.action === "issue") {
      // Materials issued AT a station BY an operator, so the movements tab has
      // both dimensions on a real run rather than only on one made by hand.
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/issue`, {
        stationId: "WST-DEMO-1",
        operatorId: "EMP-DEMO-3",
      });
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/extra-issue`, {
        stationId: "WST-DEMO-1",
        operatorId: "EMP-DEMO-3",
        lines: [{ itemId: "ITEM-DEMO-4", qty: "2" }],
      });
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/return`, {
        stationId: "WST-DEMO-2",
        operatorId: "EMP-DEMO-4",
        lines: [{ itemId: "ITEM-DEMO-4", qty: "1" }],
      });
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/receive`, {
        stationId: "WST-DEMO-2",
        operatorId: "EMP-DEMO-4",
        producedQty: "5",
      });
      // The run has to CLOSE: issuing materials moves the stock sub-ledger with
      // no GL, and only the completion posting capitalises the WIP back into
      // inventory. Leaving it received-but-open puts the sub-ledger off GL 1200.
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/complete`, {});
    }
    if (order.action === "cancel") {
      await step(app, "POST", `/manufacturing/work-orders/${order.id}/cancel`, {});
    }
  }
}
