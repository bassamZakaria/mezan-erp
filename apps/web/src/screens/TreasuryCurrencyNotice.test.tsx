// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { TreasuryCurrencyNotice, type TreasuryCurrencyRate } from "./TreasuryCurrencyNotice";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const rates: TreasuryCurrencyRate[] = [
  { currency: "USD", rate: "48.90", effectiveDate: "2026-08-01", status: "approved" },
  { currency: "USD", rate: "49.35", effectiveDate: "2026-08-15", status: "approved" },
  { currency: "USD", rate: "60.00", effectiveDate: "2026-08-18", status: "pending" },
];
const usdBank = { id: "ta-usd", name: "البنك الأهلي — دولار", currency: "USD" };
const egpBank = { id: "ta-egp", name: "البنك الأهلي", currency: "EGP" };

function show(props: Partial<Parameters<typeof TreasuryCurrencyNotice>[0]>) {
  const onChange = vi.fn();
  renderWithProviders(
    <TreasuryCurrencyNotice baseCurrency="EGP" accounts={[usdBank]} voucherCurrency="USD" onVoucherCurrencyChange={onChange} amount={200} date="2026-08-20" rates={rates} {...props} />,
    { transport: stubTransport({}), initialSession: testAdminSession },
  );
  return onChange;
}

describe("the currency panel of a voucher on a foreign-currency treasury account", () => {
  it("is absent when every chosen account is in the base currency", () => {
    show({ accounts: [egpBank], voucherCurrency: "EGP" });
    expect(screen.queryByRole("group", { name: "عملة حساب الخزينة" })).not.toBeInTheDocument();
  });

  it("shows the account's currency, the approved rate of the voucher's date — never a pending one — and both amounts", () => {
    show({});
    const panel = screen.getByRole("group", { name: "عملة حساب الخزينة" });
    expect(panel).toHaveTextContent("البنك الأهلي — دولار");
    expect(panel).toHaveTextContent("سعر الصرف المعتمد: 49.35");
    expect(panel).toHaveTextContent("المبلغ بعملة الحساب: 200.00 USD");
    expect(panel).toHaveTextContent("المعادل بالعملة الأساسية: 9870.00 EGP");
  });

  it("a voucher stated in the base currency shows the dollars it moves at the day's rate", () => {
    show({ voucherCurrency: "EGP", amount: 4935 });
    const panel = screen.getByRole("group", { name: "عملة حساب الخزينة" });
    expect(panel).toHaveTextContent("المبلغ بعملة الحساب: 100.00 USD");
    expect(panel).toHaveTextContent("المعادل بالعملة الأساسية: 4935.00 EGP");
  });

  it("rounds what it shows to the piastre instead of cutting it off", () => {
    show({ voucherCurrency: "EGP", amount: 100 });
    expect(screen.getByRole("group", { name: "عملة حساب الخزينة" })).toHaveTextContent("المبلغ بعملة الحساب: 2.03 USD");
  });

  it("takes an amount a browser number field can produce without breaking", () => {
    show({ amount: 0.1 + 0.2 });
    expect(screen.getByRole("group", { name: "عملة حساب الخزينة" })).toHaveTextContent("المبلغ بعملة الحساب: 0.30 USD");
  });

  it("says the voucher cannot post when the date has no approved rate", () => {
    show({ date: "2026-07-01" });
    expect(screen.getByRole("alert")).toHaveTextContent("لا يوجد سعر صرف معتمد للعملة USD بتاريخ 2026-07-01");
  });

  it("lets the voucher be stated in the account's currency or the base currency", () => {
    const onChange = show({});
    fireEvent.click(screen.getByRole("radio", { name: "EGP" }));
    expect(onChange).toHaveBeenCalledWith("EGP");
  });
});
