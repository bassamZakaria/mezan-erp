import {
  BUILT_IN_POS_PAYMENT_METHODS,
  Money,
  defaultPosSettings,
  type PosPaperWidth,
  type PosPaymentAccountType,
  type PosPaymentMethod,
  type PosPaymentMethodKind,
  type PosPaymentMethodRepository,
  type PosPrinterKind,
  type PosSettings,
  type PosSettingsRepository,
  type PosTerminal,
  type PosTerminalKind,
  type PosTerminalMethod,
  type PosTerminalRepository,
  type ShiftTemplate,
  type ShiftTemplateRepository,
} from "@mezan/domain";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { placeholders, type SqlDb, type SqlValue } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS pos_payment_method (
  id                          TEXT PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,
  name_ar                     TEXT NOT NULL,
  name_en                     TEXT,
  kind                        TEXT NOT NULL,
  account_type                TEXT,
  default_treasury_account_id TEXT,
  built_in                    INTEGER NOT NULL,
  active                      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pos_terminal (
  id                          TEXT PRIMARY KEY,
  code                        TEXT NOT NULL UNIQUE,
  name                        TEXT NOT NULL,
  name_en                     TEXT,
  kind                        TEXT NOT NULL,
  branch_id                   TEXT NOT NULL,
  warehouse_id                TEXT NOT NULL,
  drawer_treasury_account_id  TEXT NOT NULL,
  methods_json                TEXT NOT NULL,
  default_method_id           TEXT NOT NULL,
  printer_kind                TEXT NOT NULL,
  printer_address             TEXT,
  paper_width_mm              INTEGER NOT NULL,
  eta_device_serial           TEXT,
  eta_pos_client_id           TEXT,
  eta_pos_client_secret_enc   TEXT,
  eta_pos_os_version          TEXT,
  eta_pos_model_framework     TEXT,
  eta_pos_preshared_key_enc   TEXT,
  active                      INTEGER NOT NULL,
  last_receipt_seq            INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_terminal_eta_serial ON pos_terminal(eta_device_serial) WHERE eta_device_serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_terminal_branch ON pos_terminal(branch_id);
CREATE TABLE IF NOT EXISTS pos_settings (
  id                              TEXT PRIMARY KEY,
  receipt_screen_seconds          INTEGER NOT NULL,
  allow_ar_collection             INTEGER NOT NULL,
  cashier_discount_percent_bp     INTEGER NOT NULL,
  cashier_discount_amount         INTEGER NOT NULL,
  manager_discount_percent_bp     INTEGER NOT NULL,
  manager_discount_amount         INTEGER NOT NULL,
  approval_expiry_minutes         INTEGER NOT NULL,
  walk_in_customer_id             TEXT NOT NULL,
  prices_include_tax              INTEGER NOT NULL,
  meal_sections_json              TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shift_template (
  id         TEXT PRIMARY KEY,
  name_ar    TEXT NOT NULL,
  name_en    TEXT,
  from_time  TEXT NOT NULL,
  to_time    TEXT NOT NULL,
  branch_id  TEXT,
  active     INTEGER NOT NULL
);
`;

const SETTINGS_ROW_ID = "singleton";

/**
 * Secret-at-rest transform, the same placeholder `eta-store.ts` uses for the
 * branch's POS secret. The desktop database is itself encrypted at rest; the
 * value is still never returned by any read but `readEtaDeviceSecrets`.
 */
function seal(secret: string): string {
  return Buffer.from(secret, "utf8").toString("base64");
}

function unseal(sealed: string): string {
  return Buffer.from(sealed, "base64").toString("utf8");
}

interface PaymentMethodRow {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  kind: string;
  account_type: string | null;
  default_treasury_account_id: string | null;
  built_in: bigint;
  active: bigint;
}

function toPaymentMethod(row: PaymentMethodRow): PosPaymentMethod {
  return {
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    kind: row.kind as PosPaymentMethodKind,
    accountType: row.account_type as PosPaymentAccountType | null,
    defaultTreasuryAccountId: row.default_treasury_account_id,
    builtIn: Number(row.built_in) === 1,
    active: Number(row.active) === 1,
  };
}

interface TerminalRow {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  kind: string;
  branch_id: string;
  warehouse_id: string;
  drawer_treasury_account_id: string;
  methods_json: string;
  default_method_id: string;
  printer_kind: string;
  printer_address: string | null;
  paper_width_mm: bigint;
  eta_device_serial: string | null;
  eta_pos_client_id: string | null;
  eta_pos_client_secret_enc: string | null;
  eta_pos_os_version: string | null;
  eta_pos_model_framework: string | null;
  eta_pos_preshared_key_enc: string | null;
  active: bigint;
  last_receipt_seq: bigint;
}

function toTerminal(row: TerminalRow): PosTerminal {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameEn: row.name_en,
    kind: row.kind as PosTerminalKind,
    branchId: row.branch_id,
    warehouseId: row.warehouse_id,
    drawerTreasuryAccountId: row.drawer_treasury_account_id,
    methods: JSON.parse(row.methods_json) as PosTerminalMethod[],
    defaultMethodId: row.default_method_id,
    printer: {
      kind: row.printer_kind as PosPrinterKind,
      address: row.printer_address,
      paperWidthMm: Number(row.paper_width_mm) as PosPaperWidth,
    },
    etaDeviceSerial: row.eta_device_serial,
    etaPosClientId: row.eta_pos_client_id,
    etaPosOsVersion: row.eta_pos_os_version,
    etaPosModelFramework: row.eta_pos_model_framework,
    hasEtaPosClientSecret: row.eta_pos_client_secret_enc !== null,
    hasEtaPosPresharedKey: row.eta_pos_preshared_key_enc !== null,
    active: Number(row.active) === 1,
    lastReceiptSeq: Number(row.last_receipt_seq),
  };
}

interface SettingsRow {
  receipt_screen_seconds: bigint;
  allow_ar_collection: bigint;
  cashier_discount_percent_bp: bigint;
  cashier_discount_amount: bigint;
  manager_discount_percent_bp: bigint;
  manager_discount_amount: bigint;
  approval_expiry_minutes: bigint;
  walk_in_customer_id: string;
  prices_include_tax: bigint;
  meal_sections_json: string;
}

interface ShiftTemplateRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  from_time: string;
  to_time: string;
  branch_id: string | null;
  active: bigint;
}

function toShiftTemplate(row: ShiftTemplateRow): ShiftTemplate {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    fromTime: row.from_time,
    toTime: row.to_time,
    branchId: row.branch_id,
    active: Number(row.active) === 1,
  };
}

const PAYMENT_METHOD_COLUMNS = "id, code, name_ar, name_en, kind, account_type, default_treasury_account_id, built_in, active";

const INSERT_PAYMENT_METHOD_IF_MISSING = `INSERT INTO pos_payment_method (${PAYMENT_METHOD_COLUMNS}) VALUES (${placeholders(9)}) ON CONFLICT DO NOTHING`;

function paymentMethodParams(method: PosPaymentMethod): SqlValue[] {
  return [
    method.id,
    method.code,
    method.nameAr,
    method.nameEn,
    method.kind,
    method.accountType,
    method.defaultTreasuryAccountId,
    method.builtIn ? 1 : 0,
    method.active ? 1 : 0,
  ];
}

class SqlPosPaymentMethodStore implements PosPaymentMethodRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<readonly PosPaymentMethod[]> {
    const rows = await this.db.all<PaymentMethodRow>(
      `SELECT * FROM pos_payment_method ORDER BY built_in DESC, CASE kind WHEN 'cash' THEN 0 ELSE 1 END, code ASC`,
    );
    return rows.map(toPaymentMethod);
  }

  async findById(id: string): Promise<PosPaymentMethod | null> {
    const row = await this.db.get<PaymentMethodRow>(`SELECT * FROM pos_payment_method WHERE id = ?`, [id]);
    return row ? toPaymentMethod(row) : null;
  }

  async findByCode(code: string): Promise<PosPaymentMethod | null> {
    const row = await this.db.get<PaymentMethodRow>(`SELECT * FROM pos_payment_method WHERE code = ?`, [code]);
    return row ? toPaymentMethod(row) : null;
  }

  async save(method: PosPaymentMethod): Promise<void> {
    await this.db.run(
      `INSERT INTO pos_payment_method (${PAYMENT_METHOD_COLUMNS}) VALUES (${placeholders(9)})
       ON CONFLICT(id) DO UPDATE SET
         name_ar = excluded.name_ar, name_en = excluded.name_en, account_type = excluded.account_type,
         default_treasury_account_id = excluded.default_treasury_account_id, active = excluded.active`,
      paymentMethodParams(method),
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM pos_payment_method WHERE id = ? AND built_in = 0`, [id]);
  }
}

class SqlPosTerminalStore implements PosTerminalRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<readonly PosTerminal[]> {
    return (await this.db.all<TerminalRow>(`SELECT * FROM pos_terminal ORDER BY code ASC`)).map(toTerminal);
  }

  async findById(id: string): Promise<PosTerminal | null> {
    const row = await this.db.get<TerminalRow>(`SELECT * FROM pos_terminal WHERE id = ?`, [id]);
    return row ? toTerminal(row) : null;
  }

  async findByCode(code: string): Promise<PosTerminal | null> {
    const row = await this.db.get<TerminalRow>(`SELECT * FROM pos_terminal WHERE code = ?`, [code]);
    return row ? toTerminal(row) : null;
  }

  async save(terminal: PosTerminal): Promise<void> {
    await this.db.run(
      `INSERT INTO pos_terminal (id, code, name, name_en, kind, branch_id, warehouse_id, drawer_treasury_account_id,
         methods_json, default_method_id, printer_kind, printer_address, paper_width_mm,
         eta_device_serial, eta_pos_client_id, eta_pos_os_version, eta_pos_model_framework, active)
       VALUES (${placeholders(18)})
       ON CONFLICT(id) DO UPDATE SET
         code = excluded.code, name = excluded.name, name_en = excluded.name_en, kind = excluded.kind, branch_id = excluded.branch_id,
         warehouse_id = excluded.warehouse_id, drawer_treasury_account_id = excluded.drawer_treasury_account_id,
         methods_json = excluded.methods_json, default_method_id = excluded.default_method_id,
         printer_kind = excluded.printer_kind, printer_address = excluded.printer_address, paper_width_mm = excluded.paper_width_mm,
         eta_pos_client_secret_enc = CASE
           WHEN pos_terminal.eta_device_serial IS DISTINCT FROM excluded.eta_device_serial THEN NULL
           ELSE pos_terminal.eta_pos_client_secret_enc END,
         eta_pos_preshared_key_enc = CASE
           WHEN pos_terminal.eta_device_serial IS DISTINCT FROM excluded.eta_device_serial THEN NULL
           ELSE pos_terminal.eta_pos_preshared_key_enc END,
         eta_device_serial = excluded.eta_device_serial, eta_pos_client_id = excluded.eta_pos_client_id,
         eta_pos_os_version = excluded.eta_pos_os_version, eta_pos_model_framework = excluded.eta_pos_model_framework, active = excluded.active`,
      [
        terminal.id,
        terminal.code,
        terminal.name,
        terminal.nameEn,
        terminal.kind,
        terminal.branchId,
        terminal.warehouseId,
        terminal.drawerTreasuryAccountId,
        JSON.stringify(terminal.methods),
        terminal.defaultMethodId,
        terminal.printer.kind,
        terminal.printer.address,
        terminal.printer.paperWidthMm,
        terminal.etaDeviceSerial,
        terminal.etaPosClientId,
        terminal.etaPosOsVersion,
        terminal.etaPosModelFramework,
        terminal.active ? 1 : 0,
      ],
    );
  }

  async setEtaPosClientSecret(terminalId: string, secret: string): Promise<void> {
    await this.db.run(`UPDATE pos_terminal SET eta_pos_client_secret_enc = ? WHERE id = ?`, [seal(secret), terminalId]);
  }

  async setEtaPosPresharedKey(terminalId: string, key: string): Promise<void> {
    await this.db.run(`UPDATE pos_terminal SET eta_pos_preshared_key_enc = ? WHERE id = ?`, [seal(key), terminalId]);
  }

  async readEtaDeviceSecrets(terminalId: string): Promise<{ clientSecret: string | null; presharedKey: string | null }> {
    const row = await this.db.get<{ secret: string | null; psk: string | null }>(
      `SELECT eta_pos_client_secret_enc AS secret, eta_pos_preshared_key_enc AS psk FROM pos_terminal WHERE id = ?`,
      [terminalId],
    );
    return {
      clientSecret: row?.secret ? unseal(row.secret) : null,
      presharedKey: row?.psk ? unseal(row.psk) : null,
    };
  }

  async nextReceiptSeq(terminalId: string): Promise<number> {
    const row = await this.db.get<{ seq: bigint }>(
      `UPDATE pos_terminal SET last_receipt_seq = last_receipt_seq + 1 WHERE id = ? RETURNING last_receipt_seq AS seq`,
      [terminalId],
    );
    if (!row) throw new Error(`POS terminal ${terminalId} not found`);
    return Number(row.seq);
  }
}

class SqlPosSettingsStore implements PosSettingsRepository {
  constructor(private readonly db: SqlDb) {}

  async get(): Promise<PosSettings> {
    const row = await this.db.get<SettingsRow>(`SELECT * FROM pos_settings WHERE id = ?`, [SETTINGS_ROW_ID]);
    if (!row) return defaultPosSettings();
    return {
      receiptScreenSeconds: Number(row.receipt_screen_seconds),
      allowArCollection: Number(row.allow_ar_collection) === 1,
      cashierDiscountLimit: { percentBp: Number(row.cashier_discount_percent_bp), amount: Money.fromScaled(row.cashier_discount_amount) },
      managerDiscountLimit: { percentBp: Number(row.manager_discount_percent_bp), amount: Money.fromScaled(row.manager_discount_amount) },
      approvalExpiryMinutes: Number(row.approval_expiry_minutes),
      walkInCustomerId: row.walk_in_customer_id,
      pricesIncludeTax: Number(row.prices_include_tax) === 1,
      mealSections: JSON.parse(row.meal_sections_json) as PosSettings["mealSections"],
    };
  }

  async save(settings: PosSettings): Promise<void> {
    await this.db.run(
      `INSERT INTO pos_settings (id, receipt_screen_seconds, allow_ar_collection, cashier_discount_percent_bp,
         cashier_discount_amount, manager_discount_percent_bp, manager_discount_amount, approval_expiry_minutes,
         walk_in_customer_id, prices_include_tax, meal_sections_json)
       VALUES (${placeholders(11)})
       ON CONFLICT(id) DO UPDATE SET
         receipt_screen_seconds = excluded.receipt_screen_seconds, allow_ar_collection = excluded.allow_ar_collection,
         cashier_discount_percent_bp = excluded.cashier_discount_percent_bp, cashier_discount_amount = excluded.cashier_discount_amount,
         manager_discount_percent_bp = excluded.manager_discount_percent_bp, manager_discount_amount = excluded.manager_discount_amount,
         approval_expiry_minutes = excluded.approval_expiry_minutes, walk_in_customer_id = excluded.walk_in_customer_id,
         prices_include_tax = excluded.prices_include_tax, meal_sections_json = excluded.meal_sections_json`,
      [
        SETTINGS_ROW_ID,
        settings.receiptScreenSeconds,
        settings.allowArCollection ? 1 : 0,
        settings.cashierDiscountLimit.percentBp,
        settings.cashierDiscountLimit.amount.scaled,
        settings.managerDiscountLimit.percentBp,
        settings.managerDiscountLimit.amount.scaled,
        settings.approvalExpiryMinutes,
        settings.walkInCustomerId,
        settings.pricesIncludeTax ? 1 : 0,
        JSON.stringify(settings.mealSections),
      ],
    );
  }
}

class SqlShiftTemplateStore implements ShiftTemplateRepository {
  constructor(private readonly db: SqlDb) {}

  async list(): Promise<readonly ShiftTemplate[]> {
    return (await this.db.all<ShiftTemplateRow>(`SELECT * FROM shift_template ORDER BY from_time ASC, name_ar ASC`)).map(toShiftTemplate);
  }

  async findById(id: string): Promise<ShiftTemplate | null> {
    const row = await this.db.get<ShiftTemplateRow>(`SELECT * FROM shift_template WHERE id = ?`, [id]);
    return row ? toShiftTemplate(row) : null;
  }

  async save(template: ShiftTemplate): Promise<void> {
    await this.db.run(
      `INSERT INTO shift_template (id, name_ar, name_en, from_time, to_time, branch_id, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name_ar = excluded.name_ar, name_en = excluded.name_en, from_time = excluded.from_time,
         to_time = excluded.to_time, branch_id = excluded.branch_id, active = excluded.active`,
      [template.id, template.nameAr, template.nameEn, template.fromTime, template.toTime, template.branchId, template.active ? 1 : 0],
    );
  }
}

export interface PosStoreHandle {
  readonly terminals: PosTerminalRepository;
  readonly paymentMethods: PosPaymentMethodRepository;
  readonly settings: PosSettingsRepository;
  readonly shiftTemplates: ShiftTemplateRepository;
}

export interface SqlitePosStoreHandle extends PosStoreHandle {
  close(): void;
}

export async function ensurePosSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLES);
  for (const method of BUILT_IN_POS_PAYMENT_METHODS) await db.run(INSERT_PAYMENT_METHOD_IF_MISSING, paymentMethodParams(method));
}

export function createPosStore(db: SqlDb): PosStoreHandle {
  return {
    terminals: new SqlPosTerminalStore(db),
    paymentMethods: new SqlPosPaymentMethodStore(db),
    settings: new SqlPosSettingsStore(db),
    shiftTemplates: new SqlShiftTemplateStore(db),
  };
}

/** POS master data — terminals, payment methods, POS settings and shift templates. */
export function createSqlitePosStore(path: SqliteConnectionInput = ":memory:"): SqlitePosStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  const seedBuiltIn = sqlite.prepare(INSERT_PAYMENT_METHOD_IF_MISSING);
  for (const method of BUILT_IN_POS_PAYMENT_METHODS) seedBuiltIn.run(...paymentMethodParams(method));
  return {
    ...createPosStore(sqliteDb(sqlite)),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
