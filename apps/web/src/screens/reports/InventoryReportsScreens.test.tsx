// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  InventoryAgingReportScreen,
  InventoryLedgerReportScreen,
  InventoryStockLevelsReportScreen,
  InventoryValuationReportScreen,
} from "./InventoryReportsScreens";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { NavigationProvider } from "../../navigation";

/** A row's own name often also labels a chart bar elsewhere on the page — wait for at least one match rather than assuming exactly one. */
async function findRowText(text: string): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
}

function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{ navigate: () => {}, segments, openSubPage: setSegments, openScreenAt: () => {}, intent: null, clearIntent: () => {} }}
    >
      {children}
    </NavigationProvider>
  );
}

describe("InventoryReportsScreens", () => {
  it("InventoryStockLevelsReportScreen hits /inventory/stock-levels, renders formatted money", async () => {
    let requestedPath = "";
    const row = { itemId: "item-1", itemNameAr: "صنف تجريبي", sku: "SKU-1", warehouseCount: 1, onHand: 10, averageCost: 85, value: 850, status: "normal" };
    const transport = stubTransport({
      "GET /reports/inventory/stock-levels": (_init, path) => {
        requestedPath = path;
        return { body: { rows: [row], groups: [{ key: "_all", label: "", rows: [row], totals: { value: 850 } }], grandTotals: { value: 850 }, reconciliation: null } };
      },
    });
    renderWithProviders(<InventoryStockLevelsReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getAllByText("صنف تجريبي").length).toBeGreaterThan(0));
    expect(requestedPath).toContain("/reports/inventory/stock-levels");
    expect(screen.queryByText("850.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "850.00").length).toBeGreaterThan(0);
  });

  it("InventoryStockLevelsReportScreen renders the shared empty-state copy on zero rows", async () => {
    const transport = stubTransport({
      "GET /reports/inventory/stock-levels": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<InventoryStockLevelsReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });

  it("InventoryLedgerReportScreen: the ledger tab and the movement tab each hit their OWN endpoint", async () => {
    let ledgerCalls = 0;
    let movementCalls = 0;
    const ledgerRow = { movementId: "mv-1", event: "استلام", itemNameAr: "صنف السجل", warehouseName: "المخزن الرئيسي", movementQty: 10, unitCost: 85, balance: 10 };
    const movementRow = { movementId: "mv-2", date: "2026-08-20", itemNameAr: "صنف الحركة", warehouseName: "المخزن الرئيسي", direction: "وارد", qty: 5, sourceDocTypeLabel: "استلام", sourceDocNumber: "GR-1" };
    const transport = stubTransport({
      "GET /reports/inventory/ledger": () => {
        ledgerCalls += 1;
        return { body: { rows: [ledgerRow], groups: [{ key: "_all", label: "", rows: [ledgerRow], totals: {} }], grandTotals: {}, reconciliation: null } };
      },
      "GET /reports/inventory/movement": () => {
        movementCalls += 1;
        return { body: { rows: [movementRow], groups: [{ key: "_all", label: "", rows: [movementRow], totals: {} }], grandTotals: {}, reconciliation: null } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <InventoryLedgerReportScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await waitFor(() => expect(ledgerCalls).toBeGreaterThan(0));
    await findRowText("صنف السجل");
    expect(movementCalls).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "الحركة" }));
    await waitFor(() => expect(movementCalls).toBeGreaterThan(0));
    await findRowText("صنف الحركة");
  });

  it("InventoryValuationReportScreen shows the drift banner only when the drift report returns rows", async () => {
    const valuationRow = { itemId: "item-1", itemNameAr: "صنف التقييم", onHand: 10, unitCost: 85, totalValue: 850 };
    const driftRow = { key: "k1", itemNameAr: "صنف منحرف", warehouseName: "المخزن الرئيسي", onHand: 5, recomputedAverageCost: 90, cachedAverageCost: 85, valueDiff: 25, maxPctDrift: 5, typeLabel: "انحراف" };
    const transport = stubTransport({
      "GET /reports/inventory/valuation": () => ({ body: { rows: [valuationRow], groups: [{ key: "_all", label: "", rows: [valuationRow], totals: {} }], grandTotals: {}, reconciliation: null } }),
      "GET /reports/inventory/drift": () => ({ body: { rows: [driftRow], groups: [{ key: "_all", label: "", rows: [driftRow], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(
      <TestNavigation>
        <InventoryValuationReportScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("أصناف يختلف فيها متوسط التكلفة عن قيمة طبقاتها: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "فروق التقييم" }));
    await findRowText("صنف منحرف");
  });

  it("InventoryValuationReportScreen shows no drift banner when the drift report returns zero rows", async () => {
    const valuationRow = { itemId: "item-1", itemNameAr: "صنف بلا انحراف", onHand: 10, unitCost: 85, totalValue: 850 };
    const transport = stubTransport({
      "GET /reports/inventory/valuation": () => ({ body: { rows: [valuationRow], groups: [{ key: "_all", label: "", rows: [valuationRow], totals: {} }], grandTotals: {}, reconciliation: null } }),
      "GET /reports/inventory/drift": () => ({ body: { rows: [], groups: [{ key: "_all", label: "", rows: [], totals: {} }], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(
      <TestNavigation>
        <InventoryValuationReportScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await findRowText("صنف بلا انحراف");
    expect(screen.queryByText(/أصناف يختلف فيها متوسط التكلفة/)).not.toBeInTheDocument();
  });

  it("InventoryAgingReportScreen composes aging/expiring/slow-moving as tabs, each hitting its own endpoint", async () => {
    const agingRow = { itemNameAr: "صنف قديم" };
    const expiringRow = { itemNameAr: "صنف يقارب الانتهاء" };
    let expiringCalls = 0;
    const transport = stubTransport({
      "GET /reports/inventory/aging": () => ({ body: { rows: [agingRow], groups: [{ key: "_all", label: "", rows: [agingRow], totals: {} }], grandTotals: {}, reconciliation: null } }),
      "GET /reports/inventory/expiring": () => {
        expiringCalls += 1;
        return { body: { rows: [expiringRow], groups: [{ key: "_all", label: "", rows: [expiringRow], totals: {} }], grandTotals: {}, reconciliation: null } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <InventoryAgingReportScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await findRowText("صنف قديم");
    expect(expiringCalls).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "قارب على الانتهاء" }));
    await waitFor(() => expect(expiringCalls).toBeGreaterThan(0));
    await findRowText("صنف يقارب الانتهاء");
  });
});
