import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  updateOwnProfile,
  changeOwnPassword,
  IncorrectPasswordError,
  InvalidUserError,
  DuplicateUserEmailError,
  UserNotFoundError,
  recordSecurityEvent,
  recordSecurityEventOrFallback,
  type User,
  type UnitOfWork,
  type SecretHasher,
  type AuditSink,
} from "@mezan/domain";
import { updateProfileSchema, changePasswordSchema } from "@mezan/contracts";
import { displacedSessionRefusal, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { createPrecomputingHasher } from "./precomputed-secrets.js";

export enum ProfileRefusal {
  CredentialChangedMeanwhile = "CREDENTIAL_CHANGED_MEANWHILE",
  CurrentPasswordRequired = "CURRENT_PASSWORD_REQUIRED",
}

export enum ProfileSecurityAction {
  EmailChanged = "EMAIL_CHANGED",
  EmailChangeRefused = "EMAIL_CHANGE_REFUSED",
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

class CredentialChangedMeanwhile extends Error {}

const CREDENTIAL_ATTEMPTS = 3;

function serializeProfile(user: User) {
  return {
    id: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    isCompanyAdmin: user.isCompanyAdmin,
    roleId: user.roleId,
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
    return c.json({ error: err.code, message: err.message }, 403);
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
      const displaced = displacedSessionRefusal(c);
      if (displaced) return displaced;
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
  // other request on this connection would run with the BEGIN still open. The
  // hash hands the connection back, so the password it was checked against is
  // read again inside the transaction; if it moved meanwhile, the check is
  // made again against the one now stored.
  async function withCurrentPasswordChecked(
    callerId: string,
    currentPassword: string,
    next: string | null,
    write: (tx: UnitOfWork) => Promise<void>,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < CREDENTIAL_ATTEMPTS; attempt += 1) {
      const checkedAgainst = (await uow.users.findById(callerId))?.passwordHash ?? null;
      const release =
        checkedAgainst === null
          ? () => undefined
          : await secrets.precompute({ hash: next === null ? [] : [next], verify: [[currentPassword, checkedAgainst]] });
      try {
        await uow.transaction(async (tx) => {
          const stored = (await tx.users.findById(callerId))?.passwordHash ?? null;
          if (stored !== checkedAgainst) throw new CredentialChangedMeanwhile();
          await write(tx);
        });
        return true;
      } catch (err) {
        if (!(err instanceof CredentialChangedMeanwhile)) throw err;
      } finally {
        release();
      }
    }
    return false;
  }

  const changedMeanwhile = (c: Context) =>
    c.json(
      {
        error: ProfileRefusal.CredentialChangedMeanwhile,
        message: "تغيّرت بيانات الدخول لهذا الحساب أثناء تنفيذ الطلب، فلم يُحفظ شيء. أعد المحاولة.",
        messageEn: "This account's credentials changed while the request was running, so nothing was saved. Try again.",
      },
      409,
    );

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
    const { currentPassword, ...details } = parsed.data;
    try {
      const before = await uow.users.findById(callerId);
      if (!before) return c.json({ error: "NOT_FOUND" }, 404);
      if (sameEmail(before.email, details.email)) {
        return c.json(serializeProfile(await updateOwnProfile(callerId, details, uow)));
      }
      // SECURITY: the email is the login id, so changing it is a credential
      // change and needs the current password, exactly as change-password does.
      if (!currentPassword) {
        return c.json(
          {
            error: ProfileRefusal.CurrentPasswordRequired,
            message: "أدخل كلمة المرور الحالية لتغيير البريد الإلكتروني.",
            messageEn: "Enter your current password to change your email.",
          },
          400,
        );
      }
      const saved: { user: User | null } = { user: null };
      const changed = await withCurrentPasswordChecked(callerId, currentPassword, null, async (tx) => {
        const stored = await tx.users.findById(callerId);
        if (!stored) throw new UserNotFoundError(callerId);
        if (!(await secrets.hasher.verify(currentPassword, stored.passwordHash))) throw new IncorrectPasswordError();
        saved.user = await updateOwnProfile(callerId, details, tx);
        if (audit) {
          await recordSecurityEvent(audit, {
            module: "profile",
            entityType: "USER",
            entityId: callerId,
            action: ProfileSecurityAction.EmailChanged,
            actor: callerId,
            severity: "WARNING",
            details: { from: stored.email, to: details.email },
          });
        }
      });
      if (!changed || saved.user === null) return changedMeanwhile(c);
      return c.json(serializeProfile(saved.user));
    } catch (err) {
      if (err instanceof IncorrectPasswordError && audit) {
        await recordSecurityEventOrFallback(audit, {
          module: "profile",
          entityType: "USER",
          entityId: callerId,
          action: ProfileSecurityAction.EmailChangeRefused,
          actor: callerId,
          severity: "WARNING",
        });
      }
      return profileErrorResponse(c, err);
    }
  });

  app.post("/change-password", requireAuth, async (c) => {
    const callerId = resolveCallerId(c);
    const parsed = changePasswordSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const changed = await withCurrentPasswordChecked(callerId, parsed.data.currentPassword, parsed.data.newPassword, async (tx) => {
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
      return changed ? c.body(null, 204) : changedMeanwhile(c);
    } catch (err) {
      return profileErrorResponse(c, err);
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
