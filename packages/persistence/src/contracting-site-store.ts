import {
  Money,
  Qty,
  type CustodyFilter,
  type CustodyItem,
  type CustodyRepository,
  type EquipmentLog,
  type EquipmentLogFilter,
  type EquipmentLogRepository,
  type MaterialConsumption,
  type MaterialConsumptionFilter,
  type MaterialConsumptionRepository,
  type SiteIssue,
  type SiteIssueFilter,
  type SiteIssueRepository,
  type SiteIssueStatus,
  type SiteReceipt,
  type SiteReceiptFilter,
  type SiteReceiptRepository,
} from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQLite store for المقاولات slice 4A — site issues, site receipts, material
 * consumption, the returnable-materials custody register and plant-hour logs.
 *
 * Lines are one JSON blob per document (the same shape `framework-document-
 * store.ts` uses): the header is what anything queries by, and a line's only
 * reader is the document itself. Quantities and money are stored as scaled
 * integers, never as REAL.
 */

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS site_issue (
  id                   TEXT PRIMARY KEY,
  doc_no               TEXT,
  date                 TEXT NOT NULL,
  from_warehouse_id    TEXT NOT NULL,
  to_warehouse_id      TEXT NOT NULL,
  project_id           TEXT NOT NULL,
  issued_by_user_id    TEXT NOT NULL,
  transit_warehouse_id TEXT,
  notes                TEXT,
  status               TEXT NOT NULL,
  lines_json           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  issued_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_issue_project ON site_issue(project_id);
CREATE INDEX IF NOT EXISTS idx_site_issue_status ON site_issue(status);

CREATE TABLE IF NOT EXISTS site_receipt (
  id                   TEXT PRIMARY KEY,
  doc_no               TEXT,
  issue_id             TEXT NOT NULL,
  date                 TEXT NOT NULL,
  received_by_user_id  TEXT NOT NULL,
  project_id           TEXT NOT NULL,
  notes                TEXT,
  status               TEXT NOT NULL,
  lines_json           TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  confirmed_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_receipt_issue ON site_receipt(issue_id);
CREATE INDEX IF NOT EXISTS idx_site_receipt_project ON site_receipt(project_id);

CREATE TABLE IF NOT EXISTS material_consumption (
  id                TEXT PRIMARY KEY,
  doc_no            TEXT,
  date              TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  project_id        TEXT NOT NULL,
  boq_line_id       TEXT,
  subcontract_id    TEXT,
  notes             TEXT,
  status            TEXT NOT NULL,
  lines_json        TEXT NOT NULL,
  total_cost        INTEGER NOT NULL,
  journal_entry_id  TEXT,
  created_at        TEXT NOT NULL,
  confirmed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_material_consumption_project ON material_consumption(project_id);
CREATE INDEX IF NOT EXISTS idx_material_consumption_subcontract ON material_consumption(subcontract_id);

CREATE TABLE IF NOT EXISTS site_custody (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL,
  warehouse_id         TEXT NOT NULL,
  custodian_user_id    TEXT NOT NULL,
  description_ar       TEXT NOT NULL,
  qty_out              INTEGER NOT NULL,
  qty_returned         INTEGER NOT NULL,
  issued_date          TEXT NOT NULL,
  expected_return_date TEXT,
  notes                TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_custody_project ON site_custody(project_id);

CREATE TABLE IF NOT EXISTS equipment_log (
  id                TEXT PRIMARY KEY,
  doc_no            TEXT,
  project_id        TEXT NOT NULL,
  asset_id          TEXT NOT NULL,
  date              TEXT NOT NULL,
  hours             INTEGER NOT NULL,
  hourly_rate       INTEGER NOT NULL,
  amount            INTEGER NOT NULL,
  boq_line_id       TEXT,
  notes             TEXT,
  status            TEXT NOT NULL,
  journal_entry_id  TEXT,
  created_at        TEXT NOT NULL,
  confirmed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_equipment_log_project ON equipment_log(project_id);
`;

interface IssueRow {
  id: string;
  doc_no: string | null;
  date: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  project_id: string;
  issued_by_user_id: string;
  transit_warehouse_id: string | null;
  notes: string | null;
  status: string;
  lines_json: string;
  created_at: string;
  issued_at: string | null;
}

interface ReceiptRow {
  id: string;
  doc_no: string | null;
  issue_id: string;
  date: string;
  received_by_user_id: string;
  project_id: string;
  notes: string | null;
  status: string;
  lines_json: string;
  created_at: string;
  confirmed_at: string | null;
}

interface ConsumptionRow {
  id: string;
  doc_no: string | null;
  date: string;
  warehouse_id: string;
  project_id: string;
  boq_line_id: string | null;
  subcontract_id: string | null;
  notes: string | null;
  status: string;
  lines_json: string;
  total_cost: bigint;
  journal_entry_id: string | null;
  created_at: string;
  confirmed_at: string | null;
}

interface CustodyRow {
  id: string;
  project_id: string;
  warehouse_id: string;
  custodian_user_id: string;
  description_ar: string;
  qty_out: bigint;
  qty_returned: bigint;
  issued_date: string;
  expected_return_date: string | null;
  notes: string | null;
}

interface EquipmentRow {
  id: string;
  doc_no: string | null;
  project_id: string;
  asset_id: string;
  date: string;
  hours: bigint;
  hourly_rate: bigint;
  amount: bigint;
  boq_line_id: string | null;
  notes: string | null;
  status: string;
  journal_entry_id: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function toIssue(row: IssueRow): SiteIssue {
  const lines = JSON.parse(row.lines_json) as { itemId: string; qty: string }[];
  return {
    id: row.id,
    docNo: row.doc_no,
    date: row.date,
    fromWarehouseId: row.from_warehouse_id,
    toWarehouseId: row.to_warehouse_id,
    projectId: row.project_id,
    issuedByUserId: row.issued_by_user_id,
    transitWarehouseId: row.transit_warehouse_id,
    notes: row.notes,
    status: row.status as SiteIssueStatus,
    lines: lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
    createdAt: row.created_at,
    issuedAt: row.issued_at,
  };
}

function toReceipt(row: ReceiptRow): SiteReceipt {
  const lines = JSON.parse(row.lines_json) as { itemId: string; qtyReceived: string }[];
  return {
    id: row.id,
    docNo: row.doc_no,
    issueId: row.issue_id,
    date: row.date,
    receivedByUserId: row.received_by_user_id,
    projectId: row.project_id,
    notes: row.notes,
    status: row.status as SiteReceipt["status"],
    lines: lines.map((l) => ({ itemId: l.itemId, qtyReceived: Qty.fromMajor(l.qtyReceived) })),
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function toConsumption(row: ConsumptionRow): MaterialConsumption {
  const lines = JSON.parse(row.lines_json) as { itemId: string; qty: string }[];
  return {
    id: row.id,
    docNo: row.doc_no,
    date: row.date,
    warehouseId: row.warehouse_id,
    projectId: row.project_id,
    boqLineId: row.boq_line_id,
    subcontractId: row.subcontract_id ?? null,
    notes: row.notes,
    status: row.status as MaterialConsumption["status"],
    lines: lines.map((l) => ({ itemId: l.itemId, qty: Qty.fromMajor(l.qty) })),
    totalCost: Money.fromScaled(row.total_cost),
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function toCustody(row: CustodyRow): CustodyItem {
  return {
    id: row.id,
    projectId: row.project_id,
    warehouseId: row.warehouse_id,
    custodianUserId: row.custodian_user_id,
    descriptionAr: row.description_ar,
    qtyOut: Qty.fromScaled(row.qty_out),
    qtyReturned: Qty.fromScaled(row.qty_returned),
    issuedDate: row.issued_date,
    expectedReturnDate: row.expected_return_date,
    notes: row.notes,
  };
}

function toEquipmentLog(row: EquipmentRow): EquipmentLog {
  return {
    id: row.id,
    docNo: row.doc_no,
    projectId: row.project_id,
    assetId: row.asset_id,
    date: row.date,
    hours: Qty.fromScaled(row.hours),
    hourlyRate: Money.fromScaled(row.hourly_rate),
    amount: Money.fromScaled(row.amount),
    boqLineId: row.boq_line_id,
    notes: row.notes,
    status: row.status as EquipmentLog["status"],
    journalEntryId: row.journal_entry_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

function issueParams(issue: SiteIssue): SqlValue[] {
  return [
    issue.id,
    issue.docNo,
    issue.date,
    issue.fromWarehouseId,
    issue.toWarehouseId,
    issue.projectId,
    issue.issuedByUserId,
    issue.transitWarehouseId,
    issue.notes,
    issue.status,
    JSON.stringify(issue.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() }))),
    issue.createdAt,
    issue.issuedAt,
  ];
}

const UPSERT_ISSUE = `
    INSERT INTO site_issue (id, doc_no, date, from_warehouse_id, to_warehouse_id, project_id,
      issued_by_user_id, transit_warehouse_id, notes, status, lines_json, created_at, issued_at)
    VALUES (?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      doc_no = excluded.doc_no, date = excluded.date, from_warehouse_id = excluded.from_warehouse_id,
      to_warehouse_id = excluded.to_warehouse_id, project_id = excluded.project_id,
      issued_by_user_id = excluded.issued_by_user_id, transit_warehouse_id = excluded.transit_warehouse_id,
      notes = excluded.notes, status = excluded.status, lines_json = excluded.lines_json,
      created_at = excluded.created_at, issued_at = excluded.issued_at
  `;

function receiptParams(receipt: SiteReceipt): SqlValue[] {
  return [
    receipt.id,
    receipt.docNo,
    receipt.issueId,
    receipt.date,
    receipt.receivedByUserId,
    receipt.projectId,
    receipt.notes,
    receipt.status,
    JSON.stringify(
          receipt.lines.map((l) => ({ itemId: l.itemId, qtyReceived: l.qtyReceived.toString() })),
        ),
    receipt.createdAt,
    receipt.confirmedAt,
  ];
}

const UPSERT_RECEIPT = `
    INSERT INTO site_receipt (id, doc_no, issue_id, date, received_by_user_id, project_id, notes,
      status, lines_json, created_at, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      doc_no = excluded.doc_no, issue_id = excluded.issue_id, date = excluded.date,
      received_by_user_id = excluded.received_by_user_id, project_id = excluded.project_id,
      notes = excluded.notes, status = excluded.status, lines_json = excluded.lines_json,
      created_at = excluded.created_at, confirmed_at = excluded.confirmed_at
  `;

function consumptionParams(consumption: MaterialConsumption): SqlValue[] {
  return [
    consumption.id,
    consumption.docNo,
    consumption.date,
    consumption.warehouseId,
    consumption.projectId,
    consumption.boqLineId,
    consumption.subcontractId,
    consumption.notes,
    consumption.status,
    JSON.stringify(consumption.lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() }))),
    consumption.totalCost.scaled,
    consumption.journalEntryId,
    consumption.createdAt,
    consumption.confirmedAt,
  ];
}

const UPSERT_CONSUMPTION = `
    INSERT INTO material_consumption (id, doc_no, date, warehouse_id, project_id, boq_line_id, subcontract_id, notes,
      status, lines_json, total_cost, journal_entry_id, created_at, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      doc_no = excluded.doc_no, date = excluded.date, warehouse_id = excluded.warehouse_id,
      project_id = excluded.project_id, boq_line_id = excluded.boq_line_id,
      subcontract_id = excluded.subcontract_id, notes = excluded.notes,
      status = excluded.status, lines_json = excluded.lines_json, total_cost = excluded.total_cost,
      journal_entry_id = excluded.journal_entry_id, created_at = excluded.created_at,
      confirmed_at = excluded.confirmed_at
  `;

function custodyParams(item: CustodyItem): SqlValue[] {
  return [
    item.id,
    item.projectId,
    item.warehouseId,
    item.custodianUserId,
    item.descriptionAr,
    item.qtyOut.scaled,
    item.qtyReturned.scaled,
    item.issuedDate,
    item.expectedReturnDate,
    item.notes,
  ];
}

const UPSERT_CUSTODY = `
    INSERT INTO site_custody (id, project_id, warehouse_id, custodian_user_id, description_ar,
      qty_out, qty_returned, issued_date, expected_return_date, notes)
    VALUES (?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id, warehouse_id = excluded.warehouse_id,
      custodian_user_id = excluded.custodian_user_id, description_ar = excluded.description_ar,
      qty_out = excluded.qty_out, qty_returned = excluded.qty_returned,
      issued_date = excluded.issued_date, expected_return_date = excluded.expected_return_date,
      notes = excluded.notes
  `;

function equipmentParams(log: EquipmentLog): SqlValue[] {
  return [
    log.id,
    log.docNo,
    log.projectId,
    log.assetId,
    log.date,
    log.hours.scaled,
    log.hourlyRate.scaled,
    log.amount.scaled,
    log.boqLineId,
    log.notes,
    log.status,
    log.journalEntryId,
    log.createdAt,
    log.confirmedAt,
  ];
}

const UPSERT_EQUIPMENT = `
    INSERT INTO equipment_log (id, doc_no, project_id, asset_id, date, hours, hourly_rate, amount,
      boq_line_id, notes, status, journal_entry_id, created_at, confirmed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      doc_no = excluded.doc_no, project_id = excluded.project_id, asset_id = excluded.asset_id,
      date = excluded.date, hours = excluded.hours, hourly_rate = excluded.hourly_rate,
      amount = excluded.amount, boq_line_id = excluded.boq_line_id, notes = excluded.notes,
      status = excluded.status, journal_entry_id = excluded.journal_entry_id,
      created_at = excluded.created_at, confirmed_at = excluded.confirmed_at
  `;

export interface ContractingSiteStoreHandle {
  readonly issues: SiteIssueRepository;
  readonly receipts: SiteReceiptRepository;
  readonly consumptions: MaterialConsumptionRepository;
  readonly custody: CustodyRepository;
  readonly equipmentLogs: EquipmentLogRepository;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface SqliteContractingSiteStoreHandle extends ContractingSiteStoreHandle {
  close(): void;
}

export function createSqliteContractingSiteStore(
  path: SqliteConnectionInput = ":memory:",
): SqliteContractingSiteStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  // Added after the table shipped — an existing database keeps it null.
  if (
    !(sqlite.prepare(`PRAGMA table_info(material_consumption)`).all() as { name: string }[]).some(
      (c) => c.name === "subcontract_id",
    )
  ) {
    sqlite.exec(`ALTER TABLE material_consumption ADD COLUMN subcontract_id TEXT`);
  }
  return { ...createContractingSiteStore(sqliteDb(sqlite)), close: () => { if (owned) sqlite.close(); } };
}

export async function ensureContractingSiteSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
}

export function createContractingSiteStore(db: SqlDb): ContractingSiteStoreHandle {
  function selectAll<Row>(table: string, where: string[], params: SqlValue[]): Promise<Row[]> {
    const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    return db.all<Row>(`SELECT * FROM ${table}${clause} ORDER BY date DESC, id DESC`, params);
  }

  const issues: SiteIssueRepository = {
    async findById(id) {
      const row = await db.get<IssueRow>(`SELECT * FROM site_issue WHERE id = ?`, [id]);
      return row ? toIssue(row) : null;
    },
    async findByDocNo(docNo) {
      const row = await db.get<IssueRow>(`SELECT * FROM site_issue WHERE doc_no = ?`, [docNo]);
      return row ? toIssue(row) : null;
    },
    async list(filter: SiteIssueFilter = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.projectId) { where.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.status) { where.push("status = ?"); params.push(filter.status); }
      if (filter.warehouseId) {
        where.push("(from_warehouse_id = ? OR to_warehouse_id = ?)");
        params.push(filter.warehouseId, filter.warehouseId);
      }
      return (await selectAll<IssueRow>("site_issue", where, params)).map(toIssue);
    },
    async insert(issue) {
      await insertNew(db, issue.id, UPSERT_ISSUE, issueParams(issue));
    },
    async save(issue) {
      await db.run(UPSERT_ISSUE, issueParams(issue));
    },
  };

  const receipts: SiteReceiptRepository = {
    async findById(id) {
      const row = await db.get<ReceiptRow>(`SELECT * FROM site_receipt WHERE id = ?`, [id]);
      return row ? toReceipt(row) : null;
    },
    async findByDocNo(docNo) {
      const row = await db.get<ReceiptRow>(`SELECT * FROM site_receipt WHERE doc_no = ?`, [docNo]);
      return row ? toReceipt(row) : null;
    },
    async list(filter: SiteReceiptFilter = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.projectId) { where.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.issueId) { where.push("issue_id = ?"); params.push(filter.issueId); }
      return (await selectAll<ReceiptRow>("site_receipt", where, params)).map(toReceipt);
    },
    async insert(receipt) {
      await insertNew(db, receipt.id, UPSERT_RECEIPT, receiptParams(receipt));
    },
    async save(receipt) {
      await db.run(UPSERT_RECEIPT, receiptParams(receipt));
    },
  };

  const consumptions: MaterialConsumptionRepository = {
    async findById(id) {
      const row = await db.get<ConsumptionRow>(`SELECT * FROM material_consumption WHERE id = ?`, [id]);
      return row ? toConsumption(row) : null;
    },
    async findByDocNo(docNo) {
      const row = await db.get<ConsumptionRow>(`SELECT * FROM material_consumption WHERE doc_no = ?`, [docNo]);
      return row ? toConsumption(row) : null;
    },
    async list(filter: MaterialConsumptionFilter = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.projectId) { where.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.warehouseId) { where.push("warehouse_id = ?"); params.push(filter.warehouseId); }
      if (filter.subcontractId) { where.push("subcontract_id = ?"); params.push(filter.subcontractId); }
      if (filter.status) { where.push("status = ?"); params.push(filter.status); }
      return (await selectAll<ConsumptionRow>("material_consumption", where, params)).map(toConsumption);
    },
    async insert(consumption) {
      await insertNew(db, consumption.id, UPSERT_CONSUMPTION, consumptionParams(consumption));
    },
    async save(consumption) {
      await db.run(UPSERT_CONSUMPTION, consumptionParams(consumption));
    },
  };

  const custody: CustodyRepository = {
    async findById(id) {
      const row = await db.get<CustodyRow>(`SELECT * FROM site_custody WHERE id = ?`, [id]);
      return row ? toCustody(row) : null;
    },
    async list(filter: CustodyFilter = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.projectId) { where.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.warehouseId) { where.push("warehouse_id = ?"); params.push(filter.warehouseId); }
      if (filter.outstandingOnly) where.push("qty_returned < qty_out");
      const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
      const rows = await db.all<CustodyRow>(`SELECT * FROM site_custody${clause} ORDER BY issued_date DESC, id DESC`, params);
      return rows.map(toCustody);
    },
    async insert(item) {
      await insertNew(db, item.id, UPSERT_CUSTODY, custodyParams(item));
    },
    async save(item) {
      await db.run(UPSERT_CUSTODY, custodyParams(item));
    },
  };

  const equipmentLogs: EquipmentLogRepository = {
    async findById(id) {
      const row = await db.get<EquipmentRow>(`SELECT * FROM equipment_log WHERE id = ?`, [id]);
      return row ? toEquipmentLog(row) : null;
    },
    async findByDocNo(docNo) {
      const row = await db.get<EquipmentRow>(`SELECT * FROM equipment_log WHERE doc_no = ?`, [docNo]);
      return row ? toEquipmentLog(row) : null;
    },
    async list(filter: EquipmentLogFilter = {}) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.projectId) { where.push("project_id = ?"); params.push(filter.projectId); }
      if (filter.assetId) { where.push("asset_id = ?"); params.push(filter.assetId); }
      if (filter.status) { where.push("status = ?"); params.push(filter.status); }
      return (await selectAll<EquipmentRow>("equipment_log", where, params)).map(toEquipmentLog);
    },
    async insert(log) {
      await insertNew(db, log.id, UPSERT_EQUIPMENT, equipmentParams(log));
    },
    async save(log) {
      await db.run(UPSERT_EQUIPMENT, equipmentParams(log));
    },
  };

  return {
    issues,
    receipts,
    consumptions,
    custody,
    equipmentLogs,
    transaction: (fn) => db.transaction(fn),
  };
}
