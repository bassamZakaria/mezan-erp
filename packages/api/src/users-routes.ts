import { Hono, type Context } from "hono";
import {
  saveUser,
  setUserStatus,
  isTenantAdmin,
  targetOutranksCaller,
  ungrantablePermissions,
  type AccountAuthority,
  InvalidUserError,
  DuplicateUserEmailError,
  EmailDomainNotAllowedError,
  UnknownRoleError,
  UserNotFoundError,
  type AuditSink,
  type User,
  type UnitOfWork,
  type SecretHasher,
} from "@mezan/domain";
import { createUserSchema, updateUserSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";

function serializeUser(user: User) {
  return {
    id: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    isCompanyAdmin: user.isCompanyAdmin,
    employeeId: user.employeeId,
    branchScope: user.branchScope,
    warehouseScope: user.warehouseScope,
    status: user.status,
    hasPin: user.pinHash !== null,
    photoUrl: user.photoUrl,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function userErrorResponse(c: Context, err: unknown) {
  if (err instanceof InvalidUserError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof DuplicateUserEmailError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof EmailDomainNotAllowedError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof UnknownRoleError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof UserNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  throw err;
}

/**
 * Users CRUD — every route is permission-gated (docs/archive/catalog/09 §المستخدمون).
 * `resolveAuthContext` is required, never defaulted.
 */
export function createUsersRoutes(
  uow: UnitOfWork,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver,
  /**
   * The tenant's allowed email domains, read per request rather than captured
   * at mount: an admin who adds a domain in الإعدادات must not have to restart
   * the app before the next account can use it.
   */
  readAllowedEmailDomains?: () => Promise<readonly string[]>,
  /** Who created an account, changed its role, or gave it admin. */
  audit?: AuditSink,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * The ROLE and the admin flag travel — they are what a user account grants.
   * The PIN hash never does: a forensic log that carries the secret it is
   * meant to protect is a second copy of the credential store.
   */
  function auditUser(c: Context, user: User, action: string, before?: User | null) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action,
      details: {
        email: user.email,
        roleId: user.roleId,
        isCompanyAdmin: user.isCompanyAdmin,
        status: user.status,
        branchScope: user.branchScope,
        warehouseScope: user.warehouseScope,
        ...(before
          ? {
              previousRoleId: before.roleId,
              previousIsCompanyAdmin: before.isCompanyAdmin,
              previousStatus: before.status,
            }
          : {}),
      },
    });
  }
  const saveOptions = async () => ({ allowedEmailDomains: (await readAllowedEmailDomains?.()) ?? [] });

  /**
   * The authority an account carries — the admin flag plus whatever its role
   * grants. Read from the ROLE STORE, never from the request: the caller names
   * a roleId, and what that id is worth is the server's to say.
   */
  async function authorityOf(account: { roleId: string | null; isCompanyAdmin: boolean }): Promise<AccountAuthority> {
    if (!account.roleId) return { isCompanyAdmin: account.isCompanyAdmin, permissions: [] };
    const role = await uow.roles.findById(account.roleId);
    return { isCompanyAdmin: account.isCompanyAdmin, permissions: role ? [...role.permissions] : [] };
  }

  function refuseGrant(c: Context, permissions: readonly string[]) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        permissions: [...permissions],
        message: "لا يمكنك منح صلاحيات لا تملكها.",
      },
      403,
    );
  }

  function refuseOutranked(c: Context) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        message: "لا يمكنك تعديل حساب صلاحياته أوسع من صلاحياتك.",
      },
      403,
    );
  }

  /**
   * The second half of authorization, and the half that was missing: the gate
   * says the caller may edit users, this says WHICH authority they may hand
   * out. Returns a refusal response, or null when the grant is within reach.
   */
  async function refuseIfEscalating(c: Context, granted: { roleId: string | null; isCompanyAdmin: boolean }) {
    const ctx = getAuthContext(c);
    if (!ctx) return refuseOutranked(c);
    const authority = await authorityOf(granted);
    if (authority.isCompanyAdmin && !isTenantAdmin(ctx)) return refuseGrant(c, ["*"]);
    const ungrantable = ungrantablePermissions(ctx, authority.permissions);
    if (ungrantable.length > 0) return refuseGrant(c, ungrantable);
    return null;
  }

  /** Refuses any write against an account that already outranks the caller. */
  async function refuseIfTargetOutranks(c: Context, targetId: string) {
    const ctx = getAuthContext(c);
    const target = await uow.users.findById(targetId);
    if (!target) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    if (!ctx || targetOutranksCaller(ctx, await authorityOf(target))) return refuseOutranked(c);
    return null;
  }

  app.get("/", gate("admin.users.view"), async (c) => {
    const users = await uow.users.list();
    return c.json(users.map(serializeUser));
  });

  app.get("/:id", gate("admin.users.view"), async (c) => {
    const user = await uow.users.findById(c.req.param("id"));
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeUser(user));
  });

  app.post("/", gate("admin.users.create"), async (c) => {
    const parsed = createUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const escalation = await refuseIfEscalating(c, parsed.data);
    if (escalation) return escalation;
    try {
      const user = await saveUser(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        hasher,
        await saveOptions(),
      );
      await auditUser(c, user, "CREATE");
      return c.json(serializeUser(user), 201);
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.put("/:id", gate("admin.users.edit"), async (c) => {
    const parsed = updateUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    // Read before the write: "role changed" is only evidence with both ends.
    const before = await uow.users.findById(c.req.param("id"));
    // A PUT is an EDIT. Letting an unknown id fall through created the account
    // instead, so a caller-chosen id was a second, unaudited create route.
    if (!before) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    const escalation = await refuseIfEscalating(c, parsed.data);
    if (escalation) return escalation;
    try {
      const user = await saveUser(
        // The account keeps the date it was created on; stamping `now` here
        // reset it on every edit.
        { id: c.req.param("id"), ...parsed.data, createdAt: before.createdAt },
        uow,
        hasher,
        await saveOptions(),
      );
      await auditUser(c, user, "UPDATE", before);
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/deactivate", gate("admin.users.deactivate"), async (c) => {
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    try {
      const user = await setUserStatus(c.req.param("id"), "inactive", uow);
      await auditUser(c, user, "DEACTIVATE");
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/activate", gate("admin.users.edit"), async (c) => {
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    try {
      const user = await setUserStatus(c.req.param("id"), "active", uow);
      await auditUser(c, user, "ACTIVATE");
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  return app;
}
