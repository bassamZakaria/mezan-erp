import { insertOnly } from "../records/test-helpers/insert-only.js";
import { describe, it, expect } from "vitest";
import {
  createAttachment,
  sanitizeAttachmentFileName,
  collectAttachmentErrors,
  ATTACHMENT_MAX_BYTES,
  type CreateAttachmentCommand,
} from "./create-attachment.js";
import { InvalidAttachmentError } from "./errors.js";
import type { Attachment, AttachmentContent, AttachmentRepository } from "./attachment.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

class FakeAttachmentRepository implements AttachmentRepository {
  readonly rows = new Map<string, Attachment>();
  readonly created: { attachment: Attachment; bytes: Uint8Array }[] = [];
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
  async create(attachment: Attachment, bytes: Uint8Array): Promise<void> {
    insertOnly(this.rows, attachment.id, attachment);
    this.created.push({ attachment, bytes });
  }
  async totalBytes(): Promise<number> {
    return [...this.rows.values()].reduce((sum, a) => sum + a.byteSize, 0);
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

function cmd(overrides: Partial<CreateAttachmentCommand> = {}): CreateAttachmentCommand {
  return {
    id: "att-1",
    entityType: "item",
    entityId: "item-1",
    fileName: "photo.jpg",
    mimeType: "image/jpeg",
    bytes: new Uint8Array([1, 2, 3]),
    uploadedBy: "u1",
    uploadedAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("sanitizeAttachmentFileName", () => {
  it("strips control characters, DEL, and path separators", () => {
    expect(sanitizeAttachmentFileName("abc")).toBe("abc");
  });

  it("neutralizes a path-traversal filename by removing every '/' and '\\\\' — no separator survives to build a path", () => {
    const sanitized = sanitizeAttachmentFileName("../../etc/passwd");
    expect(sanitized).not.toContain("/");
    expect(sanitized).not.toContain("\\");
  });

  it("neutralizes a Windows-style traversal filename", () => {
    const sanitized = sanitizeAttachmentFileName("..\\..\\Windows\\System32\\config");
    expect(sanitized).not.toContain("\\");
    expect(sanitized).not.toContain("/");
  });

  it("trims surrounding whitespace and caps length at 200", () => {
    expect(sanitizeAttachmentFileName("  a.txt  ")).toBe("a.txt");
    expect(sanitizeAttachmentFileName("x".repeat(300)).length).toBe(200);
  });

  it("a filename of only separators sanitizes to empty (which create-attachment then refuses)", () => {
    expect(sanitizeAttachmentFileName("///\\\\\\")).toBe("");
  });
});

describe("collectAttachmentErrors", () => {
  it("returns no reasons for a valid command", () => {
    expect(collectAttachmentErrors(cmd())).toEqual([]);
  });

  it("flags an unknown entityType", () => {
    expect(collectAttachmentErrors(cmd({ entityType: "not-a-real-entity" }))).toContain(
      "نوع الكيان غير معروف 'not-a-real-entity'",
    );
  });

  it("flags a blank entityId — the document/entity this attachment would reference is not identified", () => {
    expect(collectAttachmentErrors(cmd({ entityId: " " }))).toContain("معرّف الكيان مطلوب");
  });

  it("flags a blank fileName", () => {
    expect(collectAttachmentErrors(cmd({ fileName: "" }))).toContain("اسم الملف مطلوب");
  });

  it("flags a path-traversal-only filename as blank once separators are stripped", () => {
    expect(collectAttachmentErrors(cmd({ fileName: "///" }))).toContain("اسم الملف مطلوب");
  });

  it("flags an empty file", () => {
    expect(collectAttachmentErrors(cmd({ bytes: new Uint8Array(0) }))).toContain(
      "لا يمكن إرفاق ملف فارغ",
    );
  });

  it("flags a file exactly one byte over the limit", () => {
    const bytes = new Uint8Array(ATTACHMENT_MAX_BYTES + 1);
    const reasons = collectAttachmentErrors(cmd({ bytes }));
    expect(reasons.some((r) => r.includes("يتجاوز"))).toBe(true);
  });

  it("accepts a file exactly at the byte limit (boundary)", () => {
    const bytes = new Uint8Array(ATTACHMENT_MAX_BYTES);
    expect(collectAttachmentErrors(cmd({ bytes }))).toEqual([]);
  });

  it("does not reject any mimeType — this module has no allow-list; every mimeType currently passes through", () => {
    // Documents current behaviour: there is no content-type restriction here,
    // so a caller can attach an executable's mimeType. A disallowed-type check
    // does not exist in this module — see the report for this gap.
    expect(collectAttachmentErrors(cmd({ mimeType: "application/x-msdownload" }))).toEqual([]);
  });
});

describe("createAttachment — happy path", () => {
  it("persists a sanitized attachment and returns it", async () => {
    const repo = new FakeAttachmentRepository();
    const attachment = await createAttachment(cmd(), repo);
    expect(attachment.id).toBe("att-1");
    expect(attachment.fileName).toBe("photo.jpg");
    expect(attachment.byteSize).toBe(3);
    expect(repo.created).toHaveLength(1);
  });

  it("defaults mimeType to application/octet-stream when omitted", async () => {
    const repo = new FakeAttachmentRepository();
    const attachment = await createAttachment(cmd({ mimeType: null }), repo);
    expect(attachment.mimeType).toBe("application/octet-stream");
  });

  it("sanitizes a path-traversal filename before storing it", async () => {
    const repo = new FakeAttachmentRepository();
    const attachment = await createAttachment(cmd({ fileName: "../../etc/passwd" }), repo);
    expect(attachment.fileName).not.toContain("/");
  });

  it("generates an id when none is supplied", async () => {
    const repo = new FakeAttachmentRepository();
    const attachment = await createAttachment(cmd({ id: undefined }), repo);
    expect(attachment.id).toMatch(/^ATT-/);
  });

  it("trims notes to null when blank", async () => {
    const repo = new FakeAttachmentRepository();
    const attachment = await createAttachment(cmd({ notes: "  " }), repo);
    expect(attachment.notes).toBeNull();
  });
});

describe("createAttachment — refusals", () => {
  it("throws InvalidAttachmentError for an empty file", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(createAttachment(cmd({ bytes: new Uint8Array(0) }), repo)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
  });

  it("throws InvalidAttachmentError for an oversized file", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(
      createAttachment(cmd({ bytes: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) }), repo),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
  });

  it("throws InvalidAttachmentError for an unknown entityType (a reference to a document type that does not exist)", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(createAttachment(cmd({ entityType: "not-a-real-entity" }), repo)).rejects.toBeInstanceOf(
      InvalidAttachmentError,
    );
  });

  it("refuses a caller-supplied id that already exists as a duplicate record id", async () => {
    const repo = new FakeAttachmentRepository();
    repo.rows.set("att-1", { ...cmd(), byteSize: 3, mimeType: "image/jpeg", entityType: "item", notes: null, uploadedAt: "x" } as unknown as Attachment);
    await expect(createAttachment(cmd(), repo)).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });

  it("does not persist anything when validation fails", async () => {
    const repo = new FakeAttachmentRepository();
    await expect(createAttachment(cmd({ bytes: new Uint8Array(0) }), repo)).rejects.toThrow();
    expect(repo.created).toEqual([]);
  });
});
