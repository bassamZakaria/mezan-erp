import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  ALL_SCOPE,
  recordSecurityEventOrFallback,
  verifyPlatformLogin,
  type PlatformRole,
} from "@mezan/domain";
import { CurrentSecretRefusal, DEVICE_SECRET_HEADER, platformLoginRequestSchema, platformStepUpRequestSchema } from "@mezan/contracts";
import {
  createLoginThrottle,
  readSessionToken,
  requestOrigin,
  SessionRefusalKind,
  STEP_UP_REQUIRED,
  throttleKey,
  type LoginThrottle,
  type SessionLimits,
  type SessionLookup,
  type SessionRegistry,
  tooManyAttempts,
} from "@mezan/api";
import { createSqliteAttemptStore, SignInAttemptScope } from "@mezan/persistence";
import type { PlatformHandle } from "./create-platform.js";

declare module "hono" {
  interface ContextVariableMap {
    platformUser?: { readonly id: string; readonly role: PlatformRole };
  }
}

// SECURITY: the console reaches every tenant, so its session is held to a
// tighter bound than a till's: a working day at most, and half an hour idle.
export const PLATFORM_SESSION_LIMITS: SessionLimits = { idleMs: 30 * 60 * 1000, maxMs: 8 * 60 * 60 * 1000 };

export enum PlatformSecurityAction {
  SessionAddressChanged = "PLATFORM_SESSION_ADDRESS_CHANGED",
  SessionDeviceRejected = "PLATFORM_SESSION_DEVICE_REJECTED",
  SessionExpired = "PLATFORM_SESSION_EXPIRED",
  StepUpRequired = "PLATFORM_STEP_UP_REQUIRED",
  StepUpConfirmed = "PLATFORM_STEP_UP_CONFIRMED",
  StepUpFailed = "PLATFORM_STEP_UP_FAILED",
  LoggedOut = "PLATFORM_LOGGED_OUT",
}

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export interface PlatformAuthDeps {
  readonly platform: PlatformHandle;
  readonly sessions: SessionRegistry;
  readonly now: () => Date;
  readonly loginThrottle?: LoginThrottle;
  readonly sourceOf?: (c: Context) => string | null;
}

export interface PlatformAuth {
  readonly app: Hono;
  readonly sourceOf: (c: Context) => string | null;
  readonly requirePlatform: (role?: PlatformRole, onRefused?: (c: Context, user: { id: string; role: PlatformRole }) => Promise<void>) => MiddlewareHandler;
  // SECURITY: re-checks the signed-in operator's own password for an irreversible action, under the sign-in throttle.
  // Null when it matches; otherwise the refusal to answer with.
  readonly confirmPassword: (c: Context, password: string) => Promise<Response | null>;
}

function lockedOut(c: Context, seconds: number) {
  c.header("retry-after", String(seconds));
  return c.json(tooManyAttempts(seconds), 429);
}

export function createPlatformAuth(deps: PlatformAuthDeps): PlatformAuth {
  const { platform, sessions, now } = deps;
  const throttle = deps.loginThrottle ?? createLoginThrottle(() => now().getTime(), createSqliteAttemptStore(platform.stores.sqlite, SignInAttemptScope.Ladder));
  const sourceOf = deps.sourceOf ?? requestOrigin;

  function security(c: Context, action: string, severity: "CRITICAL" | "WARNING" | "INFO", details: Record<string, unknown>) {
    return recordSecurityEventOrFallback(platform.audit, {
      module: "platform",
      entityType: "PLATFORM_USER",
      entityId: typeof details["userId"] === "string" ? (details["userId"] as string) : null,
      action,
      actor: typeof details["userId"] === "string" ? (details["userId"] as string) : "anonymous",
      severity,
      timestamp: now().toISOString(),
      details: { ...details, origin: sourceOf(c) ?? "host" },
    });
  }

  function roleOf(roleCode: string | null): PlatformRole | null {
    if (roleCode === "platform-owner") return "owner";
    if (roleCode === "platform-support") return "support";
    return null;
  }

  const lookups = new WeakMap<Context, Promise<SessionLookup>>();
  const reported = new WeakSet<Context>();

  function deviceOf(c: Context): string | null {
    return c.req.header(DEVICE_SECRET_HEADER) ?? null;
  }

  // ONE lookup per request: a refused device secret counts towards ending the
  // session, so asking twice in one request would end it twice as fast.
  function lookUp(c: Context, token: string): Promise<SessionLookup> {
    let lookup = lookups.get(c);
    if (!lookup) {
      lookup = sessions.inspect(token, sourceOf(c), deviceOf(c));
      lookups.set(c, lookup);
    }
    return lookup;
  }

  async function reportLookup(c: Context, lookup: SessionLookup): Promise<void> {
    if (reported.has(c)) return;
    reported.add(c);
    const { refusal, addressChange } = lookup;
    if (addressChange) {
      await security(c, PlatformSecurityAction.SessionAddressChanged, "WARNING", { userId: addressChange.userId, from: addressChange.from, to: addressChange.to });
    }
    if (!refusal) return;
    if (refusal.reason === SessionRefusalKind.Device) {
      await security(c, PlatformSecurityAction.SessionDeviceRejected, "CRITICAL", {
        userId: refusal.userId,
        issuedFrom: refusal.issuedFrom,
        presentedFrom: refusal.presentedFrom,
        sessionEnded: refusal.sessionEnded,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      });
      return;
    }
    await security(c, PlatformSecurityAction.SessionExpired, refusal.reason === SessionRefusalKind.Moved ? "CRITICAL" : "INFO", {
      userId: refusal.userId,
      reason: refusal.reason,
      issuedFrom: refusal.issuedFrom,
      presentedFrom: refusal.presentedFrom,
    });
  }

  async function signedIn(c: Context): Promise<{ readonly token: string; readonly userId: string; readonly role: PlatformRole } | null> {
    const token = readSessionToken(c);
    if (!token) return null;
    const lookup = await lookUp(c, token);
    await reportLookup(c, lookup);
    const role = lookup.grant ? roleOf(lookup.grant.roleCode) : null;
    return lookup.grant && role ? { token, userId: lookup.grant.userId, role } : null;
  }

  function requirePlatform(role?: PlatformRole, onRefused?: (c: Context, user: { id: string; role: PlatformRole }) => Promise<void>): MiddlewareHandler {
    return async (c, next) => {
      const caller = await signedIn(c);
      if (!caller) return c.json({ error: "UNAUTHENTICATED" }, 401);
      if (role && caller.role !== role) {
        await onRefused?.(c, { id: caller.userId, role: caller.role });
        return c.json({ error: "OWNER_ONLY", message: "هذا الإجراء لمالك المنصة فقط" }, 403);
      }
      // SECURITY: a console session that has changed address since its
      // password was entered may read, but changes nothing until the
      // password is entered again (POST /auth/step-up).
      if (!READ_METHODS.has(c.req.method) && (await sessions.needsStepUp(caller.token))) {
        await security(c, PlatformSecurityAction.StepUpRequired, "WARNING", { userId: caller.userId, method: c.req.method, path: new URL(c.req.url).pathname });
        return c.json({ error: STEP_UP_REQUIRED, message: "تغيّر عنوان اتصالك منذ تسجيل الدخول. أعد إدخال كلمة المرور لتأكيد هذا الإجراء." }, 403);
      }
      c.set("platformUser", { id: caller.userId, role: caller.role });
      await next();
    };
  }

  const app = new Hono();

  app.post("/login", async (c) => {
    const parsed = platformLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const key = throttleKey(parsed.data.email, sourceOf(c));
    const waitSeconds = await throttle.retryAfter(key);
    if (waitSeconds > 0) {
      await security(c, "PLATFORM_LOGIN_BLOCKED", "WARNING", { email: parsed.data.email, retryAfterSeconds: waitSeconds });
      return lockedOut(c, waitSeconds);
    }
    const user = await verifyPlatformLogin(parsed.data, platform.stores.platformUsers, platform.hasher);
    if (!user) {
      const lockedFor = await throttle.fail(key);
      if (lockedFor > 0) {
        await security(c, "PLATFORM_ACCOUNT_LOCKED", "CRITICAL", { email: parsed.data.email, lockedForSeconds: lockedFor });
        return lockedOut(c, lockedFor);
      }
      await security(c, "PLATFORM_LOGIN_FAILED", "WARNING", { email: parsed.data.email });
      return c.json({ error: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة" }, 401);
    }
    await throttle.succeed(key);
    await security(c, "PLATFORM_LOGIN_SUCCEEDED", "INFO", { userId: user.id, email: user.email });
    const { token, deviceSecret } = await sessions.issueDeviceBound(
      {
        userId: user.id,
        permissions: ["platform.*"],
        roleCode: user.role === "owner" ? "platform-owner" : "platform-support",
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      },
      sourceOf(c),
      deviceOf(c),
    );
    return c.json({ token, deviceSecret, user: { id: user.id, email: user.email, role: user.role } });
  });

  async function confirmPassword(c: Context, password: string): Promise<Response | null> {
    const caller = await signedIn(c);
    const user = caller ? await platform.stores.platformUsers.findById(caller.userId) : null;
    if (!caller || !user) return c.json({ error: "UNAUTHENTICATED" }, 401);
    const key = throttleKey(user.email, sourceOf(c));
    const waitSeconds = await throttle.retryAfter(key);
    if (waitSeconds > 0) return lockedOut(c, waitSeconds);
    const verified = await verifyPlatformLogin({ email: user.email, password }, platform.stores.platformUsers, platform.hasher);
    if (!verified || verified.id !== caller.userId) {
      const lockedFor = await throttle.fail(key);
      await security(c, PlatformSecurityAction.StepUpFailed, "WARNING", { userId: caller.userId, path: new URL(c.req.url).pathname });
      if (lockedFor > 0) {
        await sessions.revoke(caller.token);
        return lockedOut(c, lockedFor);
      }
      return c.json({ error: CurrentSecretRefusal.IncorrectPassword, message: "كلمة المرور غير صحيحة", messageEn: "The password is not correct" }, 403);
    }
    await throttle.succeed(key);
    await sessions.confirmStepUp(caller.token);
    await security(c, PlatformSecurityAction.StepUpConfirmed, "INFO", { userId: caller.userId, path: new URL(c.req.url).pathname });
    return null;
  }

  app.post("/step-up", async (c) => {
    const parsed = platformStepUpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    return (await confirmPassword(c, parsed.data.password)) ?? c.json({ ok: true });
  });

  app.post("/logout", async (c) => {
    const caller = await signedIn(c);
    if (caller) {
      await sessions.revoke(caller.token);
      await security(c, PlatformSecurityAction.LoggedOut, "INFO", { userId: caller.userId });
    }
    return c.json({ ok: true });
  });

  app.get("/me", requirePlatform(), async (c) => {
    const platformUser = c.get("platformUser");
    const user = platformUser ? await platform.stores.platformUsers.findById(platformUser.id) : null;
    if (!user) return c.json({ error: "UNAUTHENTICATED" }, 401);
    return c.json({ id: user.id, email: user.email, role: user.role });
  });

  return { app, requirePlatform, sourceOf, confirmPassword };
}
