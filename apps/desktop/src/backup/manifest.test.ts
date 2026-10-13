import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  buildManifest,
  countRows,
  parseManifest,
  serializeManifest,
  MANIFEST_FORMAT,
  CURRENT_SCHEMA_VERSION,
  BackupReason,
} from "./manifest.js";
import { ManifestValidationError } from "./errors.js";

const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function seededDb(): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  db.exec(`
    CREATE TABLE journal_entry (id TEXT PRIMARY KEY, memo TEXT NOT NULL);
    CREATE TABLE journal_line (id INTEGER PRIMARY KEY, entry_id TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-1", "a");
  db.prepare("INSERT INTO journal_entry (id, memo) VALUES (?, ?)").run("JE-2", "b");
  db.prepare("INSERT INTO journal_line (entry_id) VALUES (?)").run("JE-1");
  return db;
}

describe("countRows", () => {
  it("counts every user table and excludes sqlite_* internal tables", () => {
    const db = seededDb();
    const counts = countRows(db);
    expect(counts).toEqual({ journal_entry: 2, journal_line: 1 });
    expect(Object.keys(counts).some((k) => k.startsWith("sqlite_"))).toBe(false);
  });

  it("returns zero for an empty table", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    db.exec("CREATE TABLE empty_table (id INTEGER PRIMARY KEY);");
    expect(countRows(db)).toEqual({ empty_table: 0 });
  });
});

describe("buildManifest / serializeManifest / parseManifest", () => {
  const validChecksum = "a".repeat(64);

  it("round-trips through JSON without loss", () => {
    const manifest = buildManifest({
      checksum: validChecksum,
      tables: { journal_entry: 2 },
      appVersion: "0.1.0",
      reason: BackupReason.Manual,
      createdAt: new Date("2026-08-22T00:00:00.000Z"),
    });

    const parsed = parseManifest(serializeManifest(manifest));
    expect(parsed).toEqual(manifest);
    expect(parsed.manifestFormat).toBe(MANIFEST_FORMAT);
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseManifest("{not json")).toThrow(ManifestValidationError);
  });

  it("rejects a checksum that isn't a sha256 hex digest", () => {
    const bad = JSON.stringify({
      manifestFormat: 1,
      schemaVersion: 1,
      appVersion: "0.1.0",
      createdAt: new Date().toISOString(),
      checksum: "not-a-hash",
      tables: {},
      reason: BackupReason.Manual,
    });
    expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
  });

  it("rejects a manifest missing required fields", () => {
    expect(() => parseManifest(JSON.stringify({ appVersion: "0.1.0" }))).toThrow(
      ManifestValidationError,
    );
  });

  it("rejects a manifest written by a newer, unrecognized manifest format", () => {
    const future = JSON.stringify({
      manifestFormat: MANIFEST_FORMAT + 1,
      schemaVersion: 1,
      appVersion: "9.9.9",
      createdAt: new Date().toISOString(),
      checksum: validChecksum,
      tables: {},
      reason: BackupReason.Manual,
    });
    expect(() => parseManifest(future)).toThrow(ManifestValidationError);
  });
});

describe("the manifest's schema version", () => {
  it("is the one the persistence layer stamps, not a copy of it", async () => {
    const persistence = await import("@mezan/persistence");
    expect(CURRENT_SCHEMA_VERSION).toBe(persistence.CURRENT_SCHEMA_VERSION);
    const manifest = buildManifest({ checksum: "a".repeat(64), tables: {}, appVersion: "1.0.0", reason: BackupReason.Manual });
    expect(manifest.schemaVersion).toBe(persistence.CURRENT_SCHEMA_VERSION);
  });

  it("reads the reason of an archive written before reasons were an enum, and the safety copy's", () => {
    const base = { manifestFormat: MANIFEST_FORMAT, schemaVersion: 1, appVersion: "1.0.0", createdAt: "2026-09-01T00:00:00.000Z", checksum: "a".repeat(64), tables: {} };
    expect(parseManifest(JSON.stringify({ ...base, reason: BackupReason.OnClose })).reason).toBe(BackupReason.OnClose);
    expect(parseManifest(JSON.stringify({ ...base, reason: BackupReason.PreRestore })).reason).toBe(BackupReason.PreRestore);
    expect(() => parseManifest(JSON.stringify({ ...base, reason: "whenever" }))).toThrow(ManifestValidationError);
  });
});
