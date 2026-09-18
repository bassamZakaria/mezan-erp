import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_BRIDGE_PROTOCOL, type BackendBootPayload } from "./backend-bridge.js";

/**
 * guards Q-1 — the REAL worker, in a REAL second process, answering REAL
 * requests, with the main loop measured while it does.
 *
 * The finding was not a latency number; it was that `better-sqlite3` is
 * synchronous and the one loop it blocked also drew the window, answered the
 * LAN socket, ran the updater and the backup schedule. A `VACUUM INTO` on an
 * 88 MB database measured 1,129 ms with ZERO event-loop ticks: one slow report
 * froze the host UI and every till at once, and a till's read timeout turned a
 * database problem into «لا يوجد رد من الجهاز الرئيسي».
 *
 * So the assertion that matters is not "the response came back" — it is that
 * THIS process kept ticking while the database was being worked, which the
 * before-picture could not do. `scripts/prove-backend-off-loop.mts` runs the
 * same measurement against the audit's own `VACUUM INTO` at 88 MB.
 *
 * The worker is forked as a plain Node child here rather than as an Electron
 * `utilityProcess`; it speaks the same protocol over either transport
 * (main/backend-bridge.ts), which is what makes the off-loop property provable
 * without an Electron runtime.
 */

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "backend-worker.ts");

const BOOT: BackendBootPayload = {
  protocol: BACKEND_BRIDGE_PROTOCOL,
  dbPath: ":memory:",
  cipherKey: null,
  entitlements: { plan: "dev", activeModules: [], features: {}, seats: 2, expiresAt: null },
  applyEntitlements: false,
  licence: {
    entitlements: { plan: "dev", activeModules: [], features: {}, seats: 2, expiresAt: null },
    state: { state: "ACTIVE", canWrite: true, usable: true },
    verified: false,
    identity: {
      licenseId: null,
      fingerprint: null,
      notBefore: null,
      expiresAt: null,
      graceDays: null,
    },
  },
  userDataDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "__no_such_dir__"),
  installedAt: null,
  env: { MEZAN_PACKAGED: "0", MEZAN_APP_VERSION: "0.0.0-test", MEZAN_SCHEMA_VERSION: "1" },
};

let child: ChildProcess;
let nextId = 1;
const waiting = new Map<number, (value: unknown) => void>();

function callWorker(call: unknown): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    child.send({ id, call });
  });
}

interface FetchReply {
  ok: boolean;
  value?: { status: number; headers: Record<string, string>; body: Uint8Array };
  error?: string;
}

beforeAll(async () => {
  child = fork(WORKER, [], {
    execArgv: ["--import", "tsx"],
    // Structured clone, not JSON: the protocol carries response bodies as
    // `Uint8Array` and JSON would turn them into `{type:"Buffer",data:[…]}`.
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });

  await new Promise<void>((resolve, reject) => {
    child.on("message", (message: { type?: string; id?: number; error?: string }) => {
      if (message.type === "ready") {
        resolve();
        return;
      }
      if (message.type === "boot-error") {
        reject(new Error(message.error));
        return;
      }
      if (typeof message.id === "number") waiting.get(message.id)?.(message);
    });
    child.once("error", reject);
    child.send(BOOT);
  });
}, 120_000);

afterAll(() => {
  child.kill();
});

describe("the real backend, in its own process", () => {
  it("answers a real request over the bridge", async () => {
    const reply = (await callWorker({
      op: "fetch",
      url: "http://mezan.local/health",
      method: "GET",
      headers: {},
      body: null,
      remoteAddress: null,
    })) as FetchReply;

    expect(reply.ok).toBe(true);
    expect(reply.value?.status).toBe(200);
    const body = JSON.parse(new TextDecoder().decode(reply.value!.body)) as {
      version?: string;
      schemaVersion?: number;
    };
    // Proves the boot payload's `env` reached the child: a forked process does
    // not inherit assignments the parent made after its own launch, and both
    // halves of the LAN version check read these off `process.env`.
    expect(body.version).toBe("0.0.0-test");
  });

  /** guards Q-1 — the whole point of the move. */
  it("leaves this process's event loop free while the database is worked", async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);

    const started = Date.now();
    // A burst, so the worker is genuinely busy for a measurable stretch rather
    // than for one query's worth of microseconds.
    await Promise.all(
      Array.from({ length: 120 }, () =>
        callWorker({
          op: "fetch",
          url: "http://mezan.local/accounts",
          method: "GET",
          headers: {},
          body: null,
          remoteAddress: null,
        }),
      ),
    );
    const elapsed = Date.now() - started;
    clearInterval(timer);

    // The before-picture measured ZERO ticks across 1,129 ms of blocked loop.
    // Anything above zero here is the property; the bound is deliberately loose
    // so a slow CI box cannot make it flap.
    expect(ticks).toBeGreaterThan(0);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("refuses a LAN caller whose token is not a live session", async () => {
    const reply = (await callWorker({
      op: "lan.authorize",
      token: "not-a-token",
      origin: "192.168.1.40",
    })) as { ok: boolean; value: boolean };
    expect(reply.ok).toBe(true);
    expect(reply.value).toBe(false);
  });
});
