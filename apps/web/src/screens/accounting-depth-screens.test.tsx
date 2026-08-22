// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CostCenterPnLScreen } from "./CostCenterPnLScreen";
import { ExchangeRatesScreen } from "./ExchangeRatesScreen";
import { FxRevaluationScreen } from "./FxRevaluationScreen";
import { ReconciliationScreen } from "./ReconciliationScreen";
import { EtaScreen } from "./EtaScreen";

describe("CostCenterPnLScreen", () => {
  it("renders P&L grouped by cost center from the real domain computation", async () => {
    render(<CostCenterPnLScreen />);
    expect(screen.getByRole("heading", { name: "أرباح مراكز التكلفة" })).toBeInTheDocument();
    // cc-admin: revenue 2000 − expense 800 = profit 1,200.00
    expect(await screen.findByText("الإدارة العامة")).toBeInTheDocument();
    expect(await screen.findByText("المبيعات")).toBeInTheDocument();
  });
});

describe("ExchangeRatesScreen", () => {
  it("lists seeded rates and approves a pending one", () => {
    render(<ExchangeRatesScreen />);
    expect(screen.getByRole("heading", { name: "أسعار الصرف" })).toBeInTheDocument();
    expect(screen.getByText("USD / EGP")).toBeInTheDocument();
    // SAR is seeded pending → has an approve button.
    const sarRow = screen.getByText("SAR / EGP").closest("tr") as HTMLElement;
    fireEvent.click(within(sarRow).getByRole("button", { name: "اعتماد" }));
    expect(within(sarRow).getByText("معتمد")).toBeInTheDocument();
  });
});

describe("FxRevaluationScreen", () => {
  it("previews open FX balances revalued at the closing rate", async () => {
    render(<FxRevaluationScreen />);
    expect(screen.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "معاينة" }));
    // The USD AR balance (ذمم مدينة) shows up in the preview table.
    expect(await screen.findByText("ذمم مدينة")).toBeInTheDocument();
  });
});

describe("ReconciliationScreen", () => {
  it("shows the reconciliation summary and the unlinked-entries tab", async () => {
    render(<ReconciliationScreen />);
    expect(screen.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeInTheDocument();
    expect(await screen.findByText("تقييم المخزون مقابل دفتر الأستاذ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /القيود غير المرتبطة/ }));
    // The seeded manual line hitting control account 1200 is flagged.
    expect(await screen.findByText("تسوية يدوية على حساب المخزون")).toBeInTheDocument();
  });
});

describe("EtaScreen", () => {
  it("renders the submission queue and keeps a document queued when offline transmit is stubbed", async () => {
    render(<EtaScreen />);
    expect(screen.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeInTheDocument();
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إرسال" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/قائمة الإرسال/);
  });
});
