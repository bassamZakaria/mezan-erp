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
import { createDocumentWorkflowGate } from "./journal-document.js";
import { DocumentService } from "./service.js";
import { InMemoryDocumentRepository } from "./test-helpers/in-memory-document-repository.js";

interface Line {
  readonly note: string;
}

enum AuditedAct {
  Confirm = "CONFIRM",
  Cancel = "CANCEL",
  Reverse = "REVERSE",
  Resubmit = "RESUBMIT",
  ReturnToDraft = "RETURN_TO_DRAFT",
}

const CALLER = "USER-CLERK";
const SERVICE_DEFAULT = "USER-WIRED";

function definition(gated: boolean): DocumentTypeDefinition<Line> {
  return {
    code: "FAKE_DOC",
    labelAr: "مستند تجريبي",
    confirmedStatus: "confirmed",
    numberingSequence: null,
    gateActionType: gated ? "SALES_RETURN_CONFIRM" : null,
    describeEffects: () => buildEffects({ effects: [{ kind: "info", description: "test" }] }),
  };
}

function requestStore(): ApprovalRequestRepository {
  const rows = new Map<string, ApprovalRequestRecord>();
  return {
    list: async () => [...rows.values()],
    findById: async (id) => rows.get(id) ?? null,
    save: async (record) => {
      rows.set(record.id, record);
    },
    insert: async (record) => {
      rows.set(record.id, record);
    },
    listPendingForRoles: async () => [...rows.values()],
    listBySubmitter: async () => [...rows.values()],
  };
}

function arrange(act: AuditedAct, serviceActor?: string) {
  const audit = new RecordingAuditSink();
  const requests = requestStore();
  const gated = act === AuditedAct.Resubmit || act === AuditedAct.ReturnToDraft;
  const workflow = createDocumentWorkflowGate((actionType: GateableActionType): GateConfig => ({ actionType, steps: [{ role: "manager" }] }), requests);
  const service = new DocumentService(definition(gated), { repo: new InMemoryDocumentRepository<Line>(), audit, workflow, actor: serviceActor });
  return { audit, requests, service };
}

async function perform(act: AuditedAct, service: DocumentService<Line>, requests: ApprovalRequestRepository, actor: string | undefined) {
  await service.createDraft({ id: "d1", date: "2026-08-22", memo: "", lines: [] });
  switch (act) {
    case AuditedAct.Confirm:
      await service.confirm("d1", { actor });
      return;
    case AuditedAct.Cancel:
      await service.cancel("d1", { actor });
      return;
    case AuditedAct.Reverse:
      await service.confirm("d1", { actor: "someone-else" });
      await service.reverse("d1", { reversalId: "d1-rev", actor });
      return;
    case AuditedAct.Resubmit:
      await service.confirm("d1", { actor: "someone-else" });
      await decideApproval("d1:confirm", { actorId: "boss", actorRoles: ["manager"], decision: "reject" }, requests);
      await service.returnToDraft("d1");
      await service.resubmit("d1", { actor });
      return;
    case AuditedAct.ReturnToDraft:
      await service.confirm("d1", { actor: "someone-else" });
      await service.returnToDraft("d1", { actor });
      return;
  }
}

describe.each(Object.values(AuditedAct))("DocumentService audits %s", (act) => {
  const actorsOf = (audit: RecordingAuditSink) => audit.events.filter((event) => event.action === act).map((event) => event.actor);

  it("as the caller who did it, over the actor the service was wired with", async () => {
    const { audit, requests, service } = arrange(act, SERVICE_DEFAULT);
    await perform(act, service, requests, CALLER);
    expect(actorsOf(audit)).toEqual([CALLER]);
  });

  it("as the wired actor when the caller names none, and as «system» only when neither exists", async () => {
    const wired = arrange(act, SERVICE_DEFAULT);
    await perform(act, wired.service, wired.requests, undefined);
    expect(actorsOf(wired.audit)).toEqual([SERVICE_DEFAULT]);

    const bare = arrange(act);
    await perform(act, bare.service, bare.requests, undefined);
    expect(actorsOf(bare.audit)).toEqual(["system"]);
  });
});
