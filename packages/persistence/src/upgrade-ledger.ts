import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

export enum UpgradeStepId {
  SeededRoleDutySplit = "seeded_role_duty_split",
  ApprovalFingerprint = "approval_fingerprint",
  SeededRoleReconciliationSplit = "seeded_role_reconciliation_split",
  SeededRoleGoodsReceiving = "seeded_role_goods_receiving",
  SeededRolePriceFloor = "seeded_role_price_floor",
  StandardRoles = "standard_roles",
  StatementEmailTemplate = "statement_email_template",
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

export async function ensureUpgradeLedgerSchema(db: SqlDb): Promise<void> {
  await db.applySchema(SCHEMA);
}

export function createUpgradeLedger(db: SqlDb, now: () => Date = () => new Date()): UpgradeLedger {
  return {
    async runOnce(id, step) {
      if (await db.get(`SELECT id FROM upgrade_step WHERE id = ?`, [id])) return false;
      await db.transaction(async () => {
        await step();
        await db.run(`INSERT INTO upgrade_step (id, applied_at) VALUES (?, ?)`, [id, now().toISOString()]);
      });
      return true;
    },
  };
}

export function createSqliteUpgradeLedger(sqlite: Database.Database, now: () => Date = () => new Date()): UpgradeLedger {
  sqlite.exec(SCHEMA);
  return createUpgradeLedger(sqliteDb(sqlite), now);
}
