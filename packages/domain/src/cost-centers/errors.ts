/** Raised when a cost-center code already exists (codes are unique across cost centers). */
export class DuplicateCostCenterCodeError extends Error {
  readonly code = "DUPLICATE_COST_CENTER_CODE";
  constructor(readonly costCenterCode: string) {
    super(`Cost center code "${costCenterCode}" already exists.`);
    this.name = "DuplicateCostCenterCodeError";
  }
}

/** Raised when an operation references a cost-center id that does not exist. */
export class CostCenterNotFoundError extends Error {
  readonly code = "COST_CENTER_NOT_FOUND";
  constructor(readonly costCenterId: string) {
    super(`Cost center "${costCenterId}" was not found.`);
    this.name = "CostCenterNotFoundError";
  }
}

/** Raised when a chosen parent cost center does not exist. */
export class InvalidParentCostCenterError extends Error {
  readonly code = "INVALID_PARENT_COST_CENTER";
  constructor(message: string) {
    super(message);
    this.name = "InvalidParentCostCenterError";
  }
}

/** Raised when reparenting a cost center would create a cycle in the hierarchy. */
export class CircularParentCostCenterError extends Error {
  readonly code = "CIRCULAR_PARENT_COST_CENTER";
  constructor(readonly costCenterId: string) {
    super(`Setting this parent would make cost center "${costCenterId}" its own ancestor.`);
    this.name = "CircularParentCostCenterError";
  }
}
