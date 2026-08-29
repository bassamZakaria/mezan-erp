import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, resolvePrintTemplateConfig, type PrintTemplateConfig } from "./types";

describe("DEFAULT_PRINT_TEMPLATE_CONFIG", () => {
  it("covers all 9 tabs (docs/archive/catalog/09 §قوالب الطباعة)", () => {
    const config = DEFAULT_PRINT_TEMPLATE_CONFIG;
    expect(Object.keys(config).sort()).toEqual(
      [
        "version",
        "pageSize",
        "identity",
        "header",
        "content",
        "columns",
        "totals",
        "footer",
        "watermark",
        "posReceipt",
        "perDocumentOverrides",
      ].sort(),
    );
  });

  it("defaults to A4 with no watermark and 2 signature slots", () => {
    expect(DEFAULT_PRINT_TEMPLATE_CONFIG.pageSize).toBe("A4");
    expect(DEFAULT_PRINT_TEMPLATE_CONFIG.watermark.text).toBeUndefined();
    expect(DEFAULT_PRINT_TEMPLATE_CONFIG.footer.signatureCount).toBe(2);
    expect(DEFAULT_PRINT_TEMPLATE_CONFIG.footer.signatureLabels).toEqual(["أعده", "اعتمده"]);
  });
});

describe("resolvePrintTemplateConfig", () => {
  it("returns the base config unchanged when there is no override for the document type", () => {
    const resolved = resolvePrintTemplateConfig(DEFAULT_PRINT_TEMPLATE_CONFIG, "SALES_INVOICE");
    expect(resolved).toEqual(DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  it("returns the base config unchanged when no document type is given", () => {
    const withOverride: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: { SALES_INVOICE: { identity: { primaryColor: "#ff0000" } } },
    };
    expect(resolvePrintTemplateConfig(withOverride)).toEqual(withOverride);
  });

  it("merges only the overridden fields within a tab, leaving siblings from the base config", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: {
        POS_SALE: {
          identity: { primaryColor: "#c0392b" },
          totals: { showAmountInWords: false },
        },
      },
    };

    const resolved = resolvePrintTemplateConfig(config, "POS_SALE");

    expect(resolved.identity.primaryColor).toBe("#c0392b");
    expect(resolved.identity.logoPosition).toBe(DEFAULT_PRINT_TEMPLATE_CONFIG.identity.logoPosition);
    expect(resolved.totals.showAmountInWords).toBe(false);
    expect(resolved.totals.showSubtotal).toBe(DEFAULT_PRINT_TEMPLATE_CONFIG.totals.showSubtotal);
    // Untouched tabs are the same object — no unnecessary cloning.
    expect(resolved.columns).toBe(config.columns);
  });

  it("does not apply an override scoped to a different document type", () => {
    const config: PrintTemplateConfig = {
      ...DEFAULT_PRINT_TEMPLATE_CONFIG,
      perDocumentOverrides: {
        POS_SALE: { identity: { primaryColor: "#c0392b" } },
      },
    };

    const resolved = resolvePrintTemplateConfig(config, "SALES_INVOICE");
    expect(resolved.identity.primaryColor).toBe(DEFAULT_PRINT_TEMPLATE_CONFIG.identity.primaryColor);
  });
});
