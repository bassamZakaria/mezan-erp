// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { TaxRateDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import {
  NO_TAX_RATE,
  TaxRateField,
  appliedTaxPercent,
  lineTaxPayload,
  selectableTaxRates,
  soleActiveTaxRateId,
} from "./tax-rate-field";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const taxRate = (id: string, name: string, rate: number, overrides: Partial<TaxRateDTO> = {}): TaxRateDTO => ({
  id, code: id, name, rate, calculationType: "exclusive", isDefault: false,
  outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active", ...overrides,
});

const VAT = taxRate("VAT14", "ضريبة القيمة المضافة", 14, { isDefault: true });
const EXEMPT = taxRate("VAT-EXEMPT", "معفى", 0, { etaSubType: "V003" });
const EXPORT = taxRate("VAT-EXPORT", "تصدير", 0, { etaSubType: "V001" });
const RETIRED = taxRate("OLD5", "ضريبة قديمة", 5, { status: "inactive" });
const ALL = [VAT, EXEMPT, EXPORT, RETIRED];

describe("soleActiveTaxRateId", () => {
  it("names the rate when exactly one active rate has the percent", () => {
    expect(soleActiveTaxRateId(ALL, 14)).toBe("VAT14");
  });

  it("names none when معفى and تصدير share 0% — the user has to say which", () => {
    expect(soleActiveTaxRateId(ALL, 0)).toBe(NO_TAX_RATE);
  });

  it("never names an inactive rate", () => {
    expect(soleActiveTaxRateId(ALL, 5)).toBe(NO_TAX_RATE);
  });
});

describe("appliedTaxPercent", () => {
  it("is the picked rate's own percent, whatever the item's is", () => {
    expect(appliedTaxPercent(ALL, "VAT-EXEMPT", 14)).toBe(0);
  });

  it("is the fallback percent when no rate is picked", () => {
    expect(appliedTaxPercent(ALL, NO_TAX_RATE, 14)).toBe(14);
  });
});

describe("lineTaxPayload", () => {
  it("sends the id alone for a picked rate, so the server reads the percent off the row", () => {
    expect(lineTaxPayload("VAT-EXPORT", 14)).toEqual({ taxRateId: "VAT-EXPORT" });
  });

  it("sends the percent alone when no rate is picked", () => {
    expect(lineTaxPayload(NO_TAX_RATE, 14)).toEqual({ taxRatePercent: 14 });
  });
});

describe("selectableTaxRates", () => {
  it("offers active rates only", () => {
    expect(selectableTaxRates(ALL, NO_TAX_RATE).map((r) => r.id)).toEqual(["VAT14", "VAT-EXEMPT", "VAT-EXPORT"]);
  });

  it("keeps an inactive rate that is already the selection, so it does not vanish from its own field", () => {
    expect(selectableTaxRates(ALL, "OLD5").map((r) => r.id)).toContain("OLD5");
  });
});

describe("TaxRateField", () => {
  function renderField(value: string, onChange = vi.fn()) {
    renderWithProviders(
      <TaxRateField label="الضريبة" value={value} onChange={onChange} taxRates={ALL} fallbackPercent={14} />,
      { transport: stubTransport({}), initialSession: testAdminSession },
    );
    return onChange;
  }

  it("lists each active rate by name and percent, plus the option that names none", () => {
    renderField(NO_TAX_RATE);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "بدون ضريبة مسماة (14٪)",
      "ضريبة القيمة المضافة · 14٪",
      "معفى · 0٪",
      "تصدير · 0٪",
    ]);
  });

  it("reports the picked rate's real id", () => {
    const onChange = renderField(NO_TAX_RATE);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "تصدير · 0٪" }));
    expect(onChange).toHaveBeenCalledWith("VAT-EXPORT");
  });
});
