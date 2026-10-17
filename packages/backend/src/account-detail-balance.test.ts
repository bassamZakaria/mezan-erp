import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money } from "@mezan/domain";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

interface TrialBalanceRow {
  readonly accountId: string;
  readonly debit: number;
  readonly credit: number;
}

describe("GET /accounts/:id serves the account's posted balance", () => {
  let kit: BackendKit;
  let moved: TrialBalanceRow;

  beforeAll(async () => {
    kit = await bootBackendKit();
    const trialBalance = await kit.call("GET", "/financial-reports/trial-balance");
    const rows = trialBalance.body.rows as TrialBalanceRow[];
    const found = rows.find((row) => row.debit !== row.credit);
    if (!found) throw new Error("the seeded trial balance has no account with a balance");
    moved = found;
  }, 240_000);
  afterAll(async () => {
    await kit.close();
  });

  it("states the debit, credit and net the trial balance and the account ledger state, as exact decimal strings", async () => {
    const detail = await kit.call("GET", `/accounts/${moved.accountId}`);
    const ledger = await kit.call("GET", `/gl/accounts/${moved.accountId}/ledger`);

    expect(detail.status).toBe(200);
    expect(detail.body.balance).toEqual(ledger.body.balance);
    expect(detail.body.balance.balance).toMatch(/^-?\d+\.\d{6}$/);
    expect(detail.body.balance.balance).not.toBe(Money.zero().toString());

    const net = Money.fromMajor(detail.body.balance.debit).add(Money.fromMajor(detail.body.balance.credit).negate());
    expect(detail.body.balance.balance).toBe(net.toString());
    const trialNet = Money.fromMajor(moved.debit.toFixed(2)).add(Money.fromMajor(moved.credit.toFixed(2)).negate());
    expect(net.toString()).toBe(trialNet.toString());
  });

  it("no longer answers with a stubbed movements list", async () => {
    const detail = await kit.call("GET", `/accounts/${moved.accountId}`);
    expect(detail.body).not.toHaveProperty("movements");
    expect(detail.body).not.toHaveProperty("movementsStubbed");
  });

  it("keeps the balance from a session that may read the chart but not the journal", async () => {
    const detail = await kit.call("GET", `/accounts/${moved.accountId}`, undefined, ["accounting.coa.view"]);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(moved.accountId);
    expect(detail.body.balance).toBeNull();
  });
});
