import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("counts only a non-empty -wal file", () => {
    expect(hasPendingWal(databaseWithWal(1))).toBe(true);
    expect(hasPendingWal(databaseWithWal(0))).toBe(false);
    expect(hasPendingWal(databaseWithWal(NO_WAL))).toBe(false);
  });
});
