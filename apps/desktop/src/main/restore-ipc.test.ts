import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionGrant, SessionRegistry } from "@mezan/api";
import { createBackup } from "../backup/index.js";
import {
  MEZAN_BACKUP_CREATE_CHANNEL,
  MEZAN_BACKUP_LIST_CHANNEL,
  MEZAN_BACKUP_RESTORE_CHANNEL,
  type BackupCreateResult,
  type BackupFailure,
  type BackupListResult,
  type BackupRestoreResult,
} from "../shared/ipc-contract.js";

/**
 * `backup/restore-service.ts` implemented a fully verified restore and was
 * called from nothing — no IPC, no menu, no screen — so the product shipped
 * backups nobody could put back. These channels are its only caller, which
 * makes them the only place the restore's preconditions can be got wrong: the
 * name comes from the renderer, and the connections have to be shut before the
 * file underneath them is replaced.
 */

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

function fakeSessions(grant: SessionGrant | null): SessionRegistry {
  return {
    issue: () => "unused",
    find: (token: string) => (token === "good-token" ? grant : null),
    revoke: () => {},
    revokeUser: () => {},
  };
}

const ADMIN: SessionGrant = {
  userId: "USER-ADMIN",
  permissions: ["*"],
  roleCode: null,
  branchScope: "*",
  warehouseScope: "*",
};

const CLERK: SessionGrant = {
  userId: "USER-CLERK",
  permissions: ["sales.invoice.create", "admin.settings.view"],
  roleCode: "CLERK",
  branchScope: "*",
  warehouseScope: "*",
};

let dir: string;
let dbPath: string;
let backupsDir: string;
let live: Database.Database;
let closed: number;
let relaunched: number;

async function register(grant: SessionGrant | null): Promise<void> {
  handlers.clear();
  const { registerRestoreOverIpc } = await import("./restore-ipc.js");
  registerRestoreOverIpc({
    dbPath,
    backupsDir,
    appVersion: "9.9.9",
    sqlite: () => live,
    closeLiveConnections: () => {
      closed += 1;
      live.close();
    },
    relaunch: () => {
      relaunched += 1;
    },
    sessions: fakeSessions(grant),
  });
}

function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return handlers.get(channel)!(null, ...args) as Promise<T>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  dir = mkdtempSync(path.join(tmpdir(), "mezan-restore-ipc-"));
  dbPath = path.join(dir, "mezan.db");
  backupsDir = path.join(dir, "backups");
  closed = 0;
  relaunched = 0;

  live = new Database(dbPath);
  live.exec("CREATE TABLE invoice (id TEXT PRIMARY KEY, memo TEXT NOT NULL)");
  live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-1", "فاتورة أولى");
});

afterEach(() => {
  vi.useRealTimers();
  try {
    live.close();
  } catch {
    // Already closed by a restore under test.
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("who may drive a restore", () => {
  it("refuses every channel without a session the SERVER minted", async () => {
    await register(ADMIN);
    for (const token of [undefined, "", 42, "not-a-real-token"]) {
      expect((await call<BackupFailure>(MEZAN_BACKUP_LIST_CHANNEL, token)).code).toBe("UNAUTHORIZED");
      expect((await call<BackupFailure>(MEZAN_BACKUP_CREATE_CHANNEL, token)).code).toBe("UNAUTHORIZED");
      expect(
        (await call<BackupFailure>(MEZAN_BACKUP_RESTORE_CHANNEL, token, "anything.mezanbak")).code,
      ).toBe("UNAUTHORIZED");
    }
    // Nothing was closed and nothing relaunched on the way to those refusals.
    expect(closed).toBe(0);
    expect(relaunched).toBe(0);
  });

  it("refuses a real session that does not hold the settings grant", async () => {
    await register(CLERK);
    const denied = await call<BackupFailure>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(denied.code).toBe("UNAUTHORIZED");
    // Arabic, ready to render — the screen must never show the code.
    expect(denied.message).toContain("صلاحية");
  });
});

describe("what a file name may be", () => {
  it("refuses anything that is not one of our own names in our own folder", async () => {
    await register(ADMIN);
    for (const name of [
      "../../../etc/passwd",
      "/etc/passwd",
      "..\\..\\windows\\system32\\config\\sam",
      "mezan.db",
      "notes.txt",
      "",
      42,
    ]) {
      const res = await call<BackupFailure>(MEZAN_BACKUP_RESTORE_CHANNEL, "good-token", name);
      expect([name, res.code]).toEqual([name, "INVALID_NAME"]);
    }
    expect(closed).toBe(0);
  });

  it("reports a missing archive rather than closing the database to find out", async () => {
    await register(ADMIN);
    const res = await call<BackupFailure>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      "mezan-backup-2020-01-01T00-00-00-000Z.mezanbak",
    );
    expect(res.code).toBe("NOT_FOUND");
    expect(closed).toBe(0);
  });
});

describe("list and create", () => {
  it("lists archives newest first, with what the manifest says is inside them", async () => {
    await register(ADMIN);
    await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: "manual",
      now: new Date("2026-08-01T10:00:00.000Z"),
    });
    await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: "scheduled",
      now: new Date("2026-08-20T10:00:00.000Z"),
    });

    const listed = await call<BackupListResult>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.backupsDir).toBe(backupsDir);
    expect(listed.entries).toHaveLength(2);
    expect(listed.entries[0]!.createdAt).toBe("2026-08-20T10:00:00.000Z");
    expect(listed.entries[0]!.reason).toBe("scheduled");
    expect(listed.entries[0]!.appVersion).toBe("9.9.9");
    expect(listed.entries[0]!.readable).toBe(true);
    expect(listed.entries[0]!.tables).toMatchObject({ invoice: 1 });
    expect(listed.entries[0]!.sizeBytes).toBeGreaterThan(0);
    // The name is what restore takes back — a bare file name, never a path.
    expect(listed.entries[0]!.fileName).toBe(path.basename(listed.entries[0]!.fileName));
  });

  it("still lists a damaged archive, marked unreadable, instead of hiding it", async () => {
    // A shop owner hunting for last Tuesday's file needs to see that it is
    // there and broken. A list that quietly drops it says the backup was never
    // taken, which is a different and much worse thing to believe.
    await register(ADMIN);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(backupsDir, { recursive: true });
    const broken = path.join(backupsDir, "mezan-backup-2026-08-05T10-00-00-000Z.mezanbak");
    await writeFile(broken, "this is not a tar archive");

    const listed = await call<BackupListResult>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.readable).toBe(false);
    expect(listed.entries[0]!.appVersion).toBeNull();
    // Falls back to the timestamp encoded in the name, so the row still sorts.
    expect(listed.entries[0]!.createdAt).toBe("2026-08-05T10:00:00.000Z");
  });

  it("takes a backup on demand and describes the file it wrote", async () => {
    await register(ADMIN);
    const created = await call<BackupCreateResult>(MEZAN_BACKUP_CREATE_CHANNEL, "good-token");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.entry.reason).toBe("manual");
    expect(created.entry.tables).toMatchObject({ invoice: 1 });
    await expect(readFile(path.join(backupsDir, created.entry.fileName))).resolves.toBeDefined();
  });
});

describe("the restore itself", () => {
  it("takes a safety copy, closes the live database, replaces it, and relaunches", async () => {
    await register(ADMIN);

    const snapshot = await createBackup({
      sqlite: live,
      backupsDir,
      appVersion: "9.9.9",
      reason: "manual",
    });
    const archiveName = path.basename(snapshot.archivePath);

    // Move the live database on from the state that was captured, so a restore
    // that quietly did nothing would still show this row afterwards.
    live.prepare("INSERT INTO invoice VALUES (?, ?)").run("INV-2", "فاتورة بعد النسخة");
    expect(live.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 2 });

    const res = await call<BackupRestoreResult>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      archiveName,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.restoredFrom.fileName).toBe(archiveName);
    // The safety copy is the only thing standing between "restored the wrong
    // file" and an irreversible loss, and it can only be taken while the live
    // connection is still open — so it has to come first.
    expect(res.safetyBackupFileName).not.toBeNull();
    expect(closed).toBe(1);

    const reopened = new Database(dbPath, { readonly: true });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 1 });
    reopened.close();

    // Scheduled, not immediate: `app.exit()` would kill the process before this
    // very reply reached the renderer.
    expect(relaunched).toBe(0);
    vi.runAllTimers();
    expect(relaunched).toBe(1);
  });

  it("leaves the data untouched when the archive fails verification, and comes back up", async () => {
    await register(ADMIN);
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(backupsDir, { recursive: true });
    const corrupt = "mezan-backup-2026-08-10T10-00-00-000Z.mezanbak";
    await writeFile(path.join(backupsDir, corrupt), "not an archive at all");

    const res = await call<BackupRestoreResult>(MEZAN_BACKUP_RESTORE_CHANNEL, "good-token", corrupt);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VERIFICATION_FAILED");
    expect(res.message).toContain("لم تتغيّر بياناتك");

    // Every check in restore-service.ts runs before the atomic rename, so the
    // original file is intact — but its connections are shut, which is why the
    // app relaunches rather than sitting there unable to serve anything.
    const reopened = new Database(dbPath, { readonly: true });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM invoice").get()).toEqual({ n: 1 });
    reopened.close();
    vi.runAllTimers();
    expect(relaunched).toBe(1);
  });

  it("lets the weaker grant read the list, and only the stronger one replace the books", async () => {
    // `admin.backup.view` was declared and never consulted — every channel,
    // listing included, checked `admin.backup.restore` — so the weaker grant
    // was dead, and seeing whether last night's backup ran required the
    // permission that OVERWRITES the company's data.
    await register({
      userId: "USER-VIEWER",
      permissions: ["admin.backup.view"],
      roleCode: "VIEWER",
      branchScope: "*",
      warehouseScope: "*",
    });

    const listed = await call<{ ok?: false }>(MEZAN_BACKUP_LIST_CHANNEL, "good-token");
    expect(listed.ok).not.toBe(false);

    const restored = await call<{ ok: boolean; code?: string }>(
      MEZAN_BACKUP_RESTORE_CHANNEL,
      "good-token",
      "anything.mezanbak",
    );
    expect(restored).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });
});
