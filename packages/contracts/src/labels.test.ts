import { describe, it, expect } from "vitest";
import { labelPageSizeSchema, labelLayoutSchema, createLabelLayoutSchema, updateLabelLayoutSchema } from "./labels.js";

describe("labelPageSizeSchema", () => {
  it("accepts A4 and A5", () => {
    expect(labelPageSizeSchema.safeParse("A4").success).toBe(true);
    expect(labelPageSizeSchema.safeParse("A5").success).toBe(true);
  });

  it("rejects a page size outside the enum", () => {
    expect(labelPageSizeSchema.safeParse("A3").success).toBe(false);
  });
});

describe("labelLayoutSchema", () => {
  const layout = {
    id: "layout-1",
    code: "SHELF-50",
    nameAr: "رف 50×25",
    pageSize: "A4" as const,
    columns: 3,
    rows: 8,
    labelWidthMm: 50,
    labelHeightMm: 25,
    columnGapMm: 2,
    rowGapMm: 2,
    marginBlockMm: 5,
    marginInlineMm: 5,
    showItemName: true,
    showItemCode: true,
    showPrice: true,
    showUnit: false,
    showBarcode: true,
    showBarcodeText: true,
    barcodeHeightMm: 10,
    active: true,
  };

  it("accepts a minimal valid layout and preserves every field verbatim", () => {
    const result = labelLayoutSchema.safeParse(layout);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(layout);
  });

  it("rejects a layout missing pageSize", () => {
    const { pageSize, ...rest } = layout;
    const result = labelLayoutSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("pageSize");
  });

  it("rejects a zero or negative labelWidthMm", () => {
    expect(labelLayoutSchema.safeParse({ ...layout, labelWidthMm: 0 }).success).toBe(false);
    expect(labelLayoutSchema.safeParse({ ...layout, labelWidthMm: -1 }).success).toBe(false);
  });

  it("rejects a negative columnGapMm", () => {
    const result = labelLayoutSchema.safeParse({ ...layout, columnGapMm: -1 });
    expect(result.success).toBe(false);
  });

  it("accepts a zero columnGapMm — gaps allow zero, unlike label dimensions", () => {
    const result = labelLayoutSchema.safeParse({ ...layout, columnGapMm: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects a zero or negative columns count", () => {
    expect(labelLayoutSchema.safeParse({ ...layout, columns: 0 }).success).toBe(false);
    expect(labelLayoutSchema.safeParse({ ...layout, columns: -1 }).success).toBe(false);
  });

  it("rejects a non-integer columns count", () => {
    const result = labelLayoutSchema.safeParse({ ...layout, columns: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe("createLabelLayoutSchema", () => {
  const create = {
    id: "layout-1",
    code: "SHELF-50",
    nameAr: "رف 50×25",
    columns: 3,
    rows: 8,
    labelWidthMm: 50,
    labelHeightMm: 25,
  };

  it("accepts a minimal valid payload with optional fields omitted", () => {
    const result = createLabelLayoutSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing rows", () => {
    const { rows, ...rest } = create;
    const result = createLabelLayoutSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("rows");
  });

  it("rejects a zero labelHeightMm", () => {
    const result = createLabelLayoutSchema.safeParse({ ...create, labelHeightMm: 0 });
    expect(result.success).toBe(false);
  });
});

describe("updateLabelLayoutSchema", () => {
  it("accepts an empty payload — every field is optional", () => {
    const result = updateLabelLayoutSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial payload with a single field", () => {
    const result = updateLabelLayoutSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ active: false });
  });

  it("strips id and code — both are immutable after creation, omitted from the update schema", () => {
    const result = updateLabelLayoutSchema.safeParse({ id: "layout-2", code: "NEW-CODE", active: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("id");
      expect(result.data).not.toHaveProperty("code");
    }
  });

  it("rejects a negative labelWidthMm when supplied", () => {
    const result = updateLabelLayoutSchema.safeParse({ labelWidthMm: -5 });
    expect(result.success).toBe(false);
  });
});
