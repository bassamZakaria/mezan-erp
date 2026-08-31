import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InMemoryItemRepository } from "./test-helpers/in-memory-item-repository.js";
import { createItem } from "./create-item.js";
import { updateItem } from "./update-item.js";

async function seed(repo: InMemoryItemRepository) {
  return createItem({ id: "itm-1", code: "ITM-0001", nameAr: "صنف تجريبي", type: "stock", baseUnitCode: "PCS" }, repo);
}

describe("updateItem — explicit values on every optional field", () => {
  it("applies an explicit value to every nullable/optional field in one patch", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);

    const updated = await updateItem(
      "itm-1",
      {
        nameEn: "Sample Item",
        categoryId: "cat-1",
        brandId: "brand-1",
        description: "وصف الصنف",
        defaultSupplierId: "sup-1",
        seasonId: "season-1",
        specifications: [{ code: "color", value: "أحمر" }],
        costPrice: Money.fromMajor("40.00"),
        reorderPoint: 5,
        imageAttachmentId: "att-1",
        reorderQty: 20,
        revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs",
        inventoryAccountId: "acc-inv",
        etaCodeType: "GPC",
        etaItemCode: "EGS1000000",
        gpcCode: "10000000",
      },
      repo,
    );

    expect(updated.nameEn).toBe("Sample Item");
    expect(updated.categoryId).toBe("cat-1");
    expect(updated.brandId).toBe("brand-1");
    expect(updated.description).toBe("وصف الصنف");
    expect(updated.defaultSupplierId).toBe("sup-1");
    expect(updated.seasonId).toBe("season-1");
    expect(updated.specifications).toEqual([{ code: "color", value: "أحمر" }]);
    expect(updated.costPrice?.toString()).toBe("40.000000");
    expect(updated.reorderPoint).toBe(5);
    expect(updated.imageAttachmentId).toBe("att-1");
    expect(updated.reorderQty).toBe(20);
    expect(updated.revenueAccountId).toBe("acc-rev");
    expect(updated.cogsAccountId).toBe("acc-cogs");
    expect(updated.inventoryAccountId).toBe("acc-inv");
    expect(updated.etaCodeType).toBe("GPC");
    expect(updated.etaItemCode).toBe("EGS1000000");
    expect(updated.gpcCode).toBe("10000000");
  });

  it("clears every nullable field back to null when the patch says so explicitly", async () => {
    const repo = new InMemoryItemRepository();
    await seed(repo);
    await updateItem(
      "itm-1",
      {
        nameEn: "Sample Item",
        categoryId: "cat-1",
        brandId: "brand-1",
        description: "وصف",
        defaultSupplierId: "sup-1",
        seasonId: "season-1",
        reorderPoint: 5,
        imageAttachmentId: "att-1",
        reorderQty: 20,
        revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs",
        inventoryAccountId: "acc-inv",
        etaCodeType: "GPC",
        etaItemCode: "EGS1000000",
        gpcCode: "10000000",
      },
      repo,
    );

    const cleared = await updateItem(
      "itm-1",
      {
        nameEn: null,
        categoryId: null,
        brandId: null,
        description: null,
        defaultSupplierId: null,
        seasonId: null,
        costPrice: null,
        reorderPoint: null,
        imageAttachmentId: null,
        reorderQty: null,
        revenueAccountId: null,
        cogsAccountId: null,
        inventoryAccountId: null,
        etaCodeType: null,
        etaItemCode: null,
        gpcCode: null,
      },
      repo,
    );

    expect(cleared.nameEn).toBeNull();
    expect(cleared.categoryId).toBeNull();
    expect(cleared.brandId).toBeNull();
    expect(cleared.description).toBeNull();
    expect(cleared.defaultSupplierId).toBeNull();
    expect(cleared.seasonId).toBeNull();
    expect(cleared.costPrice).toBeNull();
    expect(cleared.reorderPoint).toBeNull();
    expect(cleared.imageAttachmentId).toBeNull();
    expect(cleared.reorderQty).toBeNull();
    expect(cleared.revenueAccountId).toBeNull();
    expect(cleared.cogsAccountId).toBeNull();
    expect(cleared.inventoryAccountId).toBeNull();
    expect(cleared.etaCodeType).toBeNull();
    expect(cleared.etaItemCode).toBeNull();
    expect(cleared.gpcCode).toBeNull();
  });
});
