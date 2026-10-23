// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ArabicCase, CountedNoun, countPhrase, createInventoryBatchesReport, ExpiryStatus } from "@mezan/domain";
import { SalesByPeriodReportScreen } from "./SalesReportsScreens";
import { ReportScreen } from "./ReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { monthStartIso } from "../../lib/dates";

/**
 * Proves the operational-report screens go through the app's REAL data
 * client (`useApi().request` → `useReport` — apps/web/src/data/reports-hooks.ts)
 * rather than sample data: the stub transport stands in for the live
 * `/reports/*` API (packages/api/src/reports-routes.ts), and this test
 * asserts the screen sends the report's own default params and renders
 * exactly the rows the "server" returned.
 */
describe("ReportScreen (real data-client wiring)", () => {
  it("fetches /reports/sales/by-period with the report's default params and renders the returned rows", async () => {
    let requestedPath = "";
    const transport = stubTransport({
      "GET /reports/sales/by-period": (_init, path) => {
        requestedPath = path;
        return {
          body: {
            rows: [{ bucket: "2026-08-10", count: 2, gross: 300, discount: 0, tax: 0, net: 300 }],
            groups: [{ key: "_all", label: "", rows: [{ bucket: "2026-08-10", count: 2, gross: 300, discount: 0, tax: 0, net: 300 }], totals: { count: 2, gross: 300, discount: 0, tax: 0, net: 300 } }],
            grandTotals: { count: 2, gross: 300, discount: 0, tax: 0, net: 300 },
            reconciliation: null,
          },
        };
      },
    });

    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByRole("cell", { name: "2026-08-10" })).toBeInTheDocument());
    expect(requestedPath).toContain("/reports/sales/by-period");
    // The screen defaults to the CURRENT month (`monthStartIso()`), so a
    // literal here rots on the first of every month.
    expect(requestedPath).toContain(`dateFrom=${monthStartIso()}`);
    expect(requestedPath).toContain("groupBy=day");
  });

  it("asks for one page and offers the next one", async () => {
    const paths: string[] = [];
    const row = { bucket: "2026-08-10", count: 2, gross: 300, discount: 0, tax: 0, net: 300 };
    const transport = stubTransport({
      "GET /reports/sales/by-period": (_init, path) => {
        paths.push(path);
        return {
          body: {
            rows: [row],
            groups: [{ key: "_all", label: "", rows: [row], totals: { net: 9000 } }],
            grandTotals: { count: 60, gross: 9000, discount: 0, tax: 0, net: 9000 },
            reconciliation: null,
            page: { page: 1, pageSize: 50, totalRows: 120 },
            chartPoints: [{ key: "x", label: "2026-08-31", value: 777 }],
          },
        };
      },
    });

    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByRole("navigation", { name: "ترقيم الصفحات" })).toBeInTheDocument());
    expect(paths[0]).toContain("pageSize=50");
    expect(paths[0]).toContain("page=1");
    screen.getByRole("button", { name: "2" }).click();
    await waitFor(() => expect(paths.some((p) => p.includes("page=2"))).toBe(true));
  });

  it("shows the empty-state copy when the report returns no rows", async () => {
    const transport = stubTransport({
      "GET /reports/sales/by-period": () => ({
        body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null },
      }),
    });

    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("renders the batches report's status and no-batch cells and its description in English", async () => {
    window.localStorage.setItem("mezan.locale", "en");
    const row = {
      key: "k1", itemId: "ITEM-1", itemCode: "A1", itemNameAr: "أرز", itemNameEn: "Rice", warehouseId: "WH-1", warehouseName: "Main",
      batchNo: null, batchLabel: "بدون تشغيلة", expiryDate: "2026-10-25", daysToExpiry: 7, status: ExpiryStatus.NearExpiry,
      statusLabel: "قاربت على الانتهاء", fefoRank: 1, qty: 3, qtyExact: "3", totalValue: 30, valueExact: "30", receivedOn: "2026-09-01",
    };
    const transport = stubTransport({
      "GET /reports/inventory/batches": () => ({
        body: { rows: [row], groups: [{ key: "WH-1", label: "Main", rows: [row], totals: {} }], grandTotals: {}, reconciliation: null },
      }),
    });
    const definition = {
      ...createInventoryBatchesReport("2026-10-18", 30),
      descriptionParams: { days: countPhrase("en", 30, CountedNoun.Day, { grammaticalCase: ArabicCase.Oblique }) },
    };
    renderWithProviders(<ReportScreen definition={definition} apiPath="/inventory/batches" />, { transport, initialSession: testAdminSession });

    try {
      await waitFor(() => expect(screen.getByRole("cell", { name: "Near expiry" })).toBeInTheDocument());
      expect(screen.getByRole("cell", { name: "No batch" })).toBeInTheDocument();
      expect(screen.getByText(/«Near expiry» means within 30 days\./)).toBeInTheDocument();
    } finally {
      window.localStorage.removeItem("mezan.locale");
    }
  });
});
