import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { EtaVatSubType, TaxCalculationType, TaxRate, TaxRateRepository, TaxRateStatus } from "@mezan/domain";
import { refuseUnlessInserted } from "./insert-new.js";
import { TransactionMode, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS tax_rate (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  rate                  REAL NOT NULL,
  calculation_type      TEXT NOT NULL,
  is_default            INTEGER NOT NULL,
  output_tax_account_id TEXT,
  input_tax_account_id  TEXT,
  eta_sub_type          TEXT NOT NULL,
  status                TEXT NOT NULL
);
`;

interface TaxRateRow {
  id: string;
  code: string;
  name: string;
  rate: number;
  calculation_type: string;
  is_default: bigint;
  output_tax_account_id: string | null;
  input_tax_account_id: string | null;
  eta_sub_type: string;
  status: string;
}

function toTaxRate(row: TaxRateRow): TaxRate {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rate: Number(row.rate),
    calculationType: row.calculation_type as TaxCalculationType,
    isDefault: Number(row.is_default) === 1,
    outputTaxAccountId: row.output_tax_account_id,
    inputTaxAccountId: row.input_tax_account_id,
    etaSubType: row.eta_sub_type as EtaVatSubType,
    status: row.status as TaxRateStatus,
  };
}

class SqlTaxRateRepository implements TaxRateRepository {
  constructor(private readonly db: SqlDb) {}

  async findById(id: string): Promise<TaxRate | null> {
    const row = await this.db.get<TaxRateRow>(`SELECT * FROM tax_rate WHERE id = ?`, [id]);
    return row ? toTaxRate(row) : null;
  }

  async findByCode(code: string): Promise<TaxRate | null> {
    const row = await this.db.get<TaxRateRow>(`SELECT * FROM tax_rate WHERE code = ?`, [code]);
    return row ? toTaxRate(row) : null;
  }

  async list(): Promise<TaxRate[]> {
    return (await this.db.all<TaxRateRow>(`SELECT * FROM tax_rate`)).map(toTaxRate);
  }

  // INVARIANT: create never overwrites. An upsert here let `POST /tax-rates`
  // with an existing id overwrite a rate posted documents name.
  async create(taxRate: TaxRate): Promise<void> {
    const inserted = await this.db.run(
      `INSERT INTO tax_rate (id, code, name, rate, calculation_type, is_default, output_tax_account_id, input_tax_account_id, eta_sub_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [taxRate.id, ...fields(taxRate)],
    );
    refuseUnlessInserted(taxRate.id, inserted.changes);
  }

  async update(taxRate: TaxRate): Promise<void> {
    await this.db.run(
      `UPDATE tax_rate SET
         code = ?,
         name = ?,
         rate = ?,
         calculation_type = ?,
         is_default = ?,
         output_tax_account_id = ?,
         input_tax_account_id = ?,
         eta_sub_type = ?,
         status = ?
       WHERE id = ?`,
      [...fields(taxRate), taxRate.id],
    );
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction(fn, TransactionMode.Immediate);
  }
}

function fields(taxRate: TaxRate): SqlValue[] {
  return [
    taxRate.code,
    taxRate.name,
    taxRate.rate,
    taxRate.calculationType,
    taxRate.isDefault ? 1 : 0,
    taxRate.outputTaxAccountId,
    taxRate.inputTaxAccountId,
    taxRate.etaSubType,
    taxRate.status,
  ];
}

export interface SqliteTaxRateRepositoryHandle extends TaxRateRepository {
  close(): void;
}

export async function ensureTaxRateSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createTaxRateRepository(db: SqlDb): TaxRateRepository {
  return new SqlTaxRateRepository(db);
}

export function createSqliteTaxRateRepository(path: SqliteConnectionInput = ":memory:"): SqliteTaxRateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  return Object.assign(createTaxRateRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteTaxRateRepositoryHandle;
}
