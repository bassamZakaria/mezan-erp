import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  ALL_SCOPE,
  recordSecurityEvent,
  verifyPlatformLogin,
  type PlatformRole,
} from "@mezan/domain";
import { platformLoginRequestSchema } from "@mezan/contracts";
import {
  createLoginThrottle,
  readSessionToken,
  requestOrigin,
  throttleKey,
  type LoginThrottle,
  type SessionRegistry,
} from "@mezan/api";
import type { PlatformHandle } from "./create-platform.js";

declare module "hono" {
  interface ContextVariableMap {
    platformUser?: { readonly id: string; readonly role: PlatformRole };
  }
}

export interface PlatformAuthDeps {
  readonly platform: PlatformHandle;
  readonly sessions: SessionRegistry;
  readonly now: () => Date;
  readonly loginThrottle?: LoginThrottle;
  readonly onAuditError?: (err: unknown) => void;
}

export interface PlatformAuth {
  readonly app: Hono;
  readonly requirePlatform: (role?: PlatformRole) => MiddlewareHandler;
}

function lockedOut(c: Context, seconds: number) {
  c.header("retry-after", String(seconds));
  return c.json(
    { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: seconds, message: `محاولات دخول كثيرة. حاول بعد ${seconds} ثانية.` },
    429,
  );
}

export function createPlatformAuth(deps: PlatformAuthDeps): PlatformAuth {
  const { platform, sessions, now } = deps;
  const onAuditError = deps.onAuditError ?? ((err: unknown) => console.error(err));
  const throttle = deps.loginThrottle ?? createLoginThrottle(() => now().getTime());

  function security(c: Context, action: string, severity: "CRITICAL" | "WARNING" | "INFO", details: Record<string, unknown>) {
    return recordSecurityEvent(platform.audit, {
      module: "platform",
      entityType: "PLATFORM_USER",
      entityId: typeof details["userId"] === "string" ? (details["userId"] as string) : null,
      action,
      actor: typeof details["userId"] === "string" ? (details["userId"] as string) : "anonymous",
      severity,
      timestamp: now().toISOString(),
      details: { ...details, origin: requestOrigin(c) ?? "host" },
    }).catch(onAuditError);
  }

  function roleOf(roleCode: string | null): PlatformRole | null {
    if (roleCode === "platform-owner") return "owner";
    if (roleCode === "platform-support") return "support";
    return null;
  }

  function requirePlatform(role?: PlatformRole): MiddlewareHandler {
    return async (c, next) => {
      const token = readSessionToken(c);
      const grant = token ? sessions.find(token, requestOrigin(c)) : null;
      const userRole = grant ? roleOf(grant.roleCode) : null;
      if (!grant || !userRole) return c.json({ error: "UNAUTHENTICATED" }, 401);
      if (role && userRole !== role) {
        return c.json({ error: "OWNER_ONLY", message: "هذا الإجراء لمالك المنصة فقط" }, 403);
      }
      c.set("platformUser", { id: grant.userId, role: userRole });
      await next();
    };
  }

  const app = new Hono();

  app.post("/login", async (c) => {
    const parsed = platformLoginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const key = throttleKey(parsed.data.email, requestOrigin(c));
    const waitSeconds = throttle.retryAfter(key);
    if (waitSeconds > 0) {
      await security(c, "PLATFORM_LOGIN_BLOCKED", "WARNING", { email: parsed.data.email, retryAfterSeconds: waitSeconds });
      return lockedOut(c, waitSeconds);
    }
    const user = await verifyPlatformLogin(parsed.data, platform.stores.platformUsers, platform.hasher);
    if (!user) {
      const lockedFor = throttle.fail(key);
      if (lockedFor > 0) {
        await security(c, "PLATFORM_ACCOUNT_LOCKED", "CRITICAL", { email: parsed.data.email, lockedForSeconds: lockedFor });
        return lockedOut(c, lockedFor);
      }
      await security(c, "PLATFORM_LOGIN_FAILED", "WARNING", { email: parsed.data.email });
      return c.json({ error: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة" }, 401);
    }
    throttle.succeed(key);
    await security(c, "PLATFORM_LOGIN_SUCCEEDED", "INFO", { userId: user.id, email: user.email });
    const token = sessions.issue(
      {
        userId: user.id,
        permissions: ["platform.*"],
        roleCode: user.role === "owner" ? "platform-owner" : "platform-support",
        branchScope: ALL_SCOPE,
        warehouseScope: ALL_SCOPE,
      },
      requestOrigin(c),
    );
    return c.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  app.post("/logout", (c) => {
    const token = readSessionToken(c);
    if (token) sessions.revoke(token);
    return c.json({ ok: true });
  });

  app.get("/me", requirePlatform(), async (c) => {
    const platformUser = c.get("platformUser");
    const user = platformUser ? await platform.stores.platformUsers.findById(platformUser.id) : null;
    if (!user) return c.json({ error: "UNAUTHENTICATED" }, 401);
    return c.json({ id: user.id, email: user.email, role: user.role });
  });

  return { app, requirePlatform };
}
