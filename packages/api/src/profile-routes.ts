import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  updateOwnProfile,
  changeOwnPassword,
  changeOwnPin,
  IncorrectPasswordError,
  InvalidUserError,
  DuplicateUserEmailError,
  UserNotFoundError,
  recordSecurityEvent,
  type User,
  type UnitOfWork,
  type SecretHasher,
  type AuditSink,
} from "@mezan/domain";
import { updateProfileSchema, changePasswordSchema, changePinSchema } from "@mezan/contracts";
import { getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { createPrecomputingHasher } from "./precomputed-secrets.js";

function serializeProfile(user: User) {
  return {
    id: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    isCompanyAdmin: user.isCompanyAdmin,
    roleId: user.roleId,
    hasPin: user.pinHash !== null,
    photoUrl: user.photoUrl,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function resolveCallerId(c: Context): string {
  const id = getAuthContext(c)?.userId;
  if (!id) throw new Error("profile route: missing auth context after requireCaller");
  return id;
}

function profileErrorResponse(c: Context, err: unknown) {
  if (err instanceof IncorrectPasswordError) {
    return c.json({ error: err.code, message: err.message }, 401);
  }
  if (err instanceof InvalidUserError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof DuplicateUserEmailError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof UserNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  throw err;
}

/**
 * Self-service only: requires a resolved, non-anonymous caller identity —
 * deliberately NOT a `createPermissionGate` check. Every route below reads/
 * writes exactly the caller's own user record; there is no admin permission
 * that should be able to widen or narrow that.
 */
function requireCaller(resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  return async (c, next) => {
    const ctx = await resolveAuthContext(c);
    if (!ctx.userId || ctx.userId === "anonymous") {
      return c.json({ error: "UNAUTHENTICATED", message: "تسجيل الدخول مطلوب." }, 401);
    }
    c.set("authContext", ctx);
    await next();
  };
}

/**
 * الملف الشخصي (self-service profile) — the signed-in user's own account:
 * info (name/email/phone), security (password/PIN change), activity (their
 * own recent audit trail). See `users-routes.ts` for the admin-gated
 * equivalent that manages OTHER users.
 */
export function createProfileRoutes(
  uow: UnitOfWork,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver,
  audit?: AuditSink,
) {
  const app = new Hono();
  const requireAuth = requireCaller(resolveAuthContext);
  const secrets = createPrecomputingHasher(hasher);

  // scrypt must finish BEFORE the transaction opens: awaited inside it, every
  // other request on this connection would run with the BEGIN still open.
  async function verifiedAndHashedAhead(callerId: string, currentPassword: string, next: string | null): Promise<() => void> {
    const user = await uow.users.findById(callerId);
    if (!user) return () => undefined;
    return secrets.precompute({ hash: next === null ? [] : [next], verify: [[currentPassword, user.passwordHash]] });
  }

  app.get("/", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    const user = await uow.users.findById(callerId);
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeProfile(user));
  });

  app.put("/", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    const parsed = updateProfileSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const user = await updateOwnProfile(callerId, parsed.data, uow);
      return c.json(serializeProfile(user));
    } catch (err) {
      return profileErrorResponse(c, err);
    }
  });

  app.post("/change-password", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    const parsed = changePasswordSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const release = await verifiedAndHashedAhead(callerId, parsed.data.currentPassword, parsed.data.newPassword);
    try {
      await uow.transaction(async (tx) => {
        await changeOwnPassword(callerId, parsed.data, tx, secrets.hasher);
        if (audit) {
          await recordSecurityEvent(audit, {
            module: "profile",
            entityType: "USER",
            entityId: callerId,
            action: "PASSWORD_CHANGED",
            actor: callerId,
            severity: "WARNING",
          });
        }
      });
      return c.body(null, 204);
    } catch (err) {
      return profileErrorResponse(c, err);
    } finally {
      release();
    }
  });

  app.post("/change-pin", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    const parsed = changePinSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const release = await verifiedAndHashedAhead(callerId, parsed.data.currentPassword, parsed.data.newPin);
    try {
      await uow.transaction(async (tx) => {
        await changeOwnPin(callerId, parsed.data, tx, secrets.hasher);
        if (audit) {
          await recordSecurityEvent(audit, {
            module: "profile",
            entityType: "USER",
            entityId: callerId,
            action: pinChangeAction(parsed.data.newPin),
            actor: callerId,
            severity: "WARNING",
          });
        }
      });
      return c.body(null, 204);
    } catch (err) {
      return profileErrorResponse(c, err);
    } finally {
      release();
    }
  });

  app.get("/activity", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    if (!audit) return c.json([]);
    const limitParam = Number(c.req.query("limit") ?? "50");
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
    const [security, sensitive] = await Promise.all([audit.query("security", 500), audit.query("sensitive", 500)]);
    const mine = [...security, ...sensitive]
      .filter((event) => event.actor === callerId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
    return c.json(mine);
  });

  return app;
}

function pinChangeAction(newPin: string | null): string {
  return newPin === null ? "PIN_CLEARED" : "PIN_CHANGED";
}
