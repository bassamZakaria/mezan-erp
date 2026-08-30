import { describe, it, expect } from "vitest";
import {
  createItemSpecification,
  updateItemSpecification,
  deleteItemSpecification,
  type ItemSpecification,
  type ItemSpecificationRepository,
  type ItemSpecificationUsageCounter,
} from "./item-specification.js";
import {
  DuplicateItemSpecificationCodeError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  ItemSpecificationNotFoundError,
} from "./errors.js";

class InMemorySpecifications implements ItemSpecificationRepository {
  readonly rows = new Map<string, ItemSpecification>();
  async findByCode(code: string): Promise<ItemSpecification | null> {
    return this.rows.get(code) ?? null;
  }
  async list(): Promise<ItemSpecification[]> {
    return [...this.rows.values()];
  }
  async create(specification: ItemSpecification): Promise<void> {
    this.rows.set(specification.code, specification);
  }
  async update(specification: ItemSpecification): Promise<void> {
    this.rows.set(specification.code, specification);
  }
  async delete(code: string): Promise<void> {
    this.rows.delete(code);
  }
}

class FixedUsageCounter implements ItemSpecificationUsageCounter {
  constructor(private readonly counts: Record<string, number> = {}) {}
  async count(code: string): Promise<number> {
    return this.counts[code] ?? 0;
  }
}

describe("createItemSpecification", () => {
  it("creates a select-list specification, uppercasing the code and trimming allowed values", async () => {
    const repo = new InMemorySpecifications();
    const spec = await createItemSpecification(
      { code: "color", nameAr: "اللون", type: "select", values: [" أحمر ", "أخضر"], filterable: true },
      repo,
    );
    expect(spec.code).toBe("COLOR");
    expect(spec.values).toEqual(["أحمر", "أخضر"]);
    expect(spec.filterable).toBe(true);
    expect(spec.status).toBe("active");
  });

  it("creates a number specification with a unit label", async () => {
    const repo = new InMemorySpecifications();
    const spec = await createItemSpecification({ code: "WEIGHT", nameAr: "الوزن", type: "number", unit: "كجم" }, repo);
    expect(spec.unit).toBe("كجم");
    expect(spec.values).toEqual([]);
  });

  it("creates a text specification with neither values nor a unit", async () => {
    const repo = new InMemorySpecifications();
    const spec = await createItemSpecification({ code: "NOTE", nameAr: "ملاحظة", type: "text" }, repo);
    expect(spec.unit).toBeNull();
    expect(spec.values).toEqual([]);
  });

  it("rejects a select specification with no allowed values", async () => {
    const repo = new InMemorySpecifications();
    await expect(createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select" }, repo)).rejects.toThrow(
      InvalidItemSpecificationError,
    );
  });

  it("rejects duplicate allowed values on a select specification", async () => {
    const repo = new InMemorySpecifications();
    await expect(
      createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select", values: ["أحمر", "أحمر"] }, repo),
    ).rejects.toThrow(InvalidItemSpecificationError);
  });

  it("rejects a select specification carrying a unit", async () => {
    const repo = new InMemorySpecifications();
    await expect(
      createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select", values: ["أحمر"], unit: "كجم" }, repo),
    ).rejects.toThrow(InvalidItemSpecificationError);
  });

  it("rejects a number specification carrying allowed values", async () => {
    const repo = new InMemorySpecifications();
    await expect(
      createItemSpecification({ code: "WEIGHT", nameAr: "الوزن", type: "number", values: ["1"] }, repo),
    ).rejects.toThrow(InvalidItemSpecificationError);
  });

  it("rejects a text specification carrying a unit", async () => {
    const repo = new InMemorySpecifications();
    await expect(createItemSpecification({ code: "NOTE", nameAr: "ملاحظة", type: "text", unit: "كجم" }, repo)).rejects.toThrow(
      InvalidItemSpecificationError,
    );
  });

  it("rejects an invalid code shape", async () => {
    const repo = new InMemorySpecifications();
    await expect(createItemSpecification({ code: "bad code!", nameAr: "x", type: "text" }, repo)).rejects.toThrow(
      InvalidItemSpecificationError,
    );
  });

  it("rejects a blank Arabic name", async () => {
    const repo = new InMemorySpecifications();
    await expect(createItemSpecification({ code: "NOTE", nameAr: "  ", type: "text" }, repo)).rejects.toThrow(
      InvalidItemSpecificationError,
    );
  });

  it("rejects a duplicate specification code", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "NOTE", nameAr: "ملاحظة", type: "text" }, repo);
    await expect(createItemSpecification({ code: "NOTE", nameAr: "نسخة", type: "text" }, repo)).rejects.toThrow(
      DuplicateItemSpecificationCodeError,
    );
  });
});

describe("updateItemSpecification", () => {
  it("applies a patch while code and type stay immutable", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select", values: ["أحمر"] }, repo);
    const updated = await updateItemSpecification("COLOR", { values: ["أحمر", "أخضر"], filterable: true }, repo);
    expect(updated.code).toBe("COLOR");
    expect(updated.type).toBe("select");
    expect(updated.values).toEqual(["أحمر", "أخضر"]);
    expect(updated.filterable).toBe(true);
  });

  it("404s updating an unknown specification", async () => {
    const repo = new InMemorySpecifications();
    await expect(updateItemSpecification("NOPE", { nameAr: "x" }, repo)).rejects.toThrow(ItemSpecificationNotFoundError);
  });

  it("re-validates on edit: rejects emptying a select's allowed values", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select", values: ["أحمر"] }, repo);
    await expect(updateItemSpecification("COLOR", { values: [] }, repo)).rejects.toThrow(InvalidItemSpecificationError);
  });

  it("deactivates via status", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "NOTE", nameAr: "ملاحظة", type: "text" }, repo);
    const updated = await updateItemSpecification("NOTE", { status: "inactive" }, repo);
    expect(updated.status).toBe("inactive");
  });
});

describe("deleteItemSpecification", () => {
  it("deletes a specification nothing binds to", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "NOTE", nameAr: "ملاحظة", type: "text" }, repo);
    await deleteItemSpecification("NOTE", repo, new FixedUsageCounter());
    expect(await repo.findByCode("NOTE")).toBeNull();
  });

  it("404s deleting an unknown specification", async () => {
    const repo = new InMemorySpecifications();
    await expect(deleteItemSpecification("NOPE", repo, new FixedUsageCounter())).rejects.toThrow(
      ItemSpecificationNotFoundError,
    );
  });

  it("refuses deleting a specification still referenced by product templates", async () => {
    const repo = new InMemorySpecifications();
    await createItemSpecification({ code: "COLOR", nameAr: "اللون", type: "select", values: ["أحمر"] }, repo);
    await expect(deleteItemSpecification("COLOR", repo, new FixedUsageCounter({ COLOR: 3 }))).rejects.toThrow(
      ItemSpecificationInUseError,
    );
    expect(await repo.findByCode("COLOR")).not.toBeNull();
  });
});
