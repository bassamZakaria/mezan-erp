import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import {
  ChequeNotFoundError,
  DuplicateChequeNumberError,
  InvalidChequeCommandError,
  InvalidChequeTransitionError,
  ReplacementAmountMismatchError,
} from "./errors.js";
import type { CreateChequeCommand } from "./cheque-service.js";

const INCOMING_CONTROL = { underCollectionAccountId: "1320", bouncedAccountId: "1360" };
const OUTGOING_CONTROL = { underCollectionAccountId: "2150", bouncedAccountId: null };

function incomingCmd(overrides: Partial<CreateChequeCommand> = {}): CreateChequeCommand {
  return {
    id: "chq-1",
    direction: "incoming",
    chequeNumber: "CHQ-5001",
    bankName: "بنك مصر",
    amount: Money.fromMajor("1000"),
    issueDate: "2026-08-01",
    dueDate: "2026-08-20",
    branchId: "b1",
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: INCOMING_CONTROL,
    journalEntryId: "je-create-1",
    ...overrides,
  };
}

function outgoingCmd(overrides: Partial<CreateChequeCommand> = {}): CreateChequeCommand {
  return {
    id: "chq-2",
    direction: "outgoing",
    chequeNumber: "CHQ-9001",
    bankName: "بنك مصر",
    amount: Money.fromMajor("500"),
    issueDate: "2026-08-01",
    dueDate: "2026-08-15",
    branchId: "b1",
    partyId: "sup-1",
    counterpartyGlAccountId: "2100",
    controlAccounts: OUTGOING_CONTROL,
    journalEntryId: "je-create-2",
    ...overrides,
  };
}

/** The accounting-meaningful part of a posted entry's lines (the poster also stamps memo/costCenterId/currency/fxRate as nulls). */
function glLines(entry: { lines: readonly { accountId: string; debit: Money; credit: Money }[] } | null | undefined) {
  return entry?.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }));
}

describe("ChequeService.createCheque", () => {
  it("posts Dr underCollection / Cr AR and saves status pending for an incoming cheque", async () => {
    const { service, ledger } = buildTestService();
    const cheque = await service.createCheque(incomingCmd());
    expect(cheque.status).toBe("pending");
    expect(cheque.creationJournalEntryId).toBe("je-create-1");

    const entry = await ledger.findById("je-create-1");
    expect(entry?.status).toBe("posted");
    expect(glLines(entry)).toEqual([
      { accountId: "1320", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1100", debit: Money.zero(), credit: Money.fromMajor("1000") },
    ]);
  });

  it("posts Dr AP / Cr underCollection for an outgoing cheque", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(outgoingCmd());
    const entry = await ledger.findById("je-create-2");
    expect(glLines(entry)).toEqual([
      { accountId: "2100", debit: Money.fromMajor("500"), credit: Money.zero() },
      { accountId: "2150", debit: Money.zero(), credit: Money.fromMajor("500") },
    ]);
  });

  it("rejects a duplicate cheque number within the same direction", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd());
    await expect(service.createCheque(incomingCmd({ id: "chq-1b", journalEntryId: "je-create-1b" }))).rejects.toThrow(
      DuplicateChequeNumberError,
    );
  });

  it("allows the same cheque number across different directions", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd({ chequeNumber: "SAME-1" }));
    await expect(
      service.createCheque(outgoingCmd({ chequeNumber: "SAME-1", id: "chq-2b", journalEntryId: "je-create-2b" })),
    ).resolves.toBeTruthy();
  });
});

describe("ChequeService full lifecycle", () => {
  it("incoming: pending → deposited → collected posts the cash-recognition entry", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(incomingCmd());

    const deposited = await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    expect(deposited.status).toBe("deposited");
    expect(deposited.bankTreasuryAccountId).toBe("ta-bank1");
    // deposit posts no new GL entry
    expect((await ledger.list()).length).toBe(1);

    const collected = await service.collect({ chequeId: "chq-1", bankGlAccountId: "1310", journalEntryId: "je-collect-1", date: "2026-08-20" });
    expect(collected.status).toBe("collected");
    expect(collected.collectionJournalEntryId).toBe("je-collect-1");
    const entry = await ledger.findById("je-collect-1");
    expect(glLines(entry)).toEqual([
      { accountId: "1310", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1320", debit: Money.zero(), credit: Money.fromMajor("1000") },
    ]);
  });

  it("outgoing: collect posts Dr underCollection / Cr bank", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(outgoingCmd());
    await service.deposit({ chequeId: "chq-2", bankTreasuryAccountId: "ta-bank1" });
    await service.collect({ chequeId: "chq-2", bankGlAccountId: "1310", journalEntryId: "je-collect-2" });
    const entry = await ledger.findById("je-collect-2");
    expect(glLines(entry)).toEqual([
      { accountId: "2150", debit: Money.fromMajor("500"), credit: Money.zero() },
      { accountId: "1310", debit: Money.zero(), credit: Money.fromMajor("500") },
    ]);
  });

  it("incoming: bounce reverses the creation posting back onto AR (D192)", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(incomingCmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    const bounced = await service.bounce({ chequeId: "chq-1", journalEntryId: "je-bounce-1" });
    expect(bounced.status).toBe("bounced");
    const entry = await ledger.findById("je-bounce-1");
    expect(glLines(entry)).toEqual([
      { accountId: "1100", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1320", debit: Money.zero(), credit: Money.fromMajor("1000") },
    ]);
  });

  it("outgoing: bounce reverses the original posting back onto AP", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(outgoingCmd());
    await service.deposit({ chequeId: "chq-2", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-2", journalEntryId: "je-bounce-2" });
    const entry = await ledger.findById("je-bounce-2");
    expect(glLines(entry)).toEqual([
      { accountId: "2150", debit: Money.fromMajor("500"), credit: Money.zero() },
      { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("500") },
    ]);
  });

  it("incoming bounce needs no bounced-cheques account: the debt goes back to AR", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(incomingCmd({ controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: null } }));
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-x" });
    expect((await ledger.accountBalance("1100")).balance.toString()).toBe("0.000000");
  });

  it("replace: bounced → replaced, creates a new pending cheque that credits AR again", async () => {
    const { service, cheques, ledger } = buildTestService();
    await service.createCheque(incomingCmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-bounce-1" });

    const { original, replacement } = await service.replace({
      bouncedChequeId: "chq-1",
      newCheque: {
        id: "chq-1r",
        chequeNumber: "CHQ-5002",
        bankName: "بنك مصر",
        issueDate: "2026-08-21",
        dueDate: "2026-09-05",
        branchId: "b1",
      },
      journalEntryId: "je-replace-1",
    });

    expect(original.status).toBe("replaced");
    expect(original.replacedByChequeId).toBe("chq-1r");
    expect(replacement.status).toBe("pending");
    expect(replacement.replacesChequeId).toBe("chq-1");
    expect(replacement.amount).toEqual(Money.fromMajor("1000"));
    expect(await cheques.findById("chq-1r")).toEqual(replacement);

    const entry = await ledger.findById("je-replace-1");
    expect(glLines(entry)).toEqual([
      { accountId: "1320", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1100", debit: Money.zero(), credit: Money.fromMajor("1000") },
    ]);
  });

  it("replace rejects a mismatched amount", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-bounce-1" });

    await expect(
      service.replace({
        bouncedChequeId: "chq-1",
        newCheque: {
          id: "chq-1r",
          chequeNumber: "CHQ-5002",
          bankName: "بنك مصر",
          issueDate: "2026-08-21",
          dueDate: "2026-09-05",
          branchId: "b1",
          amount: Money.fromMajor("999"),
        },
        journalEntryId: "je-replace-1",
      }),
    ).rejects.toThrow(ReplacementAmountMismatchError);
  });

  it("replace rejects an outgoing cheque", async () => {
    const { service } = buildTestService();
    await service.createCheque(outgoingCmd());
    await service.deposit({ chequeId: "chq-2", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-2", journalEntryId: "je-bounce-2" });
    await expect(
      service.replace({
        bouncedChequeId: "chq-2",
        newCheque: { id: "chq-2r", chequeNumber: "CHQ-9002", bankName: "x", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "b1" },
        journalEntryId: "je-r",
      }),
    ).rejects.toThrow(InvalidChequeCommandError);
  });

  it("rejects illegal transitions", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd());
    await expect(service.collect({ chequeId: "chq-1", bankGlAccountId: "1310", journalEntryId: "je-x" })).rejects.toThrow(
      InvalidChequeTransitionError,
    );
    await expect(service.bounce({ chequeId: "chq-1", journalEntryId: "je-y" })).rejects.toThrow(InvalidChequeTransitionError);
    await expect(service.replace({ bouncedChequeId: "chq-1", newCheque: { id: "n", chequeNumber: "n", bankName: "n", issueDate: "2026-08-01", dueDate: "2026-08-01", branchId: "b1" }, journalEntryId: "je-z" })).rejects.toThrow(
      InvalidChequeTransitionError,
    );
  });

  it("throws ChequeNotFoundError for an unknown id", async () => {
    const { service } = buildTestService();
    await expect(service.deposit({ chequeId: "nope", bankTreasuryAccountId: "ta-bank1" })).rejects.toThrow(ChequeNotFoundError);
  });
});

describe("ChequeService.list", () => {
  it("filters by the derived status as of a given date", async () => {
    const { service } = buildTestService();
    // due in 10 days: plain pending as of 2026-08-01
    await service.createCheque(incomingCmd({ id: "c-far", chequeNumber: "C-FAR", dueDate: "2026-08-30", journalEntryId: "je-far" }));
    // due in 2 days: under_collection as of 2026-08-01 relative to dueDate 2026-08-03
    await service.createCheque(incomingCmd({ id: "c-soon", chequeNumber: "C-SOON", dueDate: "2026-08-03", journalEntryId: "je-soon" }));
    // due today
    await service.createCheque(incomingCmd({ id: "c-today", chequeNumber: "C-TODAY", dueDate: "2026-08-01", journalEntryId: "je-today" }));

    const asOfDate = "2026-08-01";
    expect((await service.list({ status: "pending", asOfDate })).map((c) => c.id)).toEqual(["c-far"]);
    expect((await service.list({ status: "under_collection", asOfDate })).map((c) => c.id)).toEqual(["c-soon"]);
    expect((await service.list({ status: "due_today", asOfDate })).map((c) => c.id)).toEqual(["c-today"]);
  });

  it("filters by a stored status directly", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    expect((await service.list({ status: "deposited" })).map((c) => c.id)).toEqual(["chq-1"]);
    expect(await service.list({ status: "collected" })).toEqual([]);
  });

  it("filters by direction", async () => {
    const { service } = buildTestService();
    await service.createCheque(incomingCmd());
    await service.createCheque(outgoingCmd());
    expect((await service.list({ direction: "outgoing" })).map((c) => c.id)).toEqual(["chq-2"]);
  });
});

describe("ChequeService — the branch dimension (D111)", () => {
  const branchesOf = (entry: { lines: readonly { branchId?: string | null }[] } | null | undefined) =>
    entry?.lines.map((l) => l.branchId ?? null);

  it("stamps the cheque's own branch on the creation, collection and bounce entries", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(incomingCmd({ branchId: "BR-ALEX" }));
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.collect({ chequeId: "chq-1", bankGlAccountId: "1310", journalEntryId: "je-collect-1", date: "2026-08-20" });
    expect(branchesOf(await ledger.findById("je-create-1"))).toEqual(["BR-ALEX", "BR-ALEX"]);
    expect(branchesOf(await ledger.findById("je-collect-1"))).toEqual(["BR-ALEX", "BR-ALEX"]);

    await service.createCheque(outgoingCmd({ branchId: "BR-GIZA" }));
    await service.deposit({ chequeId: "chq-2", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-2", journalEntryId: "je-bounce-2" });
    expect(branchesOf(await ledger.findById("je-bounce-2"))).toEqual(["BR-GIZA", "BR-GIZA"]);
  });

  it("stamps the replacement cheque's branch on the replacement entry", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(incomingCmd({ branchId: "BR-ALEX" }));
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-bounce-1" });
    await service.replace({
      bouncedChequeId: "chq-1",
      newCheque: { id: "chq-1r", chequeNumber: "CHQ-5002", bankName: "بنك مصر", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "BR-GIZA" },
      journalEntryId: "je-replace-1",
    });
    expect(branchesOf(await ledger.findById("je-replace-1"))).toEqual(["BR-GIZA", "BR-GIZA"]);
  });
});
