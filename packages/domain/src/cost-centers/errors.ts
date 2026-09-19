/** Raised when a cost-center code already exists (codes are unique across cost centers). */
export class DuplicateCostCenterCodeError extends Error {
  readonly code = "DUPLICATE_COST_CENTER_CODE";
  readonly messageEn: string;
  constructor(readonly costCenterCode: string) {
    super(`كود مركز التكلفة "${costCenterCode}" مستخدم من قبل.`);
    this.messageEn = `Cost center code "${costCenterCode}" already exists.`;
    this.name = "DuplicateCostCenterCodeError";
  }
}

/** Raised when an operation references a cost-center id that does not exist. */
export class CostCenterNotFoundError extends Error {
  readonly code = "COST_CENTER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly costCenterId: string) {
    super(`مركز التكلفة "${costCenterId}" غير موجود.`);
    this.messageEn = `Cost center "${costCenterId}" was not found.`;
    this.name = "CostCenterNotFoundError";
  }
}

/** Raised when a chosen parent cost center does not exist. */
export class InvalidParentCostCenterError extends Error {
  readonly code = "INVALID_PARENT_COST_CENTER";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidParentCostCenterError";
  }
}

/** Raised when reparenting a cost center would create a cycle in the hierarchy. */
export class CircularParentCostCenterError extends Error {
  readonly code = "CIRCULAR_PARENT_COST_CENTER";
  readonly messageEn: string;
  constructor(readonly costCenterId: string) {
    super(`تعيين هذا المركز الأصل سيجعل مركز التكلفة "${costCenterId}" سلفاً لنفسه.`);
    this.messageEn = `Setting this parent would make cost center "${costCenterId}" its own ancestor.`;
    this.name = "CircularParentCostCenterError";
  }
}
