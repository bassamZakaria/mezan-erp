import { describe, expect } from "vitest";
import {
  createSqliteFiscalPeriodRepository,
  createSqlitePricingGuardStores,
  createSqliteStockLedgerStore,
  ensureAuditSchema,
  ensurePricingGuardSchema,
  ensureStockLedgerSchema,
  SqlDialect,
  type SqlDb,
} from "@mezan/persistence";
import { createSqliteCountModeStore, ensureCountModeSchema } from "../../persistence/src/count-mode-store.js";
import { ensureEvidencePackSchema } from "../../persistence/src/evidence-pack-store.js";
import { createSqlitePeriodCloseStore, ensurePeriodCloseSchema } from "../../persistence/src/period-close-store.js";
import { DIALECTS, runOn, useDialectDbs, type DialectDb } from "./test-support.js";

const open = useDialectDbs();

async function schemaOf(dialect: SqlDialect, sqliteFactory: (handle: DialectDb) => void, postgres: (db: SqlDb) => Promise<void>): Promise<SqlDb> {
  const handle = await open(dialect);
  if (handle.sqlite) sqliteFactory(handle);
  else await postgres(handle.db);
  return handle.db;
}

async function refused(statement: Promise<unknown>, message: string): Promise<void> {
  await expect(statement).rejects.toMatchObject({ message });
}

async function refusesRewrite(db: SqlDb, dialect: SqlDialect, table: string, where: string, set: string, message: string): Promise<void> {
  await refused(db.run(`UPDATE ${table} SET ${set} WHERE ${where}`), message);
  await refused(db.run(`DELETE FROM ${table} WHERE ${where}`), message);
  if (dialect === SqlDialect.Postgres) await refused(db.exec(`TRUNCATE ${table}`), message);
  expect(Number((await db.get<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))!.n)).toBe(1);
}

describe.each(DIALECTS)("append-only tables on $dialect", ({ dialect }) => {
  const run = runOn(dialect);

  run("refuses rewriting, deleting or truncating a stock movement", async () => {
    const db = await schemaOf(dialect, ({ sqlite }) => createSqliteStockLedgerStore(sqlite!), ensureStockLedgerSchema);
    await db.run(
      `INSERT INTO stock_movement (id, item_id, warehouse_id, direction, qty, unit_cost, source_doc_type, source_doc_id, occurred_at)
       VALUES ('m1', 'item', 'wh', 'in', 1000000, 5000000, 'GOODS_RECEIPT', 'grn-1', '2026-08-01')`,
    );
    await refusesRewrite(db, dialect, "stock_movement", "id = 'm1'", "qty = 2000000", "stock_movement is append-only");
  });

  run("lets a cost layer's remaining quantity move and its own cost be rewritten to itself, and refuses any other change to its cost or origin", async () => {
    const db = await schemaOf(dialect, ({ sqlite }) => createSqliteStockLedgerStore(sqlite!), ensureStockLedgerSchema);
    await db.run(
      `INSERT INTO cost_layer (id, item_id, warehouse_id, unit_cost, original_qty, remaining_qty, source_doc_type, source_doc_id, created_at)
       VALUES ('l1', 'item', 'wh', 5000000, 3000000, 3000000, 'GOODS_RECEIPT', 'grn-1', '2026-08-01')`,
    );

    expect((await db.run(`UPDATE cost_layer SET remaining_qty = 1000000 WHERE id = 'l1'`)).changes).toBe(1);
    expect((await db.run(`UPDATE cost_layer SET unit_cost = 5000000, remaining_qty = 0 WHERE id = 'l1'`)).changes).toBe(1);
    const message = "cost_layer unit cost / origin is immutable";
    await refused(db.run(`UPDATE cost_layer SET unit_cost = 4000000 WHERE id = 'l1'`), message);
    await refused(db.run(`UPDATE cost_layer SET original_qty = 1 WHERE id = 'l1'`), message);
    await refused(db.run(`UPDATE cost_layer SET item_id = 'other' WHERE id = 'l1'`), message);
    await refused(db.run(`UPDATE cost_layer SET warehouse_id = 'other' WHERE id = 'l1'`), message);
    expect(await db.get(`SELECT unit_cost, original_qty, remaining_qty, item_id, warehouse_id FROM cost_layer WHERE id = 'l1'`)).toMatchObject({
      item_id: "item",
      warehouse_id: "wh",
    });
    expect(Number((await db.get<{ unit_cost: bigint }>(`SELECT unit_cost FROM cost_layer WHERE id = 'l1'`))!.unit_cost)).toBe(5000000);
  });

  run("refuses rewriting, deleting or truncating an audit event and its field index", async () => {
    const db = (await open(dialect)).db;
    await ensureAuditSchema(db);
    await db.run(
      `INSERT INTO audit_event (stream, module, entity_type, entity_id, action, actor, timestamp, severity, details)
       VALUES ('sensitive', 'accounting', 'JOURNAL_ENTRY', 'je-1', 'POST', 'u1', '2026-08-01T00:00:00.000Z', 'info', '{}')`,
    );
    const event = await db.get<{ id: bigint | number }>(`SELECT id FROM audit_event WHERE entity_id = 'je-1'`);
    await db.run(`INSERT INTO audit_event_field (event_id, field) VALUES (?, 'memo')`, [Number(event!.id)]);

    await refusesRewrite(db, dialect, "audit_event", "entity_id = 'je-1'", "actor = 'someone-else'", "audit_event is append-only");
    await refusesRewrite(db, dialect, "audit_event_field", "field = 'memo'", "field = 'amount'", "audit_event_field is append-only");
  });

  run("refuses rewriting, deleting or truncating an evidence pack's register row", async () => {
    const db = (await open(dialect)).db;
    await ensureEvidencePackSchema(db);
    await db.run(
      `INSERT INTO evidence_pack (id, period_from, period_to, built_by, built_by_name, built_at, manifest_sha256, key_id, file_count, total_bytes, audit_chain_ok)
       VALUES ('ep-1', '2026-08-01', '2026-08-31', 'u1', 'Owner', '2026-09-01T00:00:00.000Z', 'abc', 'k1', 3, 1024, 1)`,
    );
    await refusesRewrite(db, dialect, "evidence_pack", "id = 'ep-1'", "manifest_sha256 = 'forged'", "evidence_pack is append-only");
  });

  run("refuses rewriting, deleting or truncating a period-close summary", async () => {
    const db = await schemaOf(dialect, ({ sqlite }) => {
      createSqliteFiscalPeriodRepository(sqlite!);
      createSqlitePeriodCloseStore(sqlite!);
    }, ensurePeriodCloseSchema);
    await db.run(
      `INSERT INTO period_close_summary (id, period_id, year, period_number, start_date, end_date, closed_by, closed_at, failed_checks_json, checks_json, trial_balance_json, totals_json, sha256)
       VALUES ('pcs-1', 'fp-2026-08', 2026, 8, '2026-08-01', '2026-08-31', 'u1', '2026-09-01T00:00:00.000Z', '[]', '[]', '[]', '{}', 'abc')`,
    );
    await refusesRewrite(db, dialect, "period_close_summary", "id = 'pcs-1'", "sha256 = 'forged'", "period_close_summary is append-only");
  });

  run("refuses rewriting, deleting or truncating a below-floor sale's override record", async () => {
    const db = await schemaOf(dialect, ({ sqlite }) => createSqlitePricingGuardStores(sqlite!), ensurePricingGuardSchema);
    await db.run(
      `INSERT INTO pricing_guard_override (id, doc_type, doc_id, doc_date, customer_id, customer_name_ar, branch_id, line_id, item_id, base_qty, net_base, net_unit_price, cost_basis, breaches, kind, actor, recorded_at)
       VALUES ('pgo-1', 'SALES_INVOICE', 'inv-1', '2026-08-01', 'c1', 'عميل', 'b1', 'l1', 'item', 1000000, 9000000, 9000000, 'wac', '[]', 'approved', 'u1', '2026-08-01T00:00:00.000Z')`,
    );
    await refusesRewrite(db, dialect, "pricing_guard_override", "id = 'pgo-1'", "actor = 'someone-else'", "pricing_guard_override is append-only");
  });

  run("lets a count scan be voided once, and refuses any other change, a second void, a delete or a truncate", async () => {
    const db = await schemaOf(dialect, ({ sqlite }) => createSqliteCountModeStore(sqlite!), ensureCountModeSchema);
    for (const id of ["s1", "s2"]) {
      await db.run(
        `INSERT INTO physical_count_scan (id, count_id, zone_id, item_id, barcode, outcome, source, qty, user_id, scanned_at, seq)
         VALUES (?, 'cnt-1', NULL, 'item', NULL, 'matched', 'scanner', '1', 'u1', '2026-08-01T00:00:00.000Z', ?)`,
        [id, id === "s1" ? 1 : 2],
      );
    }
    const voidOnly = "physical_count_scan is append-only: a scan can only be voided";

    await refused(db.run(`UPDATE physical_count_scan SET qty = '5' WHERE id = 's2'`), voidOnly);
    expect((await db.run(`UPDATE physical_count_scan SET voided_at = '2026-08-02', voided_by = 'u2', void_reason = 'duplicate' WHERE id = 's1'`)).changes).toBe(1);
    await refused(db.run(`UPDATE physical_count_scan SET voided_at = '2026-08-03' WHERE id = 's1'`), voidOnly);
    await refused(db.run(`DELETE FROM physical_count_scan WHERE id = 's2'`), "physical_count_scan is append-only");
    if (dialect === SqlDialect.Postgres) await refused(db.exec(`TRUNCATE physical_count_scan`), "physical_count_scan is append-only");
    expect(Number((await db.get<{ n: bigint }>(`SELECT COUNT(*) AS n FROM physical_count_scan`))!.n)).toBe(2);
  });
});
