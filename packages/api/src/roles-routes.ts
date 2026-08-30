import { Hono, type Context } from "hono";
import {
  saveRole,
  deleteRole,
  ungrantablePermissions,
  UnknownPermissionError,
  UnlicensedPermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleNotFoundError,
  RoleInUseError,
  type AuditSink,
  type Role,
  type UnitOfWork,
} from "@mezan/domain";
import { createRoleSchema, updateRoleSchema } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import type { EntitlementsResolver } from "./module-gate.js";

function serializeRole(role: Role) {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
  };
}

function roleErrorResponse(c: Context, err: unknown) {
  if (err instanceof UnknownPermissionError || err instanceof UnlicensedPermissionError) {
    return c.json({ error: err.code, message: err.message, permission: err.permission }, 400);
  }
  if (err instanceof DuplicateRoleCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof SystemRoleImmutableError) {
    return c.json({ error: err.code, message: err.message }, 403);
  }
  if (err instanceof RoleNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof RoleInUseError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * Roles CRUD — every route is permission-gated (docs/archive/catalog/09 §الأدوار).
 * `resolveAuthContext` is required, never defaulted: a resolver that reads the
 * caller's own `x-permissions` header would hand every guard below its answer.
 * `resolveEntitlements` has no repo-wide default (yet) — module licensing
 * varies per tenant, so the mounting app must supply it.
 */
export function createRolesRoutes(
  uow: UnitOfWork,
  resolveEntitlements: EntitlementsResolver,
  resolveAuthContext: AuthContextResolver,
  /** Who granted which permissions to whom. Without it, self-elevation leaves no trace. */
  audit?: AuditSink,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * The permission LIST travels, not just the role name. "Role edited" is not
   * evidence; "this role gained `workflow.approve`" is.
   */
  function auditRole(c: Context, role: Role, action: "CREATE" | "UPDATE", before?: Role | null) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "ROLE",
      entityId: role.id,
      action,
      details: {
        code: role.code,
        name: role.name,
        permissions: [...role.permissions],
        ...(before
          ? {
              previousPermissions: [...before.permissions],
              granted: role.permissions.filter((p) => !before.permissions.includes(p)),
              revoked: before.permissions.filter((p) => !role.permissions.includes(p)),
            }
          : {}),
      },
    });
  }

  /**
   * A role is a bundle of authority, so writing one is a GRANT. `admin.roles.manage`
   * says the caller may curate roles; it does not say which permissions they may
   * put in one. Without this, the shortest path to `"*"` on this whole system was
   * for a role manager to rewrite their own role's permission list — measured, and
   * it worked.
   */
  function refuseUngrantable(c: Context, permissions: readonly string[]) {
    const ctx = getAuthContext(c);
    const ungrantable = ctx ? ungrantablePermissions(ctx, permissions) : [...permissions];
    if (ungrantable.length === 0) return null;
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        permissions: ungrantable,
        message: "لا يمكنك منح صلاحيات لا تملكها.",
      },
      403,
    );
  }

  app.get("/", gate("admin.roles.view"), async (c) => {
    const roles = await uow.roles.list();
    return c.json(roles.map(serializeRole));
  });

  app.get("/:id", gate("admin.roles.view"), async (c) => {
    const role = await uow.roles.findById(c.req.param("id"));
    if (!role) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeRole(role));
  });

  app.post("/", gate("admin.roles.manage"), async (c) => {
    const parsed = createRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const escalation = refuseUngrantable(c, parsed.data.permissions);
    if (escalation) return escalation;
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    try {
      const role = await saveRole(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
      );
      await auditRole(c, role, "CREATE");
      return c.json(serializeRole(role), 201);
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  app.put("/:id", gate("admin.roles.manage"), async (c) => {
    const parsed = updateRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const escalation = refuseUngrantable(c, parsed.data.permissions);
    if (escalation) return escalation;
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    // Read BEFORE the write: an after-only record cannot answer "what did this
    // role gain?", which is the only question an auditor asks of a role edit.
    const before = await uow.roles.findById(c.req.param("id"));
    // The permissions a role ALREADY holds are authority too: stripping them
    // from a role the caller cannot itself hold is a privilege change on every
    // account that carries it.
    if (before) {
      const outranks = refuseUngrantable(c, before.permissions);
      if (outranks) return outranks;
    }
    try {
      const role = await saveRole(
        { id: c.req.param("id"), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
      );
      await auditRole(c, role, "UPDATE", before);
      return c.json(serializeRole(role));
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  app.delete("/:id", gate("admin.roles.manage"), async (c) => {
    const before = await uow.roles.findById(c.req.param("id"));
    try {
      await deleteRole(c.req.param("id"), uow);
      await recordAdminEvent(audit, c, {
        module: "admin",
        entityType: "ROLE",
        entityId: c.req.param("id"),
        action: "DELETE",
        details: before ? { code: before.code, name: before.name, permissions: [...before.permissions] } : null,
      });
      return c.body(null, 204);
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  return app;
}
