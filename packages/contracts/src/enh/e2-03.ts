import { z } from "zod";
import { isoDateOrInstant } from "../iso-date.js";
import { moneyString, nonNegativeMoneyString } from "../money-string.js";
import { physicalCountStatusSchema } from "../stock-documents.js";

export enum CountZoneKindDTO {
  Category = "CATEGORY",
  AdHoc = "AD_HOC",
}

export enum CountZoneStatusDTO {
  Open = "OPEN",
  Submitted = "SUBMITTED",
  Approved = "APPROVED",
}

export enum CountScanModeDTO {
  Add = "ADD",
  Set = "SET",
}

export enum CountScanSourceDTO {
  Scan = "SCAN",
  Keypad = "KEYPAD",
  KeypadSet = "KEYPAD_SET",
  ZeroFill = "ZERO_FILL",
}

export enum CountScanOutcomeDTO {
  Counted = "COUNTED",
  UnknownBarcode = "UNKNOWN_BARCODE",
  NotInZone = "NOT_IN_ZONE",
}

export enum CountScanVoidReasonDTO {
  Undo = "UNDO",
  Replaced = "REPLACED",
  Recount = "RECOUNT",
}

export const COUNT_MODE_ZONE_NAME_MAX = 80;
export const COUNT_MODE_BARCODE_MAX = 128;
export const COUNT_MODE_CLIENT_KEY_MAX = 64;
export const COUNT_MODE_REASON_MAX = 300;
export const COUNT_MODE_LIVE_REFRESH_MS = 5000;

export const countZoneSpecSchema = z
  .object({
    name: z.string().trim().min(1).max(COUNT_MODE_ZONE_NAME_MAX),
    kind: z.nativeEnum(CountZoneKindDTO),
    categoryId: z.string().min(1).nullish(),
    itemIds: z.array(z.string().min(1)).optional(),
    counterUserIds: z.array(z.string().min(1)).min(1),
  })
  .refine((zone) => (zone.kind === CountZoneKindDTO.Category ? Boolean(zone.categoryId) : (zone.itemIds?.length ?? 0) > 0), {
    message: "A category zone needs a category; an ad hoc zone needs items.",
  });
export type CountZoneSpecDTO = z.infer<typeof countZoneSpecSchema>;

export const startCountModeSchema = z.object({
  warehouseId: z.string().min(1),
  date: isoDateOrInstant,
  memo: z.string().max(500).optional(),
  blind: z.boolean().optional(),
  zones: z.array(countZoneSpecSchema).min(1),
});
export type StartCountModeDTO = z.infer<typeof startCountModeSchema>;

export const countModeScanSchema = z
  .object({
    barcode: z.string().trim().min(1).max(COUNT_MODE_BARCODE_MAX).optional(),
    itemId: z.string().min(1).optional(),
    mode: z.nativeEnum(CountScanModeDTO).default(CountScanModeDTO.Add),
    qty: nonNegativeMoneyString.optional(),
    unitCode: z.string().min(1).max(32).optional(),
    clientKey: z.string().min(1).max(COUNT_MODE_CLIENT_KEY_MAX).optional(),
  })
  .refine((scan) => Boolean(scan.barcode) || Boolean(scan.itemId), { message: "A barcode or an item is required." })
  .refine((scan) => scan.mode === CountScanModeDTO.Add || scan.qty !== undefined, { message: "Setting a total needs a quantity." });
export type CountModeScanDTO = z.infer<typeof countModeScanSchema>;
export type CountModeScanInputDTO = z.input<typeof countModeScanSchema>;

export const countModeRecountSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1),
  reason: z.string().trim().min(1).max(COUNT_MODE_REASON_MAX),
});
export type CountModeRecountDTO = z.infer<typeof countModeRecountSchema>;

export const countModeItemSchema = z.object({
  itemId: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  unitCode: z.string(),
  zoneId: z.string(),
  countedQty: moneyString.nullable(),
  recount: z.boolean(),
  systemQty: moneyString.nullable(),
  varianceQty: moneyString.nullable(),
  varianceValue: moneyString.nullable(),
});
export type CountModeItemDTO = z.infer<typeof countModeItemSchema>;

export const countModeZoneSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.nativeEnum(CountZoneKindDTO),
  categoryId: z.string().nullable(),
  status: z.nativeEnum(CountZoneStatusDTO),
  counterUserIds: z.array(z.string()),
  totalItems: z.number().int().nonnegative(),
  countedItems: z.number().int().nonnegative(),
  recountItems: z.number().int().nonnegative(),
  submittedAt: z.string().nullable(),
  submittedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  assignedToMe: z.boolean(),
  netValue: moneyString.nullable(),
  absValue: moneyString.nullable(),
});
export type CountModeZoneSummaryDTO = z.infer<typeof countModeZoneSummarySchema>;

export const countModeCounterSchema = z.object({
  userId: z.string(),
  name: z.string(),
});
export type CountModeCounterDTO = z.infer<typeof countModeCounterSchema>;

export const countModeSessionSchema = z.object({
  id: z.string(),
  countNo: z.string().nullable(),
  warehouseId: z.string(),
  date: z.string(),
  memo: z.string(),
  status: physicalCountStatusSchema,
  blind: z.boolean(),
  generatedAdjustmentId: z.string().nullable(),
  zones: z.array(countModeZoneSummarySchema),
  items: z.array(countModeItemSchema),
  counters: z.array(countModeCounterSchema),
  revealsVariance: z.boolean(),
  canReview: z.boolean(),
  netValue: moneyString.nullable(),
  absValue: moneyString.nullable(),
});
export type CountModeSessionDTO = z.infer<typeof countModeSessionSchema>;

export const countModeScanRecordSchema = z.object({
  id: z.string(),
  zoneId: z.string().nullable(),
  itemId: z.string().nullable(),
  barcode: z.string().nullable(),
  outcome: z.nativeEnum(CountScanOutcomeDTO),
  source: z.nativeEnum(CountScanSourceDTO),
  qty: moneyString,
  enteredQty: moneyString.nullable(),
  unitCode: z.string().nullable(),
  userId: z.string(),
  userName: z.string(),
  scannedAt: z.string(),
  voidedAt: z.string().nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.nativeEnum(CountScanVoidReasonDTO).nullable(),
});
export type CountModeScanRecordDTO = z.infer<typeof countModeScanRecordSchema>;

export const countModeScanResultSchema = z.object({
  outcome: z.nativeEnum(CountScanOutcomeDTO),
  replayed: z.boolean(),
  scan: countModeScanRecordSchema,
  item: countModeItemSchema.nullable(),
  addedQty: moneyString.nullable(),
  zone: countModeZoneSummarySchema,
});
export type CountModeScanResultDTO = z.infer<typeof countModeScanResultSchema>;

export const countModeMineEntrySchema = z.object({
  id: z.string(),
  countNo: z.string().nullable(),
  warehouseId: z.string(),
  date: z.string(),
  blind: z.boolean(),
  status: physicalCountStatusSchema,
  zones: z.array(countModeZoneSummarySchema),
});
export type CountModeMineEntryDTO = z.infer<typeof countModeMineEntrySchema>;
