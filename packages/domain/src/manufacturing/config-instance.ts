/**
 * التصنيع المخصص (Custom Manufacturing Order / Config Instance) — one make-to-
 * order production against a configurable product (docs/archive/catalog/07 §Config
 * Instances). The customer picks parameters; the system evaluates the product's
 * sandboxed formulas into concrete materials/price/labour/overhead, then AUTO-
 * GENERATES a linked work order (أمر التشغيل) by first materialising an ad-hoc
 * (custom) BOM from the resolution and creating a work order from it. The
 * instance, its BOM and its work order are cross-linked.
 */

import { Money, Qty } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { createBom, type BomRepository } from "./bom.js";
import {
  createWorkOrder,
  workOrderWipTotal,
  type WorkOrder,
  type WorkOrderRepository,
} from "./work-order.js";
import {
  evaluateConfigurableProduct,
  type ConfigurableProductRepository,
} from "./configurable-product.js";
import type { ConfigInstanceStatus } from "./types.js";
import {
  ConfigInstanceNotFoundError,
  ConfigurableProductNotFoundError,
  InvalidManufacturingDocumentError,
} from "./errors.js";

const CONFIG_INSTANCE_SEQUENCE = "CONFIG_INSTANCE";

/** Per-unit resolved material snapshot frozen onto the instance. */
export interface ConfigInstanceMaterial {
  readonly itemId: string;
  readonly qtyPerUnit: Qty;
  readonly wastePercent: number;
  readonly lineCost: Money;
}

export interface ConfigInstance {
  readonly id: string;
  readonly number: string;
  readonly configurableProductId: string;
  readonly productNameAr: string;
  readonly outputItemId: string;
  /** The chosen parameter values, keyed by config-input id (spec string source). */
  readonly spec: Readonly<Record<string, string>>;
  readonly qty: Qty;
  readonly customerId: string | null;
  readonly sellUnitPrice: Money | null;
  readonly notes: string | null;
  readonly status: ConfigInstanceStatus;
  readonly bomId: string;
  readonly workOrderId: string;
  readonly materials: readonly ConfigInstanceMaterial[];
  readonly materialCostPerUnit: Money;
  readonly laborCostPerUnit: Money;
  readonly overheadCostPerUnit: Money;
  /** material + labour + overhead per unit (estimated). */
  readonly estimatedUnitCost: Money;
  /** Actual total cost, captured from the linked work order at close. */
  readonly actualCost: Money | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ConfigInstanceRepository {
  findById(id: string): Promise<ConfigInstance | null>;
  list(): Promise<ConfigInstance[]>;
  create(instance: ConfigInstance): Promise<void>;
  update(instance: ConfigInstance): Promise<void>;
}

export interface CreateConfigInstanceCommand {
  readonly id: string;
  readonly configurableProductId: string;
  readonly spec: Readonly<Record<string, string>>;
  readonly qty: Qty;
  readonly customerId?: string | null;
  /** Manual override; when omitted the formula price (if any) is used. */
  readonly sellUnitPrice?: Money | null;
  readonly notes?: string | null;
  readonly sourceWarehouseId: string;
  readonly wipWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly scheduledStartDate: string;
  readonly scheduledEndDate?: string | null;
  readonly createdBy?: string;
  /** Deterministic ids for the auto-generated BOM + work order; defaulted from `id`. */
  readonly bomId?: string;
  readonly workOrderId?: string;
}

export interface CreateConfigInstanceDeps {
  readonly instances: ConfigInstanceRepository;
  readonly boms: BomRepository;
  readonly workOrders: WorkOrderRepository;
  readonly products: ConfigurableProductRepository;
  readonly numbering: NextNumberService;
  readonly resolveUnitCost: (itemId: string) => Money;
  readonly now?: () => string;
}

function nowIso(deps: { now?: () => string }): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

export interface CreateConfigInstanceResult {
  readonly instance: ConfigInstance;
  readonly workOrder: WorkOrder;
}

/**
 * Create a custom manufacturing order and its linked work order. Resolves the
 * configurable product's formulas against the spec, materialises an ad-hoc
 * custom BOM (standard batch = 1 unit) and a work order for the ordered
 * quantity, then records the cross-linked instance.
 */
export async function createConfigInstance(
  command: CreateConfigInstanceCommand,
  deps: CreateConfigInstanceDeps,
): Promise<CreateConfigInstanceResult> {
  if (command.qty.isZero() || command.qty.isNegative()) {
    throw new InvalidManufacturingDocumentError(["الكمية يجب أن تكون أكبر من صفر"]);
  }
  const product = await deps.products.findById(command.configurableProductId);
  if (!product) throw new ConfigurableProductNotFoundError(command.configurableProductId);

  const resolution = evaluateConfigurableProduct(product, command.spec, deps.resolveUnitCost);

  const bomId = command.bomId ?? `${command.id}:bom`;
  const workOrderId = command.workOrderId ?? `${command.id}:wo`;

  // Ad-hoc custom BOM: standard batch = 1 unit; per-unit formula quantities.
  const bom = await createBom(
    {
      id: bomId,
      productItemId: product.outputItemId,
      standardQty: Qty.fromMajor("1"),
      unit: product.unit,
      laborCost: resolution.laborCostPerUnit,
      overheadCost: resolution.overheadCostPerUnit,
      versionNotes: `تصنيع مخصص — ${product.nameAr}`,
      lines: resolution.materials.map((m) => ({
        itemId: m.itemId,
        qty: m.qtyPerUnit,
        wastePercent: m.wastePercent,
      })),
      createdBy: command.createdBy,
      custom: true,
    },
    { boms: deps.boms, numbering: deps.numbering, now: deps.now },
  );

  const workOrder = await createWorkOrder(
    {
      id: workOrderId,
      bomId: bom.id,
      plannedQty: command.qty,
      sourceWarehouseId: command.sourceWarehouseId,
      wipWarehouseId: command.wipWarehouseId,
      destinationWarehouseId: command.destinationWarehouseId,
      scheduledStartDate: command.scheduledStartDate,
      scheduledEndDate: command.scheduledEndDate ?? null,
      notes: command.notes,
      createdBy: command.createdBy,
      configInstanceId: command.id,
    },
    { workOrders: deps.workOrders, boms: deps.boms, numbering: deps.numbering, now: deps.now },
  );

  const estimatedUnitCost = resolution.materialCostPerUnit
    .add(resolution.laborCostPerUnit)
    .add(resolution.overheadCostPerUnit);

  const instance: ConfigInstance = {
    id: command.id,
    number: (await deps.numbering.next(CONFIG_INSTANCE_SEQUENCE)).formatted,
    configurableProductId: product.id,
    productNameAr: product.nameAr,
    outputItemId: product.outputItemId,
    spec: command.spec,
    qty: command.qty,
    customerId: command.customerId ?? null,
    sellUnitPrice: command.sellUnitPrice ?? resolution.unitPrice ?? null,
    notes: command.notes ?? null,
    status: "configured",
    bomId: bom.id,
    workOrderId: workOrder.id,
    materials: resolution.materials.map<ConfigInstanceMaterial>((m) => ({
      itemId: m.itemId,
      qtyPerUnit: m.qtyPerUnit,
      wastePercent: m.wastePercent,
      lineCost: m.lineCost,
    })),
    materialCostPerUnit: resolution.materialCostPerUnit,
    laborCostPerUnit: resolution.laborCostPerUnit,
    overheadCostPerUnit: resolution.overheadCostPerUnit,
    estimatedUnitCost,
    actualCost: null,
    createdBy: command.createdBy ?? "system",
    createdAt: nowIso(deps),
  };
  await deps.instances.create(instance);
  return { instance, workOrder };
}

/** Total sell value = sellUnitPrice × qty (0 when price is manual/unset). */
export function configInstanceSellTotal(instance: ConfigInstance): Money {
  if (!instance.sellUnitPrice) return Money.zero();
  return Money.fromScaled((instance.sellUnitPrice.scaled * instance.qty.scaled) / 1_000_000n);
}

export interface CloseConfigInstanceDeps {
  readonly instances: ConfigInstanceRepository;
  readonly workOrders: WorkOrderRepository;
}

/**
 * إغلاق الأمر (Close) — capture the linked work order's actual WIP cost onto the
 * instance and close it. مهيأة/في التنفيذ → مغلقة.
 */
export async function closeConfigInstance(
  id: string,
  deps: CloseConfigInstanceDeps,
): Promise<ConfigInstance> {
  const instance = await deps.instances.findById(id);
  if (!instance) throw new ConfigInstanceNotFoundError(id);
  if (instance.status === "closed" || instance.status === "cancelled") return instance;
  const wo = await deps.workOrders.findById(instance.workOrderId);
  const actualCost = wo ? workOrderWipTotal(wo) : instance.estimatedUnitCost;
  const updated: ConfigInstance = { ...instance, status: "closed", actualCost };
  await deps.instances.update(updated);
  return updated;
}

/** إلغاء (Cancel). */
export async function cancelConfigInstance(
  id: string,
  deps: Pick<CloseConfigInstanceDeps, "instances">,
): Promise<ConfigInstance> {
  const instance = await deps.instances.findById(id);
  if (!instance) throw new ConfigInstanceNotFoundError(id);
  const updated: ConfigInstance = { ...instance, status: "cancelled" };
  await deps.instances.update(updated);
  return updated;
}
