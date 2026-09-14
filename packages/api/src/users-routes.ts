import { Hono, type Context } from "hono";
import {
  saveUser,
  setUserStatus,
  isTenantAdmin,
  targetOutranksCaller,
  ungrantablePermissions,
  ungrantableScopes,
  type AccountAuthority,
  InvalidUserError,
  DuplicateUserEmailError,
  EmailDomainNotAllowedError,
  UnknownRoleError,
  UserNotFoundError,
  LastCompanyAdminError,
  type AuditSink,
  type User,
  type UnitOfWork,
  type ScopeSelection,
  type SecretHasher,
} from "@mezan/domain";
import { createUserSchema, updateUserSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordAdminEvent, recordSecurityAdminEvent } from "./admin-audit.js";
import type { SessionRegistry } from "./session-auth.js";
import type { LoginThrottle } from "./login-throttle.js";

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
  // 409, not 400: the request is well formed and the caller is allowed to
  // deactivate users — it is the tenant's state that forbids this one (D117).
  if (err instanceof LastCompanyAdminError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

export interface UsersRoutesOptions {
  /**
   * The tenant's allowed email domains, read per request rather than captured
   * at mount: an admin who adds a domain in الإعدادات must not have to restart
   * the app before the next account can use it.
   */
  readonly readAllowedEmailDomains?: () => Promise<readonly string[]>;
  /** Who created an account, changed its role, gave it admin, or reset its PIN. */
  readonly audit?: AuditSink;
  /**
   * The live session registry.
   *
   * REQUIRED for deactivation to mean anything. The permission grant is
   * snapshotted into the session at login and never re-read, so without this a
   * dismissed employee keeps full access for up to twelve hours after
   * `POST /users/:id/deactivate`, a demoted user keeps their old permission
   * set, and a PIN reset does not evict the session it was meant to close.
   * `revokeUser` existed and was called from nowhere.
   */
  readonly sessions?: SessionRegistry;
  /** The SAME throttle `/auth/login` counts against, so an admin can clear a lockout. */
  readonly loginThrottle?: LoginThrottle;
}

/**
 * Users CRUD — every route is permission-gated (docs/archive/catalog/09 §المستخدمون).
 * `resolveAuthContext` is required, never defaulted.
 */
export function createUsersRoutes(
  uow: UnitOfWork,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver,
  options: UsersRoutesOptions = {},
) {
  const { readAllowedEmailDomains, audit, sessions, loginThrottle } = options;
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * The ROLE and the admin flag travel — they are what a user account grants.
   * The PIN hash never does: a forensic log that carries the secret it is
   * meant to protect is a second copy of the credential store.
   *
   * That a credential CHANGED does travel, and has to. A supervisor who resets
   * the cashier's PIN, signs in as them, issues a credit note against a stolen
   * sale and resets the PIN back used to leave two UPDATE rows byte-identical
   * to a phone-number correction — and every document then named the wrong
   * person. `profile-routes` already recorded this for a SELF-service change;
   * the admin-initiated direction, which is the dangerous one, recorded nothing.
   */
  function auditUser(c: Context, user: User, action: string, before?: User | null, credentials?: CredentialChange) {
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
        ...(credentials?.pinChanged ? { pinChanged: true } : {}),
        ...(credentials?.passwordChanged ? { passwordChanged: true } : {}),
        ...(before
          ? {
              previousRoleId: before.roleId,
              previousIsCompanyAdmin: before.isCompanyAdmin,
              previousStatus: before.status,
              previousBranchScope: before.branchScope,
              previousWarehouseScope: before.warehouseScope,
            }
          : {}),
      },
    });
  }

  interface CredentialChange {
    readonly pinChanged: boolean;
    readonly passwordChanged: boolean;
  }

  function credentialChange(body: { pin?: string | null; password?: string }): CredentialChange {
    return { pinChanged: body.pin !== undefined, passwordChanged: body.password !== undefined };
  }

  /**
   * A credential set BY SOMEBODY ELSE, on the security stream at CRITICAL.
   *
   * Separate from the UPDATE row because this is the event an auditor searches
   * for by name, and because it is the one administrative act that makes every
   * later document attributable to the wrong person.
   */
  function auditCredentialReset(c: Context, user: User, change: CredentialChange) {
    if (!change.pinChanged && !change.passwordChanged) return Promise.resolve();
    const actor = getAuthContext(c)?.userId;
    if (actor === user.id) return Promise.resolve(); // self-service; profile-routes records it
    return recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action: "CREDENTIAL_RESET_BY_ADMIN",
      severity: "CRITICAL",
      details: {
        email: user.email,
        pinChanged: change.pinChanged,
        passwordChanged: change.passwordChanged,
      },
    });
  }

  /**
   * A refusal, recorded.
   *
   * Every escalation guard returned 403 and wrote nothing, so a clerk probing
   * fifty times — and using the outrank refusal as a free oracle over the org's
   * authority map — left zero rows. The reconnaissance half of an insider fraud
   * was invisible, and the one signal that would have caught the escalation
   * holes BEFORE they were exploited was discarded.
   */
  function auditRefusal(c: Context, entityId: string | null, details: Record<string, unknown>) {
    return recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId,
      action: "PRIVILEGE_ESCALATION_DENIED",
      severity: "CRITICAL",
      details,
    });
  }

  const saveOptions = async () => ({ allowedEmailDomains: (await readAllowedEmailDomains?.()) ?? [] });

  /**
   * The authority an account carries — the admin flag, whatever its role
   * grants, and WHERE it may act. Read from the ROLE STORE, never from the
   * request: the caller names a roleId, and what that id is worth is the
   * server's to say.
   *
   * An unresolvable `roleId` is reported as such rather than as "no
   * permissions". Treating it as harmless made a security predicate fail open
   * on exactly the account whose authority the server could not establish.
   */
  async function authorityOf(account: {
    roleId: string | null;
    isCompanyAdmin: boolean;
    branchScope?: AccountAuthority["branchScope"];
    warehouseScope?: AccountAuthority["warehouseScope"];
  }): Promise<AccountAuthority> {
    const scopes = { branchScope: account.branchScope, warehouseScope: account.warehouseScope };
    if (!account.roleId) {
      return { isCompanyAdmin: account.isCompanyAdmin, permissions: [], ...scopes };
    }
    const role = await uow.roles.findById(account.roleId);
    return {
      isCompanyAdmin: account.isCompanyAdmin,
      permissions: role ? [...role.permissions] : [],
      roleUnresolved: !role,
      ...scopes,
    };
  }

  function refuseScope(c: Context, scopes: readonly string[]) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        scopes: [...scopes],
        message: "لا يمكنك منح نطاق أوسع من نطاقك.",
      },
      403,
    );
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
   *
   * Both dimensions are compared. Comparing only the permission list left every
   * branch and warehouse boundary in the product optional for anyone holding
   * `admin.users.edit`: a branch manager scoped to one branch could `PUT` their
   * OWN account with `branchScope: "*"` and an unchanged role — identical
   * authority on the only axis anyone checked — and walk out with tenant-wide
   * reach.
   */
  async function refuseIfEscalating(
    c: Context,
    granted: { roleId: string | null; isCompanyAdmin: boolean; branchScope?: ScopeSelection; warehouseScope?: ScopeSelection },
    /** The account being written, so a refusal can name what was reached for. Null on create. */
    targetId: string | null,
  ) {
    const ctx = getAuthContext(c);
    if (!ctx) return refuseOutranked(c);
    const authority = await authorityOf(granted);
    if (authority.isCompanyAdmin && !isTenantAdmin(ctx)) {
      await auditRefusal(c, targetId, { reason: "GRANT_COMPANY_ADMIN", permissions: ["*"] });
      return refuseGrant(c, ["*"]);
    }
    const ungrantable = ungrantablePermissions(ctx, authority.permissions);
    if (ungrantable.length > 0) {
      await auditRefusal(c, targetId, { reason: "GRANT_UNHELD_PERMISSIONS", permissions: ungrantable });
      return refuseGrant(c, ungrantable);
    }
    // WHERE is authority too: a caller who can write a wider branch/warehouse
    // scope than they hold defeats every read-narrowing at once (D118). Audited
    // like every other refusal — a probe that leaves no row is a probe nobody
    // ever sees.
    const overreach = ungrantableScopes(ctx, granted);
    if (overreach.length > 0) {
      await auditRefusal(c, targetId, { reason: "WIDEN_SCOPE", scopes: overreach });
      return refuseScope(c, overreach);
    }
    return null;
  }

  /** Refuses any write against an account that already outranks the caller. */
  async function refuseIfTargetOutranks(c: Context, targetId: string) {
    const ctx = getAuthContext(c);
    const target = await uow.users.findById(targetId);
    if (!target) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    if (!ctx || targetOutranksCaller(ctx, await authorityOf(target))) {
      await auditRefusal(c, targetId, { reason: "TARGET_OUTRANKS_CALLER", targetEmail: target.email });
      return refuseOutranked(c);
    }
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
    const entitlements = c.get("entitlements");
    if (entitlements) {
      const activeCount = (await uow.users.list()).filter((u) => u.status === "active").length;
      if (activeCount >= entitlements.seats) {
        return c.json(
          { error: "SEAT_LIMIT_REACHED", message: "وصلتم إلى الحد الأقصى للمستخدمين في باقتكم" },
          409,
        );
      }
    }
    const escalation = await refuseIfEscalating(c, parsed.data, null);
    if (escalation) return escalation;
    try {
      const user = await saveUser(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        hasher,
        await saveOptions(),
      );
      await auditUser(c, user, "CREATE", null, credentialChange(parsed.data));
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
    const id = c.req.param("id");
    // Read before the write: "role changed" is only evidence with both ends.
    const before = await uow.users.findById(id);
    // A PUT is an EDIT. Letting an unknown id fall through created the account
    // instead, so a caller-chosen id was a second, unaudited create route.
    if (!before) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    const outranked = await refuseIfTargetOutranks(c, id);
    if (outranked) return outranked;
    const escalation = await refuseIfEscalating(c, parsed.data, id);
    if (escalation) return escalation;
    const change = credentialChange(parsed.data);
    try {
      // ONE transaction around read-check-write. Without it two concurrent
      // edits interleave between the guard and the save, and the later write
      // lands over the earlier one — which cannot escalate (the guard still
      // bounds what either caller may write) but does silently undo a
      // promotion and reset a PIN nobody asked to reset.
      const user = await uow.transaction(async (tx) => {
        const current = await tx.users.findById(id);
        if (!current) throw new UserNotFoundError(id);
        return saveUser(
          // The account keeps the date it was created on; stamping `now` here
          // reset it on every edit.
          { id, ...parsed.data, createdAt: current.createdAt },
          tx,
          hasher,
          await saveOptions(),
        );
      });
      await auditUser(c, user, "UPDATE", before, change);
      await auditCredentialReset(c, user, change);
      // A grant is snapshotted into the session at login. Anything that changes
      // what this account is worth — its role, its admin flag, its scope, its
      // credential — has to end the sessions carrying the old answer, or every
      // incident-response action the product offers is advisory for half a day.
      if (
        sessions &&
        (change.pinChanged ||
          change.passwordChanged ||
          before.roleId !== user.roleId ||
          before.isCompanyAdmin !== user.isCompanyAdmin ||
          JSON.stringify(before.branchScope) !== JSON.stringify(user.branchScope) ||
          JSON.stringify(before.warehouseScope) !== JSON.stringify(user.warehouseScope) ||
          user.status !== "active")
      ) {
        sessions.revokeUser(user.id);
      }
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
      // Firing someone at 10:00 must not leave them posting at 10:05.
      sessions?.revokeUser(user.id);
      if (loginThrottle) loginThrottle.succeed(user.email.trim().toLowerCase());
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

  /**
   * Clears a failed-login lockout.
   *
   * The lockout is deliberately keyed per ACCOUNT, which is right — but it left
   * the product with no way back in short of waiting fifteen minutes or
   * restarting the machine everyone is selling on. A trainer demoing wrong
   * PINs, a new hire fumbling a numeric pad, or anyone on the shop wifi who
   * knows the owner's email (it is printed on every invoice) could take a till
   * out of service with no recourse inside the product.
   *
   * Gated on its own permission so the branch manager standing beside the till
   * can use it without also being handed every colleague's PIN.
   */
  app.post("/:id/unlock", gate("admin.users.unlock"), async (c) => {
    const user = await uow.users.findById(c.req.param("id"));
    if (!user) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    loginThrottle?.succeed(user.email.trim().toLowerCase());
    await recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action: "ACCOUNT_UNLOCKED",
      severity: "WARNING",
      details: { email: user.email },
    });
    return c.json({ ok: true, userId: user.id });
  });

  return app;
}
