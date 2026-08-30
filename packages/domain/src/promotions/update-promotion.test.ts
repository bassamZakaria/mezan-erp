import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { createPromotion, type CreatePromotionCommand } from "./create-promotion.js";
import { updatePromotion } from "./update-promotion.js";
import { DuplicatePromotionError, InvalidPromotionError, PromotionNotFoundError } from "./errors.js";
import { InMemoryPromotionRepository } from "./test-helpers/in-memory-promotion-repository.js";

const baseCommand: CreatePromotionCommand = {
  id: "promo-1",
  code: "SUMMER10",
  nameAr: "خصم الصيف",
  type: "percentage",
  percentValue: 10,
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  createdAt: "2026-05-01T00:00:00.000Z",
  requiresCoupon: true,
  active: true,
};

async function seeded() {
  const repo = new InMemoryPromotionRepository();
  await createPromotion(baseCommand, repo);
  return repo;
}

describe("updatePromotion", () => {
  it("throws PromotionNotFoundError for an unknown id", async () => {
    const repo = await seeded();
    await expect(updatePromotion("missing", { nameAr: "x" }, repo)).rejects.toBeInstanceOf(PromotionNotFoundError);
  });

  it("applies a patch over the current record, leaving unspecified fields untouched", async () => {
    const repo = await seeded();
    const updated = await updatePromotion("promo-1", { priority: 7 }, repo);
    expect(updated.priority).toBe(7);
    expect(updated.code).toBe("SUMMER10");
    expect(updated.percentValue).toBe(10);
  });

  it("explicitly setting active:false and requiresCoupon:false actually takes effect", async () => {
    const repo = await seeded();
    const updated = await updatePromotion("promo-1", { active: false, requiresCoupon: false }, repo);
    expect(updated.active).toBe(false);
    expect(updated.requiresCoupon).toBe(false);
  });

  it("an explicit null clears an optional field (percentValue) rather than falling back to the prior value", async () => {
    const repo = await seeded();
    const updated = await updatePromotion(
      "promo-1",
      { type: "fixed_amount", percentValue: null, amountValue: Money.fromMajor("25") },
      repo,
    );
    expect(updated.percentValue).toBeNull();
    expect(updated.amountValue?.toString()).toBe("25.000000");
  });

  it("rejects renaming the code to one already used by another promotion", async () => {
    const repo = await seeded();
    await createPromotion({ ...baseCommand, id: "promo-2", code: "WINTER10" }, repo);
    await expect(updatePromotion("promo-1", { code: "WINTER10" }, repo)).rejects.toBeInstanceOf(DuplicatePromotionError);
  });

  it("allows renaming a promotion's code to its own current code (no-op rename)", async () => {
    const repo = await seeded();
    const updated = await updatePromotion("promo-1", { code: "SUMMER10" }, repo);
    expect(updated.code).toBe("SUMMER10");
  });

  it("re-validates the merged result — a patch that produces an invalid combination is rejected", async () => {
    const repo = await seeded();
    // Switching to bundle without supplying components is invalid even though
    // neither field alone looks wrong.
    await expect(updatePromotion("promo-1", { type: "bundle", percentValue: null, amountValue: Money.fromMajor("10") }, repo)).rejects.toBeInstanceOf(
      InvalidPromotionError,
    );
  });

  it("leaves the stored promotion unchanged when the update is rejected", async () => {
    const repo = await seeded();
    await expect(updatePromotion("promo-1", { startDate: "2027-01-01", endDate: "2026-01-01" }, repo)).rejects.toBeInstanceOf(
      InvalidPromotionError,
    );
    const stillOriginal = await repo.findById("promo-1");
    expect(stillOriginal?.startDate).toBe("2026-06-01");
  });

  it("persists the update through repo.update", async () => {
    const repo = await seeded();
    await updatePromotion("promo-1", { nameAr: "خصم الصيف الكبير" }, repo);
    expect((await repo.findById("promo-1"))?.nameAr).toBe("خصم الصيف الكبير");
  });
});
