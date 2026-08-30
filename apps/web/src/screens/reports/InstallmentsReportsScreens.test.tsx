// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { InstallmentsOverdueReportScreen, InstallmentsOverviewReportScreen } from "./InstallmentsReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { todayIso } from "../../lib/dates";

const TODAY = todayIso();

describe("InstallmentsReportsScreens", () => {
  it("InstallmentsOverviewReportScreen hits /installments/overview with no date params (its defaultParams is {}), renders formatted money", async () => {
    let requestedPath = "";
    const row = { planId: "plan-1", planNo: "IP-000001", customerId: "cust-1", customerNameAr: "عميل تجريبي", totalAmount: 3000, percentPaid: 50, remaining: 1500, installmentsCount: 6, startDate: "2026-01-01", statusLabel: "نشطة" };
    const transport = stubTransport({
      "GET /reports/installments/overview": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { totalAmount: 3000, remaining: 1500 } }], grandTotals: { totalAmount: 3000, remaining: 1500 }, reconciliation: null } };
      },
    });
    renderWithProviders(<InstallmentsOverviewReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("عميل تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/installments/overview");
    expect(screen.queryByText("1500.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "1,500.00").length).toBeGreaterThan(0);
  });

  it("InstallmentsOverviewReportScreen renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/installments/overview": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<InstallmentsOverviewReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("InstallmentsOverdueReportScreen hits its OWN endpoint (/installments/overdue) with the default asOfDate", async () => {
    let requestedPath = "";
    const row = { lineId: "line-1", rank: 1, customerId: "cust-2", customerNameAr: "عميل متأخر", planNo: "IP-000002", amount: 500, remaining: 500, dueDate: "2026-07-01", daysLate: 45 };
    const transport = stubTransport({
      "GET /reports/installments/overdue": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { remaining: 500 } }], grandTotals: { remaining: 500 }, reconciliation: null } };
      },
    });
    renderWithProviders(<InstallmentsOverdueReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("عميل متأخر").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/installments/overdue");
    expect(requestedPath).toContain(`asOfDate=${TODAY}`);
  });
});
