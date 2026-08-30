// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MakeVsBuyReportScreen } from "./ManufacturingReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

describe("ManufacturingReportsScreens", () => {
  it("MakeVsBuyReportScreen hits /manufacturing/make-vs-buy with the default blank search, renders formatted money", async () => {
    let requestedPath = "";
    const row = { itemId: "item-1", itemNameAr: "صنف تجريبي", bomNumber: "BOM-1", makeCost: 80, buyCost: 100, diff: 20, verdict: "make", verdictLabel: "التصنيع أرخص" };
    const transport = stubTransport({
      "GET /reports/manufacturing/make-vs-buy": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { makeCost: 80, buyCost: 100 } }], grandTotals: { makeCost: 80, buyCost: 100 }, reconciliation: null } };
      },
    });
    renderWithProviders(<MakeVsBuyReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("صنف تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/manufacturing/make-vs-buy");
    expect(screen.queryByText("100.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "100.00").length).toBeGreaterThan(0);
  });

  it("renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/manufacturing/make-vs-buy": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<MakeVsBuyReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });
});
