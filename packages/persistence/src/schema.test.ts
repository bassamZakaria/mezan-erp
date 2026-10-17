import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { schema, journalEntry, journalLine, sequenceCounter, auditEvent, role, user } from "./schema.js";

describe("drizzle schema", () => {
  function migrate(sqlite: Database.Database): void {
    sqlite.exec(`
      CREATE TABLE uow_journal_entry (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        memo TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE uow_journal_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_id TEXT NOT NULL REFERENCES uow_journal_entry(id),
        line_no INTEGER NOT NULL,
        account_id TEXT NOT NULL,
        debit INTEGER NOT NULL,
        credit INTEGER NOT NULL
      );
      CREATE TABLE sequence_counter (
        code TEXT NOT NULL,
        period TEXT NOT NULL,
        value INTEGER NOT NULL
      );
      CREATE TABLE audit_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream TEXT NOT NULL,
        module TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        severity TEXT NOT NULL,
        details TEXT
      );
      CREATE TABLE role (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        permissions TEXT NOT NULL,
        is_system INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE user (
        id TEXT PRIMARY KEY,
        name_ar TEXT NOT NULL,
        name_en TEXT,
        email TEXT NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        pin_hash TEXT,
        role_id TEXT REFERENCES role(id),
        is_company_admin INTEGER NOT NULL,
        employee_id TEXT,
        branch_scope TEXT NOT NULL,
        warehouse_scope TEXT NOT NULL,
        status TEXT NOT NULL,
        photo_url TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        erased_at TEXT,
        access_expires_at TEXT
      );
    `);
  }

  it("exposes every table under the schema object", () => {
    expect(schema).toEqual({ journalEntry, journalLine, sequenceCounter, auditEvent, role, user });
  });

  it("journalEntry/journalLine round-trip through drizzle, honoring the FK", async () => {
    const sqlite = new Database(":memory:");
    try {
      migrate(sqlite);
      const db = drizzle(sqlite, { schema: { journalEntry, journalLine } });
      await db.insert(journalEntry).values({ id: "je-1", date: "2026-01-01", memo: "opening", status: "posted" });
      await db.insert(journalLine).values([
        { entryId: "je-1", lineNo: 1, accountId: "1000", debit: 100_000_000, credit: 0 },
        { entryId: "je-1", lineNo: 2, accountId: "2000", debit: 0, credit: 100_000_000 },
      ]);
      const lines = await db.select().from(journalLine).where(eq(journalLine.entryId, "je-1"));
      expect(lines).toHaveLength(2);
      expect(lines[0]?.debit).toBe(100_000_000);
    } finally {
      sqlite.close();
    }
  });

  it("role/user round-trip, including the boolean and JSON-text columns", async () => {
    const sqlite = new Database(":memory:");
    try {
      migrate(sqlite);
      const db = drizzle(sqlite, { schema: { role, user } });
      await db.insert(role).values({
        id: "role-1",
        code: "ACCOUNTANT",
        name: "محاسب",
        description: "role desc",
        permissions: JSON.stringify(["gl.post"]),
        isSystem: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      await db.insert(user).values({
        id: "user-1",
        nameAr: "أحمد",
        email: "ahmed@example.com",
        passwordHash: "hash",
        roleId: "role-1",
        isCompanyAdmin: false,
        branchScope: JSON.stringify("*"),
        warehouseScope: JSON.stringify("*"),
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const rows = await db.select().from(user).where(eq(user.id, "user-1"));
      expect(rows[0]?.isCompanyAdmin).toBe(false);
      expect(rows[0]?.roleId).toBe("role-1");

      const roles = await db.select().from(role);
      expect(roles[0]?.isSystem).toBe(true);
      expect(JSON.parse(roles[0]?.permissions ?? "[]")).toEqual(["gl.post"]);
    } finally {
      sqlite.close();
    }
  });

  it("sequenceCounter and auditEvent tables accept a row each", async () => {
    const sqlite = new Database(":memory:");
    try {
      migrate(sqlite);
      const db = drizzle(sqlite, { schema: { sequenceCounter, auditEvent } });
      await db.insert(sequenceCounter).values({ code: "SALES_INVOICE", period: "", value: 1 });
      await db.insert(auditEvent).values({
        stream: "gl",
        module: "sales",
        entityType: "invoice",
        entityId: "inv-1",
        action: "confirm",
        actor: "user-1",
        timestamp: "2026-01-01T00:00:00.000Z",
        severity: "info",
        details: null,
      });
      const counters = await db.select().from(sequenceCounter);
      const events = await db.select().from(auditEvent);
      expect(counters).toEqual([{ code: "SALES_INVOICE", period: "", value: 1 }]);
      expect(events[0]?.entityId).toBe("inv-1");
    } finally {
      sqlite.close();
    }
  });
});
