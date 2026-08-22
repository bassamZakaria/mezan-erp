import { describe, it, expect } from "vitest";
import { Money, Qty } from "@mezan/domain";
// promotions is not yet re-exported from @mezan/domain's barrel (integrated
// centrally later), so this reaches the domain module directly.
import { createPromotion, updatePromotion } from "@mezan/domain";
import { createSqlitePromotionStore } from "./promotion-store.js";

const basePercentage = {
  id: "p1",
  code: "SUMMER10",
  nameAr: "خصم الصيف",
  type: "percentage" as const,
  percentValue: 10,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  createdAt: "2026-05-01T00:00:00.000Z",
};

describe("SqlitePromotionRepository", () => {
  it("creates and retrieves a promotion by id", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion(basePercentage, repo);
      const reloaded = await repo.findById("p1");
      expect(reloaded).toMatchObject({
        id: "p1",
        code: "SUMMER10",
        priority: 0,
        type: "percentage",
        percentValue: 10,
        active: true,
        requiresCoupon: false,
      });
      expect(reloaded?.amountValue).toBeNull();
      expect(reloaded?.bundleComponents).toEqual([]);
      expect(await repo.findById("nope")).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips scope ids and money fields", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion(
        {
          ...basePercentage,
          id: "p2",
          code: "ITEMS-A",
          scope: { type: "item", ids: ["item-1", "item-2"] },
          minInvoiceValue: Money.fromMajor("250.50"),
        },
        repo,
      );
      const reloaded = await repo.findById("p2");
      expect(reloaded?.scope).toEqual({ type: "item", ids: ["item-1", "item-2"] });
      expect(reloaded?.minInvoiceValue?.toString()).toBe("250.500000");
    } finally {
      repo.close();
    }
  });

  it("round-trips the day/hour restriction", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion(
        {
          ...basePercentage,
          id: "p3",
          code: "WEEKEND",
          dayHourRestriction: { days: [5, 6], startHour: 18, endHour: 23 },
        },
        repo,
      );
      const reloaded = await repo.findById("p3");
      expect(reloaded?.dayHourRestriction).toEqual({ days: [5, 6], startHour: 18, endHour: 23 });
    } finally {
      repo.close();
    }
  });

  it("returns null for a promotion with no day/hour restriction (not the string 'null')", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion(basePercentage, repo);
      const reloaded = await repo.findById("p1");
      expect(reloaded?.dayHourRestriction).toBeNull();
    } finally {
      repo.close();
    }
  });

  it("round-trips bundle components on create and on update", async () => {
    const repo = createSqlitePromotionStore();
    try {
      const created = await createPromotion(
        {
          ...basePercentage,
          id: "p4",
          code: "BUNDLE1",
          type: "bundle",
          percentValue: null,
          amountValue: Money.fromMajor("100.00"),
          bundleComponents: [
            { itemId: "X", qty: Qty.fromMajor("1") },
            { itemId: "Y", qty: Qty.fromMajor("2.5") },
          ],
        },
        repo,
      );
      const reloaded = await repo.findById("p4");
      expect(reloaded?.bundleComponents).toEqual([
        { itemId: "X", qty: expect.objectContaining({ scaled: 1_000_000n }) },
        { itemId: "Y", qty: expect.objectContaining({ scaled: 2_500_000n }) },
      ]);

      await updatePromotion(
        "p4",
        { bundleComponents: [{ itemId: "Z", qty: Qty.fromMajor("3") }] },
        repo,
      );
      const afterUpdate = await repo.findById("p4");
      expect(afterUpdate?.bundleComponents).toEqual([{ itemId: "Z", qty: expect.objectContaining({ scaled: 3_000_000n }) }]);
      expect(created.id).toBe("p4");
    } finally {
      repo.close();
    }
  });

  it("update() persists a full replace (e.g. deactivation)", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion(basePercentage, repo);
      await updatePromotion("p1", { active: false }, repo);
      expect((await repo.findById("p1"))?.active).toBe(false);
    } finally {
      repo.close();
    }
  });

  it("list() returns every persisted promotion, ordered by createdAt", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion({ ...basePercentage, id: "p1", code: "A", createdAt: "2026-01-02T00:00:00.000Z" }, repo);
      await createPromotion({ ...basePercentage, id: "p2", code: "B", createdAt: "2026-01-01T00:00:00.000Z" }, repo);
      const all = await repo.list();
      expect(all.map((p) => p.code)).toEqual(["B", "A"]);
    } finally {
      repo.close();
    }
  });

  it("list({ active: true|false }) filters correctly", async () => {
    const repo = createSqlitePromotionStore();
    try {
      await createPromotion({ ...basePercentage, id: "p1", code: "A" }, repo);
      await createPromotion({ ...basePercentage, id: "p2", code: "B", active: false }, repo);

      const activeOnly = await repo.list({ active: true });
      expect(activeOnly.map((p) => p.code)).toEqual(["A"]);

      const inactiveOnly = await repo.list({ active: false });
      expect(inactiveOnly.map((p) => p.code)).toEqual(["B"]);

      const all = await repo.list();
      expect(all).toHaveLength(2);
    } finally {
      repo.close();
    }
  });
});
