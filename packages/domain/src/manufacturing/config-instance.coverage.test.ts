import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { createConfigurableProduct } from "./configurable-product.js";
import {
  createConfigInstance,
  closeConfigInstance,
  cancelConfigInstance,
  configInstanceSellTotal,
} from "./config-instance.js";
import {
  ConfigInstanceNotFoundError,
  ConfigurableProductNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
} from "./errors.js";
import {
  InMemoryBoms,
  InMemoryConfigInstances,
  InMemoryConfigurableProducts,
  InMemoryWorkOrders,
  makeNumbering,
} from "./test-helpers.js";

const RAW = "RAW-WH";
const WIP = "WIP-WH";
const FG = "FG-WH";
const cost: Record<string, Money> = { m1: Money.fromMajor("50"), m2: Money.fromMajor("5") };
const resolveUnitCost = (id: string) => cost[id] ?? Money.zero();

async function setup() {
  const products = new InMemoryConfigurableProducts();
  const boms = new InMemoryBoms();
  const workOrders = new InMemoryWorkOrders();
  const instances = new InMemoryConfigInstances();
  const numbering = makeNumbering();
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
      materials: [{ itemId: "m1", qtyFormula: "2*(width+height)/100" }],
      pricingMethod: "formula",
      priceFormula: "width*height*3.5",
      laborFormula: "2*width",
      overheadFormula: "width",
    },
    { products, now },
  );
  return { products, boms, workOrders, instances, numbering, now };
}

const validCommand = () => ({
  id: "ci-1",
  configurableProductId: "cp-1",
  spec: { width: "10", height: "20" },
  qty: Qty.fromMajor("2"),
  sourceWarehouseId: RAW,
  wipWarehouseId: WIP,
  destinationWarehouseId: FG,
  scheduledStartDate: "2026-08-22",
});

describe("createConfigInstance validation", () => {
  it("refuses a zero quantity", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    await expect(
      createConfigInstance(
        { ...validCommand(), qty: Qty.zero() },
        { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
      ),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });

  it("refuses a negative quantity", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    await expect(
      createConfigInstance(
        { ...validCommand(), qty: Qty.fromMajor("-1") },
        { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
      ),
    ).rejects.toBeInstanceOf(InvalidManufacturingDocumentError);
  });

  it("refuses to create a second instance against an id already in use", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const deps = { instances, boms, workOrders, products, numbering, resolveUnitCost, now };
    await createConfigInstance(validCommand(), deps);
    await expect(createConfigInstance(validCommand(), deps)).rejects.toBeInstanceOf(
      DuplicateManufacturingDocumentError,
    );
  });

  it("refuses a configurable product id that does not exist", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    await expect(
      createConfigInstance(
        { ...validCommand(), configurableProductId: "nope" },
        { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
      ),
    ).rejects.toBeInstanceOf(ConfigurableProductNotFoundError);
  });

  it("a manual sellUnitPrice override wins over the formula's own price", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const { instance } = await createConfigInstance(
      { ...validCommand(), sellUnitPrice: Money.fromMajor("999.00") },
      { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
    );
    expect(instance.sellUnitPrice?.toString()).toBe("999.000000");
  });

  it("createdAt falls back to the wall clock when no `now` is supplied", async () => {
    const { products, boms, workOrders, instances, numbering } = await setup();
    const { instance } = await createConfigInstance(validCommand(), {
      instances,
      boms,
      workOrders,
      products,
      numbering,
      resolveUnitCost,
    });
    expect(() => new Date(instance.createdAt).toISOString()).not.toThrow();
  });
});

describe("sellUnitPrice is null when there is neither a manual override nor a formula price", () => {
  it("leaves sellUnitPrice null for a manually-priced configurable product with no override", async () => {
    const products = new InMemoryConfigurableProducts();
    const boms = new InMemoryBoms();
    const workOrders = new InMemoryWorkOrders();
    const instances = new InMemoryConfigInstances();
    const numbering = makeNumbering();
    const now = () => "2026-08-22T09:00:00.000Z";
    await createConfigurableProduct(
      {
        id: "cp-manual",
        code: "SHELF",
        nameAr: "رف مخصص",
        outputItemId: "FG-SHELF",
        unit: "PCS",
        inputs: [{ id: "width", labelAr: "العرض", min: 1, max: 100 }],
        materials: [{ itemId: "m1", qtyFormula: "width" }],
        pricingMethod: "manual",
      },
      { products, now },
    );
    const { instance } = await createConfigInstance(
      { ...validCommand(), configurableProductId: "cp-manual", spec: { width: "5" } },
      { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
    );
    expect(instance.sellUnitPrice).toBeNull();
  });
});

describe("configInstanceSellTotal is zero when no sell price was ever set", () => {
  it("returns zero rather than throwing when sellUnitPrice is null", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const { instance } = await createConfigInstance(
      { ...validCommand(), sellUnitPrice: null },
      { instances, boms, workOrders, products, numbering, resolveUnitCost, now },
    );
    const withoutPrice = { ...instance, sellUnitPrice: null };
    expect(configInstanceSellTotal(withoutPrice).toString()).toBe("0.000000");
  });
});

describe("closeConfigInstance", () => {
  it("throws ConfigInstanceNotFoundError for an unknown id", async () => {
    const { instances, workOrders } = await setup();
    await expect(closeConfigInstance("nope", { instances, workOrders })).rejects.toBeInstanceOf(
      ConfigInstanceNotFoundError,
    );
  });

  it("is idempotent once already closed", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const deps = { instances, boms, workOrders, products, numbering, resolveUnitCost, now };
    const { instance } = await createConfigInstance(validCommand(), deps);
    const first = await closeConfigInstance(instance.id, { instances, workOrders });
    expect(first.status).toBe("closed");
    const second = await closeConfigInstance(instance.id, { instances, workOrders });
    expect(second).toEqual(first);
  });

  it("returns the already-cancelled instance unchanged rather than re-closing it", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const deps = { instances, boms, workOrders, products, numbering, resolveUnitCost, now };
    const { instance } = await createConfigInstance(validCommand(), deps);
    await cancelConfigInstance(instance.id, { instances });
    const closed = await closeConfigInstance(instance.id, { instances, workOrders });
    expect(closed.status).toBe("cancelled");
  });

  it("falls back to the estimated unit cost when the linked work order can no longer be found", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const deps = { instances, boms, workOrders, products, numbering, resolveUnitCost, now };
    const { instance } = await createConfigInstance(validCommand(), deps);
    // Simulate the work order having been deleted out from under the instance.
    const orphanWorkOrders = new InMemoryWorkOrders();
    const closed = await closeConfigInstance(instance.id, { instances, workOrders: orphanWorkOrders });
    expect(closed.actualCost?.toString()).toBe(instance.estimatedUnitCost.toString());
  });
});

describe("cancelConfigInstance", () => {
  it("throws ConfigInstanceNotFoundError for an unknown id", async () => {
    const { instances } = await setup();
    await expect(cancelConfigInstance("nope", { instances })).rejects.toBeInstanceOf(ConfigInstanceNotFoundError);
  });

  it("marks a configured instance cancelled", async () => {
    const { products, boms, workOrders, instances, numbering, now } = await setup();
    const deps = { instances, boms, workOrders, products, numbering, resolveUnitCost, now };
    const { instance } = await createConfigInstance(validCommand(), deps);
    const cancelled = await cancelConfigInstance(instance.id, { instances });
    expect(cancelled.status).toBe("cancelled");
  });
});
