import { z } from "zod";
import { nonNegativeQuantityString } from "../money-string.js";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const expirySettingsSchema = z.object({
  nearExpiryDays: z.number().int().min(1).max(730),
});

export const expiryWriteOffRequestSchema = z.object({
  warehouseId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).optional(),
  memo: z.string().max(500).optional(),
});

export const goodsReceiptLotsSchema = z.object({
  lots: z
    .array(
      z.object({
        lineIndex: z.number().int().min(0),
        batchNo: z.string().trim().nullable(),
        expiryDate: isoDay.nullable(),
      }),
    )
    .min(1),
});

export const fefoPreviewQuerySchema = z.object({
  warehouseId: z.string().min(1),
  itemId: z.string().min(1),
  qty: nonNegativeQuantityString.optional(),
  date: isoDay.optional(),
});

export type ExpirySettingsInput = z.infer<typeof expirySettingsSchema>;
export type ExpiryWriteOffRequest = z.infer<typeof expiryWriteOffRequestSchema>;
export type GoodsReceiptLotsInput = z.infer<typeof goodsReceiptLotsSchema>;

export interface ExpirySettingsDTO {
  readonly nearExpiryDays: number;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}

export interface FefoPreviewSliceDTO {
  readonly layerId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly daysToExpiry: number | null;
  readonly expired: boolean;
  readonly available: string;
  readonly take: string;
}

export interface FefoPreviewDTO {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly asOf: string;
  readonly requested: string;
  readonly onHandInLayers: string;
  readonly covered: string;
  readonly shortfall: string;
  readonly blockedByExpired: boolean;
  readonly expiredQty: string;
  readonly slices: readonly FefoPreviewSliceDTO[];
}

export interface BatchTrailEntryDTO {
  readonly movementId: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly sourceDocType: string;
  readonly sourceDocId: string;
  readonly sourceDocNumber: string | null;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: string;
  readonly occurredAt: string;
}

export interface ExpiryAlertDTO {
  readonly layerId: string;
  readonly kind: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly qty: string;
  readonly emittedAt: string;
}

export interface ExpiredWriteOffBatchDTO {
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly qty: string;
  readonly value: string;
}

export interface ExpiredWriteOffLineDTO {
  readonly itemId: string;
  readonly qty: string;
  readonly value: string;
  readonly layerValue: string;
  readonly batches: readonly ExpiredWriteOffBatchDTO[];
}

export interface ExpiredWriteOffProposalDTO {
  readonly warehouseId: string;
  readonly asOf: string;
  readonly lines: readonly ExpiredWriteOffLineDTO[];
  readonly totalValue: string;
}

export interface ExpiryWriteOffResultDTO {
  readonly adjustmentId: string;
  readonly docNo: string | null;
  readonly status: string;
  readonly lines: readonly ExpiredWriteOffLineDTO[];
  readonly totalValue: string;
}

export interface ExpiryScanResultDTO {
  readonly scannedAt: string;
  readonly emitted: number;
}

export interface ExpiryDueBatchDTO {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly daysToExpiry: number | null;
  readonly status: string;
  readonly qty: string;
  readonly value: string;
}

export interface ExpiryAlertsDTO {
  readonly asOf: string;
  readonly nearExpiryDays: number;
  readonly due: readonly ExpiryDueBatchDTO[];
  readonly log: readonly ExpiryAlertDTO[];
}
