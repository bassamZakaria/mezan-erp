// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ArabicCase, CountedNoun, countPhrase, createInventoryBatchesReport, ExpiryStatus } from "@mezan/domain";
import { SalesByPeriodReportScreen } from "./SalesReportsScreens";
import { ReportScreen } from "./ReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { monthStartIso } from "../../lib/dates";

const { createObjectURL, revokeObjectURL } = URL;
afterEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

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
    expect(screen.getByTitle("2026-08-31")).toBeInTheDocument();
    expect(screen.queryByTitle("2026-08-10")).toBeNull();
    expect(paths[0]).toContain("pageSize=50");
    expect(paths[0]).toContain("page=1");
    screen.getByRole("button", { name: "2" }).click();
    await waitFor(() => expect(paths.some((p) => p.includes("page=2"))).toBe(true));
  });

  it("steps back to the last page when the result shrinks under the page on screen", async () => {
    const paths: string[] = [];
    const transport = stubTransport({
      "GET /reports/sales/by-period": (_init, path) => {
        paths.push(path);
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
        const row = { bucket: `2026-08-0${page}`, count: 1, gross: 1, discount: 0, tax: 0, net: 1 };
        return {
          body: {
            rows: page === 3 ? [] : [row],
            groups: [{ key: "_all", label: "", rows: page === 3 ? [] : [row], totals: { net: 1 } }],
            grandTotals: { count: 1, gross: 1, discount: 0, tax: 0, net: 1 },
            reconciliation: null,
            page: { page, pageSize: 50, totalRows: page === 1 ? 150 : 60 },
            chartPoints: [],
          },
        };
      },
    });

    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });
    await screen.findByRole("cell", { name: "2026-08-01" });
    fireEvent.click(screen.getByRole("button", { name: "3" }));

    await screen.findByRole("cell", { name: "2026-08-02" });
    expect(paths.at(-1)).toContain("page=2");
  });

  it("exports every row of a paged report, not just the page on screen", async () => {
    const day = (bucket: string) => ({ bucket, count: 1, gross: 100, discount: 0, tax: 0, net: 100 });
    const all = [day("2026-08-01"), day("2026-08-02"), day("2026-08-03")];
    const transport = stubTransport({
      "GET /reports/sales/by-period": (_init, path) => {
        const rows = path.includes("pageSize=") ? all.slice(0, 1) : all;
        return {
          body: {
            rows,
            groups: [{ key: "_all", label: "", rows, totals: { net: 300 } }],
            grandTotals: { count: 3, gross: 300, discount: 0, tax: 0, net: 300 },
            reconciliation: null,
            ...(path.includes("pageSize=") ? { page: { page: 1, pageSize: 50, totalRows: 3 }, chartPoints: [] } : {}),
          },
        };
      },
    });
    let exported: Blob | null = null;
    Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => ((exported = blob), "blob:x")), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });
    await screen.findByRole("cell", { name: "2026-08-01" });
    expect(screen.queryByRole("cell", { name: "2026-08-03" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "تصدير CSV" }));
    await waitFor(() => expect(exported).not.toBeNull());
    const text = await (exported as unknown as Blob).text();
    for (const row of all) expect(text).toContain(row.bucket);
    click.mockRestore();
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
