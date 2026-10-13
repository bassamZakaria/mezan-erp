import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
} from "../gl/test-helpers/in-memory-ledger-repository.js";
import { ApprovalRequestUntrustedError, DuplicateRecordIdError, decideApproval, type ApprovalRequestRecord, type ApprovalRequestRepository } from "../index.js";
import type { DocumentWorkflowInput } from "./hooks.js";
import {
  journalDocumentType,
  createJournalGlHook,
  createDocumentWorkflowGate,
  type JournalDocLine,
} from "./journal-document.js";
import { InvalidDocumentError } from "./errors.js";
import type { FrameworkDocument } from "./document.js";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

function doc(lines: JournalDocLine[], overrides: Partial<FrameworkDocument<JournalDocLine>> = {}): FrameworkDocument<JournalDocLine> {
  return {
    id: "j1",
    docType: "JOURNAL_ENTRY",
    docNo: null,
    date: "2026-08-22",
    memo: "قيد اختبار",
    status: "draft",
    lines,
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

const dr = (accountId: string, major: string) => ({ accountId, debit: Money.fromMajor(major), credit: Money.zero() });
const cr = (accountId: string, major: string) => ({ accountId, debit: Money.zero(), credit: Money.fromMajor(major) });

describe("journalDocumentType.validate", () => {
  it("accepts a balanced two-line draft", () => {
    expect(() => journalDocumentType.validate?.(doc([dr("1300-1", "100"), cr("4000", "100")]))).not.toThrow();
  });

  it("refuses fewer than two lines", () => {
    expect(() => journalDocumentType.validate?.(doc([dr("1300-1", "100")]))).toThrow(InvalidDocumentError);
  });

  it("refuses zero lines", () => {
    expect(() => journalDocumentType.validate?.(doc([]))).toThrow(InvalidDocumentError);
  });

  it("refuses a line with a blank account id", () => {
    expect(() =>
      journalDocumentType.validate?.(doc([dr("", "100"), cr("4000", "100")])),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses a negative debit", () => {
    expect(() =>
      journalDocumentType.validate?.(
        doc([{ accountId: "1300-1", debit: Money.fromMajor("-1"), credit: Money.zero() }, cr("4000", "1")]),
      ),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses a negative credit", () => {
    expect(() =>
      journalDocumentType.validate?.(
        doc([dr("1300-1", "1"), { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("-1") }]),
      ),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses a line that is both debit and credit", () => {
    expect(() =>
      journalDocumentType.validate?.(
        doc([{ accountId: "1300-1", debit: Money.fromMajor("1"), credit: Money.fromMajor("1") }, cr("4000", "1")]),
      ),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses a line that is neither debit nor credit", () => {
    expect(() =>
      journalDocumentType.validate?.(
        doc([{ accountId: "1300-1", debit: Money.zero(), credit: Money.zero() }, cr("4000", "1")]),
      ),
    ).toThrow(InvalidDocumentError);
  });

  it("accepts a one-micro-unit debit (boundary: smallest non-zero amount)", () => {
    expect(() =>
      journalDocumentType.validate?.(
        doc([
          { accountId: "1300-1", debit: Money.fromScaled(1n), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromScaled(1n) },
        ]),
      ),
    ).not.toThrow();
  });
});

describe("journalDocumentType.buildGlPosting", () => {
  it("maps lines straight through, defaulting a missing memo to null", () => {
    const posting = journalDocumentType.buildGlPosting?.(doc([dr("1300-1", "50"), cr("4000", "50")]));
    expect(posting?.sourceDocType).toBe("JOURNAL_ENTRY");
    expect(posting?.sourceDocId).toBe("j1");
    expect(posting?.lines).toHaveLength(2);
    expect(posting?.lines[0]?.memo).toBeNull();
    expect(posting?.lines[0]?.debit.toString()).toBe("50.000000");
  });
});

describe("journalDocumentType.describeEffects", () => {
  it("reports balanced: true, not blocked, and account count for a balanced draft", () => {
    const effects = journalDocumentType.describeEffects(doc([dr("1300-1", "100"), cr("4000", "100")]));
    expect(effects.balanced).toBe(true);
    expect(effects.blocked).toBe(false);
    expect(effects.blockedReason).toBeUndefined();
    expect(effects.totalDebit?.toString()).toBe("100.000000");
    expect(effects.totalCredit?.toString()).toBe("100.000000");
    const balanceEffect = effects.effects.find((e) => e.kind === "balance");
    expect(balanceEffect?.description).toContain("2");
  });

  it("reports blocked: true with the Arabic reason for an unbalanced draft", () => {
    const effects = journalDocumentType.describeEffects(doc([dr("1300-1", "100"), cr("4000", "90")]));
    expect(effects.balanced).toBe(false);
    expect(effects.blocked).toBe(true);
    expect(effects.blockedReason).toBe("القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن.");
  });

  it("counts distinct accounts, not lines, for the balance-update effect", () => {
    const effects = journalDocumentType.describeEffects(
      doc([dr("1300-1", "40"), dr("1300-1", "60"), cr("4000", "100")]),
    );
    const balanceEffect = effects.effects.find((e) => e.kind === "balance");
    expect(balanceEffect?.description).toContain("2");
  });
});

async function glHarness() {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
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
  return { gl, ledger };
}

describe("createJournalGlHook", () => {
  it("posts through the real GL engine and returns the entry id/number", async () => {
    const { gl, ledger } = await glHarness();
    const result = await gl.post({
      sourceDocType: "JOURNAL_ENTRY",
      sourceDocId: "j1",
      sourceDocNumber: null,
      date: "2026-08-22",
      memo: "قيد",
      lines: [dr("1300-1", "100"), cr("4000", "100")],
    });
    expect(result.journalEntryId).toBe("j1");
    expect(result.journalEntryNo).toBe("JE-000001");
    const posted = await ledger.findById("j1");
    expect(posted?.status).toBe("posted");
  });

  it("threads cost centre / tax / currency / fx dimensions through to the posted line", async () => {
    const { gl, ledger } = await glHarness();
    await gl.post({
      sourceDocType: "JOURNAL_ENTRY",
      sourceDocId: "j-dim",
      sourceDocNumber: null,
      date: "2026-08-22",
      memo: "قيد",
      lines: [
        { ...dr("1300-1", "100"), costCenterId: "CC-1", taxRatePercent: 14, currency: "USD", fxRate: "48.5" },
        cr("4000", "100"),
      ],
    });
    const posted = await ledger.findById("j-dim");
    expect(posted?.lines[0]?.costCenterId).toBe("CC-1");
    expect(posted?.lines[0]?.taxRatePercent).toBe(14);
    expect(posted?.lines[0]?.currency).toBe("USD");
    expect(posted?.lines[0]?.fxRate).toBe("48.5");
  });

  it("reverses a posted entry with a mirrored (swapped-side) entry", async () => {
    const { gl, ledger } = await glHarness();
    await gl.post({
      sourceDocType: "JOURNAL_ENTRY",
      sourceDocId: "j2",
      sourceDocNumber: null,
      date: "2026-08-22",
      memo: "قيد",
      lines: [dr("1300-1", "100"), cr("4000", "100")],
    });
    const reversal = await gl.reverse("j2", { reversalId: "j2-rev", date: "2026-08-23" });
    expect(reversal.journalEntryId).toBe("j2-rev");
    expect((await ledger.findById("j2"))?.status).toBe("reversed");
    const rev = await ledger.findById("j2-rev");
    expect(rev?.status).toBe("posted");
    expect(rev?.lines[0]?.credit.toString()).toBe("100.000000");
  });
});

/* -------------------------------------------------------------------- */
/* createDocumentWorkflowGate                                            */
/* -------------------------------------------------------------------- */

const heldJournal = { id: "j1", date: "2026-08-22", memo: "قيد", lines: [{ accountId: "5200", debit: "10.00", credit: "0" }] };

function ask(overrides: Partial<DocumentWorkflowInput> & { content?: object; heldRequestId?: string | null } = {}): DocumentWorkflowInput {
  const { content, heldRequestId, ...rest } = overrides;
  return {
    actionType: "ACCOUNTING_JOURNAL_POST",
    requestId: "j1:confirm",
    submittedBy: "clerk",
    submitterRoles: ["clerk"],
    document: { id: "j1", branchId: "BR-MAIN", content: content ?? heldJournal, heldRequestId: heldRequestId === undefined ? null : heldRequestId },
    ...rest,
  };
}

describe("createDocumentWorkflowGate without a request repository (pure gate)", () => {
  it("grants immediately when no steps are configured", async () => {
    const gate = createDocumentWorkflowGate(() => null);
    expect((await gate.evaluate(ask({ submitterRoles: undefined }))).granted).toBe(true);
  });

  it("holds the request when steps are configured and submitter lacks the role", async () => {
    const gate = createDocumentWorkflowGate(() => ({ actionType: "ACCOUNTING_JOURNAL_POST", steps: [{ role: "MANAGER" }] }));
    expect((await gate.evaluate(ask())).granted).toBe(false);
  });

  it("a role code passed where a permission is expected grants nothing (submitter roles are matched by exact role code, never a permission string)", async () => {
    const gate = createDocumentWorkflowGate(() => ({ actionType: "ACCOUNTING_JOURNAL_POST", steps: [{ role: "MANAGER" }] }));
    expect((await gate.evaluate(ask({ submitterRoles: ["accounting.journal.post"] }))).granted).toBe(false);
  });
});

function fakeApprovalRepo(): ApprovalRequestRepository & { rows: Map<string, ApprovalRequestRecord> } {
  const rows = new Map<string, ApprovalRequestRecord>();
  return {
    rows,
    async list() {
      return [...rows.values()];
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async insert(record) {
      if (rows.has(record.id)) throw new DuplicateRecordIdError(record.id);
      rows.set(record.id, record);
    },
    async save(record) {
      rows.set(record.id, record);
    },
    async listPendingForRoles(roles) {
      return [...rows.values()].filter((r) => {
        if (r.status !== "pending") return false;
        if (roles.includes("*")) return true;
        const role = r.steps[r.currentStep]?.role;
        return role !== undefined && roles.includes(role);
      });
    },
    async listBySubmitter(submittedBy) {
      return [...rows.values()].filter((r) => r.submittedBy === submittedBy);
    },
  };
}

const oneStepConfig = { actionType: "ACCOUNTING_JOURNAL_POST" as const, steps: [{ role: "MANAGER" }] };
const HELD = "j1:confirm";

async function heldRequest() {
  const repo = fakeApprovalRepo();
  const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
  await gate.evaluate(ask());
  return { repo, gate };
}

const approveAsManager = (repo: ApprovalRequestRepository) => decideApproval(HELD, { actorId: "manager", actorRoles: ["MANAGER"], decision: "approve" }, repo);

describe("createDocumentWorkflowGate with a request repository — persists a real inbox row", () => {
  it("first evaluate() submits and persists a pending request the inbox can find, bound to its document", async () => {
    const { repo } = await heldRequest();
    const stored = await repo.findById(HELD);
    expect(stored?.status).toBe("pending");
    expect(stored?.steps[0]?.role).toBe("MANAGER");
    expect(stored?.subject).toMatchObject({ documentId: "j1", branchId: "BR-MAIN" });
    expect(stored?.subject?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a second evaluate() READS the standing request rather than resubmitting it", async () => {
    const { repo, gate } = await heldRequest();
    const before = await repo.findById(HELD);
    const decision = await gate.evaluate(ask({ heldRequestId: HELD }));
    expect(decision.granted).toBe(false);
    expect(await repo.findById(HELD)).toEqual(before);
  });

  it("grants once another person has approved the request the document raised", async () => {
    const { repo, gate } = await heldRequest();
    await approveAsManager(repo);
    expect((await gate.evaluate(ask({ heldRequestId: HELD, submittedBy: "manager" }))).granted).toBe(true);
  });

  it("throws when the standing request has been rejected — a rejected request never re-opens", async () => {
    const { repo, gate } = await heldRequest();
    await decideApproval(HELD, { actorId: "manager", actorRoles: ["MANAGER"], decision: "reject" }, repo);
    await expect(gate.evaluate(ask())).rejects.toThrow(/مرفوض/);
  });

  it("resubmits a modification_requested request from step 0, under the content the submitter now sends", async () => {
    const { repo, gate } = await heldRequest();
    await decideApproval(HELD, { actorId: "manager", actorRoles: ["MANAGER"], decision: "request_modification" }, repo);
    const edited = { ...heldJournal, memo: "قيد معدّل" };
    const decision = await gate.evaluate(ask({ content: edited }));
    expect(decision.granted).toBe(false);
    const after = await repo.findById(HELD);
    expect(after?.status).toBe("pending");
    expect(after?.currentStep).toBe(0);
    await approveAsManager(repo);
    expect((await gate.evaluate(ask({ content: edited, heldRequestId: HELD }))).granted).toBe(true);
    await expect(gate.evaluate(ask({ heldRequestId: HELD }))).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
  });

  it("a gate with no approver configured (empty steps) grants immediately, even through the persisted path", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => ({ actionType: "ACCOUNTING_JOURNAL_POST", steps: [] }), repo);
    expect((await gate.evaluate(ask({ submitterRoles: undefined }))).granted).toBe(true);
  });
});

describe("createDocumentWorkflowGate — an approval is trusted only for the document that raised it", () => {
  const approved = (overrides: Partial<ApprovalRequestRecord>): ApprovalRequestRecord => ({
    id: HELD,
    actionType: "ACCOUNTING_JOURNAL_POST",
    submittedBy: "clerk",
    steps: [],
    currentStep: 0,
    status: "approved",
    decisions: [],
    entityLabel: null,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  });

  it("refuses an approved request planted under the document's id before its first confirm", async () => {
    const repo = fakeApprovalRepo();
    repo.rows.set(HELD, approved({ actionType: "TREASURY_VOUCHER_CONFIRM", submittedBy: "nobody" }));
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    await expect(gate.evaluate(ask())).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
    expect((await repo.findById(HELD))?.submittedBy).toBe("nobody");
  });

  it("refuses an approval recorded for another action type", async () => {
    const { repo, gate } = await heldRequest();
    await approveAsManager(repo);
    const stored = (await repo.findById(HELD))!;
    repo.rows.set(HELD, { ...stored, actionType: "TREASURY_VOUCHER_CONFIRM" });
    await expect(gate.evaluate(ask({ heldRequestId: HELD }))).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
  });

  it("refuses an approval the document itself is not held under", async () => {
    const { repo, gate } = await heldRequest();
    await approveAsManager(repo);
    await expect(gate.evaluate(ask({ heldRequestId: null }))).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
  });

  it("refuses an approval when the document changed after it was submitted", async () => {
    const { repo, gate } = await heldRequest();
    await approveAsManager(repo);
    const edited = { ...heldJournal, lines: [{ accountId: "5200", debit: "9000.00", credit: "0" }] };
    await expect(gate.evaluate(ask({ heldRequestId: HELD, content: edited }))).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
  });

  it("refuses an approval when the document moved to another branch", async () => {
    const { repo, gate } = await heldRequest();
    await approveAsManager(repo);
    await expect(gate.evaluate({ ...ask({ heldRequestId: HELD }), document: { id: "j1", branchId: "BR-ALEX", content: heldJournal, heldRequestId: HELD } })).rejects.toBeInstanceOf(
      ApprovalRequestUntrustedError,
    );
  });

  it("an approval no second person gave is not honoured: the chain in force is asked again", async () => {
    const { repo, gate } = await heldRequest();
    const stored = (await repo.findById(HELD))!;
    for (const decisions of [[], [{ stepIndex: 0, kind: "approve" as const, actorId: "clerk" }]]) {
      repo.rows.set(HELD, { ...stored, status: "approved", currentStep: 1, decisions });
      expect((await gate.evaluate(ask({ heldRequestId: HELD }))).granted).toBe(false);
      expect(await repo.findById(HELD)).toMatchObject({ status: "pending", currentStep: 0, decisions: [] });
    }
  });

  it("a request granted at submission is granted again when its document failed to post and is retried", async () => {
    const repo = fakeApprovalRepo();
    const ungated = createDocumentWorkflowGate(() => null, repo);
    expect((await ungated.evaluate(ask())).granted).toBe(true);
    expect((await ungated.evaluate(ask())).granted).toBe(true);
    const gated = createDocumentWorkflowGate(() => oneStepConfig, repo);
    expect((await gated.evaluate(ask())).granted).toBe(false);
    expect((await repo.findById(HELD))?.status).toBe("pending");
  });

  it("a pending request whose document changed while it waited restarts under the new content", async () => {
    const { repo, gate } = await heldRequest();
    const edited = { ...heldJournal, memo: "بعد التعديل" };
    expect((await gate.evaluate(ask({ content: edited }))).granted).toBe(false);
    await approveAsManager(repo);
    await expect(gate.evaluate(ask({ heldRequestId: HELD }))).rejects.toBeInstanceOf(ApprovalRequestUntrustedError);
    expect((await gate.evaluate(ask({ heldRequestId: HELD, content: edited }))).granted).toBe(true);
  });

  it("answers the refusal in Arabic", async () => {
    const error = new ApprovalRequestUntrustedError(HELD);
    expect(error.message).toMatch(/[؀-ۿ]/);
    expect(error.code).toBe("APPROVAL_REQUEST_UNTRUSTED");
  });
});
