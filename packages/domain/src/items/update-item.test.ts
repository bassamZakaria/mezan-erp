import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryItemRepository } from "./test-helpers/in-memory-item-repository.js";
import { createItem } from "./create-item.js";
import { updateItem } from "./update-item.js";
import { InvalidItemError, ItemNotFoundError } from "./errors.js";

async function seed(repo: InMemoryItemRepository) {
  return createItem({ id: "itm-1", code: "ITM-0001", nameAr: "صنف تجريبي", type: "stock", baseUnitCode: "PCS" }, repo);
}

describe("updateItem", () => {
  it("applies a partial patch and leaves the rest untouched", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    const updated = await updateItem("itm-1", { salePrice: Money.fromMajor("99.99") }, repo);
    expect(updated.salePrice?.toString()).toBe("99.990000");
    expect(updated.nameAr).toBe("صنف تجريبي");
    expect(updated.code).toBe("ITM-0001");
  });

  it("does not expose a way to change the item code", () => {
    // UpdateItemCommand has no `code` field — this is a compile-time guarantee,
    // exercised here only to document the intent.
    const command: Parameters<typeof updateItem>[1] = { nameAr: "اسم جديد" };
    expect("code" in command).toBe(false);
  });

  it("deactivates an item via status", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    const updated = await updateItem("itm-1", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });

  it("throws ItemNotFoundError for an unknown id", async () => {
    const repo = new InMemoryItemRepository();
    await expect(updateItem("nope", { nameAr: "x" }, repo)).rejects.toThrow(ItemNotFoundError);
  });

  it("re-validates on edit: rejects turning off trackInventory while batches are still tracked", async () => {
    const repo = new InMemoryItemRepository();
    await createItem(
      { id: "itm-1", code: "ITM-0001", nameAr: "دواء", type: "stock", baseUnitCode: "PCS", trackBatches: true },
      repo,
    );
    await expect(updateItem("itm-1", { trackInventory: false }, repo)).rejects.toThrow(InvalidItemError);
  });

  it("re-validates alternate units on edit", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    await expect(
      updateItem("itm-1", { alternateUnits: [{ code: "PCS", name: "قطعة", factor: 1 }] }, repo),
    ).rejects.toThrow(InvalidItemError);
  });

  it("changing type to service while trackInventory stays true is rejected", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    await expect(updateItem("itm-1", { type: "service" }, repo)).rejects.toThrow(InvalidItemError);
  });

  it("changing type to service alongside trackInventory: false succeeds", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    const updated = await updateItem("itm-1", { type: "service", trackInventory: false }, repo);
    expect(updated.type).toBe("service");
    expect(updated.trackInventory).toBe(false);
  });
});
