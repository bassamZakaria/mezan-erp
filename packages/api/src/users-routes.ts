import { Hono, type Context } from "hono";
import {
  saveUser,
  setUserStatus,
  InvalidUserError,
  DuplicateUserEmailError,
  DuplicateUsernameError,
  UnknownRoleError,
  UserNotFoundError,
  type User,
  type UnitOfWork,
  type SecretHasher,
} from "@mezan/domain";
import { createUserSchema, updateUserSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serializeUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    isCompanyAdmin: user.isCompanyAdmin,
    employeeId: user.employeeId,
    branchScope: user.branchScope,
    warehouseScope: user.warehouseScope,
    status: user.status,
    hasPin: user.pinHash !== null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function userErrorResponse(c: Context, err: unknown) {
  if (err instanceof InvalidUserError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof DuplicateUserEmailError || err instanceof DuplicateUsernameError) {
    return c.json({ error: err.code, message: err.message }, 409);
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
 * Users CRUD — every route is permission-gated (docs/catalog/09 §المستخدمون).
 * Mirrors `createAccountsRouter` / `createSettingsRoutes`'s shape: a plain
 * `resolveAuthContext` parameter defaulting to `headerAuthContextResolver`.
 */
export function createUsersRoutes(
  uow: UnitOfWork,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

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
    try {
      const user = await saveUser(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        hasher,
      );
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
    try {
      const user = await saveUser(
        { id: c.req.param("id"), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        hasher,
      );
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/deactivate", gate("admin.users.deactivate"), async (c) => {
    try {
      const user = await setUserStatus(c.req.param("id"), "inactive", uow);
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/activate", gate("admin.users.edit"), async (c) => {
    try {
      const user = await setUserStatus(c.req.param("id"), "active", uow);
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  return app;
}
