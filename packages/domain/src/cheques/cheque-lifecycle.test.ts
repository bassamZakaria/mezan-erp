/**
 * The cheque register walked the way أمين الخزنة walks it: one physical cheque,
 * every legal edge and every illegal one, with the ledger asserted line by line
 * on both sides of each transition and every refusal proven to have written
 * nothing.
 *
 * `cheque-service.test.ts` already covers the happy path of each action. What
 * this file adds is the part a real cash day depends on:
 *   - a received cheque is NOT cash — the bank account must not move until the
 *     bank clears it (docs/manual-test-plan/treasury-cashier.md MTP-TRS-26..28);
 *   - every illegal (status, action) pair refused THROUGH THE SERVICE, with the
 *     stored row and the ledger re-read and proven unchanged;
 *   - a bounced cheque is not collectible afterwards, and a replaced one is
 *     closed on both sides so the old and the new are never both live.
 *
 * Every opening balance is non-zero: a zero-to-zero cheque survives a dropped
 * posting, a flipped sign and a transposed debit and credit.
 */

import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { CreateChequeCommand } from "./cheque-service.js";
import type { Cheque, ChequeStoredStatus } from "./cheque.js";
import { InvalidChequeTransitionError } from "./errors.js";

const INCOMING_CONTROL = { underCollectionAccountId: "1320", bouncedAccountId: "1360" };
const OUTGOING_CONTROL = { underCollectionAccountId: "2150", bouncedAccountId: null };

/** The cheque the whole file follows: 1,750.25 from شركة الأمل, due 2026-08-20. */
const AMOUNT = Money.fromMajor("1750.25");

function incoming(o: Partial<CreateChequeCommand> = {}): CreateChequeCommand {
  return {
    id: "chq-in",
    direction: "incoming",
    chequeNumber: "0451236",
    bankName: "البنك الأهلي",
    amount: AMOUNT,
    issueDate: "2026-08-02",
    dueDate: "2026-08-20",
    branchId: "b1",
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: INCOMING_CONTROL,
    journalEntryId: "je-create-in",
    ...o,
  };
}

function outgoing(o: Partial<CreateChequeCommand> = {}): CreateChequeCommand {
  return {
    id: "chq-out",
    direction: "outgoing",
    chequeNumber: "9002014",
    bankName: "بنك مصر",
    amount: Money.fromMajor("1600.00"),
    issueDate: "2026-08-02",
    dueDate: "2026-08-23",
    branchId: "b1",
    partyId: "sup-1",
    counterpartyGlAccountId: "2100",
    controlAccounts: OUTGOING_CONTROL,
    journalEntryId: "je-create-out",
    ...o,
  };
}


type Harness = ReturnType<typeof buildTestService>;

/**
 * A drawer that already holds money before the cheque arrives. Seeded straight
 * onto the ledger (Dr the account / Cr 2100) so the opening figures are real
 * posted balances the guard and the reports would both read.
 */
async function seedOpening(h: Harness, accountId: string, major: string, seq: number): Promise<void> {
  await h.ledger.save({
    id: "seed-" + seq,
    entryNo: "SEED-" + seq,
    date: "2026-08-01",
    memo: "أرصدة افتتاحية",
    status: "posted",
    source: "system",
    lines: [
      { accountId, debit: Money.fromMajor(major), credit: Money.zero(), memo: null },
      { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor(major), memo: null },
    ],
    createdAt: "2026-08-01T00:00:00.000Z",
    postedAt: "2026-08-01T00:00:00.000Z",
    reversesEntryId: null,
    reversedByEntryId: null,
  } as JournalEntry);
}

/** Opening: 8,000.00 in the bank, 12,000.00 owed by customers. */
async function openDay(): Promise<Harness> {
  const h = buildTestService();
  await seedOpening(h, "1310", "8000.00", 1);
  await seedOpening(h, "1100", "12000.00", 2);
  return h;
}

async function balances(h: Harness): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ["1100", "1310", "1320", "1360", "2150"]) {
    out[id] = (await h.ledger.accountBalance(id)).balance.toString();
  }
  return out;
}

function lines(entry: JournalEntry | null) {
  return entry?.lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() }));
}

/** Every posted entry id, so a refusal can be proven to have added none. */
async function entryIds(h: Harness): Promise<string[]> {
  return (await h.ledger.list()).map((e) => e.id).sort();
}


describe("a cheque is not cash until the bank clears it", () => {
  it("receiving the paper moves the debt into شيكات تحت التحصيل and leaves the bank exactly where it was", async () => {
    const h = await openDay();
    expect((await balances(h))["1310"]).toBe("8000.000000");

    await h.service.createCheque(incoming());

    const after = await balances(h);
    expect(after["1320"]).toBe("1750.250000");
    expect(after["1100"]).toBe("10249.750000");
    expect(after["1310"]).toBe("8000.000000");
    expect(lines(await h.ledger.findById("je-create-in"))).toEqual([
      { accountId: "1320", debit: "1750.250000", credit: "0.000000" },
      { accountId: "1100", debit: "0.000000", credit: "1750.250000" },
    ]);
  });

  it("depositing it at the bank moves no money at all — same instrument, same accounts", async () => {
    const h = await openDay();
    await h.service.createCheque(incoming());
    const before = await balances(h);
    const beforeEntries = await entryIds(h);

    const deposited = await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });

    expect(deposited.status).toBe("deposited");
    expect(deposited.bankTreasuryAccountId).toBe("ta-bank1");
    expect(deposited.depositedAt).toBe("2026-08-22T10:00:00.000Z");
    expect(await balances(h)).toEqual(before);
    expect(await entryIds(h)).toEqual(beforeEntries);
  });

  it("only clearing turns it into bank cash, and it empties تحت التحصيل exactly", async () => {
    const h = await openDay();
    await h.service.createCheque(incoming());
    await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });

    await h.service.collect({ chequeId: "chq-in", bankGlAccountId: "1310", journalEntryId: "je-collect", date: "2026-08-20" });

    const after = await balances(h);
    expect(after["1310"]).toBe("9750.250000");
    expect(after["1320"]).toBe("0.000000");
    expect(after["1100"]).toBe("10249.750000");
    expect(lines(await h.ledger.findById("je-collect"))).toEqual([
      { accountId: "1310", debit: "1750.250000", credit: "0.000000" },
      { accountId: "1320", debit: "0.000000", credit: "1750.250000" },
    ]);
  });

  it("an outgoing cheque parks the supplier debt in شيكات مدفوعة and only leaves the bank on clearance", async () => {
    const h = await openDay();
    await h.service.createCheque(outgoing());
    expect((await balances(h))["1310"]).toBe("8000.000000");
    expect((await balances(h))["2150"]).toBe("-1600.000000");

    await h.service.deposit({ chequeId: "chq-out", bankTreasuryAccountId: "ta-bank1" });
    expect((await balances(h))["1310"]).toBe("8000.000000");

    await h.service.collect({ chequeId: "chq-out", bankGlAccountId: "1310", journalEntryId: "je-collect-out", date: "2026-08-23" });
    const after = await balances(h);
    expect(after["1310"]).toBe("6400.000000");
    expect(after["2150"]).toBe("0.000000");
  });
});


const ACTIONS = ["deposit", "collect", "bounce", "replace"] as const;
type Action = (typeof ACTIONS)[number];

/** The one status each action is legal from — the register has no other edges. */
const LEGAL_FROM: Record<Action, ChequeStoredStatus> = {
  deposit: "pending",
  collect: "deposited",
  bounce: "deposited",
  replace: "bounced",
};

async function chequeAt(status: ChequeStoredStatus): Promise<Harness> {
  const h = await openDay();
  await h.service.createCheque(incoming());
  if (status === "pending") return h;
  await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });
  if (status === "deposited") return h;
  if (status === "collected") {
    await h.service.collect({ chequeId: "chq-in", bankGlAccountId: "1310", journalEntryId: "je-collect", date: "2026-08-20" });
    return h;
  }
  await h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-bounce", date: "2026-08-21" });
  if (status === "bounced") return h;
  await h.service.replace({
    bouncedChequeId: "chq-in",
    newCheque: { id: "chq-in-r", chequeNumber: "0451299", bankName: "البنك الأهلي", issueDate: "2026-08-21", dueDate: "2026-09-10", branchId: "b1" },
    journalEntryId: "je-replace",
    date: "2026-08-21",
  });
  return h;
}

function invoke(h: Harness, action: Action, seq: string): Promise<unknown> {
  if (action === "deposit") return h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });
  if (action === "collect") return h.service.collect({ chequeId: "chq-in", bankGlAccountId: "1310", journalEntryId: "je-illegal-" + seq, date: "2026-08-22" });
  if (action === "bounce") return h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-illegal-" + seq, date: "2026-08-22" });
  return h.service.replace({
    bouncedChequeId: "chq-in",
    newCheque: { id: "chq-illegal-" + seq, chequeNumber: "ILLEGAL-" + seq, bankName: "x", issueDate: "2026-08-22", dueDate: "2026-09-22", branchId: "b1" },
    journalEntryId: "je-illegal-" + seq,
    date: "2026-08-22",
  });
}

describe("every illegal edge of the register is refused, and the refusal writes nothing", () => {
  const STORED: ChequeStoredStatus[] = ["pending", "deposited", "collected", "bounced", "replaced"];

  for (const from of STORED) {
    for (const action of ACTIONS) {
      if (LEGAL_FROM[action] === from) continue;
      it(action + " is refused on a " + from + " cheque and leaves the row and the ledger untouched", async () => {
        const h = await chequeAt(from);
        const before = (await h.service.findById("chq-in")) as Cheque;
        const beforeEntries = await entryIds(h);
        const beforeBalances = await balances(h);
        expect(before.status).toBe(from);

        await expect(invoke(h, action, from + "-" + action)).rejects.toBeInstanceOf(InvalidChequeTransitionError);

        expect(await h.service.findById("chq-in")).toEqual(before);
        expect(await entryIds(h)).toEqual(beforeEntries);
        expect(await balances(h)).toEqual(beforeBalances);
      });
    }
  }

  it("and the legal edge out of each state still works — a guard that refuses everything is not a guard", async () => {
    for (const action of ACTIONS) {
      const h = await chequeAt(LEGAL_FROM[action]);
      await expect(invoke(h, action, "legal-" + action)).resolves.toBeTruthy();
    }
  });
});


describe("the bounced cheque from last week", () => {
  it("takes the value straight back out of تحت التحصيل and into شيكات مرتجعة, to the micro-unit", async () => {
    const h = await chequeAt("deposited");
    const beforeBank = (await balances(h))["1310"];

    await h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-bounce", date: "2026-08-21" });

    const after = await balances(h);
    expect(after["1320"]).toBe("0.000000");
    expect(after["1360"]).toBe("1750.250000");
    expect(after["1310"]).toBe(beforeBank);
    expect(lines(await h.ledger.findById("je-bounce"))).toEqual([
      { accountId: "1360", debit: "1750.250000", credit: "0.000000" },
      { accountId: "1320", debit: "0.000000", credit: "1750.250000" },
    ]);
  });

  it("an outgoing bounce puts the supplier payable back — we never actually paid them", async () => {
    const h = await openDay();
    await h.service.createCheque(outgoing());
    await h.service.deposit({ chequeId: "chq-out", bankTreasuryAccountId: "ta-bank1" });
    const apBefore = (await h.ledger.accountBalance("2100")).balance.toString();

    await h.service.bounce({ chequeId: "chq-out", journalEntryId: "je-bounce-out", date: "2026-08-24" });

    const apAfter = (await h.ledger.accountBalance("2100")).balance.toString();
    expect(Money.fromMajor(apBefore).scaled - Money.fromMajor(apAfter).scaled).toBe(Money.fromMajor("1600.00").scaled);
    expect((await balances(h))["2150"]).toBe("0.000000");
    expect((await balances(h))["1310"]).toBe("8000.000000");
  });

  it("LIMITATION: an incoming bounce never puts the debt back onto the customer own receivable", async () => {
    const h = await chequeAt("deposited");
    await h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-bounce", date: "2026-08-21" });

    const after = await balances(h);
    // The receivable was credited the moment the paper arrived and is never
    // re-debited: 12,000.00 opening less the 1,750.25 cheque.
    expect(after["1100"]).toBe("10249.750000");
    // The whole 1,750.25 sits in the un-partied 1360 control instead, so the
    // customer sub-ledger and the AR control no longer describe the same debt.
    expect(after["1360"]).toBe("1750.250000");
  });
});


describe("replacement closes the old cheque instead of leaving two live", () => {
  it("reclassifies 1360 back into 1320 and links both rows in both directions", async () => {
    const h = await chequeAt("bounced");

    const { original, replacement } = await h.service.replace({
      bouncedChequeId: "chq-in",
      newCheque: { id: "chq-in-r", chequeNumber: "0451299", bankName: "البنك الأهلي", issueDate: "2026-08-21", dueDate: "2026-09-10", branchId: "b1" },
      journalEntryId: "je-replace",
      date: "2026-08-21",
    });

    expect(original.status).toBe("replaced");
    expect(original.replacedByChequeId).toBe("chq-in-r");
    expect(replacement.replacesChequeId).toBe("chq-in");
    expect(replacement.amount.toString()).toBe("1750.250000");
    const after = await balances(h);
    expect(after["1360"]).toBe("0.000000");
    expect(after["1320"]).toBe("1750.250000");
    expect(after["1100"]).toBe("10249.750000");
  });

  it("the replaced cheque is closed for good — it can never be deposited or collected again", async () => {
    const h = await chequeAt("replaced");
    const before = await h.service.findById("chq-in");
    const beforeEntries = await entryIds(h);

    await expect(h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" })).rejects.toBeInstanceOf(InvalidChequeTransitionError);
    await expect(h.service.collect({ chequeId: "chq-in", bankGlAccountId: "1310", journalEntryId: "je-x" })).rejects.toBeInstanceOf(InvalidChequeTransitionError);

    expect(await h.service.findById("chq-in")).toEqual(before);
    expect(await entryIds(h)).toEqual(beforeEntries);
  });

  it("exactly one of the pair is collectible: only the replacement can still be deposited", async () => {
    const h = await chequeAt("replaced");
    const live = (await h.service.list({})).filter((c) => c.status === "pending");
    expect(live.map((c) => c.id)).toEqual(["chq-in-r"]);
  });

  it("refuses a replacement whose number is already carried by a live cheque, and posts nothing", async () => {
    const h = await chequeAt("bounced");
    await h.service.createCheque(incoming({ id: "chq-other", chequeNumber: "0451299", journalEntryId: "je-other", dueDate: "2026-08-28" }));
    const beforeEntries = await entryIds(h);
    const beforeBalances = await balances(h);

    await expect(
      h.service.replace({
        bouncedChequeId: "chq-in",
        newCheque: { id: "chq-in-r", chequeNumber: "0451299", bankName: "البنك الأهلي", issueDate: "2026-08-21", dueDate: "2026-09-10", branchId: "b1" },
        journalEntryId: "je-replace",
        date: "2026-08-21",
      }),
    ).rejects.toThrow(/0451299/);

    expect(await h.service.findById("chq-in-r")).toBeNull();
    expect((await h.service.findById("chq-in"))!.status).toBe("bounced");
    expect(await entryIds(h)).toEqual(beforeEntries);
    expect(await balances(h)).toEqual(beforeBalances);
  });
});


describe("post-dated cheques as a due-date calendar", () => {
  async function week(): Promise<Harness> {
    const h = await openDay();
    await h.service.createCheque(incoming({ id: "in-soon", chequeNumber: "IN-1", dueDate: "2026-08-24", journalEntryId: "je-1" }));
    await h.service.createCheque(outgoing({ id: "out-soon", chequeNumber: "OUT-1", dueDate: "2026-08-23", journalEntryId: "je-2" }));
    await h.service.createCheque(incoming({ id: "in-far", chequeNumber: "IN-2", dueDate: "2026-09-30", journalEntryId: "je-3" }));
    return h;
  }

  it("the week ahead lists what is coming in and what is going out, in due-date order", async () => {
    const h = await week();
    const due = await h.service.list({ fromDate: "2026-08-22", toDate: "2026-08-29" });
    expect(due.map((c) => c.id)).toEqual(["out-soon", "in-soon"]);
    expect(Money.sum(due.map((c) => c.amount)).toString()).toBe("3350.250000");
  });

  it("derives يقترب موعد الاستحقاق only inside the window and استحق ولم يُودع from the due date on", async () => {
    const h = await week();
    expect((await h.service.list({ status: "under_collection", asOfDate: "2026-08-22" })).map((c) => c.id)).toEqual(["out-soon", "in-soon"]);
    expect((await h.service.list({ status: "due_today", asOfDate: "2026-08-24" })).map((c) => c.id)).toEqual(["out-soon", "in-soon"]);
    expect((await h.service.list({ status: "pending", asOfDate: "2026-08-22" })).map((c) => c.id)).toEqual(["in-far"]);
  });

  it("LIMITATION: a post-dated cheque can be cleared weeks before its due date", async () => {
    const h = await openDay();
    await h.service.createCheque(incoming({ dueDate: "2026-08-30" }));
    await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });

    // Nothing compares the collection date against dueDate, so the bank cash is
    // recognised 25 days before the paper is presentable.
    const collected = await h.service.collect({ chequeId: "chq-in", bankGlAccountId: "1310", journalEntryId: "je-early", date: "2026-08-05" });
    expect(collected.status).toBe("collected");
    expect((await balances(h))["1310"]).toBe("9750.250000");
  });

  it("LIMITATION: the due-date window is a date filter, not a still-to-act-on queue", async () => {
    const h = await week();
    await h.service.deposit({ chequeId: "in-soon", bankTreasuryAccountId: "ta-bank1" });
    await h.service.collect({ chequeId: "in-soon", bankGlAccountId: "1310", journalEntryId: "je-c", date: "2026-08-24" });

    // Already banked, yet still counted in "what is due this week".
    const due = await h.service.list({ fromDate: "2026-08-22", toDate: "2026-08-29" });
    expect(due.map((c) => c.id + ":" + c.status)).toEqual(["out-soon:pending", "in-soon:collected"]);
  });
});

describe("who moved the cheque", () => {
  it("LIMITATION: every transition is timestamped and none of them records an actor", async () => {
    const h = await chequeAt("bounced");
    const cheque = (await h.service.findById("chq-in")) as Cheque;

    expect(cheque.depositedAt).toBe("2026-08-22T10:00:00.000Z");
    expect(cheque.bouncedAt).toBe("2026-08-22T10:00:00.000Z");
    // Nothing on the row, and no audit port on ChequeServiceDeps, names who did it.
    expect(Object.keys(cheque).filter((k) => /by$|actor|user/i.test(k))).toEqual([]);
  });
});

describe("an outgoing replacement", () => {
  it("LIMITATION: createCheque(replacesChequeId) leaves the cheque it claims to replace fully live", async () => {
    const h = await openDay();
    await h.service.createCheque(outgoing());
    await h.service.createCheque(
      outgoing({ id: "chq-out-r", chequeNumber: "9002099", journalEntryId: "je-out-r", replacesChequeId: "chq-out" }),
    );

    const original = (await h.service.findById("chq-out")) as Cheque;
    // Still pending, still depositable, and with no link forward to its own
    // replacement — both cheques are live for the same 1,600.00 supplier debt.
    expect(original.status).toBe("pending");
    expect(original.replacedByChequeId).toBeNull();
    expect((await balances(h))["2150"]).toBe("-3200.000000");
    await expect(h.service.deposit({ chequeId: "chq-out", bankTreasuryAccountId: "ta-bank1" })).resolves.toBeTruthy();
  });
});

