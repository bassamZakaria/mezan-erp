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

  it("catalogues 14 entity types with no duplicates", () => {
    expect(ATTACHMENT_ENTITY_TYPES).toHaveLength(14);
    expect(new Set(ATTACHMENT_ENTITY_TYPES).size).toBe(14);
  });
});
