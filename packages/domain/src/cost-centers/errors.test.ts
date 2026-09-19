import { describe, it, expect } from "vitest";
import {
  DuplicateCostCenterCodeError,
  CostCenterNotFoundError,
  InvalidParentCostCenterError,
  CircularParentCostCenterError,
} from "./errors.js";

describe("cost-centers errors", () => {
  it("DuplicateCostCenterCodeError carries the code and a descriptive message", () => {
    const err = new DuplicateCostCenterCodeError("CC-001");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("DuplicateCostCenterCodeError");
    expect(err.code).toBe("DUPLICATE_COST_CENTER_CODE");
    expect(err.costCenterCode).toBe("CC-001");
    expect(err.message).toBe('كود مركز التكلفة "CC-001" مستخدم من قبل.');
    expect(err.messageEn).toBe('Cost center code "CC-001" already exists.');
  });

  it("CostCenterNotFoundError carries the missing id", () => {
    const err = new CostCenterNotFoundError("cc-1");
    expect(err.name).toBe("CostCenterNotFoundError");
    expect(err.code).toBe("COST_CENTER_NOT_FOUND");
    expect(err.costCenterId).toBe("cc-1");
    expect(err.message).toBe('مركز التكلفة "cc-1" غير موجود.');
    expect(err.messageEn).toBe('Cost center "cc-1" was not found.');
  });

  it("InvalidParentCostCenterError carries a free-form message and its English counterpart", () => {
    const err = new InvalidParentCostCenterError("المركز الأصل غير موجود.", "Parent does not exist.");
    expect(err.name).toBe("InvalidParentCostCenterError");
    expect(err.code).toBe("INVALID_PARENT_COST_CENTER");
    expect(err.message).toBe("المركز الأصل غير موجود.");
    expect(err.messageEn).toBe("Parent does not exist.");
  });

  it("CircularParentCostCenterError carries the cost center id", () => {
    const err = new CircularParentCostCenterError("cc-1");
    expect(err.name).toBe("CircularParentCostCenterError");
    expect(err.code).toBe("CIRCULAR_PARENT_COST_CENTER");
    expect(err.costCenterId).toBe("cc-1");
    expect(err.message).toBe('تعيين هذا المركز الأصل سيجعل مركز التكلفة "cc-1" سلفاً لنفسه.');
    expect(err.messageEn).toBe('Setting this parent would make cost center "cc-1" its own ancestor.');
  });
});
