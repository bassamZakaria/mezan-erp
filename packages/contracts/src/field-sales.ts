import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";
import { isoDateOrInstant } from "./iso-date.js";
import { clientSuppliedId } from "./client-supplied-id.js";
import {
  VanTripCashMovementKindDTO,
  VanTripCrewRoleDTO,
  VanTripStatusDTO,
  vanTripCashBreakdownSchema,
  vanTripReconciliationSchema,
} from "./enh/e3-04.js";

/**
 * Wire contract for the Field/Van Sales module (docs/archive/catalog/07-mfg-projects-assets.md
 * "رحلات المندوبين"). Money and Qty cross the wire as exact decimal strings —
 * never floats — the domain re-parses them via `Money.fromMajor` / `Qty.fromMajor`.
 */

/** @see moneyString — one guard for every exact-decimal field on the wire (D126). */
const decimalString = moneyString;
/** @see nonNegativeMoneyString — one guard for every exact-decimal field on the wire (D126). */
const positiveDecimalString = nonNegativeMoneyString;

export const vanTripStatusSchema = z.nativeEnum(VanTripStatusDTO);
export const vanTripCrewRoleSchema = z.nativeEnum(VanTripCrewRoleDTO);
export const vanTripCashMovementKindSchema = z.nativeEnum(VanTripCashMovementKindDTO);

export const vanTripCrewMemberSchema = z.object({
  employeeId: z.string().min(1),
  role: vanTripCrewRoleSchema,
});

export const vanTripStockLineSchema = z.object({
  itemId: z.string().min(1),
  qty: positiveDecimalString,
});

export const vanTripCashMovementSchema = z.object({
  id: z.string().min(1),
  kind: vanTripCashMovementKindSchema,
  amount: decimalString,
  occurredAt: z.string().min(1),
  notes: z.string().nullable(),
});

export const vanTripStockCountLineSchema = z.object({
  itemId: z.string().min(1),
  expectedQty: decimalString,
  countedQty: decimalString,
  varianceQty: decimalString,
  loadedQty: decimalString,
  soldQty: decimalString,
  returnedQty: decimalString,
  otherQty: decimalString,
  unitCost: decimalString,
  varianceValue: decimalString,
});

export const vanTripSettlementSchema = z.object({
  expectedCash: decimalString,
  countedCash: decimalString,
  cashVariance: decimalString,
  stockCounts: z.array(vanTripStockCountLineSchema),
  settledAt: z.string().min(1),
  settledBy: z.string().nullable(),
  settlementDate: z.string().nullable(),
  cashBreakdown: vanTripCashBreakdownSchema.nullable(),
  invoicedSales: decimalString,
  returnsValue: decimalString,
  reconciliation: vanTripReconciliationSchema.nullable(),
});

/** المركبات — the van registry (R3.13): a vehicle owns its warehouse and its till. */
export const vanSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  plateNumber: z.string().nullable(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  treasuryAccountId: z.string().min(1),
  active: z.boolean(),
});

export const createVanSchema = z.object({
  id: clientSuppliedId.optional(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullish(),
  plateNumber: z.string().nullish(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  treasuryAccountId: z.string().min(1),
  active: z.boolean().optional(),
});

export const vanTripSchema = z.object({
  id: z.string().min(1),
  tripNo: z.string().nullable(),
  date: z.string().min(1),
  branchId: z.string().min(1),
  vanId: z.string().nullable(),
  vanWarehouseId: z.string().min(1),
  vanTreasuryAccountId: z.string().min(1),
  sourceWarehouseId: z.string().min(1),
  sourceTreasuryAccountId: z.string().min(1),
  openingCashFloat: decimalString,
  crew: z.array(vanTripCrewMemberSchema),
  loadedStock: z.array(vanTripStockLineSchema),
  cashMovements: z.array(vanTripCashMovementSchema),
  status: vanTripStatusSchema,
  openedAt: z.string().min(1),
  settledAt: z.string().nullable(),
  settlement: vanTripSettlementSchema.nullable(),
  notes: z.string().nullable(),
});

export const openVanTripSchema = z.object({
  id: clientSuppliedId,
  tripNo: z.string().nullable().optional(),
  date: isoDateOrInstant,
  branchId: z.string().min(1).optional(),
  /**
   * Naming the van is enough: the server fills the warehouse and the till in
   * from the registry, and REFUSES a body that names both a van and a
   * different warehouse or till (R3.13).
   */
  vanId: z.string().min(1).optional(),
  vanWarehouseId: z.string().min(1).optional(),
  vanTreasuryAccountId: z.string().min(1).optional(),
  sourceWarehouseId: z.string().min(1),
  sourceTreasuryAccountId: z.string().min(1),
  openingCashFloat: decimalString.optional(),
  crew: z.array(vanTripCrewMemberSchema).min(1),
  loadedStock: z.array(vanTripStockLineSchema).optional(),
  notes: z.string().nullable().optional(),
});

export const recordVanCashMovementSchema = z.object({
  id: clientSuppliedId,
  kind: vanTripCashMovementKindSchema,
  amount: decimalString,
  occurredAt: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export const settleVanTripSchema = z.object({
  countedCash: positiveDecimalString,
  stockCounts: z.array(
    z.object({
      itemId: z.string().min(1),
      countedQty: positiveDecimalString,
    }),
  ),
});

export const approveVanTripResponseSchema = z.object({
  trip: vanTripSchema,
  /** True while a generated adjustment or transfer waits in the approvals inbox; approving again resumes. */
  held: z.boolean(),
});

export type VanDTO = z.infer<typeof vanSchema>;
export type CreateVanDTO = z.infer<typeof createVanSchema>;
export type VanTripCrewMemberDTO = z.infer<typeof vanTripCrewMemberSchema>;
export type VanTripStockLineDTO = z.infer<typeof vanTripStockLineSchema>;
export type VanTripCashMovementDTO = z.infer<typeof vanTripCashMovementSchema>;
export type VanTripStockCountLineDTO = z.infer<typeof vanTripStockCountLineSchema>;
export type VanTripSettlementDTO = z.infer<typeof vanTripSettlementSchema>;
export type VanTripDTO = z.infer<typeof vanTripSchema>;
export type OpenVanTripDTO = z.infer<typeof openVanTripSchema>;
export type RecordVanCashMovementDTO = z.infer<typeof recordVanCashMovementSchema>;
export type SettleVanTripDTO = z.infer<typeof settleVanTripSchema>;
export type ApproveVanTripResponseDTO = z.infer<typeof approveVanTripResponseSchema>;
