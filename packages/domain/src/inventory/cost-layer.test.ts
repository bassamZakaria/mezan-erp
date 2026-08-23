import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { layerRemainingValue, drawDownLayer, type CostLayer } from "./cost-layer.js";

function makeLayer(overrides: Partial<CostLayer> = {}): CostLayer {
  return {
    id: "LAYER1",
    itemId: "I1",
    warehouseId: "W1",
    unitCost: Money.fromMajor("7"),
    originalQty: Qty.fromMajor("10"),
    remainingQty: Qty.fromMajor("10"),
    sourceDocType: "PURCHASE_RECEIPT",
    sourceDocId: "GR1",
    sourceDocNumber: "GR-000001",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("layerRemainingValue", () => {
  it("extends remainingQty × the layer's immutable unit cost", () => {
    const layer = makeLayer({ remainingQty: Qty.fromMajor("4"), unitCost: Money.fromMajor("7") });
    expect(layerRemainingValue(layer).toString()).toBe("28.000000");
  });

  it("is zero once the layer is fully consumed", () => {
    const layer = makeLayer({ remainingQty: Qty.zero() });
    expect(layerRemainingValue(layer).toString()).toBe("0.000000");
  });
});

describe("drawDownLayer", () => {
  it("reduces remainingQty by the consumed amount and preserves the unit cost unchanged", () => {
    const layer = makeLayer({ remainingQty: Qty.fromMajor("10"), unitCost: Money.fromMajor("7") });
    const drawn = drawDownLayer(layer, Qty.fromMajor("6"));
    expect(drawn.remainingQty.toString()).toBe("4.000000");
    expect(drawn.unitCost.toString()).toBe("7.000000"); // immutability guarantee — never rewritten
    expect(drawn.originalQty.toString()).toBe("10.000000"); // original qty untouched
  });

  it("does not mutate the input layer", () => {
    const layer = makeLayer({ remainingQty: Qty.fromMajor("10") });
    drawDownLayer(layer, Qty.fromMajor("3"));
    expect(layer.remainingQty.toString()).toBe("10.000000");
  });

  it("can be drawn down to exactly zero", () => {
    const layer = makeLayer({ remainingQty: Qty.fromMajor("5") });
    const drawn = drawDownLayer(layer, Qty.fromMajor("5"));
    expect(drawn.remainingQty.toString()).toBe("0.000000");
    expect(layerRemainingValue(drawn).toString()).toBe("0.000000");
  });

  it("chains multiple partial draw-downs consistently (FIFO consumption)", () => {
    let layer = makeLayer({ remainingQty: Qty.fromMajor("10"), unitCost: Money.fromMajor("5") });
    layer = drawDownLayer(layer, Qty.fromMajor("3"));
    layer = drawDownLayer(layer, Qty.fromMajor("2"));
    expect(layer.remainingQty.toString()).toBe("5.000000");
    expect(layerRemainingValue(layer).toString()).toBe("25.000000");
  });
});
