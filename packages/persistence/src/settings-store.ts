import type Database from "better-sqlite3";
import type { SqlDb } from "./sql/sql-db.js";
import { sqliteDb } from "./sql/sqlite-db.js";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { DEFAULT_SETTINGS } from "@mezan/domain";
import type { SettingsRepository, TenantSettings } from "@mezan/domain";
import { isSealedSecret, SecretUnsealError, type SecretBox } from "./secret-box.js";

const SMTP_PASSWORD_CONTEXT = "tenant_settings:smtp_password";

const UNRENDERED_EMAIL_TEMPLATE_SUBJECT = "{{documentType}} رقم {{documentNumber}} من {{companyName}}";
const UNRENDERED_EMAIL_TEMPLATE_BODY =
  "السلام عليكم {{recipientName}}،\n\nمرفق {{documentType}} رقم {{documentNumber}} بتاريخ {{documentDate}} بإجمالي {{documentTotal}}.\n\nمع خالص الشكر،\n{{companyName}}";

/**
 * SQL-backed SettingsRepository.
 *
 * The config bag is ~30 typed fields at the domain layer (see
 * packages/domain/src/settings/settings.ts), but there is exactly one row of
 * it per tenant and it changes as a whole via `updateSettings`'s merge — so
 * storage is a single JSON-text column keyed by a fixed row id, matching the
 * "spike pattern" of a self-contained store with its own connection (see
 * sequence-store.ts / audit-sink.ts). The domain never sees JSON; only this
 * store serializes/deserializes it.
 */

export const SETTINGS_ROW_ID = "default";

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS tenant_settings (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

class SqlSettingsStore implements SettingsRepository {
  constructor(
    private readonly db: SqlDb,
    private readonly secrets?: SecretBox,
  ) {}

  private async storedData(): Promise<string | undefined> {
    return (await this.db.get<{ data: string }>(`SELECT data FROM tenant_settings WHERE id = ?`, [SETTINGS_ROW_ID]))?.data;
  }

  async get(): Promise<TenantSettings | null> {
    const data = await this.storedData();
    if (data === undefined) return null;
    // A row written before a field existed would otherwise hand the domain an
    // `undefined` that validation reads as invalid, so the stored bag is always
    // layered on top of the current defaults.
    const stored = JSON.parse(data) as Partial<TenantSettings>;
    // The period-close control used to read the contracting switch: a row saved before it had a setting of its own keeps the behaviour it had.
    const periodCloseSingleOperatorMode = stored.periodCloseSingleOperatorMode ?? stored.contractingSingleOperatorMode ?? DEFAULT_SETTINGS.periodCloseSingleOperatorMode;
    // The template defaults shipped before #129 named fields no mail supplies and nothing rendered them: a row still holding them untouched reads the statement default.
    const emailTemplateSubject = stored.emailTemplateSubject === UNRENDERED_EMAIL_TEMPLATE_SUBJECT ? DEFAULT_SETTINGS.emailTemplateSubject : stored.emailTemplateSubject ?? DEFAULT_SETTINGS.emailTemplateSubject;
    const emailTemplateBody = stored.emailTemplateBody === UNRENDERED_EMAIL_TEMPLATE_BODY ? DEFAULT_SETTINGS.emailTemplateBody : stored.emailTemplateBody ?? DEFAULT_SETTINGS.emailTemplateBody;
    return { ...DEFAULT_SETTINGS, ...stored, periodCloseSingleOperatorMode, emailTemplateSubject, emailTemplateBody, smtpPassword: this.openPassword(stored.smtpPassword) } as TenantSettings;
  }

  // SECURITY: a password this process cannot open — sealed on the cloud and carried to a desktop, or
  // sealed under a key since replaced — reads as unset, so it is typed again rather than sent as ciphertext.
  private openPassword(stored: string | undefined): string {
    if (stored === undefined) return DEFAULT_SETTINGS.smtpPassword;
    if (!isSealedSecret(stored)) return stored;
    if (!this.secrets) return "";
    try {
      return this.secrets.open(stored, SMTP_PASSWORD_CONTEXT);
    } catch (err) {
      if (err instanceof SecretUnsealError) return "";
      throw err;
    }
  }

  private sealPassword(plain: string): string {
    return this.secrets && plain !== "" ? this.secrets.seal(plain, SMTP_PASSWORD_CONTEXT) : plain;
  }

  /** Seals a password written before sealing existed; a no-op without a key or with nothing plaintext. */
  async sealStoredPassword(): Promise<void> {
    if (!this.secrets) return;
    const data = await this.storedData();
    if (data === undefined) return;
    const stored = JSON.parse(data) as Partial<TenantSettings>;
    if (!stored.smtpPassword || isSealedSecret(stored.smtpPassword)) return;
    // Only if the row is still the one read: a save from another process in between already sealed it.
    await this.db.run(`UPDATE tenant_settings SET data = ?, updated_at = ? WHERE id = ? AND data = ?`, [
      JSON.stringify({ ...stored, smtpPassword: this.sealPassword(stored.smtpPassword) }),
      new Date().toISOString(),
      SETTINGS_ROW_ID,
      data,
    ]);
  }

  async save(settings: TenantSettings): Promise<void> {
    await this.db.run(
      `INSERT INTO tenant_settings (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [SETTINGS_ROW_ID, JSON.stringify({ ...settings, smtpPassword: this.sealPassword(settings.smtpPassword) }), new Date().toISOString()],
    );
  }
}

export interface SqliteSettingsStoreHandle extends SettingsRepository {
  close(): void;
}

export async function ensureSettingsSchema(db: SqlDb): Promise<void> {
  await db.applySchema(CREATE_TABLE);
}

export async function createSettingsStore(db: SqlDb, secrets?: SecretBox): Promise<SettingsRepository> {
  const store = new SqlSettingsStore(db, secrets);
  await store.sealStoredPassword();
  return store;
}

/** Open a SQLite-backed SettingsRepository. ":memory:" for tests, a path for real. */
export function createSqliteSettingsStore(path: SqliteConnectionInput = ":memory:", secrets?: SecretBox): SqliteSettingsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  sealStoredPasswordNow(sqlite, secrets);
  return Object.assign(new SqlSettingsStore(sqliteDb(sqlite), secrets), {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSettingsStoreHandle;
}

function sealStoredPasswordNow(sqlite: Database.Database, secrets: SecretBox | undefined): void {
  if (!secrets) return;
  const row = sqlite.prepare(`SELECT data FROM tenant_settings WHERE id = ?`).get(SETTINGS_ROW_ID) as { data: string } | undefined;
  if (!row) return;
  const stored = JSON.parse(row.data) as Partial<TenantSettings>;
  if (!stored.smtpPassword || isSealedSecret(stored.smtpPassword)) return;
  sqlite
    .prepare(`UPDATE tenant_settings SET data = ?, updated_at = ? WHERE id = ? AND data = ?`)
    .run(JSON.stringify({ ...stored, smtpPassword: secrets.seal(stored.smtpPassword, SMTP_PASSWORD_CONTEXT) }), new Date().toISOString(), SETTINGS_ROW_ID, row.data);
}
