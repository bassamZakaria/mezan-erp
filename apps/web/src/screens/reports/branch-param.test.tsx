// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SalesByPeriodReportScreen } from "./SalesReportsScreens";
import { TrialBalanceReportScreen } from "../TrialBalanceReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

const BRANCHES = [
  { id: "BR-MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "BR-ALEX", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
];
const EMPTY_REPORT = { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null };

function optionLabels(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

describe("the «الفرع» report parameter is a picker over the branch register (D111)", () => {
  it("lists the branches the session may see and sends the real branch id", async () => {
    const requested: string[] = [];
    const transport = stubTransport({
      "GET /branches": () => ({ body: BRANCHES }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /reports/sales/by-period": (_init, path) => {
        requested.push(path);
        return { body: EMPTY_REPORT };
      },
    });
    renderWithProviders(<SalesByPeriodReportScreen />, { transport, initialSession: testAdminSession });

    const picker = await screen.findByRole("combobox", { name: "الفرع" });
    expect(screen.queryByPlaceholderText(/معرف الفرع/)).not.toBeInTheDocument();
    fireEvent.click(picker);
    await waitFor(() => {
      expect(optionLabels()).toEqual(["كل الفروع", "الفرع الرئيسي", "فرع الإسكندرية"]);
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "فرع الإسكندرية" }));

    await waitFor(() => expect(requested.some((path) => path.includes("branchId=BR-ALEX"))).toBe(true));
  });

  it("offers only the granted branches to a branch-scoped session, and never «كل الفروع»", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: BRANCHES }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /reports/sales/by-period": () => ({ body: EMPTY_REPORT }),
    });
    renderWithProviders(<SalesByPeriodReportScreen />, {
      transport,
      initialSession: { ...testAdminSession, branchScope: ["BR-ALEX"] },
    });

    const picker = await screen.findByRole("combobox", { name: "الفرع" });
    fireEvent.click(picker);
    await waitFor(() => {
      expect(optionLabels()).toEqual(["كل فروعي", "فرع الإسكندرية"]);
    });
  });

  it("adds «غير مخصص» on a statement that reads the journal line, sent as the unattributed bucket's own value", async () => {
    const requested: string[] = [];
    const transport = stubTransport({
      "GET /branches": () => ({ body: BRANCHES }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /financial-reports/trial-balance": (_init, path) => {
        requested.push(path);
        return { body: EMPTY_REPORT };
      },
    });
    renderWithProviders(<TrialBalanceReportScreen />, { transport, initialSession: testAdminSession });

    const picker = await screen.findByRole("combobox", { name: "الفرع" });
    fireEvent.click(picker);
    await waitFor(() => {
      expect(optionLabels()).toEqual(["كل الفروع", "الفرع الرئيسي", "فرع الإسكندرية", "غير مخصص"]);
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: "غير مخصص" }));
    fireEvent.click(screen.getByRole("button", { name: /عرض التقرير/ }));

    await waitFor(() => expect(requested.some((path) => path.includes("branchId=__unattributed__"))).toBe(true));
  });
});
