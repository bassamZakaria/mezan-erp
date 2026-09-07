import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicKeyAsync } from "@noble/ed25519";
import { bytesToHex, signCheckinResponse } from "@mezan/domain";
import type { SessionGrant, SessionRegistry } from "@mezan/api";
import {
  MEZAN_LICENCE_CHECKIN_CHANNEL,
  type LicenceCheckinResult,
} from "../shared/ipc-contract.js";
import { createLicenseGuardStore, EMPTY_GUARD_RECORD } from "./license-checkin.js";

/**
 * `mezan:licence:checkin` — the operator pressing «تحقق الآن», which is the
 * only way a shop on the phone to support can clear an overdue window.
 *
 * Two findings meet here. L-7: the handler wrote the file and the write gate
 * never re-read it, so «تم التحقق بنجاح» was followed by another refused save.
 * L-11: a caught Error's English text was interpolated into the Arabic message,
 * and on a shipped install that was the only variant possible.
 */
type Handler = (event: unknown, ...args: unknown[]) => Promise<LicenceCheckinResult>;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
  },
}));

/**
 * A stand-in for the Electron invoke event, carrying the renderer frame the
 * `guarded` wrapper (main/ipc-guard.ts, audit S-5) checks. `null` used to do —
 * it no longer does, because a channel that answers a frame it cannot identify
 * is the finding.
 */
const RENDERER_EVENT = { senderFrame: { url: "app://mezan/index.html" } } as never;

const { registerLicenceCheckinOverIpc } = await import("./licence-ipc.js");

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

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});
beforeEach(() => handlers.clear());

async function scratchStore() {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-checkin-ipc-"));
  dirs.push(dir);
  const store = createLicenseGuardStore({ dir, macKey: "aa".repeat(16) });
  store.write({ ...EMPTY_GUARD_RECORD, installedAt: "2026-01-01T00:00:00.000Z" });
  return store;
}

function call(token: unknown): Promise<LicenceCheckinResult> {
  const handler = handlers.get(MEZAN_LICENCE_CHECKIN_CHANNEL);
  if (!handler) throw new Error("channel not registered");
  return handler(RENDERER_EVENT, token);
}

describe("registerLicenceCheckinOverIpc", () => {
  it("refuses a caller with no session", async () => {
    registerLicenceCheckinOverIpc({
      guard: await scratchStore(),
      installedAtFallback: null,
      endpoint: undefined,
      licenseId: null,
      fingerprint: null,
      publicKey: null,
      sessions: fakeSessions(),
      log: () => {},
    });
    const result = await call("wrong-token");
    expect(result.reachedServer).toBe(false);
    expect(result.messageAr).toMatch(/[؀-ۿ]/);
  });

  /** guards L-7: the successful check-in has to land in the record the gate reads. */
  it("records a verified check-in so the write gate sees it without a restart", async () => {
    const secret = new Uint8Array(32).fill(4);
    const publicKey = bytesToHex(await getPublicKeyAsync(secret));
    const serverTime = "2026-09-10T00:00:00.000Z";
    const signature = await signCheckinResponse(
      { licenseId: "lic-1", fingerprint: "fp-1", revoked: false, serverTime },
      secret,
    );
    const guard = await scratchStore();

    registerLicenceCheckinOverIpc({
      guard,
      installedAtFallback: "2026-01-01T00:00:00.000Z",
      endpoint: "https://licence.example/checkin",
      licenseId: "lic-1",
      fingerprint: "fp-1",
      publicKey,
      sessions: fakeSessions(),
      log: () => {},
    });
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ revoked: false, serverTime, signature }), { status: 200 }),
    );

    const result = await call("good-token");
    expect(result.reachedServer).toBe(true);
    expect(guard.read().record.lastVerifiedAt).toBe(serverTime);
    vi.unstubAllGlobals();
  });

  /** guards L-11 */
  it("answers in Arabic with a mapped cause, never a caught Error's English text", async () => {
    registerLicenceCheckinOverIpc({
      guard: await scratchStore(),
      installedAtFallback: "2026-01-01T00:00:00.000Z",
      // The shipped-install case: no endpoint was baked into this build.
      endpoint: undefined,
      licenseId: "lic-1",
      fingerprint: "fp-1",
      publicKey: "aa".repeat(32),
      sessions: fakeSessions(),
      log: () => {},
    });

    const result = await call("good-token");
    expect(result.reachedServer).toBe(false);
    expect(result.messageAr).toMatch(/[؀-ۿ]/);
    expect(result.messageAr).not.toContain("no check-in endpoint");
    expect(result.messageAr).not.toMatch(/[A-Za-z]{4,}/);
  });
});
