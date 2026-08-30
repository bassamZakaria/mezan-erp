import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig } from "./config.js";
import { buildEtaPayload, type EtaDocumentInput } from "./payload.js";

const config: EtaConfig = {
  ...DEFAULT_ETA_CONFIG,
  taxRegistrationNumber: "123456789",
  activityCode: "4711",
  address: {
    governorate: "القاهرة",
    city: "مدينة نصر",
    street: "شارع مصطفى النحاس",
    buildingNumber: "12",
    postalCode: "11762",
  },
};

const line = {
  description: "أرز أبيض 5 كجم",
  itemCode: "EG-123456789-001",
  quantity: "2.000000",
  unitType: "EA",
  unitPrice: "125.500000",
  netTotal: "251.000000",
  taxSubType: "V009",
  taxRate: "14",
  taxAmount: "35.140000",
};

const input: EtaDocumentInput = {
  internalId: "INV-000014",
  documentType: "invoice",
  issueDateTime: "2026-08-30T10:15:00Z",
  receiver: { registrationNumber: "987654321", name: "شركة الأمل للتجارة", type: "B" },
  branchCode: "0001",
  lines: [line],
  totalNet: "251.000000",
  totalTax: "35.140000",
  totalAmount: "286.140000",
};

type Payload = {
  documentType: string;
  documentTypeVersion: string;
  dateTimeIssued: string;
  taxpayerActivityCode: string | null;
  internalId: string;
  issuer: { type: string; id: string | null; address: Record<string, unknown> | null };
  receiver: { type: string; id: string | null; name: string };
  invoiceLines: {
    description: string;
    itemCode: string;
    quantity: string;
    unitType: string;
    unitValue: { currencySold: string; amountEGP: string };
    netTotal: string;
    taxableItems: { taxType: string; subType: string; rate: string; amount: string }[];
  }[];
  totalSalesAmount: string;
  totalTaxAmount: string;
  totalAmount: string;
};

const build = (patch: Partial<EtaDocumentInput> = {}, cfg: EtaConfig = config) =>
  buildEtaPayload({ ...input, ...patch }, cfg) as Payload;

describe("buildEtaPayload", () => {
  it("maps each document type to the authority's single-letter code", () => {
    expect(build({ documentType: "invoice" }).documentType).toBe("I");
    expect(build({ documentType: "credit_note" }).documentType).toBe("C");
    expect(build({ documentType: "debit_note" }).documentType).toBe("D");
  });

  it("carries the tenant's registration, activity code and document version from the config", () => {
    const payload = build();
    expect(payload.taxpayerActivityCode).toBe("4711");
    expect(payload.issuer.id).toBe("123456789");
    expect(payload.documentTypeVersion).toBe("1.0");
    expect(build({}, { ...config, documentVersion: "0.9" }).documentTypeVersion).toBe("0.9");
  });

  it("identifies the issuer as a business and keeps the branch inside its address", () => {
    const payload = build();
    expect(payload.issuer.type).toBe("B");
    expect(payload.issuer.address).toMatchObject({
      governate: "القاهرة",
      regionCity: "مدينة نصر",
      street: "شارع مصطفى النحاس",
      buildingNumber: "12",
      postalCode: "11762",
      branchId: "0001",
    });
  });

  it("sends no address at all when the tenant has not registered one", () => {
    expect(build({}, { ...config, address: null }).issuer.address).toBeNull();
  });

  it("keeps a null branch code rather than inventing one", () => {
    expect((build({ branchCode: null }).issuer.address as { branchId: string | null }).branchId).toBeNull();
  });

  it("carries the receiver's type, registration and name as given", () => {
    expect(build().receiver).toEqual({ type: "B", id: "987654321", name: "شركة الأمل للتجارة" });
    expect(build({ receiver: { registrationNumber: null, name: "عميل نقدي", type: "P" } }).receiver).toEqual({
      type: "P",
      id: null,
      name: "عميل نقدي",
    });
  });

  it("keeps every amount as the exact decimal string it was handed", () => {
    const payload = build();
    expect(payload.totalSalesAmount).toBe("251.000000");
    expect(payload.totalTaxAmount).toBe("35.140000");
    expect(payload.totalAmount).toBe("286.140000");
    expect(payload.invoiceLines[0]?.netTotal).toBe("251.000000");
    expect(payload.invoiceLines[0]?.unitValue.amountEGP).toBe("125.500000");
    for (const value of [payload.totalSalesAmount, payload.totalTaxAmount, payload.totalAmount]) {
      expect(typeof value).toBe("string");
    }
  });

  it("writes one taxable item per line, carrying the sub-type, rate and amount", () => {
    const [first] = build().invoiceLines;
    expect(first?.taxableItems).toEqual([{ taxType: "T1", subType: "V009", rate: "14", amount: "35.140000" }]);
  });

  it("keeps the lines in the order the document holds them", () => {
    const second = { ...line, description: "سكر 1 كجم", itemCode: "EG-123456789-002" };
    const payload = build({ lines: [line, second] });
    expect(payload.invoiceLines.map((l) => l.itemCode)).toEqual(["EG-123456789-001", "EG-123456789-002"]);
  });

  it("builds a payload for a document with no lines rather than throwing", () => {
    const payload = build({ lines: [], totalNet: "0.000000", totalTax: "0.000000", totalAmount: "0.000000" });
    expect(payload.invoiceLines).toEqual([]);
    expect(payload.totalAmount).toBe("0.000000");
  });

  it("passes the item and unit codes through untouched, since the authority matches on them", () => {
    const payload = build();
    expect(payload.invoiceLines[0]?.itemCode).toBe("EG-123456789-001");
    expect(payload.invoiceLines[0]?.unitType).toBe("EA");
    expect(payload.invoiceLines[0]?.quantity).toBe("2.000000");
  });

  it("LIMITATION (D78): every line is filed as EGP, whatever currency the document was raised in", () => {
    // `currencySold` is hardcoded and the input carries no currency at all, so
    // a document raised in USD reaches the authority as if it were in pounds.
    // When the payload learns the document's currency, this is the expectation
    // to rewrite.
    const payload = build();
    expect(payload.invoiceLines[0]?.unitValue.currencySold).toBe("EGP");
    expect(Object.keys(payload.invoiceLines[0]?.unitValue ?? {})).toEqual(["currencySold", "amountEGP"]);
    expect(Object.keys(input)).not.toContain("currency");
  });

  it("is a plain JSON value, so it can be queued offline and transmitted unchanged", () => {
    const payload = build();
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
