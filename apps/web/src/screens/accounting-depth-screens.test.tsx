// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type {
  CostCenterPnLReportDTO,
  EtaConfigDTO,
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

const PNL: CostCenterPnLReportDTO = {
  rows: [
    { costCenterId: "cc-admin", code: "CC-ADM", name: "الإدارة العامة", revenue: "2000.000000", expense: "800.000000", profit: "1200.000000" },
    { costCenterId: "cc-sales", code: "CC-SLS", name: "المبيعات", revenue: "5000.000000", expense: "1500.000000", profit: "3500.000000" },
  ],
  totals: { revenue: "7000.000000", expense: "2300.000000", profit: "4700.000000" },
};

describe("CostCenterPnLScreen", () => {
  it("renders the P&L the server grouped by cost center", async () => {
    renderWithProviders(<CostCenterPnLScreen />, {
      transport: stubTransport({ "GET /cost-center-pl": () => ({ body: PNL }) }),
      initialSession: testAdminSession,
    });
    expect(screen.getByRole("heading", { name: "أرباح مراكز التكلفة" })).toBeInTheDocument();
    expect(await screen.findByText("الإدارة العامة")).toBeInTheDocument();
    expect(await screen.findByText("المبيعات")).toBeInTheDocument();
  });
});

describe("ExchangeRatesScreen", () => {
  it("lists the rates and approves a pending one through the API", async () => {
    let rates: ExchangeRateDTO[] = [
      { id: "r-usd", currency: "USD", rate: "48.500000", effectiveDate: "2026-08-31", rateType: "standard", source: "manual", status: "approved" },
      { id: "r-sar", currency: "SAR", rate: "12.900000", effectiveDate: "2026-08-31", rateType: "standard", source: "manual", status: "pending" },
    ];
    renderWithProviders(<ExchangeRatesScreen />, {
      transport: stubTransport({
        "GET /exchange-rates": () => ({ body: rates }),
        "POST /exchange-rates/r-sar/approve": () => {
          rates = rates.map((r) => (r.id === "r-sar" ? { ...r, status: "approved" } : r));
          return { body: rates[1] };
        },
      }),
      initialSession: testAdminSession,
    });
    expect(screen.getByRole("heading", { name: "أسعار الصرف" })).toBeInTheDocument();
    expect(await screen.findByText("USD / EGP")).toBeInTheDocument();

    const sarRow = screen.getByText("SAR / EGP").closest("tr") as HTMLElement;
    fireEvent.click(within(sarRow).getByRole("button", { name: "اعتماد" }));
    await waitFor(() => expect(screen.getAllByText("معتمد").length).toBe(2));
  });
});

const PREVIEW: FxRevaluationPreviewDTO = {
  date: "2026-08-31",
  autoReverse: true,
  reversalDate: "2026-09-01",
  details: [
    {
      accountId: "1100",
      currency: "USD",
      label: "ذمم مدينة",
      foreignAmount: "1000.000000",
      bookedBase: "47000.000000",
      closingRate: "48.500000",
      revaluedBase: "48500.000000",
      delta: "1500.000000",
      gainLoss: "1500.000000",
    },
  ],
  totalGain: "1500.000000",
  totalLoss: "0.000000",
  hasImpact: true,
};

describe("FxRevaluationScreen", () => {
  it("previews open FX balances revalued server-side at the closing rate", async () => {
    renderWithProviders(<FxRevaluationScreen />, {
      transport: stubTransport({ "POST /revaluation/preview": () => ({ body: PREVIEW }) }),
      initialSession: testAdminSession,
    });
    expect(screen.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "معاينة" }));
    expect(await screen.findByText("ذمم مدينة")).toBeInTheDocument();
  });
});

const RECONCILIATION: ReconciliationReportDTO = {
  rows: [
    {
      key: "inventory",
      label: "تقييم المخزون مقابل دفتر الأستاذ",
      controlAccountId: "1200",
      subLedgerBalance: "602425.900000",
      glBalance: "602425.900000",
      difference: "0.000000",
      matched: true,
    },
  ],
  allMatched: true,
  unlinked: [
    {
      entryId: "je-9",
      entryNo: "JE-000009",
      date: "2026-08-20",
      accountId: "1200",
      memo: "تسوية يدوية على حساب المخزون",
      debit: "500.000000",
      credit: "0.000000",
    },
  ],
};

describe("ReconciliationScreen", () => {
  it("shows the server's reconciliation summary and the unlinked-entries tab", async () => {
    renderWithProviders(<ReconciliationScreen />, {
      transport: stubTransport({ "GET /reconciliation": () => ({ body: RECONCILIATION }) }),
      initialSession: testAdminSession,
    });
    expect(screen.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeInTheDocument();
    expect(await screen.findByText("تقييم المخزون مقابل دفتر الأستاذ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /القيود غير المرتبطة/ }));
    expect(await screen.findByText("تسوية يدوية على حساب المخزون")).toBeInTheDocument();
  });
});

const ETA_CONFIG: EtaConfigDTO = {
  environment: "preproduction",
  taxRegistrationNumber: "300123456700003",
  activityCode: "4610",
  address: { governorate: "القاهرة", city: "القاهرة الجديدة", street: "التسعين", buildingNumber: "12", postalCode: null },
  buyerDataThreshold: 25000,
  documentVersion: "1.0",
  autoSubmitOnConfirm: false,
  signingMethod: "eseal",
  clientId: "client-1",
  hasClientSecret: true,
};

const ETA_READINESS = {
  percent: 100,
  items: [{ key: "taxRegistrationNumber", labelAr: "رقم التسجيل الضريبي", complete: true }],
};

const ETA_SUBMISSION: EtaSubmissionDTO = {
  id: "s1",
  internalId: "INV-000014",
  documentType: "invoice",
  status: "ready",
  etaUuid: null,
  errors: [],
  exclusionReason: null,
  createdAt: "2026-08-22T10:00:00.000Z",
  updatedAt: "2026-08-22T10:00:00.000Z",
  submittedAt: null,
};

describe("EtaScreen", () => {
  it("renders the submission queue and surfaces the server's offline notice", async () => {
    renderWithProviders(<EtaScreen />, {
      transport: stubTransport({
        "GET /eta/config": () => ({ body: { config: ETA_CONFIG, readiness: ETA_READINESS } }),
        "GET /eta/submissions": () => ({ body: [ETA_SUBMISSION] }),
        "POST /eta/submissions/s1/submit": () => ({
          status: 503,
          body: { error: "ETA_OFFLINE", message: "الإرسال الفعلي متاح فقط عند الاتصال — بقي المستند في قائمة الإرسال." },
        }),
      }),
      initialSession: testAdminSession,
    });
    expect(screen.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeInTheDocument();
    const row = (await screen.findByText("INV-000014")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إرسال" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/قائمة الإرسال/);
  });
});
