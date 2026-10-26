import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DuplicateRecordIdError,
  Money,
  postJournalEntry,
  type Account,
  type JournalEntry,
  type JournalLine,
  type JournalPostingDeps,
} from "@mezan/domain";
import {
  createLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLedgerStore,
  ensureLedgerSchema,
  sqliteDb,
  SqlDialect,
  type LedgerStoreHandle,
  type SqlDb,
} from "@mezan/persistence";
import {
  assertCollation,
  ConnectionOptionsInUrlError,
  createTenantPool,
  postgresDb,
  provisionTenantSchema,
  TenantSchemaMismatchError,
  TransactionAbortedError,
} from "./postgres-db.js";

const PG_URL = process.env.MEZAN_TEST_PG_URL;
if (process.env.CI && !PG_URL) throw new Error("MEZAN_TEST_PG_URL must be set in CI: the Postgres half of the ledger suite may not skip there.");

interface Tenant {
  readonly schema: string;
  readonly pool: pg.Pool;
  readonly db: SqlDb;
  readonly ledger: LedgerStoreHandle;
}

let admin: pg.Pool | undefined;
const tenants: Tenant[] = [];
const closers: Array<{ close(): void }> = [];

beforeAll(async () => {
  if (!PG_URL) return;
  admin = new pg.Pool({ connectionString: PG_URL, max: 2 });
  await assertCollation(admin);
});

afterEach(() => {
  for (const handle of closers.splice(0)) handle.close();
});

afterAll(async () => {
  for (const tenant of tenants) await tenant.pool.end();
  if (admin) {
    for (const tenant of tenants) {
      await admin.query(`DROP OWNED BY ${tenant.schema} CASCADE`);
      await admin.query(`DROP ROLE ${tenant.schema}`);
    }
    await admin.end();
  }
});

async function postgresTenant(max = 8): Promise<Tenant> {
  const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const password = randomBytes(18).toString("base64url");
  await provisionTenantSchema(admin!, schema, password);
  const pool = createTenantPool({ connectionString: PG_URL!, schema, password, max });
  const db = postgresDb(pool, schema);
  await ensureLedgerSchema(db);
  const tenant = { schema, pool, db, ledger: createLedgerStore(db) };
  tenants.push(tenant);
  return tenant;
}

function sqliteStore(): { ledger: LedgerStoreHandle; db: SqlDb } {
  const sqlite = new Database(":memory:");
  closers.push({ close: () => sqlite.close() });
  return { ledger: createSqliteLedgerStore(sqlite), db: sqliteDb(sqlite) };
}

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

async function deps(ledger: LedgerStoreHandle): Promise<JournalPostingDeps> {
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(accounts, periods);
  await accounts.create(account("1300"));
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("2200", { type: "liability", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  return { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z", actor: "u1" };
}

function sale(id: string, gross: string, net: string, tax: string) {
  return {
    id,
    date: "2026-08-22",
    memo: `Cash sale ${id}`,
    lines: [
      { accountId: "1300", debit: Money.fromMajor(gross), credit: Money.zero() },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor(net) },
      { accountId: "2200", debit: Money.zero(), credit: Money.fromMajor(tax) },
    ],
  };
}

function pair(amount: string, extra: Partial<JournalLine> = {}): JournalLine[] {
  return [
    { accountId: "1300", debit: Money.fromMajor(amount), credit: Money.zero(), ...extra },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor(amount), ...extra },
  ];
}

function entry(id: string, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return { id, date: "2026-08-22", memo: id, status: "posted", lines: pair("10.00"), ...overrides };
}

const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => `JE-${String(i + 1).padStart(6, "0")}`);

const dialects: Array<{ dialect: SqlDialect; open: () => Promise<{ ledger: LedgerStoreHandle; db: SqlDb }> }> = [
  { dialect: SqlDialect.Sqlite, open: async () => sqliteStore() },
  { dialect: SqlDialect.Postgres, open: async () => postgresTenant() },
];

describe.each(dialects)("ledger store on $dialect", ({ dialect, open }) => {
  const run = dialect === SqlDialect.Postgres && !PG_URL ? it.skip : it;

  run("posts a balanced entry with a number, and every balance is exact to the minor unit", async () => {
    const { ledger } = await open();
    const posted = await postJournalEntry(sale("je-1", "1150.75", "1009.43", "141.32"), await deps(ledger));

    expect(posted.entryNo).toBe("JE-000001");
    expect(await ledger.findById("je-1")).toEqual(posted);
    expect(await ledger.findByEntryNo!("JE-000001")).toEqual(posted);
    expect((await ledger.accountBalance("1300")).balance.equals(Money.fromMajor("1150.75"))).toBe(true);
    const totals = await ledger.sumLines!();
    expect(totals.debit.equals(totals.credit)).toBe(true);
    expect(totals.debit.equals(Money.fromMajor("1150.75"))).toBe(true);
    expect(await ledger.count!()).toBe(1);
  });

  run("keeps an amount past 2^53 scaled units exact", async () => {
    const { ledger } = await open();
    await postJournalEntry(sale("je-big", "98765432109.123456", "86636343955.371456", "12129088153.752000"), await deps(ledger));

    expect((await ledger.accountBalance("1300")).balance.equals(Money.fromMajor("98765432109.123456"))).toBe(true);
    expect((await ledger.accountBalances!()).get("4000")?.equals(Money.fromMajor("-86636343955.371456"))).toBe(true);
  });

  run("numbers twenty concurrent posts 1 to 20 with no gap and no repeat", async () => {
    const { ledger } = await open();
    const d = await deps(ledger);
    const posted = await Promise.all(Array.from({ length: 20 }, (_, i) => postJournalEntry(sale(`je-c${i}`, "114.00", "100.00", "14.00"), d)));

    expect(posted.map((e) => e.entryNo).sort()).toEqual(numbered(20));
    const list = await ledger.list!();
    expect(list).toHaveLength(20);
    expect(list.every((e) => e.lines.length === 3)).toBe(true);
    expect((await ledger.sumLines!()).debit.equals(Money.fromMajor("2280.00"))).toBe(true);
  });

  run("rolls back the entry and its number when the transaction fails", async () => {
    const { ledger } = await open();
    const d = await deps(ledger);
    await expect(
      ledger.transaction!(async () => {
        await ledger.numbering.next("JOURNAL_ENTRY");
        await ledger.save(entry("je-gone"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await ledger.findById("je-gone")).toBeNull();
    const afterRollback = await postJournalEntry(sale("je-after", "114.00", "100.00", "14.00"), d);
    expect(afterRollback.entryNo).toBe("JE-000001");
  });

  run("rolls back only the inner savepoint when a nested transaction fails", async () => {
    const { ledger } = await open();
    await ledger.transaction!(async () => {
      await ledger.save(entry("je-outer"));
      await expect(
        ledger.transaction!(async () => {
          await ledger.save(entry("je-inner"));
          throw new Error("inner");
        }),
      ).rejects.toThrow("inner");
    });

    expect(await ledger.findById("je-outer")).not.toBeNull();
    expect(await ledger.findById("je-inner")).toBeNull();
  });

  run("keeps a sibling's work when concurrent nested transactions run inside one transaction and one fails", async () => {
    const { ledger } = await open();
    await ledger.transaction!(async () => {
      const results = await Promise.allSettled([
        ledger.transaction!(async () => {
          await ledger.save(entry("je-fails"));
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error("first");
        }),
        ledger.transaction!(async () => {
          await ledger.save(entry("je-kept"));
          await ledger.transaction!(async () => ledger.save(entry("je-kept-deeper")));
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled"]);
    });

    expect(await ledger.findById("je-fails")).toBeNull();
    expect(await ledger.findById("je-kept")).not.toBeNull();
    expect(await ledger.findById("je-kept-deeper")).not.toBeNull();
  });

  run("refuses a taken id, and a refusal caught inside a transaction leaves the rest of it committed", async () => {
    const { ledger } = await open();
    const d = await deps(ledger);
    await postJournalEntry(sale("je-dup", "114.00", "100.00", "14.00"), d);
    await expect(postJournalEntry(sale("je-dup", "114.00", "100.00", "14.00"), d)).rejects.toBeInstanceOf(DuplicateRecordIdError);

    await ledger.transaction!(async () => {
      await ledger.save(entry("je-keep"));
      await expect(ledger.save(entry("je-keep"))).rejects.toBeInstanceOf(DuplicateRecordIdError);
    });
    expect(await ledger.findById("je-keep")).not.toBeNull();
  });

  run("filters, pages and searches the journal the same way", async () => {
    const { ledger } = await open();
    const d = await deps(ledger);
    for (const i of [1, 2, 3]) await postJournalEntry(sale(`je-f${i}`, "114.00", "100.00", "14.00"), d);

    expect((await ledger.list!({ limit: 2, offset: 1 })).map((e) => e.id)).toEqual(["je-f2", "je-f3"]);
    expect(await ledger.count!({ search: "SALE JE-F2" })).toBe(1);
    expect(await ledger.count!({ sourceDocTypes: [] })).toBe(0);
    expect((await ledger.listLines!({ accountIds: ["2200"] })).map((l) => l.credit.toString())).toEqual(["14.000000", "14.000000", "14.000000"]);
  });

  run("matches %, _ and \\ in a search literally", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-pct", { memo: "discount 100% on a\\b_c" }));
    await ledger.save(entry("je-plain", { memo: "discount 1000 on aXbYc" }));

    expect(await ledger.count!({ search: "100%" })).toBe(1);
    expect(await ledger.count!({ search: "a\\b" })).toBe(1);
    expect(await ledger.count!({ search: "b_c" })).toBe(1);
    expect(await ledger.count!({ search: "discount" })).toBe(2);
  });

  run("orders mixed-case and punctuated ids the way SQLite's byte order does", async () => {
    const { ledger } = await open();
    for (const id of ["je_b", "JE-a", "PI-JE:1", "HIST-PI-JE:2"]) await ledger.save(entry(id));

    expect((await ledger.list!()).map((e) => e.id)).toEqual(["HIST-PI-JE:2", "JE-a", "PI-JE:1", "je_b"]);
  });

  run("rewrites and deletes a draft, and leaves a posted entry untouched", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-draft", { status: "draft", memo: "before" }));
    await ledger.save(entry("je-posted", { memo: "posted" }));

    await ledger.replaceDraft!(entry("je-draft", { status: "draft", memo: "after", lines: pair("25.00") }));
    await ledger.replaceDraft!(entry("je-posted", { memo: "rewritten", lines: pair("99.00") }));
    const draft = await ledger.findById("je-draft");
    expect(draft?.memo).toBe("after");
    expect(draft?.lines.map((l) => l.debit.toString())).toEqual(["25.000000", "0.000000"]);
    const posted = await ledger.findById("je-posted");
    expect(posted?.memo).toBe("posted");
    expect(posted?.lines.map((l) => l.debit.toString())).toEqual(["10.000000", "0.000000"]);

    await ledger.deleteDraft!("je-draft");
    await ledger.deleteDraft!("je-posted");
    expect(await ledger.findById("je-draft")).toBeNull();
    expect(await ledger.findById("je-posted")).not.toBeNull();
  });

  run("records a status and number transition through update", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-orig"));
    const original = (await ledger.findById("je-orig"))!;
    await ledger.update({ ...original, status: "reversed", entryNo: "JE-000009" });

    const reread = await ledger.findById("je-orig");
    expect(reread?.status).toBe("reversed");
    expect(reread?.entryNo).toBe("JE-000009");
  });

  run("names the tax rate only on unnamed lines of a non-draft entry", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-tax", { lines: pair("10.00", { taxRatePercent: 14 }) }));
    await ledger.save(entry("je-tax-draft", { status: "draft", lines: pair("10.00", { taxRatePercent: 14 }) }));
    await ledger.save(entry("je-tag"));

    expect(await ledger.retagUnnamedTaxRate!("je-tax", 14, "vat14")).toBe(2);
    expect(await ledger.retagUnnamedTaxRate!("je-tax", 14, "vat14")).toBe(0);
    expect(await ledger.retagUnnamedTaxRate!("je-tax-draft", 14, "vat14")).toBe(0);
    expect((await ledger.findById("je-tax"))?.lines.map((l) => l.taxRateId)).toEqual(["vat14", "vat14"]);

    expect(await ledger.tagJournalLines!("je-tag", [], 14, "vat14")).toBe(0);
    expect(await ledger.tagJournalLines!("je-tag", [1], 14, "vat14")).toBe(1);
    expect((await ledger.findById("je-tag"))?.lines.map((l) => [l.taxRatePercent, l.taxRateId])).toEqual([
      [null, null],
      [14, "vat14"],
    ]);
  });

  run("returns entry dates for known ids only, across the parameter-chunk boundary", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-d1", { date: "2026-08-01" }));
    await ledger.save(entry("je-d2", { date: "2026-08-02" }));
    const ids = ["je-d1", "je-d2", "je-d1", "missing", ...Array.from({ length: 950 }, (_, i) => `none-${i}`)];

    const dates = await ledger.entryDates!(ids);
    expect([...dates.entries()].sort()).toEqual([
      ["je-d1", "2026-08-01"],
      ["je-d2", "2026-08-02"],
    ]);
  });

  run("keeps entries with no source document when other types are excluded, and honours statuses", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-a", { sourceDocType: "A", lines: pair("1.00") }));
    await ledger.save(entry("je-b", { sourceDocType: "B", lines: pair("2.00") }));
    await ledger.save(entry("je-none", { lines: pair("4.00") }));
    await ledger.save(entry("je-draft", { status: "draft", lines: pair("8.00") }));

    expect((await ledger.sumLines!({ excludeSourceDocTypes: ["A"] })).debit.equals(Money.fromMajor("6.00"))).toBe(true);
    expect((await ledger.sumLines!({ statuses: ["draft"] })).debit.equals(Money.fromMajor("8.00"))).toBe(true);
    expect((await ledger.sumLines!({ statuses: [] })).debit.equals(Money.zero())).toBe(true);
  });

  run("reads the account ledger and treasury balances as of a date", async () => {
    const { ledger } = await open();
    await ledger.save(entry("je-t1", { date: "2026-08-01", memo: "first", lines: pair("10.00", { treasuryAccountId: "box" }) }));
    await ledger.save(entry("je-t2", { date: "2026-08-15", memo: "second", lines: pair("20.00") }));

    expect((await ledger.accountLedger!("1300", "2026-08-10")).map((l) => [l.entryId, l.memo, l.debit.toString()])).toEqual([["je-t1", "first", "10.000000"]]);
    expect((await ledger.treasuryAccountBalance!({ accountId: "1300", treasuryAccountId: "box", withUnattributed: false })).equals(Money.fromMajor("10.00"))).toBe(true);
    expect((await ledger.treasuryAccountBalance!({ accountId: "1300", treasuryAccountId: "box", withUnattributed: true })).equals(Money.fromMajor("30.00"))).toBe(true);
    expect(
      (await ledger.treasuryAccountBalance!({ accountId: "1300", treasuryAccountId: "box", withUnattributed: true, asOfDate: "2026-08-10" })).equals(Money.fromMajor("10.00")),
    ).toBe(true);
  });

  run("creates its tables idempotently, even when several callers race", async () => {
    const { db, ledger } = await open();
    await Promise.all([ensureLedgerSchema(db), ensureLedgerSchema(db), ensureLedgerSchema(db), ensureLedgerSchema(db)]);
    await ledger.save(entry("je-after-ddl"));
    expect(await ledger.count!()).toBe(1);
  });

  run("round-trips every line dimension", async () => {
    const { ledger } = await open();
    const line: Partial<JournalLine> = { memo: "m", costCenterId: "cc", currency: "USD", fxRate: "50.5", taxRatePercent: 14, taxRateId: "vat14", projectId: "p", costCategory: "materials", branchId: "b", partyId: "c", treasuryAccountId: "box" };
    await ledger.save(entry("je-full", { lines: pair("10.00", line) }));
    expect((await ledger.findById("je-full"))?.lines[0]).toMatchObject(line);
  });
});

describe("ledger store on an older SQLite file", () => {
  it("adds every later journal_line column and index", () => {
    const dir = mkdtempSync(join(tmpdir(), "mezan-ledger-upgrade-"));
    try {
      const path = join(dir, "books.db");
      const old = new Database(path);
      old.exec(`
        CREATE TABLE journal_entry (id TEXT PRIMARY KEY, entry_no TEXT UNIQUE, date TEXT NOT NULL, memo TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL, posted_at TEXT, reverses_entry_id TEXT, reversed_by_entry_id TEXT, source_doc_type TEXT, source_doc_id TEXT, source_doc_number TEXT);
        CREATE TABLE journal_line (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, line_no INTEGER NOT NULL, account_id TEXT NOT NULL, debit INTEGER NOT NULL, credit INTEGER NOT NULL, memo TEXT, cost_center_id TEXT, currency TEXT, fx_rate TEXT);
      `);
      old.close();

      createSqliteLedgerStore(path).close();
      const check = new Database(path);
      const columns = (check.prepare("PRAGMA table_info(journal_line)").all() as { name: string }[]).map((c) => c.name);
      const indexes = (check.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'journal_line'").all() as { name: string }[]).map((i) => i.name);
      check.close();

      expect(columns).toEqual(expect.arrayContaining(["tax_rate_percent", "tax_rate_id", "project_id", "cost_category", "branch_id", "party_id", "treasury_account_id"]));
      expect(indexes).toEqual(expect.arrayContaining(["idx_journal_line_tax_rate", "idx_journal_line_treasury_account", "idx_journal_line_project", "idx_journal_line_branch"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!PG_URL)("postgres tenants", () => {
  it("keeps two tenants' books, ids and numbering apart while their requests interleave", async () => {
    const a = await postgresTenant();
    const b = await postgresTenant();
    const da = await deps(a.ledger);
    const db = await deps(b.ledger);

    const posted = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => postJournalEntry(sale(`je-${i}`, "114.00", "100.00", "14.00"), da)),
      ...Array.from({ length: 3 }, (_, i) => postJournalEntry(sale(`je-${i}`, "228.00", "200.00", "28.00"), db)),
    ]);

    expect(posted.slice(0, 5).map((e) => e.entryNo).sort()).toEqual(numbered(5));
    expect(posted.slice(5).map((e) => e.entryNo).sort()).toEqual(numbered(3));
    expect((await a.ledger.accountBalance("1300")).balance.equals(Money.fromMajor("570.00"))).toBe(true);
    expect((await b.ledger.accountBalance("1300")).balance.equals(Money.fromMajor("684.00"))).toBe(true);
  });

  it("refuses one tenant's connection a query that names another tenant's schema", async () => {
    const a = await postgresTenant();
    const b = await postgresTenant();
    await b.ledger.save(entry("je-secret"));

    await expect(a.pool.query(`SELECT * FROM ${b.schema}.journal_entry`)).rejects.toThrow(/permission denied/);
    await expect(a.pool.query(`INSERT INTO ${b.schema}.journal_entry (id, date, memo, status, source, created_at) VALUES ('x', 'd', 'm', 's', 's', 'c')`)).rejects.toThrow(/permission denied/);
    await expect(a.pool.query("CREATE TABLE public.planted (id int)")).rejects.toThrow(/permission denied/);
  });

  it("refuses a connection string that would override the schema pin", () => {
    expect(() => createTenantPool({ connectionString: `${PG_URL}?options=-c%20search_path%3Dpublic`, schema: "t_abc", password: "x" })).toThrow(ConnectionOptionsInUrlError);
  });

  it("refuses to bind one pool to a second schema", async () => {
    const a = await postgresTenant();
    expect(() => postgresDb(a.pool, "t_someoneelse")).toThrow(TenantSchemaMismatchError);
  });

  it("shares one transaction between two stores built on the same pool", async () => {
    const a = await postgresTenant(2);
    const other = createLedgerStore(postgresDb(a.pool, a.schema));
    await a.ledger.transaction!(async () => {
      await a.ledger.save(entry("je-one"));
      await other.transaction!(async () => other.save(entry("je-two")));
    });
    expect(await a.ledger.count!()).toBe(2);
  });

  it("reports a transaction that a caught statement failure aborted, and keeps none of it", async () => {
    const { db, ledger } = await postgresTenant();
    await expect(
      db.transaction(async () => {
        await ledger.save(entry("je-lost"));
        await db.run("INSERT INTO no_such_table VALUES (1)").catch(() => undefined);
      }),
    ).rejects.toBeInstanceOf(TransactionAbortedError);
    expect(await ledger.findById("je-lost")).toBeNull();
  });

  it("serves a query started after the transaction ended from the pool, never the released connection", async () => {
    const { ledger, pool } = await postgresTenant(1);
    let fire!: () => void;
    const gate = new Promise<void>((resolve) => {
      fire = resolve;
    });
    let late: Promise<number> | undefined;
    await ledger.transaction!(async () => {
      late = gate.then(() => ledger.count!());
    });

    const borrower = await pool.connect();
    await borrower.query("BEGIN");
    await borrower.query("INSERT INTO journal_entry (id, date, memo, status, source, created_at) VALUES ('uncommitted', 'd', 'm', 'posted', 'manual', 'c')");
    fire();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await borrower.query("ROLLBACK");
    borrower.release();

    await expect(late).resolves.toBe(0);
  });
});
