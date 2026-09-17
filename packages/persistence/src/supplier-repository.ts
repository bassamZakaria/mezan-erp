import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type Supplier, type SupplierRepository } from "@mezan/domain";

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
  payment_terms_days: number;
  currency: string;
  opening_balance: number;
  active: number;
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
    paymentTermsDays: row.payment_terms_days,
    currency: row.currency,
    openingBalance: Money.fromScaled(row.opening_balance),
    active: row.active === 1,
    branchId: row.branch_id ?? null,
    addressCity: row.address_city,
    addressDistrict: row.address_district,
    addressStreet: row.address_street,
    bankAccount: row.bank_account ?? null,
  };
}

class SqliteSupplierRepository implements SupplierRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO supplier (
        id, code, name_ar, name_en, phone, email, contact_person, tax_number, category, notes,
        payment_terms_days, currency, opening_balance, active, address_city, address_district, address_street, branch_id, bank_account
      ) VALUES (
        @id, @code, @nameAr, @nameEn, @phone, @email, @contactPerson, @taxNumber, @category, @notes,
        @paymentTermsDays, @currency, @openingBalance, @active, @addressCity, @addressDistrict, @addressStreet, @branchId, @bankAccount
      )
      ON CONFLICT(id) DO UPDATE SET
        code = @code, name_ar = @nameAr, name_en = @nameEn, phone = @phone, email = @email,
        contact_person = @contactPerson, tax_number = @taxNumber, category = @category, notes = @notes,
        payment_terms_days = @paymentTermsDays, currency = @currency, opening_balance = @openingBalance,
        active = @active, address_city = @addressCity, address_district = @addressDistrict,
        address_street = @addressStreet, branch_id = @branchId, bank_account = @bankAccount
    `);
    this.selectAll = sqlite.prepare(`SELECT * FROM supplier ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM supplier WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM supplier WHERE code = ?`);
  }

  async findAll(): Promise<readonly Supplier[]> {
    return (this.selectAll.all() as SupplierRow[]).map(toSupplier);
  }

  async findById(id: string): Promise<Supplier | null> {
    const row = this.selectById.get(id) as SupplierRow | undefined;
    return row ? toSupplier(row) : null;
  }

  async findByCode(code: string): Promise<Supplier | null> {
    const row = this.selectByCode.get(code) as SupplierRow | undefined;
    return row ? toSupplier(row) : null;
  }

  async save(supplier: Supplier): Promise<void> {
    this.upsert.run({
      id: supplier.id,
      code: supplier.code,
      nameAr: supplier.nameAr,
      nameEn: supplier.nameEn,
      phone: supplier.phone,
      email: supplier.email,
      contactPerson: supplier.contactPerson,
      taxNumber: supplier.taxNumber,
      category: supplier.category,
      notes: supplier.notes,
      paymentTermsDays: supplier.paymentTermsDays,
      currency: supplier.currency,
      openingBalance: supplier.openingBalance.toScaledNumber(),
      active: supplier.active ? 1 : 0,
      branchId: supplier.branchId,
      addressCity: supplier.addressCity,
      addressDistrict: supplier.addressDistrict,
      addressStreet: supplier.addressStreet,
      bankAccount: supplier.bankAccount ?? null,
    });
  }
}

export interface SqliteSupplierRepositoryHandle extends SupplierRepository {
  close(): void;
}

/** Open a SQLite-backed SupplierRepository. ":memory:" for tests, a path for real. */
export function createSqliteSupplierRepository(path: SqliteConnectionInput = ":memory:"): SqliteSupplierRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  const repo = new SqliteSupplierRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSupplierRepositoryHandle;
}
