import Database from "better-sqlite3";
import { openSqliteConnection, withSqliteTransaction, type SqliteConnectionInput } from "./sqlite-connection.js";
import type { EtaVatSubType, TaxCalculationType, TaxRate, TaxRateRepository, TaxRateStatus } from "@mezan/domain";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";

/** SQLite-backed TaxRateRepository (docs/archive/catalog/04 "الضرائب"). Standalone, mirroring `createSqliteAccountRepository`. */

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
  is_default: number;
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
    rate: row.rate,
    calculationType: row.calculation_type as TaxCalculationType,
    isDefault: row.is_default === 1,
    outputTaxAccountId: row.output_tax_account_id,
    inputTaxAccountId: row.input_tax_account_id,
    etaSubType: row.eta_sub_type as EtaVatSubType,
    status: row.status as TaxRateStatus,
  };
}

class SqliteTaxRateRepository implements TaxRateRepository {
  private readonly insert: Database.Statement;
  private readonly updateById: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    // INVARIANT: create is a plain INSERT. An upsert here let `POST /tax-rates`
    // with an existing id overwrite a rate posted documents name.
    this.insert = sqlite.prepare(`
      INSERT INTO tax_rate (id, code, name, rate, calculation_type, is_default, output_tax_account_id, input_tax_account_id, eta_sub_type, status)
      VALUES (@id, @code, @name, @rate, @calculation_type, @is_default, @output_tax_account_id, @input_tax_account_id, @eta_sub_type, @status)
    `);
    this.updateById = sqlite.prepare(`
      UPDATE tax_rate SET
        code = @code,
        name = @name,
        rate = @rate,
        calculation_type = @calculation_type,
        is_default = @is_default,
        output_tax_account_id = @output_tax_account_id,
        input_tax_account_id = @input_tax_account_id,
        eta_sub_type = @eta_sub_type,
        status = @status
      WHERE id = @id
    `);
    this.selectById = sqlite.prepare(`SELECT * FROM tax_rate WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM tax_rate WHERE code = ?`);
    this.selectAll = sqlite.prepare(`SELECT * FROM tax_rate`);
  }

  async findById(id: string): Promise<TaxRate | null> {
    const row = this.selectById.get(id) as TaxRateRow | undefined;
    return row ? toTaxRate(row) : null;
  }

  async findByCode(code: string): Promise<TaxRate | null> {
    const row = this.selectByCode.get(code) as TaxRateRow | undefined;
    return row ? toTaxRate(row) : null;
  }

  async list(): Promise<TaxRate[]> {
    const rows = this.selectAll.all() as TaxRateRow[];
    return rows.map(toTaxRate);
  }

  async create(taxRate: TaxRate): Promise<void> {
    insertingNew(taxRate.id, () => this.insert.run(toParams(taxRate)));
  }

  async update(taxRate: TaxRate): Promise<void> {
    this.updateById.run(toParams(taxRate));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return withSqliteTransaction(this.sqlite, fn, "BEGIN IMMEDIATE");
  }
}

function toParams(taxRate: TaxRate) {
  return {
      id: taxRate.id,
      code: taxRate.code,
      name: taxRate.name,
      rate: taxRate.rate,
      calculation_type: taxRate.calculationType,
      is_default: taxRate.isDefault ? 1 : 0,
      output_tax_account_id: taxRate.outputTaxAccountId,
      input_tax_account_id: taxRate.inputTaxAccountId,
      eta_sub_type: taxRate.etaSubType,
      status: taxRate.status,
  };
}

export interface SqliteTaxRateRepositoryHandle extends TaxRateRepository {
  close(): void;
}

/** Open a SQLite-backed TaxRateRepository. ":memory:" for tests, a path for real. */
export function createSqliteTaxRateRepository(path: SqliteConnectionInput = ":memory:"): SqliteTaxRateRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteTaxRateRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteTaxRateRepositoryHandle;
}
