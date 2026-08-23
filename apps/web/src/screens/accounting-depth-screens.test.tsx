// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type {
  CostCenterPnLReportDTO,
  EtaConfigDTO,
  EtaReadinessDTO,
  EtaSubmissionDTO,
  ExchangeRateDTO,
  FxRevaluationPreviewDTO,
  ReconciliationReportDTO,
} from "@mezan/contracts";
import { CostCenterPnLScreen } from "./CostCenterPnLScreen";
import { ExchangeRatesScreen } from "./ExchangeRatesScreen";
import { FxRevaluationScreen } from "./FxRevaluationScreen";
import { ReconciliationScreen } from "./ReconciliationScreen";
import { EtaScreen } from "./EtaScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

describe("CostCenterPnLScreen", () => {
  it("renders P&L grouped by cost center from the real /cost-center-pl route", async () => {
    const report: CostCenterPnLReportDTO = {
      rows: [
        { costCenterId: "cc-admin", code: "CC-ADM", name: "الإدارة العامة", revenue: "2000.000000", expense: "800.000000", profit: "1200.000000" },
        { costCenterId: "cc-sales", code: "CC-SLS", name: "المبيعات", revenue: "5000.000000", expense: "300.000000", profit: "4700.000000" },
      ],
      totals: { revenue: "7000.000000", expense: "1100.000000", profit: "5900.000000" },
    };
    const transport = stubTransport({
      "GET /cost-center-pl": () => ({ body: report }),
    });
    renderWithProviders(<CostCenterPnLScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "أرباح مراكز التكلفة" })).toBeInTheDocument();
    expect(await screen.findByText("الإدارة العامة")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
  });
});

describe("ExchangeRatesScreen", () => {
  it("lists real rates and approves a pending one through POST /exchange-rates/:id/approve", async () => {
    let rates: ExchangeRateDTO[] = [
      { id: "r-usd", currency: "USD", rate: "55.000000", effectiveDate: "2026-08-25", rateType: "standard", source: "manual", status: "approved" },
      { id: "r-sar", currency: "SAR", rate: "14.700000", effectiveDate: "2026-08-20", rateType: "standard", source: "manual", status: "pending" },
    ];
    const transport = stubTransport({
      "GET /exchange-rates": () => ({ body: rates }),
      "POST /exchange-rates/r-sar/approve": () => {
        rates = rates.map((r) => (r.id === "r-sar" ? { ...r, status: "approved" } : r));
        return { body: rates.find((r) => r.id === "r-sar") };
      },
    });
    renderWithProviders(<ExchangeRatesScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "أسعار الصرف" })).toBeInTheDocument();
    expect(await screen.findByText("USD / EGP")).toBeInTheDocument();
    const sarRow = screen.getByText("SAR / EGP").closest("tr") as HTMLElement;
    fireEvent.click(within(sarRow).getByRole("button", { name: "اعتماد" }));
    expect(await within(sarRow).findByText("معتمد")).toBeInTheDocument();
  });
});

describe("FxRevaluationScreen", () => {
  it("previews open FX balances revalued at the closing rate via POST /revaluation/preview", async () => {
    const preview: FxRevaluationPreviewDTO = {
      date: "2026-08-31",
      autoReverse: true,
      reversalDate: "2026-09-01",
      details: [
        { accountId: "1100", currency: "USD", label: "ذمم مدينة", foreignAmount: "100.000000", bookedBase: "5000.000000", closingRate: "55.000000", revaluedBase: "5500.000000", delta: "500.000000", gainLoss: "500.000000" },
      ],
      totalGain: "500.000000",
      totalLoss: "0.000000",
      hasImpact: true,
    };
    const transport = stubTransport({
      "POST /revaluation/preview": () => ({ body: preview }),
    });
    renderWithProviders(<FxRevaluationScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "معاينة" }));
    expect(await screen.findByText("ذمم مدينة")).toBeInTheDocument();
  });
});

describe("ReconciliationScreen", () => {
  it("shows the reconciliation summary and the unlinked-entries tab from the real /reconciliation route", async () => {
    const report: ReconciliationReportDTO = {
      rows: [
        { key: "inventory", label: "تقييم المخزون مقابل دفتر الأستاذ", controlAccountId: "1200", subLedgerBalance: "602425.900000", glBalance: "602425.900000", difference: "0.000000", matched: true },
      ],
      allMatched: false,
      unlinked: [
        { entryId: "je-manual", entryNo: "JE-000005", date: "2026-08-18", accountId: "1200", memo: "تسوية يدوية على حساب المخزون", debit: "150.000000", credit: "0.000000" },
      ],
    };
    const transport = stubTransport({
      "GET /reconciliation": () => ({ body: report }),
    });
    renderWithProviders(<ReconciliationScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeInTheDocument();
    expect(await screen.findByText("تقييم المخزون مقابل دفتر الأستاذ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /القيود غير المرتبطة/ }));
    expect(await screen.findByText("تسوية يدوية على حساب المخزون")).toBeInTheDocument();
  });
});

describe("EtaScreen", () => {
  it("renders the submission queue and keeps a document queued when offline transmit is stubbed (202)", async () => {
    const config: EtaConfigDTO = {
      environment: "preproduction",
      taxRegistrationNumber: "300123456700003",
      activityCode: "1234",
      address: { governorate: "القاهرة", city: "القاهرة الجديدة", street: "شارع التسعين", buildingNumber: "10", postalCode: null },
      buyerDataThreshold: 25000,
      documentVersion: "1.0",
      autoSubmitOnConfirm: false,
      signingMethod: "eseal",
      clientId: "client-1",
      hasClientSecret: true,
    };
    const readiness: EtaReadinessDTO = { percent: 80, items: [{ key: "config", labelAr: "الإعدادات", complete: true }] };
    let submissions: EtaSubmissionDTO[] = [
      { id: "s1", internalId: "INV-000014", documentType: "invoice", status: "ready", etaUuid: null, errors: [], exclusionReason: null, createdAt: "2026-08-22T10:00:00.000Z", updatedAt: "2026-08-22T10:00:00.000Z", submittedAt: null },
    ];
    const transport = stubTransport({
      "GET /eta/config": () => ({ body: { config, readiness } }),
      "GET /eta/submissions": () => ({ body: submissions }),
      "POST /eta/submissions/s1/submit": () => ({ status: 202, body: { error: "ETA_OFFLINE", message: "offline" } }),
    });
    renderWithProviders(<EtaScreen />, { transport, initialSession: testAdminSession });

    expect(screen.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeInTheDocument();
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إرسال" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/قائمة الإرسال/);
  });
});
