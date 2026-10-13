// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { SalesByPeriodReportScreen } from "./SalesReportsScreens";
import { TrialBalanceReportScreen } from "../TrialBalanceReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

const MAIN = { id: "BR-MAIN", name: "الفرع الرئيسي", isMain: true, active: true };
const ALEX = { id: "BR-ALEX", name: "فرع الإسكندرية", isMain: false, active: true };
const EVERY_BRANCH = { branches: [MAIN, ALEX], restricted: false, unattributed: true };
const EMPTY_REPORT = { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null };
const UNATTRIBUTED_EXCLUDED = /القيود غير المخصصة لفرع \(على مستوى المنشأة\) غير مشمولة/;

function optionLabels(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

afterEach(cleanup);

describe("the «الفرع» report parameter is a picker over the server's own branch lookup (D111)", () => {
  it("lists the branches the lookup answers and sends the real branch id", async () => {
    const requested: string[] = [];
    const transport = stubTransport({
      "GET /branches/lookup": () => ({ body: EVERY_BRANCH }),
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

  it("offers a branch-granted session only what the server granted it, and never «كل الفروع»", async () => {
    const transport = stubTransport({
      "GET /branches/lookup": () => ({ body: { branches: [ALEX], restricted: true, unattributed: false } }),
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
    expect(screen.queryByText(UNATTRIBUTED_EXCLUDED)).not.toBeInTheDocument();
  });

  it("adds «غير مخصص» on a statement that reads the journal line, sent as the unattributed bucket's own value", async () => {
    const requested: string[] = [];
    const transport = stubTransport({
      "GET /branches/lookup": () => ({ body: EVERY_BRANCH }),
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
    expect(screen.queryByText(UNATTRIBUTED_EXCLUDED)).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("option", { name: "غير مخصص" }));
    fireEvent.click(screen.getByRole("button", { name: /عرض التقرير/ }));

    await waitFor(() => expect(requested.some((path) => path.includes("branchId=__unattributed__"))).toBe(true));
  });

  it("withholds «غير مخصص» from a session that may not read unattributed lines, and says so on the statement", async () => {
    const transport = stubTransport({
      "GET /branches/lookup": () => ({ body: { branches: [ALEX], restricted: true, unattributed: false } }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /financial-reports/trial-balance": () => ({ body: EMPTY_REPORT }),
    });
    renderWithProviders(<TrialBalanceReportScreen />, {
      transport,
      initialSession: { ...testAdminSession, branchScope: ["BR-ALEX"] },
    });

    const picker = await screen.findByRole("combobox", { name: "الفرع" });
    fireEvent.click(picker);
    await waitFor(() => {
      expect(optionLabels()).toEqual(["كل فروعي", "فرع الإسكندرية"]);
    });
    expect(screen.getByText(UNATTRIBUTED_EXCLUDED)).toBeInTheDocument();
  });

  it("keeps «غير مخصص» for a branch-granted session that holds the unattributed permission", async () => {
    const transport = stubTransport({
      "GET /branches/lookup": () => ({ body: { branches: [ALEX], restricted: true, unattributed: true } }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /financial-reports/trial-balance": () => ({ body: EMPTY_REPORT }),
    });
    renderWithProviders(<TrialBalanceReportScreen />, {
      transport,
      initialSession: { ...testAdminSession, branchScope: ["BR-ALEX"] },
    });

    const picker = await screen.findByRole("combobox", { name: "الفرع" });
    fireEvent.click(picker);
    await waitFor(() => {
      expect(optionLabels()).toEqual(["كل فروعي", "فرع الإسكندرية", "غير مخصص"]);
    });
    expect(screen.queryByText(UNATTRIBUTED_EXCLUDED)).not.toBeInTheDocument();
  });
});
