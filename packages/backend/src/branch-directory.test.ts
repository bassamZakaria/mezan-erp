import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BranchAccess, BranchRecordKind } from "@mezan/api";
import { createEntitlements, MODULE_CATALOG } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createSqliteBranchDirectory } from "./branch-directory.js";
import { createBackend, type BackendHandle } from "./create-backend.js";

const BOOT_TIMEOUT_MS = 240_000;

describe("the branch directory fails loudly instead of answering «absent»", () => {
  let handle: BackendHandle;
  let sqlite: ReturnType<typeof openSqliteConnection>["sqlite"];

  beforeAll(async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-branch-directory-")), "books.db");
    handle = await createBackend({
      dbPath,
      seedDemoData: true,
      resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
    });
    sqlite = openSqliteConnection(dbPath).sqlite;
  }, BOOT_TIMEOUT_MS);

  afterAll(() => {
    sqlite?.close();
    handle?.close();
  });

  function copyOfTheBooks() {
    const copyPath = join(mkdtempSync(join(tmpdir(), "mezan-branch-directory-copy-")), "books.db");
    sqlite.prepare("VACUUM INTO ?").run(copyPath);
    return openSqliteConnection(copyPath).sqlite;
  }

  it("refuses to be built over a database missing a table it reads", () => {
    const drifted = copyOfTheBooks();
    expect(() => createSqliteBranchDirectory(drifted)).not.toThrow();
    drifted.exec("DROP TABLE crm_activity");
    expect(() => createSqliteBranchDirectory(drifted)).toThrow(/no such table: crm_activity/);
    drifted.close();
  });

  it("refuses to be built when one column it reads is gone", () => {
    const drifted = copyOfTheBooks();
    drifted.exec("ALTER TABLE stock_transfer_document DROP COLUMN workflow_request_id");
    expect(() => createSqliteBranchDirectory(drifted)).toThrow(/workflow_request_id/);
    drifted.close();
  });

  it("is built over the real schema, and answers for every record kind without an SQL error", async () => {
    const directory = createSqliteBranchDirectory(sqlite);
    for (const kind of Object.values(BranchRecordKind)) {
      for (const access of Object.values(BranchAccess)) {
        await expect(Promise.resolve(directory.branchesOf(kind, "NO-SUCH-RECORD", access)), kind).resolves.toBeDefined();
      }
    }
  });

  it("resolves an approval request held on a purchase invoice to the invoice's branch", async () => {
    const invoice = sqlite.prepare("SELECT id FROM purchase_invoice WHERE branch_id = 'BR-MAIN' LIMIT 1").get() as { id: string };
    const requestId = `${invoice.id}:confirm`;
    sqlite
      .prepare("INSERT OR REPLACE INTO approval_request (id, action_type, submitted_by, steps_json, current_step, status, decisions_json, created_at, updated_at) VALUES (?, 'PURCHASE_INVOICE_CONFIRM', 'USER-ADMIN', '[]', 0, 'pending', '[]', '2026-01-01', '2026-01-01')")
      .run(requestId);
    expect(await createSqliteBranchDirectory(sqlite).branchesOf(BranchRecordKind.ApprovalRequest, requestId, BranchAccess.Write)).toEqual(["BR-MAIN"]);
  });

  it("reads a write-down run that names no warehouse by the warehouses of its lines, not as nobody's", async () => {
    sqlite
      .prepare("INSERT OR REPLACE INTO writedown_run (id, period, warehouse_id, status, lines, total_amount, created_at) VALUES ('R3-WD-ALL', '2020-01', NULL, 'draft', ?, 0, '2020-01-31')")
      .run(JSON.stringify([{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN" }, { itemId: "ITEM-DEMO-1", warehouseId: "WH-ALEX" }]));
    const directory = createSqliteBranchDirectory(sqlite);
    expect(await directory.branchesOf(BranchRecordKind.WritedownRun, "R3-WD-ALL", BranchAccess.Read)).toEqual(["BR-MAIN", "BR-ALEX"]);
    sqlite.prepare("UPDATE writedown_run SET warehouse_id = 'WH-ALEX' WHERE id = 'R3-WD-ALL'").run();
    expect(await directory.branchesOf(BranchRecordKind.WritedownRun, "R3-WD-ALL", BranchAccess.Read)).toEqual(["BR-ALEX"]);
  });
});
