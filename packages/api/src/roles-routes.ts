import { Hono, type Context } from "hono";
import {
  saveRole,
  deleteRole,
  UnknownPermissionError,
  UnlicensedPermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleNotFoundError,
  RoleInUseError,
  type Role,
  type UnitOfWork,
} from "@mezan/domain";
import { createRoleSchema, updateRoleSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";
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
 * Roles CRUD — every route is permission-gated (docs/catalog/09 §الأدوار).
 * Mirrors `createAccountsRouter` / `createSettingsRoutes`'s shape: a plain
 * `resolveAuthContext` parameter defaulting to `headerAuthContextResolver`.
 * `resolveEntitlements` has no repo-wide default (yet) — module licensing
 * varies per tenant, so the mounting app must supply it.
 */
export function createRolesRoutes(
  uow: UnitOfWork,
  resolveEntitlements: EntitlementsResolver,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

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
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    try {
      const role = await saveRole(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
      );
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
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    try {
      const role = await saveRole(
        { id: c.req.param("id"), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
      );
      return c.json(serializeRole(role));
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  app.delete("/:id", gate("admin.roles.manage"), async (c) => {
    try {
      await deleteRole(c.req.param("id"), uow);
      return c.body(null, 204);
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  return app;
}
