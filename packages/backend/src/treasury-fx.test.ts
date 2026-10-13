import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const SCALE = 1_000_000n;
const USD_BANK = { treasuryAccountId: "TR-DEMO-BANK-USD", treasuryGlAccountId: "1310-USD" };
const EGP_BANK = { treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: "1310" };

interface TreasuryLeg {
  debit: bigint;
  credit: bigint;
  currency: string | null;
  fxRate: string | null;
}
function legs(voucherId: string, accountId: string): TreasuryLeg[] {
  return world.sqlite
    .prepare(
      `SELECT jl.debit, jl.credit, jl.currency, jl.fx_rate AS fxRate FROM journal_line jl JOIN voucher v ON v.journal_entry_id = jl.entry_id WHERE v.id = ? AND jl.account_id = ? ORDER BY jl.line_no`,
    )
    .safeIntegers()
    .all(voucherId, accountId) as TreasuryLeg[];
}
async function voucher(id: string, body: Record<string, unknown>) {
  const created = await world.request("POST", "/vouchers", { id, branchId: "BR-MAIN", memo: "اختبار عملة الخزينة", paymentMethod: "bank", ...body });
  if (created.status !== 201) return created;
  return world.request("POST", `/vouchers/${id}/confirm`, {});
}
const treasuryFx = async (id: string) => (await world.request("GET", `/vouchers/${id}`)).body.treasuryFx as Record<string, unknown> | null;
const fxFinding = async (periodId: string) => {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; findings: { kind: string; ref: string; passed: boolean }[] }[];
  return checks.flatMap((c) => c.findings).find((f) => f.kind === "foreign_currency" && f.ref === "USD");
};

describe("a voucher on a foreign-currency treasury account", () => {
  it("the seeded USD receipt carries its currency and rate on the bank line, so the ledger knows it holds 1,200 dollars", () => {
    expect(legs("VCH-DEMO-USD-1", "1310-USD")).toEqual([{ debit: 58_680n * SCALE, credit: 0n, currency: "USD", fxRate: "48.90" }]);
  });

  it("a USD payment at a later rate takes its dollars out at that day's rate and brings the bank back to what they were carried at", async () => {
    const paid = await voucher("TFX-PAY-USD", { date: "2026-08-20", voucherType: "other_expense", amount: "200.00", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "5910" });
    expect(paid.status).toBe(200);
    expect(legs("TFX-PAY-USD", "1310-USD")).toEqual([
      { debit: 0n, credit: 9_870n * SCALE, currency: "USD", fxRate: "49.35" },
      { debit: 90n * SCALE, credit: 0n, currency: "USD", fxRate: "49.35" },
    ]);
    expect(await treasuryFx("TFX-PAY-USD")).toEqual({ currency: "USD", fxRate: "49.35", foreignAmount: "200.000000", carryingBase: "9780.000000", realised: "90.000000", realisedAccountId: "4920" });
  });

  it("a payment stated in the base currency from the USD bank posts the base amount and records the dollars at the day's rate", async () => {
    const paid = await voucher("TFX-PAY-EGP", { date: "2026-08-20", voucherType: "other_expense", amount: "4935.00", currency: "EGP", ...USD_BANK, counterpartyGlAccountId: "5910" });
    expect(paid.status).toBe(200);
    expect(legs("TFX-PAY-EGP", "1310-USD")).toEqual([
      { debit: 0n, credit: 4_935n * SCALE, currency: "USD", fxRate: "49.35" },
      { debit: 45n * SCALE, credit: 0n, currency: "USD", fxRate: "49.35" },
    ]);
    expect(legs("TFX-PAY-EGP", "5910")).toEqual([{ debit: 4_935n * SCALE, credit: 0n, currency: null, fxRate: null }]);
    expect(await treasuryFx("TFX-PAY-EGP")).toEqual({ currency: "USD", fxRate: "49.35", foreignAmount: "100.000000", carryingBase: "4890.000000", realised: "45.000000", realisedAccountId: "4920" });
  });

  it("a voucher in a second foreign currency is refused: one line carries one rate", async () => {
    const refused = await world.request("POST", "/vouchers", { id: "TFX-EUR", branchId: "BR-MAIN", memo: "x", paymentMethod: "bank", date: "2026-08-20", voucherType: "other_expense", amount: "10.00", currency: "EUR", ...USD_BANK, counterpartyGlAccountId: "5910" });
    expect(refused.status).toBe(422);
    expect(String(refused.body.message)).toBe("حساب الخزينة بعملة USD والسند بعملة EUR؛ لا يُسجَّل سند بعملة أجنبية على حساب خزينة بعملة أجنبية أخرى. سجّل السند بعملة الحساب أو بالعملة الأساسية.");
    expect(String(refused.body.messageEn)).toContain("EUR");
  });

  it("a transfer from the base-currency bank into the USD bank carries the rate on the dollar leg only", async () => {
    const moved = await voucher("TFX-TR", { date: "2026-08-20", voucherType: "inter_treasury_transfer", amount: "9870.00", currency: "EGP", ...EGP_BANK, counterTreasuryAccountId: "TR-DEMO-BANK-USD", counterTreasuryGlAccountId: "1310-USD" });
    expect(moved.status).toBe(200);
    expect(legs("TFX-TR", "1310-USD")).toEqual([{ debit: 9_870n * SCALE, credit: 0n, currency: "USD", fxRate: "49.35" }]);
    expect(legs("TFX-TR", "1310")).toEqual([{ debit: 0n, credit: 9_870n * SCALE, currency: null, fxRate: null }]);
    expect((await world.request("GET", "/vouchers/TFX-TR")).body.counterTreasuryFx).toEqual({ currency: "USD", fxRate: "49.35", foreignAmount: "200.000000" });
  });
});

describe("what the USD bank holds, in dollars", () => {
  it("is on the treasury account and on balances by currency: 1,100 dollars carried at 53,880", async () => {
    const account = (await world.request("GET", "/treasury-accounts/TR-DEMO-BANK-USD")).body;
    expect(account).toMatchObject({ currency: "USD", foreignBalance: "1100.000000", foreignBalanceBase: "53880.000000", foreignBalanceDerivedLines: 0 });
    const listed = ((await world.request("GET", "/treasury-accounts")).body as unknown as { id: string; foreignBalance: string | null }[]);
    expect(listed.find((a) => a.id === "TR-DEMO-BANK-USD")?.foreignBalance).toBe("1100.000000");
    expect(listed.find((a) => a.id === "TR-DEMO-BANK")?.foreignBalance).toBeNull();

    const report = (await world.request("GET", "/gl/balances-by-currency")).body;
    expect(report.treasury).toEqual([
      { treasuryAccountId: "TR-DEMO-BANK-USD", name: expect.any(String), glAccountId: "1310-USD", currency: "USD", foreignBalance: "1100.000000", baseBalance: "53880.000000", derivedLines: 0 },
    ]);
  });
});

describe("a cheque collected into the USD bank", () => {
  it("posts its bank line with the account's currency at the rate of the collection day", async () => {
    const created = await world.request("POST", "/cheques", {
      id: "TFX-CHQ", direction: "incoming", chequeNumber: "N-TFX-CHQ", bankName: "بنك مصر", issueDate: "2026-09-02", dueDate: "2026-09-02", branchId: "BR-MAIN", partyId: "CUST-DEMO-1",
      counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount: "987.00",
    });
    expect(created.status).toBe(201);
    expect((await world.request("POST", "/cheques/TFX-CHQ/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK-USD" })).status).toBe(200);
    const collected = await world.request("POST", "/cheques/TFX-CHQ/collect", { bankGlAccountId: "1310-USD", date: "2026-09-05" });
    expect(collected.status).toBe(200);
    const line = world.sqlite
      .prepare(`SELECT debit, currency, fx_rate AS fxRate FROM journal_line WHERE entry_id = ? AND account_id = '1310-USD'`)
      .safeIntegers()
      .get(String(collected.body.collectionJournalEntryId));
    expect(line).toEqual({ debit: 987n * SCALE, currency: "USD", fxRate: "49.35" });
  });
});

describe("month-end revaluation of the USD bank", () => {
  it("August's close asks for USD to be revalued", async () => {
    expect(await fxFinding("fp-2026-08")).toMatchObject({ passed: false });
  });

  it("restates 1,100 dollars carried at 53,880 to the closing rate of 49.35: 405 unrealised, reversed the next day — with the 135 the two payments realised, the 540 the dollars gained", async () => {
    const preview = await world.request("POST", "/revaluation/preview", { date: "2026-08-31", currencies: ["USD"] });
    expect(preview.status).toBe(200);
    const bank = (preview.body.details as { accountId: string; foreignAmount: string; bookedBase: string; revaluedBase: string; delta: string }[]).find((d) => d.accountId === "1310-USD");
    expect(bank).toMatchObject({ foreignAmount: "1100.000000", bookedBase: "53880.000000", revaluedBase: "54285.000000", delta: "405.000000" });
    const realisedByPayments = legs("TFX-PAY-USD", "4920")[0]!.credit + legs("TFX-PAY-EGP", "4920")[0]!.credit;
    expect(realisedByPayments + 405n * SCALE).toBe(540n * SCALE);

    const gainBefore = world.balance("4940");
    const bankBefore = world.balance("1310-USD", "2026-08-31");
    const posted = await world.request("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"] });
    expect(posted.status).toBe(201);

    expect(world.balance("1310-USD", "2026-08-31") - bankBefore).toBe(405n * SCALE);
    expect(world.balance("4940", "2026-08-31") - gainBefore).toBe(-405n * SCALE);
    expect(world.balance("1310-USD", "2026-08-31")).toBe(54_285n * SCALE);
    expect(world.balance("1310-USD", "2026-09-01")).toBe(bankBefore);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("and August's close FX check then passes", async () => {
    expect(await fxFinding("fp-2026-08")).toMatchObject({ passed: true });
  });
});

describe("a line posted on the USD bank before lines carried a currency", () => {
  it("is read at the rate in force on its own date, reported as derived, and never rewritten", async () => {
    const before = (await world.request("POST", "/revaluation/preview", { date: "2026-09-30", currencies: ["USD"] })).body;
    world.sqlite
      .prepare(`INSERT INTO journal_entry (id, entry_no, date, memo, status, source, created_at, posted_at) VALUES ('TFX-LEGACY', 'JE-TFX-LEGACY', '2026-09-10', 'قيد قديم', 'posted', 'system', '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')`)
      .run();
    const line = world.sqlite.prepare(`INSERT INTO journal_line (entry_id, line_no, account_id, debit, credit) VALUES ('TFX-LEGACY', ?, ?, ?, ?)`);
    line.run(1, "1310-USD", 4_935_000_000, 0);
    line.run(2, "2190", 0, 4_935_000_000);

    const after = (await world.request("POST", "/revaluation/preview", { date: "2026-09-30", currencies: ["USD"] })).body;
    const foreign = (body: typeof after) => BigInt(String((body.details as { accountId: string; foreignAmount: string }[]).find((d) => d.accountId === "1310-USD")?.foreignAmount ?? "0").replace(".", ""));
    expect(foreign(after) - foreign(before)).toBe(100n * SCALE);
    expect(after.derivedTreasuryLines).toEqual([{ entryId: "TFX-LEGACY", accountId: "1310-USD", date: "2026-09-10", currency: "USD", fxRate: "49.35", foreignAmount: "100.000000" }]);
    expect(world.sqlite.prepare(`SELECT currency, fx_rate AS fxRate FROM journal_line WHERE entry_id = 'TFX-LEGACY' AND account_id = '1310-USD'`).get()).toEqual({ currency: null, fxRate: null });
  });
});
