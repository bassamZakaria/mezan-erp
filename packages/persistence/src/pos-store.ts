import type Database from "better-sqlite3";
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
  built_in: number;
  active: number;
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
    builtIn: row.built_in === 1,
    active: row.active === 1,
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
  paper_width_mm: number;
  eta_device_serial: string | null;
  eta_pos_client_id: string | null;
  eta_pos_client_secret_enc: string | null;
  eta_pos_os_version: string | null;
  eta_pos_model_framework: string | null;
  eta_pos_preshared_key_enc: string | null;
  active: number;
  last_receipt_seq: number;
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
      paperWidthMm: row.paper_width_mm as PosPaperWidth,
    },
    etaDeviceSerial: row.eta_device_serial,
    etaPosClientId: row.eta_pos_client_id,
    etaPosOsVersion: row.eta_pos_os_version,
    etaPosModelFramework: row.eta_pos_model_framework,
    hasEtaPosClientSecret: row.eta_pos_client_secret_enc !== null,
    hasEtaPosPresharedKey: row.eta_pos_preshared_key_enc !== null,
    active: row.active === 1,
    lastReceiptSeq: row.last_receipt_seq,
  };
}

interface SettingsRow {
  receipt_screen_seconds: number;
  allow_ar_collection: number;
  cashier_discount_percent_bp: number;
  cashier_discount_amount: number;
  manager_discount_percent_bp: number;
  manager_discount_amount: number;
  approval_expiry_minutes: number;
  walk_in_customer_id: string;
  prices_include_tax: number;
  meal_sections_json: string;
}

interface ShiftTemplateRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  from_time: string;
  to_time: string;
  branch_id: string | null;
  active: number;
}

function toShiftTemplate(row: ShiftTemplateRow): ShiftTemplate {
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    fromTime: row.from_time,
    toTime: row.to_time,
    branchId: row.branch_id,
    active: row.active === 1,
  };
}

class SqlitePosPaymentMethodStore implements PosPaymentMethodRepository {
  private readonly upsert: Database.Statement;
  private readonly insertIfMissing: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO pos_payment_method (id, code, name_ar, name_en, kind, account_type, default_treasury_account_id, built_in, active)
       VALUES (@id, @code, @nameAr, @nameEn, @kind, @accountType, @defaultTreasuryAccountId, @builtIn, @active)
       ON CONFLICT(id) DO UPDATE SET
         name_ar = @nameAr, name_en = @nameEn, account_type = @accountType,
         default_treasury_account_id = @defaultTreasuryAccountId, active = @active`,
    );
    this.insertIfMissing = sqlite.prepare(
      `INSERT OR IGNORE INTO pos_payment_method (id, code, name_ar, name_en, kind, account_type, default_treasury_account_id, built_in, active)
       VALUES (@id, @code, @nameAr, @nameEn, @kind, @accountType, @defaultTreasuryAccountId, @builtIn, @active)`,
    );
    for (const method of BUILT_IN_POS_PAYMENT_METHODS) this.insertIfMissing.run(this.params(method));
  }

  private params(method: PosPaymentMethod) {
    return {
      id: method.id,
      code: method.code,
      nameAr: method.nameAr,
      nameEn: method.nameEn,
      kind: method.kind,
      accountType: method.accountType,
      defaultTreasuryAccountId: method.defaultTreasuryAccountId,
      builtIn: method.builtIn ? 1 : 0,
      active: method.active ? 1 : 0,
    };
  }

  async list(): Promise<readonly PosPaymentMethod[]> {
    const rows = this.sqlite
      .prepare(`SELECT * FROM pos_payment_method ORDER BY built_in DESC, CASE kind WHEN 'cash' THEN 0 ELSE 1 END, code ASC`)
      .all() as PaymentMethodRow[];
    return rows.map(toPaymentMethod);
  }

  async findById(id: string): Promise<PosPaymentMethod | null> {
    const row = this.sqlite.prepare(`SELECT * FROM pos_payment_method WHERE id = ?`).get(id) as PaymentMethodRow | undefined;
    return row ? toPaymentMethod(row) : null;
  }

  async findByCode(code: string): Promise<PosPaymentMethod | null> {
    const row = this.sqlite.prepare(`SELECT * FROM pos_payment_method WHERE code = ?`).get(code) as PaymentMethodRow | undefined;
    return row ? toPaymentMethod(row) : null;
  }

  async save(method: PosPaymentMethod): Promise<void> {
    this.upsert.run(this.params(method));
  }

  async delete(id: string): Promise<void> {
    this.sqlite.prepare(`DELETE FROM pos_payment_method WHERE id = ? AND built_in = 0`).run(id);
  }
}

class SqlitePosTerminalStore implements PosTerminalRepository {
  private readonly upsert: Database.Statement;

  constructor(private readonly sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO pos_terminal (id, code, name, name_en, kind, branch_id, warehouse_id, drawer_treasury_account_id,
         methods_json, default_method_id, printer_kind, printer_address, paper_width_mm,
         eta_device_serial, eta_pos_client_id, eta_pos_os_version, eta_pos_model_framework, active)
       VALUES (@id, @code, @name, @nameEn, @kind, @branchId, @warehouseId, @drawerTreasuryAccountId,
         @methodsJson, @defaultMethodId, @printerKind, @printerAddress, @paperWidthMm,
         @etaDeviceSerial, @etaPosClientId, @etaPosOsVersion, @etaPosModelFramework, @active)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name = @name, name_en = @nameEn, kind = @kind, branch_id = @branchId,
         warehouse_id = @warehouseId, drawer_treasury_account_id = @drawerTreasuryAccountId,
         methods_json = @methodsJson, default_method_id = @defaultMethodId,
         printer_kind = @printerKind, printer_address = @printerAddress, paper_width_mm = @paperWidthMm,
         eta_pos_client_secret_enc = CASE
           WHEN pos_terminal.eta_device_serial IS NOT @etaDeviceSerial THEN NULL
           ELSE pos_terminal.eta_pos_client_secret_enc END,
         eta_pos_preshared_key_enc = CASE
           WHEN pos_terminal.eta_device_serial IS NOT @etaDeviceSerial THEN NULL
           ELSE pos_terminal.eta_pos_preshared_key_enc END,
         eta_device_serial = @etaDeviceSerial, eta_pos_client_id = @etaPosClientId,
         eta_pos_os_version = @etaPosOsVersion, eta_pos_model_framework = @etaPosModelFramework, active = @active`,
    );
  }

  async list(): Promise<readonly PosTerminal[]> {
    return (this.sqlite.prepare(`SELECT * FROM pos_terminal ORDER BY code ASC`).all() as TerminalRow[]).map(toTerminal);
  }

  async findById(id: string): Promise<PosTerminal | null> {
    const row = this.sqlite.prepare(`SELECT * FROM pos_terminal WHERE id = ?`).get(id) as TerminalRow | undefined;
    return row ? toTerminal(row) : null;
  }

  async findByCode(code: string): Promise<PosTerminal | null> {
    const row = this.sqlite.prepare(`SELECT * FROM pos_terminal WHERE code = ?`).get(code) as TerminalRow | undefined;
    return row ? toTerminal(row) : null;
  }

  async save(terminal: PosTerminal): Promise<void> {
    this.upsert.run({
      id: terminal.id,
      code: terminal.code,
      name: terminal.name,
      nameEn: terminal.nameEn,
      kind: terminal.kind,
      branchId: terminal.branchId,
      warehouseId: terminal.warehouseId,
      drawerTreasuryAccountId: terminal.drawerTreasuryAccountId,
      methodsJson: JSON.stringify(terminal.methods),
      defaultMethodId: terminal.defaultMethodId,
      printerKind: terminal.printer.kind,
      printerAddress: terminal.printer.address,
      paperWidthMm: terminal.printer.paperWidthMm,
      etaDeviceSerial: terminal.etaDeviceSerial,
      etaPosClientId: terminal.etaPosClientId,
      etaPosOsVersion: terminal.etaPosOsVersion,
      etaPosModelFramework: terminal.etaPosModelFramework,
      active: terminal.active ? 1 : 0,
    });
  }

  async setEtaPosClientSecret(terminalId: string, secret: string): Promise<void> {
    this.sqlite.prepare(`UPDATE pos_terminal SET eta_pos_client_secret_enc = ? WHERE id = ?`).run(seal(secret), terminalId);
  }

  async setEtaPosPresharedKey(terminalId: string, key: string): Promise<void> {
    this.sqlite.prepare(`UPDATE pos_terminal SET eta_pos_preshared_key_enc = ? WHERE id = ?`).run(seal(key), terminalId);
  }

  async readEtaDeviceSecrets(terminalId: string): Promise<{ clientSecret: string | null; presharedKey: string | null }> {
    const row = this.sqlite
      .prepare(`SELECT eta_pos_client_secret_enc AS secret, eta_pos_preshared_key_enc AS psk FROM pos_terminal WHERE id = ?`)
      .get(terminalId) as { secret: string | null; psk: string | null } | undefined;
    return {
      clientSecret: row?.secret ? unseal(row.secret) : null,
      presharedKey: row?.psk ? unseal(row.psk) : null,
    };
  }

  async nextReceiptSeq(terminalId: string): Promise<number> {
    const row = this.sqlite
      .prepare(`UPDATE pos_terminal SET last_receipt_seq = last_receipt_seq + 1 WHERE id = ? RETURNING last_receipt_seq AS seq`)
      .get(terminalId) as { seq: number } | undefined;
    if (!row) throw new Error(`POS terminal ${terminalId} not found`);
    return row.seq;
  }
}

class SqlitePosSettingsStore implements PosSettingsRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async get(): Promise<PosSettings> {
    const row = this.sqlite.prepare(`SELECT * FROM pos_settings WHERE id = ?`).get(SETTINGS_ROW_ID) as SettingsRow | undefined;
    if (!row) return defaultPosSettings();
    return {
      receiptScreenSeconds: row.receipt_screen_seconds,
      allowArCollection: row.allow_ar_collection === 1,
      cashierDiscountLimit: { percentBp: row.cashier_discount_percent_bp, amount: Money.fromScaled(row.cashier_discount_amount) },
      managerDiscountLimit: { percentBp: row.manager_discount_percent_bp, amount: Money.fromScaled(row.manager_discount_amount) },
      approvalExpiryMinutes: row.approval_expiry_minutes,
      walkInCustomerId: row.walk_in_customer_id,
      pricesIncludeTax: row.prices_include_tax === 1,
      mealSections: JSON.parse(row.meal_sections_json) as PosSettings["mealSections"],
    };
  }

  async save(settings: PosSettings): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO pos_settings (id, receipt_screen_seconds, allow_ar_collection, cashier_discount_percent_bp,
           cashier_discount_amount, manager_discount_percent_bp, manager_discount_amount, approval_expiry_minutes,
           walk_in_customer_id, prices_include_tax, meal_sections_json)
         VALUES (@id, @receiptScreenSeconds, @allowArCollection, @cashierBp, @cashierAmount, @managerBp, @managerAmount,
           @approvalExpiryMinutes, @walkInCustomerId, @pricesIncludeTax, @mealSectionsJson)
         ON CONFLICT(id) DO UPDATE SET
           receipt_screen_seconds = @receiptScreenSeconds, allow_ar_collection = @allowArCollection,
           cashier_discount_percent_bp = @cashierBp, cashier_discount_amount = @cashierAmount,
           manager_discount_percent_bp = @managerBp, manager_discount_amount = @managerAmount,
           approval_expiry_minutes = @approvalExpiryMinutes, walk_in_customer_id = @walkInCustomerId,
           prices_include_tax = @pricesIncludeTax, meal_sections_json = @mealSectionsJson`,
      )
      .run({
        id: SETTINGS_ROW_ID,
        receiptScreenSeconds: settings.receiptScreenSeconds,
        allowArCollection: settings.allowArCollection ? 1 : 0,
        cashierBp: settings.cashierDiscountLimit.percentBp,
        cashierAmount: settings.cashierDiscountLimit.amount.toScaledNumber(),
        managerBp: settings.managerDiscountLimit.percentBp,
        managerAmount: settings.managerDiscountLimit.amount.toScaledNumber(),
        approvalExpiryMinutes: settings.approvalExpiryMinutes,
        walkInCustomerId: settings.walkInCustomerId,
        pricesIncludeTax: settings.pricesIncludeTax ? 1 : 0,
        mealSectionsJson: JSON.stringify(settings.mealSections),
      });
  }
}

class SqliteShiftTemplateStore implements ShiftTemplateRepository {
  constructor(private readonly sqlite: Database.Database) {}

  async list(): Promise<readonly ShiftTemplate[]> {
    return (this.sqlite.prepare(`SELECT * FROM shift_template ORDER BY from_time ASC, name_ar ASC`).all() as ShiftTemplateRow[]).map(
      toShiftTemplate,
    );
  }

  async findById(id: string): Promise<ShiftTemplate | null> {
    const row = this.sqlite.prepare(`SELECT * FROM shift_template WHERE id = ?`).get(id) as ShiftTemplateRow | undefined;
    return row ? toShiftTemplate(row) : null;
  }

  async save(template: ShiftTemplate): Promise<void> {
    this.sqlite
      .prepare(
        `INSERT INTO shift_template (id, name_ar, name_en, from_time, to_time, branch_id, active)
         VALUES (@id, @nameAr, @nameEn, @fromTime, @toTime, @branchId, @active)
         ON CONFLICT(id) DO UPDATE SET name_ar = @nameAr, name_en = @nameEn, from_time = @fromTime,
           to_time = @toTime, branch_id = @branchId, active = @active`,
      )
      .run({ ...template, active: template.active ? 1 : 0 });
  }
}

export interface SqlitePosStoreHandle {
  readonly terminals: PosTerminalRepository;
  readonly paymentMethods: PosPaymentMethodRepository;
  readonly settings: PosSettingsRepository;
  readonly shiftTemplates: ShiftTemplateRepository;
  close(): void;
}

/** POS master data — terminals, payment methods, POS settings and shift templates. */
export function createSqlitePosStore(path: SqliteConnectionInput = ":memory:"): SqlitePosStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    terminals: new SqlitePosTerminalStore(sqlite),
    paymentMethods: new SqlitePosPaymentMethodStore(sqlite),
    settings: new SqlitePosSettingsStore(sqlite),
    shiftTemplates: new SqliteShiftTemplateStore(sqlite),
    close: () => {
      if (owned) sqlite.close();
    },
  };
}
