import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, SqlDialect, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  PricingGuardBreachKind,
  PricingGuardCostBasis,
  PricingGuardDocType,
  PricingGuardMode,
  PricingGuardOverrideKind,
  PricingGuardRuleStatus,
  type PricingGuardBreach,
  type PricingGuardOverride,
  type PricingGuardOverrideFilter,
  type PricingGuardOverrideRepository,
  type PricingGuardRule,
  type PricingGuardRuleRepository,
} from "@mezan/domain";

const CREATE_RULE = `
CREATE TABLE IF NOT EXISTS pricing_guard_rule (
  id                  TEXT PRIMARY KEY,
  name_ar             TEXT NOT NULL,
  item_id             TEXT,
  category_id         TEXT,
  customer_category   TEXT,
  floor_price         INTEGER,
  min_margin_percent  TEXT,
  mode                TEXT NOT NULL,
  status              TEXT NOT NULL,
  note                TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT NOT NULL,
  updated_by          TEXT NOT NULL,
  CHECK (item_id IS NULL OR category_id IS NULL),
  CHECK (floor_price IS NOT NULL OR min_margin_percent IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pricing_guard_rule_item ON pricing_guard_rule(item_id);
`;

const CREATE_OVERRIDE = `
CREATE TABLE IF NOT EXISTS pricing_guard_override (
  id                    TEXT PRIMARY KEY,
  doc_type              TEXT NOT NULL,
  doc_id                TEXT NOT NULL,
  doc_no                TEXT,
  doc_date              TEXT NOT NULL,
  customer_id           TEXT NOT NULL,
  customer_name_ar      TEXT NOT NULL,
  branch_id             TEXT NOT NULL,
  line_id               TEXT NOT NULL,
  item_id               TEXT NOT NULL,
  base_qty              INTEGER NOT NULL,
  net_base              INTEGER NOT NULL,
  net_unit_price        INTEGER NOT NULL,
  unit_cost             INTEGER,
  cost_basis            TEXT NOT NULL,
  margin_basis_points   INTEGER,
  breaches              TEXT NOT NULL,
  kind                  TEXT NOT NULL,
  approval_request_id   TEXT,
  actor                 TEXT NOT NULL,
  recorded_at           TEXT NOT NULL,
  UNIQUE(doc_type, doc_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_pricing_guard_override_date ON pricing_guard_override(doc_date);
`;

/* INVARIANT: the override table is append-only — the report is evidence of who sold below the floor and on whose approval. */
const OVERRIDE_APPEND_ONLY = `
CREATE TRIGGER IF NOT EXISTS pricing_guard_override_no_update BEFORE UPDATE ON pricing_guard_override
BEGIN SELECT RAISE(ABORT, 'pricing_guard_override is append-only'); END;
CREATE TRIGGER IF NOT EXISTS pricing_guard_override_no_delete BEFORE DELETE ON pricing_guard_override
BEGIN SELECT RAISE(ABORT, 'pricing_guard_override is append-only'); END;
`;

const OVERRIDE_APPEND_ONLY_POSTGRES = `
CREATE OR REPLACE FUNCTION pricing_guard_override_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pricing_guard_override is append-only';
END;
$$;
CREATE OR REPLACE TRIGGER pricing_guard_override_no_update BEFORE UPDATE ON pricing_guard_override
  FOR EACH ROW EXECUTE FUNCTION pricing_guard_override_append_only();
CREATE OR REPLACE TRIGGER pricing_guard_override_no_delete BEFORE DELETE ON pricing_guard_override
  FOR EACH ROW EXECUTE FUNCTION pricing_guard_override_append_only();
`;

interface RuleRow {
  id: string;
  name_ar: string;
  item_id: string | null;
  category_id: string | null;
  customer_category: string | null;
  floor_price: number | bigint | null;
  min_margin_percent: string | null;
  mode: string;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
}

function toRule(row: RuleRow): PricingGuardRule {
  return {
    id: row.id,
    nameAr: row.name_ar,
    itemId: row.item_id,
    categoryId: row.category_id,
    customerCategory: row.customer_category,
    floorPrice: row.floor_price === null ? null : Money.fromScaled(BigInt(row.floor_price)),
    minMarginPercent: row.min_margin_percent === null ? null : Number(row.min_margin_percent),
    mode: row.mode as PricingGuardMode,
    status: row.status as PricingGuardRuleStatus,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

const UPSERT_RULE = `INSERT INTO pricing_guard_rule
    (id, name_ar, item_id, category_id, customer_category, floor_price, min_margin_percent, mode, status, note, created_at, updated_at, created_by, updated_by)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name_ar = excluded.name_ar,
    item_id = excluded.item_id,
    category_id = excluded.category_id,
    customer_category = excluded.customer_category,
    floor_price = excluded.floor_price,
    min_margin_percent = excluded.min_margin_percent,
    mode = excluded.mode,
    status = excluded.status,
    note = excluded.note,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by`;

function ruleParams(rule: PricingGuardRule): SqlValue[] {
  return [
    rule.id,
    rule.nameAr,
    rule.itemId,
    rule.categoryId,
    rule.customerCategory,
    rule.floorPrice === null ? null : rule.floorPrice.scaled,
    rule.minMarginPercent === null ? null : String(rule.minMarginPercent),
    rule.mode,
    rule.status,
    rule.note,
    rule.createdAt,
    rule.updatedAt,
    rule.createdBy,
    rule.updatedBy,
  ];
}

class SqlPricingGuardRuleRepository implements PricingGuardRuleRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<PricingGuardRule | null> {
    const row = await this.db.get<RuleRow>(`SELECT * FROM pricing_guard_rule WHERE id = ?`, [id]);
    return row ? toRule(row) : null;
  }

  async list(): Promise<readonly PricingGuardRule[]> {
    return (await this.db.all<RuleRow>(`SELECT * FROM pricing_guard_rule ORDER BY created_at ASC, id ASC`)).map(toRule);
  }

  async insert(rule: PricingGuardRule): Promise<void> {
    await insertNew(this.db, rule.id, UPSERT_RULE, ruleParams(rule));
  }

  async save(rule: PricingGuardRule): Promise<void> {
    await this.db.run(UPSERT_RULE, ruleParams(rule));
  }
}

interface BreachWire {
  ruleId: string;
  ruleNameAr: string;
  kind: string;
  mode: string;
  floorPrice: string | null;
  minMarginPercent: number | null;
}

interface OverrideRow {
  id: string;
  doc_type: string;
  doc_id: string;
  doc_no: string | null;
  doc_date: string;
  customer_id: string;
  customer_name_ar: string;
  branch_id: string;
  line_id: string;
  item_id: string;
  base_qty: bigint;
  net_base: bigint;
  net_unit_price: bigint;
  unit_cost: bigint | null;
  cost_basis: string;
  margin_basis_points: bigint | null;
  breaches: string;
  kind: string;
  approval_request_id: string | null;
  actor: string;
  recorded_at: string;
}

function toBreach(wire: BreachWire): PricingGuardBreach {
  return {
    ruleId: wire.ruleId,
    ruleNameAr: wire.ruleNameAr,
    kind: wire.kind as PricingGuardBreachKind,
    mode: wire.mode as PricingGuardMode,
    floorPrice: wire.floorPrice === null ? null : Money.fromMajor(wire.floorPrice),
    minMarginPercent: wire.minMarginPercent,
  };
}

function toOverride(row: OverrideRow): PricingGuardOverride {
  return {
    id: row.id,
    docType: row.doc_type as PricingGuardDocType,
    docId: row.doc_id,
    docNo: row.doc_no,
    docDate: row.doc_date,
    customerId: row.customer_id,
    customerNameAr: row.customer_name_ar,
    branchId: row.branch_id,
    lineId: row.line_id,
    itemId: row.item_id,
    baseQty: Qty.fromScaled(row.base_qty),
    netBase: Money.fromScaled(row.net_base),
    netUnitPrice: Money.fromScaled(row.net_unit_price),
    unitCost: row.unit_cost === null ? null : Money.fromScaled(row.unit_cost),
    costBasis: row.cost_basis as PricingGuardCostBasis,
    marginBasisPoints: row.margin_basis_points,
    breaches: (JSON.parse(row.breaches) as BreachWire[]).map(toBreach),
    kind: row.kind as PricingGuardOverrideKind,
    approvalRequestId: row.approval_request_id,
    actor: row.actor,
    recordedAt: row.recorded_at,
  };
}

const INSERT_OVERRIDE = `INSERT INTO pricing_guard_override
    (id, doc_type, doc_id, doc_no, doc_date, customer_id, customer_name_ar, branch_id, line_id, item_id, base_qty, net_base, net_unit_price,
     unit_cost, cost_basis, margin_basis_points, breaches, kind, approval_request_id, actor, recorded_at)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(doc_type, doc_id, line_id) DO NOTHING`;

class SqlPricingGuardOverrideRepository implements PricingGuardOverrideRepository {
  constructor(private readonly db: SqlDb) {}

  async recordAll(rows: readonly PricingGuardOverride[]): Promise<void> {
    await this.db.transaction(async () => {
      for (const row of rows) {
        await this.db.run(INSERT_OVERRIDE, [
          row.id,
          row.docType,
          row.docId,
          row.docNo,
          row.docDate,
          row.customerId,
          row.customerNameAr,
          row.branchId,
          row.lineId,
          row.itemId,
          row.baseQty.scaled,
          row.netBase.scaled,
          row.netUnitPrice.scaled,
          row.unitCost === null ? null : row.unitCost.scaled,
          row.costBasis,
          row.marginBasisPoints,
          JSON.stringify(
            row.breaches.map((breach) => ({
              ruleId: breach.ruleId,
              ruleNameAr: breach.ruleNameAr,
              kind: breach.kind,
              mode: breach.mode,
              floorPrice: breach.floorPrice === null ? null : breach.floorPrice.toString(),
              minMarginPercent: breach.minMarginPercent,
            })),
          ),
          row.kind,
          row.approvalRequestId,
          row.actor,
          row.recordedAt,
        ]);
      }
    });
  }

  async list(filter: PricingGuardOverrideFilter): Promise<readonly PricingGuardOverride[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filter.fromDate) {
      where.push("doc_date >= ?");
      params.push(filter.fromDate);
    }
    if (filter.toDate) {
      where.push("doc_date <= ?");
      params.push(filter.toDate);
    }
    if (filter.customerId) {
      where.push("customer_id = ?");
      params.push(filter.customerId);
    }
    if (filter.itemId) {
      where.push("item_id = ?");
      params.push(filter.itemId);
    }
    if (filter.docType) {
      where.push("doc_type = ?");
      params.push(filter.docType);
    }
    if (filter.branchScope) {
      if (filter.branchScope.length === 0) return [];
      where.push(`branch_id IN (${placeholders(filter.branchScope.length)})`);
      params.push(...filter.branchScope);
    }
    const rows = await this.db.all<OverrideRow>(
      `SELECT * FROM pricing_guard_override ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY doc_date DESC, recorded_at DESC, id ASC`,
      params,
    );
    return rows.map(toOverride);
  }
}

export interface PricingGuardStores {
  readonly rules: PricingGuardRuleRepository;
  readonly overrides: PricingGuardOverrideRepository;
}

export interface SqlitePricingGuardStores extends PricingGuardStores {
  close(): void;
}

export async function ensurePricingGuardSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_RULE);
  await db.applySchema(CREATE_OVERRIDE);
  if (db.dialect === SqlDialect.Postgres) await db.exec(OVERRIDE_APPEND_ONLY_POSTGRES);
}

export function createPricingGuardStores(db: SqlDb): PricingGuardStores {
  return { rules: new SqlPricingGuardRuleRepository(db), overrides: new SqlPricingGuardOverrideRepository(db) };
}

export function createSqlitePricingGuardStores(path: SqliteConnectionInput = ":memory:"): SqlitePricingGuardStores {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_RULE);
  sqlite.exec(CREATE_OVERRIDE);
  sqlite.exec(OVERRIDE_APPEND_ONLY);
  return {
    ...createPricingGuardStores(sqliteDb(sqlite)),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
