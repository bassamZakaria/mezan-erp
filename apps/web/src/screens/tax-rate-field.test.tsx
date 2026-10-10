// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { TaxRateDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import {
  DERIVED_TAX,
  TaxChoiceKind,
  TaxRateField,
  appliedTaxPercent,
  chosenTaxRateId,
  lineTaxPayload,
  selectableTaxRates,
  type TaxChoice,
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
const picked = (taxRateId: string): TaxChoice => ({ kind: TaxChoiceKind.Rate, taxRateId });

describe("chosenTaxRateId — an untouched line derives its rate the way the server does", () => {
  it("names the one active rate at a percent above zero", () => {
    expect(chosenTaxRateId(DERIVED_TAX, ALL, 14)).toBe("VAT14");
  });

  it("names NOTHING at 0% — not even when the tenant holds exactly one 0% rate", () => {
    expect(chosenTaxRateId(DERIVED_TAX, ALL, 0)).toBeNull();
    expect(chosenTaxRateId(DERIVED_TAX, [VAT, EXEMPT], 0)).toBeNull();
  });

  it("never names an inactive rate, and names nothing before the rates have loaded", () => {
    expect(chosenTaxRateId(DERIVED_TAX, ALL, 5)).toBeNull();
    expect(chosenTaxRateId(DERIVED_TAX, [], 14)).toBeNull();
  });

  it("is the user's own pick once they made one", () => {
    expect(chosenTaxRateId(picked("VAT-EXPORT"), ALL, 14)).toBe("VAT-EXPORT");
  });
});

describe("appliedTaxPercent", () => {
  it("is the chosen rate's own percent, whatever the item's is", () => {
    expect(appliedTaxPercent(picked("VAT-EXEMPT"), ALL, 14)).toBe(0);
    expect(appliedTaxPercent(DERIVED_TAX, ALL, 14)).toBe(14);
  });

  it("is the fallback percent when there is no rate to derive", () => {
    expect(appliedTaxPercent(DERIVED_TAX, ALL, 0)).toBe(0);
    expect(appliedTaxPercent(DERIVED_TAX, [], 14)).toBe(14);
  });
});

describe("lineTaxPayload — what the request says is what the picker shows", () => {
  it("sends the id alone for a picked rate, so the server reads the percent off the row", () => {
    expect(lineTaxPayload(picked("VAT-EXPORT"), ALL, 14)).toEqual({ taxRateId: "VAT-EXPORT" });
  });

  it("sends the derived rate's id for an untouched line — the rate the picker displays", () => {
    expect(lineTaxPayload(DERIVED_TAX, ALL, 14)).toEqual({ taxRateId: "VAT14" });
  });

  it("sends the percent alone for an untouched line with nothing to derive, leaving the decision to the server", () => {
    expect(lineTaxPayload(DERIVED_TAX, ALL, 0)).toEqual({ taxRatePercent: 0 });
    expect(lineTaxPayload(DERIVED_TAX, [], 14)).toEqual({ taxRatePercent: 14 });
  });
});

describe("selectableTaxRates", () => {
  it("offers active rates only", () => {
    expect(selectableTaxRates(ALL, null).map((r) => r.id)).toEqual(["VAT14", "VAT-EXEMPT", "VAT-EXPORT"]);
  });

  it("keeps an inactive rate that is already the selection, so it does not vanish from its own field", () => {
    expect(selectableTaxRates(ALL, "OLD5").map((r) => r.id)).toContain("OLD5");
  });
});

describe("TaxRateField", () => {
  function renderField(choice: TaxChoice, fallbackPercent = 14, onChange = vi.fn()) {
    renderWithProviders(
      <TaxRateField label="الضريبة" choice={choice} onChange={onChange} taxRates={ALL} fallbackPercent={fallbackPercent} />,
      { transport: stubTransport({}), initialSession: testAdminSession },
    );
    return onChange;
  }

  it("lists each active rate by name and percent — and NO 'unnamed' option where a rate is derivable, since that would be tax charged under no rate", () => {
    renderField(DERIVED_TAX);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "ضريبة القيمة المضافة · 14٪",
      "معفى · 0٪",
      "تصدير · 0٪",
    ]);
  });

  it("offers the 'unnamed' option at 0%, where it is what an untouched line already is", () => {
    renderField(DERIVED_TAX, 0);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "بدون ضريبة مسماة (0٪)",
      "ضريبة القيمة المضافة · 14٪",
      "معفى · 0٪",
      "تصدير · 0٪",
    ]);
  });

  it("shows the derived rate on an untouched 14% line, and no rate on an untouched 0% line", () => {
    renderField(DERIVED_TAX);
    expect(screen.getByRole("combobox", { name: "الضريبة" })).toHaveTextContent("ضريبة القيمة المضافة · 14٪");
  });

  it("shows «بدون ضريبة مسماة» on an untouched 0% line — the user has to say exempt or export", () => {
    renderField(DERIVED_TAX, 0);
    expect(screen.getByRole("combobox", { name: "الضريبة" })).toHaveTextContent("بدون ضريبة مسماة (0٪)");
  });

  it("reports the picked rate's real id", () => {
    const onChange = renderField(DERIVED_TAX);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "تصدير · 0٪" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: TaxChoiceKind.Rate, taxRateId: "VAT-EXPORT" });
  });

  it("going back to the unnamed option on a 0% line returns it to the untouched state — never a 'no rate' the server would store beside a charged percent", () => {
    const onChange = renderField(picked("VAT-EXPORT"), 0);
    fireEvent.click(screen.getByRole("combobox", { name: "الضريبة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "بدون ضريبة مسماة (0٪)" }));
    expect(onChange).toHaveBeenLastCalledWith(DERIVED_TAX);
    expect(lineTaxPayload(DERIVED_TAX, ALL, 0)).toEqual({ taxRatePercent: 0 });
  });
});
