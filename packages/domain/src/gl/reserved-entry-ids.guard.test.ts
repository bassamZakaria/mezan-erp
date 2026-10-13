import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { DuplicateJournalEntryError } from "./errors.js";
import { createJournalEntry, postJournalEntry, type CreateJournalEntryCommand, type JournalPostingDeps } from "./post.js";
import { reverseJournalEntry } from "./reverse.js";
import { ReservedJournalEntryIdError } from "./reserved-entry-ids.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "./test-helpers/in-memory-ledger-repository.js";

const account = (id: string): Account => ({ id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });

async function books(): Promise<{ deps: JournalPostingDeps; ledger: InMemoryLedgerRepository }> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  await accounts.create(account("1300-1"));
  await accounts.create(account("1310"));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  return { ledger, deps: { ledger, accounts, periods, numbering: new NextNumberService(new InMemorySequenceStore()), now: () => "2026-08-22T10:00:00.000Z", actor: "u1" } };
}

const entry = (id: string): CreateJournalEntryCommand => ({
  id,
  date: "2026-08-22",
  memo: "تحويل",
  lines: [
    { accountId: "1310", debit: Money.fromMajor("10"), credit: Money.zero() },
    { accountId: "1300-1", debit: Money.zero(), credit: Money.fromMajor("10") },
  ],
});

const RESERVED = ["inv:void", "ADJ1:REVERSAL", "FXR:release:inv:1", "cert-1-DED", "cert-1-DED-VOID"];

describe("a caller that reaches the journal without the wire contract is still refused a system id", () => {
  it.each(RESERVED)("postJournalEntry refuses %s and writes nothing", async (id) => {
    const { deps, ledger } = await books();
    await expect(postJournalEntry(entry(id), deps)).rejects.toBeInstanceOf(ReservedJournalEntryIdError);
    expect(await ledger.findById(id)).toBeNull();
  });

  it.each(RESERVED)("createJournalEntry refuses %s and writes nothing", async (id) => {
    const { deps, ledger } = await books();
    await expect(createJournalEntry(entry(id), deps)).rejects.toBeInstanceOf(ReservedJournalEntryIdError);
    expect(await ledger.findById(id)).toBeNull();
  });

  it.each(RESERVED)("reverseJournalEntry refuses %s as the reversal's id and leaves the original posted", async (id) => {
    const { deps, ledger } = await books();
    await postJournalEntry(entry("je-1"), deps);
    await expect(reverseJournalEntry("je-1", deps, { reversalId: id })).rejects.toBeInstanceOf(ReservedJournalEntryIdError);
    expect((await ledger.findById("je-1"))?.status).toBe("posted");
  });

  it("the system's own minting sites post under those ids by an argument no request carries", async () => {
    const { deps, ledger } = await books();
    await postJournalEntry(entry("PI-JE:pi-1"), deps, { mintedBySystem: true });
    await createJournalEntry(entry("RJ:tpl-1:2026-08"), deps, { mintedBySystem: true });
    await reverseJournalEntry("PI-JE:pi-1", deps, { reversalId: "pi-1:cancel" }, { mintedBySystem: true });
    expect((await ledger.findById("pi-1:cancel"))?.reversesEntryId).toBe("PI-JE:pi-1");
    expect((await ledger.findById("RJ:tpl-1:2026-08"))?.status).toBe("draft");
  });
});

describe("a reversal whose id is already an entry is a named refusal, not a storage failure", () => {
  it("reverseJournalEntry answers DuplicateJournalEntryError and leaves the original posted", async () => {
    const { deps, ledger } = await books();
    await postJournalEntry(entry("je-1"), deps);
    await postJournalEntry(entry("je-2"), deps);
    await expect(reverseJournalEntry("je-1", deps, { reversalId: "je-2" })).rejects.toBeInstanceOf(DuplicateJournalEntryError);
    expect((await ledger.findById("je-1"))?.status).toBe("posted");
    expect((await ledger.findById("je-2"))?.reversesEntryId ?? null).toBeNull();
  });
});
