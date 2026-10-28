import type Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, SYSTEM_NOT_SUBJECT_TAX_RATE_ID, type Customer, type CustomerRepository, type EtaBuyerType } from "@mezan/domain";
import { insertNew } from "./insert-new.js";
import type { SqlDb, SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

/**
 * SQLite-backed CustomerRepository (docs/archive/catalog/01 "العملاء"). Standalone —
 * like {@link import("./account-repository.js").createSqliteAccountRepository}
 * — it owns its own connection/table rather than folding into
 * `createSqliteUnitOfWork`. Money columns (`credit_limit`, `opening_balance`)
 * are stored as INTEGER at Money's fixed 1e-6 scale, never REAL.
 */

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS customer (
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
  price_list_id      TEXT,
  credit_limit       INTEGER NOT NULL,
  tax_exempt         INTEGER NOT NULL,
  eta_buyer_type     TEXT NOT NULL,
  national_id        TEXT,
  commercial_registration_number TEXT,
  address            TEXT,
  logo_attachment_id TEXT,
  branch_id          TEXT,
  tax_exemption_rate_id TEXT
);
`;

/** Advanced-options columns added after the first release (R3.8) — an existing database keeps them null. */
const ADDED_COLUMNS: readonly [string, string][] = [
  ["commercial_registration_number", "TEXT"],
  ["address", "TEXT"],
  ["logo_attachment_id", "TEXT"],
  ["branch_id", "TEXT"],
  ["tax_exemption_rate_id", "TEXT"],
];

function addMissingColumns(sqlite: Database.Database): void {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(customer)`).all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, type] of ADDED_COLUMNS) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE customer ADD COLUMN ${name} ${type}`);
  }
}

interface CustomerRow {
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
  branch_id: string | null;
  active: bigint;
  price_list_id: string | null;
  credit_limit: bigint;
  tax_exempt: bigint;
  tax_exemption_rate_id: string | null;
  eta_buyer_type: string;
  commercial_registration_number: string | null;
  address: string | null;
  logo_attachment_id: string | null;
  national_id: string | null;
}

function toCustomer(row: CustomerRow): Customer {
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
    branchId: row.branch_id ?? null,
    active: Number(row.active) === 1,
    priceListId: row.price_list_id,
    creditLimit: Money.fromScaled(row.credit_limit),
    taxExempt: Number(row.tax_exempt) === 1,
    taxExemptionRateId: row.tax_exemption_rate_id ?? null,
    etaBuyerType: row.eta_buyer_type as EtaBuyerType,
    commercialRegistrationNumber: row.commercial_registration_number ?? null,
    address: row.address ?? null,
    logoAttachmentId: row.logo_attachment_id ?? null,
    nationalId: row.national_id,
  };
}

const UPSERT_CUSTOMER = `INSERT INTO customer (id, code, name_ar, name_en, phone, email, contact_person, tax_number, category, notes, payment_terms_days, currency, opening_balance, active, branch_id, price_list_id, credit_limit, tax_exempt, tax_exemption_rate_id, eta_buyer_type, commercial_registration_number, address, logo_attachment_id, national_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    branch_id = excluded.branch_id,
    price_list_id = excluded.price_list_id,
    credit_limit = excluded.credit_limit,
    tax_exempt = excluded.tax_exempt,
    tax_exemption_rate_id = excluded.tax_exemption_rate_id,
    eta_buyer_type = excluded.eta_buyer_type,
    commercial_registration_number = excluded.commercial_registration_number,
    address = excluded.address,
    logo_attachment_id = excluded.logo_attachment_id,
    national_id = excluded.national_id`;

function customerParams(customer: Customer): SqlValue[] {
  return [
    customer.id,
    customer.code,
    customer.nameAr,
    customer.nameEn,
    customer.phone,
    customer.email,
    customer.contactPerson,
    customer.taxNumber,
    customer.category,
    customer.notes,
    customer.paymentTermsDays,
    customer.currency,
    customer.openingBalance.scaled,
    customer.active ? 1 : 0,
    customer.branchId,
    customer.priceListId,
    customer.creditLimit.scaled,
    customer.taxExempt ? 1 : 0,
    customer.taxExemptionRateId,
    customer.etaBuyerType,
    customer.commercialRegistrationNumber,
    customer.address,
    customer.logoAttachmentId,
    customer.nationalId,
  ];
}

class SqlCustomerRepository implements CustomerRepository {
  constructor(private readonly db: SqlDb) {}

  async findAll(): Promise<readonly Customer[]> {
    return (await this.db.all<CustomerRow>(`SELECT * FROM customer ORDER BY code ASC`)).map(toCustomer);
  }

  async findById(id: string): Promise<Customer | null> {
    const row = await this.db.get<CustomerRow>(`SELECT * FROM customer WHERE id = ?`, [id]);
    return row ? toCustomer(row) : null;
  }

  async findByCode(code: string): Promise<Customer | null> {
    const row = await this.db.get<CustomerRow>(`SELECT * FROM customer WHERE code = ?`, [code]);
    return row ? toCustomer(row) : null;
  }

  async save(customer: Customer): Promise<void> {
    await this.db.run(UPSERT_CUSTOMER, customerParams(customer));
  }

  async insert(customer: Customer): Promise<void> {
    await insertNew(this.db, customer.id, UPSERT_CUSTOMER, customerParams(customer));
  }
}

export interface SqliteCustomerRepositoryHandle extends CustomerRepository {
  close(): void;
}

export async function ensureCustomerSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export function createCustomerRepository(db: SqlDb): CustomerRepository {
  return new SqlCustomerRepository(db);
}

/** Open a SQLite-backed CustomerRepository. ":memory:" for tests, a path for real. */
export function createSqliteCustomerRepository(path: SqliteConnectionInput = ":memory:"): SqliteCustomerRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  addMissingColumns(sqlite);
  // INVARIANT: the system's not-subject rate is never a customer's exemption —
  // it says the TENANT is outside VAT. A card left holding it is cleared, and
  // the customer's sales wait to be classified under a rate of the tenant's own.
  sqlite.prepare(`UPDATE customer SET tax_exemption_rate_id = NULL WHERE tax_exemption_rate_id = ?`).run(SYSTEM_NOT_SUBJECT_TAX_RATE_ID);
  return Object.assign(createCustomerRepository(sqliteDb(sqlite)), {
    close: () => { if (owned) sqlite.close(); },
  });
}
