import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPlatformUser } from "@mezan/domain";
import { createSqlitePlatformStores, drainForeignWrites } from "@mezan/persistence";
import { drainTurnYields } from "@mezan/api";
import { createPlatform, type PlatformHandle } from "./create-platform.js";

const platforms: PlatformHandle[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const platform of platforms.splice(0)) platform.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const instantHasher = { hash: async (secret: string) => `hashed:${secret}`, verify: async (secret: string, stored: string) => stored === `hashed:${secret}` };

async function filePlatform(): Promise<{ platform: PlatformHandle; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-platform-turn-"));
  dirs.push(dir);
  const platform = await createPlatform({ dbPath: path.join(dir, "platform.sqlite"), hasher: instantHasher });
  platforms.push(platform);
  return { platform, dir };
}

const addUser = (platform: PlatformHandle, id: string) =>
  createPlatformUser({ id, email: `${id}@mezan.app`, password: "a long enough password", role: "support", now: "2026-01-01T00:00:00.000Z" }, platform.stores.platformUsers, platform.hasher);

describe("the platform database's turn", () => {
  it("keeps a row another operation has not committed out of a backup taken meanwhile", async () => {
    const { platform, dir } = await filePlatform();
    const release = gate();
    const begun = gate();
    const rolledBack = platform.audit.atomic!(async () => {
      await addUser(platform, "uncommitted");
      begun.open();
      await release.opened;
      throw new Error("rolls back");
    }).catch(() => undefined);
    await begun.opened;

    const destination = path.join(dir, "backup.sqlite");
    const backedUp = platform.backupTo(destination);
    await new Promise((resolve) => setTimeout(resolve, 50));
    release.open();
    await rolledBack;
    await backedUp;

    const copy = createSqlitePlatformStores(destination);
    try {
      expect(await copy.platformUsers.list()).toEqual([]);
    } finally {
      copy.close();
    }
  });

  it("runs background work one at a time, so its writes never land in another operation's transaction", async () => {
    const { platform } = await filePlatform();
    const release = gate();
    const begun = gate();
    const settling = platform.audit.atomic!(async () => {
      begun.open();
      await release.opened;
      throw new Error("rolls back");
    }).catch(() => undefined);
    await begun.opened;

    const background = platform.inTheTurn("a timer", () => addUser(platform, "from-a-timer"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release.open();
    await settling;
    await background;

    expect((await platform.stores.platformUsers.list()).map((user) => user.id)).toEqual(["from-a-timer"]);
    expect(drainForeignWrites()).toEqual([]);
  });

  it("hands the turn back while a secret is hashed, so a write behind it is not kept waiting on the hash", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mezan-platform-turn-"));
    dirs.push(dir);
    const hashing = gate();
    const slowHasher = {
      hash: async (secret: string) => {
        await hashing.opened;
        return `hashed:${secret}`;
      },
      verify: async () => true,
    };
    const platform = await createPlatform({ dbPath: path.join(dir, "platform.sqlite"), hasher: slowHasher });
    platforms.push(platform);

    const creating = platform.inTheTurn("user create", () => addUser(platform, "slow-hash"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await platform.inTheTurn("another write", async () => {
      platform.stores.sqlite.prepare("UPDATE plan SET sort_order = sort_order").run();
    });
    hashing.open();
    await creating;

    expect((await platform.stores.platformUsers.list()).map((user) => user.id)).toEqual(["slow-hash"]);
    expect(drainTurnYields()).toEqual([]);
  });
});
