import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { insertNew } from "./insert-new.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import {
  Money,
  Qty,
  type VanTrip,
  type VanTripCashMovement,
  type VanTripCashMovementKind,
  type VanTripCrewMember,
  type VanTripCrewRole,
  type VanTripRepository,
  type VanTripReconciliation,
  type VanReconciliationStepKind,
  type VanReconciliationStepState,
  type VanTripSettlement,
  type VanTripStatus,
  type VanTripStockCountLine,
  type VanTripStockLine,
  type Van,
  type VanRepository,
} from "@mezan/domain";

/**
 * VanTripRepository (docs/archive/catalog/07-mfg-projects-assets.md
 * "رحلات المندوبين"). `VanTrip` is mostly a document-owned bag of nested
 * collections (crew, loadedStock, cashMovements, settlement) with no
 * independent query need, so — following purchasing-stores.ts's convention —
 * every nested collection is a JSON TEXT column, and every Money/Qty inside
 * it is serialized as an EXACT decimal string via `.toString()`, parsed back
 * via `Money.fromMajor`/`Qty.fromMajor`. `openingCashFloat` stays a decimal
 * TEXT column too (not INTEGER-scaled) so the whole table leans on one
 * consistent JSON/text-first encoding discipline.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS van_trip (
  id                        TEXT PRIMARY KEY,
  trip_no                   TEXT,
  date                      TEXT NOT NULL,
  branch_id                 TEXT NOT NULL,
  van_id                    TEXT,
  van_warehouse_id           TEXT NOT NULL,
  van_treasury_account_id    TEXT NOT NULL,
  source_warehouse_id        TEXT NOT NULL,
  source_treasury_account_id TEXT NOT NULL,
  opening_cash_float         TEXT NOT NULL,
  crew                       TEXT NOT NULL,
  loaded_stock                TEXT NOT NULL,
  cash_movements              TEXT NOT NULL,
  status                     TEXT NOT NULL,
  opened_at                  TEXT NOT NULL,
  settled_at                 TEXT,
  settlement                 TEXT,
  notes                      TEXT
);
CREATE TABLE IF NOT EXISTS van (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name_ar               TEXT NOT NULL,
  name_en               TEXT,
  plate_number          TEXT,
  branch_id             TEXT NOT NULL,
  warehouse_id          TEXT NOT NULL,
  treasury_account_id   TEXT NOT NULL,
  active                INTEGER NOT NULL
);
`;

/** `van_id` arrived with the van registry (R3.13) — a trip opened before it keeps null. */
function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(van_trip)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!existing.has("van_id")) sqlite.exec(`ALTER TABLE van_trip ADD COLUMN van_id TEXT`);
}

interface VanTripRow {
  id: string;
  trip_no: string | null;
  date: string;
  branch_id: string;
  van_id: string | null;
  van_warehouse_id: string;
  van_treasury_account_id: string;
  source_warehouse_id: string;
  source_treasury_account_id: string;
  opening_cash_float: string;
  crew: string;
  loaded_stock: string;
  cash_movements: string;
  status: string;
  opened_at: string;
  settled_at: string | null;
  settlement: string | null;
  notes: string | null;
}

interface CrewJson {
  employeeId: string;
  role: VanTripCrewRole;
}

interface StockLineJson {
  itemId: string;
  qty: string;
}

interface CashMovementJson {
  id: string;
  kind: VanTripCashMovementKind;
  amount: string;
  occurredAt: string;
  notes: string | null;
}

interface StockCountLineJson {
  itemId: string;
  expectedQty: string;
  countedQty: string;
  varianceQty: string;
  loadedQty?: string;
  soldQty?: string;
  returnedQty?: string;
  otherQty?: string;
  unitCost?: string;
  varianceValue?: string;
}

interface CashBreakdownJson {
  openingFloat: string;
  fieldSales: string;
  fieldCollections: string;
  voucherCollections: string;
  other: string;
}

interface ReconciliationStepJson {
  kind: VanReconciliationStepKind;
  documentId: string;
  state: VanReconciliationStepState;
  value: string | null;
}

interface ReconciliationJson {
  approvedBy: string;
  startedAt: string;
  completedAt: string | null;
  steps: ReconciliationStepJson[];
}

/** Settlements written before E3-04 carry only the first five keys; the rest read as zero/null. */
interface SettlementJson {
  expectedCash: string;
  countedCash: string;
  cashVariance: string;
  stockCounts: StockCountLineJson[];
  settledAt: string;
  settledBy?: string | null;
  settlementDate?: string | null;
  cashBreakdown?: CashBreakdownJson | null;
  invoicedSales?: string;
  returnsValue?: string;
  reconciliation?: ReconciliationJson | null;
}

function crewToJson(crew: readonly VanTripCrewMember[]): CrewJson[] {
  return crew.map((c) => ({ employeeId: c.employeeId, role: c.role }));
}

function crewFromJson(json: CrewJson[]): VanTripCrewMember[] {
  return json.map((c) => ({ employeeId: c.employeeId, role: c.role }));
}

function stockLinesToJson(lines: readonly VanTripStockLine[]): StockLineJson[] {
  return lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() }));
}

function stockLinesFromJson(json: StockLineJson[]): VanTripStockLine[] {
  return json.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) }));
}

function cashMovementsToJson(movements: readonly VanTripCashMovement[]): CashMovementJson[] {
  return movements.map((m) => ({
    id: m.id,
    kind: m.kind,
    amount: m.amount.toString(),
    occurredAt: m.occurredAt,
    notes: m.notes,
  }));
}

function cashMovementsFromJson(json: CashMovementJson[]): VanTripCashMovement[] {
  return json.map((m) => ({
    id: m.id,
    kind: m.kind,
    amount: Money.fromMajor(m.amount),
    occurredAt: m.occurredAt,
    notes: m.notes,
  }));
}

function stockCountsToJson(lines: readonly VanTripStockCountLine[]): StockCountLineJson[] {
  return lines.map((l) => ({
    itemId: l.itemId,
    expectedQty: l.expectedQty.toString(),
    countedQty: l.countedQty.toString(),
    varianceQty: l.varianceQty.toString(),
    loadedQty: l.loadedQty.toString(),
    soldQty: l.soldQty.toString(),
    returnedQty: l.returnedQty.toString(),
    otherQty: l.otherQty.toString(),
    unitCost: l.unitCost.toString(),
    varianceValue: l.varianceValue.toString(),
  }));
}

const qtyOr = (value: string | undefined): Qty => (value === undefined ? Qty.zero() : Qty.fromMajor(value));
const moneyOr = (value: string | undefined): Money => (value === undefined ? Money.zero() : Money.fromMajor(value));

function stockCountsFromJson(json: StockCountLineJson[]): VanTripStockCountLine[] {
  return json.map((l) => ({
    itemId: l.itemId,
    expectedQty: Qty.fromMajor(l.expectedQty),
    countedQty: Qty.fromMajor(l.countedQty),
    varianceQty: Qty.fromMajor(l.varianceQty),
    loadedQty: l.loadedQty === undefined ? Qty.fromMajor(l.expectedQty) : Qty.fromMajor(l.loadedQty),
    soldQty: qtyOr(l.soldQty),
    returnedQty: qtyOr(l.returnedQty),
    otherQty: qtyOr(l.otherQty),
    unitCost: moneyOr(l.unitCost),
    varianceValue: moneyOr(l.varianceValue),
  }));
}

function reconciliationToJson(rec: VanTripReconciliation): ReconciliationJson {
  return {
    approvedBy: rec.approvedBy,
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    steps: rec.steps.map((s) => ({ kind: s.kind, documentId: s.documentId, state: s.state, value: s.value?.toString() ?? null })),
  };
}

function reconciliationFromJson(json: ReconciliationJson): VanTripReconciliation {
  return {
    approvedBy: json.approvedBy,
    startedAt: json.startedAt,
    completedAt: json.completedAt,
    steps: json.steps.map((s) => ({
      kind: s.kind,
      documentId: s.documentId,
      state: s.state,
      value: s.value === null ? null : Money.fromMajor(s.value),
    })),
  };
}

function settlementToJson(settlement: VanTripSettlement): SettlementJson {
  const b = settlement.cashBreakdown;
  return {
    expectedCash: settlement.expectedCash.toString(),
    countedCash: settlement.countedCash.toString(),
    cashVariance: settlement.cashVariance.toString(),
    stockCounts: stockCountsToJson(settlement.stockCounts),
    settledAt: settlement.settledAt,
    settledBy: settlement.settledBy,
    settlementDate: settlement.settlementDate,
    cashBreakdown: b
      ? {
          openingFloat: b.openingFloat.toString(),
          fieldSales: b.fieldSales.toString(),
          fieldCollections: b.fieldCollections.toString(),
          voucherCollections: b.voucherCollections.toString(),
          other: b.other.toString(),
        }
      : null,
    invoicedSales: settlement.invoicedSales.toString(),
    returnsValue: settlement.returnsValue.toString(),
    reconciliation: settlement.reconciliation ? reconciliationToJson(settlement.reconciliation) : null,
  };
}

function settlementFromJson(json: SettlementJson): VanTripSettlement {
  const b = json.cashBreakdown;
  return {
    expectedCash: Money.fromMajor(json.expectedCash),
    countedCash: Money.fromMajor(json.countedCash),
    cashVariance: Money.fromMajor(json.cashVariance),
    stockCounts: stockCountsFromJson(json.stockCounts),
    settledAt: json.settledAt,
    settledBy: json.settledBy ?? null,
    settlementDate: json.settlementDate ?? null,
    cashBreakdown: b
      ? {
          openingFloat: Money.fromMajor(b.openingFloat),
          fieldSales: Money.fromMajor(b.fieldSales),
          fieldCollections: Money.fromMajor(b.fieldCollections),
          voucherCollections: Money.fromMajor(b.voucherCollections),
          other: Money.fromMajor(b.other),
        }
      : null,
    invoicedSales: moneyOr(json.invoicedSales),
    returnsValue: moneyOr(json.returnsValue),
    reconciliation: json.reconciliation ? reconciliationFromJson(json.reconciliation) : null,
  };
}

function toDomain(row: VanTripRow): VanTrip {
  return {
    id: row.id,
    tripNo: row.trip_no,
    date: row.date,
    branchId: row.branch_id,
    vanId: row.van_id ?? null,
    vanWarehouseId: row.van_warehouse_id,
    vanTreasuryAccountId: row.van_treasury_account_id,
    sourceWarehouseId: row.source_warehouse_id,
    sourceTreasuryAccountId: row.source_treasury_account_id,
    openingCashFloat: Money.fromMajor(row.opening_cash_float),
    crew: crewFromJson(JSON.parse(row.crew) as CrewJson[]),
    loadedStock: stockLinesFromJson(JSON.parse(row.loaded_stock) as StockLineJson[]),
    cashMovements: cashMovementsFromJson(JSON.parse(row.cash_movements) as CashMovementJson[]),
    status: row.status as VanTripStatus,
    openedAt: row.opened_at,
    settledAt: row.settled_at,
    settlement: row.settlement ? settlementFromJson(JSON.parse(row.settlement) as SettlementJson) : null,
    notes: row.notes,
  };
}

const VAN_TRIP_COLUMNS = [
  "id", "trip_no", "date", "branch_id", "van_id", "van_warehouse_id", "van_treasury_account_id",
  "source_warehouse_id", "source_treasury_account_id", "opening_cash_float",
  "crew", "loaded_stock", "cash_movements", "status", "opened_at", "settled_at", "settlement", "notes",
] as const;

const VAN_TRIP_UPSERT = `
      INSERT INTO van_trip (${VAN_TRIP_COLUMNS.join(", ")})
      VALUES (${placeholders(VAN_TRIP_COLUMNS.length)})
      ON CONFLICT(id) DO UPDATE SET
        ${VAN_TRIP_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(",\n        ")}`;

function vanTripParams(trip: VanTrip): SqlValue[] {
  return [
    trip.id,
    trip.tripNo,
    trip.date,
    trip.branchId,
    trip.vanId,
    trip.vanWarehouseId,
    trip.vanTreasuryAccountId,
    trip.sourceWarehouseId,
    trip.sourceTreasuryAccountId,
    trip.openingCashFloat.toString(),
    JSON.stringify(crewToJson(trip.crew)),
    JSON.stringify(stockLinesToJson(trip.loadedStock)),
    JSON.stringify(cashMovementsToJson(trip.cashMovements)),
    trip.status,
    trip.openedAt,
    trip.settledAt,
    trip.settlement ? JSON.stringify(settlementToJson(trip.settlement)) : null,
    trip.notes,
  ];
}

class SqlVanTripRepository implements VanTripRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<VanTrip | null> {
    const row = await this.db.get<VanTripRow>(`SELECT * FROM van_trip WHERE id = ?`, [id]);
    return row ? toDomain(row) : null;
  }

  async list(): Promise<VanTrip[]> {
    return (await this.db.all<VanTripRow>(`SELECT * FROM van_trip`)).map(toDomain);
  }

  async create(trip: VanTrip): Promise<void> {
    await insertNew(this.db, trip.id, VAN_TRIP_UPSERT, vanTripParams(trip));
  }

  async update(trip: VanTrip): Promise<void> {
    await this.db.run(VAN_TRIP_UPSERT, vanTripParams(trip));
  }
}

interface VanRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  plate_number: string | null;
  branch_id: string;
  warehouse_id: string;
  treasury_account_id: string;
  active: bigint;
}

function vanToDomain(row: VanRow): Van {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    plateNumber: row.plate_number,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    treasuryAccountId: row.treasury_account_id,
    active: Number(row.active) === 1,
  };
}

const VAN_UPSERT = `
      INSERT INTO van (id, code, name_ar, name_en, plate_number, branch_id, warehouse_id, treasury_account_id, active)
      VALUES (${placeholders(9)})
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        plate_number = excluded.plate_number,
        branch_id = excluded.branch_id,
        warehouse_id = excluded.warehouse_id,
        treasury_account_id = excluded.treasury_account_id,
        active = excluded.active`;

function vanParams(van: Van): SqlValue[] {
  return [van.id, van.code, van.nameAr, van.nameEn, van.plateNumber, van.branchId, van.warehouseId, van.treasuryAccountId, van.active ? 1 : 0];
}

class SqlVanRepository implements VanRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<Van | null> {
    const row = await this.db.get<VanRow>(`SELECT * FROM van WHERE id = ?`, [id]);
    return row ? vanToDomain(row) : null;
  }

  async list(): Promise<readonly Van[]> {
    return (await this.db.all<VanRow>(`SELECT * FROM van ORDER BY code`)).map(vanToDomain);
  }

  async save(van: Van): Promise<void> {
    await this.db.run(VAN_UPSERT, vanParams(van));
  }

  async insert(van: Van): Promise<void> {
    await insertNew(this.db, van.id, VAN_UPSERT, vanParams(van));
  }
}

export interface VanTripRepositoryHandle extends VanTripRepository {
  /** The van registry lives in the same database as the trips that reference it. */
  readonly vans: VanRepository;
}

export interface SqliteVanTripRepositoryHandle extends VanTripRepositoryHandle {
  close(): void;
}

export async function ensureVanTripSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createVanTripRepository(db: SqlDb): VanTripRepositoryHandle {
  return Object.assign(new SqlVanTripRepository(db), { vans: new SqlVanRepository(db) }) as VanTripRepositoryHandle;
}

/** Open a SQLite-backed VanTripRepository. ":memory:" for tests, a path for real. */
export function createSqliteVanTripRepository(path: SqliteConnectionInput = ":memory:"): SqliteVanTripRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  return Object.assign(createVanTripRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteVanTripRepositoryHandle;
}
