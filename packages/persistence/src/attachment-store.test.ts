import { describe, it, expect } from "vitest";
import { createSqliteAttachmentStore } from "./attachment-store.js";

function baseAttachment(overrides: Partial<{ id: string; entityId: string; notes: string | null; uploadedAt: string }> = {}) {
  return {
    id: overrides.id ?? "att-1",
    entityType: "sales-invoice" as const,
    entityId: overrides.entityId ?? "inv-1",
    fileName: "فاتورة.pdf",
    mimeType: "application/pdf",
    byteSize: 4,
    uploadedBy: "user-1",
    uploadedAt: overrides.uploadedAt ?? "2026-01-01T00:00:00.000Z",
    notes: overrides.notes !== undefined ? overrides.notes : null,
  };
}

describe("SqliteAttachmentRepository", () => {
  it("round-trips the exact bytes, including every byte value 0-255", async () => {
    const store = createSqliteAttachmentStore();
    try {
      const bytes = new Uint8Array(256);
      for (let i = 0; i < 256; i++) bytes[i] = i;
      await store.attachments.create({ ...baseAttachment(), byteSize: bytes.length }, bytes);
      const content = await store.attachments.readContent("att-1");
      expect(content?.bytes).toEqual(bytes);
      expect(content?.bytes.length).toBe(256);
    } finally {
      store.close();
    }
  });

  it("readContent returns both the metadata and the bytes together", async () => {
    const store = createSqliteAttachmentStore();
    try {
      const bytes = new TextEncoder().encode("PDF-DATA");
      await store.attachments.create({ ...baseAttachment(), byteSize: bytes.length }, bytes);
      const content = await store.attachments.readContent("att-1");
      expect(content?.attachment.fileName).toBe("فاتورة.pdf");
      expect(content?.attachment.byteSize).toBe(bytes.length);
      expect(new TextDecoder().decode(content!.bytes)).toBe("PDF-DATA");
    } finally {
      store.close();
    }
  });

  it("readContent returns null for an id with no attachment", async () => {
    const store = createSqliteAttachmentStore();
    try {
      expect(await store.attachments.readContent("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("round-trips notes as null", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(baseAttachment({ notes: null }), new Uint8Array([1, 2, 3, 4]));
      const loaded = await store.attachments.findById("att-1");
      expect(loaded?.notes).toBeNull();
    } finally {
      store.close();
    }
  });

  it("findById returns metadata without needing to read the (potentially large) content", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(baseAttachment(), new Uint8Array([1, 2, 3, 4]));
      const loaded = await store.attachments.findById("att-1");
      expect(loaded).toEqual(baseAttachment());
      expect(await store.attachments.findById("does-not-exist")).toBeNull();
    } finally {
      store.close();
    }
  });

  it("list(entityType, entityId) filters to that entity, and an entity with no attachments returns an empty list", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(baseAttachment({ id: "att-1", entityId: "inv-1" }), new Uint8Array([1]));
      await store.attachments.create(baseAttachment({ id: "att-2", entityId: "inv-2" }), new Uint8Array([2]));
      const forInv1 = await store.attachments.list("sales-invoice", "inv-1");
      expect(forInv1.map((a) => a.id)).toEqual(["att-1"]);
      expect(await store.attachments.list("sales-invoice", "inv-does-not-exist")).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("list() does not confuse two different entity types with the same entity id", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(
        { ...baseAttachment({ id: "att-invoice" }), entityType: "sales-invoice", entityId: "shared-id" },
        new Uint8Array([1]),
      );
      await store.attachments.create(
        { ...baseAttachment({ id: "att-item" }), entityType: "item", entityId: "shared-id" },
        new Uint8Array([2]),
      );
      expect((await store.attachments.list("sales-invoice", "shared-id")).map((a) => a.id)).toEqual(["att-invoice"]);
      expect((await store.attachments.list("item", "shared-id")).map((a) => a.id)).toEqual(["att-item"]);
    } finally {
      store.close();
    }
  });

  it("listAll() returns attachments across every entity, ordered by uploaded_at DESC", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(baseAttachment({ id: "att-old", uploadedAt: "2026-01-01T00:00:00.000Z" }), new Uint8Array([1]));
      await store.attachments.create(baseAttachment({ id: "att-new", uploadedAt: "2026-02-01T00:00:00.000Z" }), new Uint8Array([2]));
      const all = await store.attachments.listAll();
      expect(all.map((a) => a.id)).toEqual(["att-new", "att-old"]);
    } finally {
      store.close();
    }
  });

  it("delete() removes the attachment, and it is gone from findById, readContent and list()", async () => {
    const store = createSqliteAttachmentStore();
    try {
      await store.attachments.create(baseAttachment(), new Uint8Array([1, 2, 3, 4]));
      await store.attachments.delete("att-1");
      expect(await store.attachments.findById("att-1")).toBeNull();
      expect(await store.attachments.readContent("att-1")).toBeNull();
      expect(await store.attachments.list("sales-invoice", "inv-1")).toEqual([]);
    } finally {
      store.close();
    }
  });
});
