import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

afterEach(() => world?.close());

const SCALE = 1_000_000n;
const USD_BANK = { treasuryAccountId: "TR-DEMO-BANK-USD", treasuryGlAccountId: "1310-USD" };

async function ok(method: string, url: string, body?: unknown, status = 201): Promise<Record<string, unknown>> {
  const res = await world.request(method, url, body);
  expect(`${res.status} ${method} ${url}`, JSON.stringify(res.body)).toBe(`${status} ${method} ${url}`);
  return res.body;
}
async function rate(id: string, value: string, effectiveDate: string) {
  await ok("POST", "/exchange-rates", { id, currency: "USD", rate: value, effectiveDate, rateType: "standard", source: "manual" });
  await ok("POST", `/exchange-rates/${id}/approve`, {}, 200);
}
async function voucher(id: string, body: Record<string, unknown>) {
  await ok("POST", "/vouchers", { id, branchId: "BR-MAIN", memo: "اختبار", paymentMethod: "bank", ...body });
  await ok("POST", `/vouchers/${id}/confirm`, {}, 200);
}
const holds = async () => {
  const account = (await world.request("GET", "/treasury-accounts/TR-DEMO-BANK-USD")).body;
  return { foreign: String(account.foreignBalance), base: String(account.foreignBalanceBase) };
};
const residue = async () => (await world.request("GET", "/reconciliation")).body.foreignResidue as { total: string; rows: { kind: string; ref: string; currency: string; base: string }[] };
const revalue = () => ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false });

describe("whatever holds none of its foreign currency holds no base either", () => {
  it("a USD bank restated at month end and then emptied at a later rate ends with no dollars, no base, and the 1,320 once: 540 unrealised and 780 realised", async () => {
    world = await seededWorld();
    const before = { realised: world.balance("4920") + world.balance("5920"), unrealised: world.balance("4940") + world.balance("5940") };
    await revalue();
    expect(await holds()).toEqual({ foreign: "1200.000000", base: "59220.000000" });
    await rate("fx-sep", "50.00", "2026-09-05");

    await voucher("Z-DRAIN", { date: "2026-09-05", voucherType: "other_expense", amount: "1200", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "5910" });

    expect(await holds()).toEqual({ foreign: "0.000000", base: "0.000000" });
    expect(world.balance("4940") + world.balance("5940") - before.unrealised).toBe(-540n * SCALE);
    expect(world.balance("4920") + world.balance("5920") - before.realised).toBe(-780n * SCALE);
    expect((await residue()).total).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  }, 900_000);

  it("a cheque collected into an empty USD bank, restated by 13.00 at month end and then returned leaves the bank with nothing: the 13.00 goes back as a realised loss", async () => {
    world = await seededWorld();
    await voucher("Z-EMPTY", { date: "2026-08-20", voucherType: "other_expense", amount: "1200", currency: "USD", ...USD_BANK, counterpartyGlAccountId: "5910" });
    expect(await holds()).toEqual({ foreign: "0.000000", base: "0.000000" });
    await ok("POST", "/cheques", {
      id: "Z-CHQ", direction: "incoming", chequeNumber: "N-Z-1", bankName: "بنك مصر", issueDate: "2026-08-22", dueDate: "2026-08-22", branchId: "BR-MAIN", partyId: "CUST-DEMO-1",
      counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount: "987.00",
    });
    await ok("POST", "/cheques/Z-CHQ/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK-USD" }, 200);
    await ok("POST", "/cheques/Z-CHQ/collect", { bankGlAccountId: "1310-USD", date: "2026-08-25" }, 200);
    await rate("fx-eom", "50.00", "2026-08-31");
    await revalue();
    expect(await holds()).toEqual({ foreign: "20.000000", base: "1000.000000" });
    const before = { loss: world.balance("5920"), gain: world.balance("4920"), receivable: world.balance("1105") };

    await ok("POST", "/cheques/Z-CHQ/return", { date: "2026-09-10" }, 200);

    expect(await holds()).toEqual({ foreign: "0.000000", base: "0.000000" });
    expect(world.balance("1310-USD")).toBe(0n);
    expect(world.balance("5920") - before.loss).toBe(13n * SCALE);
    expect(world.balance("4920")).toBe(before.gain);
    expect(world.balance("1105") - before.receivable).toBe(987n * SCALE);
    expect((await residue()).total).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  }, 900_000);

  it("names a foreign account left with base and no foreign money, sweeps a rounding remainder to realised differences, and leaves anything larger standing", async () => {
    world = await seededWorld();
    await ok("POST", "/gl/journal-entries", {
      id: "Z-RES", date: "2026-08-22", memo: "أثر تقريب",
      lines: [
        { accountId: "1310-USD", debit: "0", credit: "58680", currency: "USD", fxRate: "48.90" },
        { accountId: "1310-USD", debit: "0.000003", credit: "0", currency: "USD", fxRate: "48.90", memo: "فروق عملة محققة" },
        { accountId: "2190", debit: "58679.999997", credit: "0" },
      ],
    });
    expect(await residue()).toEqual({ total: "0.000003", rows: [{ kind: "account", ref: "1310-USD", currency: "USD", base: "0.000003" }] });
    expect((await world.invariants()).fxResidue).toBe("0.000003");
    const lossBefore = world.balance("5920");

    const swept = await ok("POST", "/revaluation/residue/sweep", { date: "2026-08-31" });

    expect(swept.swept).toEqual([{ kind: "account", ref: "1310-USD", currency: "USD", base: "0.000003" }]);
    expect(swept.sweptCount).toBe(1);
    expect(world.balance("1310-USD")).toBe(0n);
    expect(world.balance("5920") - lossBefore).toBe(3n);
    expect((await residue()).total).toBe("0.000000");
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    await ok("POST", "/gl/journal-entries", {
      id: "Z-BIG", date: "2026-08-22", memo: "أثر قديم",
      lines: [
        { accountId: "1310-USD", debit: "0", credit: "540", currency: "USD", fxRate: "49.35", memo: "فروق عملة محققة" },
        { accountId: "2190", debit: "540", credit: "0" },
      ],
    });
    const left = await ok("POST", "/revaluation/residue/sweep", { date: "2026-08-31" }, 200);
    expect(left.swept).toEqual([]);
    expect(left.sweptCount).toBe(0);
    expect(left.refused).toEqual([expect.objectContaining({ kind: "account", ref: "1310-USD", base: "-540.000000" })]);
    expect(String((left.refused as { message: string }[])[0]?.message)).toMatch(/[؀-ۿ]/);
    expect((await residue()).total).toBe("540.000000");
  }, 900_000);
});
