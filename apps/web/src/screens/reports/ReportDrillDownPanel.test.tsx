// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { ReportDrillDownDTO } from "@mezan/contracts";
import type { ReportRunnerEntityRef } from "@mezan/ui";
import { ReportDrillDownPanel, drillDownQuery } from "./ReportDrillDownPanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { pathForRoute } from "../../routing";

const entity: ReportRunnerEntityRef = { kind: "customer", id: "cust-1", label: "عميل تجريبي" };

/** The panel opens immediately (SidePanel mounts on `entity`) but its data arrives async — wait past the loading text before asserting on content. */
async function getLoadedDialog(): Promise<HTMLElement> {
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).queryByText("جارٍ تحميل التفاصيل…")).not.toBeInTheDocument());
  return dialog;
}

function drillDown(overrides: Partial<ReportDrillDownDTO> = {}): ReportDrillDownDTO {
  return {
    kind: "customer",
    id: "cust-1",
    titleAr: "عميل تجريبي",
    subtitleAr: "شركة تجريبية",
    facts: [
      { key: "balance", labelAr: "الرصيد", value: "1500.00", format: "money" },
      { key: "invoiceCount", labelAr: "عدد الفواتير", value: "3", format: undefined },
    ],
    documents: [
      { id: "si-1", docNo: "SI-000001", date: "2026-08-20", type: "SALES_INVOICE", status: "confirmed", amount: 500, amountFormat: "money" },
      { id: "mv-1", docNo: "MV-000001", date: "2026-08-20", type: "STOCK_MOVEMENT", status: "posted", amount: 10, amountFormat: "qty" },
    ],
    documentCount: 5,
    ...overrides,
  };
}

describe("drillDownQuery — a panel is asked for the window its row was computed over (D281, D286)", () => {
  it("sends the as-of ladder's own day and branch to every entity panel", () => {
    const params = { asOfDate: "2026-09-19", branchId: "BR-1" };
    for (const kind of ["customer", "supplier", "item", "account"]) {
      expect(drillDownQuery(kind, params)).toBe("?asOfDate=2026-09-19&branchId=BR-1");
    }
  });

  it("reads the period under whichever of the three names the report gave it", () => {
    expect(drillDownQuery("customer", { dateFrom: "2026-09-01", dateTo: "2026-09-19", taxMode: "inc", branchId: "" })).toBe(
      "?fromDate=2026-09-01&asOfDate=2026-09-19",
    );
    expect(drillDownQuery("supplier", { fromDate: "2026-01-01", toDate: "2026-03-31" })).toBe("?fromDate=2026-01-01&asOfDate=2026-03-31");
    expect(drillDownQuery("account", { periodFrom: "2026-01-01", periodTo: "2026-09-19", branchId: "" })).toBe(
      "?fromDate=2026-01-01&asOfDate=2026-09-19",
    );
  });

  it("passes the stock report's warehouse to the item panel and to no other", () => {
    const params = { warehouseId: "WH-MAIN", search: "", branchId: "" };
    expect(drillDownQuery("item", params)).toBe("?warehouseId=WH-MAIN");
    expect(drillDownQuery("customer", params)).toBe("");
  });

  it("sends nothing when the report ran with no window at all", () => {
    expect(drillDownQuery("customer", {})).toBe("");
    expect(drillDownQuery("customer", null)).toBe("");
  });
});

describe("ReportDrillDownPanel", () => {
  it("renders closed and fires no fetch when entity is null", () => {
    let called = false;
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => {
        called = true;
        return { body: drillDown() };
      },
    });
    renderWithProviders(<ReportDrillDownPanel entity={null} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("fetches the real /reports/drill-down/:kind/:id endpoint and renders facts, money-formatted where format is money", async () => {
    let requestedPath = "";
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": (_init, path) => {
        requestedPath = path;
        return { body: drillDown() };
      },
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    const dialog = await getLoadedDialog();
    expect(requestedPath).toBe("/reports/drill-down/customer/cust-1");
    expect(within(dialog).getByText("عميل تجريبي")).toBeInTheDocument();
    expect(within(dialog).getByText("شركة تجريبية")).toBeInTheDocument();
    expect(within(dialog).queryByText("1500.00")).not.toBeInTheDocument();
    expect(within(dialog).getByText((_, el) => el?.textContent === "1,500.00")).toBeInTheDocument();
    expect(within(dialog).getByText("3")).toBeInTheDocument();
  });

  it("a document mapped to a real screen renders as a real Link with the correct href, and closes the panel on click", async () => {
    const onClose = vi.fn();
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => ({ body: drillDown() }),
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={onClose} />, { transport, initialSession: testAdminSession });
    const dialog = await getLoadedDialog();
    const link = within(dialog).getByRole("link", { name: /SI-000001/ });
    expect(link).toHaveAttribute("href", pathForRoute("sales-invoices", ["si-1"]));
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it("a STOCK_MOVEMENT document (no screen) renders as a plain non-clickable row, not a link", async () => {
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => ({ body: drillDown() }),
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    const dialog = await getLoadedDialog();
    expect(within(dialog).getByText("MV-000001")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: /MV-000001/ })).not.toBeInTheDocument();
  });

  it("shows the 'showing X of Y' note when documentCount exceeds the listed documents", async () => {
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => ({ body: drillDown({ documentCount: 5 }) }),
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    const dialog = await getLoadedDialog();
    expect(within(dialog).getByText("يعرض 2 من 5 مستنداً.")).toBeInTheDocument();
  });

  it("shows the Arabic empty-documents message when there are none", async () => {
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => ({ body: drillDown({ documents: [], documentCount: 0 }) }),
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    const dialog = await getLoadedDialog();
    expect(within(dialog).getByText("لا توجد مستندات مصدر لهذا السطر.")).toBeInTheDocument();
  });

  it("shows the Arabic loading text, then the Arabic failure alert on error, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /reports/drill-down/*/*": () => ({ status: 500, body: { error: "SERVER_ERROR" } }),
    });
    renderWithProviders(<ReportDrillDownPanel entity={entity} onClose={() => {}} />, { transport, initialSession: testAdminSession });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("جارٍ تحميل التفاصيل…")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("تعذّر تحميل تفاصيل هذا السطر."));
  });
});
