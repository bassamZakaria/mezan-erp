import { ATTACHMENT_ENTITY_PERMISSIONS } from "./entity-type.js";
import { PERMISSIONS } from "../permissions/catalog.js";
import { resolvePermissions } from "../permissions/resolve.js";

export enum AttachmentPermission {
  View = "admin.attachment.view",
  Upload = "admin.attachment.upload",
  Delete = "admin.attachment.delete",
}

/** SECURITY: where this feature is on an attachment permission is demanded IN ADDITION to the parent entity's rights — it only narrows. */
export const SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE = "attachments.separate_permissions";

function directAttachmentGrants(): ReadonlyMap<string, ReadonlySet<AttachmentPermission>> {
  const grants = new Map<string, Set<AttachmentPermission>>();
  const add = (code: string, granted: readonly AttachmentPermission[]) => {
    const held = grants.get(code) ?? new Set<AttachmentPermission>();
    for (const permission of granted) held.add(permission);
    grants.set(code, held);
  };
  for (const { viewAny, manage } of Object.values(ATTACHMENT_ENTITY_PERMISSIONS)) {
    for (const code of viewAny) add(code, [AttachmentPermission.View]);
    add(manage, [AttachmentPermission.View, AttachmentPermission.Upload, AttachmentPermission.Delete]);
  }
  return grants;
}

function impliedAttachmentPermissions(codes: Iterable<string>, direct: ReadonlyMap<string, ReadonlySet<AttachmentPermission>>): Set<AttachmentPermission> {
  const implied = new Set<AttachmentPermission>();
  for (const code of resolvePermissions(codes)) for (const permission of direct.get(code) ?? []) implied.add(permission);
  return implied;
}

export function attachmentPermissionSuccessors(): ReadonlyMap<string, readonly AttachmentPermission[]> {
  const direct = directAttachmentGrants();
  const successors = new Map<string, readonly AttachmentPermission[]>();
  for (const code of new Set([...direct.keys(), ...PERMISSIONS.map((permission) => permission.code)])) {
    const implied = impliedAttachmentPermissions([code], direct);
    if (implied.size > 0) successors.set(code, [...implied]);
  }
  return successors;
}

export function withAttachmentPermissions(codes: readonly string[]): string[] {
  return [...new Set([...codes, ...impliedAttachmentPermissions(codes, directAttachmentGrants())])];
}
