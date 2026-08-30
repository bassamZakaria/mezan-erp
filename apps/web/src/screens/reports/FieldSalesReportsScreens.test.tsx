// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { VanSalesReportScreen } from "./FieldSalesReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { monthStartIso, todayIso } from "../../lib/dates";

const TODAY = todayIso();
const MONTH_START = monthStartIso();

describe("FieldSalesReportsScreens", () => {
  it("VanSalesReportScreen hits /field/van-sales with the default month-to-date range and status=all, renders formatted money", async () => {
    let requestedPath = "";
    const row = {
      tripId: "trip-1",
      status: "settled",
      statusLabelAr: "مسوّاة",
      tripLabel: "رحلة تجريبية",
      date: "2026-08-20",
      crewAr: "طاقم تجريبي",
      loadedQty: 10,
      returnedQty: 2,
      dispatchedQty: 8,
      salesCash: 2500,
      collectionsCash: 0,
      openingCashFloat: 0,
      expectedCash: 2500,
      countedCash: 2500,
      cashVariance: 0,
    };
    const transport = stubTransport({
      "GET /reports/field/van-sales": (_init, path) => {
        requestedPath = path;
        return {
          body: {
            rows: [row],
            groups: [{ key: "settled", label: "مسوّاة", rows: [row], totals: { salesCash: 2500 } }],
            grandTotals: { salesCash: 2500 },
            reconciliation: null,
          },
        };
      },
    });
    renderWithProviders(<VanSalesReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("رحلة تجريبية").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/field/van-sales");
    expect(requestedPath).toContain(`dateFrom=${MONTH_START}`);
    expect(requestedPath).toContain(`dateTo=${TODAY}`);
    expect(requestedPath).toContain("status=all");
    expect(screen.queryByText("2500.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "2,500.00").length).toBeGreaterThan(0);
  });

  it("renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/field/van-sales": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<VanSalesReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });
});
