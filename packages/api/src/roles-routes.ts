import { Hono, type Context } from "hono";
import {
  saveRole,
  deleteRole,
  ungrantablePermissions,
  detectSodConflicts,
  ROLE_TEMPLATES,
  findRoleTemplate,
  licensedTemplatePermissions,
  UnknownPermissionError,
  UnlicensedPermissionError,
  PlatformOnlyPermissionError,
  UngrantablePermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleNotFoundError,
  RoleInUseError,
  type AuditSink,
  type Role,
  type SodConflictMatch,
  type UnitOfWork,
} from "@mezan/domain";
import { createRoleFromTemplateSchema, createRoleSchema, updateRoleSchema, type RoleFromTemplateResultDTO, type RoleTemplateDTO } from "@mezan/contracts";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import type { EntitlementsResolver } from "./module-gate.js";
import type { SessionRegistry } from "./session-auth.js";

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
  if (err instanceof PlatformOnlyPermissionError || err instanceof UngrantablePermissionError) {
    return c.json({ error: err.code, message: err.message, permission: err.permission }, 403);
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
export interface RolesRoutesOptions {
  /** Who granted which permissions to whom. Without it, self-elevation leaves no trace. */
  readonly audit?: AuditSink;
  /**
   * The action types whose approval chain names this role CODE, if any.
   *
   * A role a workflow config depends on may not be deleted and may not be
   * renamed. `RoleInUseError` only ever asked whether a USER holds the role, so
   * an approver role with no current holder — the ordinary case in a shop where
   * the owner approves as a company admin — was deletable by anyone with
   * `admin.roles.manage`, which freed its code for an attacker to re-create
   * with an empty permission list and assign to themselves. That is the whole
   * create-and-approve chain, and this is the link that breaks it.
   */
  readonly workflowUsage?: (roleCode: string) => Promise<readonly string[]>;
  readonly sessions?: Pick<SessionRegistry, "revokeUser">;
}

export function createRolesRoutes(
  uow: UnitOfWork,
  resolveEntitlements: EntitlementsResolver,
  resolveAuthContext: AuthContextResolver,
  options: RolesRoutesOptions = {},
) {
  const { audit, workflowUsage, sessions } = options;
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * SECURITY: a session carries the permissions its role had at sign-in. A
   * role that changes or disappears must end those sessions, or the grant an
   * admin just withdrew keeps working until each holder happens to sign out.
   */
  async function endSessionsOfRoleHolders(roleId: string): Promise<void> {
    if (!sessions) return;
    for (const user of await uow.users.list()) {
      if (user.roleId === roleId) await sessions.revokeUser(user.id);
    }
  }

  /**
   * The permission LIST travels, not just the role name. "Role edited" is not
   * evidence; "this role gained `workflow.approve`" is.
   */
  function auditRole(c: Context, role: Role, action: "CREATE" | "UPDATE", before?: Role | null, extra?: Record<string, unknown>) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "ROLE",
      entityId: role.id,
      action,
      details: {
        code: role.code,
        name: role.name,
        permissions: [...role.permissions],
        ...extra,
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

  /** ENH-051 — a role saved WITH an acknowledged SoD conflict, and why. */
  function auditSodOverride(c: Context, role: Role, conflicts: readonly SodConflictMatch[], reason: string) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "ROLE",
      entityId: role.id,
      action: "SOD_OVERRIDE",
      severity: "WARNING",
      details: { code: role.code, reason, conflicts: conflicts.map((cf) => cf.ruleId) },
    });
  }

  /**
   * A role is a bundle of authority, so writing one is a GRANT. `admin.roles.manage`
   * says the caller may curate roles; it does not say which permissions they may
   * put in one. Without this, the shortest path to `"*"` on this whole system was
   * for a role manager to rewrite their own role's permission list — measured, and
   * it worked.
   */
  function refuseUnauthenticated(c: Context) {
    return c.json(
      { error: "PRIVILEGE_ESCALATION_DENIED", message: "لا يمكنك منح صلاحيات لا تملكها." },
      403,
    );
  }

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

  app.get("/templates", gate("admin.roles.view"), async (c) => {
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    const templates: RoleTemplateDTO[] = ROLE_TEMPLATES.map((template) => {
      const { granted, omitted } = licensedTemplatePermissions(template, entitlements);
      return {
        id: template.id,
        code: template.code,
        nameAr: template.nameAr,
        nameEn: template.nameEn,
        descriptionAr: template.descriptionAr,
        descriptionEn: template.descriptionEn,
        permissions: [...granted],
        omittedPermissions: [...omitted],
        ...(template.accessDays !== undefined ? { accessDays: template.accessDays } : {}),
      };
    });
    return c.json(templates);
  });

  app.post("/from-template", gate("admin.roles.manage"), async (c) => {
    const parsed = createRoleFromTemplateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const template = findRoleTemplate(parsed.data.templateId);
    if (!template) {
      return c.json({ error: "UNKNOWN_ROLE_TEMPLATE", message: "قالب الدور غير موجود.", messageEn: "The role template does not exist." }, 404);
    }
    const actor = getAuthContext(c);
    if (!actor) return refuseUnauthenticated(c);
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    const { granted, omitted } = licensedTemplatePermissions(template, entitlements);
    if (granted.length === 0) {
      return c.json(
        { error: "TEMPLATE_NOT_LICENSED", message: "لا توجد وحدات مرخصة تغطي صلاحيات هذا القالب.", messageEn: "None of this template's permissions belong to a licensed module." },
        422,
      );
    }
    const escalation = refuseUngrantable(c, granted);
    if (escalation) return escalation;
    const conflicts = detectSodConflicts(granted);
    if (conflicts.length > 0) return refuseSodConflicts(c, conflicts);
    const code = parsed.data.code ?? (await freeRoleCode(template.code));
    try {
      const role = await saveRole(
        {
          id: crypto.randomUUID(),
          code,
          name: parsed.data.name ?? template.nameAr,
          description: parsed.data.description ?? template.descriptionAr,
          permissions: granted,
          createdAt: new Date().toISOString(),
        },
        uow,
        entitlements,
        actor,
      );
      await auditRole(c, role, "CREATE", null, { templateId: template.id, omittedPermissions: [...omitted] });
      const result: RoleFromTemplateResultDTO = { ...serializeRole(role), permissions: [...role.permissions], templateId: template.id, omittedPermissions: [...omitted] };
      return c.json(result, 201);
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  async function freeRoleCode(base: string): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? base : `${base}_${attempt}`;
      if (!(await uow.roles.findByCode(candidate))) return candidate;
    }
  }

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
    const conflicts = detectSodConflicts(parsed.data.permissions);
    if (conflicts.length > 0 && !(parsed.data.acknowledge && parsed.data.reason)) {
      return refuseSodConflicts(c, conflicts);
    }
    const actor = getAuthContext(c);
    if (!actor) return refuseUnauthenticated(c);
    const entitlements = await resolveEntitlements(c);
    if (!entitlements) return c.json({ error: "ENTITLEMENTS_UNAVAILABLE" }, 500);
    try {
      const role = await saveRole(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
        actor,
      );
      await auditRole(c, role, "CREATE");
      if (conflicts.length > 0) await auditSodOverride(c, role, conflicts, parsed.data.reason ?? "");
      return c.json(serializeRole(role), 201);
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  /**
   * ENH-051 — a role that grants both sides of a `permissions/sod.ts` pair
   * is refused unless the caller explicitly acknowledges it with a reason.
   * The override itself is audited, so a saved conflict is a decision on
   * record, never a silent gap.
   */
  function refuseSodConflicts(c: Context, conflicts: readonly SodConflictMatch[]) {
    return c.json(
      {
        error: "SOD_CONFLICT",
        conflicts,
        message:
          "هذا الدور يجمع بين طرفي فصل مهام لا يجوز الجمع بينهما. أرسل acknowledge مع سبب لحفظه رغم ذلك.",
      },
      409,
    );
  }

  /** The refusal for a role an approval chain depends on. */
  function refuseWorkflowDependency(c: Context, code: string, actionTypes: readonly string[]) {
    return c.json(
      {
        error: "ROLE_USED_BY_WORKFLOW",
        code,
        actionTypes: [...actionTypes],
        message: `الدور "${code}" مستخدم في سلسلة موافقات (${actionTypes.join("، ")}) ولا يمكن حذفه أو تغيير رمزه.`,
      },
      409,
    );
  }

  app.put("/:id", gate("admin.roles.manage"), async (c) => {
    const parsed = updateRoleSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const escalation = refuseUngrantable(c, parsed.data.permissions);
    if (escalation) return escalation;
    const conflicts = detectSodConflicts(parsed.data.permissions);
    if (conflicts.length > 0 && !(parsed.data.acknowledge && parsed.data.reason)) {
      return refuseSodConflicts(c, conflicts);
    }
    const actor = getAuthContext(c);
    if (!actor) return refuseUnauthenticated(c);
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
      // Renaming the code frees the old one, which is the same hole as
      // deleting the role — the approval chain matches on the code.
      if (workflowUsage && parsed.data.code !== before.code) {
        const usedBy = await workflowUsage(before.code);
        if (usedBy.length > 0) return refuseWorkflowDependency(c, before.code, usedBy);
      }
    }
    try {
      const role = await saveRole(
        { id: c.req.param("id"), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        entitlements,
        actor,
      );
      await auditRole(c, role, "UPDATE", before);
      const sameAuthority =
        before !== null &&
        before !== undefined &&
        before.code === role.code &&
        before.permissions.length === role.permissions.length &&
        before.permissions.every((permission) => role.permissions.includes(permission));
      if (!sameAuthority) await endSessionsOfRoleHolders(role.id);
      if (conflicts.length > 0) await auditSodOverride(c, role, conflicts, parsed.data.reason ?? "");
      return c.json(serializeRole(role));
    } catch (err) {
      return roleErrorResponse(c, err);
    }
  });

  app.delete("/:id", gate("admin.roles.manage"), async (c) => {
    const before = await uow.roles.findById(c.req.param("id"));
    // A missing role was a silent 204 that deleted nothing and audited a row
    // about an entity that never existed.
    if (!before) return c.json({ error: "ROLE_NOT_FOUND", message: "الدور غير موجود." }, 404);
    // The same guard `PUT` runs, and for the same reason: a role's EXISTING
    // permissions are authority, so removing the role is a privilege change on
    // anything that referenced it. `POST` and `PUT` both checked; `DELETE`
    // checked neither.
    const outranks = refuseUngrantable(c, before.permissions);
    if (outranks) return outranks;
    if (workflowUsage) {
      const usedBy = await workflowUsage(before.code);
      if (usedBy.length > 0) return refuseWorkflowDependency(c, before.code, usedBy);
    }
    try {
      await deleteRole(c.req.param("id"), uow);
      await endSessionsOfRoleHolders(before.id);
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
