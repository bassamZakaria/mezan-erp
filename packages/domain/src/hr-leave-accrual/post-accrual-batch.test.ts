import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import type { JournalPostingDeps } from "../gl/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { applyLeavePolicyPreset } from "../hr-leave-policies/index.js";
import { createInMemoryLeavePolicyRepository } from "../hr-leave-policies/test-helpers/in-memory-leave-policy-repository.js";
import { createInMemoryEmployeeDirectory, employeeRefFixture } from "../hr-shared/test-helpers/in-memory-employee-directory.js";
import { createAccrualBatch } from "./create-accrual-batch.js";
import { postAccrualBatch } from "./post-accrual-batch.js";
import { LeaveAccrualBatchNotDraftError } from "./errors.js";
import { createInMemoryAccrualBatchRepository } from "./test-helpers/in-memory-accrual-batch-repository.js";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function harness(dailyRate: () => Promise<Money>) {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  await accounts.create(account("5300", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("2250", { type: "liability", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => "2026-08-01T10:00:00.000Z",
    actor: "u1",
  };

  const policies = createInMemoryLeavePolicyRepository();
  await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
  const employees = createInMemoryEmployeeDirectory([employeeRefFixture({ id: "emp-1" })]);
  const batches = createInMemoryAccrualBatchRepository();

  const createDeps = { batches, employees, policies, dailyRate };
  const postDeps = {
    batches,
    gl,
    now: () => "2026-08-01T12:00:00.000Z",
    accounts: { leaveExpenseAccountId: "5300", accruedLeaveLiabilityAccountId: "2250" },
  };
  return { batches, createDeps, postDeps, ledger };
}

describe("postAccrualBatch", () => {
  it("posts a balanced journal entry when the batch has a non-zero total value", async () => {
    const { createDeps, postDeps } = await harness(async () => Money.fromMajor("100.00"));
    const draft = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, createDeps);
    const posted = await postAccrualBatch(draft.id, postDeps);

    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBe("LEAVE-ACCRUAL-JE:b1");
    expect(posted.postedAt).toBe("2026-08-01T12:00:00.000Z");
  });

  it("posts (crediting balances) without a journal entry when total value is zero", async () => {
    const { createDeps, postDeps } = await harness(async () => Money.zero());
    const draft = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, createDeps);
    const posted = await postAccrualBatch(draft.id, postDeps);

    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBeNull();
  });

  it("rejects posting an already-posted batch", async () => {
    const { createDeps, postDeps } = await harness(async () => Money.fromMajor("50.00"));
    const draft = await createAccrualBatch({ id: "b1", runDate: "2026-08-01", runType: "MANUAL" }, createDeps);
    await postAccrualBatch(draft.id, postDeps);
    await expect(postAccrualBatch(draft.id, postDeps)).rejects.toBeInstanceOf(LeaveAccrualBatchNotDraftError);
  });
});
