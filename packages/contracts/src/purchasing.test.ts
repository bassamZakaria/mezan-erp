import { describe, it, expect } from "vitest";
import {
  purchaseOrderStatusSchema,
  goodsReceiptStatusSchema,
  purchaseInvoiceStatusSchema,
  purchaseInvoiceLineKindSchema,
  purchaseOrderLineSchema,
  purchaseOrderSchema,
  createPurchaseOrderLineSchema,
  createPurchaseOrderSchema,
  goodsReceiptLineSchema,
  goodsReceiptSchema,
  createGoodsReceiptLineSchema,
  createGoodsReceiptSchema,
  purchaseInvoiceLineSchema,
  purchaseInvoiceSchema,
  createPurchaseInvoiceLineSchema,
  purchaseInvoiceLineFulfilmentSchema,
  purchaseInvoiceFulfilmentSchema,
  purchaseInvoicePaymentSchema,
  createPurchaseInvoiceSchema,
  purchaseRfqStatusSchema,
  purchaseRfqLineSchema,
  purchaseRfqSchema,
  createPurchaseRfqLineSchema,
  createPurchaseRfqSchema,
  rfqQuoteLineSchema,
  rfqQuoteSchema,
  createRfqQuoteLineSchema,
  createRfqQuoteSchema,
  convertRfqSchema,
  purchaseInvoiceFilterKeySchema,
  purchaseInvoiceListQuerySchema,
  purchaseInvoiceStatsSchema,
} from "./purchasing.js";

describe("purchaseOrderStatusSchema", () => {
  it("accepts each known status", () => {
    for (const s of ["draft", "sent", "partially_received", "fully_received", "cancelled"]) {
      expect(purchaseOrderStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(purchaseOrderStatusSchema.safeParse("closed").success).toBe(false);
  });
});

describe("goodsReceiptStatusSchema", () => {
  it("accepts draft, confirmed and cancelled", () => {
    for (const s of ["draft", "confirmed", "cancelled"]) {
      expect(goodsReceiptStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(goodsReceiptStatusSchema.safeParse("posted").success).toBe(false);
  });
});

describe("purchaseInvoiceStatusSchema", () => {
  it("accepts draft, confirmed and cancelled", () => {
    for (const s of ["draft", "confirmed", "cancelled"]) {
      expect(purchaseInvoiceStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(purchaseInvoiceStatusSchema.safeParse("posted").success).toBe(false);
  });
});

describe("purchaseInvoiceLineKindSchema", () => {
  it("accepts inventory, expense and freight", () => {
    for (const k of ["inventory", "expense", "freight"]) {
      expect(purchaseInvoiceLineKindSchema.safeParse(k).success).toBe(true);
    }
  });

  it("rejects a kind outside the enum", () => {
    expect(purchaseInvoiceLineKindSchema.safeParse("capital").success).toBe(false);
  });
});

describe("purchaseRfqStatusSchema", () => {
  it("accepts draft, sent, closed and cancelled", () => {
    for (const s of ["draft", "sent", "closed", "cancelled"]) {
      expect(purchaseRfqStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a status outside the enum", () => {
    expect(purchaseRfqStatusSchema.safeParse("expired").success).toBe(false);
  });
});

describe("goodsReceiptLineSchema", () => {
  const line = { itemId: "item-1", description: null, qty: "5.000000", unitCost: "50.123456", batchNo: null, expiryDate: null };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = goodsReceiptLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = goodsReceiptLineSchema.safeParse({ ...line, unitCost: 50 });
    expect(result.success).toBe(false);
  });
});

describe("purchaseOrderLineSchema", () => {
  const line = { itemId: "item-1", description: null, qty: "10.000000", unitPrice: "50.123456", receivedQty: "0" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = purchaseOrderLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("never coerces unitPrice to a float — high-precision decimal string survives verbatim", () => {
    const result = purchaseOrderLineSchema.safeParse({ ...line, unitPrice: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe("0.100001");
  });

  it("rejects unitPrice sent as a JS number instead of a string", () => {
    const result = purchaseOrderLineSchema.safeParse({ ...line, unitPrice: 50.12 });
    expect(result.success).toBe(false);
  });
});

describe("createPurchaseOrderLineSchema", () => {
  it("accepts a minimal valid line", () => {
    const result = createPurchaseOrderLineSchema.safeParse({ itemId: "item-1", qty: "10.000000", unitPrice: "50.000000" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative qty", () => {
    const result = createPurchaseOrderLineSchema.safeParse({ itemId: "item-1", qty: "-1", unitPrice: "50.000000" });
    expect(result.success).toBe(false);
  });
});

describe("createPurchaseOrderSchema", () => {
  const create = {
    id: "po-1",
    supplierId: "sup-1",
    date: "2026-08-30",
    branchId: "branch-1",
    warehouseId: "wh-1",
    lines: [{ itemId: "item-1", qty: "10.000000", unitPrice: "50.000000" }],
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createPurchaseOrderSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects an empty lines array", () => {
    const result = createPurchaseOrderSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("lines");
  });
});

describe("createGoodsReceiptSchema", () => {
  it("accepts a minimal valid PO-linked receipt with lines omitted (auto-fill from PO)", () => {
    const result = createGoodsReceiptSchema.safeParse({ id: "gr-1", purchaseOrderId: "po-1", date: "2026-08-30" });
    expect(result.success).toBe(true);
  });

  it("accepts an ad-hoc receipt with explicit supplierId/warehouseId/lines and no PO", () => {
    const result = createGoodsReceiptSchema.safeParse({
      id: "gr-1",
      date: "2026-08-30",
      supplierId: "sup-1",
      warehouseId: "wh-1",
      lines: [{ itemId: "item-1", qty: "10.000000", unitCost: "50.000000" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a lines array with fewer than one entry when supplied", () => {
    const result = createGoodsReceiptSchema.safeParse({ id: "gr-1", date: "2026-08-30", lines: [] });
    expect(result.success).toBe(false);
  });
});

describe("createGoodsReceiptLineSchema", () => {
  it("never coerces unitCost to a float", () => {
    const result = createGoodsReceiptLineSchema.safeParse({ itemId: "item-1", qty: "5.000000", unitCost: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitCost).toBe("0.100001");
  });

  it("rejects unitCost sent as a JS number instead of a string", () => {
    const result = createGoodsReceiptLineSchema.safeParse({ itemId: "item-1", qty: "5.000000", unitCost: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO expiryDate when supplied — expiryDate uses isoDate, unlike batchNo/description", () => {
    const result = createGoodsReceiptLineSchema.safeParse({ itemId: "item-1", qty: "5.000000", unitCost: "50.000000", expiryDate: "" });
    expect(result.success).toBe(false);
  });
});

describe("goodsReceiptSchema", () => {
  const receipt = {
    id: "gr-1",
    number: "GR-2026-001",
    purchaseOrderId: "po-1",
    supplierId: "sup-1",
    warehouseId: "wh-1",
    date: "2026-08-30",
    notes: null,
    lines: [],
    status: "confirmed" as const,
    invoiced: false,
    totalCost: "0",
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid receipt and preserves every field verbatim", () => {
    const result = goodsReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(receipt);
  });

  it("accepts a null purchaseOrderId for an ad-hoc receipt", () => {
    const result = goodsReceiptSchema.safeParse({ ...receipt, purchaseOrderId: null });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status", () => {
    const result = goodsReceiptSchema.safeParse({ ...receipt, status: "posted" });
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoiceLineSchema", () => {
  const line = { itemId: "item-1", description: null, kind: "inventory" as const, qty: "10.000000", unitCost: "50.000000", taxRatePercent: 14, batchNo: null, expiryDate: null };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = purchaseInvoiceLineSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("accepts a null itemId for a pure expense/freight line", () => {
    const result = purchaseInvoiceLineSchema.safeParse({ ...line, itemId: null, kind: "expense" as const });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum kind", () => {
    const result = purchaseInvoiceLineSchema.safeParse({ ...line, kind: "capital" });
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoiceSchema", () => {
  const invoice = {
    id: "pi-1",
    number: "PI-2026-001",
    supplierId: "sup-1",
    date: "2026-08-30",
    dueDate: "2026-09-30",
    supplierInvoiceNumber: null,
    branchId: "branch-1",
    warehouseId: "wh-1",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [],
    status: "confirmed" as const,
    subtotal: "1000.000000",
    tax: "140.000000",
    total: "1140.000000",
    amountPaid: "500.000000",
    remainingBalance: "640.000000",
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid invoice and preserves every field verbatim", () => {
    const result = purchaseInvoiceSchema.safeParse(invoice);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(invoice);
  });

  it("accepts an explicit fxRate for a foreign-currency invoice", () => {
    const result = purchaseInvoiceSchema.safeParse({ ...invoice, currency: "USD", fxRate: "49.500000" });
    expect(result.success).toBe(true);
  });

  it("never coerces total to a float — high-precision decimal string survives verbatim", () => {
    const result = purchaseInvoiceSchema.safeParse({ ...invoice, total: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.total).toBe("0.100001");
  });

  it("rejects total sent as a JS number instead of a string", () => {
    const result = purchaseInvoiceSchema.safeParse({ ...invoice, total: 1140.12 });
    expect(result.success).toBe(false);
  });
});

describe("createPurchaseInvoiceSchema", () => {
  const create = { id: "pi-1", supplierId: "sup-1", date: "2026-08-30", branchId: "branch-1", warehouseId: "wh-1" };

  it("accepts a minimal valid payload with lines omitted (auto-fill from receipt)", () => {
    const result = createPurchaseInvoiceSchema.safeParse(create);
    expect(result.success).toBe(true);
  });

  it("rejects a lines array with zero entries when supplied", () => {
    const result = createPurchaseInvoiceSchema.safeParse({ ...create, lines: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing warehouseId", () => {
    const { warehouseId, ...rest } = create;
    const result = createPurchaseInvoiceSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("warehouseId");
  });
});

describe("purchaseInvoiceLineFulfilmentSchema", () => {
  const line = { lineIndex: 0, itemId: "item-1", invoicedQty: "10.000000", receivedQty: "10.000000", consumedQty: "3.000000", remainingQty: "7.000000" };

  it("accepts a minimal valid line and preserves every field verbatim", () => {
    const result = purchaseInvoiceLineFulfilmentSchema.safeParse(line);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(line);
  });

  it("rejects a negative lineIndex", () => {
    const result = purchaseInvoiceLineFulfilmentSchema.safeParse({ ...line, lineIndex: -1 });
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoiceFulfilmentSchema", () => {
  it("accepts a minimal valid payload with an empty lines array", () => {
    const result = purchaseInvoiceFulfilmentSchema.safeParse({ invoiceId: "pi-1", sourceDocId: null, sourceDocType: null, lines: [] });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum sourceDocType", () => {
    const result = purchaseInvoiceFulfilmentSchema.safeParse({ invoiceId: "pi-1", sourceDocId: "gr-1", sourceDocType: "MANUAL", lines: [] });
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoicePaymentSchema", () => {
  const payment = { amount: "500.123456", treasuryAccountId: "acc-cash" };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = purchaseInvoicePaymentSchema.safeParse(payment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(payment);
  });

  it("never coerces amount to a float", () => {
    const result = purchaseInvoicePaymentSchema.safeParse({ ...payment, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = purchaseInvoicePaymentSchema.safeParse({ ...payment, amount: 500.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing treasuryAccountId", () => {
    const { treasuryAccountId, ...rest } = payment;
    const result = purchaseInvoicePaymentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("treasuryAccountId");
  });
});

describe("purchaseRfqSchema and related", () => {
  const rfqLine = { itemId: "item-1", description: null, qty: "5.000000", notes: null };
  const rfq = {
    id: "rfq-1",
    number: "RFQ-2026-001",
    date: "2026-08-30",
    requiredByDate: null,
    branchId: "branch-1",
    warehouseId: "wh-1",
    notes: null,
    lines: [rfqLine],
    status: "sent" as const,
    purchaseOrderId: null,
    createdBy: "user-1",
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid RFQ and preserves every field verbatim", () => {
    const result = purchaseRfqSchema.safeParse(rfq);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rfq);
  });

  it("rejects an out-of-enum RFQ status", () => {
    const result = purchaseRfqSchema.safeParse({ ...rfq, status: "expired" });
    expect(result.success).toBe(false);
  });

  it("createPurchaseRfqSchema rejects an empty lines array", () => {
    const result = createPurchaseRfqSchema.safeParse({ id: "rfq-1", date: "2026-08-30", branchId: "branch-1", warehouseId: "wh-1", lines: [] });
    expect(result.success).toBe(false);
  });

  it("createPurchaseRfqLineSchema rejects a negative qty", () => {
    const result = createPurchaseRfqLineSchema.safeParse({ itemId: "item-1", qty: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("rfqQuoteSchema and related", () => {
  const quoteLine = { itemId: "item-1", unitPrice: "50.000000", notes: null };
  const quote = { id: "quote-1", rfqId: "rfq-1", supplierId: "sup-1", lines: [quoteLine], notes: null, submittedAt: "2026-08-31T10:00:00.000Z" };

  it("accepts a minimal valid quote and preserves every field verbatim", () => {
    const result = rfqQuoteSchema.safeParse(quote);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(quote);
  });

  it("never coerces unitPrice to a float", () => {
    const result = rfqQuoteLineSchema.safeParse({ itemId: "item-1", unitPrice: "0.100001", notes: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unitPrice).toBe("0.100001");
  });

  it("createRfqQuoteSchema rejects an empty lines array", () => {
    const result = createRfqQuoteSchema.safeParse({ id: "quote-1", supplierId: "sup-1", lines: [] });
    expect(result.success).toBe(false);
  });

  it("createRfqQuoteLineSchema rejects a negative unitPrice", () => {
    const result = createRfqQuoteLineSchema.safeParse({ itemId: "item-1", unitPrice: "-1" });
    expect(result.success).toBe(false);
  });
});

describe("convertRfqSchema", () => {
  it("accepts a minimal valid payload with the optional delivery date omitted", () => {
    const result = convertRfqSchema.safeParse({ purchaseOrderId: "po-1", supplierId: "sup-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing supplierId", () => {
    const result = convertRfqSchema.safeParse({ purchaseOrderId: "po-1" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("supplierId");
  });
});

describe("purchaseInvoiceFilterKeySchema", () => {
  it("accepts a stored status and each derived chip", () => {
    expect(purchaseInvoiceFilterKeySchema.safeParse("confirmed").success).toBe(true);
    for (const chip of ["all", "overdue", "due_soon", "partially_paid", "paid"]) {
      expect(purchaseInvoiceFilterKeySchema.safeParse(chip).success).toBe(true);
    }
  });

  it("rejects a value in neither union member", () => {
    const result = purchaseInvoiceFilterKeySchema.safeParse("archived");
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoiceListQuerySchema", () => {
  it("accepts an empty query", () => {
    const result = purchaseInvoiceListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status filter", () => {
    const result = purchaseInvoiceListQuerySchema.safeParse({ status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("purchaseInvoiceStatsSchema", () => {
  const stats = { count: 42, purchases: "500000.000000", paid: "400000.000000", unpaid: "100000.000000" };

  it("accepts a minimal valid stats payload and preserves every field verbatim", () => {
    const result = purchaseInvoiceStatsSchema.safeParse(stats);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(stats);
  });

  it("rejects a stats payload missing paid", () => {
    const { paid, ...rest } = stats;
    const result = purchaseInvoiceStatsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
