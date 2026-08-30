import { describe, it, expect } from "vitest";
import type { FrameworkDocument } from "../document.js";
import { InMemoryDocumentRepository, RecordingDocumentEventPublisher } from "./in-memory-document-repository.js";

interface Line {
  readonly note: string;
}

function doc(id: string, overrides: Partial<FrameworkDocument<Line>> = {}): FrameworkDocument<Line> {
  return {
    id,
    docType: "FAKE",
    docNo: null,
    date: "2026-08-22",
    memo: "m",
    status: "draft",
    lines: [],
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

describe("InMemoryDocumentRepository", () => {
  it("save then findById returns the saved document", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    await repo.save(doc("d1"));
    expect((await repo.findById("d1"))?.id).toBe("d1");
  });

  it("findById returns null for an unknown id", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    expect(await repo.findById("missing")).toBeNull();
  });

  it("update overwrites the stored document", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    await repo.save(doc("d1", { status: "draft" }));
    await repo.update(doc("d1", { status: "confirmed" }));
    expect((await repo.findById("d1"))?.status).toBe("confirmed");
  });

  it("list filters by status", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    await repo.save(doc("d1", { status: "draft", date: "2026-08-01" }));
    await repo.save(doc("d2", { status: "confirmed", date: "2026-08-02" }));
    const confirmed = await repo.list({ status: "confirmed" });
    expect(confirmed.map((d) => d.id)).toEqual(["d2"]);
  });

  it("list filters by fromDate/toDate and sorts ascending by date", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    await repo.save(doc("d3", { date: "2026-08-03" }));
    await repo.save(doc("d1", { date: "2026-08-01" }));
    await repo.save(doc("d2", { date: "2026-08-02" }));
    const inRange = await repo.list({ fromDate: "2026-08-02", toDate: "2026-08-03" });
    expect(inRange.map((d) => d.id)).toEqual(["d2", "d3"]);
  });

  it("list with no filter returns everything", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    await repo.save(doc("d1"));
    await repo.save(doc("d2"));
    expect((await repo.list()).length).toBe(2);
  });

  it("transaction just runs the callback and returns its result", async () => {
    const repo = new InMemoryDocumentRepository<Line>();
    const result = await repo.transaction(async () => {
      await repo.save(doc("d1"));
      return 42;
    });
    expect(result).toBe(42);
    expect(await repo.findById("d1")).not.toBeNull();
  });
});

describe("RecordingDocumentEventPublisher", () => {
  it("records every published event in order", () => {
    const publisher = new RecordingDocumentEventPublisher();
    publisher.publish({ type: "DOCUMENT_DRAFTED", docType: "FAKE", docId: "d1", docNo: null, occurredAt: "2026-08-22T10:00:00.000Z" });
    publisher.publish({ type: "DOCUMENT_CONFIRMED", docType: "FAKE", docId: "d1", docNo: "F-1", occurredAt: "2026-08-22T10:01:00.000Z" });
    expect(publisher.events.map((e) => e.type)).toEqual(["DOCUMENT_DRAFTED", "DOCUMENT_CONFIRMED"]);
  });
});
