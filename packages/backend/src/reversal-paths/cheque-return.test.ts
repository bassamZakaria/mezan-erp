import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const AMOUNT = 3_100_000_000n;
const cheque = () =>
  world.sqlite.prepare(`SELECT status, collection_journal_entry_id AS collectionEntryId, bounce_journal_entry_id AS bounceEntryId FROM cheque WHERE id = 'CHQ-DEMO-2'`).get() as { status: string; collectionEntryId: string; bounceEntryId: string | null };

describe("a collected cheque the bank returns", () => {
  it("takes the money back out of the bank, re-opens the receivable, and leaves the cheque bounced and replaceable", async () => {
    const collectionEntryId = cheque().collectionEntryId;
    const before = { bank: world.balance("1310"), underCollection: world.balance("1320"), receivable: world.balance("1105") };
    await expectJournalRouteClosed(world, collectionEntryId);
    await expectRefusedInClosedPeriod(world, `fp-${entry(world, collectionEntryId).date.slice(0, 7)}`, () => world.request("POST", "/cheques/CHQ-DEMO-2/return", {}));
    expect(cheque().status).toBe("collected");

    const returned = await world.request("POST", "/cheques/CHQ-DEMO-2/return", {});

    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect(returned.body).toMatchObject({ id: "CHQ-DEMO-2", status: "bounced" });
    expect(entry(world, collectionEntryId).status).toBe("reversed");
    expect(entry(world, cheque().bounceEntryId as string).status).toBe("posted");
    expect(before.bank - world.balance("1310")).toBe(AMOUNT);
    expect(world.balance("1320")).toBe(before.underCollection);
    expect(world.balance("1105") - before.receivable).toBe(AMOUNT);
    expect(auditRows(world, "CHEQUE", "CHQ-DEMO-2", "RETURN")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await world.request("POST", "/cheques/CHQ-DEMO-2/return", {});
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 INVALID_CHEQUE_TRANSITION");
  });

  it("refuses a return dated before the day the cheque was collected", async () => {
    const res = await world.request("POST", "/cheques/CHQ-DEMO-4/return", { date: "2026-08-01" });
    expect(`${res.status} ${String(res.body.error)}`).toBe("422 REVERSAL_DATE_BEFORE_ORIGINAL");
    expect(typeof res.body.messageEn).toBe("string");
  });

  it("an outgoing cheque returned after it cleared puts the money back in the bank and the payable back on the supplier", async () => {
    const before = { payable: world.balance("2100") };
    const res = await world.request("POST", "/cheques/CHQ-DEMO-4/return", {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(before.payable - world.balance("2100")).toBe(4_200_000_000n);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a cheque collected into the USD bank and then returned", () => {
  const usdBank = async () =>
    ((await world.request("GET", "/gl/balances-by-currency")).body.treasury as { treasuryAccountId: string; foreignBalance: string; baseBalance: string }[]).find((row) => row.treasuryAccountId === "TR-DEMO-BANK-USD");
  const bankLine = (entryId: string) =>
    world.sqlite.prepare(`SELECT debit, credit, currency, fx_rate AS fxRate FROM journal_line WHERE entry_id = ? AND account_id = '1310-USD'`).safeIntegers().all(entryId);

  it("gives back the dollars it took in at the rate it took them in, with no exchange difference", async () => {
    const before = { bank: await usdBank(), base: world.balance("1310-USD"), receivable: world.balance("1105"), realisedGain: world.balance("4920"), realisedLoss: world.balance("5920") };
    const created = await world.request("POST", "/cheques", {
      id: "RET-USD", direction: "incoming", chequeNumber: "N-RET-USD", bankName: "بنك مصر", issueDate: "2026-09-02", dueDate: "2026-09-02", branchId: "BR-MAIN", partyId: "CUST-DEMO-1",
      counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount: "987.00",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await world.request("POST", "/cheques/RET-USD/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK-USD" })).status).toBe(200);
    const collected = await world.request("POST", "/cheques/RET-USD/collect", { bankGlAccountId: "1310-USD", date: "2026-09-05" });
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    const collectionEntryId = String(collected.body.collectionJournalEntryId);
    expect(bankLine(collectionEntryId)).toEqual([{ debit: 987_000_000n, credit: 0n, currency: "USD", fxRate: "49.35" }]);
    expect(world.balance("1310-USD") - before.base).toBe(987_000_000n);

    const returned = await world.request("POST", "/cheques/RET-USD/return", { date: "2026-09-10" });

    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const reversalId = entry(world, collectionEntryId).reversedBy as string;
    expect(entry(world, reversalId).date).toBe("2026-09-10");
    expect(bankLine(reversalId)).toEqual([{ debit: 0n, credit: 987_000_000n, currency: "USD", fxRate: "49.35" }]);
    expect(world.balance("1310-USD")).toBe(before.base);
    expect(await usdBank()).toEqual(before.bank);
    expect(world.balance("1105")).toBe(before.receivable);
    expect(world.balance("4920")).toBe(before.realisedGain);
    expect(world.balance("5920")).toBe(before.realisedLoss);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
