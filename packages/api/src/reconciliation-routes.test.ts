import { describe, expect, it } from "vitest";
import { CostPermission, Money, Qty, StockPositionFault, type LedgerRepository } from "@mezan/domain";
import { createReconciliationRoutes } from "./reconciliation-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const VIEW = "accounting.reports.view";

const app = createReconciliationRoutes(
  {
    ledger: {} as LedgerRepository,
    resolveControls: async () => [],
    stockPositionFaults: async () => [{ itemId: "I-1", warehouseId: "WH-1", onHand: Qty.fromMajor("0"), totalValue: Money.fromMajor("12.50"), fault: StockPositionFault.ValueWithoutQuantity }],
  },
  insecureHeaderAuthContextResolver,
);

async function positionsSeenBy(permissions: string) {
  const res = await app.fetch(new Request("http://local/", { headers: { "x-permissions": permissions } }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { stockPositions: { rows: Record<string, unknown>[] } }).stockPositions.rows;
}

describe("GET /reconciliation — a faulty stock position's value is item cost (#119)", () => {
  it("leaves totalValue out without inventory.cost.view and keeps the quantity", async () => {
    expect(await positionsSeenBy(VIEW)).toEqual([{ itemId: "I-1", warehouseId: "WH-1", onHand: "0.000000", fault: StockPositionFault.ValueWithoutQuantity }]);
  });

  it("sends it to a holder", async () => {
    expect((await positionsSeenBy(`${VIEW},${CostPermission.Item}`))[0]?.totalValue).toBe("12.500000");
  });
});
