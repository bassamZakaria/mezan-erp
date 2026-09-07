import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SessionGrant, SessionRegistry } from "@mezan/api";
import { createEntitlements } from "@mezan/domain";
import {
  MEZAN_APP_VERSION_CHANNEL,
  MEZAN_LICENCE_IMPORT_CHANNEL,
  MEZAN_LICENCE_STATUS_CHANNEL,
  MEZAN_SUPPORT_DELETE_CHANNEL,
  type LicenceImportResult,
  type LicenceStatusResult,
  type SupportActionResult,
} from "../shared/ipc-contract.js";
import type { LanHostHandle } from "./lan-host.js";
import type { DesktopLicense } from "./license.js";

/**
 * The only path by which a licence verdict, the machine fingerprint or the LAN
 * address reaches a screen. All three live in the main process — the licence is
 * verified before the backend exists, and the bound address lives on the
 * `LanHostHandle` — so if this channel gets it wrong there is no second source
 * to correct it. That is exactly what went wrong: it reported
 * `diagnoseDesktopEntitlements()`, which reads the dev-only
 * `MEZAN_ENTITLEMENTS_JSON`, while the write gate ran off the signed file, so
 * one install answered `LIC-MISSING` here and ACTIVE at every save.
 */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const handlers = new Map<string, Handler>();
const showOpenDialog = vi.fn();
const showSaveDialog = vi.fn();
const showItemInFolder = vi.fn();

let userDataDir = "";

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
  app: {
    getVersion: () => "2026.9.0",
    getPath: () => userDataDir,
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
  },
  shell: {
    showItemInFolder: (...args: unknown[]) => showItemInFolder(...args),
  },
}));

/**
 * A stand-in for the Electron invoke event, carrying the renderer frame the
 * `guarded` wrapper (main/ipc-guard.ts, audit S-5) checks. `null` used to do —
 * it no longer does, because a channel that answers a frame it cannot identify
 * is the finding.
 */
const RENDERER_EVENT = { senderFrame: { url: "app://mezan/index.html" } } as never;

const { registerLicenceStatusOverIpc, licenceCodeFor } = await import("./licence-ipc.js");

const GRANT: SessionGrant = {
  userId: "USER-ADMIN",
  permissions: ["*"],
  roleCode: null,
  branchScope: "*",
  warehouseScope: "*",
};

function fakeSessions(): SessionRegistry {
  return {
    issue: () => "unused",
    find: (token: string) => (token === "good-token" ? GRANT : null),
    inspect: (token: string) => ({ grant: token === "good-token" ? GRANT : null, refusal: null }),
    revoke: () => {},
    revokeUser: () => {},
  };
}

function licenceOf(params: {
  state: string;
  reason?: string | null;
  canWrite?: boolean;
  plan?: string;
  seats?: number;
  modules?: readonly string[];
  expiresAt?: string | null;
  fingerprint?: string | null;
}): DesktopLicense {
  return {
    entitlements: createEntitlements({
      plan: params.plan ?? "PRO",
      activeModules: params.modules ?? ["sales", "inventory"],
      features: {},
      seats: params.seats ?? 3,
      expiresAt: params.expiresAt ?? null,
    }),
    state: {
      state: params.state,
      canWrite: params.canWrite ?? true,
      usable: true,
      ...(params.reason ? { reason: params.reason } : {}),
      ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      fingerprint: params.fingerprint === undefined ? "salted-fingerprint-hash" : params.fingerprint,
    },
    verified: true,
    identity: {
      licenseId: "LIC-1",
      fingerprint: params.fingerprint === undefined ? "salted-fingerprint-hash" : params.fingerprint,
      notBefore: null,
      expiresAt: params.expiresAt ?? null,
      graceDays: 14,
    },
  } as unknown as DesktopLicense;
}

function lanHandle(overrides: Partial<LanHostHandle>): LanHostHandle {
  return {
    enabled: true,
    ready: Promise.resolve(null),
    address: () => ({ address: "192.168.1.7", family: "IPv4", port: 4173 }),
    url: () => "https://192.168.1.7:4173",
    fingerprint: () =>
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
    closedReason: () => null,
    testReachability: async () => ({ reachable: true, address: "192.168.1.7:4173", detail: null }),
    close: async () => {},
    ...overrides,
  } as LanHostHandle;
}

type Deps = Parameters<typeof registerLicenceStatusOverIpc>[0];

function register(overrides: Partial<Deps> = {}): void {
  registerLicenceStatusOverIpc({
    licence: () => licenceOf({ state: "ACTIVE" }),
    reloadLicence: async () => licenceOf({ state: "ACTIVE" }),
    fingerprint: async () => "raw-machine-id",
    daysSinceCheckin: () => 2,
    dbPath: path.join(userDataDir, "mezan.db"),
    backupsDir: path.join(userDataDir, "backups"),
    plaintextArchivePath: () => null,
    seatsUsed: () => 1,
    lanHost: () => lanHandle({}),
    sessions: fakeSessions(),
    ...overrides,
  });
}

async function status(token: unknown): Promise<LicenceStatusResult> {
  const handler = handlers.get(MEZAN_LICENCE_STATUS_CHANNEL);
  if (!handler) throw new Error("channel not registered");
  return (await handler(RENDERER_EVENT, token)) as LicenceStatusResult;
}

beforeEach(() => {
  handlers.clear();
  showOpenDialog.mockReset();
  showSaveDialog.mockReset();
  showItemInFolder.mockReset();
  userDataDir = mkdtempSync(path.join(tmpdir(), "mezan-licence-ipc-"));
  process.env["MEZAN_LICENSE_FILE"] = path.join(userDataDir, "license.mezan");
});

afterEach(() => {
  delete process.env["MEZAN_LICENSE_FILE"];
});

describe("licenceCodeFor — guards L-6", () => {
  it("maps every verified state onto the support code an owner reads to support", () => {
    expect(licenceCodeFor("ACTIVE", null)).toBe("LIC-OK");
    expect(licenceCodeFor("GRACE", null)).toBe("LIC-GRACE");
    expect(licenceCodeFor("READ_ONLY", "EXPIRED_PAST_GRACE")).toBe("LIC-EXPIRED");
    expect(licenceCodeFor("FINGERPRINT_MISMATCH", "MACHINE_NOT_BOUND")).toBe("LIC-MACHINE");
    expect(licenceCodeFor("TAMPERED", "CLOCK_ROLLBACK")).toBe("LIC-CLOCK");
    expect(licenceCodeFor("NOT_YET_VALID", "BEFORE_NOT_BEFORE")).toBe("LIC-NOTYET");
    expect(licenceCodeFor("INVALID", "BAD_SIGNATURE")).toBe("LIC-INVALID");
    expect(licenceCodeFor("INVALID", "parse error")).toBe("LIC-MALFORMED");
    expect(licenceCodeFor("UNLICENSED", "NO_LICENSE")).toBe("LIC-MISSING");
  });

  // A reason outranks the state: an overdue check-in and a revocation both
  // arrive as READ_ONLY, and «جدّد الترخيص» is the wrong instruction for either.
  it("lets the reason outrank the state — guards L-8", () => {
    expect(licenceCodeFor("READ_ONLY", "CHECKIN_OVERDUE")).toBe("LIC-CHECKIN");
    expect(licenceCodeFor("READ_ONLY", "REVOKED")).toBe("LIC-REVOKED");
    expect(licenceCodeFor("UNLICENSED", "NO_PUBLIC_KEY")).toBe("LIC-NOKEY");
  });
});

describe("registerLicenceStatusOverIpc", () => {
  it("refuses a caller with no session, rather than reporting the shop's address to it", async () => {
    register();
    for (const token of [undefined, "", "wrong-token", 42]) {
      const result = await status(token);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
    }
  });

  // guards L-6: the panel and the write gate must read ONE verdict.
  it("reports the VERIFIED licence — state, reason, plan, modules, seats, paths", async () => {
    register({
      licence: () =>
        licenceOf({
          state: "READ_ONLY",
          reason: "EXPIRED_PAST_GRACE",
          canWrite: false,
          plan: "ENTERPRISE",
          seats: 5,
          modules: ["sales", "manufacturing"],
          expiresAt: "2026-01-01T00:00:00.000Z",
        }),
      seatsUsed: () => 2,
    });

    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("LIC-EXPIRED");
    expect(result.state).toBe("READ_ONLY");
    expect(result.reason).toBe("EXPIRED_PAST_GRACE");
    expect(result.canWrite).toBe(false);
    expect(result.plan).toBe("ENTERPRISE");
    expect(result.seats).toBe(5);
    expect(result.seatsUsed).toBe(2);
    expect(result.modules).toEqual(["sales", "manufacturing"]);
    expect(result.expiresAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.appVersion).toBe("2026.9.0");
    expect(result.role).toBe("host");
    expect(result.licenceFilePath).toBe(path.join(userDataDir, "license.mezan"));
    expect(result.lan.url).toBe("https://192.168.1.7:4173");
  });

  // guards L-9: the one string support needs to reissue a licence for a
  // replacement machine, which nothing in the product could produce.
  it("carries the machine fingerprint, preferring the licence's own salted hash", async () => {
    register({
      licence: () => licenceOf({ state: "FINGERPRINT_MISMATCH", reason: "MACHINE_NOT_BOUND" }),
    });
    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("LIC-MACHINE");
    expect(result.fingerprint).toBe("salted-fingerprint-hash");
  });

  it("falls back to the raw machine id when no licence has been verified", async () => {
    register({
      licence: () => licenceOf({ state: "UNLICENSED", reason: "NO_LICENSE", fingerprint: null }),
    });
    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fingerprint).toBe("raw-machine-id");
  });

  // guards L-8: the day count reaches the screen instead of a console.warn.
  it("reports CHECKIN_OVERDUE with its day count and never says «renew»", async () => {
    register({
      licence: () => licenceOf({ state: "READ_ONLY", reason: "CHECKIN_OVERDUE", canWrite: false }),
      daysSinceCheckin: () => 12,
    });
    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe("LIC-CHECKIN");
    expect(result.daysSinceCheckin).toBe(12);
    expect(result.messageAr).toContain("12");
    expect(result.messageAr).not.toContain("جدّد");
  });

  // guards support #15: the two plaintext files reach a screen, not a console.
  it("reports the key card only while it is actually on disk", async () => {
    const dbPath = path.join(userDataDir, "mezan.db");
    register({ dbPath, plaintextArchivePath: () => "/tmp/old-plain.mezanbak" });

    const before = await status("good-token");
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.keyCardPath).toBeNull();
    expect(before.plaintextArchivePath).toBe("/tmp/old-plain.mezanbak");

    writeFileSync(path.join(userDataDir, "database-key.txt"), "key", "utf8");
    const after = await status("good-token");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.keyCardPath).toBe(path.join(userDataDir, "database-key.txt"));
  });

  it("reports a null address — never a guess — while the socket is not yet bound", async () => {
    register({
      lanHost: () => lanHandle({ address: () => null, url: () => null, fingerprint: () => null }),
    });
    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lan.listening).toBe(false);
    expect(result.lan.url).toBeNull();
    expect(result.lan.fingerprintSha256).toBeNull();
  });

  it("survives a LAN host that has not been started yet", async () => {
    register({ lanHost: () => undefined });
    const result = await status("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lan.listening).toBe(false);
    expect(result.lan.url).toBeNull();
    expect(result.lan.fingerprintSha256).toBeNull();
  });

  it("answers UNAVAILABLE, in Arabic, rather than rejecting across the bridge", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register({
      licence: () => {
        throw new Error("boom");
      },
    });
    const result = await status("good-token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAVAILABLE");
    expect(result.message).toMatch(/[؀-ۿ]/);
  });
});

/** guards L-5 / support #2 — the activation stub that reported its own success. */
describe("mezan:licence:import", () => {
  async function importLicence(token: unknown): Promise<LicenceImportResult> {
    const handler = handlers.get(MEZAN_LICENCE_IMPORT_CHANNEL);
    if (!handler) throw new Error("channel not registered");
    return (await handler(RENDERER_EVENT, token)) as LicenceImportResult;
  }

  it("refuses a caller with no session", async () => {
    register();
    const result = await importLicence("wrong-token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("UNAUTHORIZED");
  });

  it("copies nothing when the picker is cancelled", async () => {
    register();
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const result = await importLicence("good-token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CANCELLED");
    expect(existsSync(path.join(userDataDir, "license.mezan"))).toBe(false);
  });

  it("installs the chosen file and reports the verification's own verdict", async () => {
    const source = path.join(userDataDir, "from-support.mezan");
    writeFileSync(source, "payload.signature", "utf8");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] });
    register({
      reloadLicence: async () =>
        licenceOf({
          state: "ACTIVE",
          plan: "PRO",
          seats: 4,
          expiresAt: "2027-01-01T00:00:00.000Z",
        }),
    });

    const result = await importLicence("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toBe(true);
    expect(result.status.plan).toBe("PRO");
    expect(result.status.seats).toBe(4);
    expect(result.status.expiresAt).toBe("2027-01-01T00:00:00.000Z");
    expect(readFileSync(path.join(userDataDir, "license.mezan"), "utf8")).toBe("payload.signature");
  });

  // The whole finding: "a file was copied" is not "the licence took".
  it("reports accepted:false when the installed file does not verify", async () => {
    const source = path.join(userDataDir, "wrong.mezan");
    writeFileSync(source, "not-a-licence", "utf8");
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] });
    register({
      reloadLicence: async () =>
        licenceOf({ state: "INVALID", reason: "BAD_SIGNATURE", canWrite: false }),
    });

    const result = await importLicence("good-token");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accepted).toBe(false);
    expect(result.status.code).toBe("LIC-INVALID");
  });
});

describe("support channels", () => {
  it("answers the app version with no session — the login screen has none", async () => {
    register();
    const handler = handlers.get(MEZAN_APP_VERSION_CHANNEL);
    expect(handler).toBeDefined();
    expect(await handler?.(RENDERER_EVENT)).toBe("2026.9.0");
  });

  it("takes a target discriminator, never a renderer-supplied path", async () => {
    const dbPath = path.join(userDataDir, "mezan.db");
    const keyCard = path.join(userDataDir, "database-key.txt");
    const bystander = path.join(userDataDir, "not-yours.txt");
    writeFileSync(keyCard, "key", "utf8");
    writeFileSync(bystander, "keep me", "utf8");
    register({ dbPath });

    const handler = handlers.get(MEZAN_SUPPORT_DELETE_CHANNEL);
    if (!handler) throw new Error("channel not registered");

    const refused = (await handler(RENDERER_EVENT, "wrong-token", "key-card")) as SupportActionResult;
    expect(refused.ok).toBe(false);
    expect(existsSync(keyCard)).toBe(true);

    const ignored = (await handler(RENDERER_EVENT, "good-token", bystander)) as SupportActionResult;
    expect(ignored.ok).toBe(true);
    expect(existsSync(bystander)).toBe(true);

    const removed = (await handler(RENDERER_EVENT, "good-token", "key-card")) as SupportActionResult;
    expect(removed.ok).toBe(true);
    expect(existsSync(keyCard)).toBe(false);
  });
});

/** guards S-5 — no `ipcMain.handle` validated `event.senderFrame`. */
describe("who may invoke a licence channel", () => {
  it("refuses a frame that is not the Mezan renderer", async () => {
    register();
    const foreign = { senderFrame: { url: "https://example.test/x" } } as never;
    for (const channel of [MEZAN_LICENCE_STATUS_CHANNEL, MEZAN_APP_VERSION_CHANNEL]) {
      const handler = handlers.get(channel);
      expect(handler, channel).toBeDefined();
      expect(() => handler?.(foreign, "good-token")).toThrow(/may only be invoked by the Mezan renderer/);
    }
  });
});
