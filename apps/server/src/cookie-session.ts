import { createHmac } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { generateCookie, getCookie } from "hono/cookie";
import { CSRF_HEADER, CsrfCookie, DEVICE_BINDING_HEADER, DEVICE_SECRET_HEADER, DeviceBinding, SessionRefusal } from "@mezan/contracts";
import { MAX_SESSION_MS, tokensMatch } from "@mezan/api";
import { recordSecurityEventOrFallback, type AuditSink } from "@mezan/domain";
import { requestHost, resolveTenantCode, type TenantResolverOptions } from "./tenant-resolver.js";

export enum SessionCookie {
  Tenant = "mezan_session",
  TenantDevice = "mezan_device",
  Platform = "mezan_platform_session",
  PlatformDevice = "mezan_platform_device",
}

export enum CookieRefusal {
  Csrf = "CSRF_REFUSED",
}

export enum CookieSecurityAction {
  CsrfRefused = "SESSION_CSRF_REFUSED",
  TenantMismatch = "SESSION_COOKIE_TENANT_MISMATCH",
}

interface CookieJar {
  readonly session: SessionCookie;
  readonly device: SessionCookie;
  readonly csrf: CsrfCookie;
  readonly path: string;
  readonly maxAgeSeconds: number;
  readonly signIn: readonly string[];
  readonly signOut: string;
}

const TENANT_PATH = "/api";
const PLATFORM_PATH = "/api/platform";
const CSRF_PATH = "/";
const SESSION_SEPARATOR = ".";
const UNSAFE_METHOD = /^(?!GET$|HEAD$|OPTIONS$)/;
const SAME_ORIGIN = "same-origin";
const NO_FETCH_SITE = "none";
const TENANT_MISMATCH_MESSAGE = "جلستك الحالية تخص شركة أخرى. افتح الشركة التي سجّلت الدخول إليها، أو سجّل الدخول إلى هذه الشركة.";
const TENANT_MISMATCH_MESSAGE_EN = "Your session belongs to another company. Open the company you signed in to, or sign in to this one.";

export interface CookieSessionOptions {
  readonly trustProxy: boolean;
  readonly tenantResolver: TenantResolverOptions;
  readonly platformMaxAgeMs: number;
  readonly audit: AuditSink;
  /** Must survive restarts: a key minted per process makes every open session's next write fail its CSRF check instead of answering "signed out". */
  readonly csrfKey: Buffer;
}

export interface CookieSessions {
  readonly tenant: MiddlewareHandler;
  readonly platform: MiddlewareHandler;
}

export function isHttps(request: Request, trustForwarded: boolean): boolean {
  const forwarded = trustForwarded ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : undefined;
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase().replace(/:\d+$/, "");
  } catch {
    return null;
  }
}

// SECURITY: a request a browser sends on its own from another site — or from a
// sibling tenant's subdomain, which is "same-site" — never passes. A client
// that sends neither header is not a browser acting for another page, and is
// still held to the CSRF token.
function fromThisOrigin(c: Context, trustProxy: boolean): boolean {
  const site = c.req.header("sec-fetch-site");
  if (site !== undefined && site !== SAME_ORIGIN && site !== NO_FETCH_SITE) return false;
  const origin = c.req.header("origin");
  if (origin === undefined) return true;
  const host = requestHost(c.req.raw, trustProxy) ?? new URL(c.req.url).host.toLowerCase().replace(/:\d+$/, "");
  return originHost(origin) === host;
}

enum SessionGone {
  Expired = "SESSION_EXPIRED",
  Displaced = "SESSION_DISPLACED",
  Unauthenticated = "UNAUTHENTICATED",
}

const SESSION_GONE: ReadonlySet<string> = new Set(Object.values(SessionGone));

// Only a 401 that names the session as gone may expire the cookies that carry
// it; a wrong current password inside a live session is a 403.
async function sessionIsGone(answer: Response): Promise<boolean> {
  if (answer.status !== 401) return false;
  const body = (await answer.clone().json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && SESSION_GONE.has(body.error);
}

function withHeaders(c: Context, change: (headers: Headers) => void): void {
  const headers = new Headers(c.req.raw.headers);
  change(headers);
  c.req.raw = new Request(c.req.raw, { headers });
}

// A deployment's demo gate answers Basic auth on every request, so only a
// Bearer credential means the client brought its own session.
function presentsBearer(c: Context): boolean {
  return /^bearer\s/i.test(c.req.header("authorization") ?? "") || c.req.header("x-session-token") !== undefined;
}

export function createCookieSessions(options: CookieSessionOptions): CookieSessions {
  // SECURITY: the CSRF token is an HMAC of the session cookie under a key that
  // never leaves the server, so a cookie planted from elsewhere cannot carry a
  // token that matches it.
  const { csrfKey } = options;
  const csrfFor = (sessionValue: string) => createHmac("sha256", csrfKey).update(sessionValue).digest("base64url");

  const tenantJar: CookieJar = {
    session: SessionCookie.Tenant,
    device: SessionCookie.TenantDevice,
    csrf: CsrfCookie.Tenant,
    path: TENANT_PATH,
    // REQUIRED: as long as a tenant session may live, so the browser never
    // drops a secret its live session still needs.
    maxAgeSeconds: MAX_SESSION_MS / 1000,
    signIn: ["/api/auth/login", "/api/bootstrap/admin"],
    signOut: "/api/auth/logout",
  };
  const platformJar: CookieJar = {
    session: SessionCookie.Platform,
    device: SessionCookie.PlatformDevice,
    csrf: CsrfCookie.Platform,
    path: PLATFORM_PATH,
    maxAgeSeconds: Math.floor(options.platformMaxAgeMs / 1000),
    signIn: ["/api/platform/auth/login"],
    signOut: "/api/platform/auth/logout",
  };

  function cookie(jar: CookieJar, name: SessionCookie | CsrfCookie, value: string, secure: boolean, maxAgeSeconds: number): string {
    const readable = name === jar.csrf;
    return generateCookie(name, value, {
      path: readable ? CSRF_PATH : jar.path,
      maxAge: maxAgeSeconds,
      httpOnly: !readable,
      secure,
      sameSite: "Strict",
    });
  }

  async function refuse(c: Context, action: CookieSecurityAction, details: Record<string, unknown>): Promise<void> {
    await recordSecurityEventOrFallback(options.audit, {
      module: "cloud",
      entityType: "SESSION_COOKIE",
      entityId: null,
      action,
      actor: "anonymous",
      severity: "WARNING",
      details: { ...details, method: c.req.method, path: new URL(c.req.url).pathname },
    });
  }

  async function intoCookies(jar: CookieJar, answer: Response, secure: boolean, sessionValue: (token: string) => string): Promise<Response> {
    if (!answer.ok) return answer;
    const body = (await answer.json()) as { token?: unknown; deviceSecret?: unknown } & Record<string, unknown>;
    const { token, deviceSecret, ...rest } = body;
    const headers = new Headers(answer.headers);
    headers.delete("content-length");
    if (typeof token === "string") {
      const value = sessionValue(token);
      headers.append("set-cookie", cookie(jar, jar.session, value, secure, jar.maxAgeSeconds));
      headers.append("set-cookie", cookie(jar, jar.csrf, csrfFor(value), secure, jar.maxAgeSeconds));
    }
    if (typeof deviceSecret === "string") headers.append("set-cookie", cookie(jar, jar.device, deviceSecret, secure, jar.maxAgeSeconds));
    return new Response(JSON.stringify(rest), { status: answer.status, headers });
  }

  function clearing(jar: CookieJar, answer: Response, secure: boolean): Response {
    const headers = new Headers(answer.headers);
    for (const name of [jar.session, jar.device, jar.csrf]) headers.append("set-cookie", cookie(jar, name, "", secure, 0));
    return new Response(answer.body, { status: answer.status, headers });
  }

  function guard(jar: CookieJar, tenantOf: (c: Context) => string | null | undefined): MiddlewareHandler {
    const bindsTenant = jar === tenantJar;
    return async (c, next) => {
      const pathname = new URL(c.req.url).pathname;
      if (bindsTenant && (pathname === PLATFORM_PATH || pathname.startsWith(`${PLATFORM_PATH}/`))) return next();
      const unsafe = UNSAFE_METHOD.test(c.req.method);
      const signingIn = c.req.method === "POST" && jar.signIn.includes(pathname) && c.req.header(DEVICE_BINDING_HEADER) === DeviceBinding.Cookie;
      const secure = isHttps(c.req.raw, options.trustProxy);
      const code = bindsTenant ? tenantOf(c) : undefined;
      const device = getCookie(c, jar.device);
      const stored = presentsBearer(c) || signingIn ? undefined : getCookie(c, jar.session);
      let token: string | null = null;
      let otherTenant = false;
      if (stored) {
        const at = stored.indexOf(SESSION_SEPARATOR);
        const boundTo = bindsTenant ? stored.slice(0, Math.max(at, 0)) : undefined;
        token = bindsTenant ? (at > 0 ? stored.slice(at + 1) : null) : stored;
        // SECURITY: a tenant cookie names the tenant it was issued by, and is
        // never presented to any other one.
        if (bindsTenant && (code === null || boundTo !== code)) {
          if (code !== null) {
            await refuse(c, CookieSecurityAction.TenantMismatch, { cookieTenant: boundTo ?? null, requestTenant: code });
            otherTenant = true;
          }
          token = null;
        }
      }
      if ((token !== null || signingIn) && unsafe) {
        const csrf = c.req.header(CSRF_HEADER);
        const tokenHeld = token === null || (stored !== undefined && csrf !== undefined && tokensMatch(csrf, csrfFor(stored)));
        if (!fromThisOrigin(c, options.trustProxy) || !tokenHeld) {
          await refuse(c, CookieSecurityAction.CsrfRefused, { origin: c.req.header("origin") ?? null, fetchSite: c.req.header("sec-fetch-site") ?? null, tenant: code ?? null });
          return c.json({ error: CookieRefusal.Csrf, message: "تعذّر التحقق من مصدر الطلب. أعد تحميل الصفحة ثم حاول مرة أخرى." }, 403);
        }
      }
      withHeaders(c, (headers) => {
        if (token !== null) headers.set("authorization", `Bearer ${token}`);
        if (device && !otherTenant && !headers.has(DEVICE_SECRET_HEADER)) headers.set(DEVICE_SECRET_HEADER, device);
        if (signingIn) headers.set(DEVICE_BINDING_HEADER, DeviceBinding.Header);
      });
      await next();
      if (otherTenant) {
        if (c.res.status === 401) c.res = c.json({ error: SessionRefusal.TenantMismatch, message: TENANT_MISMATCH_MESSAGE, messageEn: TENANT_MISMATCH_MESSAGE_EN }, 403);
      } else if (signingIn) {
        c.res = await intoCookies(jar, c.res, secure, (issued) => (bindsTenant ? `${code ?? ""}${SESSION_SEPARATOR}${issued}` : issued));
      } else if ((c.req.method === "POST" && pathname === jar.signOut) || (token !== null && (await sessionIsGone(c.res)))) {
        c.res = clearing(jar, c.res, secure);
      }
    };
  }

  return {
    tenant: guard(tenantJar, (c) => resolveTenantCode(c.req.raw, options.tenantResolver)),
    platform: guard(platformJar, () => undefined),
  };
}
