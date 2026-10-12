import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
  RecordingAuditSink,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import type { GateConfig, GateableActionType } from "../workflow/index.js";
import { DocumentService } from "./service.js";
import type { DocumentTypeDefinition } from "./document.js";
import { buildEffects } from "./effects.js";
import { canTransition, assertTransition } from "./status.js";
import {
  InvalidDocumentTransitionError,
  InvalidDocumentError,
  MissingHookError,
} from "./errors.js";
import {
  InMemoryDocumentRepository,
  RecordingDocumentEventPublisher,
} from "./test-helpers/in-memory-document-repository.js";
import {
  journalDocumentType,
  createJournalGlHook,
  createDocumentWorkflowGate,
  type JournalDocLine,
} from "./journal-document.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";

/* -------------------------------------------------------------------- */
/* 1. Lifecycle state machine + guards                                   */
/* -------------------------------------------------------------------- */

describe("document lifecycle state machine", () => {
  it("permits the canonical transitions and forbids illegal ones", () => {
    expect(canTransition("draft", "posted")).toBe(true);
    expect(canTransition("draft", "pending")).toBe(true);
    expect(canTransition("pending", "posted")).toBe(true);
    expect(canTransition("pending", "draft")).toBe(true); // modification bounce
    expect(canTransition("posted", "reversed")).toBe(true);
    expect(canTransition("confirmed", "reversed")).toBe(true);

    expect(canTransition("posted", "draft")).toBe(false);
    expect(canTransition("reversed", "posted")).toBe(false);
    expect(canTransition("cancelled", "posted")).toBe(false);
    expect(canTransition("posted", "cancelled")).toBe(false);
  });

  it("assertTransition throws a typed error on an illegal move", () => {
    expect(() => assertTransition("X", "x1", "posted", "draft")).toThrow(InvalidDocumentTransitionError);
  });
});

/* -------------------------------------------------------------------- */
/* 2. Generic service with a SYNTHETIC type — hooks fire in order        */
/* -------------------------------------------------------------------- */

interface FakeLine {
  readonly note: string;
}

/** A synthetic type exercising all four hooks so we can assert ordering + optionality. */
function fakeType(overrides: Partial<DocumentTypeDefinition<FakeLine>> = {}): DocumentTypeDefinition<FakeLine> {
  return {
    code: "FAKE_DOC",
    labelAr: "مستند تجريبي",
    confirmedStatus: "confirmed",
    numberingSequence: "SALES_INVOICE",
    gateActionType: null,
    describeEffects: () => buildEffects({ effects: [{ kind: "info", description: "test" }] }),
    ...overrides,
  };
}

describe("DocumentService — generic lifecycle with hooks", () => {
  it("createDraft validates, persists a draft, and emits DOCUMENT_DRAFTED", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const events = new RecordingDocumentEventPublisher();
    const svc = new DocumentService(fakeType(), { repo, events, now: () => "2026-08-22T00:00:00.000Z" });

    const draft = await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [{ note: "a" }] });
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();
    expect(events.events.map((e) => e.type)).toEqual(["DOCUMENT_DRAFTED"]);
  });

  it("rejects a duplicate id", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const svc = new DocumentService(fakeType(), { repo });
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    await expect(svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] })).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });

  it("confirm fires numbering → stock → GL in order and persists the active document", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const events = new RecordingDocumentEventPublisher();
    const audit = new RecordingAuditSink();
    const calls: string[] = [];

    const numbering = { next: async () => (calls.push("number"), { value: 1, formatted: "SO-000001" }) };
    const stock = { apply: async () => (calls.push("stock"), { valueMoved: Money.zero() }) };
    const gl = {
      post: async () => (calls.push("gl"), { journalEntryId: "je-x", journalEntryNo: "JE-000001" }),
      reverse: async () => ({ journalEntryId: "je-r", journalEntryNo: "JE-000002" }),
    };

    const svc = new DocumentService(
      fakeType({
        buildStockPlan: () => ({ sourceDocType: "FAKE_DOC", sourceDocId: "d1", sourceDocNumber: null, warehouseId: "W1", lines: [] }),
        buildGlPosting: () => ({ sourceDocType: "FAKE_DOC", sourceDocId: "d1", sourceDocNumber: null, date: "2026-08-22", memo: "m", lines: [] }),
      }),
      { repo, events, audit, numbering, stock, gl, now: () => "2026-08-22T00:00:00.000Z" },
    );

    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [{ note: "a" }] });
    const { document, held } = await svc.confirm("d1");

    expect(held).toBe(false);
    expect(calls).toEqual(["number", "stock", "gl"]);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("SO-000001");
    expect(document.journalEntryId).toBe("je-x");
    expect(document.confirmedAt).toBe("2026-08-22T00:00:00.000Z");
    expect(events.events.map((e) => e.type)).toEqual(["DOCUMENT_DRAFTED", "DOCUMENT_CONFIRMED"]);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]?.action).toBe("CONFIRM");
  });

  // guards B-10: reverse mirrored the GL entry and left the goods on hand, so
  // a reversed document's stock stayed put while GL 1200 had been credited.
  it("reverse mirrors the stock plan when the document moved stock", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const reversed: { plan: unknown; reversesDocId: string }[] = [];
    const stock = {
      apply: async () => ({ valueMoved: Money.fromMajor("300.00") }),
      reverse: async (plan: unknown, reversesDocId: string) => {
        reversed.push({ plan, reversesDocId });
        return { valueMoved: Money.fromMajor("-300.00") };
      },
    };
    const gl = {
      post: async () => ({ journalEntryId: "je-x", journalEntryNo: "JE-000001" }),
      reverse: async () => ({ journalEntryId: "je-r", journalEntryNo: "JE-000002" }),
    };
    const svc = new DocumentService(
      fakeType({
        numberingSequence: undefined,
        buildStockPlan: (doc) => ({
          sourceDocType: "FAKE_DOC",
          sourceDocId: doc.id,
          sourceDocNumber: doc.docNo,
          warehouseId: "W1",
          lines: [],
          date: doc.date,
        }),
        buildGlPosting: () => ({ sourceDocType: "FAKE_DOC", sourceDocId: "d1", sourceDocNumber: null, date: "2026-08-22", memo: "m", lines: [] }),
      }),
      { repo, stock, gl, now: () => "2026-08-22T00:00:00.000Z" },
    );

    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [{ note: "a" }] });
    await svc.confirm("d1");
    await svc.reverse("d1", { reversalId: "d1-rev" });

    expect(reversed).toHaveLength(1);
    // The plan is keyed to the REVERSING document — its own movements — and
    // names the original as the movements to undo.
    expect(reversed[0]!.reversesDocId).toBe("d1");
    expect((reversed[0]!.plan as { sourceDocId: string }).sourceDocId).toBe("d1-rev");
  });

  it("refuses to reverse a stock-moving document when the hook cannot reverse", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const stock = { apply: async () => ({ valueMoved: Money.zero() }) };
    const gl = {
      post: async () => ({ journalEntryId: "je-x", journalEntryNo: "JE-000001" }),
      reverse: async () => ({ journalEntryId: "je-r", journalEntryNo: "JE-000002" }),
    };
    const svc = new DocumentService(
      fakeType({
        numberingSequence: undefined,
        buildStockPlan: (doc) => ({ sourceDocType: "FAKE_DOC", sourceDocId: doc.id, sourceDocNumber: null, warehouseId: "W1", lines: [] }),
        buildGlPosting: () => ({ sourceDocType: "FAKE_DOC", sourceDocId: "d1", sourceDocNumber: null, date: "2026-08-22", memo: "m", lines: [] }),
      }),
      { repo, stock, gl, now: () => "2026-08-22T00:00:00.000Z" },
    );
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    await svc.confirm("d1");
    await expect(svc.reverse("d1", { reversalId: "d1-rev" })).rejects.toBeInstanceOf(MissingHookError);
  });

  it("skips hooks a type does not declare", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    // A type with no numbering, no GL, no stock — a pure metadata document.
    const svc = new DocumentService(fakeType({ numberingSequence: null }), { repo });
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    const { document } = await svc.confirm("d1");
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBeNull();
    expect(document.journalEntryId).toBeNull();
  });

  it("throws MissingHookError when a declared hook has no adapter", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const svc = new DocumentService(
      fakeType({ buildGlPosting: () => ({ sourceDocType: "FAKE_DOC", sourceDocId: "d1", sourceDocNumber: null, date: "2026-08-22", memo: "m", lines: [] }) }),
      { repo, numbering: { next: async () => ({ value: 1, formatted: "SO-000001" }) } },
    );
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    await expect(svc.confirm("d1")).rejects.toBeInstanceOf(MissingHookError);
  });

  it("blocks confirm when the effects descriptor marks the document not-confirmable", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const svc = new DocumentService(
      fakeType({ numberingSequence: null, describeEffects: () => buildEffects({ effects: [], blocked: true, blockedReason: "nope" }) }),
      { repo },
    );
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    await expect(svc.confirm("d1")).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("cancel moves a draft to cancelled but refuses to cancel an active document", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const svc = new DocumentService(fakeType({ numberingSequence: null }), { repo });
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    const cancelled = await svc.cancel("d1");
    expect(cancelled.status).toBe("cancelled");

    await svc.createDraft({ id: "d2", date: "2026-08-22", memo: "m", lines: [] });
    await svc.confirm("d2");
    await expect(svc.cancel("d2")).rejects.toBeInstanceOf(InvalidDocumentTransitionError);
  });
});

/* -------------------------------------------------------------------- */
/* 3. Workflow gate on confirm                                           */
/* -------------------------------------------------------------------- */

describe("DocumentService — workflow gate on confirm", () => {
  const gate = (steps: { role: string }[]) =>
    createDocumentWorkflowGate((actionType: GateableActionType): GateConfig => ({ actionType, steps }));

  it("holds the document بانتظار الموافقة when steps are configured and submitter is not admin", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const events = new RecordingDocumentEventPublisher();
    const svc = new DocumentService(
      fakeType({ numberingSequence: null, gateActionType: "SALES_INVOICE_CONFIRM" }),
      { repo, events, workflow: gate([{ role: "manager" }]) },
    );
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    const { document, held } = await svc.confirm("d1", { actor: "clerk", actorRoles: ["clerk"] });
    expect(held).toBe(true);
    expect(document.status).toBe("pending");
    expect(document.workflowRequestId).toBe("d1:confirm");
    expect(events.events.map((e) => e.type)).toEqual(["DOCUMENT_DRAFTED", "DOCUMENT_SUBMITTED"]);
  });

  it("confirms immediately for an admin submitter (gate bypass)", async () => {
    const repo = new InMemoryDocumentRepository<FakeLine>();
    const svc = new DocumentService(
      fakeType({ numberingSequence: null, gateActionType: "SALES_INVOICE_CONFIRM" }),
      { repo, workflow: gate([{ role: "manager" }]) },
    );
    await svc.createDraft({ id: "d1", date: "2026-08-22", memo: "m", lines: [] });
    const { held, document } = await svc.confirm("d1", { actor: "boss", actorRoles: ["*"] });
    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
  });
});

/* -------------------------------------------------------------------- */
/* 4. Journal-entry consumer against the REAL GL engine                   */
/* -------------------------------------------------------------------- */

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function journalHarness() {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const audit = new RecordingAuditSink();
  await accounts.create(account("1300-1"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const gl = createJournalGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-08-22T10:00:00.000Z",
    actor: "u1",
  });
  const repo = new InMemoryDocumentRepository<JournalDocLine>();
  const events = new RecordingDocumentEventPublisher();
  const svc = new DocumentService(journalDocumentType, {
    repo,
    gl,
    audit,
    events,
    auditModule: "accounting",
    workflow: createDocumentWorkflowGate(() => null), // no gate configured → auto-grant
    now: () => "2026-08-22T10:00:00.000Z",
    actor: "u1",
  });
  return { svc, ledger, events };
}

const balancedLines: JournalDocLine[] = [
  { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
  { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("100") },
];

describe("journal document — effects + post + reverse via the GL engine", () => {
  it("describeEffects reports balanced and the GL/balance effect lines", async () => {
    const { svc } = await journalHarness();
    const draft = await svc.createDraft({ id: "j1", date: "2026-08-22", memo: "قيد اختبار", lines: balancedLines });
    const effects = svc.effectsOf(draft);
    expect(effects.balanced).toBe(true);
    expect(effects.blocked).toBe(false);
    expect(effects.totalDebit?.toString()).toBe("100.000000");
    expect(effects.effects.some((e) => e.kind === "gl")).toBe(true);
  });

  it("marks an unbalanced draft as blocked and refuses to post it", async () => {
    const { svc } = await journalHarness();
    const draft = await svc.createDraft({
      id: "j2",
      date: "2026-08-22",
      memo: "غير متوازن",
      lines: [
        { accountId: "1300-1", debit: Money.fromMajor("100"), credit: Money.zero() },
        { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("90") },
      ],
    });
    expect(svc.effectsOf(draft).blocked).toBe(true);
    await expect(svc.confirm("j2")).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("posts a balanced journal: JE- number from the GL engine, entry in the ledger, event emitted", async () => {
    const { svc, ledger, events } = await journalHarness();
    await svc.createDraft({ id: "j3", date: "2026-08-22", memo: "قيد", lines: balancedLines });
    const { document, held } = await svc.confirm("j3");
    expect(held).toBe(false);
    expect(document.status).toBe("posted");
    expect(document.docNo).toBe("JE-000001");
    expect(document.journalEntryId).toBe("j3");

    const posted = await ledger.findById("j3");
    expect(posted?.status).toBe("posted");
    expect(posted?.entryNo).toBe("JE-000001");
    expect(events.events.at(-1)?.type).toBe("DOCUMENT_CONFIRMED");
  });

  it("reverses a posted journal: original → reversed, mirror entry posted", async () => {
    const { svc, ledger } = await journalHarness();
    await svc.createDraft({ id: "j4", date: "2026-08-22", memo: "قيد", lines: balancedLines });
    await svc.confirm("j4");
    const { original, reversal } = await svc.reverse("j4", { reversalId: "j4-rev", date: "2026-08-22" });

    expect(original.status).toBe("reversed");
    expect(original.reversedByDocId).toBe("j4-rev");
    expect(reversal.docNo).toBe("JE-000002");
    // Ledger: original reversed, reversing entry posted with swapped sides.
    expect((await ledger.findById("j4"))?.status).toBe("reversed");
    const rev = await ledger.findById("j4-rev");
    expect(rev?.status).toBe("posted");
    expect(rev?.lines[0]?.credit.toString()).toBe("100.000000"); // debit became credit
  });
});
