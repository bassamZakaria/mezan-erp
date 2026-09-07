import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createTlsServer, type Server } from "node:tls";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { MEZAN_PAIRING_CHANNEL, type PairingResponse } from "../shared/ipc-contract.js";
import { loadOrCreateLanTlsIdentity, type LanTlsIdentity } from "./lan-tls.js";
import { clientConfigPath, readClientConfig, writeClientConfig } from "./client-config.js";

/**
 * guards N-1, N-2 and N-4.
 *
 * These handlers take NO SESSION TOKEN — the two states they exist for (a
 * machine nobody has set up, a till that cannot reach the host it would sign in
 * to) are the two where no session can exist. What replaces a credential is
 * that neither destructive action is blind, and the three cases below are
 * exactly that guarantee:
 *
 *   - `confirm` refuses on any machine whose tenant has been claimed, so it can
 *     never turn the machine holding the shop's ledger into a till;
 *   - `confirm` re-reads the certificate at the moment of the decision, so what
 *     is pinned is what the host is presenting, not what the screen passed back;
 *   - `relocate` moves the ADDRESS while the pin stays exactly as it was, so it
 *     cannot walk a till onto a different machine.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
}));

const { registerPairingOverIpc } = await import("./pairing-ipc.js");

const dirs: string[] = [];
const servers: Server[] = [];

async function scratchDb(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-pairing-"));
  dirs.push(dir);
  return path.join(dir, "mezan.db");
}

async function hostAt(): Promise<{ url: string; tls: LanTlsIdentity }> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-pairing-host-"));
  dirs.push(dir);
  const tls = await loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
  const server = createTlsServer({ key: tls.key, cert: tls.cert }, () => {});
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  return { url: `https://127.0.0.1:${port}`, tls };
}

afterAll(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function call(message: unknown): Promise<PairingResponse> {
  const handler = handlers.get(MEZAN_PAIRING_CHANNEL);
  if (!handler) throw new Error("channel not registered");
  return Promise.resolve(handler(null, message)) as Promise<PairingResponse>;
}

describe("in-app pairing", () => {
  it("probes a real host and reports the certificate the HANDSHAKE presented", async () => {
    handlers.clear();
    const host = await hostAt();
    registerPairingOverIpc({
      dbPath: await scratchDb(),
      tenantIsClaimed: async () => false,
      relaunch: () => {},
    });

    const probed = await call({ kind: "probe", hostUrl: host.url });

    expect(probed).toMatchObject({
      kind: "probe",
      ok: true,
      presentedFingerprint: host.tls.fingerprintSha256,
      subject: "Mezan LAN host",
    });
  });

  it("pairs a fresh machine and moves its empty database aside rather than deleting it", async () => {
    handlers.clear();
    const host = await hostAt();
    const dbPath = await scratchDb();
    await writeFile(dbPath, "an empty seeded database", "utf8");
    const relaunch = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => {});

    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => false, relaunch });

    const result = await call({
      kind: "confirm",
      hostUrl: host.url,
      fingerprintSha256: host.tls.fingerprintSha256,
      deviceLabel: "كاشير ١",
    });

    expect(result).toMatchObject({ kind: "confirm", ok: true, deviceLabel: "كاشير ١" });
    const role = await readClientConfig(dbPath);
    expect(role.role).toBe("client");
    expect(role.role === "client" && role.config.fingerprintSha256).toBe(host.tls.fingerprintSha256);
    // Moved, not deleted: on the one occasion the machine held more than a
    // seed, the file is still there to be put back.
    await expect(readFile(`${dbPath}.pre-pairing`, "utf8")).resolves.toContain("empty seeded database");
  });

  /**
   * THE GUARD THAT MAKES A TOKENLESS CHANNEL SAFE. A machine holding the shop's
   * ledger must never be convertible into a till: everything in it becomes
   * unreadable to everyone.
   */
  it("refuses to pair a machine that already holds books, and writes nothing", async () => {
    handlers.clear();
    const host = await hostAt();
    const dbPath = await scratchDb();
    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => true, relaunch: () => {} });

    const result = await call({
      kind: "confirm",
      hostUrl: host.url,
      fingerprintSha256: host.tls.fingerprintSha256,
    });

    expect(result).toMatchObject({ kind: "confirm", ok: false });
    expect((await readClientConfig(dbPath)).role).toBe("host");
  });

  /**
   * The compare-and-confirm step is the whole security control. Pinning
   * whatever the screen passes back would make it decorative — a stale or
   * tampered renderer state would pin a value nobody looked at.
   */
  it("re-reads the certificate at the moment of the decision and refuses a disagreement", async () => {
    handlers.clear();
    const host = await hostAt();
    const dbPath = await scratchDb();
    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => false, relaunch: () => {} });

    const result = await call({
      kind: "confirm",
      hostUrl: host.url,
      // What the operator "compared" — and not what the host is presenting.
      fingerprintSha256:
        "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    });

    expect(result).toMatchObject({ kind: "confirm", ok: false });
    expect((await readClientConfig(dbPath)).role).toBe("host");
  });

  it("reports what this machine is, and whether it may pair at all", async () => {
    handlers.clear();
    const dbPath = await scratchDb();
    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => true, relaunch: () => {} });

    expect(await call({ kind: "state" })).toMatchObject({
      kind: "state",
      role: "host",
      // A claimed tenant: the link never appears on a shop's live host.
      mayPair: false,
    });
  });
});

describe("finding a host that moved (N-2)", () => {
  it("writes the accepted address and keeps the pin and the device id untouched", async () => {
    handlers.clear();
    const dbPath = await scratchDb();
    const original = await writeClientConfig(dbPath, {
      hostUrl: "https://192.168.1.7:4173",
      fingerprintSha256:
        "3D:9A:1F:04:B7:22:CE:65:80:11:AA:5E:F3:47:9C:D2:16:8B:70:E4:53:C1:0F:6A:29:BD:84:37:52:EE:C8:91",
      deviceLabel: "كاشير ١",
    });
    const relaunch = vi.fn();
    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => true, relaunch, client: original });

    const result = await call({ kind: "relocate", accept: "https://192.168.1.9:4173" });

    expect(result).toMatchObject({ kind: "relocate", ok: true, applied: true });
    const written = JSON.parse(await readFile(clientConfigPath(dbPath), "utf8")) as {
      hostUrl: string;
      fingerprintSha256: string;
      deviceId: string;
    };
    expect(written.hostUrl).toBe("https://192.168.1.9:4173");
    expect(written.fingerprintSha256).toBe(original.fingerprintSha256);
    expect(written.deviceId).toBe(original.deviceId);
  });

  it("refuses on a machine that is not a till, rather than inventing a pairing", async () => {
    handlers.clear();
    const dbPath = await scratchDb();
    registerPairingOverIpc({ dbPath, tenantIsClaimed: async () => true, relaunch: () => {} });

    expect(await call({ kind: "relocate", accept: "https://192.168.1.9:4173" })).toMatchObject({
      kind: "relocate",
      ok: false,
    });
    expect((await readClientConfig(dbPath)).role).toBe("host");
  });
});
