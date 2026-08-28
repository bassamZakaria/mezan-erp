/**
 * manufacturing/ — the manufacturing module (docs/catalog/07): قوائم المواد
 * (BOMs), أوامر التصنيع (Work Orders, 4-stage), المنتجات القابلة للتهيئة
 * (Configurable Products) and التصنيع المخصص (Custom Manufacturing). Built on
 * the shared numbering, costing/stock-ledger and GL engines. Pure domain —
 * ports only. Configurable-product formulas are evaluated by a SANDBOXED
 * expression evaluator (formula.ts) — never eval/Function.
 */

export type {
  ActivationStatus,
  WorkOrderStatus,
  WorkOrderStage,
  WorkOrderPriority,
  ConfigInstanceStatus,
  PricingMethod,
  ItemPolicy,
  ManufacturingStockPort,
  ManufacturingGlPosting,
  ManufacturingGlPostingLine,
  ManufacturingGlPostingPort,
  WorkOrderGlAccounts,
} from "./types.js";

export {
  BomNotFoundError,
  WorkOrderNotFoundError,
  ConfigurableProductNotFoundError,
  ConfigInstanceNotFoundError,
  DuplicateManufacturingDocumentError,
  InvalidManufacturingDocumentError,
  WorkOrderStageError,
  FormulaError,
} from "./errors.js";

export {
  compileFormula,
  evaluateFormulaMoney,
  evaluateFormulaQty,
  assertFormulaValid,
  type CompiledFormula,
  type FormulaScope,
} from "./formula.js";

export {
  createBom,
  createBomVersion,
  deactivateBom,
  grossUpForWaste,
  wasteAllowanceOf,
  bomLineEffectiveQty,
  bomMaterialCost,
  bomCostEstimate,
  type Bom,
  type BomLine,
  type BomLineInput,
  type BomRepository,
  type CreateBomCommand,
  type CreateBomVersionCommand,
  type BomDeps,
  type BomCostEstimate,
} from "./bom.js";

export {
  createWorkOrder,
  startWorkOrder,
  issueWorkOrderMaterials,
  extraIssueWorkOrderMaterials,
  returnWorkOrderMaterials,
  logWorkOrderWaste,
  logWorkOrderCost,
  receiveWorkOrderProduct,
  completeWorkOrder,
  cancelWorkOrder,
  buildWorkOrderGlPosting,
  workOrderWipTotal,
  workOrderWipQty,
  workOrderProgress,
  type WorkOrder,
  type WorkOrderMaterial,
  type WorkOrderCostLogEntry,
  type WorkOrderWasteEntry,
  type WorkOrderShopFloorEntry,
  type ShopFloorAttribution,
  type WorkOrderRepository,
  type CreateWorkOrderCommand,
  type CreateWorkOrderDeps,
  type WorkOrderStockDeps,
  type CompleteWorkOrderDeps,
  type CompleteWorkOrderResult,
  type IssueMoreLine,
} from "./work-order.js";

export {
  createWorkStation,
  setWorkStationStatus,
  resolveWorkStation,
  type WorkStation,
  type WorkStationRepository,
  type CreateWorkStationCommand,
  type WorkStationDeps,
} from "./work-station.js";

export {
  createConfigurableProduct,
  updateConfigurableProduct,
  deactivateConfigurableProduct,
  evaluateConfigurableProduct,
  type ConfigInput,
  type ConfigInputInput,
  type MaterialFormula,
  type MaterialFormulaInput,
  type ConfigurableProduct,
  type ConfigurableProductRepository,
  type ConfigurableProductDeps,
  type UpsertConfigurableProductCommand,
  type ResolvedMaterial,
  type ConfigurableProductResolution,
} from "./configurable-product.js";

export {
  createConfigInstance,
  closeConfigInstance,
  cancelConfigInstance,
  configInstanceSellTotal,
  type ConfigInstance,
  type ConfigInstanceMaterial,
  type ConfigInstanceRepository,
  type CreateConfigInstanceCommand,
  type CreateConfigInstanceDeps,
  type CreateConfigInstanceResult,
  type CloseConfigInstanceDeps,
} from "./config-instance.js";
