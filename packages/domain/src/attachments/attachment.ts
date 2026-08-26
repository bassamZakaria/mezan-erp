/**
 * المرفقات — files attached to a document or to a master-data entity.
 *
 * An attachment is IMMUTABLE once uploaded: the port exposes no update. It is
 * not an accounting record, so removal is a real delete rather than a void —
 * but it is permission-gated by the entity it hangs off (see `entity-type.ts`).
 */

export const ATTACHMENT_ENTITY_TYPES = [
  "item",
  "customer",
  "supplier",
  "employee",
  "sales-invoice",
  "purchase-invoice",
  "work-order",
  "voucher",
] as const;

export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export function isAttachmentEntityType(value: string): value is AttachmentEntityType {
  return (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(value);
}

export interface Attachment {
  readonly id: string;
  readonly entityType: AttachmentEntityType;
  readonly entityId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly uploadedBy: string;
  /** ISO-8601 instant. */
  readonly uploadedAt: string;
  readonly notes: string | null;
}

export interface AttachmentContent {
  readonly attachment: Attachment;
  readonly bytes: Uint8Array;
}

/**
 * Persistence port. There is deliberately no `update`: a stored file never
 * changes, so a correction is a delete plus a fresh upload and both show in the
 * audit trail.
 */
export interface AttachmentRepository {
  list(entityType: AttachmentEntityType, entityId: string): Promise<Attachment[]>;
  listAll(): Promise<Attachment[]>;
  findById(id: string): Promise<Attachment | null>;
  readContent(id: string): Promise<AttachmentContent | null>;
  create(attachment: Attachment, bytes: Uint8Array): Promise<void>;
  delete(id: string): Promise<void>;
}
