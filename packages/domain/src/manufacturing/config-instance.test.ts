import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { StockLedgerService } from "../inventory/index.js";
import { createConfigurableProduct } from "./configurable-product.js";
import {
  createConfigInstance,
  closeConfigInstance,
  configInstanceSellTotal,
} from "./config-instance.js";
import {
  startWorkOrder,
  issueWorkOrderMaterials,
  receiveWorkOrderProduct,
  completeWorkOrder,
} from "./work-order.js";
import type { WorkOrderGlAccounts } from "./types.js";
import {
  InMemoryBoms,
  InMemoryConfigInstances,
  InMemoryConfigurableProducts,
  InMemoryWorkOrders,
  makeNumbering,
  makeStock,
  RecordingGlPort,
} from "./test-helpers.js";

const RAW = "RAW-WH";
const WIP = "WIP-WH";
const FG = "FG-WH";
const cost: Record<string, Money> = { m1: Money.fromMajor("50"), m2: Money.fromMajor("5") };
const resolveUnitCost = (id: string) => cost[id] ?? Money.zero();
const ACCOUNTS: WorkOrderGlAccounts = {
  finishedGoodsAccountId: "1310",
  rawInventoryAccountId: "1300",
  laborAppliedAccountId: "5100",
  overheadAppliedAccountId: "5200",
  abnormalScrapAccountId: "5220",
  wipAccountId: "1250",
};

async function setup() {
  const products = new InMemoryConfigurableProducts();
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const instances = new InMemoryConfigInstances();
  const numbering = makeNumbering();
  const stock = makeStock();
  const now = () => "2026-08-22T09:00:00.000Z";

  await createConfigurableProduct(
    {
      id: "cp-1",
      code: "WINDOW",
      nameAr: "نافذة مخصصة",
      outputItemId: "FG-WINDOW",
      unit: "PCS",
      inputs: [
        { id: "width", labelAr: "العرض", min: 1, max: 100 },
        { id: "height", labelAr: "الطول", min: 1, max: 100 },
      ],
      materials: [
        { itemId: "m1", qtyFormula: "2*(width+height)/100" },
        { itemId: "m2", qtyFormula: "width" },
      ],
      pricingMethod: "formula",
      priceFormula: "width*height*3.5",
      laborFormula: "2*width",
      overheadFormula: "width",
    },
    { products, now },
  );
  return { products, boms, workOrders, instances, numbering, stock, now };
}

describe("custom manufacturing order (config instance)", () => {
  it("resolves formulas and auto-generates a linked custom BOM + work order", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const { instance, workOrder } = await createConfigInstance(
      {
        id: "ci-1",
        configurableProductId: "cp-1",
        spec: { width: "10", height: "20" },
        qty: Qty.fromMajor("2"),
        customerId: "cust-1",
        sourceWarehouseId: RAW,
        wipWarehouseId: WIP,
        destinationWarehouseId: FG,
        scheduledStartDate: "2026-08-22",
      },
      { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
    );

    expect(instance.number).toBe("CM-000001");
    // per-unit: material 80, labour 20, overhead 10 → est unit cost 110.
    expect(instance.materialCostPerUnit.toString()).toBe("80.000000");
    expect(instance.estimatedUnitCost.toString()).toBe("110.000000");
    // formula price used when no manual override.
    expect(instance.sellUnitPrice?.toString()).toBe("700.000000");
    expect(configInstanceSellTotal(instance).toString()).toBe("1400.000000");

    // Linkage both ways + ad-hoc custom BOM materialised.
    expect(workOrder.configInstanceId).toBe("ci-1");
    expect(instance.workOrderId).toBe(workOrder.id);
    const bom = await boms.findById(instance.bomId);
    expect(bom?.custom).toBe(true);
    expect(bom?.productItemId).toBe("FG-WINDOW");
    // WO planned for 2 units: m2 required = width(10) × 2 = 20.
    expect(workOrder.plannedQty.toString()).toBe("2.000000");
    expect(workOrder.materials.find((m) => m.itemId === "m2")?.requiredQty.toString()).toBe("20.000000");
  });

  it("runs the linked work order and captures actual cost on close", async () => {
    const { products, boms, workOrders, instances, numbering, stock, now } = await setup();
    await stock.recordOpeningBalance({
      adjustmentId: "o1",
      warehouseId: RAW,
      lines: [
        { itemId: "m1", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("50") },
        { itemId: "m2", qty: Qty.fromMajor("100"), unitCost: Money.fromMajor("5") },
      ],
    });
    const gl = new RecordingGlPort();
    const { instance, workOrder } = await createConfigInstance(
      {
        id: "ci-1",
        configurableProductId: "cp-1",
        spec: { width: "10", height: "20" },
        qty: Qty.fromMajor("2"),
        sourceWarehouseId: RAW,
        wipWarehouseId: WIP,
        destinationWarehouseId: FG,
        scheduledStartDate: "2026-08-22",
      },
      { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
    );

    const woDeps = { workOrders, stock, now, gl, accounts: ACCOUNTS };
    await startWorkOrder(workOrder.id, woDeps);
    await issueWorkOrderMaterials(workOrder.id, woDeps);
    await receiveWorkOrderProduct(workOrder.id, Qty.fromMajor("2"), woDeps);
    await completeWorkOrder(workOrder.id, { workOrders, gl, accounts: ACCOUNTS, now });

    // material: m1 1.2×50=60 + m2 20×5=100 = 160 ; +labour 40 +overhead 20 = 220.
    const closed = await closeConfigInstance(instance.id, { instances, workOrders });
    expect(closed.status).toBe("closed");
    expect(closed.actualCost?.toString()).toBe("220.000000");
    expect((await stock.getBalanceDetail("FG-WINDOW", FG)).totalValue.toString()).toBe("220.000000");
  });
});
