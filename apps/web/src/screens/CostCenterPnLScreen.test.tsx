// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { CostCenterPnLReportDTO } from "@mezan/contracts";
import { CostCenterPnLScreen } from "./CostCenterPnLScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { monthEndIso, monthStartIso } from "../lib/dates";

function report(overrides: Partial<CostCenterPnLReportDTO> = {}): CostCenterPnLReportDTO {
  return {
    rows: [
      { costCenterId: "cc-1", code: "CC-01", name: "الإنتاج", revenue: "12500.000000", expense: "9000.000000", profit: "3500.000000", parentId: null, rollup: { revenue: "12500.000000", expense: "9000.000000", profit: "3500.000000" } },
      { costCenterId: null, code: "—", name: "غير مخصص", revenue: "0.000000", expense: "1200.000000", profit: "-1200.000000", parentId: null, rollup: { revenue: "0.000000", expense: "1200.000000", profit: "-1200.000000" } },
    ],
    totals: { revenue: "12500.000000", expense: "10200.000000", profit: "2300.000000" },
    ...overrides,
  };
}

function baseHandlers(body: CostCenterPnLReportDTO = report()) {
  return { "GET /cost-center-pl": () => ({ body }) };
}

describe("CostCenterPnLScreen — list", () => {
  it("renders real rows off GET /cost-center-pl with the default month's exact request query", async () => {
    const paths: string[] = [];
    renderWithProviders(<CostCenterPnLScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /cost-center-pl": (_init, path) => {
          paths.push(path);
          return { body: report() };
        },
      }),
    });
    expect(await screen.findByText("الإنتاج")).toBeInTheDocument();
    expect(screen.getByText("غير مخصص")).toBeInTheDocument();

    const expected = `/cost-center-pl?fromDate=${encodeURIComponent(monthStartIso())}&toDate=${encodeURIComponent(monthEndIso())}`;
    await waitFor(() => expect(paths).toContain(expected));
  });

  it("formats money as a grouped decimal, never the raw exact-decimal wire string", async () => {
    renderWithProviders(<CostCenterPnLScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await screen.findByText("الإنتاج");
    // revenue 12500.000000 -> "12,500.00" (also the total-revenue stat card, since
    // this row is the only one earning revenue); the raw wire string must never leak through
    expect(screen.getAllByText("12,500.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("12500.000000")).not.toBeInTheDocument();
    expect(screen.queryByText("0.000000")).not.toBeInTheDocument();
    // negative profit renders with its sign
    expect(screen.getByText("-1,200.00")).toBeInTheDocument();
    // stat cards show the server's totals, also formatted
    expect(screen.getByText("2,300.00")).toBeInTheDocument();
  });

  it("shows the documented empty state when there is no movement in the period", async () => {
    renderWithProviders(<CostCenterPnLScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers({ rows: [], totals: { revenue: "0", expense: "0", profit: "0" } })),
    });
    expect(await screen.findByText("لا توجد حركات في هذه الفترة")).toBeInTheDocument();
  });

  it("shows the Arabic load error instead of a raw failure", async () => {
    renderWithProviders(<CostCenterPnLScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ "GET /cost-center-pl": () => ({ status: 500, body: { error: "INTERNAL" } }) }),
    });
    expect(await screen.findByText("تعذّر تحميل أرباح مراكز التكلفة. (رمز 500)")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("re-issues the request with the new date range when the from/to filters change", async () => {
    const paths: string[] = [];
    renderWithProviders(<CostCenterPnLScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /cost-center-pl": (_init, path) => {
          paths.push(path);
          return { body: report() };
        },
      }),
    });
    await screen.findByText("الإنتاج");
    const fromInput = screen.getByLabelText("من تاريخ");
    const toInput = screen.getByLabelText("إلى تاريخ");
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    fireEvent.change(toInput, { target: { value: "2026-01-31" } });
    await waitFor(() =>
      expect(paths.some((p) => p.includes("fromDate=2026-01-01") && p.includes("toDate=2026-01-31"))).toBe(true),
    );
  });
});
