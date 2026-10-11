import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeEach(async () => {
  world = await seededWorld();
}, 120_000);

afterEach(() => world?.close());

const SCALE = 1_000_000n;
const USD_BANK = { treasuryAccountId: "TR-DEMO-BANK-USD", treasuryGlAccountId: "1310-USD" };
const EGP_BANK = { treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: "1310" };
const REALISED_MEMO = "فروق عملة محققة";

interface Leg {
  accountId: string;
  debit: bigint;
  credit: bigint;
  currency: string | null;
  fxRate: string | null;
  memo: string | null;
}
function entry(voucherId: string): Leg[] {
  return world.sqlite
    .prepare(`SELECT jl.account_id AS accountId, jl.debit, jl.credit, jl.currency, jl.fx_rate AS fxRate, jl.memo FROM journal_line jl JOIN voucher v ON v.journal_entry_id = jl.entry_id WHERE v.id = ? ORDER BY jl.line_no`)
    .safeIntegers()
    .all(voucherId) as Leg[];
}
async function voucher(id: string, body: Record<string, unknown>) {
  const created = await world.request("POST", "/vouchers", { id, branchId: "BR-MAIN", memo: "اختبار", paymentMethod: "bank", ...body });
  if (created.status !== 201) return created;
  return world.request("POST", `/vouchers/${id}/confirm`, {});
}
const holds = async () => {
  const account = (await world.request("GET", "/treasury-accounts/TR-DEMO-BANK-USD")).body;
  return { foreign: String(account.foreignBalance), base: String(account.foreignBalanceBase) };
};
const realised = () => world.balance("4920") + world.balance("5920");
const closeFindings = async (periodId: string) => {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; findings: { kind: string; ref: string; passed: boolean; amount: string | null }[] }[];
  return checks.flatMap((c) => c.findings);
};

describe("money leaving a foreign-currency treasury account leaves at what it is carried at", () => {
  it("draining the USD bank at a later rate leaves no dollars and no base, and books the 540 once as a realised gain", async () => {
    expect(await holds()).toEqual({ foreign: "1200.000000", base: "58680.000000" });
    const before = realised();

    const paid = await voucher("CAR-DRAIN", { date: "2026-08-20", voucherType: "other_expense", amount: "1200", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "5910" });

    expect(paid.status).toBe(200);
    expect(entry("CAR-DRAIN")).toEqual([
      { accountId: "5910", debit: 59_220n * SCALE, credit: 0n, currency: "USD", fxRate: "49.35", memo: null },
      { accountId: "1310-USD", debit: 0n, credit: 59_220n * SCALE, currency: "USD", fxRate: "49.35", memo: null },
      { accountId: "1310-USD", debit: 540n * SCALE, credit: 0n, currency: "USD", fxRate: "49.35", memo: REALISED_MEMO },
      { accountId: "4920", debit: 0n, credit: 540n * SCALE, currency: null, fxRate: null, memo: REALISED_MEMO },
    ]);
    expect(await holds()).toEqual({ foreign: "0.000000", base: "0.000000" });
    expect(world.balance("1310-USD")).toBe(0n);
    expect(realised() - before).toBe(-540n * SCALE);
    expect((await world.request("GET", "/vouchers/CAR-DRAIN")).body.treasuryFx).toEqual({
      currency: "USD", fxRate: "49.35", foreignAmount: "1200.000000", carryingBase: "58680.000000", realised: "540.000000", realisedAccountId: "4920",
    });
    expect((await closeFindings("fp-2026-08")).filter((f) => f.kind === "foreign_residue")).toEqual([]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a part payment relieves its share of the carrying amount, and reversing it puts everything back", async () => {
    const before = realised();
    expect((await voucher("CAR-PART", { date: "2026-08-20", voucherType: "other_expense", amount: "200", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "5910" })).status).toBe(200);

    expect(await holds()).toEqual({ foreign: "1000.000000", base: "48900.000000" });
    expect(realised() - before).toBe(-90n * SCALE);

    expect((await world.request("POST", "/vouchers/CAR-PART/reverse", { date: "2026-08-21" })).status).toBe(201);
    expect(await holds()).toEqual({ foreign: "1200.000000", base: "58680.000000" });
    expect(realised() - before).toBe(0n);
  });

  it("a payment stated in pounds from the USD bank measures the dollars at the day's rate and relieves them at carrying", async () => {
    const before = realised();
    expect((await voucher("CAR-EGP", { date: "2026-08-20", voucherType: "other_expense", amount: "4935.00", currency: "EGP", ...USD_BANK, counterpartyGlAccountId: "5910" })).status).toBe(200);
    expect(await holds()).toEqual({ foreign: "1100.000000", base: "53790.000000" });
    expect(realised() - before).toBe(-45n * SCALE);
  });

  it("a transfer out of the USD bank into the pound bank realises the difference on the dollars that left", async () => {
    const before = realised();
    const moved = await voucher("CAR-TR", { date: "2026-08-20", voucherType: "inter_treasury_transfer", amount: "100", currency: "USD", ...USD_BANK, counterTreasuryAccountId: EGP_BANK.treasuryAccountId, counterTreasuryGlAccountId: EGP_BANK.treasuryGlAccountId });
    expect(moved.status).toBe(200);
    expect(await holds()).toEqual({ foreign: "1100.000000", base: "53790.000000" });
    expect(realised() - before).toBe(-45n * SCALE);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("money coming in is added at the rate of its own day and realises nothing", async () => {
    const before = realised();
    expect((await voucher("CAR-IN", { date: "2026-08-20", voucherType: "other_income", amount: "100", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "4910" })).status).toBe(200);
    expect(await holds()).toEqual({ foreign: "1300.000000", base: "63615.000000" });
    expect(realised() - before).toBe(0n);
  });

  it("paying a dollar invoice from the dollar bank realises the payable's difference and the bank's, each once: owed and held at the same rate nets to nothing", async () => {
    const apBeforeInvoice = world.balance("2100");
    const created = await world.request("POST", "/purchases/invoices", {
      id: "CAR-PI", supplierId: "SUPP-DEMO-USD", date: "2026-08-05", dueDate: "2026-09-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", currency: "USD",
      lines: [{ itemId: null, description: "خدمة", kind: "expense", qty: "1", unitCost: "1000", taxRatePercent: 0 }],
    });
    expect(created.status).toBe(201);
    expect((await world.request("POST", "/purchases/invoices/CAR-PI/confirm", {})).status).toBe(200);
    const before = { gain: world.balance("4920"), loss: world.balance("5920"), ap: world.balance("2100") };
    expect(before.ap - apBeforeInvoice).toBe(-48_900n * SCALE);

    expect((await voucher("CAR-PAY", { date: "2026-08-20", voucherType: "supplier_payment", amount: "1000", currency: "USD", supplierId: "SUPP-DEMO-USD", ...USD_BANK, counterpartyGlAccountId: "2100" })).status).toBe(200);
    const allocated = await world.request("POST", "/vouchers/CAR-PAY/allocations", { allocationId: "CAR-AL", invoiceId: "CAR-PI", amount: "49350" });
    expect(allocated.status, JSON.stringify(allocated.body)).toBeLessThan(300);

    expect(world.balance("2100") - before.ap).toBe(48_900n * SCALE);
    expect(world.balance("5920") - before.loss).toBe(450n * SCALE);
    expect(world.balance("4920") - before.gain).toBe(-450n * SCALE);
    expect(await holds()).toEqual({ foreign: "200.000000", base: "9780.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a cheque cannot be collected into a foreign-currency bank on a day with no approved rate for its currency", async () => {
    const parent = (world.sqlite.prepare(`SELECT parent_id AS p FROM account WHERE id = '1310-USD'`).get() as { p: string }).p;
    expect((await world.request("POST", "/accounts", { id: "1310-GBP", code: "1310-GBP", nameAr: "بنك استرليني", type: "asset", parentId: parent, naturalBalance: "debit", isHeader: false })).status).toBe(201);
    expect((await world.request("POST", "/treasury-accounts", { id: "TR-GBP", code: "BANK-GBP", name: "بنك استرليني", type: "bank", currency: "GBP", branchId: "BR-MAIN", glAccountId: "1310-GBP" })).status).toBe(201);
    expect((await world.request("POST", "/cheques", { id: "CAR-CHQ", direction: "incoming", chequeNumber: "N-CAR-1", bankName: "بنك", issueDate: "2026-09-02", dueDate: "2026-09-02", branchId: "BR-MAIN", partyId: "CUST-DEMO-1", counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount: "500.00" })).status).toBe(201);
    expect((await world.request("POST", "/cheques/CAR-CHQ/deposit", { bankTreasuryAccountId: "TR-GBP" })).status).toBe(200);

    const refused = await world.request("POST", "/cheques/CAR-CHQ/collect", { bankGlAccountId: "1310-GBP", date: "2026-09-05" });

    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("FX_RATE_MISSING");
    expect(String(refused.body.message)).toContain("GBP");
    expect(String(refused.body.message)).toMatch(/[\u0600-\u06FF]/);
    expect(String(refused.body.messageEn)).toContain("GBP");
    expect(world.balance("1310-GBP")).toBe(0n);
    expect((await world.request("GET", "/cheques/CAR-CHQ")).body.status).toBe("deposited");
  });

  it("an outgoing cheque clearing from the USD bank takes its dollars out at carrying", async () => {
    const before = realised();
    const created = await world.request("POST", "/cheques", { id: "CAR-OUT", direction: "outgoing", chequeNumber: "N-CAR-2", bankName: "بنك", issueDate: "2026-09-02", dueDate: "2026-09-02", branchId: "BR-MAIN", partyId: "SUPP-DEMO-1", counterpartyGlAccountId: "2100", controlAccounts: { underCollectionAccountId: "2150", bouncedAccountId: null }, amount: "987.00" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await world.request("POST", "/cheques/CAR-OUT/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK-USD" })).status).toBe(200);

    const cleared = await world.request("POST", "/cheques/CAR-OUT/collect", { bankGlAccountId: "1310-USD", date: "2026-09-05" });

    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(await holds()).toEqual({ foreign: "1180.000000", base: "57702.000000" });
    expect(realised() - before).toBe(-9n * SCALE);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("the close flags a foreign account left with base and no foreign money", async () => {
    const posted = await world.request("POST", "/gl/journal-entries", {
      id: "CAR-RES", date: "2026-08-22", memo: "أثر قديم",
      lines: [
        { accountId: "1310-USD", debit: "0", credit: "58680", currency: "USD", fxRate: "48.90" },
        { accountId: "1310-USD", debit: "0", credit: "540", currency: "USD", fxRate: "49.35", memo: REALISED_MEMO },
        { accountId: "2190", debit: "59220", credit: "0" },
      ],
    });
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    expect(await holds()).toEqual({ foreign: "0.000000", base: "-540.000000" });

    const residue = (await closeFindings("fp-2026-08")).filter((f) => f.kind === "foreign_residue");
    expect(residue).toEqual([expect.objectContaining({ ref: "1310-USD", passed: false, amount: "-540.000000" })]);
  });
});
