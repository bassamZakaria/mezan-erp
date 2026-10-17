import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import { DEFAULT_SETTINGS } from "@mezan/domain";
import type { SettingsRepository, TenantSettings } from "@mezan/domain";
import { isSealedSecret, SecretUnsealError, type SecretBox } from "./secret-box.js";

const SMTP_PASSWORD_CONTEXT = "tenant_settings:smtp_password";

/**
 * SQLite-backed SettingsRepository.
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

class SqliteSettingsStore implements SettingsRepository {
  private readonly upsert: Database.Statement;
  private readonly select: Database.Statement;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly secrets?: SecretBox,
  ) {
    this.upsert = sqlite.prepare(
      `INSERT INTO tenant_settings (id, data, updated_at) VALUES (@id, @data, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET data = @data, updated_at = @updatedAt`,
    );
    this.select = sqlite.prepare(`SELECT data FROM tenant_settings WHERE id = ?`);
  }

  async get(): Promise<TenantSettings | null> {
    const row = this.select.get(SETTINGS_ROW_ID) as { data: string } | undefined;
    if (!row) return null;
    // A row written before a field existed would otherwise hand the domain an
    // `undefined` that validation reads as invalid, so the stored bag is always
    // layered on top of the current defaults.
    const stored = JSON.parse(row.data) as Partial<TenantSettings>;
    // The period-close control used to read the contracting switch: a row saved before it had a setting of its own keeps the behaviour it had.
    const periodCloseSingleOperatorMode = stored.periodCloseSingleOperatorMode ?? stored.contractingSingleOperatorMode ?? DEFAULT_SETTINGS.periodCloseSingleOperatorMode;
    return { ...DEFAULT_SETTINGS, ...stored, periodCloseSingleOperatorMode, smtpPassword: this.openPassword(stored.smtpPassword) } as TenantSettings;
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
  sealStoredPassword(): void {
    if (!this.secrets) return;
    const row = this.select.get(SETTINGS_ROW_ID) as { data: string } | undefined;
    if (!row) return;
    const stored = JSON.parse(row.data) as Partial<TenantSettings>;
    if (!stored.smtpPassword || isSealedSecret(stored.smtpPassword)) return;
    // Only if the row is still the one read: a save from another process in between already sealed it.
    this.sqlite
      .prepare(`UPDATE tenant_settings SET data = ?, updated_at = ? WHERE id = ? AND data = ?`)
      .run(JSON.stringify({ ...stored, smtpPassword: this.sealPassword(stored.smtpPassword) }), new Date().toISOString(), SETTINGS_ROW_ID, row.data);
  }

  private write(data: Partial<TenantSettings>): void {
    this.upsert.run({ id: SETTINGS_ROW_ID, data: JSON.stringify(data), updatedAt: new Date().toISOString() });
  }

  async save(settings: TenantSettings): Promise<void> {
    this.write({ ...settings, smtpPassword: this.sealPassword(settings.smtpPassword) });
  }
}

export interface SqliteSettingsStoreHandle extends SettingsRepository {
  close(): void;
}

/** Open a SQLite-backed SettingsRepository. ":memory:" for tests, a path for real. */
export function createSqliteSettingsStore(path: SqliteConnectionInput = ":memory:", secrets?: SecretBox): SqliteSettingsStoreHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLE);
  const store = new SqliteSettingsStore(sqlite, secrets);
  store.sealStoredPassword();
  return Object.assign(store, {
    close: () => { if (owned) sqlite.close(); },
  }) as SqliteSettingsStoreHandle;
}
