import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import CipherDatabase from "better-sqlite3-multiple-ciphers";
import type { SqliteDriver } from "@mezan/persistence";

/**
 * Encryption at rest for the tenant database.
 *
 * WHAT THIS FIXES. `mezan.db` was a plain SQLite file, and everything the
 * product knows is in it: the customer list, every purchase price, every
 * salary, every posted journal entry. A stolen laptop, a copied file, a
 * borrowed USB stick with the backups folder on it — each of those was the
 * whole set of books in readable form, with no credential of any kind in the
 * way. The login password guards the application; it never guarded the file.
 *
 * The database is now encrypted by SQLite3MultipleCiphers (chacha20-poly1305)
 * under a 32-byte random key sealed to the OS user account by Electron's
 * `safeStorage` — the platform keychain on macOS, DPAPI on Windows,
 * libsecret/kwallet on Linux. Nothing here ever writes the key in the clear
 * except the ONE escrow card described under `writeKeyCard` below, which the
 * owner is told to move off the machine and delete.
 *
 * Deliberately free of any `electron` import (like main/lan-host.ts and
 * main/recovery.ts): `safeStorage` arrives as the `TenantKeyStore` seam below,
 * so every branch in this module — first key, migration, interrupted
 * migration, missing keyring — is exercisable headlessly in vitest.
 */

/** The sealed key blob, beside the database it opens. */
const KEY_FILE_NAME = "mezan.key";

/** The one-time plaintext escrow card. See `writeKeyCard`. */
const KEY_CARD_FILE_NAME = "database-key.txt";

/** Owner read/write only — both files are the database in another form. */
const OWNER_ONLY = 0o600;

/** Every SQLite file ever written starts with this. Nothing encrypted does. */
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

/** The half-converted file the migration below stages into. */
const STAGING_SUFFIX = ".encrypting";

/** 32 bytes, lowercase hex — what `randomBytes(32).toString("hex")` produces. */
const RAW_KEY_RE = /^[0-9a-f]{64}$/;

/**
 * Every `PRAGMA key`/`rekey` in this module interpolates the key, because
 * better-sqlite3 has no parameter binding for a PRAGMA value. This is what
 * makes that safe, and it is checked on the way OUT of the key store too — an
 * unsealed blob is only as trustworthy as the file it came from.
 */
function keyLiteral(key: string): string {
  if (!RAW_KEY_RE.test(key)) {
    throw new Error("Database encryption key must be 32 bytes of lowercase hex.");
  }
  return `"x'${key}'"`;
}

export function tenantKeyFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), KEY_FILE_NAME);
}

export function keyCardFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), KEY_CARD_FILE_NAME);
}

/**
 * The shape of Electron's `safeStorage` this module needs, and nothing more.
 * Injected rather than imported so the module stays headless-testable.
 */
export interface TenantKeyStore {
  isAvailable(): boolean;
  seal(plain: string): Buffer;
  unseal(sealed: Buffer): string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(sealed: Buffer): string;
}

export function electronSafeStorageKeyStore(safeStorage: SafeStorageLike): TenantKeyStore {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    seal: (plain) => safeStorage.encryptString(plain),
    unseal: (sealed) => safeStorage.decryptString(sealed),
  };
}

/**
 * Thrown when the OS has no keyring to seal the database key to.
 *
 * Some Linux desktops ship without libsecret/kwallet, and `safeStorage` then
 * refuses to encrypt anything. The two honest answers are "do not start" and
 * "start unencrypted, loudly" — the one answer this must never give is a key
 * file written in plaintext, because that is the encryption reading as done
 * while protecting nothing. The default is REFUSE: an install that cannot
 * keep the promise says so instead of quietly not keeping it. The operator
 * can override with `--allow-unencrypted-database`, which is a decision
 * somebody typed, printed in the log, and recorded next to the database.
 */
export class KeyringUnavailableError extends Error {
  constructor() {
    super(
      "The operating system has no keyring available, so the database encryption key cannot be sealed. " +
        "Install a keyring (gnome-keyring / kwallet), or start with --allow-unencrypted-database to run without encryption at rest.",
    );
    this.name = "KeyringUnavailableError";
  }
}

/** Thrown when a key exists but no longer opens the database it belongs to. */
export class DatabaseKeyMismatchError extends Error {
  constructor(readonly dbPath: string, cause: unknown) {
    super(
      `The stored key does not open ${dbPath}. The database was encrypted on a different machine or user account, ` +
        "or the sealed key file was replaced.",
      { cause },
    );
    this.name = "DatabaseKeyMismatchError";
  }
}

/**
 * The driver the desktop edition opens the tenant database with.
 *
 * A structurally identical fork of the `better-sqlite3` this repo already
 * runs — same major version, same synchronous API — that adds `PRAGMA key`.
 * The cast is the one place the two nominal types meet; every store in
 * @mezan/persistence is written against better-sqlite3's declarations and the
 * fork ships its own copy of them under a different namespace.
 */
export const cipherDriver = CipherDatabase as unknown as SqliteDriver;

/**
 * Everything needed to open this install's tenant database, and the ONE value
 * that must reach every connection to it: `createBackend`, the dedicated backup
 * handle, and the restore verifier. Structurally a `SqliteOpenOptions` and a
 * `RestoreCipher`, with both fields required — an optional key is exactly the
 * shape that lets one call site quietly open the file unkeyed.
 */
export interface TenantCipher {
  readonly driver: SqliteDriver;
  readonly key: string;
}

export type DatabaseFileState = "absent" | "plaintext" | "encrypted";

/**
 * Reads the first sixteen bytes and nothing else. A file too short to carry a
 * header is treated as absent: SQLite leaves a zero-length file behind when a
 * previous launch died between `open()` and its first write, and that file is
 * about to be initialised as an encrypted database either way.
 */
export async function readDatabaseFileState(dbPath: string): Promise<DatabaseFileState> {
  let handle;
  try {
    handle = await open(dbPath, "r");
  } catch {
    return "absent";
  }
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, SQLITE_HEADER.length, 0);
    if (bytesRead < SQLITE_HEADER.length) return "absent";
    return buffer.equals(SQLITE_HEADER) ? "plaintext" : "encrypted";
  } finally {
    await handle.close();
  }
}

async function writeOwnerOnly(target: string, body: string | Buffer): Promise<void> {
  await writeFile(target, body, { mode: OWNER_ONLY });
  // A separate step, because `writeFile`'s `mode` only applies when the file is
  // CREATED — rewriting an existing world-readable key file would otherwise
  // keep the old permissions (main/recovery.ts learned this first).
  await chmod(target, OWNER_ONLY).catch(() => undefined);
}

export interface ResolvedTenantKey {
  readonly key: string;
  /** True when this call minted the key, i.e. nothing had encrypted this install yet. */
  readonly created: boolean;
}

/**
 * Loads the sealed key, or mints one and seals it.
 *
 * 32 bytes from `randomBytes`, hex-encoded, handed to `PRAGMA key` as raw key
 * material — not as a passphrase, so no KDF stands between launch and the first
 * query, and the key has full entropy rather than whatever a human would type.
 */
export async function loadOrCreateTenantKey(params: {
  dbPath: string;
  keyStore: TenantKeyStore;
}): Promise<ResolvedTenantKey> {
  const { dbPath, keyStore } = params;
  if (!keyStore.isAvailable()) throw new KeyringUnavailableError();

  const keyFile = tenantKeyFilePath(dbPath);
  const sealed = await readFile(keyFile).catch(() => null);
  if (sealed) {
    const key = keyStore.unseal(sealed);
    keyLiteral(key);
    return { key, created: false };
  }

  const key = randomBytes(32).toString("hex");
  await mkdir(path.dirname(keyFile), { recursive: true });
  await writeOwnerOnly(keyFile, keyStore.seal(key));
  return { key, created: true };
}

/**
 * The one plaintext copy of the key that exists anywhere, and why it exists.
 *
 * The sealed key is bound to this OS user account on this machine. That is the
 * point — it is what makes a stolen disk useless — and it is also what makes
 * every backup archive useless the day the machine dies, because the archives
 * are encrypted with the same key (see backup/backup-service.ts). A backup
 * system that cannot survive the hardware it was protecting against is not a
 * backup system, and main/recovery.ts already names that exact scenario ("a
 * backup restored onto replacement hardware").
 *
 * So the key is written once, in the clear, where a human can copy it down —
 * the same trade main/recovery.ts makes for the first-run admin password, with the
 * same owner-only permissions and the same instruction to move it off the
 * machine and delete it. Callers warn on every launch while the card is still
 * there. `--export-database-key` writes it again for an owner who lost it.
 */
export async function writeKeyCard(dbPath: string, key: string): Promise<string> {
  const target = keyCardFilePath(dbPath);
  await writeOwnerOnly(target, keyCardBody(key));
  return target;
}

/** The same card, written where the owner chose — «حماية النسخ الاحتياطية»'s key-card route. */
export async function writeKeyCardTo(target: string, key: string): Promise<string> {
  keyLiteral(key);
  await writeOwnerOnly(target, keyCardBody(key));
  return target;
}

function keyCardBody(key: string): string {
  return [
    "============================================================",
    "مزان — مفتاح تشفير قاعدة البيانات",
    "Mezan — database encryption key",
    "============================================================",
    "",
    `المفتاح / Key:  ${key}`,
    "",
    "------------------------------------------------------------",
    "بالعربية",
    "------------------------------------------------------------",
    "قاعدة بيانات مزان على هذا الجهاز مشفّرة، والنسخ الاحتياطية كذلك.",
    "هذا المفتاح هو الطريقة الوحيدة لفتحها على جهاز آخر — إذا تعطّل",
    "هذا الجهاز ولم يكن لديك المفتاح، فلن تُفتح أي نسخة احتياطية أبداً.",
    "",
    "انسخ المفتاح إلى مكان آمن خارج هذا الجهاز (دفتر، خزنة، مدير كلمات",
    "مرور)، ثم احذف هذا الملف.",
    "",
    "من يملك هذا الملف ونسخة احتياطية واحدة يستطيع قراءة كل دفاترك:",
    "العملاء والأسعار والمرتبات. لا تتركه على الجهاز ولا ترسله في رسالة.",
    "",
    "على جهاز جديد: افتح «استعادة نسخة قابلة للنقل» واختر ملف النسخة",
    "(.mezanbak.enc) من المجلد الثاني للنسخ، ثم اكتب هذا المفتاح في خانة",
    "كلمة السر.",
    "",
    "------------------------------------------------------------",
    "In English",
    "------------------------------------------------------------",
    "This machine's Mezan database is encrypted, and so is every backup",
    "archive it writes. This key is the ONLY way to open either of them on",
    "different hardware — if this machine dies and you do not have the key,",
    "no backup will ever open again.",
    "",
    "Copy the key somewhere safe OFF this machine (a notebook, a safe, a",
    "password manager), then delete this file.",
    "",
    "Anyone holding this file and one backup archive can read your entire",
    "books — customers, prices, salaries. Do not leave it on the machine and",
    "do not send it in a message.",
    "",
    "On a new computer: open «استعادة نسخة قابلة للنقل», pick the copy",
    "(.mezanbak.enc) from the second backup folder, and type this key as",
    "the passphrase.",
    "============================================================",
    "",
  ].join("\n");
}

/** True when the process was started with `--allow-unencrypted-database`. */
export function wantsUnencryptedDatabase(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--allow-unencrypted-database");
}

/** True when the process was started with `--export-database-key`. */
export function wantsKeyExport(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--export-database-key");
}

/** Doubles single quotes: SQLite has no parameter binding for a file name in `VACUUM INTO`. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface EncryptMigrationResult {
  /** Archive written before a byte of the plaintext database was touched. */
  readonly backupArchivePath: string | null;
  readonly rowCounts: Record<string, number>;
}

function countRows(sqlite: Database.Database): Record<string, number> {
  const tables = sqlite
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all();
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = sqlite.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`).get();
    counts[name] = row?.n ?? 0;
  }
  return counts;
}

/**
 * Converts an existing plaintext `mezan.db` in place, crash-safely.
 *
 * Real machines already hold a plaintext database, and the first launch after
 * this ships is the only chance to fix that. The sequence exists to make every
 * interruption survivable:
 *
 *   1. Back up the plaintext database FIRST, through the verified backup path
 *      (checksum + integrity_check + staged write) the caller injects. If that
 *      throws, nothing else happens — the conversion is not worth one install's
 *      books.
 *   2. `VACUUM INTO` a `.encrypting` staging sibling. This folds the WAL in and
 *      takes a transactionally consistent copy; a raw `copyFile` would leave
 *      any un-checkpointed committed pages behind.
 *   3. `PRAGMA rekey` the staging file. `.backup()` is not an option: the
 *      SQLite Online Backup API opens its target unkeyed and the fork refuses
 *      the transfer ("incompatible source and target databases") rather than
 *      quietly writing a plaintext copy.
 *   4. Reopen the staging file WITH the key and prove it: header is not
 *      SQLite's, `integrity_check` is ok, and every table still holds the row
 *      count the plaintext original had.
 *   5. Delete the plaintext WAL/SHM siblings, then rename staging over the
 *      original. The rename is the ONLY destructive step and it is atomic, so
 *      the live path holds either the untouched original or the finished
 *      encrypted database — never a half-converted file.
 *
 * Interrupted anywhere before step 5, the next launch still sees a plaintext
 * database, deletes the stale staging file and starts again. Interrupted after
 * it, the next launch sees an encrypted database and does nothing. Both are the
 * same call.
 */
export async function encryptPlaintextDatabase(params: {
  dbPath: string;
  key: string;
  driver?: SqliteDriver;
  backupFirst?: (sqlite: Database.Database) => Promise<string>;
}): Promise<EncryptMigrationResult> {
  const { dbPath, key, driver = cipherDriver, backupFirst } = params;
  const staging = `${dbPath}${STAGING_SUFFIX}`;

  // Whatever a previous, interrupted attempt left behind is worthless — it was
  // never verified and never renamed. Removing it is what makes this idempotent.
  await rm(staging, { force: true });
  await rm(`${staging}-wal`, { force: true });
  await rm(`${staging}-shm`, { force: true });

  let backupArchivePath: string | null = null;
  let rowCounts: Record<string, number>;

  const source = new driver(dbPath);
  try {
    source.pragma("busy_timeout = 5000");
    if (backupFirst) backupArchivePath = await backupFirst(source);
    rowCounts = countRows(source);
    source.exec(`VACUUM INTO ${sqlStringLiteral(staging)}`);
  } finally {
    source.close();
  }

  const target = new driver(staging);
  try {
    target.pragma(`rekey = ${keyLiteral(key)}`);
  } finally {
    target.close();
  }

  await assertEncryptedAndComplete({ filePath: staging, key, driver, rowCounts });

  // The old plaintext WAL cannot survive the rename: SQLite would read it as
  // the encrypted database's journal and corrupt what it recovered. Both
  // siblings are already redundant — `VACUUM INTO` copied their contents.
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  await rename(staging, dbPath);

  return { backupArchivePath, rowCounts };
}

/**
 * The property the whole change exists for, asserted at runtime and not only in
 * a test: the file is unreadable without the key, and nothing was lost getting
 * there. Runs before the rename, so a failure leaves the original in place.
 */
async function assertEncryptedAndComplete(params: {
  filePath: string;
  key: string;
  driver: SqliteDriver;
  rowCounts: Record<string, number>;
}): Promise<void> {
  const { filePath, key, driver, rowCounts } = params;

  if ((await readDatabaseFileState(filePath)) !== "encrypted") {
    await rm(filePath, { force: true });
    throw new Error(`Encryption produced a readable SQLite file at ${filePath} — refusing to install it.`);
  }

  const verify = new driver(filePath, { readonly: true });
  try {
    verify.pragma(`key = ${keyLiteral(key)}`);
    const integrity = verify.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const report = integrity.map((r) => r.integrity_check).join("; ");
    if (report !== "ok") throw new Error(`integrity_check on the encrypted copy returned: ${report}`);

    const after = countRows(verify);
    for (const [table, expected] of Object.entries(rowCounts)) {
      if (after[table] !== expected) {
        throw new Error(
          `encrypted copy lost rows in "${table}": ${expected} before, ${after[table] ?? "table missing"} after`,
        );
      }
    }
  } catch (err) {
    verify.close();
    await rm(filePath, { force: true });
    throw err;
  }
  verify.close();
}

export interface OpenedTenantDatabase {
  /** Hand straight to `createBackend({ connection })` and to `openTenantConnection`. */
  readonly connection: TenantCipher;
  /** True when this launch converted a plaintext database. */
  readonly converted: boolean;
  /** Set when the conversion ran, so the caller can tell the operator where the safety copy is. */
  readonly backupArchivePath: string | null;
  /** Set when this launch minted the key and wrote the escrow card. */
  readonly keyCardPath: string | null;
  /** True while a plaintext escrow card is still sitting beside the database. */
  readonly keyCardPresent: boolean;
}

/**
 * The one call apps/desktop makes before anything opens the database.
 *
 * Returns the driver + key every other connection to this file must use — the
 * backend's, the backup connection's, the restore verifier's. Passing a key to
 * one and not another does not degrade gracefully: the unkeyed one throws
 * "file is not a database", which is the failure mode to prefer over a
 * plaintext write, but it is still a failure.
 */
export async function openEncryptedTenantDatabase(params: {
  dbPath: string;
  keyStore: TenantKeyStore;
  driver?: SqliteDriver;
  backupFirst?: (sqlite: Database.Database) => Promise<string>;
  exportKeyCard?: boolean;
}): Promise<OpenedTenantDatabase> {
  const { dbPath, keyStore, driver = cipherDriver, backupFirst, exportKeyCard = false } = params;

  const { key, created } = await loadOrCreateTenantKey({ dbPath, keyStore });

  const state = await readDatabaseFileState(dbPath);
  let converted = false;
  let backupArchivePath: string | null = null;
  if (state === "plaintext") {
    ({ backupArchivePath } = await encryptPlaintextDatabase({ dbPath, key, driver, backupFirst }));
    converted = true;
  } else {
    // Nothing to convert, but a stale staging file from an attempt that died
    // after the rename is still worth clearing — it is a full copy of the books.
    await rm(`${dbPath}${STAGING_SUFFIX}`, { force: true });
  }

  let keyCardPath: string | null = null;
  if (created || exportKeyCard) keyCardPath = await writeKeyCard(dbPath, key);

  const keyCardPresent =
    keyCardPath !== null || (await readFile(keyCardFilePath(dbPath)).then(() => true, () => false));

  if (state === "encrypted") await assertKeyOpens(dbPath, key, driver);

  return { connection: { driver, key }, converted, backupArchivePath, keyCardPath, keyCardPresent };
}

/**
 * Fails fast with a diagnosis instead of letting `createBackend` throw "file is
 * not a database" thirty stores deep, where it reads as a corrupt file rather
 * than as the wrong key.
 */
async function assertKeyOpens(dbPath: string, key: string, driver: SqliteDriver): Promise<void> {
  let probe: Database.Database | undefined;
  try {
    probe = new driver(dbPath, { readonly: true });
    probe.pragma(`key = ${keyLiteral(key)}`);
    probe.prepare("SELECT count(*) FROM sqlite_master").get();
  } catch (err) {
    throw new DatabaseKeyMismatchError(dbPath, err);
  } finally {
    probe?.close();
  }
}

/**
 * Opens a standalone connection to the tenant database with the same driver and
 * key the backend uses — the dedicated handle main/index.ts holds for backups.
 */
export function openTenantConnection(dbPath: string, connection: TenantCipher): Database.Database {
  const sqlite = new connection.driver(dbPath);
  sqlite.pragma(`key = ${keyLiteral(connection.key)}`);
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}
