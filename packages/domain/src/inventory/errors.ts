/** Errors raised by the stock-ledger / costing engine (docs/catalog/03). */

import { Qty } from "../money/index.js";

/**
 * Raised when an issue/transfer/OUT adjustment would drive on-hand stock below
 * zero and the tenant's `allowNegativeStock` policy is off (docs/catalog/09
 * §"سياسة المخزون"). Carries the numbers so the API can surface them.
 */
export class NegativeStockError extends Error {
  readonly code = "NEGATIVE_STOCK";
  constructor(
    readonly itemId: string,
    readonly warehouseId: string,
    readonly onHand: Qty,
    readonly requested: Qty,
  ) {
    super(
      `Issuing ${requested.toString()} of item "${itemId}" from warehouse "${warehouseId}" ` +
        `would drive on-hand (${onHand.toString()}) below zero; negative stock is disallowed.`,
    );
    this.name = "NegativeStockError";
  }
}

/** Raised when a movement/adjustment/transfer command fails structural validation. */
export class InvalidStockMovementError extends Error {
  readonly code = "INVALID_STOCK_MOVEMENT";
  constructor(reasons: readonly string[]) {
    super(`Invalid stock movement: ${reasons.join("; ")}`);
    this.name = "InvalidStockMovementError";
  }
}

/** Raised when a transfer names the same warehouse as source and destination. */
export class SameWarehouseTransferError extends Error {
  readonly code = "SAME_WAREHOUSE_TRANSFER";
  constructor(readonly warehouseId: string) {
    super(`A transfer's source and destination warehouse must differ ("${warehouseId}").`);
    this.name = "SameWarehouseTransferError";
  }
}
