// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppI18nProvider } from "../i18n";
import { useDomainLabels } from "./domain-labels";

const voucherType = {
  labelAr: "سند قبض",
  labelEn: "Receipt voucher",
  subtitleAr: "تحصيل نقدي من عميل",
  subtitleEn: "Cash collected from a customer",
};

function Harness() {
  const { label, subtitle } = useDomainLabels();
  return (
    <>
      <output data-testid="label">{label(voucherType)}</output>
      <output data-testid="subtitle">{subtitle(voucherType)}</output>
    </>
  );
}

function renderIn(locale: "ar" | "en") {
  return render(
    <AppI18nProvider initialLocale={locale}>
      <Harness />
    </AppI18nProvider>,
  );
}

describe("useDomainLabels", () => {
  it("reads the Arabic label and subtitle in Arabic", () => {
    renderIn("ar");
    expect(screen.getByTestId("label").textContent).toBe("سند قبض");
    expect(screen.getByTestId("subtitle").textContent).toBe("تحصيل نقدي من عميل");
  });

  it("reads the English label and subtitle in English", () => {
    renderIn("en");
    expect(screen.getByTestId("label").textContent).toBe("Receipt voucher");
    expect(screen.getByTestId("subtitle").textContent).toBe("Cash collected from a customer");
  });

  it("lets no Arabic reach the English UI, which is the leak it exists to close", () => {
    renderIn("en");
    expect(/[؀-ۿ]/.test(screen.getByTestId("label").textContent ?? "")).toBe(false);
    expect(/[؀-ۿ]/.test(screen.getByTestId("subtitle").textContent ?? "")).toBe(false);
  });
});
