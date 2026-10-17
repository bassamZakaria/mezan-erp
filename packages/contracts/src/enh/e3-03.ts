import { z } from "zod";
import { nonNegativeMoneyString } from "../money-string.js";

export enum ReorderRuleSourceDTO {
  Policy = "policy",
  ItemDefault = "item_default",
}

export enum ReorderTriggerDTO {
  BelowMinimum = "below_minimum",
  CoverBelowLeadTime = "cover_below_lead_time",
}

export enum ReorderProblemDTO {
  NoOrderQty = "no_order_qty",
  NoSupplier = "no_supplier",
}

export enum ReorderSkipReasonDTO {
  NotOnWorklist = "not_on_worklist",
  WarehouseOutOfScope = "warehouse_out_of_scope",
  SupplierUnknown = "supplier_unknown",
  InvalidQty = "invalid_qty",
}

export const REORDER_WINDOW_DAYS_DEFAULT_DTO = 30;
export const REORDER_WINDOW_DAYS_MIN_DTO = 7;
export const REORDER_WINDOW_DAYS_MAX_DTO = 365;
export const REORDER_ORDER_LINES_MAX = 200;
export const REORDER_LEAD_DAYS_MAX_DTO = 365;

export const reorderWorklistQuerySchema = z.object({
  warehouseId: z.string().min(1).optional(),
  windowDays: z.coerce.number().int().min(REORDER_WINDOW_DAYS_MIN_DTO).max(REORDER_WINDOW_DAYS_MAX_DTO).default(REORDER_WINDOW_DAYS_DEFAULT_DTO),
  search: z.string().trim().max(120).optional(),
});

export const saveReorderPolicySchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  minQty: nonNegativeMoneyString,
  maxQty: nonNegativeMoneyString,
  leadDays: z.number().int().min(0).max(REORDER_LEAD_DAYS_MAX_DTO),
  packQty: nonNegativeMoneyString.nullish(),
  supplierId: z.string().min(1).nullish(),
});

export const reorderOrderLineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().min(1),
  qty: nonNegativeMoneyString,
  supplierId: z.string().min(1).nullish(),
});

export const createReorderOrdersSchema = z.object({
  windowDays: z.number().int().min(REORDER_WINDOW_DAYS_MIN_DTO).max(REORDER_WINDOW_DAYS_MAX_DTO).default(REORDER_WINDOW_DAYS_DEFAULT_DTO),
  lines: z.array(reorderOrderLineSchema).min(1).max(REORDER_ORDER_LINES_MAX),
});

export type ReorderWorklistQueryDTO = z.infer<typeof reorderWorklistQuerySchema>;
export type SaveReorderPolicyDTO = z.infer<typeof saveReorderPolicySchema>;
export type ReorderOrderLineDTO = z.infer<typeof reorderOrderLineSchema>;
export type CreateReorderOrdersDTO = z.infer<typeof createReorderOrdersSchema>;

export interface ReorderRowDTO {
  readonly key: string;
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly source: ReorderRuleSourceDTO;
  readonly trigger: ReorderTriggerDTO;
  readonly minQty: string;
  readonly maxQty: string | null;
  readonly leadDays: number;
  readonly packQty: string;
  readonly onHand: string;
  readonly reserved: string;
  readonly onOrder: string;
  readonly onOrderDraft: string;
  readonly position: string;
  readonly soldInWindow: string;
  readonly dailyVelocity: string;
  readonly daysOfCover: number | null;
  readonly suggestedQty: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly unitPrice: string | null;
  readonly problems: readonly ReorderProblemDTO[];
}

export interface ReorderWorklistDTO {
  readonly asOfDate: string;
  readonly windowDays: number;
  readonly rows: readonly ReorderRowDTO[];
  readonly needsSupplierCount: number;
}

export interface ReorderPolicyDTO {
  readonly itemId: string;
  readonly itemCode: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string | null;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly minQty: string;
  readonly maxQty: string;
  readonly leadDays: number;
  readonly packQty: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface ReorderCreatedOrderDTO {
  readonly orderId: string;
  readonly number: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
  readonly lineCount: number;
  readonly total: string;
  readonly expectedDeliveryDate: string | null;
}

export interface ReorderLineRefusalDTO {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly qty: string;
}

export interface ReorderSkippedLineDTO extends ReorderLineRefusalDTO {
  readonly reason: ReorderSkipReasonDTO;
}

export interface CreateReorderOrdersResultDTO {
  readonly created: readonly ReorderCreatedOrderDTO[];
  readonly needsSupplier: readonly ReorderLineRefusalDTO[];
  readonly skipped: readonly ReorderSkippedLineDTO[];
}
