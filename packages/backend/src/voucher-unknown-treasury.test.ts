import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const base = { branchId: "BR-MAIN", memo: "اختبار", paymentMethod: "bank", date: "2026-08-20", voucherType: "other_expense", amount: "100.00", currency: "EGP", counterpartyGlAccountId: "5910" };

describe("a voucher names the treasury account its money moves through", () => {
  it("is refused when that treasury account does not exist, even though the ledger account it states is a real foreign bank's", async () => {
    const entries = world.count("journal_entry");
    const refused = await world.request("POST", "/vouchers", { ...base, id: "VUT-1", treasuryAccountId: "TR-NO-SUCH", treasuryGlAccountId: "1310-USD" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 TREASURY_ACCOUNT_NOT_FOUND");
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);
    expect(typeof refused.body.messageEn).toBe("string");
    expect(world.count("voucher", "id = 'VUT-1'")).toBe(0);
    expect(world.count("journal_entry")).toBe(entries);
  });

  it("is refused when it states another treasury account's ledger account", async () => {
    const refused = await world.request("POST", "/vouchers", { ...base, id: "VUT-2", treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: "1310-USD" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 TREASURY_GL_ACCOUNT_MISMATCH");
    expect(typeof refused.body.messageEn).toBe("string");
  });

  it("takes the ledger account from the treasury account when the request states none, and a transfer's other side is held to the same rule", async () => {
    const created = await world.request("POST", "/vouchers", { ...base, id: "VUT-3", treasuryAccountId: "TR-DEMO-BANK" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.treasuryGlAccountId).toBe("1310");
    const transfer = await world.request("POST", "/vouchers", { ...base, id: "VUT-4", voucherType: "inter_treasury_transfer", treasuryAccountId: "TR-DEMO-BANK", counterTreasuryAccountId: "TR-NO-SUCH", counterTreasuryGlAccountId: "1310-USD", counterpartyGlAccountId: undefined });
    expect(`${transfer.status} ${String(transfer.body.error)}`).toBe("422 TREASURY_ACCOUNT_NOT_FOUND");
  });

  it("a cheque is collected into the bank it was deposited at: a request naming another bank's ledger account is refused", async () => {
    expect((await world.request("POST", "/cheques/CHQ-DEMO-1/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" })).status).toBe(200);
    const refused = await world.request("POST", "/cheques/CHQ-DEMO-1/collect", { bankGlAccountId: "1310-USD" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 TREASURY_GL_ACCOUNT_MISMATCH");
    const collected = await world.request("POST", "/cheques/CHQ-DEMO-1/collect", {});
    expect(collected.status, JSON.stringify(collected.body)).toBe(200);
    expect(world.sqlite.prepare(`SELECT jl.account_id AS a FROM journal_line jl JOIN cheque c ON c.collection_journal_entry_id = jl.entry_id WHERE c.id = 'CHQ-DEMO-1' AND jl.debit > 0`).get()).toEqual({ a: "1310" });
  });

  it("an advance paid out of a treasury account that does not exist is a refusal, not an internal error", async () => {
    const refused = await world.request("POST", "/hr/advances/ADV-DEMO-3/disburse", { treasuryAccountId: "TR-NO-SUCH", branchId: "BR-MAIN", date: "2026-08-20" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 TREASURY_ACCOUNT_NOT_FOUND");
    expect(typeof refused.body.messageEn).toBe("string");
  });
});
