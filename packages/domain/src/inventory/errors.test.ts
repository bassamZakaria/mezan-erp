import { describe, it, expect } from "vitest";
import { Qty } from "../money/index.js";
import {
  AttributeInUseError,
  AttributeNotFoundError,
  AttributeValueInUseError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  DuplicateProductTemplateCodeError,
  DuplicateWritedownPeriodError,
  EmptyVariantSelectionError,
  ExpiredStockError,
  UncostedDeficitIssueError,
  InvalidProductTemplateError,
  InvalidStockMovementError,
  InvalidVariantSelectionError,
  NegativeStockError,
  NoAttributesDefinedError,
  NoSlowMovingStockError,
  ProductTemplateNotFoundError,
  SameWarehouseTransferError,
  WritedownRunNotDraftError,
  WritedownRunNotFoundError,
} from "./errors.js";

describe("NegativeStockError", () => {
  it("carries the position and the exact numbers, in Arabic", () => {
    const err = new NegativeStockError("item-1", "wh-1", Qty.fromMajor("5"), Qty.fromMajor("8"));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NegativeStockError");
    expect(err.code).toBe("NEGATIVE_STOCK");
    expect(err.itemId).toBe("item-1");
    expect(err.warehouseId).toBe("wh-1");
    expect(err.onHand.toString()).toBe("5.000000");
    expect(err.requested.toString()).toBe("8.000000");
    expect(err.message).toContain("8.000000");
    expect(err.message).toContain("item-1");
    expect(err.message).toContain("wh-1");
    expect(err.message).toContain("5.000000");
    expect(err.message).toContain("سالباً");
  });
});

describe("ExpiredStockError", () => {
  it("includes the batch number when given", () => {
    const err = new ExpiredStockError("item-1", "wh-1", "B-100", "2026-01-01");
    expect(err.code).toBe("EXPIRED_STOCK");
    expect(err.batchNo).toBe("B-100");
    expect(err.message).toContain("التشغيلة \"B-100\"");
    expect(err.message).toContain("2026-01-01");
  });

  it("shows the names it is given and keeps the ids as fields", () => {
    const labels = { item: "P-001 - باراسيتامول", warehouse: "المخزن الرئيسي" };
    const expired = new ExpiredStockError("item-1", "wh-1", null, "2026-01-01", labels);
    expect(expired.message).toContain('الصنف "P-001 - باراسيتامول" في المستودع "المخزن الرئيسي"');
    expect(expired.message).not.toContain("item-1");
    expect([expired.itemId, expired.warehouseId]).toEqual(["item-1", "wh-1"]);
    expect(new NegativeStockError("item-1", "wh-1", Qty.zero(), Qty.fromMajor("1"), labels).message).toContain('الصنف "P-001 - باراسيتامول" من المستودع "المخزن الرئيسي"');
    expect(new UncostedDeficitIssueError("item-1", "wh-1", Qty.fromMajor("1"), labels).message).toContain('الصنف "P-001 - باراسيتامول" من المستودع "المخزن الرئيسي"');
  });

  it("omits the batch clause entirely when there is no batch", () => {
    const err = new ExpiredStockError("item-1", "wh-1", null, "2026-01-01");
    expect(err.batchNo).toBeNull();
    expect(err.message).not.toContain("التشغيلة");
  });
});

describe("InvalidStockMovementError", () => {
  it("joins multiple reasons with the Arabic separator", () => {
    const err = new InvalidStockMovementError(["السبب الأول", "السبب الثاني"]);
    expect(err.code).toBe("INVALID_STOCK_MOVEMENT");
    expect(err.message).toBe("حركة مخزون غير صالحة: السبب الأول؛ السبب الثاني");
  });

  it("handles a single reason with no separator", () => {
    const err = new InvalidStockMovementError(["سبب واحد"]);
    expect(err.message).toBe("حركة مخزون غير صالحة: سبب واحد");
  });
});

describe("SameWarehouseTransferError", () => {
  it("names the offending warehouse", () => {
    const err = new SameWarehouseTransferError("wh-1");
    expect(err.code).toBe("SAME_WAREHOUSE_TRANSFER");
    expect(err.warehouseId).toBe("wh-1");
    expect(err.message).toContain("wh-1");
  });
});

describe("write-down run errors", () => {
  it("WritedownRunNotFoundError names the run id", () => {
    const err = new WritedownRunNotFoundError("run-1");
    expect(err.code).toBe("WRITEDOWN_RUN_NOT_FOUND");
    expect(err.runId).toBe("run-1");
    expect(err.message).toContain("run-1");
  });

  it("WritedownRunNotDraftError names the current status", () => {
    const err = new WritedownRunNotDraftError("run-1", "posted");
    expect(err.code).toBe("WRITEDOWN_RUN_NOT_DRAFT");
    expect(err.status).toBe("posted");
    expect(err.message).toContain("مُرحَّل");
    expect(err.messageEn).toContain("posted");
  });

  it("DuplicateWritedownPeriodError includes the warehouse clause only when scoped", () => {
    const scoped = new DuplicateWritedownPeriodError("2026-03", "wh-1");
    expect(scoped.message).toContain("وللمستودع \"wh-1\"");
    const unscoped = new DuplicateWritedownPeriodError("2026-03", null);
    expect(unscoped.message).not.toContain("وللمستودع");
    expect(unscoped.warehouseId).toBeNull();
  });

  it("NoSlowMovingStockError names the period", () => {
    const err = new NoSlowMovingStockError("2026-03");
    expect(err.code).toBe("NO_SLOW_MOVING_STOCK");
    expect(err.message).toContain("2026-03");
  });
});

describe("product-template errors", () => {
  it("DuplicateProductTemplateCodeError names the code", () => {
    const err = new DuplicateProductTemplateCodeError("TSHIRT");
    expect(err.code).toBe("DUPLICATE_PRODUCT_TEMPLATE_CODE");
    expect(err.templateCode).toBe("TSHIRT");
    expect(err.message).toContain("TSHIRT");
  });

  it("InvalidProductTemplateError joins reasons with the Arabic comma", () => {
    const err = new InvalidProductTemplateError(["كود القالب مطلوب", "اسم المنتج مطلوب"]);
    expect(err.reasons).toEqual(["كود القالب مطلوب", "اسم المنتج مطلوب"]);
    expect(err.message).toBe("كود القالب مطلوب، اسم المنتج مطلوب");
  });

  it("ProductTemplateNotFoundError names the template id", () => {
    const err = new ProductTemplateNotFoundError("t1");
    expect(err.code).toBe("PRODUCT_TEMPLATE_NOT_FOUND");
    expect(err.message).toContain("t1");
  });

  it("AttributeNotFoundError names both the template and the attribute", () => {
    const err = new AttributeNotFoundError("t1", "a1");
    expect(err.templateId).toBe("t1");
    expect(err.attributeId).toBe("a1");
    expect(err.message).toContain("a1");
    expect(err.message).toContain("t1");
  });

  it("DuplicateAttributeNameError and DuplicateAttributeValueError name what collided", () => {
    expect(new DuplicateAttributeNameError("اللون").message).toContain("اللون");
    expect(new DuplicateAttributeValueError("أحمر").message).toContain("أحمر");
  });

  it("AttributeInUseError and AttributeValueInUseError carry the variant count", () => {
    const inUse = new AttributeInUseError("a1", 3);
    expect(inUse.variantCount).toBe(3);
    expect(inUse.message).toContain("3");

    const valueInUse = new AttributeValueInUseError("a1", "أحمر", 2);
    expect(valueInUse.variantCount).toBe(2);
    expect(valueInUse.message).toContain("أحمر");
    expect(valueInUse.message).toContain("2");
  });

  it("NoAttributesDefinedError and EmptyVariantSelectionError name the template", () => {
    expect(new NoAttributesDefinedError("t1").message).toContain("t1");
    expect(new EmptyVariantSelectionError("t1").message).toContain("t1");
  });

  it("InvalidVariantSelectionError joins reasons with the Arabic comma", () => {
    const err = new InvalidVariantSelectionError(["القيمة مفقودة للخاصية \"اللون\""]);
    expect(err.reasons).toHaveLength(1);
    expect(err.message).toBe('القيمة مفقودة للخاصية "اللون"');
  });
});

describe("every error is a real Error subclass with a stable name", () => {
  it.each([
    new NegativeStockError("i", "w", Qty.zero(), Qty.zero()),
    new ExpiredStockError("i", "w", null, "2026-01-01"),
    new InvalidStockMovementError(["x"]),
    new SameWarehouseTransferError("w"),
    new WritedownRunNotFoundError("r"),
    new WritedownRunNotDraftError("r", "posted"),
    new DuplicateWritedownPeriodError("2026-03", null),
    new NoSlowMovingStockError("2026-03"),
    new DuplicateProductTemplateCodeError("C"),
    new InvalidProductTemplateError(["x"]),
    new ProductTemplateNotFoundError("t"),
    new AttributeNotFoundError("t", "a"),
    new DuplicateAttributeNameError("n"),
    new DuplicateAttributeValueError("v"),
    new AttributeInUseError("a", 1),
    new AttributeValueInUseError("a", "v", 1),
    new NoAttributesDefinedError("t"),
    new EmptyVariantSelectionError("t"),
    new InvalidVariantSelectionError(["x"]),
  ])("$name is thrown and caught as an Error with a non-empty message", (err) => {
    expect(err).toBeInstanceOf(Error);
    expect(err.name.length).toBeGreaterThan(0);
    expect(err.message.length).toBeGreaterThan(0);
    expect(typeof err.code).toBe("string");
  });
});
