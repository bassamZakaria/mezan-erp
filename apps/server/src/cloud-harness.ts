import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCloudApp, type CloudApp, type CreateCloudAppOptions } from "./cloud-app.js";
import { parseEnv, type CloudEnv } from "./env.js";
import { originEnv, type CloudSource } from "./client-source.js";

export const HARNESS_PROXY_HOP = "130.176.1.1";
export const HARNESS_CLIENT = "41.33.10.10";
export const HARNESS_OWNER_EMAIL = "owner@mezan.local";
export const HARNESS_OWNER_PASSWORD = "owner-password-123";
const HARNESS_HOPS = "2";

export interface SendInit extends RequestInit {
  readonly token?: string;
  readonly tenant?: string;
  /** The address the outer proxy saw. Defaults to one fixed client. */
  readonly client?: string;
  /** The whole `x-forwarded-for` value, for a test about a malformed chain. `null` sends none. */
  readonly chain?: string | null;
}

export interface CloudHarness {
  readonly app: CloudApp;
  readonly env: CloudEnv;
  send(pathname: string, init?: SendInit): Promise<Response>;
  platformToken(): Promise<string>;
  close(): Promise<void>;
}

/** A request as the deployed stack delivers it: no socket under it, the caller's address in a two-hop forwarded chain. */
export function proxiedRequest(pathname: string, init: SendInit = {}): Request {
  const { token, tenant, client, chain, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (tenant) headers.set("x-mezan-tenant", tenant);
  const forwarded = chain === undefined ? `${client ?? HARNESS_CLIENT}, ${HARNESS_PROXY_HOP}` : chain;
  if (forwarded !== null) headers.set("x-forwarded-for", forwarded);
  return new Request(`http://cloud.internal${pathname}`, { ...rest, headers });
}

export function harnessEnv(vars: Record<string, string | undefined> = {}, overrides: Partial<CloudEnv> = {}, dirs: string[] = []): CloudEnv {
  const platformDir = mkdtempSync(path.join(tmpdir(), "mezan-harness-platform-"));
  const webDist = mkdtempSync(path.join(tmpdir(), "mezan-harness-web-"));
  dirs.push(platformDir, webDist);
  writeFileSync(path.join(webDist, "index.html"), "<!doctype html><body>مزان</body>");
  return {
    ...parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: HARNESS_HOPS, ...vars }),
    platformDir,
    webDist,
    platformOwnerEmail: HARNESS_OWNER_EMAIL,
    platformOwnerPassword: HARNESS_OWNER_PASSWORD,
    backupIntervalMinutes: 0,
    ...overrides,
  };
}

export async function bootCloudHarness(
  input: { vars?: Record<string, string | undefined>; env?: Partial<CloudEnv>; options?: CreateCloudAppOptions } = {},
): Promise<CloudHarness> {
  const dirs: string[] = [];
  const env = harnessEnv(input.vars, input.env, dirs);
  const app = await createCloudApp(env, input.options);
  const send = (pathname: string, init: SendInit = {}) => Promise.resolve(app.root.fetch(proxiedRequest(pathname, init)));
  return {
    app,
    env,
    send,
    async platformToken() {
      const res = await send("/api/platform/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: HARNESS_OWNER_EMAIL, password: HARNESS_OWNER_PASSWORD }),
      });
      return ((await res.json()) as { token: string }).token;
    },
    async close() {
      await app.close();
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const HARNESS_SOCKET_PEER = "10.0.9.9";

interface Fetchable {
  fetch(request: Request, env?: unknown, ctx?: never): Response | Promise<Response>;
}

/**
 * Gives every request to `app` a caller address unless the test names one: a
 * full forwarded chain where `hops` proxies are trusted, a socket peer where
 * none is. A test that forgets its address would otherwise be testing the
 * refusal, not its subject.
 */
export function reachable<T extends Fetchable>(app: T, hops = 0): T {
  const raw = app.fetch.bind(app);
  app.fetch = (request, env, ctx) => {
    if (hops === 0) return raw(request, env ?? originEnv(HARNESS_SOCKET_PEER as CloudSource), ctx);
    if (request.headers.has("x-forwarded-for")) return raw(request, env, ctx);
    const headers = new Headers(request.headers);
    const proxies = Array.from({ length: hops - 1 }, () => HARNESS_PROXY_HOP);
    headers.set("x-forwarded-for", [HARNESS_CLIENT, ...proxies].join(", "));
    return raw(new Request(request, { headers }), env, ctx);
  };
  return app;
}
