import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSqliteUpgradeLedger, UpgradeStepId } from "./upgrade-ledger.js";

describe("upgrade ledger — a one-time correction runs once per database", () => {
  it("runs a step the database has not seen and records it", async () => {
    const sqlite = new Database(":memory:");
    const ledger = createSqliteUpgradeLedger(sqlite);
    let runs = 0;
    expect(await ledger.runOnce(UpgradeStepId.SeededRoleDutySplit, async () => void (runs += 1))).toBe(true);
    expect(runs).toBe(1);
    expect(sqlite.prepare("SELECT id FROM upgrade_step").all()).toEqual([{ id: UpgradeStepId.SeededRoleDutySplit }]);
  });

  it("does not run it again — on this connection or after the file is reopened", async () => {
    const sqlite = new Database(":memory:");
    let runs = 0;
    const step = async () => void (runs += 1);
    await createSqliteUpgradeLedger(sqlite).runOnce(UpgradeStepId.SeededRoleDutySplit, step);
    expect(await createSqliteUpgradeLedger(sqlite).runOnce(UpgradeStepId.SeededRoleDutySplit, step)).toBe(false);
    expect(await createSqliteUpgradeLedger(sqlite).runOnce(UpgradeStepId.SeededRoleDutySplit, step)).toBe(false);
    expect(runs).toBe(1);
  });

  it("a step that throws leaves nothing recorded and none of its writes, so the next start tries again", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE probe (n INTEGER)");
    const ledger = createSqliteUpgradeLedger(sqlite);
    await expect(
      ledger.runOnce(UpgradeStepId.SeededRoleDutySplit, async () => {
        sqlite.prepare("INSERT INTO probe VALUES (1)").run();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM probe").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM upgrade_step").get()).toEqual({ n: 0 });
    expect(await ledger.runOnce(UpgradeStepId.SeededRoleDutySplit, async () => undefined)).toBe(true);
  });

  it("steps are independent", async () => {
    const sqlite = new Database(":memory:");
    const ledger = createSqliteUpgradeLedger(sqlite);
    await ledger.runOnce(UpgradeStepId.SeededRoleDutySplit, async () => undefined);
    expect(await ledger.runOnce(UpgradeStepId.ApprovalFingerprint, async () => undefined)).toBe(true);
  });
});
