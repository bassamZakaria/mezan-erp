import type Database from "better-sqlite3";
import { withSqliteTransaction } from "./sqlite-connection.js";

export enum UpgradeStepId {
  SeededRoleDutySplit = "seeded_role_duty_split",
  ApprovalFingerprint = "approval_fingerprint",
  SeededRoleReconciliationSplit = "seeded_role_reconciliation_split",
  SeededRoleGoodsReceiving = "seeded_role_goods_receiving",
  StandardRoles = "standard_roles",
}

export interface UpgradeLedger {
  runOnce(id: UpgradeStepId, step: () => Promise<void>): Promise<boolean>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS upgrade_step (
  id          TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);
`;

export function createSqliteUpgradeLedger(sqlite: Database.Database, now: () => Date = () => new Date()): UpgradeLedger {
  sqlite.exec(SCHEMA);
  const seen = sqlite.prepare<[string], { id: string }>("SELECT id FROM upgrade_step WHERE id = ?");
  const record = sqlite.prepare("INSERT INTO upgrade_step (id, applied_at) VALUES (?, ?)");
  return {
    async runOnce(id, step) {
      if (seen.get(id)) return false;
      await withSqliteTransaction(sqlite, async () => {
        await step();
        record.run(id, now().toISOString());
      });
      return true;
    },
  };
}
