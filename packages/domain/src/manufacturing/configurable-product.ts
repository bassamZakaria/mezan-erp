/**
 * المنتج القابل للتهيئة (Configurable Product) — a template product whose
 * materials, price, labour and overhead are computed from customer-entered
 * parameters (docs/catalog/07 §Configurable Products). Each config input is a
 * formula variable (e.g. `width`, `height`); material quantities, unit price,
 * labour and overhead are all sandboxed formulas over those variables (see
 * formula.ts — NO eval/Function). A التصنيع المخصص order (config-instance.ts)
 * evaluates this template against one spec.
 */

import { Money, Qty } from "../money/index.js";
import { extend } from "../inventory/index.js";
import { compileFormula, type FormulaScope } from "./formula.js";
import { grossUpForWaste } from "./bom.js";
import type { ActivationStatus, ItemPolicy, PricingMethod } from "./types.js";
import {
  ConfigurableProductNotFoundError,
  DuplicateManufacturingDocumentError,
  FormulaError,
  InvalidManufacturingDocumentError,
} from "./errors.js";

export interface ConfigInput {
  /** Formula variable id, e.g. `width` (المعرف للمعادلات). */
  readonly id: string;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly type: "number";
  readonly min: number | null;
  readonly max: number | null;
}

export interface MaterialFormula {
  readonly itemId: string;
  /** Quantity formula over the config-input variables, e.g. `2*(width+height)/100`. */
  readonly qtyFormula: string;
  readonly wastePercent: number;
}

export interface ConfigurableProduct {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  /** The finished-good inventory item this product manufactures into. */
  readonly outputItemId: string;
  readonly unit: string;
  readonly description: string | null;
  readonly inputs: readonly ConfigInput[];
  readonly materials: readonly MaterialFormula[];
  readonly pricingMethod: PricingMethod;
  /** Required when pricingMethod === "formula". */
  readonly priceFormula: string | null;
  readonly laborFormula: string | null;
  readonly overheadFormula: string | null;
  readonly itemPolicy: ItemPolicy;
  readonly status: ActivationStatus;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ConfigurableProductRepository {
  findById(id: string): Promise<ConfigurableProduct | null>;
  findByCode(code: string): Promise<ConfigurableProduct | null>;
  list(): Promise<ConfigurableProduct[]>;
  create(product: ConfigurableProduct): Promise<void>;
  update(product: ConfigurableProduct): Promise<void>;
}

export interface ConfigInputInput {
  readonly id: string;
  readonly labelAr: string;
  readonly labelEn?: string | null;
  readonly type?: "number";
  readonly min?: number | null;
  readonly max?: number | null;
}

export interface MaterialFormulaInput {
  readonly itemId: string;
  readonly qtyFormula: string;
  readonly wastePercent?: number;
}

export interface UpsertConfigurableProductCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly outputItemId: string;
  readonly unit: string;
  readonly description?: string | null;
  readonly inputs: readonly ConfigInputInput[];
  readonly materials: readonly MaterialFormulaInput[];
  readonly pricingMethod?: PricingMethod;
  readonly priceFormula?: string | null;
  readonly laborFormula?: string | null;
  readonly overheadFormula?: string | null;
  readonly itemPolicy?: ItemPolicy;
  readonly createdBy?: string;
}

export interface ConfigurableProductDeps {
  readonly products: ConfigurableProductRepository;
  readonly now?: () => string;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

/** Validate the shape and every formula (parse-time) of a configurable product. */
function validate(command: UpsertConfigurableProductCommand): {
  inputs: ConfigInput[];
  materials: MaterialFormula[];
  pricingMethod: PricingMethod;
} {
  const reasons: string[] = [];
  if (command.code.trim() === "") reasons.push("code is required");
  if (command.nameAr.trim() === "") reasons.push("Arabic name is required");
  if (command.outputItemId.trim() === "") reasons.push("an output item is required");
  if (command.inputs.length === 0) reasons.push("at least one configuration input is required");
  if (command.materials.length === 0) reasons.push("at least one manufacturing material is required");

  const inputs = command.inputs.map<ConfigInput>((inp, i) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inp.id)) {
      reasons.push(`input ${i}: id "${inp.id}" must be a valid formula variable name`);
    }
    return {
      id: inp.id,
      labelAr: inp.labelAr,
      labelEn: inp.labelEn ?? null,
      type: "number",
      min: inp.min ?? null,
      max: inp.max ?? null,
    };
  });

  const validateFormula = (formula: string, where: string) => {
    try {
      compileFormula(formula);
    } catch (err) {
      if (err instanceof FormulaError) reasons.push(`${where}: ${err.message}`);
      else throw err;
    }
  };

  const materials = command.materials.map<MaterialFormula>((m, i) => {
    if (m.itemId.trim() === "") reasons.push(`material ${i}: an item is required`);
    validateFormula(m.qtyFormula, `material ${i} quantity formula`);
    return { itemId: m.itemId, qtyFormula: m.qtyFormula, wastePercent: m.wastePercent ?? 0 };
  });

  const pricingMethod = command.pricingMethod ?? "manual";
  if (pricingMethod === "formula") {
    if (!command.priceFormula || command.priceFormula.trim() === "") {
      reasons.push("a price formula is required when pricing method is formula");
    } else {
      validateFormula(command.priceFormula, "price formula");
    }
  }
  if (command.laborFormula) validateFormula(command.laborFormula, "labour formula");
  if (command.overheadFormula) validateFormula(command.overheadFormula, "overhead formula");

  if (reasons.length > 0) throw new InvalidManufacturingDocumentError(reasons);
  return { inputs, materials, pricingMethod };
}

/** إضافة منتج قابل للتهيئة (Create). */
export async function createConfigurableProduct(
  command: UpsertConfigurableProductCommand,
  deps: ConfigurableProductDeps,
): Promise<ConfigurableProduct> {
  const { inputs, materials, pricingMethod } = validate(command);
  if (await deps.products.findById(command.id)) {
    throw new DuplicateManufacturingDocumentError(command.id);
  }
  const product: ConfigurableProduct = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    outputItemId: command.outputItemId,
    unit: command.unit,
    description: command.description ?? null,
    inputs,
    materials,
    pricingMethod,
    priceFormula: command.priceFormula ?? null,
    laborFormula: command.laborFormula ?? null,
    overheadFormula: command.overheadFormula ?? null,
    itemPolicy: command.itemPolicy ?? "per_order",
    status: "active",
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.products.create(product);
  return product;
}

/** حفظ التعديلات (Edit) — replaces the definition, re-validating every formula. */
export async function updateConfigurableProduct(
  command: UpsertConfigurableProductCommand,
  deps: ConfigurableProductDeps,
): Promise<ConfigurableProduct> {
  const existing = await deps.products.findById(command.id);
  if (!existing) throw new ConfigurableProductNotFoundError(command.id);
  const { inputs, materials, pricingMethod } = validate(command);
  const product: ConfigurableProduct = {
    ...existing,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    outputItemId: command.outputItemId,
    unit: command.unit,
    description: command.description ?? null,
    inputs,
    materials,
    pricingMethod,
    priceFormula: command.priceFormula ?? null,
    laborFormula: command.laborFormula ?? null,
    overheadFormula: command.overheadFormula ?? null,
    itemPolicy: command.itemPolicy ?? existing.itemPolicy,
  };
  await deps.products.update(product);
  return product;
}

/** تعطيل (Deactivate). Idempotent. */
export async function deactivateConfigurableProduct(
  id: string,
  deps: ConfigurableProductDeps,
): Promise<ConfigurableProduct> {
  const product = await deps.products.findById(id);
  if (!product) throw new ConfigurableProductNotFoundError(id);
  if (product.status === "inactive") return product;
  const updated: ConfigurableProduct = { ...product, status: "inactive" };
  await deps.products.update(updated);
  return updated;
}

// --- evaluation -------------------------------------------------------------

export interface ResolvedMaterial {
  readonly itemId: string;
  /** Per-unit quantity from the formula (before waste). */
  readonly qtyPerUnit: Qty;
  /** Per-unit quantity grossed up for waste. */
  readonly effectiveQtyPerUnit: Qty;
  readonly wastePercent: number;
  readonly unitCost: Money;
  /** effectiveQtyPerUnit × unitCost — per-unit material cost. */
  readonly lineCost: Money;
}

export interface ConfigurableProductResolution {
  readonly materials: readonly ResolvedMaterial[];
  readonly materialCostPerUnit: Money;
  readonly laborCostPerUnit: Money;
  readonly overheadCostPerUnit: Money;
  /** Formula price per unit, or null when pricing is manual. */
  readonly unitPrice: Money | null;
}

/**
 * Evaluate the template against one spec (per-unit). Validates every input is
 * present and within its min/max, then runs the sandboxed formulas. `unitCost`
 * for each material comes from the caller's costing lookup (moving average).
 */
export function evaluateConfigurableProduct(
  product: ConfigurableProduct,
  spec: FormulaScope,
  resolveUnitCost: (itemId: string) => Money,
): ConfigurableProductResolution {
  const reasons: string[] = [];
  const scope: Record<string, string> = {};
  for (const input of product.inputs) {
    const raw = spec[input.id];
    if (raw === undefined || raw.trim() === "") {
      reasons.push(`missing value for "${input.id}"`);
      continue;
    }
    if (!/^-?\d+(\.\d+)?$/.test(raw.trim())) {
      reasons.push(`value for "${input.id}" must be a number`);
      continue;
    }
    const num = Number(raw);
    if (input.min !== null && num < input.min) reasons.push(`"${input.id}" is below its minimum (${input.min})`);
    if (input.max !== null && num > input.max) reasons.push(`"${input.id}" is above its maximum (${input.max})`);
    scope[input.id] = raw.trim();
  }
  if (reasons.length > 0) throw new InvalidManufacturingDocumentError(reasons);

  const materials = product.materials.map<ResolvedMaterial>((m) => {
    const qtyPerUnit = compileFormula(m.qtyFormula).evaluateQty(scope);
    const effectiveQtyPerUnit = grossUpForWaste(qtyPerUnit, m.wastePercent);
    const unitCost = resolveUnitCost(m.itemId);
    return {
      itemId: m.itemId,
      qtyPerUnit,
      effectiveQtyPerUnit,
      wastePercent: m.wastePercent,
      unitCost,
      lineCost: extend(effectiveQtyPerUnit, unitCost),
    };
  });

  const materialCostPerUnit = Money.sum(materials.map((m) => m.lineCost));
  const laborCostPerUnit = product.laborFormula
    ? compileFormula(product.laborFormula).evaluateMoney(scope)
    : Money.zero();
  const overheadCostPerUnit = product.overheadFormula
    ? compileFormula(product.overheadFormula).evaluateMoney(scope)
    : Money.zero();
  const unitPrice =
    product.pricingMethod === "formula" && product.priceFormula
      ? compileFormula(product.priceFormula).evaluateMoney(scope)
      : null;

  return { materials, materialCostPerUnit, laborCostPerUnit, overheadCostPerUnit, unitPrice };
}
