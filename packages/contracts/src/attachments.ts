import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contract for المرفقات (R1.4) — files attached to a document or to a
 * master-data entity.
 *
 * Bytes travel as base64 in JSON rather than as multipart, because the web app
 * and the desktop shell reach the same Hono app through different transports
 * (HTTP and an Electron IPC bridge that marshals a string body), and only a
 * JSON body behaves identically on both.
 */

export const attachmentEntityTypeSchema = z.enum([
  "item",
  "customer",
  "supplier",
  "employee",
  "sales-invoice",
  "sales-quote",
  "sales-return",
  "purchase-invoice",
  "purchase-order",
  "goods-receipt",
  "stock-adjustment",
  "stock-transfer",
  "work-order",
  "voucher",
  "attendance",
]);

export const attachmentSchema = z.object({
  id: z.string().min(1),
  entityType: attachmentEntityTypeSchema,
  entityId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  uploadedBy: z.string().min(1),
  uploadedAt: z.string().min(1),
  notes: z.string().nullable(),
});

export const createAttachmentSchema = z.object({
  id: clientSuppliedId.optional(),
  entityType: attachmentEntityTypeSchema,
  entityId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  /** The file's bytes, base64-encoded. */
  contentBase64: z.string().min(1),
});

export const attachmentContentSchema = attachmentSchema.extend({
  contentBase64: z.string(),
});

export type AttachmentEntityTypeDTO = z.infer<typeof attachmentEntityTypeSchema>;
export type AttachmentDTO = z.infer<typeof attachmentSchema>;
export type CreateAttachmentDTO = z.infer<typeof createAttachmentSchema>;
export type AttachmentContentDTO = z.infer<typeof attachmentContentSchema>;
