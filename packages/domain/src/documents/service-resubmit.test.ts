import { describe, expect, it } from "vitest";
import { RecordingAuditSink } from "../gl/test-helpers/in-memory-ledger-repository.js";
import {
  decideApproval,
  type ApprovalRequestRecord,
  type ApprovalRequestRepository,
  type GateConfig,
  type GateableActionType,
} from "../workflow/index.js";
import type { DocumentTypeDefinition } from "./document.js";
import { buildEffects } from "./effects.js";
import { DocumentResubmitRefusedError } from "./errors.js";
import { createDocumentWorkflowGate } from "./journal-document.js";
import { DocumentService } from "./service.js";
import { InMemoryDocumentRepository } from "./test-helpers/in-memory-document-repository.js";

interface Line {
  readonly note: string;
}

const GATED: DocumentTypeDefinition<Line> = {
  code: "FAKE_DOC",
  labelAr: "مستند تجريبي",
  confirmedStatus: "confirmed",
  numberingSequence: null,
  gateActionType: "SALES_RETURN_CONFIRM",
  describeEffects: () => buildEffects({ effects: [{ kind: "info", description: "test" }] }),
};

function inMemoryRequests(): ApprovalRequestRepository {
  const rows = new Map<string, ApprovalRequestRecord>();
  return {
    list: async () => [...rows.values()],
    findById: async (id) => rows.get(id) ?? null,
    save: async (record) => {
      rows.set(record.id, record);
    },
    listPendingForRoles: async () => [...rows.values()].filter((row) => row.status === "pending"),
    listBySubmitter: async (submittedBy) => [...rows.values()].filter((row) => row.submittedBy === submittedBy),
  };
}

async function heldDocument() {
  const repo = new InMemoryDocumentRepository<Line>();
  const requests = inMemoryRequests();
  const audit = new RecordingAuditSink();
  const workflow = createDocumentWorkflowGate((actionType: GateableActionType): GateConfig => ({ actionType, steps: [{ role: "manager" }] }), requests);
  const service = new DocumentService(GATED, { repo, workflow, audit });
  await service.createDraft({ id: "d1", date: "2026-08-22", memo: "", lines: [] });
  expect((await service.confirm("d1", { actor: "clerk" })).held).toBe(true);
  const decide = (decision: "approve" | "reject") =>
    decideApproval("d1:confirm", { actorId: "boss", actorRoles: ["manager"], decision, comment: "سبب" }, requests);
  return { service, requests, audit, decide };
}

describe("DocumentService.resubmit", () => {
  it("returns a rejected document to pending under the same request, keeps the rejection and audits the caller", async () => {
    const { service, requests, audit, decide } = await heldDocument();
    await decide("reject");
    await service.returnToDraft("d1");

    const resubmitted = await service.resubmit("d1", { actor: "clerk-2" });

    expect([resubmitted.status, resubmitted.workflowRequestId]).toEqual(["pending", "d1:confirm"]);
    const request = await requests.findById("d1:confirm");
    expect([request?.status, request?.submittedBy, request?.decisions.map((d) => d.kind)]).toEqual(["pending", "clerk-2", ["reject"]]);
    expect(audit.events.map((event) => [event.action, event.actor])).toEqual([["RETURN_TO_DRAFT", "system"], ["RESUBMIT", "clerk-2"]]);
    expect((await service.approvalsOf([resubmitted])).get("d1")).toEqual({ status: "pending", rejectionReason: "سبب", rejectedBy: "boss" });
  });

  it("refuses an approved request without reopening it, so the approval still posts the document", async () => {
    const { service, requests, audit, decide } = await heldDocument();
    await decide("approve");
    await service.returnToDraft("d1");

    await expect(service.resubmit("d1", { actor: "clerk" })).rejects.toBeInstanceOf(DocumentResubmitRefusedError);

    expect((await requests.findById("d1:confirm"))?.status).toBe("approved");
    expect(audit.events.map((event) => event.action)).toEqual(["RETURN_TO_DRAFT"]);
    expect((await service.confirm("d1", { actor: "clerk" })).document.status).toBe("confirmed");
  });

  it("refuses a pending request and a document that was never submitted", async () => {
    const { service, requests } = await heldDocument();
    await expect(service.resubmit("d1", { actor: "clerk" })).rejects.toBeInstanceOf(DocumentResubmitRefusedError);
    expect((await requests.findById("d1:confirm"))?.status).toBe("pending");

    await service.createDraft({ id: "d2", date: "2026-08-22", memo: "", lines: [] });
    await expect(service.resubmit("d2", { actor: "clerk" })).rejects.toBeInstanceOf(DocumentResubmitRefusedError);
    expect(await requests.findById("d2:confirm")).toBeNull();
  });
});
