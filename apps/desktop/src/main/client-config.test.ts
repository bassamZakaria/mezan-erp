import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clientConfigPath,
  readClientConfig,
  updateClientHostUrl,
  writeClientConfig,
} from "./client-config.js";

const dirs: string[] = [];

async function scratchDb(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-role-"));
  dirs.push(dir);
  return path.join(dir, "mezan.db");
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const FINGERPRINT =
  "3D:9A:1F:04:B7:22:CE:65:80:11:AA:5E:F3:47:9C:D2:16:8B:70:E4:53:C1:0F:6A:29:BD:84:37:52:EE:C8:91";

describe("which machine this install is", () => {
  it("is a host when there is no client.json — the ordinary single-machine install", async () => {
    expect(await readClientConfig(await scratchDb())).toEqual({ role: "host" });
  });

  it("is a client, with its pairing, once the file is written", async () => {
    const dbPath = await scratchDb();
    const written = await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.7:4173",
      fingerprintSha256: FINGERPRINT,
      deviceLabel: "مكتب المحاسب",
    });

    const role = await readClientConfig(dbPath);
    expect(role).toEqual({ role: "client", config: written });
    expect(written.hostUrl).toBe("https://192.168.1.7:4173");
    expect(written.deviceLabel).toBe("مكتب المحاسب");
    expect(written.deviceId).toMatch(/[0-9a-f-]{36}/);
  });

  it("keeps the same deviceId when the client is re-pointed at a rebuilt host", async () => {
    const dbPath = await scratchDb();
    const first = await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.7:4173",
      fingerprintSha256: FINGERPRINT,
    });
    const second = await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.9:4173",
      fingerprintSha256: FINGERPRINT.replace(/^3D/, "AA"),
    });

    // One physical machine, one seat. A fresh id on every re-pair would burn a
    // licensed seat each time a consultant repointed a till.
    expect(second.deviceId).toBe(first.deviceId);
  });

  /**
   * The failure this refuses to have. A client that fell back to "host" on a
   * damaged config would open its own empty database, seed its own chart of
   * accounts, and look completely normal while holding none of the shop's data.
   * Somebody would then enter a day of invoices into it.
   */
  it("refuses to start rather than silently becoming a host with empty books", async () => {
    const dbPath = await scratchDb();
    await writeFile(clientConfigPath(dbPath), "{ not json", "utf8");

    const role = await readClientConfig(dbPath);
    expect(role.role).toBe("unusable");
  });

  it("refuses a pairing with an address but no fingerprint — that is trusting whoever answers", async () => {
    const dbPath = await scratchDb();
    await writeFile(
      clientConfigPath(dbPath),
      JSON.stringify({ hostUrl: "https://192.168.1.7:4173", deviceId: "D", deviceLabel: "L" }),
      "utf8",
    );

    const role = await readClientConfig(dbPath);
    expect(role.role).toBe("unusable");
    expect(role).toMatchObject({ reason: expect.stringContaining("fingerprintSha256") });
  });

  it("refuses a plain-HTTP host address — there is no unencrypted mount to point at", async () => {
    const dbPath = await scratchDb();
    await writeFile(
      clientConfigPath(dbPath),
      JSON.stringify({
        hostUrl: "http://192.168.1.7:4173",
        fingerprintSha256: FINGERPRINT,
        deviceId: "D",
        deviceLabel: "L",
      }),
      "utf8",
    );

    expect((await readClientConfig(dbPath)).role).toBe("unusable");
  });
});

/**
 * guards N-2: a router reboot used to take every till in the shop out, and the
 * recovery was a consultant editing `client.json` on each of them by hand.
 */
describe("re-pointing a paired till at a moved host", () => {
  it("changes the address while keeping the pin and the device id", async () => {
    const dbPath = await scratchDb();
    const original = await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.7:4173",
      fingerprintSha256: FINGERPRINT,
      deviceLabel: "كاشير ١",
    });

    const moved = await updateClientHostUrl(dbPath, "https://192.168.1.9:4173");

    expect(moved.hostUrl).toBe("https://192.168.1.9:4173");
    // THE SECURITY PROPERTY: the certificate this till will accept did not
    // change, so "the address moved" can never walk it onto an impostor.
    expect(moved.fingerprintSha256).toBe(original.fingerprintSha256);
    // And the seat is the same seat: a new device id would burn a second one
    // out of a two-seat licence every time the router rebooted.
    expect(moved.deviceId).toBe(original.deviceId);
    expect(moved.deviceLabel).toBe("كاشير ١");

    const reread = await readClientConfig(dbPath);
    expect(reread).toEqual({ role: "client", config: moved });
  });

  it("refuses on a machine that was never paired, rather than inventing a pairing", async () => {
    const dbPath = await scratchDb();
    await expect(updateClientHostUrl(dbPath, "https://192.168.1.9:4173")).rejects.toThrow();
    expect((await readClientConfig(dbPath)).role).toBe("host");
  });

  it("refuses a plain-HTTP address, exactly as the original pairing does", async () => {
    const dbPath = await scratchDb();
    await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.7:4173",
      fingerprintSha256: FINGERPRINT,
    });

    await expect(updateClientHostUrl(dbPath, "http://192.168.1.9:4173")).rejects.toThrow();
    const reread = await readClientConfig(dbPath);
    expect(reread.role === "client" && reread.config.hostUrl).toBe("https://192.168.1.7:4173");
  });
});
