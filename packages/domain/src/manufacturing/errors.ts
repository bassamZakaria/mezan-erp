/** Typed errors for the manufacturing module (docs/archive/catalog/07). Each carries a
 *  stable machine `code` the API maps to an HTTP status. */

const WORK_ORDER_STAGE_AR: Readonly<Record<string, string>> = {
  not_started: "لم يبدأ",
  started: "بدء العمل",
  materials_issued: "صرف المواد",
  product_received: "استلام المنتج",
  completed: "مكتمل",
};

function workOrderStageAr(stage: string): string {
  return WORK_ORDER_STAGE_AR[stage] ?? stage;
}

/**
 * Translates the fixed set of English fragments `formula.ts` throws with into
 * Arabic, preserving any quoted identifier/value the fragment carries.
 * Falls back to the raw fragment for anything not in this list (there is no
 * open-ended user text here — every formula error comes from this file's own
 * parser/evaluator).
 */
function formulaFragmentAr(message: string): string {
  const quoted = (m: RegExpMatchArray) => m[1];
  let m: RegExpMatchArray | null;

  if (message === "division by zero") return "القسمة على صفر";
  if (message === "empty formula") return "الصيغة فارغة";
  if (message === "unexpected end of formula") return "نهاية غير متوقعة للصيغة";
  if (message === "expected )") return 'كان متوقعاً وجود ")"';
  if (message === "unreachable") return "حالة غير متوقعة في الصيغة";
  if (message === "min() needs at least one argument") return "الدالة min() تتطلب وسيطاً واحداً على الأقل";
  if (message === "max() needs at least one argument") return "الدالة max() تتطلب وسيطاً واحداً على الأقل";
  if (message === "round() expects 1 or 2 arguments") return "الدالة round() تتطلب وسيطاً واحداً أو وسيطين";
  if (message === "round() decimals must be an integer in [0, 6]") {
    return "عدد الخانات العشرية في round() يجب أن يكون عدداً صحيحاً بين 0 و 6";
  }

  if ((m = message.match(/^unexpected character "(.*)"$/))) return `حرف غير متوقع "${quoted(m)}"`;
  if ((m = message.match(/^unexpected token "(.*)"$/))) return `رمز غير متوقع "${quoted(m)}"`;
  if ((m = message.match(/^unknown function "(.*)"$/))) return `دالة غير معروفة "${quoted(m)}"`;
  if ((m = message.match(/^unknown variable "(.*)"$/))) return `متغيّر غير معروف "${quoted(m)}"`;
  if ((m = message.match(/^(.+)\(\) expects (\d+) argument\(s\), got (\d+)$/))) {
    return `الدالة ${m[1]}() تتطلب ${m[2]} وسيطاً، ووُرد ${m[3]}`;
  }

  return message;
}

export class BomNotFoundError extends Error {
  readonly code = "BOM_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`قائمة المواد "${id}" غير موجودة.`);
    this.messageEn = `Bill of materials "${id}" was not found.`;
    this.name = "BomNotFoundError";
  }
}

export class WorkOrderNotFoundError extends Error {
  readonly code = "WORK_ORDER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`أمر التصنيع "${id}" غير موجود.`);
    this.messageEn = `Work order "${id}" was not found.`;
    this.name = "WorkOrderNotFoundError";
  }
}

export class ConfigurableProductNotFoundError extends Error {
  readonly code = "CONFIGURABLE_PRODUCT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`المنتج القابل للتهيئة "${id}" غير موجود.`);
    this.messageEn = `Configurable product "${id}" was not found.`;
    this.name = "ConfigurableProductNotFoundError";
  }
}

export class ConfigInstanceNotFoundError extends Error {
  readonly code = "CONFIG_INSTANCE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`أمر التصنيع المخصص "${id}" غير موجود.`);
    this.messageEn = `Custom manufacturing order "${id}" was not found.`;
    this.name = "ConfigInstanceNotFoundError";
  }
}

export class DuplicateManufacturingDocumentError extends Error {
  readonly code = "DUPLICATE_MANUFACTURING_DOCUMENT";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`يوجد بالفعل مستند تصنيع بالمعرف "${id}".`);
    this.messageEn = `A manufacturing document with id "${id}" already exists.`;
    this.name = "DuplicateManufacturingDocumentError";
  }
}

export class InvalidManufacturingDocumentError extends Error {
  readonly code = "INVALID_MANUFACTURING_DOCUMENT";
  readonly messageEn: string;
  constructor(readonly reasons: readonly string[]) {
    super(`بيانات مستند التصنيع غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid manufacturing document: ${reasons.join("; ")}`;
    this.name = "InvalidManufacturingDocumentError";
  }
}

/**
 * A work-order action was attempted from the wrong stage (docs/archive/catalog/07 — the
 * 4-stage machine بدء العمل → صرف المواد → استلام المنتج → إكمال).
 */
export class WorkOrderStageError extends Error {
  readonly code = "WORK_ORDER_STAGE_INVALID";
  readonly messageEn: string;
  constructor(
    readonly action: string,
    readonly stage: string,
  ) {
    super(`لا يمكن تنفيذ الإجراء "${action}" وأمر التصنيع في مرحلة "${workOrderStageAr(stage)}".`);
    this.messageEn = `Action "${action}" is not allowed while the work order is at stage "${stage}".`;
    this.name = "WorkOrderStageError";
  }
}

/** A formula was syntactically invalid (PARSE) or failed at evaluation (EVAL). */
export class FormulaError extends Error {
  readonly code: "MANUFACTURING_FORMULA_PARSE" | "MANUFACTURING_FORMULA_EVAL";
  readonly messageEn: string;
  constructor(
    readonly phase: "PARSE" | "EVAL",
    message: string,
  ) {
    super(`خطأ ${phase === "PARSE" ? "تحليل" : "تقييم"} الصيغة: ${formulaFragmentAr(message)}`);
    this.messageEn = `Formula ${phase === "PARSE" ? "parse" : "evaluation"} error: ${message}`;
    this.name = "FormulaError";
    this.code = phase === "PARSE" ? "MANUFACTURING_FORMULA_PARSE" : "MANUFACTURING_FORMULA_EVAL";
  }
}
