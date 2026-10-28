import { describe, expect, it } from "vitest";
import { AttachmentPermission, attachmentPermissionSuccessors, withAttachmentPermissions } from "./attachment-permissions.js";
import { ATTACHMENT_ENTITY_PERMISSIONS } from "./entity-type.js";
import { isKnownPermission } from "../permissions/index.js";

describe("#125 attachment permissions a role already had through its parent rights", () => {
  it("every attachment permission is a catalog code", () => {
    for (const code of Object.values(AttachmentPermission)) expect(isKnownPermission(code)).toBe(true);
  });

  it("a read right on an entity carries view only; its write right carries view, upload and delete", () => {
    expect(withAttachmentPermissions(["sales.invoice.view_own"])).toEqual(["sales.invoice.view_own", AttachmentPermission.View]);
    expect(new Set(withAttachmentPermissions(["purchases.receipt.create"]))).toEqual(
      new Set(["purchases.receipt.create", AttachmentPermission.View, AttachmentPermission.Upload, AttachmentPermission.Delete]),
    );
    expect(withAttachmentPermissions(["accounting.coa.view"])).toEqual(["accounting.coa.view"]);
  });

  it("covers every entity type's read tiers and write right", () => {
    const successors = attachmentPermissionSuccessors();
    for (const { viewAny, manage } of Object.values(ATTACHMENT_ENTITY_PERMISSIONS)) {
      for (const code of viewAny) expect(successors.get(code)).toContain(AttachmentPermission.View);
      expect(successors.get(manage)).toEqual(expect.arrayContaining([AttachmentPermission.Upload, AttachmentPermission.Delete]));
    }
  });

  it("a role holding only a leaf right gets the attachment rights of the parent right it depends on", () => {
    expect(withAttachmentPermissions(["sales.invoice.confirm"])).toEqual(["sales.invoice.confirm", AttachmentPermission.View]);
    expect(attachmentPermissionSuccessors().get("sales.invoice.confirm")).toEqual([AttachmentPermission.View]);
  });
});
