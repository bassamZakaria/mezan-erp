import type Database from "better-sqlite3";

/**
 * Every user, customer, supplier, item, branch and warehouse id the seeded
 * books name must be a row that exists. A fabricated id passes every route —
 * the approvals inbox showed «USER-SALES-REP-1» for a person nobody created
 * (D347), and a free-text item became «ITEM-1» (D310) — so the only place it
 * shows is a scan of what was actually written.
 */
export enum SeedEntity {
  User = "user",
  Customer = "customer",
  Supplier = "supplier",
  Item = "item",
  Branch = "branch",
  Warehouse = "warehouse",
}

const MASTER_TABLE: Record<SeedEntity, string> = {
  [SeedEntity.User]: "user",
  [SeedEntity.Customer]: "customer",
  [SeedEntity.Supplier]: "supplier",
  [SeedEntity.Item]: "item",
  [SeedEntity.Branch]: "branch",
  [SeedEntity.Warehouse]: "warehouse",
};

/** Columns whose name looks like a reference but holds something else: a contract party role, not a user. */
const NOT_A_REFERENCE: ReadonlySet<string> = new Set(["contract_variation_order.requested_by"]);

function entityOf(column: string): SeedEntity | null {
  if (/(^|_)warehouse_id$/.test(column)) return SeedEntity.Warehouse;
  if (/(^|_)branch_id$/.test(column)) return SeedEntity.Branch;
  if (/(^|_)item_id$/.test(column)) return SeedEntity.Item;
  if (/(^|_)supplier_id$/.test(column)) return SeedEntity.Supplier;
  if (/(^|_)customer_id$/.test(column)) return SeedEntity.Customer;
  if (/(^|_)user_id$/.test(column) || column === "submitted_by" || column === "actor" || /_by$/.test(column)) return SeedEntity.User;
  return null;
}

/**
 * Values that are not ids of the entity and never were: a system actor, and
 * the all-branches / all-warehouses scope marker. Anything else must resolve.
 */
const NOT_AN_ID: Partial<Record<SeedEntity, ReadonlySet<string>>> = {
  [SeedEntity.User]: new Set(["system"]),
  [SeedEntity.Branch]: new Set(["*"]),
  [SeedEntity.Warehouse]: new Set(["*"]),
};

export interface DanglingReference {
  readonly table: string;
  readonly column: string;
  readonly entity: SeedEntity;
  readonly value: string;
  readonly rows: number;
}

export function danglingSeedReferences(sqlite: Database.Database): DanglingReference[] {
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  const present = new Set(tables);
  const known = new Map<SeedEntity, Set<string>>();
  for (const entity of Object.values(SeedEntity)) {
    const table = MASTER_TABLE[entity];
    const ids = present.has(table) ? (sqlite.prepare(`SELECT id FROM "${table}"`).all() as { id: string }[]).map((r) => r.id) : [];
    known.set(entity, new Set(ids));
  }
  const found: DanglingReference[] = [];
  const check = (table: string, column: string, entity: SeedEntity, value: string, rows: number) => {
    if (value === "" || NOT_AN_ID[entity]?.has(value) || known.get(entity)!.has(value)) return;
    found.push({ table, column, entity, value, rows });
  };
  for (const table of tables) {
    if (table.startsWith("sqlite_")) continue;
    const columns = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[]).filter((c) => c.type.toUpperCase() === "TEXT");
    for (const { name: column } of columns) {
      const entity = entityOf(column);
      if (!entity || NOT_A_REFERENCE.has(`${table}.${column}`)) continue;
      const values = sqlite
        .prepare(`SELECT "${column}" AS value, COUNT(*) AS rows FROM "${table}" WHERE "${column}" IS NOT NULL GROUP BY "${column}"`)
        .all() as { value: string; rows: number }[];
      for (const { value, rows } of values) check(table, column, entity, value, rows);
    }
  }
  if (present.has("approval_request")) {
    const deciders = new Map<string, number>();
    const decisions = sqlite.prepare("SELECT decisions_json FROM approval_request").all() as { decisions_json: string }[];
    for (const { decisions_json } of decisions) {
      for (const decision of JSON.parse(decisions_json) as { actorId?: string }[]) {
        if (decision.actorId) deciders.set(decision.actorId, (deciders.get(decision.actorId) ?? 0) + 1);
      }
    }
    for (const [actorId, rows] of deciders) check("approval_request", "decisions_json.actorId", SeedEntity.User, actorId, rows);
  }
  return found;
}
