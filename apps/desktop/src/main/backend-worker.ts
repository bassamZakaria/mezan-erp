import { createBackend, takeSeededAdminSecrets, type BackendHandle } from "@mezan/backend";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { SchemaTooNewError, SchemaUpgradeFailedError } from "@mezan/persistence";
import {
  BACKEND_BRIDGE_PROTOCOL,
  BackendBootRefusalCode,
  bridgeEnv,
  decodeBridgeRequest,
  type BackendBootPayload,
  type BackendBootRefusal,
  type BackendCall,
  type BackendCallMessage,
  type BackendCallResult,
  type BridgePort,
  type CloneableLicence,
} from "./backend-bridge.js";
import { backupsDirBesideUserData, readBackupStatus } from "../backup/status.js";
import { authorizeSeatedSession } from "./lan-authorization.js";
import { cipherDriver } from "./encrypted-database.js";
import { createLicenseGuardStore, decideCheckin } from "./license-checkin.js";
import { reevaluateLicenseState, type DesktopLicense } from "./license.js";
import { MAX_RESPONSE_BYTES, tooLargeResponse } from "./lan-client.js";

/**
 * THE PROCESS THAT OWNS SQLITE (docs/artifacts/audit-2026-09-07.md Q-1).
 *
 * Everything that touches the database lives here — the Hono app, the seat
 * registry, the session registry, the entitlements and the event bus — so a
 * synchronous `better-sqlite3` call blocks THIS loop and not the one driving
 * the window, the LAN socket, the updater and the backup schedule. The finding
 * measured a `VACUUM INTO` on an 88 MB database at 1,129 ms with zero
 * event-loop ticks in the main process; one slow report froze the host UI and
 * every till at once.
 *
 * WHAT DELIBERATELY STAYS IN THE MAIN PROCESS: licence VERIFICATION and the
 * unsealing of the database key, because both need Electron's `safeStorage` and
 * `app.getPath`. The verified licence and the raw key arrive over the port. The
 * guard record behind the per-request write gate is a plain MAC'd file, and
 * re-reading it HERE is what keeps `resolveLicenseState` honest per request
 * rather than frozen at boot (L-3, L-7).
 *
 * Started by main/backend-process.ts and by nothing else.
 */

interface WorkerState {
  backend: BackendHandle;
  seats: SeatSessionRegistry;
  licence: CloneableLicence;
}

let state: WorkerState | undefined;

/**
 * The transport, whichever one this process got.
 *
 * Electron's `utilityProcess` hands a `MessagePortMain` through
 * `process.parentPort`; a plain `child_process.fork` — the proof script under
 * scripts/ and the tests — has no such thing and speaks over its own IPC
 * channel instead. Same protocol either way (main/backend-bridge.ts), so the
 * off-loop property is provable without an Electron runtime.
 */
function nodeChannelPort(): BridgePort | null {
  if (typeof process.send !== "function") return null;
  return {
    postMessage: (message: unknown) => {
      process.send?.(message);
    },
    on: (_event: "message", listener: (event: { data: unknown }) => void) => {
      process.on("message", (data: unknown) => listener({ data }));
    },
  };
}

async function boot(payload: BackendBootPayload): Promise<{ pin: string; generated: boolean } | null> {
  if (payload.protocol !== BACKEND_BRIDGE_PROTOCOL) {
    throw new Error(
      `backend bridge protocol mismatch: this worker speaks ${BACKEND_BRIDGE_PROTOCOL}, ` +
        `the main process sent ${payload.protocol}`,
    );
  }

  for (const [name, value] of Object.entries(payload.env)) process.env[name] = value;

  // Rebuilt here, never cloned: `EntitlementsView`'s `has`/`hasFeature` are
  // methods, structured clone drops methods, and a cloned view answers
  // undefined to every module check — i.e. it would open every gated module.
  const entitlements = createEntitlements(payload.entitlements);
  const seats = new SeatSessionRegistry(entitlements.seats);
  const guard = createLicenseGuardStore({ dir: payload.userDataDir, macKey: payload.cipherKey });
  // The view is rebuilt here for the same reason `entitlements` is: it crossed
  // the port as raw data because structured clone throws on a method.
  const liveLicence = (): DesktopLicense => {
    const held = state?.licence ?? payload.licence;
    return { ...held, entitlements: createEntitlements(held.entitlements) };
  };

  const backend = await createBackend({
    dbPath: payload.dbPath,
    ...(payload.cipherKey === null
      ? {}
      : { connection: { driver: cipherDriver, key: payload.cipherKey } }),
    lan: { resolveEntitlements: () => entitlements, registry: seats },
    backupStatus: () => readBackupStatus(backupsDirBesideUserData(payload.userDataDir)),
    standardRoles: {
      resolveEntitlements: () => {
        const held = liveLicence();
        return held.verified ? held.entitlements : null;
      },
    },
    ...(payload.applyEntitlements ? { entitlements } : {}),
    // PER REQUEST, exactly as it was when this ran in the main process: a guard
    // file read plus arithmetic, no signature check. Freezing it at boot is what
    // made «تحقق الآن» unable to lift read-only without a restart, and a licence
    // that expired mid-session never noticed.
    resolveLicenseState: () =>
      reevaluateLicenseState(liveLicence(), {
        now: Date.now(),
        checkin: decideCheckin({
          ...guard.read(),
          installedAtFallback: payload.installedAt,
          now: new Date(),
        }),
      }),
  });

  state = { backend, seats, licence: payload.licence };
  const seeded = takeSeededAdminSecrets();
  return seeded ? { pin: seeded.pin, generated: seeded.generated } : null;
}

export function bootRefusalOf(err: unknown): BackendBootRefusal | null {
  if (err instanceof SchemaUpgradeFailedError) {
    return { code: BackendBootRefusalCode.SchemaUpgradeFailed, message: err.message, messageEn: err.messageEn };
  }
  if (err instanceof SchemaTooNewError) {
    return {
      code: BackendBootRefusalCode.SchemaTooNew,
      message: err.message,
      messageEn: `This database was written by a newer version of Mezan. Open it with that version, or restore a backup taken with this one. Nothing in the file was changed. (schema ${err.fileVersion} > ${err.appSchemaVersion})`,
    };
  }
  return null;
}

async function run(call: BackendCall): Promise<BackendCallResult> {
  const live = state;
  if (!live) throw new Error("the backend worker has not booted");
  switch (call.op) {
    case "fetch": {
      const env = bridgeEnv(call.remoteAddress);
      const response = await live.backend.app.fetch(
        decodeBridgeRequest(call),
        env as Parameters<typeof live.backend.app.fetch>[1],
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const body = new Uint8Array(await response.arrayBuffer());
      // The 8 MB ceiling (Q-7), enforced HERE as well as at the two mounts: a
      // 37 MB body refused on the far side of the port has already been
      // materialised and copied for nothing. Both mounts still check what they
      // get back, so this narrows the waste without removing their guard.
      if (body.byteLength > MAX_RESPONSE_BYTES) {
        console.warn(
          `[backend] ${call.method} ${new URL(call.url).pathname} refused: ` +
            `${body.byteLength} bytes exceeds the ${MAX_RESPONSE_BYTES}-byte transfer limit`,
        );
        const refusal = tooLargeResponse();
        return {
          status: refusal.status,
          headers: refusal.headers,
          body: new TextEncoder().encode(refusal.body),
        };
      }
      return { status: response.status, headers, body };
    }
    case "session.find":
      return live.backend.sessions.find(call.token);
    case "lan.authorize":
      // ONE round trip, not two: the session lookup and the seat check are a
      // single decision, and splitting them across the port would let a seat be
      // reaped between the two halves. The policy itself stays in
      // main/lan-authorization.ts, where its tests are.
      return authorizeSeatedSession(
        {
          resolveSessionUser: (token, origin) =>
            live.backend.sessions.find(token, origin)?.userId ?? null,
          registry: live.seats,
        },
        call.token,
        call.origin,
      );
    case "seats.list":
      return live.seats.list();
    case "licence.replace":
      live.licence = call.licence;
      return null;
    case "close":
      live.backend.close();
      state = undefined;
      return null;
  }
}

function listen(port: BridgePort): void {
  port.start?.();
  /**
   * REQUIRED ORDERING. Calls that arrive while `createBackend` is still opening
   * the database are held, not dropped: the main process answers the renderer
   * 503 during the boot window but the LAN socket and the licence panel may
   * still ask, and a dropped call is a promise that never settles.
   */
  const pending: BackendCallMessage[] = [];
  let booting = false;

  const answer = async (message: BackendCallMessage): Promise<void> => {
    try {
      const value = await run(message.call);
      port.postMessage({ id: message.id, ok: true, value });
    } catch (err) {
      port.postMessage({
        id: message.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (message.call.op === "close") {
      // After the reply is on the wire, never before it: the main process waits
      // for this acknowledgement before it swaps the database file.
      setTimeout(() => process.exit(0), 0);
    }
  };

  port.on("message", (event) => {
    const data = event.data as Partial<BackendBootPayload & BackendCallMessage> | undefined;
    if (!data || typeof data !== "object") return;

    if (typeof data.protocol === "number") {
      if (booting || state) return;
      booting = true;
      void boot(data as BackendBootPayload)
        .then((seededAdmin) => {
          port.postMessage({ type: "ready", seededAdmin });
          const held = pending.splice(0, pending.length);
          for (const message of held) void answer(message);
        })
        .catch((err: unknown) => {
          port.postMessage({
            type: "boot-error",
            error: err instanceof Error ? err.message : String(err),
            refusal: bootRefusalOf(err),
          });
          setTimeout(() => process.exit(1), 0);
        });
      return;
    }

    if (typeof data.id !== "number" || !data.call) return;
    const message = data as BackendCallMessage;
    if (!state) {
      pending.push(message);
      return;
    }
    void answer(message);
  });
}

const parentPort = (process as unknown as { parentPort?: BridgePort }).parentPort;
if (parentPort) {
  // Electron's utilityProcess: the bridge port arrives as a transferable on the
  // first message, and everything after that flows over it.
  (
    parentPort as unknown as { once(event: "message", l: (e: { ports: BridgePort[] }) => void): void }
  ).once("message", (event) => {
    const port = event.ports[0];
    if (port) listen(port);
  });
} else {
  const channel = nodeChannelPort();
  if (channel) listen(channel);
}
