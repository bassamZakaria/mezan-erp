import { isAttachmentEntityType, type Attachment, type AttachmentEntityType, type AttachmentRepository } from "./attachment.js";
import { DuplicateAttachmentIdError, InvalidAttachmentError } from "./errors.js";

/** 5 MiB. The store keeps bytes in the SQLite file, which the desktop backup copies whole. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export interface CreateAttachmentCommand {
  readonly id?: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly fileName: string;
  readonly mimeType?: string | null;
  readonly notes?: string | null;
  readonly bytes: Uint8Array;
  readonly uploadedBy: string;
  readonly uploadedAt?: string;
}

const DEFAULT_MIME = "application/octet-stream";

/**
 * A stored file name is never used to build a path, but it IS echoed into a
 * Content-Disposition header by any consumer that serves the bytes directly,
 * so the separators and control characters come off here rather than at each
 * call site.
 */
export function sanitizeAttachmentFileName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || ch === "/" || ch === "\\") continue;
    out += ch;
  }
  return out.trim().slice(0, 200);
}

export function collectAttachmentErrors(command: CreateAttachmentCommand): string[] {
  const reasons: string[] = [];
  if (!isAttachmentEntityType(command.entityType)) reasons.push(`unknown entityType '${command.entityType}'`);
  if (!command.entityId.trim()) reasons.push("entityId is required");
  if (!sanitizeAttachmentFileName(command.fileName)) reasons.push("fileName is required");
  if (command.bytes.byteLength === 0) reasons.push("an empty file cannot be attached");
  if (command.bytes.byteLength > ATTACHMENT_MAX_BYTES) {
    reasons.push(`file is ${command.bytes.byteLength} bytes, over the ${ATTACHMENT_MAX_BYTES} byte limit`);
  }
  return reasons;
}

export async function createAttachment(
  command: CreateAttachmentCommand,
  repo: AttachmentRepository,
  now: () => Date = () => new Date(),
): Promise<Attachment> {
  const reasons = collectAttachmentErrors(command);
  if (reasons.length > 0) throw new InvalidAttachmentError(reasons);

  const id = command.id?.trim() || `ATT-${now().getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  if (await repo.findById(id)) throw new DuplicateAttachmentIdError(id);

  const attachment: Attachment = {
    id,
    entityType: command.entityType as AttachmentEntityType,
    entityId: command.entityId.trim(),
    fileName: sanitizeAttachmentFileName(command.fileName),
    mimeType: command.mimeType?.trim() || DEFAULT_MIME,
    byteSize: command.bytes.byteLength,
    uploadedBy: command.uploadedBy,
    uploadedAt: command.uploadedAt ?? now().toISOString(),
    notes: command.notes?.trim() || null,
  };

  await repo.create(attachment, command.bytes);
  return attachment;
}
