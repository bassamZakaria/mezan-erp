import { describe, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { CreateChequeCommand } from "./cheque-service.js";

const CTRL = { underCollectionAccountId: "1320", bouncedAccountId: "1360" };

function cmd(o: Partial<CreateChequeCommand> = {}): CreateChequeCommand {
  return {
    id: "chq-1",
    direction: "incoming",
    chequeNumber: "CHQ-5001",
    bankName: "bank",
    amount: Money.fromMajor("1000"),
    issueDate: "2026-08-01",
    dueDate: "2026-08-20",
    branchId: "b1",
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: CTRL,
    journalEntryId: "je-1",
    ...o,
  };
}

describe("PROBE", () => {
  it("A: replace can reuse a live cheque number", async () => {
    const { service, cheques } = buildTestService();
    await service.createCheque(cmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-b" });
    await service.createCheque(cmd({ id: "chq-2", chequeNumber: "CHQ-7777", journalEntryId: "je-2" }));
    const r = await service.replace({
      bouncedChequeId: "chq-1",
      newCheque: { id: "chq-1r", chequeNumber: "CHQ-7777", bankName: "x", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "b1" },
      journalEntryId: "je-r",
    });
    const all = await cheques.list({});
    console.log("A replacement number:", r.replacement.chequeNumber);
    console.log("A rows with CHQ-7777:", all.filter((c) => c.chequeNumber === "CHQ-7777").map((c) => c.id + ":" + c.status).join(", "));
  });

  it("B: createCheque replacesChequeId does not touch the original", async () => {
    const { service, cheques } = buildTestService();
    await service.createCheque(cmd());
    await service.createCheque(cmd({ id: "chq-2", chequeNumber: "CHQ-5002", journalEntryId: "je-2", replacesChequeId: "chq-1" }));
    const orig = await cheques.findById("chq-1");
    console.log("B original:", orig!.status, String(orig!.replacedByChequeId));
  });

  it("C: post-dated cheque collectible before its due date", async () => {
    const { service } = buildTestService();
    await service.createCheque(cmd({ dueDate: "2026-08-30" }));
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    const c = await service.collect({ chequeId: "chq-1", bankGlAccountId: "1310", journalEntryId: "je-c", date: "2026-08-05" });
    console.log("C collected:", c.status, "on 2026-08-05, due 2026-08-30");
  });

  it("D: bounce leaves AR credited", async () => {
    const { service, ledger } = buildTestService();
    await service.createCheque(cmd());
    await service.deposit({ chequeId: "chq-1", bankTreasuryAccountId: "ta-bank1" });
    await service.bounce({ chequeId: "chq-1", journalEntryId: "je-b" });
    console.log("D AR1100=" + (await ledger.accountBalance("1100")).balance.toString() + " 1320=" + (await ledger.accountBalance("1320")).balance.toString() + " 1360=" + (await ledger.accountBalance("1360")).balance.toString());
  });
});

