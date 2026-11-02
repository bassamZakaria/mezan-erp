import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dialog, MessageChannelMain, utilityProcess } from "electron";
import type { DeviceSession, Entitlements } from "@mezan/domain";
import type { SessionGrant } from "@mezan/api";
import {
  BACKEND_BRIDGE_PROTOCOL,
  BackendBootRefusalCode,
  decodeBridgeResponse,
  encodeBridgeRequest,
  isBackendNotice,
  isBackendReply,
  type BackendBootPayload,
  type BackendBootRefusal,
  type BackendCall,
  type BackendNotice,
  type BackendReplyMessage,
  type BridgeFetchResult,
  toCloneableLicence,
  toRawEntitlements,
  type BridgePort,
  type CloneableLicence,
  type FetchLike,
} from "./backend-bridge.js";
import { readBearerToken } from "./lan-authorization.js";
import { createLineSplitter } from "./log.js";
import type { DesktopLicense } from "./license.js";

/**
 * THE MAIN-PROCESS HALF OF THE BRIDGE (docs/artifacts/audit-2026-09-07.md Q-1).
 *
 * `backend.app.fetch(request)` still exists and still returns a `Response`, so
 * main/index.ts, main/ipc.ts and main/lan-host.ts read almost exactly as they
 * did — the difference is that the call now crosses a MessagePort into
 * main/backend-worker.ts, where SQLite blocks a loop that drives nothing the
 * operator can see.
 *
 * WHAT THIS FILE OWES THE PRODUCT BEYOND THE ROUND TRIP:
 *
 *  - A REAL HTTP ANSWER AT EVERY MOMENT. Before the worker has booted, and
 *    after it has died, `fetch` answers 503 with an Arabic sentence rather than
 *    rejecting. A rejected `mezan:fetch` surfaces in the renderer as an English
 *    Electron internal on an Arabic screen (main/startup-busy.ts says the same
 *    thing about the pre-update backup window).
 *  - ONE RESTART, THEN A DIALOG. A worker that dies takes the whole product
 *    with it; restarting silently for ever hides a real fault, and not
 *    restarting at all turns a transient crash into a dead app. It restarts
 *    once and then says so, in Arabic, on screen.
 */

const STARTING_BODY = JSON.stringify({
  error: "BACKEND_STARTING",
  message: "جارٍ تشغيل قاعدة البيانات. ستفتح الشاشة تلقائياً خلال ثوانٍ.",
  messageEn: "The database is starting. The screen will open on its own in a few seconds.",
});

const DEAD_BODY = JSON.stringify({
  error: "BACKEND_UNAVAILABLE",
  message:
    "توقّف محرّك قاعدة البيانات ولم تنجح إعادة تشغيله. أغلق ميزان وأعد فتحه، " +
    "وإذا تكرّر الأمر أرسل سجل الأخطاء إلى الدعم.",
  messageEn:
    "The database engine stopped and could not be restarted. Close Mezan and open it again; " +
    "if it keeps happening, send the error log to support.",
});

export const BACKEND_CRASH_MESSAGE_AR =
  "توقّف محرّك قاعدة البيانات في ميزان مرتين متتاليتين ولم يعد يعمل. " +
  "أغلق البرنامج وأعد فتحه. إذا تكرّر الأمر أرسل سجل الأخطاء إلى الدعم.";

function unavailable(body: string): BridgeFetchResult {
  return {
    status: 503,
    headers: { "content-type": "application/json; charset=UTF-8", "retry-after": "5" },
    body: new TextEncoder().encode(body),
  };
}

/**
 * What `utilityProcess.fork` produces, reduced to what this module uses — so
 * the tests and the proof script under scripts/ can drive the same state
 * machine over a plain `child_process.fork` without an Electron runtime.
 */
export interface BackendTransport {
  readonly port: BridgePort;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type BackendTransportFactory = (entry: string) => BackendTransport;

type BackendStatus = "booting" | "ready" | "dead";

export interface BackendProcessOptions {
  readonly dbPath: string;
  readonly cipherKey: string | null;
  readonly entitlements: Entitlements;
  readonly applyEntitlements: boolean;
  readonly licence: DesktopLicense;
  readonly userDataDir: string;
  readonly installedAt: string | null;
  readonly env: Record<string, string>;
  /** Defaults to Electron's `utilityProcess`; injected by tests. */
  readonly spawn?: BackendTransportFactory;
  readonly preUpdateArchivePath?: () => string | null;
  /** Shown when the worker has died twice. Defaults to `dialog.showErrorBox`. */
  readonly onFatal?: (messageAr: string, detail: string) => void;
  readonly log?: (line: string) => void;
  readonly workerOutput?: WorkerOutputSink;
}

export interface BackendProcessHandle {
  /** The shape main/ipc.ts and main/lan-host.ts already consume. */
  readonly app: FetchLike;
  /** Resolves once the worker has answered `ready` (or failed to boot). */
  readonly ready: Promise<void>;
  bootRefusal(): BackendBootRefusal | null;
  /**
   * The seeded administrator's first-run temporary password, once — `takeSeededAdminSecrets()`
   * is a one-shot read inside @mezan/backend and the seed now runs in the
   * worker, so without this the password would be read by nobody and the owner would
   * meet a login screen asking for a password never shown to anybody.
   */
  seededAdmin(): { readonly password: string; readonly generated: boolean } | null;
  /** `SessionRegistry.find`, across the port. */
  findSession(token: string): Promise<SessionGrant | null>;
  /** The LAN gate: a live session for this origin whose user still holds a seat. */
  authorizeLanClient(request: Request, remote: string): Promise<boolean>;
  connectedDevices(): Promise<readonly DeviceSession[]>;
  /** Runs `request` in the worker and streams a successful body to `filePath` there; an error body comes back. */
  fetchToFile(request: Request, filePath: string): Promise<BridgeFetchResult>;
  /** Rebinds the licence the worker's per-request write gate resolves against. */
  replaceLicence(licence: DesktopLicense): void;
  /** Closes the database in the worker and waits for it to exit. */
  close(): Promise<void>;
}

/**
 * Same shape as the backup worker's resolver (backup/backup-service.ts): the
 * bundled `.cjs` beside this file in a packaged app, the TypeScript source
 * through tsx in a dev run. Either way the off-loop path is the real one and
 * not a production-only branch nothing exercises.
 */
export function resolveBackendWorkerEntry(): string {
  // `__dirname` FIRST, and it is not a style choice: scripts/build.mjs bundles
  // this module as CommonJS, and esbuild resolves `import.meta` to an empty
  // object in that format — `fileURLToPath(undefined)` throws, so a packaged
  // app would fail to locate its own worker. `__dirname` is real in the bundle
  // and absent under tsx, where `import.meta.url` is real.
  const here =
    typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  for (const built of ["backend-worker.cjs", "backend-worker.js"]) {
    const candidate = path.join(here, built);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(here, "backend-worker.ts");
}

export type WorkerOutputSink = (stream: "stdout" | "stderr", line: string) => void;

function electronTransport(entry: string, sink: WorkerOutputSink): BackendTransport {
  const { port1, port2 } = new MessageChannelMain();
  const child = utilityProcess.fork(entry, [], {
    serviceName: "mezan-backend",
    stdio: "pipe",
    // A dev run that has not been through scripts/build.mjs resolves the
    // TypeScript source, which Electron's own loader cannot execute.
    ...(entry.endsWith(".ts") ? { execArgv: ["--import", "tsx"] } : {}),
  });
  for (const stream of ["stdout", "stderr"] as const) {
    const splitter = createLineSplitter((line) => sink(stream, line));
    child[stream]?.on("data", (chunk: Buffer) => splitter.push(chunk));
    child.once("exit", () => splitter.flush());
  }
  child.postMessage(null, [port2]);
  port1.start();
  return {
    port: port1 as unknown as BridgePort,
    onExit: (listener) => {
      child.once("exit", (code: number) => listener(code));
    },
    kill: () => {
      child.kill();
    },
  };
}

export function startBackendProcess(options: BackendProcessOptions): BackendProcessHandle {
  const log = options.log ?? ((line: string) => console.warn(line));
  const sink: WorkerOutputSink =
    options.workerOutput ??
    ((stream, line) => (stream === "stderr" ? console.error(line) : console.log(line)));
  const spawn = options.spawn ?? ((entry: string) => electronTransport(entry, sink));
  const entry = resolveBackendWorkerEntry();

  let licence: CloneableLicence = toCloneableLicence(options.licence);

  const boot: BackendBootPayload = {
    protocol: BACKEND_BRIDGE_PROTOCOL,
    dbPath: options.dbPath,
    cipherKey: options.cipherKey,
    entitlements: toRawEntitlements(options.entitlements),
    applyEntitlements: options.applyEntitlements,
    licence,
    userDataDir: options.userDataDir,
    installedAt: options.installedAt,
    env: options.env,
  };

  let transport: BackendTransport | undefined;
  let status: BackendStatus = "booting";
  // Read through a call, never directly: an earlier `status !== "ready"` guard
  // narrows the variable for the rest of the function, and the whole point of a
  // `catch` here is that the worker may have died since that guard ran.
  const statusNow = (): BackendStatus => status;
  let restarts = 0;
  let seededAdmin: { password: string; generated: boolean } | null = null;
  let closing = false;
  let bootRefusal: BackendBootRefusal | null = null;
  let nextId = 1;

  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  let signalReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });

  const failAllWaiting = (reason: string): void => {
    const held = [...waiting.values()];
    waiting.clear();
    for (const call of held) call.reject(new Error(reason));
  };

  const onMessage = (event: { data: unknown }): void => {
    const message = event.data;
    if (isBackendNotice(message)) {
      const notice = message as BackendNotice;
      if (notice.type === "ready") {
        status = "ready";
        if (notice.seededAdmin) seededAdmin = { ...notice.seededAdmin };
        signalReady();
        return;
      }
      log(`[backend] the database worker failed to start: ${notice.error}`);
      bootRefusal = notice.refusal ?? null;
      status = "dead";
      failAllWaiting(notice.error);
      signalReady();
      return;
    }
    if (!isBackendReply(message)) return;
    const reply = message as BackendReplyMessage;
    const pending = waiting.get(reply.id);
    if (!pending) return;
    waiting.delete(reply.id);
    if (reply.ok) pending.resolve(reply.value);
    else pending.reject(new Error(reply.error));
  };

  const start = (): void => {
    transport = spawn(entry);
    transport.port.on("message", onMessage);
    transport.onExit((code) => {
      if (closing) return;
      failAllWaiting(`the database worker exited (code ${code ?? "unknown"})`);
      // A refusal is a decision about the FILE, not a crash: booting again would run the same upgrade into the same failure.
      if (bootRefusal) return;
      if (restarts >= 1) {
        status = "dead";
        log(`[backend] the database worker exited (code ${code ?? "unknown"}) and will NOT be restarted again.`);
        const fatal =
          options.onFatal ?? ((messageAr: string) => dialog.showErrorBox("ميزان", messageAr));
        try {
          fatal(BACKEND_CRASH_MESSAGE_AR, `[backend] worker exited twice (code ${code ?? "unknown"})`);
        } catch {
          // A headless or very early failure. The log line above still stands.
        }
        return;
      }
      restarts += 1;
      status = "booting";
      log(`[backend] the database worker exited (code ${code ?? "unknown"}) — restarting once.`);
      start();
    });
    transport.port.postMessage({ ...boot, licence });
  };

  start();

  const call = async <T>(payload: BackendCall): Promise<T> => {
    const live = transport;
    if (!live || status === "dead") throw new Error("the database worker is not running");
    const id = nextId++;
    return await new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      live.port.postMessage({ id, call: payload });
    });
  };

  const refusedBody = (refusal: BackendBootRefusal): string => {
    const archive = refusal.code === BackendBootRefusalCode.SchemaUpgradeFailed ? (options.preUpdateArchivePath?.() ?? null) : null;
    return JSON.stringify({
      error: refusal.code,
      message: archive ? `${refusal.message}\nنسخة ما قبل التحديث: ${archive}` : refusal.message,
      messageEn: archive ? `${refusal.messageEn}\nPre-update backup: ${archive}` : refusal.messageEn,
    });
  };
  const notServing = (): string => {
    if (bootRefusal) return refusedBody(bootRefusal);
    return statusNow() === "dead" ? DEAD_BODY : STARTING_BODY;
  };

  return {
    app: {
      async fetch(request: Request, env?: unknown): Promise<Response> {
        if (status !== "ready") {
          return decodeBridgeResponse(unavailable(notServing()));
        }
        const remote = (env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
          ?.incoming?.socket?.remoteAddress;
        const encoded = await encodeBridgeRequest(
          request,
          typeof remote === "string" && remote !== "" ? remote : null,
        );
        try {
          return decodeBridgeResponse(await call<BridgeFetchResult>(encoded));
        } catch (err) {
          // A dead worker must still LOOK like a server to both mounts: the
          // renderer reads `status` off every answer, and an IPC rejection
          // surfaces as an unhandled promise with an Electron-shaped message
          // instead of the screen's own error state.
          log(`[backend] ${request.method} ${new URL(request.url).pathname} failed: ${String(err)}`);
          return decodeBridgeResponse(unavailable(notServing()));
        }
      },
    },
    ready,
    bootRefusal: () => bootRefusal,
    seededAdmin: () => {
      const held = seededAdmin;
      seededAdmin = null;
      return held;
    },
    findSession: async (token) => {
      if (status !== "ready") return null;
      return await call<SessionGrant | null>({ op: "session.find", token });
    },
    authorizeLanClient: async (request, remote) => {
      if (status !== "ready") return false;
      const token = readBearerToken(request);
      if (!token) return false;
      return await call<boolean>({ op: "lan.authorize", token, origin: remote });
    },
    connectedDevices: async () => {
      if (status !== "ready") return [];
      return await call<readonly DeviceSession[]>({ op: "seats.list" });
    },
    fetchToFile: async (request, filePath) => {
      if (status !== "ready") return unavailable(notServing());
      const encoded = await encodeBridgeRequest(request, null);
      return await call<BridgeFetchResult>({
        op: "fetch.toFile",
        request: { url: encoded.url, method: encoded.method, headers: encoded.headers, body: encoded.body, remoteAddress: null },
        filePath,
      });
    },
    replaceLicence: (next) => {
      licence = toCloneableLicence(next);
      if (status !== "ready") return;
      void call<null>({ op: "licence.replace", licence }).catch((err: unknown) => {
        log(`[backend] could not push the replaced licence to the worker: ${String(err)}`);
      });
    },
    close: async () => {
      closing = true;
      if (status === "ready") {
        await call<null>({ op: "close" }).catch(() => undefined);
      }
      transport?.kill();
      transport = undefined;
      status = "dead";
      failAllWaiting("the database worker was closed");
    },
  };
}
