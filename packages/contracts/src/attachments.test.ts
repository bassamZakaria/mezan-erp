import { describe, it, expect } from "vitest";
import { attachmentEntityTypeSchema, attachmentSchema, createAttachmentSchema, attachmentContentSchema } from "./attachments.js";

describe("attachmentEntityTypeSchema", () => {
  it("accepts each known entity type", () => {
    for (const t of ["item", "customer", "supplier", "sales-invoice", "voucher"]) {
      expect(attachmentEntityTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects an entity type outside the enum", () => {
    expect(attachmentEntityTypeSchema.safeParse("project").success).toBe(false);
  });
});

describe("attachmentSchema", () => {
  const attachment = {
    id: "att-1",
    entityType: "sales-invoice" as const,
    entityId: "si-1",
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    byteSize: 51200,
    uploadedBy: "user-1",
    uploadedAt: "2026-08-30T10:00:00.000Z",
    notes: null,
  };

  it("accepts a minimal valid attachment and preserves every field verbatim", () => {
    const result = attachmentSchema.safeParse(attachment);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(attachment);
  });

  it("rejects an attachment missing entityId", () => {
    const { entityId, ...rest } = attachment;
    const result = attachmentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("entityId");
  });

  it("rejects a negative byteSize", () => {
    const result = attachmentSchema.safeParse({ ...attachment, byteSize: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum entityType", () => {
    const result = attachmentSchema.safeParse({ ...attachment, entityType: "project" });
    expect(result.success).toBe(false);
  });

  it("does not carry the file bytes — only createAttachmentSchema and attachmentContentSchema do", () => {
    expect(attachment).not.toHaveProperty("contentBase64");
  });

  it("silently strips an unrecognised branchId — a real dimension a caller could lose", () => {
    const result = attachmentSchema.safeParse({ ...attachment, branchId: "branch-1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("branchId");
  });
});

describe("createAttachmentSchema", () => {
  const create = {
    entityType: "sales-invoice" as const,
    entityId: "si-1",
    fileName: "invoice.pdf",
    contentBase64: "JVBERi0xLjQK",
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createAttachmentSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("rejects a payload missing contentBase64", () => {
    const { contentBase64, ...rest } = create;
    const result = createAttachmentSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("contentBase64");
  });

  it("rejects an empty contentBase64", () => {
    const result = createAttachmentSchema.safeParse({ ...create, contentBase64: "" });
    expect(result.success).toBe(false);
  });

  it("silently strips a caller-supplied byteSize — the server derives it from the decoded bytes", () => {
    const result = createAttachmentSchema.safeParse({ ...create, byteSize: 999999 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("byteSize");
  });
});

describe("attachmentContentSchema", () => {
  const withContent = {
    id: "att-1",
    entityType: "sales-invoice" as const,
    entityId: "si-1",
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    byteSize: 51200,
    uploadedBy: "user-1",
    uploadedAt: "2026-08-30T10:00:00.000Z",
    notes: null,
    contentBase64: "JVBERi0xLjQK",
  };

  it("accepts a minimal valid payload and preserves every field, including the bytes", () => {
    const result = attachmentContentSchema.safeParse(withContent);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(withContent);
  });

  it("accepts an empty contentBase64 — unlike create, this schema does not require non-empty", () => {
    const result = attachmentContentSchema.safeParse({ ...withContent, contentBase64: "" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing contentBase64 entirely", () => {
    const { contentBase64, ...rest } = withContent;
    const result = attachmentContentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
