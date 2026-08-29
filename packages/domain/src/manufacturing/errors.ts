/** Typed errors for the manufacturing module (docs/archive/catalog/07). Each carries a
 *  stable machine `code` the API maps to an HTTP status. */

export class BomNotFoundError extends Error {
  readonly code = "BOM_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Bill of materials "${id}" was not found.`);
    this.name = "BomNotFoundError";
  }
}

export class WorkOrderNotFoundError extends Error {
  readonly code = "WORK_ORDER_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Work order "${id}" was not found.`);
    this.name = "WorkOrderNotFoundError";
  }
}

export class ConfigurableProductNotFoundError extends Error {
  readonly code = "CONFIGURABLE_PRODUCT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Configurable product "${id}" was not found.`);
    this.name = "ConfigurableProductNotFoundError";
  }
}

export class ConfigInstanceNotFoundError extends Error {
  readonly code = "CONFIG_INSTANCE_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Custom manufacturing order "${id}" was not found.`);
    this.name = "ConfigInstanceNotFoundError";
  }
}

export class DuplicateManufacturingDocumentError extends Error {
  readonly code = "DUPLICATE_MANUFACTURING_DOCUMENT";
  constructor(readonly id: string) {
    super(`A manufacturing document with id "${id}" already exists.`);
    this.name = "DuplicateManufacturingDocumentError";
  }
}

export class InvalidManufacturingDocumentError extends Error {
  readonly code = "INVALID_MANUFACTURING_DOCUMENT";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid manufacturing document: ${reasons.join("; ")}`);
    this.name = "InvalidManufacturingDocumentError";
  }
}

/**
 * A work-order action was attempted from the wrong stage (docs/archive/catalog/07 — the
 * 4-stage machine بدء العمل → صرف المواد → استلام المنتج → إكمال).
 */
export class WorkOrderStageError extends Error {
  readonly code = "WORK_ORDER_STAGE_INVALID";
  constructor(
    readonly action: string,
    readonly stage: string,
  ) {
    super(`Action "${action}" is not allowed while the work order is at stage "${stage}".`);
    this.name = "WorkOrderStageError";
  }
}

/** A formula was syntactically invalid (PARSE) or failed at evaluation (EVAL). */
export class FormulaError extends Error {
  readonly code: "MANUFACTURING_FORMULA_PARSE" | "MANUFACTURING_FORMULA_EVAL";
  constructor(
    readonly phase: "PARSE" | "EVAL",
    message: string,
  ) {
    super(`Formula ${phase === "PARSE" ? "parse" : "evaluation"} error: ${message}`);
    this.name = "FormulaError";
    this.code = phase === "PARSE" ? "MANUFACTURING_FORMULA_PARSE" : "MANUFACTURING_FORMULA_EVAL";
  }
}
