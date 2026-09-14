import { z } from "zod";
import { moneyString, nonNegativeMoneyString } from "./money-string.js";

/**
 * مستودعات المواقع، الصرف والاستلام، الاستهلاك، العهدة، تشغيل المعدات — the wire
 * contracts of slice 4A (docs/artifacts/mezan-contracting-designs.html D-11).
 * Quantities and money cross as exact decimal strings, never floats.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

export const siteIssueStatusSchema = z.enum(["draft", "issued", "partially_received", "received"]);
export const siteDocumentStatusSchema = z.enum(["draft", "confirmed"]);

export const siteIssueLineSchema = z.object({
  itemId: z.string().min(1),
  qty: nonNegativeMoneyString,
});

export const siteIssueSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  date: isoDate,
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  projectId: z.string().min(1),
  issuedByUserId: z.string().min(1),
  transitWarehouseId: z.string().nullable(),
  notes: z.string().nullable(),
  status: siteIssueStatusSchema,
  lines: z.array(siteIssueLineSchema),
  createdAt: z.string(),
  issuedAt: z.string().nullable(),
});

/**
 * `issuedByUserId` is deliberately absent: the server stamps the caller. A
 * body-supplied actor would let one person issue in another's name and then
 * receive it themselves, which is the whole of the control this document is.
 */
export const createSiteIssueSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  notes: z.string().nullable().optional(),
  lines: z.array(siteIssueLineSchema).min(1),
});

export const siteReceiptLineSchema = z.object({
  itemId: z.string().min(1),
  qtyReceived: nonNegativeMoneyString,
});

export const siteReceiptSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  issueId: z.string().min(1),
  date: isoDate,
  receivedByUserId: z.string().min(1),
  projectId: z.string().min(1),
  notes: z.string().nullable(),
  status: siteDocumentStatusSchema,
  lines: z.array(siteReceiptLineSchema),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});

export const createSiteReceiptSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().min(1),
  date: isoDate,
  notes: z.string().nullable().optional(),
  lines: z.array(siteReceiptLineSchema).min(1),
});

export const materialConsumptionLineSchema = z.object({
  itemId: z.string().min(1),
  qty: nonNegativeMoneyString,
});

export const materialConsumptionSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  date: isoDate,
  warehouseId: z.string().min(1),
  projectId: z.string().min(1),
  boqLineId: z.string().nullable(),
  /** عقد الباطن الذي صُرفت له المواد — prefills the sub certificate's deduction. */
  subcontractId: z.string().nullable(),
  notes: z.string().nullable(),
  status: siteDocumentStatusSchema,
  lines: z.array(materialConsumptionLineSchema),
  /** The value the stock ledger moved on confirm — "0.000000" while a draft. */
  totalCost: moneyString,
  journalEntryId: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});

export const createMaterialConsumptionSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  warehouseId: z.string().min(1),
  boqLineId: z.string().nullable().optional(),
  subcontractId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(materialConsumptionLineSchema).min(1),
});

export const custodyItemSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  warehouseId: z.string().min(1),
  custodianUserId: z.string().min(1),
  descriptionAr: z.string().min(1),
  qtyOut: nonNegativeMoneyString,
  qtyReturned: nonNegativeMoneyString,
  issuedDate: isoDate,
  expectedReturnDate: isoDate.nullable(),
  notes: z.string().nullable(),
});

export const issueCustodySchema = z.object({
  id: z.string().min(1),
  warehouseId: z.string().min(1),
  descriptionAr: z.string().min(1),
  qtyOut: nonNegativeMoneyString,
  issuedDate: isoDate,
  expectedReturnDate: isoDate.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const returnCustodySchema = z.object({
  qty: nonNegativeMoneyString,
  date: isoDate,
});

export const equipmentLogSchema = z.object({
  id: z.string().min(1),
  docNo: z.string().nullable(),
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  date: isoDate,
  hours: nonNegativeMoneyString,
  hourlyRate: moneyString,
  amount: moneyString,
  boqLineId: z.string().nullable(),
  notes: z.string().nullable(),
  status: siteDocumentStatusSchema,
  journalEntryId: z.string().nullable(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});

export const createEquipmentLogSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  assetId: z.string().min(1),
  date: isoDate,
  hours: nonNegativeMoneyString,
  /** سعر الساعة is NOT accepted here: it is the asset's rate, edited on the asset. */
  boqLineId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const unreceivedRowSchema = z.object({
  issueId: z.string().min(1),
  docNo: z.string().nullable(),
  date: isoDate,
  projectId: z.string().min(1),
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  transitWarehouseId: z.string().nullable(),
  issuedByUserId: z.string().min(1),
  itemId: z.string().min(1),
  qtyIssued: nonNegativeMoneyString,
  qtyReceived: nonNegativeMoneyString,
  qtyOutstanding: nonNegativeMoneyString,
  ageDays: z.number().int(),
  kind: z.enum(["outstanding", "received_before_issue"]),
  receiptId: z.string().nullable(),
  receiptDocNo: z.string().nullable(),
  receiptDate: z.string().nullable(),
});

export const consumptionByBoqLineRowSchema = z.object({
  boqLineId: z.string().nullable(),
  itemId: z.string().min(1),
  qty: nonNegativeMoneyString,
  cost: moneyString,
});

export const equipmentHoursRowSchema = z.object({
  boqLineId: z.string().nullable(),
  hours: nonNegativeMoneyString,
  amount: moneyString,
});

export type SiteIssueStatusDTO = z.infer<typeof siteIssueStatusSchema>;
export type SiteDocumentStatusDTO = z.infer<typeof siteDocumentStatusSchema>;
export type SiteIssueLineDTO = z.infer<typeof siteIssueLineSchema>;
export type SiteIssueDTO = z.infer<typeof siteIssueSchema>;
export type CreateSiteIssueDTO = z.infer<typeof createSiteIssueSchema>;
export type SiteReceiptLineDTO = z.infer<typeof siteReceiptLineSchema>;
export type SiteReceiptDTO = z.infer<typeof siteReceiptSchema>;
export type CreateSiteReceiptDTO = z.infer<typeof createSiteReceiptSchema>;
export type MaterialConsumptionLineDTO = z.infer<typeof materialConsumptionLineSchema>;
export type MaterialConsumptionDTO = z.infer<typeof materialConsumptionSchema>;
export type CreateMaterialConsumptionDTO = z.infer<typeof createMaterialConsumptionSchema>;
export type CustodyItemDTO = z.infer<typeof custodyItemSchema>;
export type IssueCustodyDTO = z.infer<typeof issueCustodySchema>;
export type ReturnCustodyDTO = z.infer<typeof returnCustodySchema>;
export type EquipmentLogDTO = z.infer<typeof equipmentLogSchema>;
export type CreateEquipmentLogDTO = z.infer<typeof createEquipmentLogSchema>;
export type UnreceivedRowDTO = z.infer<typeof unreceivedRowSchema>;
export type ConsumptionByBoqLineRowDTO = z.infer<typeof consumptionByBoqLineRowSchema>;
export type EquipmentHoursRowDTO = z.infer<typeof equipmentHoursRowSchema>;
