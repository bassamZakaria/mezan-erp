// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { PurchasesByItemReportScreen, PurchasesByPeriodReportScreen, PurchasesBySupplierReportScreen } from "./PurchasesReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { monthStartIso, todayIso } from "../../lib/dates";

const TODAY = todayIso();
const MONTH_START = monthStartIso();

describe("PurchasesReportsScreens", () => {
  it("PurchasesByPeriodReportScreen hits /purchases/by-period with the default month-to-date range and groupBy=day, renders formatted money", async () => {
    let requestedPath = "";
    const row = { bucket: "2026-08-10", count: 2, gross: 1000, tax: 140, net: 1140 };
    const transport = stubTransport({
      "GET /reports/purchases/by-period": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { net: 1140 } }], grandTotals: { net: 1140 }, reconciliation: null } };
      },
    });
    renderWithProviders(<PurchasesByPeriodReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("2026-08-10").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/purchases/by-period");
    expect(requestedPath).toContain(`dateFrom=${MONTH_START}`);
    expect(requestedPath).toContain(`dateTo=${TODAY}`);
    expect(requestedPath).toContain("groupBy=day");
    expect(screen.queryByText("1140.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "1,140.00").length).toBeGreaterThan(0);
  });

  it("PurchasesByPeriodReportScreen renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/purchases/by-period": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<PurchasesByPeriodReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("PurchasesBySupplierReportScreen hits its OWN endpoint (/purchases/by-supplier)", async () => {
    let requestedPath = "";
    const row = { supplierId: "sup-1", supplierNameAr: "مورد تجريبي", count: 3, total: 5000, outstanding: 1000, contributionPercent: 30 };
    const transport = stubTransport({
      "GET /reports/purchases/by-supplier": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { total: 5000 } }], grandTotals: { total: 5000 }, reconciliation: null } };
      },
    });
    renderWithProviders(<PurchasesBySupplierReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("مورد تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/purchases/by-supplier");
    expect(requestedPath).toContain(`dateFrom=${MONTH_START}`);
  });

  it("PurchasesByItemReportScreen hits its OWN endpoint (/purchases/by-item)", async () => {
    let requestedPath = "";
    const row = { itemId: "item-1", itemNameAr: "صنف تجريبي", qty: 100, cost: 8500, costPercent: 40 };
    const transport = stubTransport({
      "GET /reports/purchases/by-item": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { cost: 8500 } }], grandTotals: { cost: 8500 }, reconciliation: null } };
      },
    });
    renderWithProviders(<PurchasesByItemReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("صنف تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/purchases/by-item");
  });
});
