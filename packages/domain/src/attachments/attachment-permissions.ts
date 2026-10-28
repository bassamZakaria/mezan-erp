import { ATTACHMENT_ENTITY_PERMISSIONS } from "./entity-type.js";

export enum AttachmentPermission {
  View = "admin.attachment.view",
  Upload = "admin.attachment.upload",
  Delete = "admin.attachment.delete",
}

/**
 * A plan or licence feature. Where it is on, an attachment needs its own
 * permission IN ADDITION to the rights the parent entity already demands;
 * where it is off, the parent entity alone governs, as it always has.
 */
export const SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE = "attachments.separate_permissions";

/**
 * The attachment permissions each parent right stood for before they existed:
 * reading an entity read its files, writing it uploaded and deleted them. Used
 * to give existing and seeded roles exactly the reach they had.
 */
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
