import { describe, it, expect } from "vitest";
import { ATTACHMENT_ENTITY_TYPES, isAttachmentEntityType } from "./attachment.js";

describe("isAttachmentEntityType", () => {
  it("is true for every catalogued entity type", () => {
    for (const type of ATTACHMENT_ENTITY_TYPES) {
      expect(isAttachmentEntityType(type)).toBe(true);
    }
  });

  it("is false for an unknown value", () => {
    expect(isAttachmentEntityType("not-a-real-entity")).toBe(false);
  });

  it("is false for the empty string", () => {
    expect(isAttachmentEntityType("")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isAttachmentEntityType("Item")).toBe(false);
  });

  it("catalogues 15 entity types with no duplicates", () => {
    // 14 → 15 when HR attendance gained attachments (the web clock's selfie
    // rides on an attendance entry). The count is pinned so a type added
    // without a route that accepts it, or a type deleted while its uploads
    // stay, has to be noticed here.
    expect(ATTACHMENT_ENTITY_TYPES).toHaveLength(15);
    expect(new Set(ATTACHMENT_ENTITY_TYPES).size).toBe(15);
    expect(ATTACHMENT_ENTITY_TYPES).toContain("attendance");
  });
});
