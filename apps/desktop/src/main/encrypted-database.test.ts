import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import PlainDatabase from "better-sqlite3";
import { openSqliteConnection } from "@mezan/persistence";
import {
  DatabaseKeyMismatchError,
  KeyringUnavailableError,
  cipherDriver,
  electronSafeStorageKeyStore,
  encryptPlaintextDatabase,
  keyCardFilePath,
  loadOrCreateTenantKey,
  openEncryptedTenantDatabase,
  openTenantConnection,
  readDatabaseFileState,
  tenantKeyFilePath,
  wantsKeyExport,
  wantsUnencryptedDatabase,
  type TenantKeyStore,
} from "./encrypted-database.js";

/**
 * The property under test is not "the code runs" — it is that the bytes on disk
 * stop being the company's books. Every assertion here reads the real file or
 * opens it with the real plain driver; none of them trusts a flag.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-crypto-"));
  dirs.push(dir);
  return dir;
}

/**
 * A stand-in for Electron's `safeStorage`. XOR is emphatically NOT the sealing
 * this ships with — it exists so the test can assert "the key file is not the
 * key" without a keychain prompt on the machine running CI.
 */
function fakeKeyStore(available = true): TenantKeyStore {
  const mask = Buffer.from("mezan-test-seal");
  const xor = (buf: Buffer): Buffer =>
    Buffer.from(buf.map((byte, i) => byte ^ (mask[i % mask.length] ?? 0)));
  return {
    isAvailable: () => available,
    seal: (plain) => xor(Buffer.from(plain, "utf8")),
    unseal: (sealed) => xor(Buffer.from(sealed)).toString("utf8"),
  };
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

function fileHeader(filePath: string): Buffer {
  return readFileSync(filePath).subarray(0, SQLITE_HEADER.length);
}

function expectUnreadableWithoutKey(filePath: string): void {
  expect(fileHeader(filePath).equals(SQLITE_HEADER)).toBe(false);
  expect(() => {
    const db = new PlainDatabase(filePath, { readonly: true });
    try {
      db.prepare("SELECT count(*) FROM sqlite_master").get();
    } finally {
      db.close();
    }
  }).toThrow();
}

/** A plaintext database shaped like a real install: WAL on, Arabic content. */
function seedPlaintextDatabase(dbPath: string, rows = 3): void {
  const db = new PlainDatabase(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)");
  const insert = db.prepare("INSERT INTO customer (id, name, price) VALUES (?, ?, ?)");
  for (let i = 0; i < rows; i += 1) insert.run(`C-${i}`, `شركة النور ${i}`, 1_500_000 + i);
  db.close();
}

describe("tenant key material", () => {
  it("refuses to mint a key when the OS has no keyring, instead of writing one in the clear", async () => {
    const dir = workDir();
    await expect(
      loadOrCreateTenantKey({ dbPath: path.join(dir, "mezan.db"), keyStore: fakeKeyStore(false) }),
    ).rejects.toBeInstanceOf(KeyringUnavailableError);
    expect(() => statSync(tenantKeyFilePath(path.join(dir, "mezan.db")))).toThrow();
  });

  it("seals the key, keeps the file owner-only, and returns the same key next time", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const keyStore = fakeKeyStore();

    const first = await loadOrCreateTenantKey({ dbPath, keyStore });
    expect(first.created).toBe(true);
    expect(first.key).toMatch(/^[0-9a-f]{64}$/);

    const keyFile = tenantKeyFilePath(dbPath);
    // The key is not sitting in the file it is stored in.
    expect(readFileSync(keyFile).toString("utf8")).not.toContain(first.key);
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);

    const second = await loadOrCreateTenantKey({ dbPath, keyStore });
    expect(second).toEqual({ key: first.key, created: false });
  });
});

describe("a fresh install", () => {
  it("is born encrypted — the file on disk is not a readable SQLite database", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");

    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    expect(opened.converted).toBe(false);

    const { sqlite } = openSqliteConnection(dbPath, opened.connection);
    sqlite.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
    sqlite.prepare("INSERT INTO customer VALUES (?, ?)").run("C-1", "شركة النور");
    sqlite.close();

    expectUnreadableWithoutKey(dbPath);

    const reopened = openTenantConnection(dbPath, opened.connection);
    expect(reopened.prepare("SELECT name FROM customer WHERE id = 'C-1'").get()).toEqual({
      name: "شركة النور",
    });
    reopened.close();
  });

  it("writes the escrow key card once, owner-only, and reports that it is still there", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");

    const first = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    expect(first.keyCardPath).toBe(keyCardFilePath(dbPath));
    expect(statSync(first.keyCardPath as string).mode & 0o777).toBe(0o600);
    expect(readFileSync(first.keyCardPath as string, "utf8")).toContain(first.connection.key);

    const second = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    // Not rewritten on a launch that did not mint a key — but the caller is
    // still told a plaintext key is lying next to the database.
    expect(second.keyCardPath).toBeNull();
    expect(second.keyCardPresent).toBe(true);

    rmSync(keyCardFilePath(dbPath));
    const third = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    expect(third.keyCardPresent).toBe(false);
  });

  it("re-exports the key card on demand, for an owner who lost it", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    rmSync(keyCardFilePath(dbPath));

    const exported = await openEncryptedTenantDatabase({
      dbPath,
      keyStore: fakeKeyStore(),
      exportKeyCard: true,
    });
    expect(readFileSync(exported.keyCardPath as string, "utf8")).toContain(opened.connection.key);
  });

  it("fails with a diagnosis, not with 'file is not a database', when the key no longer fits", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    const db = openTenantConnection(dbPath, opened.connection);
    db.exec("CREATE TABLE customer (id TEXT PRIMARY KEY)");
    db.close();

    // The database came from another machine: the sealed key minted below opens
    // nothing, and the caller must be told that rather than "file is corrupt".
    rmSync(tenantKeyFilePath(dbPath));
    await expect(
      openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() }),
    ).rejects.toBeInstanceOf(DatabaseKeyMismatchError);
  });
});

describe("migrating a real plaintext install", () => {
  it("backs up first, converts, and keeps every row", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath, 5);
    expect(await readDatabaseFileState(dbPath)).toBe("plaintext");

    const backedUp: number[] = [];
    const opened = await openEncryptedTenantDatabase({
      dbPath,
      keyStore: fakeKeyStore(),
      backupFirst: async (sqlite) => {
        // Runs while the database is still plaintext and still intact — the
        // whole point of taking it before anything is touched.
        const row = sqlite.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM customer").get();
        backedUp.push(row?.n ?? -1);
        return path.join(dir, "safety.mezanbak");
      },
    });

    expect(backedUp).toEqual([5]);
    expect(opened.converted).toBe(true);
    expect(opened.backupArchivePath).toBe(path.join(dir, "safety.mezanbak"));
    expectUnreadableWithoutKey(dbPath);

    const db = openTenantConnection(dbPath, opened.connection);
    expect(db.prepare("SELECT COUNT(*) AS n FROM customer").get()).toEqual({ n: 5 });
    expect(db.prepare("SELECT name FROM customer WHERE id = 'C-0'").get()).toEqual({
      name: "شركة النور 0",
    });
    db.close();
  });

  it("does not convert when the backup refuses — the books outrank the migration", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath);

    await expect(
      openEncryptedTenantDatabase({
        dbPath,
        keyStore: fakeKeyStore(),
        backupFirst: async () => {
          throw new Error("no space left on device");
        },
      }),
    ).rejects.toThrow("no space left on device");

    expect(await readDatabaseFileState(dbPath)).toBe("plaintext");
    const db = new PlainDatabase(dbPath, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM customer").get()).toEqual({ n: 3 });
    db.close();
  });

  it("is idempotent: a second launch finds an encrypted database and leaves it alone", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath);

    const first = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    const bytes = readFileSync(dbPath);

    const second = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    expect(second.converted).toBe(false);
    expect(second.connection.key).toBe(first.connection.key);
    expect(readFileSync(dbPath).equals(bytes)).toBe(true);
  });

  it("survives an interruption mid-conversion: the next launch finds the original, not a stump", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath, 4);

    // What a machine that lost power between `VACUUM INTO` and the rename looks
    // like: a truncated staging file, and the untouched original beside it.
    const staging = `${dbPath}.encrypting`;
    writeFileSync(staging, Buffer.alloc(4096, 0x7a));

    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });

    expect(opened.converted).toBe(true);
    expect(() => statSync(staging)).toThrow();
    expectUnreadableWithoutKey(dbPath);
    const db = openTenantConnection(dbPath, opened.connection);
    expect(db.prepare("SELECT COUNT(*) AS n FROM customer").get()).toEqual({ n: 4 });
    db.close();
  });

  it("clears a staging file left by an interruption AFTER the rename — it is a full copy of the books", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    const db = openTenantConnection(dbPath, opened.connection);
    db.exec("CREATE TABLE customer (id TEXT PRIMARY KEY)");
    db.close();

    const staging = `${dbPath}.encrypting`;
    writeFileSync(staging, Buffer.alloc(1024, 0x11));
    await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    expect(() => statSync(staging)).toThrow();
  });

  it("leaves the plaintext original in place when the encrypted copy does not verify", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath);

    // A driver whose `rekey` does nothing is the shape of the defect this
    // guards: the conversion "succeeds" and installs a readable file.
    const inertDriver = new Proxy(cipherDriver, {
      construct(target, args: ConstructorParameters<typeof cipherDriver>) {
        const db = new target(...args);
        return new Proxy(db, {
          get(dbTarget, prop, receiver) {
            if (prop === "pragma") {
              return (source: string) =>
                source.startsWith("rekey")
                  ? []
                  : Reflect.get(dbTarget, prop, receiver).call(dbTarget, source);
            }
            return Reflect.get(dbTarget, prop, receiver);
          },
        });
      },
    });

    await expect(
      encryptPlaintextDatabase({ dbPath, key: "a".repeat(64), driver: inertDriver }),
    ).rejects.toThrow(/readable SQLite file/);

    expect(await readDatabaseFileState(dbPath)).toBe("plaintext");
    expect(() => statSync(`${dbPath}.encrypting`)).toThrow();
  });

  it("recovers content that was still sitting in the WAL when the upgrade landed", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    // Held open on purpose: the -wal file exists and has not been checkpointed,
    // which is what a `copyFile`-based migration would silently drop.
    const live = new PlainDatabase(dbPath);
    live.pragma("journal_mode = WAL");
    live.exec("CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL)");
    live.prepare("INSERT INTO journal_entry VALUES (?, ?)").run("JE-1", "بيع نقدي");
    live.close();

    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });
    const db = openTenantConnection(dbPath, opened.connection);
    expect(db.prepare("SELECT memo FROM journal_entry WHERE id = 'JE-1'").get()).toEqual({
      memo: "بيع نقدي",
    });
    db.close();
  });
});

describe("readDatabaseFileState", () => {
  it("reports a missing or truncated file as absent rather than guessing", async () => {
    const dir = workDir();
    expect(await readDatabaseFileState(path.join(dir, "nothing.db"))).toBe("absent");
    const stub = path.join(dir, "stub.db");
    writeFileSync(stub, Buffer.from("SQLite"));
    expect(await readDatabaseFileState(stub)).toBe("absent");
  });
});

/**
 * The seam is only worth having if the REAL composition goes through it. This
 * is the whole desktop stack — `createBackend`, its ~35 stores, the empty-tenant
 * seed — landing on an encrypted file.
 */
describe("the real backend on an encrypted connection", () => {
  it("writes a seeded tenant that the plain driver cannot open", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    const opened = await openEncryptedTenantDatabase({ dbPath, keyStore: fakeKeyStore() });

    const { createBackend } = await import("@mezan/backend");
    const backend = await createBackend({ dbPath, connection: opened.connection });
    backend.close();

    expectUnreadableWithoutKey(dbPath);

    // And the books really are in there — an unreadable empty file would pass
    // the assertion above and fail every user.
    const db = openTenantConnection(dbPath, opened.connection);
    const users = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM user").get();
    expect(users?.n ?? 0).toBeGreaterThan(0);
    db.close();
  }, 30_000);
});

describe("the operator's explicit overrides", () => {
  it("reads both flags off argv and nothing else", () => {
    expect(wantsUnencryptedDatabase(["node", "app", "--allow-unencrypted-database"])).toBe(true);
    expect(wantsUnencryptedDatabase(["node", "app"])).toBe(false);
    expect(wantsKeyExport(["node", "app", "--export-database-key"])).toBe(true);
    expect(wantsKeyExport(["node", "app", "--reset-admin"])).toBe(false);
  });

  it("refuses a key that is not 32 bytes of hex — every PRAGMA below interpolates it", () => {
    const dir = workDir();
    expect(() =>
      openTenantConnection(path.join(dir, "mezan.db"), {
        driver: cipherDriver,
        key: "'; ATTACH DATABASE 'x' AS y; --",
      }),
    ).toThrow(/32 bytes of lowercase hex/);
  });

  it("adapts Electron's safeStorage without widening it", () => {
    const calls: string[] = [];
    const store = electronSafeStorageKeyStore({
      isEncryptionAvailable: () => {
        calls.push("available");
        return true;
      },
      encryptString: (plain) => {
        calls.push("encrypt");
        return Buffer.from(plain.toUpperCase(), "utf8");
      },
      decryptString: (sealed) => {
        calls.push("decrypt");
        return sealed.toString("utf8").toLowerCase();
      },
    });
    expect(store.isAvailable()).toBe(true);
    expect(store.unseal(store.seal("abc"))).toBe("abc");
    expect(calls).toEqual(["available", "encrypt", "decrypt"]);
  });
});

describe("the conversion refuses to install a copy it cannot vouch for", () => {
  it("keeps the plaintext original when the encrypted copy has lost rows", async () => {
    const dir = workDir();
    const dbPath = path.join(dir, "mezan.db");
    seedPlaintextDatabase(dbPath, 6);

    // A snapshot that comes out short is the failure the row-count check exists
    // for: the header is encrypted and `integrity_check` says "ok", because a
    // truncated database is a perfectly valid one.
    const lossyDriver = new Proxy(cipherDriver, {
      construct(target, args: ConstructorParameters<typeof cipherDriver>) {
        const db = new target(...args);
        return new Proxy(db, {
          get(dbTarget, prop, receiver) {
            if (prop === "exec") {
              return (sql: string) => {
                const staging = /VACUUM INTO '(.+)'/.exec(sql)?.[1];
                if (!staging) return Reflect.get(dbTarget, prop, receiver).call(dbTarget, sql);
                const empty = new PlainDatabase(staging);
                empty.exec("CREATE TABLE customer (id TEXT PRIMARY KEY, name TEXT, price INTEGER)");
                empty.close();
                return dbTarget;
              };
            }
            return Reflect.get(dbTarget, prop, receiver);
          },
        });
      },
    });

    await expect(
      encryptPlaintextDatabase({ dbPath, key: "b".repeat(64), driver: lossyDriver }),
    ).rejects.toThrow(/lost rows in "customer": 6 before, 0 after/);

    expect(await readDatabaseFileState(dbPath)).toBe("plaintext");
    expect(() => statSync(`${dbPath}.encrypting`)).toThrow();
    const survivor = new PlainDatabase(dbPath, { readonly: true });
    expect(survivor.prepare("SELECT COUNT(*) AS n FROM customer").get()).toEqual({ n: 6 });
    survivor.close();
  });
});
