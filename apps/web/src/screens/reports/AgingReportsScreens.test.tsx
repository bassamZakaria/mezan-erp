// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { AgingCustomersReportScreen, AgingSuppliersReportScreen } from "./AgingReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { todayIso } from "../../lib/dates";

const TODAY = todayIso();

describe("AgingReportsScreens (each a real ReportScreen over its own /reports/aging/* endpoint)", () => {
  it("AgingCustomersReportScreen hits /aging/customers with the report's default asOfDate, and renders formatted money", async () => {
    let requestedPath = "";
    const transport = stubTransport({
      "GET /reports/aging/customers": (_init, path) => {
        requestedPath = path;
        return {
          body: {
            rows: [{ customerId: "cust-1", customerNameAr: "عميل تجريبي", current: 1000, d31to60: 0, d61to90: 0, over90: 0 }],
            groups: [{ key: "_all", label: "", rows: [{ customerId: "cust-1", customerNameAr: "عميل تجريبي", current: 1000, d31to60: 0, d61to90: 0, over90: 0 }], totals: { current: 1000 } }],
            grandTotals: { current: 1000 },
            reconciliation: null,
          },
        };
      },
    });
    renderWithProviders(<AgingCustomersReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("عميل تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/aging/customers");
    expect(requestedPath).toContain(`asOfDate=${TODAY}`);
    expect(screen.queryByText("1000.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "1,000.00").length).toBeGreaterThan(0);
  });

  it("AgingCustomersReportScreen renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<AgingCustomersReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("AgingSuppliersReportScreen hits its OWN endpoint (/aging/suppliers), not the customers one", async () => {
    let requestedPath = "";
    const transport = stubTransport({
      "GET /reports/aging/suppliers": (_init, path) => {
        requestedPath = path;
        return {
          body: {
            rows: [{ supplierId: "sup-1", supplierNameAr: "مورد تجريبي", current: 500, d31to60: 0, d61to90: 0, over90: 0 }],
            groups: [{ key: "_all", label: "", rows: [{ supplierId: "sup-1", supplierNameAr: "مورد تجريبي", current: 500, d31to60: 0, d61to90: 0, over90: 0 }], totals: { current: 500 } }],
            grandTotals: { current: 500 },
            reconciliation: null,
          },
        };
      },
    });
    renderWithProviders(<AgingSuppliersReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("مورد تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/aging/suppliers");
    expect(requestedPath).toContain(`asOfDate=${TODAY}`);
  });
});
