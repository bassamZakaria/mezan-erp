import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink, openAuditChainFile } from "@mezan/persistence";
import { anchorHead, createAuditAnchorSigner, createFileAuditAnchorSink } from "./audit-anchor.js";
import { hasPendingWal, main, VerifyExit } from "./audit-anchor-cli.js";

const NO_WAL = -1;

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function databaseWithWal(walBytes: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "anchor-cli-"));
  dirs.push(dir);
  const db = path.join(dir, "copy.sqlite");
  writeFileSync(db, "");
  if (walBytes !== NO_WAL) writeFileSync(`${db}-wal`, Buffer.alloc(walBytes, 1));
  return db;
}

describe("the anchor verifier on a database copied without its write-ahead log", () => {
  it("refuses with exit 1 and a message in Arabic and English, instead of reporting a false rollback", async () => {
    const db = databaseWithWal(4096);
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const code = await main(["verify", "--db", db, "--scope", "T-1"], {});

    expect(code).toBe(VerifyExit.Failure);
    const message = String(printed.mock.calls[0]?.[0]);
    expect(message).toMatch(/[؀-ۿ]/);
    expect(message).toMatch(/ROLLED_BACK/);
    expect(message).toMatch(/sqlite3 \.backup/);
  });

  it("accept-restore signs a rebase for a restored older snapshot, after which verify passes and reports the superseded history", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "anchor-cli-"));
    dirs.push(dir);
    const db = path.join(dir, "tenant.sqlite");
    const env = { MEZAN_AUDIT_ANCHOR_SIGNING_KEY: "44".repeat(32), MEZAN_AUDIT_ANCHOR_DIR: path.join(dir, "anchors") };
    const signer = createAuditAnchorSigner(env.MEZAN_AUDIT_ANCHOR_SIGNING_KEY);
    const sink = createFileAuditAnchorSink(env.MEZAN_AUDIT_ANCHOR_DIR);
    const handle = createSqliteAuditSink(db);
    const row = () => createAuditEvent({ stream: "security", module: "auth", entityType: "AUTH_USER", action: "X", actor: "u", severity: "INFO" });
    for (let i = 0; i < 2; i += 1) await handle.append(row());
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(db, path.join(dir, "snapshot.sqlite"));
    for (let i = 0; i < 2; i += 1) await handle.append(row());
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    const reader = openAuditChainFile(db);
    await anchorHead({ scope: "T-1", head: reader.head(), rowHashAt: (id) => reader.rowHashAt(id), signer, latest: null, sink, now: () => new Date() });
    reader.close();
    handle.close();
    copyFileSync(path.join(dir, "snapshot.sqlite"), db);
    const printed = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await main(["verify", "--db", db, "--scope", "T-1"], env)).toBe(VerifyExit.Tampering);
    expect(await main(["accept-restore", "--db", db, "--scope", "T-1", "--actor", "ops"], env)).toBe(VerifyExit.Failure);
    expect(await main(["accept-restore", "--db", db, "--scope", "T-1", "--reason", "restored the nightly snapshot after a disk failure", "--actor", "ops"], env)).toBe(VerifyExit.Verified);
    expect(await main(["accept-restore", "--db", db, "--scope", "T-1", "--reason", "restored the nightly snapshot after a disk failure", "--actor", "ops"], env)).toBe(VerifyExit.Failure);
    expect(await main(["verify", "--db", db, "--scope", "T-1"], env)).toBe(VerifyExit.Verified);
    expect(printed.mock.calls.map((call) => String(call[0])).join("\n")).toContain("SUPERSEDED_BY_RESTORE");
    expect((await sink.latest("T-1"))?.anchor.rebase).toMatchObject({ supersededSeq: 4, acceptedBy: "cli:ops" });
  });

  it("counts only a non-empty -wal file", () => {
    expect(hasPendingWal(databaseWithWal(1))).toBe(true);
    expect(hasPendingWal(databaseWithWal(0))).toBe(false);
    expect(hasPendingWal(databaseWithWal(NO_WAL))).toBe(false);
  });
});
