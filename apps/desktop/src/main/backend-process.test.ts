import { describe, expect, it, vi } from "vitest";
import { createEntitlements } from "@mezan/domain";
import type { BackendCallMessage, BridgePort } from "./backend-bridge.js";
import type { DesktopLicense } from "./license.js";

/**
 * guards Q-1 — the main-process half of the bridge.
 *
 * What the finding cost was not only latency: it was that ONE loop drove the
 * window, the LAN socket, the updater, the backup schedule and every SQLite
 * call, so a 1,129 ms `VACUUM INTO` froze the host UI and every till at once.
 * Moving the database out of that loop is only safe if this side keeps three
 * promises, and each of them is a test below:
 *
 *  1. every mount gets a REAL HTTP ANSWER at every moment, including before the
 *     worker has booted and after it has died — never a rejected IPC call,
 *     which reaches the shop as an English Electron internal;
 *  2. a request's status, headers and body survive the round trip, and a LAN
 *     request stays distinguishable from an in-process one;
 *  3. a crashed worker restarts ONCE and then says so in Arabic, rather than
 *     leaving the app silently dead or restarting for ever.
 */

vi.mock("electron", () => ({
  dialog: { showErrorBox: () => undefined },
  MessageChannelMain: class {},
  utilityProcess: { fork: () => undefined },
}));

const { startBackendProcess, BACKEND_CRASH_MESSAGE_AR } = await import("./backend-process.js");

const LICENCE = {
  entitlements: createEntitlements({
    plan: "pro",
    activeModules: ["sales"],
    features: {},
    seats: 2,
    expiresAt: null,
  }),
  state: { state: "ACTIVE", canWrite: true, usable: true, reason: null },
  verified: true,
  identity: { licenseId: "L-1", fingerprint: "f", expiresAt: null, notBefore: null },
} as unknown as DesktopLicense;

interface FakeWorker {
  readonly sent: unknown[];
  emit(message: unknown): void;
  exit(code: number | null): void;
  killed(): number;
}

function fakeWorkers(): { spawn: () => never; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const spawn = (): never => {
    let listener: ((event: { data: unknown }) => void) | undefined;
    let onExit: ((code: number | null) => void) | undefined;
    let kills = 0;
    const sent: unknown[] = [];
    workers.push({
      sent,
      emit: (message) => listener?.({ data: message }),
      exit: (code) => onExit?.(code),
      killed: () => kills,
    });
    const port: BridgePort = {
      postMessage: (message) => sent.push(message),
      on: (_event, l) => {
        listener = l;
      },
    };
    return {
      port,
      onExit: (l: (code: number | null) => void) => {
        onExit = l;
      },
      kill: () => {
        kills += 1;
      },
    } as never;
  };
  return { spawn: spawn as () => never, workers };
}

function start(overrides: Partial<Parameters<typeof startBackendProcess>[0]> = {}) {
  const { spawn, workers } = fakeWorkers();
  const logged: string[] = [];
  const handle = startBackendProcess({
    dbPath: "/tmp/mezan.db",
    cipherKey: "a".repeat(64),
    entitlements: LICENCE.entitlements,
    applyEntitlements: true,
    licence: LICENCE,
    userDataDir: "/tmp/userData",
    installedAt: null,
    env: { MEZAN_PACKAGED: "1", MEZAN_APP_VERSION: "2026.9.0", MEZAN_SCHEMA_VERSION: "42" },
    spawn: spawn as never,
    log: (line) => logged.push(line),
    ...overrides,
  });
  return { handle, workers, logged };
}

/** Answers the newest worker's pending call with `value`. */
function reply(worker: FakeWorker, value: unknown, index = worker.sent.length - 1): void {
  const message = worker.sent[index] as BackendCallMessage;
  worker.emit({ id: message.id, ok: true, value });
}

describe("the boot payload", () => {
  it("carries the unsealed key and structured-cloneable entitlements", () => {
    const { workers } = start();
    const payload = workers[0]!.sent[0] as Record<string, unknown>;
    expect(payload["cipherKey"]).toBe("a".repeat(64));
    expect(payload["dbPath"]).toBe("/tmp/mezan.db");
    expect(payload["env"]).toEqual({
      MEZAN_PACKAGED: "1",
      MEZAN_APP_VERSION: "2026.9.0",
      MEZAN_SCHEMA_VERSION: "42",
    });
    // The whole payload has to survive `postMessage`, which THROWS on a method.
    expect(() => structuredClone(payload)).not.toThrow();
  });
});

describe("before the worker is ready", () => {
  it("answers 503 in Arabic instead of rejecting", async () => {
    const { handle } = start();
    const response = await handle.app.fetch(new Request("http://mezan.local/customers"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("BACKEND_STARTING");
    expect(body.message).toMatch(/جارٍ تشغيل قاعدة البيانات/u);
  });

  it("refuses a LAN caller rather than authorising one it cannot check", async () => {
    const { handle } = start();
    const request = new Request("http://mezan.local/customers", {
      headers: { authorization: "Bearer t" },
    });
    await expect(handle.authorizeLanClient(request, "192.168.1.40")).resolves.toBe(false);
  });
});

describe("once the worker is ready", () => {
  it("round-trips status, headers and body", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    const pending = handle.app.fetch(new Request("http://mezan.local/customers"));
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    const call = worker.sent[1] as BackendCallMessage;
    expect(call.call).toMatchObject({ op: "fetch", method: "GET", remoteAddress: null });
    worker.emit({
      id: call.id,
      ok: true,
      value: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: new TextEncoder().encode(`[{"id":"c1"}]`),
      },
    });

    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual([{ id: "c1" }]);
  });

  /** guards Q-1 — `requestOrigin` reads the peer address off the env, and a
   * real Node socket cannot cross a process boundary. */
  it("carries the LAN peer address across the port", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    void handle.app.fetch(new Request("http://mezan.local/customers"), {
      incoming: { socket: { remoteAddress: "192.168.1.40" } },
    });
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    expect((worker.sent[1] as BackendCallMessage).call).toMatchObject({
      remoteAddress: "192.168.1.40",
    });
  });

  it("hands the seeded first-run password over exactly once", async () => {
    const { handle, workers } = start();
    workers[0]!.emit({ type: "ready", seededAdmin: { password: "pw-481920abc", generated: true } });
    await handle.ready;
    expect(handle.seededAdmin()).toEqual({ password: "pw-481920abc", generated: true });
    expect(handle.seededAdmin()).toBeNull();
  });

  it("asks the worker for the seat list rather than keeping a copy", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    const pending = handle.connectedDevices();
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    expect((worker.sent[1] as BackendCallMessage).call).toEqual({ op: "seats.list" });
    reply(worker, [{ userId: "u1", deviceLabel: "كاشير ٢" }]);
    await expect(pending).resolves.toEqual([{ userId: "u1", deviceLabel: "كاشير ٢" }]);
  });

  it("pushes a replaced licence as data, not as a view with methods", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    handle.replaceLicence(LICENCE);
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    const call = worker.sent[1] as BackendCallMessage;
    expect(call.call.op).toBe("licence.replace");
    expect(() => structuredClone(call)).not.toThrow();
  });

  it("refuses a LAN request with no bearer token without asking the worker", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    await expect(
      handle.authorizeLanClient(new Request("http://mezan.local/customers"), "192.168.1.40"),
    ).resolves.toBe(false);
    expect(worker.sent.length).toBe(1);
  });
});

describe("a worker that dies", () => {
  it("restarts once and boots the replacement with the same payload", async () => {
    const { handle, workers } = start();
    workers[0]!.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    workers[0]!.exit(1);
    expect(workers.length).toBe(2);
    expect(workers[1]!.sent[0]).toMatchObject({ dbPath: "/tmp/mezan.db" });
  });

  it("shows an Arabic dialog on the second death and stops restarting", async () => {
    const fatal: { message: string; detail: string }[] = [];
    const { handle, workers } = start({
      onFatal: (message, detail) => fatal.push({ message, detail }),
    });
    workers[0]!.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    workers[0]!.exit(1);
    workers[1]!.exit(1);

    expect(workers.length).toBe(2);
    expect(fatal).toHaveLength(1);
    expect(fatal[0]!.message).toBe(BACKEND_CRASH_MESSAGE_AR);
    expect(fatal[0]!.message).toMatch(/توقّف محرّك قاعدة البيانات/u);

    const response = await handle.app.fetch(new Request("http://mezan.local/customers"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "BACKEND_UNAVAILABLE" });
  });

  it("a refused boot — an upgrade that rolled back — is not retried, and every answer says the data is untouched", async () => {
    const fatal: string[] = [];
    const { handle, workers } = start({
      onFatal: (message) => fatal.push(message),
      preUpdateArchivePath: () => "/backups/pre-update-2026.9.0.mezan-backup",
    });
    const refusal = "تعذّر تحديث قاعدة البيانات إلى هذا الإصدار من ميزان. بياناتك لم تُمَسّ";
    workers[0]!.emit({ type: "boot-error", error: refusal, refusal: { code: "SCHEMA_UPGRADE_FAILED", message: refusal, messageEn: "The database could not be upgraded." } });
    await handle.ready;
    workers[0]!.exit(1);

    expect(workers.length).toBe(1);
    expect(fatal).toEqual([]);
    expect(handle.bootRefusal()).toMatchObject({ code: "SCHEMA_UPGRADE_FAILED" });
    const response = await handle.app.fetch(new Request("http://mezan.local/bootstrap/status"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("SCHEMA_UPGRADE_FAILED");
    expect(body.message).toContain("بياناتك لم تُمَسّ");
    expect(body.message).toContain("/backups/pre-update-2026.9.0.mezan-backup");
    expect(body.messageEn).toContain("could not be upgraded");
  });

  it("settles the calls that were in flight rather than leaving them hanging", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    const pending = handle.app.fetch(new Request("http://mezan.local/customers"));
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    worker.exit(1);

    const response = await pending;
    expect(response.status).toBe(503);
  });
});

describe("closing before a restore", () => {
  /**
   * guards Q-1 and the restore invariant it inherits: `restoreBackup` replaces
   * the database file, and a worker still holding the old handle would go on
   * writing into an unlinked inode — the restore appears to work and the next
   * launch shows the old data.
   */
  it("asks the worker to close the database, then kills it", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    const closing = handle.close();
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    expect((worker.sent[1] as BackendCallMessage).call).toEqual({ op: "close" });
    reply(worker, null);
    await closing;
    expect(worker.killed()).toBe(1);
  });

  it("does not restart a worker that exits because it was told to close", async () => {
    const { handle, workers } = start();
    const worker = workers[0]!;
    worker.emit({ type: "ready", seededAdmin: null });
    await handle.ready;

    const closing = handle.close();
    await vi.waitFor(() => expect(worker.sent.length).toBe(2));
    reply(worker, null);
    await closing;
    worker.exit(0);
    expect(workers.length).toBe(1);
  });
});
