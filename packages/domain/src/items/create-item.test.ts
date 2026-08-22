import { describe, it, expect } from "vitest";
import type { Account } from "../accounts/index.js";
import { Money } from "../money/index.js";
import { InMemoryItemRepository } from "./test-helpers/in-memory-item-repository.js";
import { createItem, validateNewItem } from "./create-item.js";
import { DuplicateItemCodeError, InvalidItemError } from "./errors.js";

const INVENTORY_ACCOUNT: Account = {
  id: "1200",
  code: "1200",
  nameAr: "المخزون",
  nameEn: "Inventory",
  type: "asset",
  naturalBalance: "debit",
  parentId: null,
  isHeader: false,
  status: "active",
};

const HEADER_ACCOUNT: Account = {
  id: "1000",
  code: "1000",
  nameAr: "الأصول",
  nameEn: "Assets",
  type: "asset",
  naturalBalance: "debit",
  parentId: null,
  isHeader: true,
  status: "active",
};

describe("createItem", () => {
  it("creates a stock item with sensible defaults", async () => {
    const repo = new InMemoryItemRepository();
    const item = await createItem(
      { id: "itm-1", code: "ITM-0001", nameAr: "طقم شاي", type: "stock", baseUnitCode: "PCS" },
      repo,
    );
    expect(item).toMatchObject({
      id: "itm-1",
      code: "ITM-0001",
      type: "stock",
      trackInventory: true,
      costingMethod: "WAC",
      taxRatePercent: 14,
      status: "active",
    });
    expect(await repo.findById("itm-1")).toEqual(item);
  });

  it("creates a service item that does not track inventory by default", async () => {
    const repo = new InMemoryItemRepository();
    const item = await createItem(
      { id: "itm-2", code: "SVC-0001", nameAr: "خدمة تركيب", type: "service", baseUnitCode: "SVC" },
      repo,
    );
    expect(item.trackInventory).toBe(false);
  });

  it("accepts a valid alternate unit and Money prices", async () => {
    const repo = new InMemoryItemRepository();
    const item = await createItem(
      {
        id: "itm-3",
        code: "ITM-0003",
        nameAr: "مياه معدنية",
        type: "stock",
        baseUnitCode: "PCS",
        alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 24 }],
        salePrice: Money.fromMajor("12.50"),
        costPrice: Money.fromMajor("8.00"),
      },
      repo,
    );
    expect(item.alternateUnits).toEqual([{ code: "CTN", name: "كرتونة", factor: 24 }]);
    expect(item.salePrice?.toString()).toBe("12.500000");
  });

  it("rejects a duplicate item code", async () => {
    const repo = new InMemoryItemRepository();
    await createItem({ id: "itm-1", code: "ITM-0001", nameAr: "صنف", type: "stock", baseUnitCode: "PCS" }, repo);
    await expect(
      createItem({ id: "itm-2", code: "ITM-0001", nameAr: "نسخة", type: "stock", baseUnitCode: "PCS" }, repo),
    ).rejects.toThrow(DuplicateItemCodeError);
  });

  it("rejects a blank name", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem({ id: "itm-1", code: "ITM-0001", nameAr: "  ", type: "stock", baseUnitCode: "PCS" }, repo),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects a service item asked to track inventory", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        { id: "itm-1", code: "SVC-0001", nameAr: "خدمة", type: "service", baseUnitCode: "SVC", trackInventory: true },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects batch/expiry tracking without trackInventory", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "صنف",
          type: "stock",
          baseUnitCode: "PCS",
          trackInventory: false,
          trackExpiry: true,
        },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects an alternate unit that repeats the base unit code", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "صنف",
          type: "stock",
          baseUnitCode: "PCS",
          alternateUnits: [{ code: "PCS", name: "قطعة", factor: 1 }],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects a non-positive alternate unit conversion factor", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "صنف",
          type: "stock",
          baseUnitCode: "PCS",
          alternateUnits: [{ code: "CTN", name: "كرتونة", factor: 0 }],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects duplicate alternate unit codes", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "صنف",
          type: "stock",
          baseUnitCode: "PCS",
          alternateUnits: [
            { code: "CTN", name: "كرتونة", factor: 24 },
            { code: "CTN", name: "كرتونة كبيرة", factor: 48 },
          ],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects duplicate barcodes on the same item", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        {
          id: "itm-1",
          code: "ITM-0001",
          nameAr: "صنف",
          type: "stock",
          baseUnitCode: "PCS",
          barcodes: ["6221234567890", "6221234567890"],
        },
        repo,
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("accepts a GL mapping that resolves to a postable account", async () => {
    const repo = new InMemoryItemRepository();
    const item = await createItem(
      {
        id: "itm-1",
        code: "ITM-0001",
        nameAr: "صنف",
        type: "stock",
        baseUnitCode: "PCS",
        inventoryAccountId: "1200",
      },
      repo,
      [INVENTORY_ACCOUNT, HEADER_ACCOUNT],
    );
    expect(item.inventoryAccountId).toBe("1200");
  });

  it("rejects a GL mapping pointing at a header (non-postable) account", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        { id: "itm-1", code: "ITM-0001", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", inventoryAccountId: "1000" },
        repo,
        [INVENTORY_ACCOUNT, HEADER_ACCOUNT],
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("rejects a GL mapping pointing at an account that does not exist", async () => {
    const repo = new InMemoryItemRepository();
    await expect(
      createItem(
        { id: "itm-1", code: "ITM-0001", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", cogsAccountId: "9999" },
        repo,
        [INVENTORY_ACCOUNT],
      ),
    ).rejects.toThrow(InvalidItemError);
  });

  it("skips GL validation entirely when no accounts list is supplied", async () => {
    const repo = new InMemoryItemRepository();
    const item = await createItem(
      { id: "itm-1", code: "ITM-0001", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", cogsAccountId: "9999" },
      repo,
    );
    expect(item.cogsAccountId).toBe("9999");
  });

  it("validateNewItem is a pure pre-check that does not persist anything", () => {
    expect(() =>
      validateNewItem({ id: "x", code: "ITM-9999", nameAr: "صنف", type: "stock", baseUnitCode: "PCS" }, []),
    ).not.toThrow();
  });
});
