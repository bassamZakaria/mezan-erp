import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig } from "./config.js";
import {
  ETA_RECEIPT_REPORTING_WINDOW_HOURS,
  buildEtaReceiptPayload,
  canonicalizeEtaDocument,
  etaReceiptHoursRemaining,
  etaReceiptIssuedAt,
  etaReceiptQrValue,
  etaReceiptReportingDeadline,
  getEtaReceiptPaymentMethodLabel,
  getEtaReceiptTypeLabel,
  summarizeEtaReceiptQueue,
  unavailableEtaReceiptUuidPort,
  EtaReceiptUuidUnavailableError,
  type EtaReceiptInput,
} from "./receipt.js";

const config: EtaConfig = {
  ...DEFAULT_ETA_CONFIG,
  taxRegistrationNumber: "123456789",
  activityCode: "4711",
  address: {
    governorate: "القاهرة",
    city: "مدينة نصر",
    street: "شارع مصطفى النحاس",
    buildingNumber: "12",
    postalCode: "11765",
  },
};

const build = (input: EtaReceiptInput, cfg: EtaConfig = config) => buildEtaReceiptPayload(input, cfg);
const sec = (payload: Record<string, unknown>, key: string) => payload[key] as Record<string, unknown>;
const rows = (payload: Record<string, unknown>, key: string) => payload[key] as Record<string, unknown>[];

const receipt: EtaReceiptInput = {
  internalId: "RCP-000001",
  issueDateTime: "2026-09-01T10:00:00.000Z",
  receiptType: "sale",
  previousUuid: null,
  seller: { deviceSerialNumber: "POS-0001", branchCode: "1" },
  buyer: { type: "P", id: null, name: null },
  paymentMethod: "cash",
  lines: [
    {
      internalCode: "SKU-1",
      description: "شاي",
      itemType: "EGS",
      itemCode: "EG-10000001-1",
      unitType: "EA",
      quantity: "2",
      unitPrice: "25.00",
      totalSale: "50.00",
      netSale: "50.00",
      total: "57.00",
      taxSubType: "V009",
      taxRate: "14",
      taxAmount: "7.00",
    },
  ],
  totalSales: "50.00",
  netAmount: "50.00",
  totalAmount: "57.00",
  taxTotals: [{ taxType: "T1", amount: "7.00" }],
};

describe("buildEtaReceiptPayload — the receipt document, not the invoice one", () => {
  it("nests identity under header and names the parties seller/buyer", () => {
    const payload = build(receipt);
    expect(sec(payload, "header").receiptNumber).toBe("RCP-000001");
    expect(sec(payload, "header").dateTimeIssued).toBe("2026-09-01T10:00:00.000Z");
    expect(sec(payload, "seller").rin).toBe("123456789");
    expect(sec(payload, "buyer").type).toBe("P");
    // The invoice document's own field names must NOT appear.
    expect(payload.issuer).toBeUndefined();
    expect(payload.receiver).toBeUndefined();
    expect(payload.invoiceLines).toBeUndefined();
  });

  it("carries the device serial number, which no invoice document has", () => {
    const payload = build(receipt);
    expect(sec(payload, "seller").deviceSerialNumber).toBe("POS-0001");
  });

  it("puts the lines in itemData with the item's coding scheme", () => {
    const payload = build(receipt);
    const line = rows(payload, "itemData")[0] as Record<string, unknown>;
    expect(line.itemType).toBe("EGS");
    expect(line.itemCode).toBe("EG-10000001-1");
    expect(line.taxableItems).toEqual([{ taxType: "T1", amount: "7.00", subType: "V009", rate: "14" }]);
  });

  it("maps sale/refund and the payment method to the authority's codes", () => {
    const sale = build(receipt);
    expect(sec(sale, "documentType").receiptType).toBe("S");
    expect(sale.paymentMethod).toBe("C");

    const refund = build({ ...receipt, receiptType: "refund", paymentMethod: "card", referenceOldUuid: "OLD-UUID" });
    expect(sec(refund, "documentType").receiptType).toBe("R");
    expect(refund.paymentMethod).toBe("V");
    expect(sec(refund, "header").referenceOldUUID).toBe("OLD-UUID");
  });

  it("keeps money as the exact decimal strings it was handed", () => {
    const payload = buildEtaReceiptPayload(receipt, config);
    expect(payload.totalAmount).toBe("57.00");
    expect(payload.netAmount).toBe("50.00");
    expect(typeof payload.totalAmount).toBe("string");
  });

  it("leaves the exchange rate at zero for EGP and carries it for anything else", () => {
    const egp = build(receipt);
    expect(sec(egp, "header").currency).toBe("EGP");
    expect(sec(egp, "header").exchangeRate).toBe("0");

    const usd = build({ ...receipt, currency: "USD", exchangeRate: "48.25" });
    expect(sec(usd, "header").currency).toBe("USD");
    expect(sec(usd, "header").exchangeRate).toBe("48.25");
  });

  it("labels both receipt kinds and every payment method in Arabic", () => {
    expect(getEtaReceiptTypeLabel("sale")).toBe("إيصال بيع");
    expect(getEtaReceiptTypeLabel("refund")).toBe("إيصال مرتجع");
    expect(getEtaReceiptPaymentMethodLabel("cash")).toBe("نقداً");
    expect(getEtaReceiptPaymentMethodLabel("wallet")).toBe("محفظة إلكترونية");
  });
});

describe("canonicalizeEtaDocument — the string the UUID is a hash of", () => {
  it("upper-cases and quotes field names and quotes string values", () => {
    expect(canonicalizeEtaDocument({ receiptNumber: "RCP-1" })).toBe('"RECEIPTNUMBER""RCP-1"');
  });

  it("repeats the property name once per array element", () => {
    expect(canonicalizeEtaDocument({ taxTotals: [{ amount: "1" }, { amount: "2" }] })).toBe(
      '"TAXTOTALS""TAXTOTALS""AMOUNT""1""TAXTOTALS""AMOUNT""2"',
    );
  });

  it("escapes an embedded quote rather than ending the value early", () => {
    expect(canonicalizeEtaDocument({ description: 'a"b' })).toBe('"DESCRIPTION""a\\"b"');
  });

  it("renders null as an empty string, so an absent field is not a missing one", () => {
    expect(canonicalizeEtaDocument({ id: null })).toBe('"ID"""');
  });

  it("is deterministic — the same document canonicalizes identically every time", () => {
    const payload = buildEtaReceiptPayload(receipt, config);
    expect(canonicalizeEtaDocument(payload)).toBe(canonicalizeEtaDocument(payload));
  });
});

describe("the receipt UUID port", () => {
  it("refuses by default rather than inventing an identifier", async () => {
    await expect(unavailableEtaReceiptUuidPort().compute("anything")).rejects.toBeInstanceOf(
      EtaReceiptUuidUnavailableError,
    );
  });
});

describe("the post-sale reporting window", () => {
  it("is 72 hours from the sale", () => {
    expect(ETA_RECEIPT_REPORTING_WINDOW_HOURS).toBe(72);
    expect(etaReceiptReportingDeadline("2026-09-01T10:00:00.000Z")).toBe("2026-09-04T10:00:00.000Z");
  });

  it("counts down and then goes negative", () => {
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z")).toBe(72);
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-03T10:00:00.000Z")).toBe(24);
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-05T10:00:00.000Z")).toBe(-24);
  });

  it("reads the sale moment from the payload, not the enqueue stamp", () => {
    const payload = buildEtaReceiptPayload(receipt, config);
    expect(etaReceiptIssuedAt({ payload, createdAt: "2026-09-03T00:00:00.000Z" })).toBe(
      "2026-09-01T10:00:00.000Z",
    );
    expect(etaReceiptIssuedAt({ payload: null, createdAt: "2026-09-03T00:00:00.000Z" })).toBe(
      "2026-09-03T00:00:00.000Z",
    );
  });
});

function queued(internalId: string, issuedAt: string, status = "ready", documentType = "receipt") {
  return {
    id: `s-${internalId}`,
    internalId,
    documentType,
    status,
    payload: { header: { dateTimeIssued: issuedAt } },
    createdAt: issuedAt,
  };
}

describe("summarizeEtaReceiptQueue — saying out loud what has aged past the window", () => {
  it("counts nothing when the queue is empty", () => {
    const summary = summarizeEtaReceiptQueue([], "2026-09-05T00:00:00.000Z");
    expect(summary).toMatchObject({ pending: 0, overdue: 0, dueSoon: 0, oldestPendingIssuedAt: null });
  });

  it("separates overdue from merely pending", () => {
    const summary = summarizeEtaReceiptQueue(
      [
        queued("RCP-1", "2026-09-01T10:00:00.000Z"),
        queued("RCP-2", "2026-09-04T10:00:00.000Z"),
        queued("RCP-3", "2026-09-05T00:00:00.000Z"),
      ],
      "2026-09-05T12:00:00.000Z",
    );
    expect(summary.pending).toBe(3);
    expect(summary.overdue).toBe(1);
    expect(summary.overdueEntries.map((e) => e.internalId)).toEqual(["RCP-1"]);
    expect(summary.oldestPendingIssuedAt).toBe("2026-09-01T10:00:00.000Z");
  });

  it("flags a receipt with under 24 hours left as due soon", () => {
    const summary = summarizeEtaReceiptQueue(
      [queued("RCP-1", "2026-09-01T10:00:00.000Z")],
      "2026-09-04T00:00:00.000Z",
    );
    expect(summary.overdue).toBe(0);
    expect(summary.dueSoon).toBe(1);
  });

  it("ignores receipts the authority already has, and every non-receipt document", () => {
    const summary = summarizeEtaReceiptQueue(
      [
        queued("RCP-1", "2026-09-01T10:00:00.000Z", "accepted"),
        queued("RCP-2", "2026-09-01T10:00:00.000Z", "submitted"),
        queued("RCP-3", "2026-09-01T10:00:00.000Z", "excluded"),
        queued("INV-1", "2026-09-01T10:00:00.000Z", "ready", "invoice"),
      ],
      "2026-09-10T00:00:00.000Z",
    );
    expect(summary.pending).toBe(0);
    expect(summary.overdue).toBe(0);
  });

  it("counts a rejected receipt as still unreported — an error is not a filing", () => {
    const summary = summarizeEtaReceiptQueue(
      [queued("RCP-1", "2026-09-01T10:00:00.000Z", "error")],
      "2026-09-10T00:00:00.000Z",
    );
    expect(summary.pending).toBe(1);
    expect(summary.overdue).toBe(1);
  });
});

describe("etaReceiptQrValue", () => {
  it("points at the authority's own portal for the configured environment", () => {
    expect(
      etaReceiptQrValue({ uuid: "abc123", issueDateTime: "2026-09-01T10:00:00Z", environment: "production" }),
    ).toBe("https://invoicing.eta.gov.eg/receipts/search/abc123/share/2026-09-01T10%3A00%3A00Z");
    expect(
      etaReceiptQrValue({ uuid: "abc123", issueDateTime: "2026-09-01T10:00:00Z", environment: "preproduction" }),
    ).toContain("preprod.invoicing.eta.gov.eg");
  });
});
