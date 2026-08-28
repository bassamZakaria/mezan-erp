import type { App } from "@mezan/api";
import { ACCOUNTS, BRANCH_ID, CORE, VAT_PERCENT, WAREHOUSE_ID, step } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Builds the two document chains the core profile leaves empty:
 *
 *   طلب عرض سعر → أمر شراء → استلام بضاعة → فاتورة مشتريات → مرتجع مشتريات
 *   قائمة أسعار → عرض سعر → فاتورة مبيعات → مرتجع مبيعات
 *
 * plus التكاليف الإضافية allocated over a receipt. Every document goes in
 * through its own route, so stock really moves at the weighted-average cost
 * and the general ledger really receives the postings.
 */

const ITEM_NAMES_AR: Record<string, string> = {
  "ITEM-DEMO-1": "أرز أبيض 5 كجم",
  "ITEM-DEMO-2": "زيت عباد الشمس 1 لتر",
  "ITEM-DEMO-3": "سكر أبيض 1 كجم",
  "ITEM-DEMO-4": "شاي أسود 500 جم",
};

const CUSTOMER_NAMES_AR: Record<string, string> = {
  "CUST-DEMO-1": "شركة الأمل للتجارة",
  "CUST-DEMO-2": "مؤسسة النور للمقاولات",
  "CUST-DEMO-3": "مجموعة الفجر التجارية",
};

/**
 * Tiered sell prices. `PL-DEMO-2`/`PL-DEMO-3` are attached to real customers
 * below, so the tier is what those customers are actually quoted — the seeded
 * quotes price their lines through `POST /price-lists/resolve-price` rather
 * than repeating the numbers.
 */
const PRICE_LISTS = [
  {
    id: "PL-DEMO-1",
    code: "PL-BASE",
    nameAr: "قائمة الأسعار الأساسية",
    nameEn: "Base Price List",
    description: "أسعار البيع المعلنة للتجزئة",
    isBase: true,
    lines: [
      { itemId: "ITEM-DEMO-1", price: "180" },
      { itemId: "ITEM-DEMO-2", price: "95" },
      { itemId: "ITEM-DEMO-3", price: "42" },
      { itemId: "ITEM-DEMO-4", price: "260" },
    ],
  },
  {
    id: "PL-DEMO-2",
    code: "PL-WHOLESALE",
    nameAr: "قائمة أسعار الجملة",
    nameEn: "Wholesale Price List",
    description: "خصم الجملة لعملاء التعاقد السنوي — بشرائح حد أدنى للكمية",
    isBase: false,
    // Volume tiers (R3.11): the same item quoted at three thresholds, so a
    // 60-unit line is priced at 148 and a 3-unit line at 168 off ONE list.
    lines: [
      { itemId: "ITEM-DEMO-1", minQty: "1", unitCode: "PCS", price: "168" },
      { itemId: "ITEM-DEMO-1", minQty: "10", unitCode: "PCS", price: "158" },
      { itemId: "ITEM-DEMO-1", minQty: "50", unitCode: "PCS", price: "148" },
      { itemId: "ITEM-DEMO-2", minQty: "1", unitCode: "PCS", price: "88" },
      { itemId: "ITEM-DEMO-2", minQty: "25", unitCode: "PCS", price: "80" },
      { itemId: "ITEM-DEMO-3", minQty: "1", unitCode: "PCS", price: "39" },
      { itemId: "ITEM-DEMO-4", minQty: "1", unitCode: "PCS", price: "242" },
    ],
  },
  {
    id: "PL-DEMO-3",
    code: "PL-DIST",
    nameAr: "قائمة أسعار الموزعين",
    nameEn: "Distributor Price List",
    description: "أسعار الموزعين المعتمدين بمحافظات الصعيد",
    isBase: false,
    lines: [
      { itemId: "ITEM-DEMO-1", price: "160" },
      { itemId: "ITEM-DEMO-2", price: "84" },
      { itemId: "ITEM-DEMO-3", price: "37" },
      { itemId: "ITEM-DEMO-4", price: "232" },
    ],
  },
  {
    id: "PL-DEMO-4",
    code: "PL-SUMMER25",
    nameAr: "عرض الصيف 2025",
    nameEn: "Summer 2025 Offer",
    description: "حملة موسمية منتهية — محفوظة للأرشيف",
    isBase: false,
    lines: [
      { itemId: "ITEM-DEMO-2", price: "82" },
      { itemId: "ITEM-DEMO-4", price: "228" },
    ],
  },
];

interface QuoteLineSpec {
  readonly itemId: string;
  readonly qty: string;
}

async function priceFrom(
  app: App,
  priceListId: string | null,
  itemId: string,
  fallback: string,
  qty: string,
): Promise<string> {
  // `qty` picks the minimum-quantity tier (R3.11) — asking without it would
  // price every seeded quote line at the "from 1" tier regardless of volume.
  const resolved = (await step(app, "POST", "/price-lists/resolve-price", {
    priceListId,
    itemId,
    fallback,
    qty,
  })) as { price: string };
  return resolved.price;
}

async function createQuote(
  app: App,
  quote: {
    id: string;
    customerId: string;
    date: string;
    expiryDate: string;
    priceListId: string | null;
    notes: string;
    lines: readonly QuoteLineSpec[];
  },
  basePrices: Record<string, string>,
): Promise<void> {
  const lines = [];
  for (let i = 0; i < quote.lines.length; i++) {
    const spec = quote.lines[i] as QuoteLineSpec;
    const fallback = basePrices[spec.itemId] as string;
    lines.push({
      lineId: `${quote.id}-L${i + 1}`,
      itemId: spec.itemId,
      itemNameAr: ITEM_NAMES_AR[spec.itemId] as string,
      qty: spec.qty,
      unitPrice: await priceFrom(app, quote.priceListId, spec.itemId, fallback, spec.qty),
      taxRatePercent: VAT_PERCENT,
    });
  }
  await step(app, "POST", "/sales-quotes", {
    id: quote.id,
    date: quote.date,
    expiryDate: quote.expiryDate,
    customerId: quote.customerId,
    customerNameAr: CUSTOMER_NAMES_AR[quote.customerId] as string,
    branchId: BRANCH_ID,
    currency: "EGP",
    notes: quote.notes,
    priceListId: quote.priceListId,
    lines,
  });
}

export async function seedPurchasing(app: App): Promise<void> {
  const basePrices: Record<string, string> = {
    "ITEM-DEMO-1": "180",
    "ITEM-DEMO-2": "95",
    "ITEM-DEMO-3": "42",
    "ITEM-DEMO-4": "260",
  };

  // --- قوائم الأسعار -------------------------------------------------------

  for (const priceList of PRICE_LISTS) {
    await step(app, "POST", "/price-lists", priceList);
  }
  await step(app, "POST", "/price-lists/PL-DEMO-4/deactivate", {});
  await step(app, "PATCH", `/customers/${CORE.customers[1]}`, { priceListId: "PL-DEMO-2" });
  await step(app, "PATCH", `/customers/${CORE.customers[2]}`, { priceListId: "PL-DEMO-3" });

  // --- طلبات عروض الأسعار ---------------------------------------------------

  await step(app, "POST", "/rfqs", {
    id: "RFQ-DEMO-1",
    date: "2026-08-03",
    requiredByDate: "2026-08-25",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    notes: "تجديد مخزون الزيت والشاي قبل الموسم",
    lines: [
      { itemId: "ITEM-DEMO-2", qty: "200", notes: "عبوة لتر — تاريخ إنتاج حديث" },
      { itemId: "ITEM-DEMO-4", qty: "60", notes: null },
    ],
  });
  await step(app, "POST", "/rfqs/RFQ-DEMO-1/send", {});
  await step(app, "POST", "/rfqs/RFQ-DEMO-1/quotes", {
    id: "RFQQ-DEMO-1",
    supplierId: CORE.suppliers[0],
    notes: "التسليم خلال 10 أيام من أمر الشراء",
    lines: [
      { itemId: "ITEM-DEMO-2", unitPrice: "74", notes: null },
      { itemId: "ITEM-DEMO-4", unitPrice: "203", notes: null },
    ],
  });
  await step(app, "POST", "/rfqs/RFQ-DEMO-1/quotes", {
    id: "RFQQ-DEMO-2",
    supplierId: CORE.suppliers[1],
    notes: "السعر شامل النقل حتى المخزن",
    lines: [
      { itemId: "ITEM-DEMO-2", unitPrice: "72", notes: null },
      { itemId: "ITEM-DEMO-4", unitPrice: "208", notes: null },
    ],
  });
  // سياج أرخص في الإجمالي (26٬880 مقابل 26٬980) رغم أنه أغلى في الشاي.
  await step(app, "POST", "/rfqs/RFQ-DEMO-1/convert", {
    purchaseOrderId: "PO-DEMO-3",
    supplierId: CORE.suppliers[1],
    expectedDeliveryDate: "2026-08-25",
  });

  await step(app, "POST", "/rfqs", {
    id: "RFQ-DEMO-2",
    date: "2026-08-14",
    requiredByDate: "2026-09-10",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    notes: "بانتظار عرض المورد الثاني",
    lines: [
      { itemId: "ITEM-DEMO-1", qty: "150", notes: null },
      { itemId: "ITEM-DEMO-3", qty: "400", notes: null },
    ],
  });
  await step(app, "POST", "/rfqs/RFQ-DEMO-2/send", {});
  await step(app, "POST", "/rfqs/RFQ-DEMO-2/quotes", {
    id: "RFQQ-DEMO-3",
    supplierId: CORE.suppliers[0],
    notes: "سعر ساري حتى 30 سبتمبر",
    lines: [
      { itemId: "ITEM-DEMO-1", unitPrice: "142", notes: null },
      { itemId: "ITEM-DEMO-3", unitPrice: "32", notes: null },
    ],
  });

  await step(app, "POST", "/rfqs", {
    id: "RFQ-DEMO-3",
    date: "2026-08-22",
    requiredByDate: "2026-09-20",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    notes: "مسودة — بانتظار اعتماد مدير المشتريات",
    lines: [{ itemId: "ITEM-DEMO-4", qty: "100", notes: "توريد ربع سنوي" }],
  });

  // --- أوامر الشراء والاستلام والفواتير ---------------------------------------

  await step(app, "POST", "/purchases/orders", {
    id: "PO-DEMO-1",
    supplierId: CORE.suppliers[1],
    date: "2026-08-17",
    expectedDeliveryDate: "2026-09-05",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    notes: "مسودة — بانتظار مراجعة الأسعار",
    lines: [
      { itemId: "ITEM-DEMO-4", qty: "40", unitPrice: "210" },
      { itemId: "ITEM-DEMO-3", qty: "200", unitPrice: "32" },
    ],
  });

  await step(app, "POST", "/purchases/orders", {
    id: "PO-DEMO-2",
    supplierId: CORE.suppliers[0],
    date: "2026-08-05",
    expectedDeliveryDate: "2026-08-12",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    notes: "توريد شهر أغسطس",
    lines: [
      { itemId: "ITEM-DEMO-1", qty: "100", unitPrice: "140" },
      { itemId: "ITEM-DEMO-3", qty: "300", unitPrice: "31" },
    ],
  });
  // A receipt can only be raised against a confirmed ("sent") order, and an
  // invoice only against a CONFIRMED receipt — the 3-gate procurement policy.
  await step(app, "POST", "/purchases/orders/PO-DEMO-2/confirm", {});
  await step(app, "POST", "/purchases/receipts", {
    id: "GRN-DEMO-1",
    purchaseOrderId: "PO-DEMO-2",
    date: "2026-08-11",
    notes: "استلام كامل — مطابق لأمر الشراء",
  });
  await step(app, "POST", "/purchases/receipts/GRN-DEMO-1/confirm", {});
  await step(app, "POST", "/purchases/invoices", {
    id: "PI-DEMO-6",
    supplierId: CORE.suppliers[0],
    date: "2026-08-12",
    dueDate: "2026-09-11",
    supplierInvoiceNumber: "GV-2026-0817",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    receiptId: "GRN-DEMO-1",
    lines: [
      { itemId: "ITEM-DEMO-1", kind: "inventory", qty: "100", unitCost: "140", taxRatePercent: VAT_PERCENT },
      { itemId: "ITEM-DEMO-3", kind: "inventory", qty: "300", unitCost: "31", taxRatePercent: VAT_PERCENT },
    ],
  });
  await step(app, "POST", "/purchases/invoices/PI-DEMO-6/confirm", {});

  await step(app, "POST", "/purchases/orders/PO-DEMO-3/confirm", {});
  await step(app, "POST", "/purchases/receipts", {
    id: "GRN-DEMO-2",
    purchaseOrderId: "PO-DEMO-3",
    date: "2026-08-20",
    notes: "توريد جزئي — الشاي مؤجل لدفعة تالية",
    lines: [{ itemId: "ITEM-DEMO-2", qty: "120", unitCost: "72" }],
  });
  await step(app, "POST", "/purchases/receipts/GRN-DEMO-2/confirm", {});
  await step(app, "POST", "/purchases/invoices", {
    id: "PI-DEMO-7",
    supplierId: CORE.suppliers[1],
    date: "2026-08-20",
    dueDate: "2026-10-19",
    supplierInvoiceNumber: "SY-2026-0442",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    receiptId: "GRN-DEMO-2",
    lines: [
      { itemId: "ITEM-DEMO-2", kind: "inventory", qty: "120", unitCost: "72", taxRatePercent: VAT_PERCENT },
    ],
  });
  await step(app, "POST", "/purchases/invoices/PI-DEMO-7/confirm", {});

  await step(app, "POST", "/purchases/orders", {
    id: "PO-DEMO-4",
    supplierId: CORE.suppliers[0],
    date: "2026-08-21",
    expectedDeliveryDate: "2026-08-28",
    branchId: BRANCH_ID,
    warehouseId: WAREHOUSE_ID,
    currency: "EGP",
    notes: "دفعة سكر إضافية",
    lines: [{ itemId: "ITEM-DEMO-3", qty: "250", unitPrice: "31" }],
  });
  await step(app, "POST", "/purchases/orders/PO-DEMO-4/confirm", {});
  /**
   * Left as a DRAFT receipt on purpose. Confirming a goods receipt moves stock
   * with no GL entry — the offsetting Dr Inventory only posts when its purchase
   * invoice confirms, and no goods-received-not-invoiced accrual account exists
   * in the standard COA. A confirmed-but-uninvoiced receipt would therefore put
   * the inventory sub-ledger ahead of GL 1200 and break `GET /reconciliation`.
   */
  await step(app, "POST", "/purchases/receipts", {
    id: "GRN-DEMO-3",
    purchaseOrderId: "PO-DEMO-4",
    date: "2026-08-23",
    notes: "مسودة استلام — بانتظار جرد أمين المخزن ثم الفاتورة",
  });

  const receiptOne = (await step(app, "GET", "/purchases/receipts/GRN-DEMO-1")) as { number: string };
  const receiptTwo = (await step(app, "GET", "/purchases/receipts/GRN-DEMO-2")) as { number: string };
  const purchaseInvoiceTwo = (await step(app, "GET", "/purchases/invoices/PI-DEMO-7")) as { number: string };

  // --- التكاليف الإضافية ------------------------------------------------------

  /**
   * Targets the RECEIPT that created the cost layers, not the invoice: the
   * revaluation is applied to the layers whose `sourceDocId` matches, and a
   * from-receipt invoice never posts stock of its own.
   */
  await step(app, "POST", "/landed-costs", {
    id: "LC-DEMO-1",
    date: "2026-08-13",
    memo: `تكاليف توريد إذن الاستلام ${receiptOne.number}`,
    distributionMethod: "BY_VALUE",
    costItems: [
      { costType: "SHIPPING", description: "نقل بري من الإسكندرية للمخزن الرئيسي", amount: "1800" },
      { costType: "CLEARANCE", description: "أتعاب تخليص ومناولة", amount: "700" },
    ],
    targets: [
      {
        itemId: "ITEM-DEMO-1",
        warehouseId: WAREHOUSE_ID,
        sourceInvoiceId: "GRN-DEMO-1",
        sourceInvoiceNumber: receiptOne.number,
        qty: "100",
        unitCost: "140",
      },
      {
        itemId: "ITEM-DEMO-3",
        warehouseId: WAREHOUSE_ID,
        sourceInvoiceId: "GRN-DEMO-1",
        sourceInvoiceNumber: receiptOne.number,
        qty: "300",
        unitCost: "31",
      },
    ],
  });
  await step(app, "POST", "/landed-costs/LC-DEMO-1/confirm", {});

  await step(app, "POST", "/landed-costs", {
    id: "LC-DEMO-2",
    date: "2026-08-21",
    memo: `تأمين ورسوم جمركية على إذن الاستلام ${receiptTwo.number}`,
    distributionMethod: "BY_QUANTITY",
    costItems: [
      { costType: "INSURANCE", description: "تأمين بحري على الشحنة", amount: "300" },
      { costType: "CUSTOMS", description: "رسوم جمركية", amount: "450" },
    ],
    targets: [
      {
        itemId: "ITEM-DEMO-2",
        warehouseId: WAREHOUSE_ID,
        sourceInvoiceId: "GRN-DEMO-2",
        sourceInvoiceNumber: receiptTwo.number,
        qty: "120",
        unitCost: "72",
      },
    ],
  });

  // --- مرتجعات المشتريات ------------------------------------------------------

  /**
   * A purchase return credits GL 1200 at the line's `unitCost` while the stock
   * OUT leaves at the position's live weighted average — the two only agree
   * when they are the same number. ITEM-DEMO-2 was received at 72 against
   * existing stock also at 72, and LC-DEMO-2 (which would raise it) is left
   * unconfirmed, so 72 is still the exact average here.
   */
  await step(app, "POST", "/purchase-returns", {
    id: "PRT-DEMO-1",
    date: "2026-08-22",
    memo: "ارتجاع عبوات زيت بها تسريب",
    lines: [
      {
        itemId: "ITEM-DEMO-2",
        warehouseId: WAREHOUSE_ID,
        supplierId: CORE.suppliers[1],
        sourceInvoiceId: "PI-DEMO-7",
        sourceInvoiceNumber: purchaseInvoiceTwo.number,
        reason: "QUALITY_ISSUE",
        availableQty: "120",
        qty: "20",
        unitCost: "72",
        taxAmount: "201.6",
      },
    ],
  });
  await step(app, "POST", "/purchase-returns/PRT-DEMO-1/confirm", {});

  await step(app, "POST", "/purchase-returns", {
    id: "PRT-DEMO-2",
    date: "2026-08-23",
    memo: "مسودة — عبوات مخالفة للمواصفة، بانتظار رد المورد",
    lines: [
      {
        itemId: "ITEM-DEMO-2",
        warehouseId: WAREHOUSE_ID,
        supplierId: CORE.suppliers[1],
        sourceInvoiceId: "PI-DEMO-7",
        sourceInvoiceNumber: purchaseInvoiceTwo.number,
        reason: "DEFECTIVE",
        availableQty: "100",
        qty: "12",
        unitCost: "72",
        taxAmount: "120.96",
      },
    ],
  });

  // --- عروض الأسعار -----------------------------------------------------------

  await createQuote(
    app,
    {
      id: "SQ-DEMO-1",
      customerId: CORE.customers[1] as string,
      date: "2026-08-12",
      expiryDate: "2026-09-11",
      priceListId: "PL-DEMO-2",
      notes: "أسعار الجملة حسب التعاقد السنوي",
      lines: [
        { itemId: "ITEM-DEMO-1", qty: "30" },
        { itemId: "ITEM-DEMO-3", qty: "100" },
      ],
    },
    basePrices,
  );
  await step(app, "POST", "/sales-quotes/SQ-DEMO-1/send", {});
  await step(app, "POST", "/sales-quotes/SQ-DEMO-1/accept", {});
  await step(app, "POST", "/sales-quotes/SQ-DEMO-1/convert-to-invoice", {
    id: "INV-DEMO-6",
    date: "2026-08-14",
    dueDate: "2026-09-28",
    warehouseId: WAREHOUSE_ID,
    arAccountId: ACCOUNTS.receivable,
    taxAccountId: ACCOUNTS.outputVat,
    lines: [
      {
        lineId: "SQ-DEMO-1-L1",
        isStock: true,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      },
      {
        lineId: "SQ-DEMO-1-L2",
        isStock: true,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      },
    ],
  });
  await step(app, "POST", "/sales-invoices/INV-DEMO-6/confirm", {});

  await createQuote(
    app,
    {
      id: "SQ-DEMO-2",
      customerId: CORE.customers[2] as string,
      date: "2026-08-15",
      expiryDate: "2026-08-29",
      priceListId: "PL-DEMO-3",
      notes: "عرض موزعي الصعيد",
      lines: [{ itemId: "ITEM-DEMO-4", qty: "25" }],
    },
    basePrices,
  );
  await step(app, "POST", "/sales-quotes/SQ-DEMO-2/send", {});
  await step(app, "POST", "/sales-quotes/SQ-DEMO-2/reject", {});

  await createQuote(
    app,
    {
      id: "SQ-DEMO-3",
      customerId: CORE.customers[1] as string,
      date: "2026-08-19",
      expiryDate: "2026-09-18",
      priceListId: "PL-DEMO-2",
      notes: "مرسل للعميل — بانتظار الرد",
      lines: [{ itemId: "ITEM-DEMO-2", qty: "80" }],
    },
    basePrices,
  );
  await step(app, "POST", "/sales-quotes/SQ-DEMO-3/send", {});

  await createQuote(
    app,
    {
      id: "SQ-DEMO-4",
      customerId: CORE.customers[0] as string,
      date: "2026-08-23",
      expiryDate: "2026-09-22",
      priceListId: null,
      notes: "مسودة — بأسعار التجزئة المعلنة",
      lines: [
        { itemId: "ITEM-DEMO-2", qty: "60" },
        { itemId: "ITEM-DEMO-4", qty: "10" },
      ],
    },
    basePrices,
  );

  // --- مرتجعات المبيعات --------------------------------------------------------

  const salesInvoiceOne = (await step(app, "GET", `/sales-invoices/${CORE.salesInvoices[0]}`)) as {
    docNo: string | null;
  };
  const salesInvoiceThree = (await step(app, "GET", `/sales-invoices/${CORE.salesInvoices[2]}`)) as {
    docNo: string | null;
  };

  await step(app, "POST", "/sales-returns", {
    id: "SRT-DEMO-1",
    date: "2026-08-17",
    memo: "ارتجاع أكياس سكر تالفة التغليف",
    lines: [
      {
        itemId: "ITEM-DEMO-3",
        warehouseId: WAREHOUSE_ID,
        customerId: CORE.customers[0],
        sourceInvoiceId: CORE.salesInvoices[0],
        sourceInvoiceNumber: salesInvoiceOne.docNo,
        reason: "DEFECTIVE",
        availableQty: "120",
        qty: "20",
        unitPrice: "42",
        unitCost: "31",
        taxAmount: "117.6",
      },
    ],
  });
  await step(app, "POST", "/sales-returns/SRT-DEMO-1/confirm", {});

  await step(app, "POST", "/sales-returns", {
    id: "SRT-DEMO-2",
    date: "2026-08-23",
    memo: "مسودة — العميل طلب استبدال صنف الشاي",
    lines: [
      {
        itemId: "ITEM-DEMO-4",
        warehouseId: WAREHOUSE_ID,
        customerId: CORE.customers[2],
        sourceInvoiceId: CORE.salesInvoices[2],
        sourceInvoiceNumber: salesInvoiceThree.docNo,
        reason: "WRONG_ITEM",
        availableQty: "12",
        qty: "3",
        unitPrice: "260",
        unitCost: "205",
        taxAmount: "109.2",
      },
    ],
  });
}
