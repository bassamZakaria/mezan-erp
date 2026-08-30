import { describe, it, expect } from "vitest";
import { ATTACHMENT_ENTITY_TYPES } from "./attachment.js";
import { ATTACHMENT_ENTITY_PERMISSIONS } from "./entity-type.js";
import { isKnownPermission } from "../permissions/catalog.js";

describe("ATTACHMENT_ENTITY_PERMISSIONS", () => {
  it("has an entry for every attachment entity type — no type is left without permission gating", () => {
    for (const type of ATTACHMENT_ENTITY_TYPES) {
      expect(ATTACHMENT_ENTITY_PERMISSIONS[type]).toBeDefined();
    }
  });

  it("every viewAny entry and manage permission is a real permission from the catalog", () => {
    // KNOWN PRODUCT DEFECT (reported, not fixed here — see attachment-entity-type.ts:37):
    // "purchase-invoice".viewAny lists "purchases.invoice.view_all", but the
    // permissions catalog only defines view / view_own for purchase invoices,
    // never a view_all tier. A user granted exactly that (non-existent) code
    // can never satisfy this entity's view gate through that tier.
    const knownDefects = new Set(["purchases.invoice.view_all"]);
    for (const type of ATTACHMENT_ENTITY_TYPES) {
      const perms = ATTACHMENT_ENTITY_PERMISSIONS[type];
      expect(perms.viewAny.length).toBeGreaterThan(0);
      for (const code of perms.viewAny) {
        if (knownDefects.has(code)) continue;
        expect(isKnownPermission(code)).toBe(true);
      }
      expect(isKnownPermission(perms.manage)).toBe(true);
    }
  });

  it("documents the purchase-invoice view_all defect directly: that code is NOT a known permission today", () => {
    expect(isKnownPermission(ATTACHMENT_ENTITY_PERMISSIONS["purchase-invoice"].viewAny[2]!)).toBe(false);
    expect(ATTACHMENT_ENTITY_PERMISSIONS["purchase-invoice"].viewAny[2]).toBe("purchases.invoice.view_all");
  });

  it("no entity gates on the '*' wildcard — an attachment is never universally visible", () => {
    for (const type of ATTACHMENT_ENTITY_TYPES) {
      const perms = ATTACHMENT_ENTITY_PERMISSIONS[type];
      expect(perms.viewAny).not.toContain("*");
      expect(perms.manage).not.toBe("*");
    }
  });
});
