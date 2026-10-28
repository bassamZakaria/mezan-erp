import { ATTACHMENT_ENTITY_PERMISSIONS } from "./entity-type.js";

export enum AttachmentPermission {
  View = "admin.attachment.view",
  Upload = "admin.attachment.upload",
  Delete = "admin.attachment.delete",
}

/** SECURITY: where this feature is on an attachment permission is demanded IN ADDITION to the parent entity's rights — it only narrows. */
export const SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE = "attachments.separate_permissions";

export function attachmentPermissionSuccessors(): ReadonlyMap<string, readonly AttachmentPermission[]> {
  const successors = new Map<string, Set<AttachmentPermission>>();
  const add = (code: string, granted: readonly AttachmentPermission[]) => {
    const held = successors.get(code) ?? new Set<AttachmentPermission>();
    for (const permission of granted) held.add(permission);
    successors.set(code, held);
  };
  for (const { viewAny, manage } of Object.values(ATTACHMENT_ENTITY_PERMISSIONS)) {
    for (const code of viewAny) add(code, [AttachmentPermission.View]);
    add(manage, [AttachmentPermission.View, AttachmentPermission.Upload, AttachmentPermission.Delete]);
  }
  return new Map([...successors].map(([code, granted]) => [code, [...granted]]));
}

export function withAttachmentPermissions(codes: readonly string[]): string[] {
  const successors = attachmentPermissionSuccessors();
  const implied = codes.flatMap((code) => successors.get(code) ?? []);
  return [...new Set([...codes, ...implied])];
}
