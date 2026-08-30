import { describe, it, expect } from "vitest";
import {
  printPageSizeSchema,
  logoPositionSchema,
  logoSizeSchema,
  printIdentityConfigSchema,
  printHeaderConfigSchema,
  printFooterConfigSchema,
  printWatermarkConfigSchema,
  printPosReceiptConfigSchema,
  printTemplateOverrideSchema,
  printTemplateConfigSchema,
} from "./print-template-config.js";

describe("printPageSizeSchema", () => {
  it("accepts A4 and A5", () => {
    expect(printPageSizeSchema.safeParse("A4").success).toBe(true);
    expect(printPageSizeSchema.safeParse("A5").success).toBe(true);
  });

  it("rejects a page size outside the enum", () => {
    expect(printPageSizeSchema.safeParse("Letter").success).toBe(false);
  });
});

describe("printIdentityConfigSchema", () => {
  const identity = { logoPosition: "center" as const, logoSize: "medium" as const, primaryColor: "#0f766e" };

  it("accepts a minimal valid config with optionals omitted", () => {
    const result = printIdentityConfigSchema.safeParse(identity);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(identity);
  });

  it("rejects a config missing primaryColor", () => {
    const { primaryColor, ...rest } = identity;
    const result = printIdentityConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("primaryColor");
  });

  it("rejects an out-of-enum logoSize", () => {
    const result = printIdentityConfigSchema.safeParse({ ...identity, logoSize: "huge" });
    expect(result.success).toBe(false);
  });
});

describe("printHeaderConfigSchema", () => {
  const header = { showAddress: true, showPhone: true, showEmail: false, showTaxNumber: true, showCommercialRegister: false };

  it("accepts a minimal valid config and preserves every field verbatim", () => {
    const result = printHeaderConfigSchema.safeParse(header);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(header);
  });

  it("rejects a config missing showTaxNumber", () => {
    const { showTaxNumber, ...rest } = header;
    const result = printHeaderConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("showTaxNumber");
  });
});

describe("printFooterConfigSchema", () => {
  const footer = { showSignatures: true, signatureCount: 2, signatureLabels: ["المستلم", "المحاسب"] };

  it("accepts a minimal valid config with the optional text omitted", () => {
    const result = printFooterConfigSchema.safeParse(footer);
    expect(result.success).toBe(true);
  });

  it("rejects a negative signatureCount", () => {
    const result = printFooterConfigSchema.safeParse({ ...footer, signatureCount: -1 });
    expect(result.success).toBe(false);
  });
});

describe("printWatermarkConfigSchema", () => {
  it("accepts a minimal valid config with opacity in range", () => {
    const result = printWatermarkConfigSchema.safeParse({ opacity: 0.3 });
    expect(result.success).toBe(true);
  });

  it("rejects an opacity outside 0-1", () => {
    expect(printWatermarkConfigSchema.safeParse({ opacity: -0.1 }).success).toBe(false);
    expect(printWatermarkConfigSchema.safeParse({ opacity: 1.1 }).success).toBe(false);
  });
});

describe("printPosReceiptConfigSchema", () => {
  const receipt = { showTitle: true, showTaxNumber: true, showCustomerName: false };

  it("accepts a minimal valid config with thankYouText omitted", () => {
    const result = printPosReceiptConfigSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("rejects a config missing showCustomerName", () => {
    const { showCustomerName, ...rest } = receipt;
    const result = printPosReceiptConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("printTemplateOverrideSchema", () => {
  it("accepts an empty override — every section is optional", () => {
    const result = printTemplateOverrideSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a sparse partial override within one section", () => {
    const result = printTemplateOverrideSchema.safeParse({ header: { showAddress: false } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.header).toEqual({ showAddress: false });
  });

  it("rejects an out-of-enum logoSize inside a partial identity override", () => {
    const result = printTemplateOverrideSchema.safeParse({ identity: { logoSize: "huge" } });
    expect(result.success).toBe(false);
  });
});

describe("printTemplateConfigSchema", () => {
  const config = {
    version: 1,
    pageSize: "A4" as const,
    identity: { logoPosition: "center" as const, logoSize: "medium" as const, primaryColor: "#0f766e" },
    header: { showAddress: true, showPhone: true, showEmail: false, showTaxNumber: true, showCommercialRegister: false },
    content: { showBranchName: true, showWarehouseName: false, showPartyTaxNumber: true, showPaymentTerms: true, showNotes: false },
    columns: { showItemCode: true, showUnit: true, showDescription: false, showLineDiscount: true, showLineTaxPercent: true, showLineTaxAmount: true },
    totals: { showSubtotal: true, showTotalDiscount: true, showTaxBreakdown: true, showAmountInWords: true },
    footer: { showSignatures: true, signatureCount: 2, signatureLabels: ["المستلم", "المحاسب"] },
    watermark: { opacity: 0.2 },
    posReceipt: { showTitle: true, showTaxNumber: true, showCustomerName: false },
    perDocumentOverrides: {},
  };

  it("accepts a minimal valid config and preserves every field verbatim", () => {
    const result = printTemplateConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(config);
  });

  it("accepts a per-document sparse override keyed by doc type", () => {
    const result = printTemplateConfigSchema.safeParse({
      ...config,
      perDocumentOverrides: { SALES_INVOICE: { header: { showAddress: false } } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a config missing columns", () => {
    const { columns, ...rest } = config;
    const result = printTemplateConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("columns");
  });

  it("rejects an out-of-enum pageSize", () => {
    const result = printTemplateConfigSchema.safeParse({ ...config, pageSize: "Letter" });
    expect(result.success).toBe(false);
  });
});
