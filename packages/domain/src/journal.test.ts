import { describe, it, expect } from "vitest";
import { journalSourceModule } from "./journal.js";

describe("journalSourceModule", () => {
  it("names the module behind each posting document type", () => {
    expect(journalSourceModule("SALES_INVOICE", "system")).toBe("sales");
    expect(journalSourceModule("PURCHASE_INVOICE", "system")).toBe("purchases");
    expect(journalSourceModule("STOCK_TRANSFER", "system")).toBe("inventory");
    expect(journalSourceModule("DEPRECIATION_RUN", "system")).toBe("assets");
  });

  it("files every contracting document under 'contracting' — R6.3 leaves no posted entry anonymous", () => {
    for (const docType of [
      "SUBCONTRACT",
      "SUBCONTRACT_CERTIFICATE",
      "PROGRESS_CERTIFICATE",
      "RETENTION_RELEASE",
      "LETTER_OF_GUARANTEE",
      "REVENUE_RECOGNITION_RUN",
      "SITE_ISSUE",
      "SITE_RECEIPT",
      "MATERIAL_CONSUMPTION",
      "EQUIPMENT_LOG",
    ]) {
      expect(journalSourceModule(docType, "system")).toBe("contracting");
    }
  });

  it("an entry a person typed is 'manual'; a machine entry with no document type is 'unknown', never 'manual'", () => {
    expect(journalSourceModule(null, "manual")).toBe("manual");
    expect(journalSourceModule("JOURNAL_ENTRY", "manual")).toBe("manual");
    expect(journalSourceModule(null, "system")).toBe("unknown");
    expect(journalSourceModule("SOMETHING_NEW", "system")).toBe("unknown");
  });
});
