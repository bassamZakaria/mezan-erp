import type { Entitlements } from "@mezan/domain";
import type { DeviceSession } from "@mezan/domain";
import type { SessionGrant } from "@mezan/api";
import type { DesktopLicense } from "./license.js";

/**
 * The wire between the Electron main process and the process that actually owns
 * SQLite (main/backend-process.ts ⇄ main/backend-worker.ts).
 *
 * WHY THERE IS A WIRE AT ALL (docs/artifacts/audit-2026-09-07.md Q-1). The Hono
 * backend used to be composed in the main process and served from there twice —
 * over IPC to the renderer (main/ipc.ts) and over the LAN socket
 * (main/lan-host.ts). `better-sqlite3` is synchronous, so every query ran on the
 * one event loop that also drives the window, the LAN socket, the updater and
 * the backup schedule: a `VACUUM INTO` on an 88 MB database measured 1,129 ms
 * with ZERO event-loop ticks. One slow report froze the host UI and every till
 * at once, and a till's read timeout turned a database problem into «لا يوجد رد
 * من الجهاز الرئيسي».
 *
 * This module holds only the protocol — no `electron` import, no side effects —
 * so both ends and the tests share one definition of the messages, and neither
 * end can drift from it silently.
 */

/**
 * EXTERNAL CONTRACT between two processes that are bundled separately
 * (scripts/build.mjs emits `index.cjs` and `backend-worker.cjs` from one source
 * tree, but a half-installed update can pair mismatched copies). The worker
 * refuses a boot payload that does not carry this exact number rather than
 * running an older protocol against a newer main process.
 */
export const BACKEND_BRIDGE_PROTOCOL = 1;

/**
 * A `DesktopLicense` that can actually cross a MessagePort.
 *
 * `DesktopLicense.entitlements` is an `EntitlementsView`, i.e. a frozen object
 * carrying `has()` and `hasFeature()` METHODS — and structured clone throws
 * `DataCloneError` on a function rather than dropping it. Sending the licence
 * as-is would take the whole launch down; sending the raw data and rebuilding
 * the view on the far side is the only shape that works.
 */
export type CloneableLicence = Omit<DesktopLicense, "entitlements"> & {
  readonly entitlements: Entitlements;
};

/** Strips `createEntitlements`' convenience methods back to plain data. */
export function toRawEntitlements(view: Entitlements): Entitlements {
  return {
    plan: view.plan,
    activeModules: [...view.activeModules],
    features: { ...view.features },
    seats: view.seats,
    expiresAt: view.expiresAt,
  };
}

export function toCloneableLicence(licence: DesktopLicense): CloneableLicence {
  return { ...licence, entitlements: toRawEntitlements(licence.entitlements) };
}

/**
 * What the main process hands the worker once, at startup, over the port.
 *
 * `cipherKey` IS THE DATABASE ENCRYPTION KEY IN THE CLEAR. It is unsealed in
 * the main process (only that side has Electron's `safeStorage`) and travels
 * over a private, in-memory MessagePort to a child of this same process. It is
 * never written to disk, never logged, and never leaves this pair.
 */
export interface BackendBootPayload {
  readonly protocol: number;
  readonly dbPath: string;
  /** Null on an unencrypted (`--allow-unencrypted-database`) or dev install. */
  readonly cipherKey: string | null;
  /**
   * RAW entitlement data, never an `EntitlementsView`. The view carries `has()`
   * and `hasFeature()` methods, and structured clone drops methods silently —
   * a cloned view answers `undefined` to every module check, which would open
   * every gated module on a licence that does not carry it. The worker rebuilds
   * the view with `createEntitlements`.
   */
  readonly entitlements: Entitlements;
  /**
   * Whether those entitlements should GATE modules. Mirrors `license.verified`:
   * an unpackaged dev run and a packaged install awaiting activation both pass
   * false, so the API keeps its own all-modules default and an absent licence
   * never withholds a shop's own data.
   */
  readonly applyEntitlements: boolean;
  /** The verified licence, for the per-request write gate. */
  readonly licence: CloneableLicence;
  /** Where the anti-rollback guard record lives; the worker re-reads it per request. */
  readonly userDataDir: string;
  /** `license.identity.notBefore` fallback for a guard record with no install stamp. */
  readonly installedAt: string | null;
  /**
   * `MEZAN_PACKAGED`, `MEZAN_APP_VERSION`, `MEZAN_SCHEMA_VERSION`. The seed and
   * `GET /health` read these off `process.env`, and a forked child does not
   * inherit assignments the parent made after its own launch.
   */
  readonly env: Record<string, string>;
}

/** One request from the main process to the worker. */
export type BackendCall =
  | {
      readonly op: "fetch";
      readonly url: string;
      readonly method: string;
      readonly headers: Record<string, string>;
      readonly body: Uint8Array | null;
      /**
       * The peer address when this arrived over the LAN socket, null when it
       * came from the renderer's in-process mount. The worker rebuilds the
       * `{ incoming: { socket: { remoteAddress } } }` shape
       * `packages/api/src/request-origin.ts` reads, because a real Node socket
       * cannot cross a process boundary and the presence of an address IS the
       * answer to "did this arrive over the network".
       */
      readonly remoteAddress: string | null;
    }
  | {
      readonly op: "fetch.toFile";
      readonly request: Omit<Extract<BackendCall, { op: "fetch" }>, "op">;
      readonly filePath: string;
    }
  | { readonly op: "session.find"; readonly token: string }
  | { readonly op: "lan.authorize"; readonly token: string; readonly origin: string }
  | { readonly op: "seats.list" }
  | { readonly op: "licence.replace"; readonly licence: CloneableLicence }
  /**
   * Closes the SQLite connection and lets the worker exit. REQUIRED before a
   * restore: `restoreBackup` replaces the database file, and a worker still
   * holding the old handle would go on writing into an unlinked inode — the
   * restore appears to work and the next launch shows the old data
   * (main/restore-ipc.ts's `closeLiveConnections`).
   */
  | { readonly op: "close" };

export interface BackendCallMessage {
  readonly id: number;
  readonly call: BackendCall;
}

export interface BridgeFetchResult {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}

export type BackendCallResult =
  | BridgeFetchResult
  | SessionGrant
  | readonly DeviceSession[]
  | boolean
  | null;

export type BackendReplyMessage =
  | { readonly id: number; readonly ok: true; readonly value: BackendCallResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** Unsolicited worker → main messages. */
export enum BackendBootRefusalCode {
  SchemaUpgradeFailed = "SCHEMA_UPGRADE_FAILED",
  SchemaTooNew = "SCHEMA_TOO_NEW",
}

export interface BackendBootRefusal {
  readonly code: BackendBootRefusalCode;
  readonly message: string;
  readonly messageEn: string;
}

export type BackendNotice =
  | {
      readonly type: "ready";
      /**
       * `takeSeededAdminSecrets()` is a one-shot read inside @mezan/backend, and
       * the seed now runs in the worker — so the first-run password would be read by
       * nobody if it did not travel. main/index.ts writes the recovery file.
       */
      readonly seededAdmin: { readonly password: string; readonly generated: boolean } | null;
    }
  | { readonly type: "boot-error"; readonly error: string; readonly refusal?: BackendBootRefusal | null };

export type BackendWorkerMessage = BackendReplyMessage | BackendNotice;

/**
 * The subset of Electron's `MessagePortMain` this bridge uses, so the worker can
 * also run under a plain `child_process.fork` (the proof script and the tests)
 * without either end knowing which transport it got.
 */
export interface BridgePort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  start?(): void;
  close?(): void;
}

/**
 * What the two mounts (main/ipc.ts, main/lan-host.ts) actually need of the
 * backend: one `fetch`. It used to be `@mezan/api`'s `App`, i.e. the whole Hono
 * instance, which is no longer in this process at all — narrowing it here is
 * what lets the same two mounts serve either a real in-process app (the
 * headless demo, every test) or the bridged one, with no branch of their own.
 */
export interface FetchLike {
  fetch(request: Request, env?: unknown): Response | Promise<Response>;
}

/**
 * Reading the caller's grant, from wherever the session registry now lives.
 *
 * The IPC channels that carry a session token — restore, licence status,
 * check-in — used to hold the registry object itself and call `find` inline.
 * The registry moved into the backend process with the database (Q-1), so the
 * answer arrives over the port and is therefore a promise. The union keeps a
 * real `SessionRegistry` assignable, which is what the headless demo and every
 * test still pass.
 */
export interface SessionLookup {
  find(token: string): SessionGrant | null | Promise<SessionGrant | null>;
}

export function isBackendNotice(message: unknown): message is BackendNotice {
  return typeof message === "object" && message !== null && "type" in message;
}

export function isBackendReply(message: unknown): message is BackendReplyMessage {
  return typeof message === "object" && message !== null && "id" in message && "ok" in message;
}

/**
 * A `Request` flattened into structured-clone-safe parts.
 *
 * The body is read to bytes here rather than forwarded as a stream: a
 * `ReadableStream` does not clone, and the LAN socket hands this a real
 * streamed request.
 */
export async function encodeBridgeRequest(
  request: Request,
  remoteAddress: string | null,
): Promise<Extract<BackendCall, { op: "fetch" }>> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : null;
  return {
    op: "fetch",
    url: request.url,
    method: request.method,
    headers,
    body,
    remoteAddress,
  };
}

/** Rebuilds a real `Request` on the worker side. */
export function decodeBridgeRequest(call: Extract<BackendCall, { op: "fetch" }>): Request {
  return new Request(call.url, {
    method: call.method,
    headers: call.headers,
    ...(call.body === null ? {} : { body: call.body }),
  });
}

/** Rebuilds a real `Response` on the main-process side. */
export function decodeBridgeResponse(result: BridgeFetchResult): Response {
  return new Response(result.body, { status: result.status, headers: result.headers });
}

/**
 * The `env` a Hono handler sees, reconstructed from the peer address alone.
 *
 * SECURITY CONTRACT: `requestOrigin` (packages/api/src/request-origin.ts) treats
 * the PRESENCE of `incoming.socket.remoteAddress` as proof that a request came
 * over the network rather than from the renderer's in-process mount, and every
 * origin-bound session check depends on it. `null` must therefore produce NO
 * env at all, never an env with an empty address.
 */
export function bridgeEnv(remoteAddress: string | null): unknown {
  return remoteAddress === null ? undefined : { incoming: { socket: { remoteAddress } } };
}
