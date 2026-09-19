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
  etaReceiptDecimal,
  serializeEtaReceiptSubmission,
  summarizeEtaReceiptQueue,
  unavailableEtaReceiptUuidPort,
  EtaReceiptUuidUnavailableError,
  type EtaReceiptInput,
} from "./receipt.js";
import { EtaRefundReferenceRequiredError } from "./errors.js";
import { SDK_ONE_DOC_JSON, SDK_ONE_DOC_SERIALIZED } from "./__fixtures__/sdk-serialization-sample.js";

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
  seller: { deviceSerialNumber: "POS-0001", branchCode: "1", companyTradeName: "متجر الاختبار" },
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
    // UTC to the second, the SDK's own format.
    expect(sec(payload, "header").dateTimeIssued).toBe("2026-09-01T10:00:00Z");
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
    expect(line.taxableItems).toEqual([{ taxType: "T1", amount: "7.00000", subType: "V009", rate: "14.00" }]);
  });

  it("files a sale as receiptType s and a refund as r, both at typeVersion 1.2 (SDK Receipt / Return Receipt v1.2)", () => {
    const sale = build(receipt);
    expect(sec(sale, "documentType")).toEqual({ receiptType: "s", typeVersion: "1.2" });
    // The e-invoice's own documentVersion must not leak into a receipt.
    expect(build(receipt, { ...config, documentVersion: "0.9" }).documentType).toEqual({ receiptType: "s", typeVersion: "1.2" });

    const refund = build({ ...receipt, receiptType: "refund", paymentMethod: "card", referenceUuid: "a".repeat(64) });
    expect(sec(refund, "documentType")).toEqual({ receiptType: "r", typeVersion: "1.2" });
    expect(refund.paymentMethod).toBe("V");
  });

  it("points a refund at its sale through header.referenceUUID, not referenceOldUUID (D282)", () => {
    const sale = "a".repeat(64);
    const header = sec(build({ ...receipt, receiptType: "refund", referenceUuid: sale }), "header");
    expect(header.referenceUUID).toBe(sale);
    // referenceOldUUID is only for re-issuing a receipt the authority rejected.
    expect(header.referenceOldUUID).toBeUndefined();
    expect(Object.keys(header)).toEqual([
      "dateTimeIssued", "receiptNumber", "uuid", "previousUUID", "referenceUUID", "currency", "exchangeRate",
    ]);
  });

  it("refuses a refund that names no sale, and never sends referenceUUID on a sale", () => {
    expect(() => build({ ...receipt, receiptType: "refund" })).toThrow(EtaRefundReferenceRequiredError);
    expect(sec(build({ ...receipt, referenceUuid: "b".repeat(64) }), "header").referenceUUID).toBeUndefined();
  });

  it("uses only the SDK's payment-method codes (C, V, VO, GC, P, O)", () => {
    const code = (paymentMethod: EtaReceiptInput["paymentMethod"]) => build({ ...receipt, paymentMethod }).paymentMethod;
    expect(code("cash")).toBe("C");
    expect(code("card")).toBe("V");
    expect(code("voucher")).toBe("VO");
    expect(code("gift_card")).toBe("GC");
    expect(code("points")).toBe("P");
    // No wallet or bank-transfer code exists in the table.
    expect(code("wallet")).toBe("O");
    expect(code("transfer")).toBe("O");
  });

  it("carries the mandatory seller fields: trade name and a branch address in EG", () => {
    const seller = sec(build({ ...receipt, seller: { ...receipt.seller, companyTradeName: "متجر الاختبار" } }), "seller");
    expect(seller.companyTradeName).toBe("متجر الاختبار");
    expect(seller.branchAddress).toMatchObject({ country: "EG", governate: "القاهرة", regionCity: "مدينة نصر" });
  });

  it("omits an absent buyer id rather than sending one the 14-digit rule would reject", () => {
    expect(sec(build(receipt), "buyer")).toEqual({ type: "P" });
    expect(sec(build({ ...receipt, buyer: { type: "P", id: "29001011234567", name: "محمود" } }), "buyer")).toEqual({
      type: "P",
      id: "29001011234567",
      name: "محمود",
    });
  });

  it("states every amount to exactly five decimals, the SDK's precision", () => {
    const payload = buildEtaReceiptPayload(receipt, config);
    expect(payload.totalAmount).toBe("57.00000");
    expect(payload.netAmount).toBe("50.00000");
    expect(rows(payload, "itemData")[0]?.quantity).toBe("2.00000");
  });

  it("leaves the exchange rate at zero for EGP and carries it for anything else", () => {
    const egp = build(receipt);
    expect(sec(egp, "header").currency).toBe("EGP");
    expect(sec(egp, "header").exchangeRate).toBe("0");

    const usd = build({ ...receipt, currency: "USD", exchangeRate: "48.25" });
    expect(sec(usd, "header").currency).toBe("USD");
    expect(sec(usd, "header").exchangeRate).toBe("48.25000");
  });

  it("labels both receipt kinds and every payment method in Arabic", () => {
    expect(getEtaReceiptTypeLabel("sale")).toBe("إيصال بيع");
    expect(getEtaReceiptTypeLabel("refund")).toBe("إيصال مرتجع");
    expect(getEtaReceiptPaymentMethodLabel("cash")).toBe("نقداً");
    expect(getEtaReceiptPaymentMethodLabel("wallet")).toBe("محفظة إلكترونية");
  });
});

describe("etaReceiptDecimal — five places, half away from zero", () => {
  it("pads, rounds and keeps the sign", () => {
    expect(etaReceiptDecimal("100.000000")).toBe("100.00000");
    expect(etaReceiptDecimal("1.234565")).toBe("1.23457");
    expect(etaReceiptDecimal("1.234564")).toBe("1.23456");
    expect(etaReceiptDecimal("-0.000004")).toBe("0.00000");
    expect(etaReceiptDecimal("-2.5", 0)).toBe("-3");
    expect(etaReceiptDecimal("14", 2)).toBe("14.00");
  });

  it("refuses anything that is not a decimal", () => {
    expect(() => etaReceiptDecimal("1e3")).toThrow(RangeError);
  });
});

describe("serializeEtaReceiptSubmission — the body POSTed to /receiptsubmissions", () => {
  it("wraps receipts in {receipts, signatures} and writes decimals as numbers with the hashed digits", () => {
    const payload = build(receipt);
    const body = serializeEtaReceiptSubmission([payload]);
    expect(body.startsWith('{"receipts":[{"header":')).toBe(true);
    expect(body.endsWith(',"signatures":[]}')).toBe(true);
    expect(body).toContain('"totalAmount":57.00000');
    expect(body).toContain('"quantity":2.00000');
    // Codes that look numeric stay strings — only Decimal fields become numbers.
    expect(body).toContain('"receiptNumber":"RCP-000001"');
    expect(body).toContain('"activityCode":"4711"');
    const parsed = JSON.parse(body) as { receipts: Record<string, unknown>[] };
    expect(parsed.receipts[0]?.paymentMethod).toBe("C");
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

  it("reproduces the SDK's own serialization sample byte for byte", () => {
    // The sample's numbers are JSON numbers; the canonical form keeps their
    // literal text, which is what quoting them preserves here.
    const literal = SDK_ONE_DOC_JSON.replace(/:\s*(-?\d+(?:\.\d+)?)(\s*[,}\]])/g, ': "$1"$2');
    const { signatures: _signatures, ...document } = JSON.parse(literal) as Record<string, unknown>;
    expect(canonicalizeEtaDocument(document)).toBe(SDK_ONE_DOC_SERIALIZED);
  });

  it("hashes to the UUID with the uuid field empty, and the body's numbers re-serialize to the same text", async () => {
    const payload = build(receipt);
    expect(sec(payload, "header").uuid).toBe("");
    const canonical = canonicalizeEtaDocument(payload);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const uuid = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(uuid).toMatch(/^[0-9a-f]{64}$/);
    // What the authority receives canonicalizes to what was hashed: parse the
    // body keeping number literals, exactly as its serializer does.
    const body = serializeEtaReceiptSubmission([payload]).replace(/:\s*(-?\d+(?:\.\d+)?)(\s*[,}\]])/g, ':"$1"$2');
    const sent = (JSON.parse(body) as { receipts: Record<string, unknown>[] }).receipts[0]!;
    expect(canonicalizeEtaDocument(sent)).toBe(canonical);
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
  it("defaults to the authority's own 24 hours from the sale", () => {
    expect(ETA_RECEIPT_REPORTING_WINDOW_HOURS).toBe(24);
    expect(etaReceiptReportingDeadline("2026-09-01T10:00:00.000Z")).toBe("2026-09-02T10:00:00.000Z");
  });

  it("takes the configured window when a tenant has been told a different figure", () => {
    expect(etaReceiptReportingDeadline("2026-09-01T10:00:00.000Z", 72)).toBe("2026-09-04T10:00:00.000Z");
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-03T10:00:00.000Z", 72)).toBe(24);
  });

  it("counts down and then goes negative", () => {
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z")).toBe(24);
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-02T10:00:00.000Z")).toBe(0);
    expect(etaReceiptHoursRemaining("2026-09-01T10:00:00.000Z", "2026-09-03T10:00:00.000Z")).toBe(-24);
  });

  it("reads the sale moment from the payload, not the enqueue stamp", () => {
    const payload = buildEtaReceiptPayload(receipt, config);
    expect(etaReceiptIssuedAt({ payload, createdAt: "2026-09-03T00:00:00.000Z" })).toBe("2026-09-01T10:00:00Z");
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
      72,
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
      72,
    );
    expect(summary.overdue).toBe(0);
    expect(summary.dueSoon).toBe(1);
  });

  it("scales «due soon» to the window, so a 24-hour window does not call every pending receipt urgent", () => {
    const fresh = summarizeEtaReceiptQueue(
      [queued("RCP-1", "2026-09-01T10:00:00.000Z")],
      "2026-09-01T14:00:00.000Z",
    );
    expect(fresh.dueSoon).toBe(0);
    const near = summarizeEtaReceiptQueue(
      [queued("RCP-1", "2026-09-01T10:00:00.000Z")],
      "2026-09-01T23:00:00.000Z",
    );
    expect(near.dueSoon).toBe(1);
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
  it("follows the SDK template {URL}#Total:{Total},IssuerRIN:{RIN}", () => {
    expect(
      etaReceiptQrValue({
        uuid: "abc123",
        issueDateTime: "2026-09-01T10:00:00Z",
        environment: "production",
        totalAmount: "1000.00000",
        issuerRin: "674859545",
      }),
    ).toBe("https://invoicing.eta.gov.eg/receipts/search/abc123/share/2026-09-01T10:00:00Z#Total:1000.00000,IssuerRIN:674859545");
  });

  it("points at the authority's own portal for the configured environment", () => {
    expect(
      etaReceiptQrValue({ uuid: "abc123", issueDateTime: "2026-09-01T10:00:00Z", environment: "production" }),
    ).toBe("https://invoicing.eta.gov.eg/receipts/search/abc123/share/2026-09-01T10:00:00Z");
    expect(
      etaReceiptQrValue({ uuid: "abc123", issueDateTime: "2026-09-01T10:00:00Z", environment: "preproduction" }),
    ).toContain("preprod.invoicing.eta.gov.eg");
  });
});
