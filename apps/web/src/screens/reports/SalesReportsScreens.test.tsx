// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  SalesByCustomerReportScreen,
  SalesByItemReportScreen,
  SalesBySalespersonReportScreen,
  TopProductsReportScreen,
} from "./SalesReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { monthStartIso, todayIso } from "../../lib/dates";

const TODAY = todayIso();
const MONTH_START = monthStartIso();

// SalesByPeriodReportScreen is already covered end-to-end by ReportScreen.test.tsx — not duplicated here.

describe("SalesReportsScreens (each wired to its own real /reports/sales/* endpoint)", () => {
  it("SalesByItemReportScreen hits /sales/by-item with the default month-to-date range, renders formatted money", async () => {
    let requestedPath = "";
    const row = { itemId: "item-1", itemNameAr: "صنف تجريبي", qty: 50, revenue: 4200, contributionPercent: 20 };
    const transport = stubTransport({
      "GET /reports/sales/by-item": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { revenue: 4200 } }], grandTotals: { revenue: 4200 }, reconciliation: null } };
      },
    });
    renderWithProviders(<SalesByItemReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("صنف تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/sales/by-item");
    expect(requestedPath).toContain(`dateFrom=${MONTH_START}`);
    expect(requestedPath).toContain(`dateTo=${TODAY}`);
    expect(screen.queryByText("4200.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "4,200.00").length).toBeGreaterThan(0);
  });

  it("SalesByItemReportScreen renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/sales/by-item": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<SalesByItemReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("SalesByCustomerReportScreen hits its OWN endpoint (/sales/by-customer)", async () => {
    let requestedPath = "";
    const row = { customerId: "cust-1", customerNameAr: "عميل تجريبي", count: 4, total: 9000, outstanding: 1000, contributionPercent: 25 };
    const transport = stubTransport({
      "GET /reports/sales/by-customer": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { total: 9000 } }], grandTotals: { total: 9000 }, reconciliation: null } };
      },
    });
    renderWithProviders(<SalesByCustomerReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("عميل تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/sales/by-customer");
  });

  it("SalesBySalespersonReportScreen hits its OWN endpoint (/sales/by-salesperson)", async () => {
    let requestedPath = "";
    const row = { salespersonId: "sp-1", salespersonNameAr: "مندوب تجريبي", count: 6, total: 12000, promotionDiscount: 200, outstanding: 500, contributionPercent: 30 };
    const transport = stubTransport({
      "GET /reports/sales/by-salesperson": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { total: 12000 } }], grandTotals: { total: 12000 }, reconciliation: null } };
      },
    });
    renderWithProviders(<SalesBySalespersonReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("مندوب تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/sales/by-salesperson");
  });

  it("TopProductsReportScreen hits its OWN endpoint (/sales/top-products) with default limit/rankBy", async () => {
    let requestedPath = "";
    const row = { rank: 1, itemId: "item-1", itemNameAr: "أفضل صنف", qty: 200, revenue: 15000, contributionPercent: 40 };
    const transport = stubTransport({
      "GET /reports/sales/top-products": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { revenue: 15000 } }], grandTotals: { revenue: 15000 }, reconciliation: null } };
      },
    });
    renderWithProviders(<TopProductsReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("أفضل صنف").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/sales/top-products");
    expect(requestedPath).toContain("limit=20");
    expect(requestedPath).toContain("rankBy=revenue");
  });
});
