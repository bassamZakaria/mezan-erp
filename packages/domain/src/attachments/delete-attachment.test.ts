import { insertOnly } from "../records/test-helpers/insert-only.js";
import { describe, it, expect } from "vitest";
import { deleteAttachment } from "./delete-attachment.js";
import { AttachmentNotFoundError } from "./errors.js";
import type { Attachment, AttachmentContent, AttachmentRepository } from "./attachment.js";

class FakeAttachmentRepository implements AttachmentRepository {
  readonly rows = new Map<string, Attachment>();
  readonly deleted: string[] = [];
  async list(entityType: string, entityId: string): Promise<Attachment[]> {
    return [...this.rows.values()].filter((a) => a.entityType === entityType && a.entityId === entityId);
  }
  async listAll(): Promise<Attachment[]> {
    return [...this.rows.values()];
  }
  async findById(id: string): Promise<Attachment | null> {
    return this.rows.get(id) ?? null;
  }
  async readContent(): Promise<AttachmentContent | null> {
    return null;
  }
  async create(attachment: Attachment): Promise<void> {
    insertOnly(this.rows, attachment.id, attachment);
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
    this.deleted.push(id);
  }
}

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "att-1",
    entityType: "item",
    entityId: "item-1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    byteSize: 100,
    uploadedBy: "u1",
    uploadedAt: "2026-08-22T10:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

describe("deleteAttachment", () => {
  it("deletes the row and returns the deleted attachment", async () => {
    const repo = new FakeAttachmentRepository();
    repo.rows.set("att-1", attachment());
    const deleted = await deleteAttachment("att-1", repo);
    expect(deleted.id).toBe("att-1");
    expect(repo.deleted).toEqual(["att-1"]);
    expect(await repo.findById("att-1")).toBeNull();
  });

  it("throws AttachmentNotFoundError for an unknown id and does not call delete", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(deleteAttachment("missing", repo)).rejects.toBeInstanceOf(AttachmentNotFoundError);
    expect(repo.deleted).toEqual([]);
  });

  it("refers to a document/entity that does not exist — findById returning null is exactly this case, and it is refused", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(deleteAttachment("att-for-deleted-invoice", repo)).rejects.toBeInstanceOf(AttachmentNotFoundError);
  });
});
