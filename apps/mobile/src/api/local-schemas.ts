import { z } from "zod";
import { attendanceEntrySchema } from "@mezan/contracts";

/**
 * Response shapes for routes @mezan/contracts does not ship a zod schema for
 * yet — the web client parses them as bare TS interfaces too (see
 * `apps/web/src/data/hooks.ts`'s `SalesInvoiceDTO` and
 * `apps/web/src/data/hr-self-hooks.ts`'s import of `SelfClockStatusDTO` as a
 * type only). Declared here, by hand, against the server's own `serialize()`
 * so the mobile client still refuses a response that does not match rather
 * than trusting `unknown` the way a bare `.json()` would.
 */

export const itemStockPositionSchema = z.object({
  warehouseId: z.string(),
  onHand: z.string(),
  reserved: z.string(),
  available: z.string(),
  totalValue: z.string(),
  averageCost: z.string(),
});

export const itemStockLayerSchema = z.object({
  id: z.string(),
  warehouseId: z.string(),
  unitCost: z.string(),
  originalQty: z.string(),
  remainingQty: z.string(),
  sourceDocType: z.string(),
  sourceDocNumber: z.string().nullable(),
  createdAt: z.string(),
});

/** `GET /inventory/items/:itemId/stock` (packages/api/src/inventory-routes.ts). */
export const itemStockSchema = z.object({
  positions: z.array(itemStockPositionSchema),
  layers: z.array(itemStockLayerSchema),
});

/** `GET /hr/self/clock` (packages/api/src/hr-self-routes.ts). */
export const selfClockStatusSchema = z.object({
  employeeId: z.string().nullable(),
  today: z.string(),
  serverTime: z.string(),
  todayEntry: attendanceEntrySchema.nullable(),
  openEntry: attendanceEntrySchema.nullable(),
  requireSelfie: z.boolean(),
  requireBiometric: z.boolean(),
  biometricRegistered: z.boolean(),
  storageAvailable: z.boolean(),
});

/** `POST /hr/self/clock` response. */
export const selfClockPunchResultSchema = z.object({
  entry: attendanceEntrySchema,
  selfieAttachmentId: z.string().nullable(),
});

/**
 * Only the fields the Sell screen shows after creating/confirming a
 * document — the full wire shape (`SalesInvoiceDTO` in `apps/web/src/data/hooks.ts`)
 * carries far more. Unlisted keys parse through untouched; zod only checks
 * what is named here.
 */
export const salesInvoiceResultSchema = z.object({
  id: z.string(),
  docNo: z.string().nullable(),
  status: z.string(),
  remainingBalance: z.string().optional(),
  totals: z.object({ grandTotal: z.string() }).optional(),
});

export const salesQuoteResultSchema = z.object({
  id: z.string(),
  docNo: z.string().nullable(),
  status: z.string(),
});

export type ItemStockDTO = z.infer<typeof itemStockSchema>;
export type SelfClockStatusResponseDTO = z.infer<typeof selfClockStatusSchema>;
export type SelfClockPunchResultResponseDTO = z.infer<typeof selfClockPunchResultSchema>;
export type SalesInvoiceResultDTO = z.infer<typeof salesInvoiceResultSchema>;
export type SalesQuoteResultDTO = z.infer<typeof salesQuoteResultSchema>;
