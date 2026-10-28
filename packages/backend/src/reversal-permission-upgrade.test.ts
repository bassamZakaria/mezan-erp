import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ALL_SCOPE } from "@mezan/domain";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType } from "@mezan/contracts";
import { openSqliteConnection } from "@mezan/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { createBackend, type BackendHandle } from "./create-backend.js";

let dir: string | null = null;
let backend: BackendHandle | null = null;

afterEach(() => {
  backend?.close();
  backend = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const OLD_ROLES: Record<string, string[]> = {
  "ROLE-OLD-TREASURER": ["cheques.view", "cheques.bounce"],
  "ROLE-OLD-STOREKEEPER": ["inventory.adjustment.view", "inventory.adjustment.confirm"],
  "ROLE-OLD-VIEWER": ["cheques.view", "inventory.adjustment.view"],
};

async function booksWrittenBeforeReversalPermissions(): Promise<string> {
  dir = mkdtempSync(path.join(tmpdir(), "mezan-reversal-perm-"));
  const file = path.join(dir, "books.db");
  (await createBackend({ dbPath: file })).close();
  const { sqlite } = openSqliteConnection(file);
  const insert = sqlite.prepare(`INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-01-01T00:00:00.000Z')`);
  for (const [id, permissions] of Object.entries(OLD_ROLES)) insert.run(id, id, id, JSON.stringify(permissions));
  sqlite.exec(`DELETE FROM permission_grant_marker WHERE name <> 'attachment_permissions'`);
  sqlite.close();
  return file;
}

function roleHolds(file: string, id: string): string[] {
  const { sqlite } = openSqliteConnection(file);
  const row = sqlite.prepare(`SELECT permissions FROM role WHERE id = ?`).get(id) as { permissions: string };
  sqlite.close();
  return JSON.parse(row.permissions) as string[];
}

async function reverseAs(handle: BackendHandle, permissions: readonly string[], type: ReversalDocumentType) {
  const token = await handle.sessions.issue({ userId: "someone", permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const url = DOCUMENT_REVERSAL_PATHS[type].route.replace(/:\w+/g, "NO-SUCH-DOCUMENT");
  const res = await handle.app.fetch(new Request(`http://local${url}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ memo: "سبب العكس" }) }));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { permission?: string; error?: string } };
}

describe("books upgraded to dedicated reversal permissions", () => {
  it("every role that could reverse a document before can still reverse it, and a role that could not still cannot", async () => {
    const file = await booksWrittenBeforeReversalPermissions();

    backend = await createBackend({ dbPath: file });

    expect(roleHolds(file, "ROLE-OLD-TREASURER")).toEqual(["cheques.view", "cheques.bounce", "cheques.reverse"]);
    expect(roleHolds(file, "ROLE-OLD-STOREKEEPER")).toEqual(["inventory.adjustment.view", "inventory.adjustment.confirm", "inventory.adjustment.reverse", "contracting.consumption.reverse"]);
    expect(roleHolds(file, "ROLE-OLD-VIEWER")).toEqual(OLD_ROLES["ROLE-OLD-VIEWER"]);

    expect((await reverseAs(backend, roleHolds(file, "ROLE-OLD-TREASURER"), ReversalDocumentType.Cheque)).status).not.toBe(403);
    expect((await reverseAs(backend, roleHolds(file, "ROLE-OLD-STOREKEEPER"), ReversalDocumentType.Adjustment)).status).not.toBe(403);
    expect(await reverseAs(backend, roleHolds(file, "ROLE-OLD-VIEWER"), ReversalDocumentType.Cheque)).toMatchObject({ status: 403, body: { permission: "cheques.reverse" } });
    expect(await reverseAs(backend, OLD_ROLES["ROLE-OLD-TREASURER"]!, ReversalDocumentType.Cheque)).toMatchObject({ status: 403, body: { permission: "cheques.reverse" } });
  });

  it("books already upgraded before the voucher route joined the registry are given its permission once — to holders of any of the three voucher void permissions", async () => {
    const file = await booksWrittenBeforeReversalPermissions();
    const { sqlite } = openSqliteConnection(file);
    const insert = sqlite.prepare(`INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-01-01T00:00:00.000Z')`);
    insert.run("ROLE-CASHIER", "ROLE-CASHIER", "ROLE-CASHIER", JSON.stringify(["treasury.cash_voucher.view", "treasury.cash_voucher.void"]));
    insert.run("ROLE-TRANSFERS", "ROLE-TRANSFERS", "ROLE-TRANSFERS", JSON.stringify(["treasury.cash_voucher.view", "treasury.transfer.void"]));
    insert.run("ROLE-TELLER", "ROLE-TELLER", "ROLE-TELLER", JSON.stringify(["treasury.cash_voucher.view", "treasury.cash_voucher.create"]));
    sqlite.exec(`CREATE TABLE IF NOT EXISTS permission_grant_marker (name TEXT PRIMARY KEY, granted_at TEXT NOT NULL)`);
    sqlite.prepare(`INSERT INTO permission_grant_marker (name, granted_at) VALUES ('reversal_permissions', '2026-10-12T00:00:00.000Z')`).run();
    sqlite.close();

    backend = await createBackend({ dbPath: file });

    expect(roleHolds(file, "ROLE-CASHIER")).toEqual(["treasury.cash_voucher.view", "treasury.cash_voucher.void", "treasury.cash_voucher.reverse"]);
    expect(roleHolds(file, "ROLE-TRANSFERS")).toEqual(["treasury.cash_voucher.view", "treasury.transfer.void", "treasury.cash_voucher.reverse"]);
    expect(roleHolds(file, "ROLE-TELLER")).toEqual(["treasury.cash_voucher.view", "treasury.cash_voucher.create"]);
    expect(roleHolds(file, "ROLE-OLD-TREASURER")).toEqual(OLD_ROLES["ROLE-OLD-TREASURER"]);
    expect((await reverseAs(backend, roleHolds(file, "ROLE-CASHIER"), ReversalDocumentType.Voucher)).status).not.toBe(403);
    expect(await reverseAs(backend, ["treasury.cash_voucher.view", "treasury.cash_voucher.void"], ReversalDocumentType.Voucher)).toMatchObject({ status: 403, body: { permission: "treasury.cash_voucher.reverse" } });

    backend.close();
    const again = openSqliteConnection(file);
    again.sqlite.prepare(`UPDATE role SET permissions = ? WHERE id = 'ROLE-CASHIER'`).run(JSON.stringify(["treasury.cash_voucher.view", "treasury.cash_voucher.void"]));
    again.sqlite.close();
    backend = await createBackend({ dbPath: file });
    expect(roleHolds(file, "ROLE-CASHIER")).toEqual(["treasury.cash_voucher.view", "treasury.cash_voucher.void"]);
  });

  it("the grant is made once: a reversal permission an administrator takes away stays away on the next start", async () => {
    const file = await booksWrittenBeforeReversalPermissions();
    (await createBackend({ dbPath: file })).close();
    const { sqlite } = openSqliteConnection(file);
    sqlite.prepare(`UPDATE role SET permissions = ? WHERE id = 'ROLE-OLD-TREASURER'`).run(JSON.stringify(OLD_ROLES["ROLE-OLD-TREASURER"]));
    sqlite.close();

    backend = await createBackend({ dbPath: file });

    expect(roleHolds(file, "ROLE-OLD-TREASURER")).toEqual(OLD_ROLES["ROLE-OLD-TREASURER"]);
  });
});
