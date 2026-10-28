import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type Supplier, type SupplierRepository } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQLite-backed SupplierRepository (docs/archive/catalog/02 "الموردون") — the mirror
 * of {@link import("./customer-repository.js").createSqliteCustomerRepository}.
 * Standalone connection/table, same as the account/customer/branch stores.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS supplier (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  name_ar            TEXT NOT NULL,
  name_en            TEXT,
  phone              TEXT,
  email              TEXT,
  contact_person     TEXT,
  tax_number         TEXT,
  category           TEXT,
  notes              TEXT,
  payment_terms_days INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  opening_balance    INTEGER NOT NULL,
  active             INTEGER NOT NULL,
  address_city       TEXT,
  address_district   TEXT,
  address_street     TEXT,
  branch_id          TEXT,
  bank_account       TEXT
);
`;

/** Columns added after the table shipped — an existing database keeps them null. */
const ADDED_COLUMNS: readonly [string, string][] = [
  ["branch_id", "TEXT"],
  ["bank_account", "TEXT"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(supplier)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE supplier ADD COLUMN ${name} ${type}`);
  }
}

interface SupplierRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  tax_number: string | null;
  category: string | null;
  notes: string | null;
  payment_terms_days: bigint;
  currency: string;
  opening_balance: bigint;
  active: bigint;
  branch_id: string | null;
  address_city: string | null;
  address_district: string | null;
  address_street: string | null;
  bank_account: string | null;
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    phone: row.phone,
    email: row.email,
    contactPerson: row.contact_person,
    taxNumber: row.tax_number,
    category: row.category,
    notes: row.notes,
    paymentTermsDays: Number(row.payment_terms_days),
    currency: row.currency,
    openingBalance: Money.fromScaled(row.opening_balance),
    active: Number(row.active) === 1,
    branchId: row.branch_id ?? null,
    addressCity: row.address_city,
    addressDistrict: row.address_district,
    addressStreet: row.address_street,
    bankAccount: row.bank_account ?? null,
  };
}

const UPSERT_SUPPLIER = `INSERT INTO supplier (id, code, name_ar, name_en, phone, email, contact_person, tax_number, category, notes, payment_terms_days, currency, opening_balance, active, address_city, address_district, address_street, branch_id, bank_account)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    code = excluded.code,
    name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    phone = excluded.phone,
    email = excluded.email,
    contact_person = excluded.contact_person,
    tax_number = excluded.tax_number,
    category = excluded.category,
    notes = excluded.notes,
    payment_terms_days = excluded.payment_terms_days,
    currency = excluded.currency,
    opening_balance = excluded.opening_balance,
    active = excluded.active,
    address_city = excluded.address_city,
    address_district = excluded.address_district,
    address_street = excluded.address_street,
    branch_id = excluded.branch_id,
    bank_account = excluded.bank_account`;

function supplierParams(supplier: Supplier): SqlValue[] {
  return [
    supplier.id,
    supplier.code,
    supplier.nameAr,
    supplier.nameEn,
    supplier.phone,
    supplier.email,
    supplier.contactPerson,
    supplier.taxNumber,
    supplier.category,
    supplier.notes,
    supplier.paymentTermsDays,
    supplier.currency,
    supplier.openingBalance.scaled,
    supplier.active ? 1 : 0,
    supplier.addressCity,
    supplier.addressDistrict,
    supplier.addressStreet,
    supplier.branchId,
    supplier.bankAccount ?? null,
  ];
}

class SqlSupplierRepository implements SupplierRepository {
  constructor(private readonly db: SqlDb) {}

  async findAll(): Promise<readonly Supplier[]> {
    return (await this.db.all<SupplierRow>(`SELECT * FROM supplier ORDER BY code ASC`)).map(toSupplier);
  }

  async findById(id: string): Promise<Supplier | null> {
    const row = await this.db.get<SupplierRow>(`SELECT * FROM supplier WHERE id = ?`, [id]);
    return row ? toSupplier(row) : null;
  }

  async findByCode(code: string): Promise<Supplier | null> {
    const row = await this.db.get<SupplierRow>(`SELECT * FROM supplier WHERE code = ?`, [code]);
    return row ? toSupplier(row) : null;
  }

  async save(supplier: Supplier): Promise<void> {
    await this.db.run(UPSERT_SUPPLIER, supplierParams(supplier));
  }

  async insert(supplier: Supplier): Promise<void> {
    await insertNew(this.db, supplier.id, UPSERT_SUPPLIER, supplierParams(supplier));
  }
}

export interface SqliteSupplierRepositoryHandle extends SupplierRepository {
  close(): void;
}

export async function ensureSupplierSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createSupplierRepository(db: SqlDb): SupplierRepository {
  return new SqlSupplierRepository(db);
}

/** Open a SQLite-backed SupplierRepository. ":memory:" for tests, a path for real. */
export function createSqliteSupplierRepository(path: SqliteConnectionInput = ":memory:"): SqliteSupplierRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  return Object.assign(createSupplierRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
