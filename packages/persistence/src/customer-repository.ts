import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { Money, type Customer, type CustomerRepository, type EtaBuyerType } from "@mezan/domain";

/**
 * SQLite-backed CustomerRepository (docs/catalog/01 "العملاء"). Standalone —
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
  national_id        TEXT
);
`;

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
  payment_terms_days: number;
  currency: string;
  opening_balance: number;
  active: number;
  price_list_id: string | null;
  credit_limit: number;
  tax_exempt: number;
  eta_buyer_type: string;
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
    paymentTermsDays: row.payment_terms_days,
    currency: row.currency,
    openingBalance: Money.fromScaled(row.opening_balance),
    active: row.active === 1,
    priceListId: row.price_list_id,
    creditLimit: Money.fromScaled(row.credit_limit),
    taxExempt: row.tax_exempt === 1,
    etaBuyerType: row.eta_buyer_type as EtaBuyerType,
    nationalId: row.national_id,
  };
}

class SqliteCustomerRepository implements CustomerRepository {
  private readonly upsert: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByCode: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(`
      INSERT INTO customer (
        id, code, name_ar, name_en, phone, email, contact_person, tax_number, category, notes,
        payment_terms_days, currency, opening_balance, active, price_list_id, credit_limit, tax_exempt, eta_buyer_type, national_id
      ) VALUES (
        @id, @code, @nameAr, @nameEn, @phone, @email, @contactPerson, @taxNumber, @category, @notes,
        @paymentTermsDays, @currency, @openingBalance, @active, @priceListId, @creditLimit, @taxExempt, @etaBuyerType, @nationalId
      )
      ON CONFLICT(id) DO UPDATE SET
        code = @code, name_ar = @nameAr, name_en = @nameEn, phone = @phone, email = @email,
        contact_person = @contactPerson, tax_number = @taxNumber, category = @category, notes = @notes,
        payment_terms_days = @paymentTermsDays, currency = @currency, opening_balance = @openingBalance,
        active = @active, price_list_id = @priceListId, credit_limit = @creditLimit,
        tax_exempt = @taxExempt, eta_buyer_type = @etaBuyerType, national_id = @nationalId
    `);
    this.selectAll = sqlite.prepare(`SELECT * FROM customer ORDER BY code ASC`);
    this.selectById = sqlite.prepare(`SELECT * FROM customer WHERE id = ?`);
    this.selectByCode = sqlite.prepare(`SELECT * FROM customer WHERE code = ?`);
  }

  async findAll(): Promise<readonly Customer[]> {
    return (this.selectAll.all() as CustomerRow[]).map(toCustomer);
  }

  async findById(id: string): Promise<Customer | null> {
    const row = this.selectById.get(id) as CustomerRow | undefined;
    return row ? toCustomer(row) : null;
  }

  async findByCode(code: string): Promise<Customer | null> {
    const row = this.selectByCode.get(code) as CustomerRow | undefined;
    return row ? toCustomer(row) : null;
  }

  async save(customer: Customer): Promise<void> {
    this.upsert.run({
      id: customer.id,
      code: customer.code,
      nameAr: customer.nameAr,
      nameEn: customer.nameEn,
      phone: customer.phone,
      email: customer.email,
      contactPerson: customer.contactPerson,
      taxNumber: customer.taxNumber,
      category: customer.category,
      notes: customer.notes,
      paymentTermsDays: customer.paymentTermsDays,
      currency: customer.currency,
      openingBalance: customer.openingBalance.toScaledNumber(),
      active: customer.active ? 1 : 0,
      priceListId: customer.priceListId,
      creditLimit: customer.creditLimit.toScaledNumber(),
      taxExempt: customer.taxExempt ? 1 : 0,
      etaBuyerType: customer.etaBuyerType,
      nationalId: customer.nationalId,
    });
  }
}

export interface SqliteCustomerRepositoryHandle extends CustomerRepository {
  close(): void;
}

/** Open a SQLite-backed CustomerRepository. ":memory:" for tests, a path for real. */
export function createSqliteCustomerRepository(path: SqliteConnectionInput = ":memory:"): SqliteCustomerRepositoryHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const repo = new SqliteCustomerRepository(sqlite);
  return Object.assign(repo, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteCustomerRepositoryHandle;
}
