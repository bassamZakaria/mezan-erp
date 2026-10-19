import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, UpgradeStepId, openSqliteConnection, readSchemaVersion } from "@mezan/persistence";
import { createBackend } from "./create-backend.js";

const BEFORE_THE_BRANCH_DIMENSION = `
CREATE TABLE approval_request_old AS
  SELECT id, action_type, submitted_by, steps_json, current_step, status, decisions_json, entity_label, created_at, updated_at FROM approval_request;
DROP TABLE approval_request;
ALTER TABLE approval_request_old RENAME TO approval_request;
DROP INDEX IF EXISTS idx_journal_line_treasury_account;
ALTER TABLE journal_line DROP COLUMN treasury_account_id;
DROP TABLE IF EXISTS upgrade_step;
DELETE FROM permission_grant_marker;
`;

function columnsOf(dbPath: string, table: string): string[] {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
  } finally {
    sqlite.close();
  }
}

function rowsOf(dbPath: string, query: string): string[] {
  const { sqlite } = openSqliteConnection(dbPath);
  try {
    return (sqlite.prepare(query).all() as { v: string }[]).map((row) => row.v).sort();
  } finally {
    sqlite.close();
  }
}

describe("upgrade — books written at an earlier schema version", () => {
  it.each([1, 2])("stamped version %i: the branch-dimension columns, every one-time step and the reversal grant all arrive, and the file is stamped current", async (version) => {
    const dbPath = join(mkdtempSync(join(tmpdir(), `mezan-schema-v${version}-`)), "books.db");
    (await createBackend({ dbPath })).close();
    const { sqlite } = openSqliteConnection(dbPath);
    sqlite.exec(BEFORE_THE_BRANCH_DIMENSION);
    sqlite.pragma(`user_version = ${version}`);
    expect(readSchemaVersion(sqlite)).toBe(version);
    sqlite.close();
    expect(columnsOf(dbPath, "journal_line")).not.toContain("treasury_account_id");

    (await createBackend({ dbPath })).close();

    expect(columnsOf(dbPath, "journal_line")).toContain("treasury_account_id");
    expect(columnsOf(dbPath, "approval_request")).toEqual(expect.arrayContaining(["document_id", "document_branch_id", "document_fingerprint"]));
    expect(rowsOf(dbPath, "SELECT id AS v FROM upgrade_step")).toEqual([UpgradeStepId.ApprovalFingerprint, UpgradeStepId.SeededRoleDutySplit, UpgradeStepId.SeededRoleGoodsReceiving, UpgradeStepId.SeededRolePriceFloor, UpgradeStepId.SeededRoleReconciliationSplit].sort());
    expect(rowsOf(dbPath, "SELECT name AS v FROM permission_grant_marker")).toEqual(["reversal_permissions", "voucher_reversal_permission"]);
    const reopened = openSqliteConnection(dbPath).sqlite;
    expect(readSchemaVersion(reopened)).toBe(CURRENT_SCHEMA_VERSION);
    reopened.close();
  }, 120_000);
});
