/** Errors raised by the landed-cost allocation math (docs/catalog/02 §"التكاليف الإضافية"). */

export class EmptyLandedCostTargetsError extends Error {
  readonly code = "EMPTY_LANDED_COST_TARGETS";
  constructor() {
    super("A landed-cost document needs at least one target invoice line to distribute cost onto.");
    this.name = "EmptyLandedCostTargetsError";
  }
}

/** Raised when every target's weight is zero (e.g. BY_QUANTITY with all-zero qty) — nothing to allocate onto. */
export class ZeroLandedCostWeightError extends Error {
  readonly code = "ZERO_LANDED_COST_WEIGHT";
  constructor(readonly method: string) {
    super(`Cannot distribute landed cost ${method}: every target line has a zero weight.`);
    this.name = "ZeroLandedCostWeightError";
  }
}
