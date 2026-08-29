import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  Qty,
  type VanTrip,
  type VanTripCashMovement,
  type VanTripCashMovementKind,
  type VanTripCrewMember,
  type VanTripCrewRole,
  type VanTripRepository,
  type VanTripSettlement,
  type VanTripStatus,
  type VanTripStockCountLine,
  type VanTripStockLine,
  type Van,
  type VanRepository,
} from "@mezan/domain";

/**
 * SQLite-backed VanTripRepository (docs/archive/catalog/07-mfg-projects-assets.md
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
}

interface SettlementJson {
  expectedCash: string;
  countedCash: string;
  cashVariance: string;
  stockCounts: StockCountLineJson[];
  settledAt: string;
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
  }));
}

function stockCountsFromJson(json: StockCountLineJson[]): VanTripStockCountLine[] {
  return json.map((l) => ({
    itemId: l.itemId,
    expectedQty: Qty.fromMajor(l.expectedQty),
    countedQty: Qty.fromMajor(l.countedQty),
    varianceQty: Qty.fromMajor(l.varianceQty),
  }));
}

function settlementToJson(settlement: VanTripSettlement): SettlementJson {
  return {
    expectedCash: settlement.expectedCash.toString(),
    countedCash: settlement.countedCash.toString(),
    cashVariance: settlement.cashVariance.toString(),
    stockCounts: stockCountsToJson(settlement.stockCounts),
    settledAt: settlement.settledAt,
  };
}

function settlementFromJson(json: SettlementJson): VanTripSettlement {
  return {
    expectedCash: Money.fromMajor(json.expectedCash),
    countedCash: Money.fromMajor(json.countedCash),
    cashVariance: Money.fromMajor(json.cashVariance),
    stockCounts: stockCountsFromJson(json.stockCounts),
    settledAt: json.settledAt,
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

class SqliteVanTripRepository implements VanTripRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO van_trip (
        id, trip_no, date, branch_id, van_id, van_warehouse_id, van_treasury_account_id,
        source_warehouse_id, source_treasury_account_id, opening_cash_float,
        crew, loaded_stock, cash_movements, status, opened_at, settled_at, settlement, notes
      )
      VALUES (
        @id, @trip_no, @date, @branch_id, @van_id, @van_warehouse_id, @van_treasury_account_id,
        @source_warehouse_id, @source_treasury_account_id, @opening_cash_float,
        @crew, @loaded_stock, @cash_movements, @status, @opened_at, @settled_at, @settlement, @notes
      )
      ON CONFLICT(id) DO UPDATE SET
        trip_no = excluded.trip_no,
        date = excluded.date,
        branch_id = excluded.branch_id,
        van_id = excluded.van_id,
        van_warehouse_id = excluded.van_warehouse_id,
        van_treasury_account_id = excluded.van_treasury_account_id,
        source_warehouse_id = excluded.source_warehouse_id,
        source_treasury_account_id = excluded.source_treasury_account_id,
        opening_cash_float = excluded.opening_cash_float,
        crew = excluded.crew,
        loaded_stock = excluded.loaded_stock,
        cash_movements = excluded.cash_movements,
        status = excluded.status,
        opened_at = excluded.opened_at,
        settled_at = excluded.settled_at,
        settlement = excluded.settlement,
        notes = excluded.notes
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM van_trip WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM van_trip`);
  }

  async findById(id: string): Promise<VanTrip | null> {
    const row = this.selectById.get(id) as VanTripRow | undefined;
    return row ? toDomain(row) : null;
  }

  async list(): Promise<VanTrip[]> {
    return (this.selectAll.all() as VanTripRow[]).map(toDomain);
  }

  async create(trip: VanTrip): Promise<void> {
    this.write(trip);
  }

  async update(trip: VanTrip): Promise<void> {
    this.write(trip);
  }

  private write(trip: VanTrip): void {
    this.upsert.run({
      id: trip.id,
      trip_no: trip.tripNo,
      date: trip.date,
      branch_id: trip.branchId,
      van_id: trip.vanId,
      van_warehouse_id: trip.vanWarehouseId,
      van_treasury_account_id: trip.vanTreasuryAccountId,
      source_warehouse_id: trip.sourceWarehouseId,
      source_treasury_account_id: trip.sourceTreasuryAccountId,
      opening_cash_float: trip.openingCashFloat.toString(),
      crew: JSON.stringify(crewToJson(trip.crew)),
      loaded_stock: JSON.stringify(stockLinesToJson(trip.loadedStock)),
      cash_movements: JSON.stringify(cashMovementsToJson(trip.cashMovements)),
      status: trip.status,
      opened_at: trip.openedAt,
      settled_at: trip.settledAt,
      settlement: trip.settlement ? JSON.stringify(settlementToJson(trip.settlement)) : null,
      notes: trip.notes,
    });
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
  active: number;
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
    active: row.active === 1,
  };
}

class SqliteVanRepository implements VanRepository {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO van (id, code, name_ar, name_en, plate_number, branch_id, warehouse_id, treasury_account_id, active)
      VALUES (@id, @code, @name_ar, @name_en, @plate_number, @branch_id, @warehouse_id, @treasury_account_id, @active)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name_ar = excluded.name_ar,
        name_en = excluded.name_en,
        plate_number = excluded.plate_number,
        branch_id = excluded.branch_id,
        warehouse_id = excluded.warehouse_id,
        treasury_account_id = excluded.treasury_account_id,
        active = excluded.active
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM van WHERE id = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM van ORDER BY code`);
  }

  async findById(id: string): Promise<Van | null> {
    const row = this.selectById.get(id) as VanRow | undefined;
    return row ? vanToDomain(row) : null;
  }

  async list(): Promise<readonly Van[]> {
    return (this.selectAll.all() as VanRow[]).map(vanToDomain);
  }

  async save(van: Van): Promise<void> {
    this.upsert.run({
      id: van.id,
      code: van.code,
      name_ar: van.nameAr,
      name_en: van.nameEn,
      plate_number: van.plateNumber,
      branch_id: van.branchId,
      warehouse_id: van.warehouseId,
      treasury_account_id: van.treasuryAccountId,
      active: van.active ? 1 : 0,
    });
  }
}

export interface SqliteVanTripRepositoryHandle extends VanTripRepository {
  /** The van registry lives in the same database file as the trips that reference it. */
  readonly vans: VanRepository;
  close(): void;
}

/** Open a SQLite-backed VanTripRepository. ":memory:" for tests, a path for real. */
export function createSqliteVanTripRepository(path: SqliteConnectionInput = ":memory:"): SqliteVanTripRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  const repo = new SqliteVanTripRepository(sqlite);
  return Object.assign(repo, {
    vans: new SqliteVanRepository(sqlite),
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteVanTripRepositoryHandle;
}
