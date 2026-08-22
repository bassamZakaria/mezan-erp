import { Money, Qty, type PurchaseRfq, type RfqQuote } from "@mezan/domain";

/**
 * Sample طلبات عروض الأسعار (RFQs, docs/catalog/02-purchases.md) for the Cyag
 * (شركة سياج) demo tenant — drives the RFQs screen exactly like
 * purchasing-sample-data.ts drives Purchase Orders/Receipts/Invoices: no live
 * API wiring (the real `/rfqs` routes already exist in @mezan/api), local
 * state seeded from these fixtures.
 */

function rfqLine(itemId: string, qty: string, notes: string | null = null) {
  return { itemId, description: null, qty: Qty.fromMajor(qty), notes };
}

export const demoRfqs: PurchaseRfq[] = [
  {
    id: "rfq-1",
    number: "RFQ-000003",
    date: "2026-08-10",
    requiredByDate: "2026-08-24",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    notes: "مقارنة أسعار التوريد الشهري",
    lines: [rfqLine("item-cement", "200"), rfqLine("item-steel", "3")],
    status: "sent",
    purchaseOrderId: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-10T09:00:00.000Z",
  },
  {
    id: "rfq-2",
    number: "RFQ-000002",
    date: "2026-08-05",
    requiredByDate: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    notes: null,
    lines: [rfqLine("item-brick", "10", "طوب أحمر فرز أول")],
    status: "closed",
    purchaseOrderId: "po-2",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-05T08:30:00.000Z",
  },
  {
    id: "rfq-3",
    number: "RFQ-000001",
    date: "2026-08-01",
    requiredByDate: "2026-08-10",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    notes: null,
    lines: [rfqLine("item-sand", "8")],
    status: "draft",
    purchaseOrderId: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T07:00:00.000Z",
  },
];

function quoteLine(itemId: string, unitPrice: string) {
  return { itemId, unitPrice: Money.fromMajor(unitPrice), notes: null };
}

export const demoRfqQuotes: RfqQuote[] = [
  {
    id: "rfq-quote-1",
    rfqId: "rfq-1",
    supplierId: "sup-1",
    lines: [quoteLine("item-cement", "84.50"), quoteLine("item-steel", "41800.00")],
    notes: "تسليم خلال 5 أيام",
    submittedAt: "2026-08-11T10:00:00.000Z",
  },
  {
    id: "rfq-quote-2",
    rfqId: "rfq-1",
    supplierId: "sup-2",
    lines: [quoteLine("item-cement", "86.00"), quoteLine("item-steel", "41500.00")],
    notes: null,
    submittedAt: "2026-08-12T11:30:00.000Z",
  },
  {
    id: "rfq-quote-3",
    rfqId: "rfq-1",
    supplierId: "sup-4",
    // Partial quote — only priced one of the two RFQ lines, so it can never
    // win the "full-basket" comparison total or be chosen for conversion.
    lines: [quoteLine("item-cement", "83.00")],
    notes: "الحديد غير متوفر حالياً",
    submittedAt: "2026-08-12T13:00:00.000Z",
  },
];
