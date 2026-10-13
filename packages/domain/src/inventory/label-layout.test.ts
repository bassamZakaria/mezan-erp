import { insertOnly } from "../records/test-helpers/insert-only.js";
import { describe, it, expect } from "vitest";
import {
  DuplicateLabelLayoutCodeError,
  InvalidLabelLayoutError,
  LabelLayoutNotFoundError,
  createLabelLayout,
  deleteLabelLayout,
  labelsPerPage,
  updateLabelLayout,
  type CreateLabelLayoutCommand,
  type LabelLayout,
  type LabelLayoutRepository,
} from "./label-layout.js";

class InMemoryLabelLayouts implements LabelLayoutRepository {
  private readonly rows = new Map<string, LabelLayout>();

  async list(): Promise<LabelLayout[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<LabelLayout | null> {
    return this.rows.get(id) ?? null;
  }
  async findByCode(code: string): Promise<LabelLayout | null> {
    for (const row of this.rows.values()) if (row.code === code) return row;
    return null;
  }
  async save(layout: LabelLayout): Promise<void> {
    this.rows.set(layout.id, layout);
  }
  async insert(layout: LabelLayout): Promise<void> {
    insertOnly(this.rows, layout.id, layout);
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

function command(overrides: Partial<CreateLabelLayoutCommand> = {}): CreateLabelLayoutCommand {
  return {
    id: "l1",
    code: "SHELF-A4",
    nameAr: "رف A4",
    columns: 3,
    rows: 8,
    labelWidthMm: 60,
    labelHeightMm: 30,
    ...overrides,
  };
}

describe("createLabelLayout", () => {
  it("materializes documented defaults for every omitted field", async () => {
    const repo = new InMemoryLabelLayouts();
    const layout = await createLabelLayout(command(), repo);
    expect(layout.pageSize).toBe("A4");
    expect(layout.columnGapMm).toBe(0);
    expect(layout.rowGapMm).toBe(0);
    expect(layout.marginBlockMm).toBe(0);
    expect(layout.marginInlineMm).toBe(0);
    expect(layout.showItemName).toBe(true);
    expect(layout.showItemCode).toBe(true);
    expect(layout.showPrice).toBe(true);
    expect(layout.showUnit).toBe(false);
    expect(layout.showBarcode).toBe(true);
    expect(layout.showBarcodeText).toBe(true);
    expect(layout.barcodeHeightMm).toBe(10);
    expect(layout.active).toBe(true);
    expect(await repo.findById("l1")).toEqual(layout);
  });

  it("rejects a duplicate code", async () => {
    const repo = new InMemoryLabelLayouts();
    await createLabelLayout(command({ id: "l1", code: "SHELF-A4" }), repo);
    await expect(createLabelLayout(command({ id: "l2", code: "SHELF-A4" }), repo)).rejects.toBeInstanceOf(DuplicateLabelLayoutCodeError);
  });

  it("rejects an invalid code pattern", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(createLabelLayout(command({ code: "shelf a4!" }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
  });

  it("rejects a non-integer or non-positive columns/rows", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(createLabelLayout(command({ columns: 0 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ columns: 2.5 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ rows: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
  });

  it("rejects non-positive label dimensions and negative gaps/margins/barcode height", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(createLabelLayout(command({ labelWidthMm: 0 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ labelHeightMm: -5 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ columnGapMm: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ rowGapMm: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ marginBlockMm: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ marginInlineMm: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    await expect(createLabelLayout(command({ barcodeHeightMm: -1 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
  });

  it("rejects a barcode taller than (or equal to) the label itself, only when showBarcode is on", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(
      createLabelLayout(command({ labelHeightMm: 20, barcodeHeightMm: 20, showBarcode: true }), repo),
    ).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    // the same geometry is fine once the barcode isn't shown.
    const layout = await createLabelLayout(command({ id: "l2", code: "OK", labelHeightMm: 20, barcodeHeightMm: 20, showBarcode: false }), repo);
    expect(layout.barcodeHeightMm).toBe(20);
  });

  it("rejects a grid that overflows the page's printable width or height", async () => {
    const repo = new InMemoryLabelLayouts();
    // A4 is 210mm wide; 4 columns of 60mm with no gap is 240mm — overflows.
    await expect(createLabelLayout(command({ columns: 4, labelWidthMm: 60 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    // A4 is 297mm tall; 12 rows of 30mm is 360mm — overflows.
    await expect(createLabelLayout(command({ rows: 12, labelHeightMm: 30 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
  });

  it("fits exactly at the page boundary (the accepted edge)", async () => {
    const repo = new InMemoryLabelLayouts();
    // A4 width 210mm: 3 columns * 70mm = 210mm exactly, no gaps/margins.
    const layout = await createLabelLayout(command({ id: "l1", code: "EXACT", columns: 3, labelWidthMm: 70, columnGapMm: 0, marginInlineMm: 0 }), repo);
    expect(layout.columns).toBe(3);
  });

  it("A5 uses its own smaller printable area", async () => {
    const repo = new InMemoryLabelLayouts();
    // A5 is 148mm wide; 3 columns of 60mm (180mm) overflows A5 but would fit A4.
    await expect(createLabelLayout(command({ pageSize: "A5", columns: 3, labelWidthMm: 60 }), repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
  });

  it("collects every violated rule in one error, not just the first", async () => {
    const repo = new InMemoryLabelLayouts();
    let caught: InvalidLabelLayoutError | undefined;
    await createLabelLayout(command({ code: "bad code!", columns: 0, labelWidthMm: -1 }), repo).catch((err) => {
      caught = err as InvalidLabelLayoutError;
    });
    expect(caught).toBeInstanceOf(InvalidLabelLayoutError);
    expect(caught!.reasons.length).toBeGreaterThan(1);
  });
});

describe("updateLabelLayout", () => {
  it("patches only the given fields, leaving the rest and the immutable code untouched", async () => {
    const repo = new InMemoryLabelLayouts();
    await createLabelLayout(command(), repo);
    const updated = await updateLabelLayout("l1", { nameAr: "رف A4 محدث", rows: 9 }, repo);
    expect(updated.nameAr).toBe("رف A4 محدث");
    expect(updated.rows).toBe(9);
    expect(updated.code).toBe("SHELF-A4");
    expect(updated.columns).toBe(3); // unchanged
  });

  it("rejects an update to an id that does not exist", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(updateLabelLayout("missing", { nameAr: "x" }, repo)).rejects.toBeInstanceOf(LabelLayoutNotFoundError);
  });

  it("re-validates the patched layout — an update that breaks page fit is rejected", async () => {
    const repo = new InMemoryLabelLayouts();
    await createLabelLayout(command(), repo);
    await expect(updateLabelLayout("l1", { columns: 10 }, repo)).rejects.toBeInstanceOf(InvalidLabelLayoutError);
    // the original layout is untouched by the rejected update.
    const stillOriginal = await repo.findById("l1");
    expect(stillOriginal!.columns).toBe(3);
  });
});

describe("deleteLabelLayout", () => {
  it("removes an existing layout", async () => {
    const repo = new InMemoryLabelLayouts();
    await createLabelLayout(command(), repo);
    await deleteLabelLayout("l1", repo);
    expect(await repo.findById("l1")).toBeNull();
  });

  it("rejects deleting an id that does not exist", async () => {
    const repo = new InMemoryLabelLayouts();
    await expect(deleteLabelLayout("missing", repo)).rejects.toBeInstanceOf(LabelLayoutNotFoundError);
  });
});

describe("labelsPerPage", () => {
  it("is columns × rows", async () => {
    const repo = new InMemoryLabelLayouts();
    const layout = await createLabelLayout(command({ columns: 3, rows: 8 }), repo);
    expect(labelsPerPage(layout)).toBe(24);
  });

  it("is zero-labels-per-page when either dimension is degenerate — unreachable via create, but the pure function still agrees", () => {
    expect(labelsPerPage({ columns: 0, rows: 5 } as LabelLayout)).toBe(0);
  });
});
