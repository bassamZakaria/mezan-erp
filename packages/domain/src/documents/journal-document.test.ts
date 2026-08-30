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
import type { ApprovalRequestRecord, ApprovalRequestRepository } from "../workflow/index.js";
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
/* createDocumentWorkflowGate — the pure (no-repository) path            */
/* -------------------------------------------------------------------- */

describe("createDocumentWorkflowGate without a request repository (pure gate)", () => {
  it("grants immediately when no steps are configured", async () => {
    const gate = createDocumentWorkflowGate(() => null);
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-1",
      submittedBy: "clerk",
    });
    expect(decision.granted).toBe(true);
  });

  it("holds the request when steps are configured and submitter lacks the role", async () => {
    const gate = createDocumentWorkflowGate(() => ({
      actionType: "ACCOUNTING_JOURNAL_POST",
      steps: [{ role: "MANAGER" }],
    }));
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-2",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    expect(decision.granted).toBe(false);
  });

  it("a role code passed where a permission is expected grants nothing (submitter roles are matched by exact role code, never a permission string)", async () => {
    const gate = createDocumentWorkflowGate(() => ({
      actionType: "ACCOUNTING_JOURNAL_POST",
      steps: [{ role: "MANAGER" }],
    }));
    // "accounting.journal.post" looks like a permission code, not the "MANAGER" role
    // the step names — it must not be treated as an admin bypass or a role match.
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-2b",
      submittedBy: "clerk",
      submitterRoles: ["accounting.journal.post"],
    });
    expect(decision.granted).toBe(false);
  });
});

/* -------------------------------------------------------------------- */
/* createDocumentWorkflowGate — the persisted-request path               */
/* -------------------------------------------------------------------- */

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

describe("createDocumentWorkflowGate with a request repository — persists a real inbox row", () => {
  it("first evaluate() submits and persists a pending request the inbox can find", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-3",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    expect(decision.granted).toBe(false);
    const stored = await repo.findById("req-3");
    expect(stored?.status).toBe("pending");
    expect(stored?.steps[0]?.role).toBe("MANAGER");
  });

  it("a second evaluate() on the same requestId READS the standing request rather than resubmitting it", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-4",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    const before = await repo.findById("req-4");
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-4",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    expect(decision.granted).toBe(false);
    const after = await repo.findById("req-4");
    // still one row, unchanged decision/step state — re-submitting did not occur
    expect(after?.currentStep).toBe(before?.currentStep);
    expect(after?.decisions).toEqual(before?.decisions);
  });

  it("grants once the standing request has been approved out-of-band", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-5",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    const pending = await repo.findById("req-5");
    if (!pending) throw new Error("expected a pending request");
    repo.rows.set("req-5", { ...pending, status: "approved" });

    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-5",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    expect(decision.granted).toBe(true);
  });

  it("throws when the standing request has been rejected — a rejected request never re-opens", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-6",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    const pending = await repo.findById("req-6");
    if (!pending) throw new Error("expected a pending request");
    repo.rows.set("req-6", { ...pending, status: "rejected" });

    await expect(
      gate.evaluate({
        actionType: "ACCOUNTING_JOURNAL_POST",
        requestId: "req-6",
        submittedBy: "clerk",
        submitterRoles: ["clerk"],
      }),
    ).rejects.toThrow(/مرفوض/);
  });

  it("resubmits a modification_requested request from step 0", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(() => oneStepConfig, repo);
    await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-7",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    const pending = await repo.findById("req-7");
    if (!pending) throw new Error("expected a pending request");
    repo.rows.set("req-7", { ...pending, status: "modification_requested" });

    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-7",
      submittedBy: "clerk",
      submitterRoles: ["clerk"],
    });
    expect(decision.granted).toBe(false);
    const after = await repo.findById("req-7");
    expect(after?.status).toBe("pending");
    expect(after?.currentStep).toBe(0);
  });

  it("a gate with no approver configured (empty steps) grants immediately, even through the persisted path", async () => {
    const repo = fakeApprovalRepo();
    const gate = createDocumentWorkflowGate(
      () => ({ actionType: "ACCOUNTING_JOURNAL_POST", steps: [] }),
      repo,
    );
    const decision = await gate.evaluate({
      actionType: "ACCOUNTING_JOURNAL_POST",
      requestId: "req-8",
      submittedBy: "clerk",
    });
    expect(decision.granted).toBe(true);
  });
});
