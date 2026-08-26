import type { Attachment, AttachmentRepository } from "./attachment.js";
import { AttachmentNotFoundError } from "./errors.js";

/**
 * A real delete, not a void: an attachment is not an accounting record, so
 * there is nothing to reverse. The caller is responsible for the permission
 * check — it depends on the entity the attachment hangs off.
 */
export async function deleteAttachment(id: string, repo: AttachmentRepository): Promise<Attachment> {
  const existing = await repo.findById(id);
  if (!existing) throw new AttachmentNotFoundError(id);
  await repo.delete(id);
  return existing;
}
