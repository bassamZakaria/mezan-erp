import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { hasFeature, LAN_MULTI_TILL_FEATURE, type Entitlements } from "@mezan/domain";
import type { App } from "@mezan/api";

const DEFAULT_LAN_HOST = "0.0.0.0";
const DEFAULT_LAN_PORT = 4173;

export interface LanHostOptions {
  /** The SAME Hono app instance the IPC bridge already serves in-process. */
  readonly app: App;
  readonly entitlements: Entitlements;
  /** Bind address. Defaults to 0.0.0.0 — every NIC, so other tills on the shop LAN can reach it. */
  readonly host?: string;
  /** Bind port. Defaults to 4173; pass 0 in tests for an OS-assigned ephemeral port. */
  readonly port?: number;
}

export interface LanHostHandle {
  readonly enabled: boolean;
  readonly host?: string;
  /** Resolves once the socket is actually bound (or immediately with null when !enabled). */
  readonly ready: Promise<AddressInfo | null>;
  /** The real bound address once listening (null before then, or when !enabled). */
  address(): AddressInfo | null;
  close(): Promise<void>;
}

const NOOP_HANDLE: LanHostHandle = {
  enabled: false,
  ready: Promise.resolve(null),
  address: () => null,
  close: async () => {},
};

/**
 * Binds the SAME shared Hono app (docs/plan.md §2.2's "one HTTP app, two
 * mount points") to a LAN-visible HTTP socket, ALONGSIDE — never instead of
 * — the host's own no-port IPC mount (main/ipc.ts). Tills/tablets on the shop
 * LAN then reach the exact app the host itself uses in-process, including
 * `/lan/sessions` seat enforcement, over plain http+SSE (§2.6, §6.3.3).
 *
 * Gated by the `lan.multi_till` license flag: when the resolved entitlements
 * don't carry it, this is a pure no-op — no socket is ever opened, so an
 * unlicensed install exposes nothing on the LAN. Closed by default, exactly
 * like every other license-gated capability in this codebase.
 *
 * Deliberately free of any `electron` import (unlike main/index.ts) so it is
 * exercised directly by vitest — same split as main/backup-hooks.ts.
 */
export function startLanHost(options: LanHostOptions): LanHostHandle {
  if (!hasFeature(options.entitlements, LAN_MULTI_TILL_FEATURE)) {
    return NOOP_HANDLE;
  }

  const hostname = options.host ?? DEFAULT_LAN_HOST;
  const port = options.port ?? DEFAULT_LAN_PORT;

  let resolveReady!: (info: AddressInfo) => void;
  const ready = new Promise<AddressInfo | null>((resolve) => {
    resolveReady = resolve;
  });

  // Node's `server.listen(port, host, cb)` only binds synchronously when no
  // hostname is given (or one that skips DNS lookup entirely); passing an
  // explicit hostname — which this always does, so the default 0.0.0.0 is
  // never silently swapped for Node's own default — defers the actual bind,
  // so callers that need the resolved address (tests; a future "show me the
  // LAN address" UI) must await `ready` rather than call `address()` right away.
  const server = serve({ fetch: options.app.fetch, hostname, port }, (info: AddressInfo) => {
    console.log(
      `[lan] multi-till host listening on http://${hostname}:${info.port} ` +
        `(seats=${options.entitlements.seats})`,
    );
    resolveReady(info);
  });

  return {
    enabled: true,
    host: hostname,
    ready,
    address: () => (server.address() as AddressInfo | null) ?? null,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
