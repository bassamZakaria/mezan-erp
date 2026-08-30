// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { SalesByPeriodReportScreen } from "./SalesReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

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
    expect(requestedPath).toContain("dateFrom=2026-08-01");
    expect(requestedPath).toContain("groupBy=day");
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
});
