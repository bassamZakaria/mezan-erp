import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_CODES,
  MODULES,
  PERMISSIONS,
  isPlatformAdminOnly,
  isSensitive,
} from "../permissions/catalog.js";
import type { Entitlements } from "../entitlements/entitlements.js";
import type { Role } from "./role.js";
import type { UnitOfWork } from "../journal.js";
import { createAuthContext, type AuthContext } from "../permissions/auth-context.js";
import {
  PlatformOnlyPermissionError,
  UngrantablePermissionError,
  UnlicensedPermissionError,
  UnknownPermissionError,
  saveRole,
} from "./save-role.js";

function actorWith(...codes: string[]): AuthContext {
  return createAuthContext({
    userId: "actor-1",
    permissions: codes,
    branchScope: "*",
    warehouseScope: "*",
    authenticated: true,
  });
}

const TENANT_ADMIN = actorWith("*");

/** A tenant licensed for nothing — every gated module should refuse. */
const NO_MODULES: Entitlements = {
  plan: "basic",
  activeModules: [],
  features: {},
  seats: 1,
  expiresAt: null,
};

/**
 * A permission whose module IS entitlement-gated. Dashboard, workflow, admin,
 * audit and transactions are core platform surface and always licensed, so a
 * code from one of those proves nothing about the licence check.
 */
const GATED_PERMISSION = PERMISSIONS.find(
  (p) => !["dashboard", "workflow", "admin", "audit", "transactions"].includes(p.module),
)?.code as string;

const CATALOG_TO_ENTITLEMENT_MODULES: Readonly<Record<string, string>> = { cheques: "financial_papers" };

function uowWith(roles: Role[] = []): UnitOfWork & { saved: Role[] } {
  const saved: Role[] = [];
  const uow = {
    saved,
    roles: {
      async save(role: Role) {
        saved.push(role);
      },
      async findById(id: string) {
        return roles.find((r) => r.id === id) ?? null;
      },
      async findByCode(code: string) {
        return roles.find((r) => r.code === code) ?? null;
      },
      async list() {
        return roles;
      },
      async delete() {},
    },
    users: {
      async save() {},
      async findById() {
        return null;
      },
      async findByEmail() {
        return null;
      },
      async list() {
        return [];
      },
    },
    journal: {
      async save() {},
      async findById() {
        return null;
      },
    },
    async transaction(fn: (tx: unknown) => unknown) {
      return fn(uow);
    },
  } as unknown as UnitOfWork & { saved: Role[] };
  return uow;
}

const ALL_MODULES: Entitlements = {
  plan: "enterprise",
  activeModules: MODULES.map((m) => CATALOG_TO_ENTITLEMENT_MODULES[m.id] ?? m.id),
  features: {},
  seats: 10,
  expiresAt: null,
};

const command = {
  id: "role-1",
  code: "OPS",
  name: "العمليات",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("saveRole — what it refuses", () => {
  it("refuses a permission code the catalog does not know", async () => {
    await expect(
      saveRole({ ...command, permissions: ["accounting.invented.permission"] }, uowWith(), NO_MODULES, TENANT_ADMIN),
    ).rejects.toBeInstanceOf(UnknownPermissionError);
  });

  it("refuses a real permission whose module the tenant has not licensed", async () => {
    await expect(
      saveRole({ ...command, permissions: [GATED_PERMISSION] }, uowWith(), NO_MODULES, TENANT_ADMIN),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("refuses to touch a system role", async () => {
    const system = { id: "role-1", code: "ADMIN", isSystem: true } as Role;
    await expect(saveRole({ ...command, permissions: [] }, uowWith([system]), NO_MODULES, TENANT_ADMIN)).rejects.toThrow();
  });

  it("refuses a code another role already holds", async () => {
    const other = { id: "role-9", code: "OPS", isSystem: false } as Role;
    await expect(saveRole({ ...command, permissions: [] }, uowWith([other]), NO_MODULES, TENANT_ADMIN)).rejects.toThrow();
  });
});

describe("saveRole — the escalation paths D85 closed", () => {
  it("refuses the wildcard to a tenant licensed for nothing, the same as a named gated code", async () => {
    await expect(
      saveRole({ ...command, permissions: [GATED_PERMISSION] }, uowWith(), NO_MODULES, TENANT_ADMIN),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);

    await expect(
      saveRole({ ...command, permissions: ["*"] }, uowWith(), NO_MODULES, TENANT_ADMIN),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("refuses a platform-admin-only permission to a tenant admin who does not hold it", async () => {
    const platformOnly = ALL_PERMISSION_CODES.filter((c) => isPlatformAdminOnly(c));
    if (platformOnly.length === 0) return;

    const uow = uowWith();
    await expect(
      saveRole({ ...command, permissions: ["*", ...platformOnly] }, uow, ALL_MODULES, TENANT_ADMIN),
    ).rejects.toBeInstanceOf(PlatformOnlyPermissionError);
    expect(uow.saved).toHaveLength(0);
  });

  it("refuses to grant a permission the author does not hold", async () => {
    const uow = uowWith();
    await expect(
      saveRole(
        { ...command, permissions: [GATED_PERMISSION] },
        uow,
        ALL_MODULES,
        actorWith("dashboard.view"),
      ),
    ).rejects.toBeInstanceOf(UngrantablePermissionError);
    expect(uow.saved).toHaveLength(0);
  });

  it("takes the actor as an argument, so the grant rule can be enforced in the domain", () => {
    expect(saveRole.length).toBe(4);
  });

  it("marks some permissions sensitive in the catalog, and saveRole asks nothing extra of them", async () => {
    const sensitive = ALL_PERMISSION_CODES.filter((c) => isSensitive(c));
    expect(sensitive.length).toBeGreaterThan(0);
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*"] }, uow, ALL_MODULES, TENANT_ADMIN);
    expect(role.permissions).toContain("*");
  });
});

describe("saveRole — what it does store", () => {
  it("deduplicates the permission set it was handed", async () => {
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*", "*", "*"] }, uow, ALL_MODULES, TENANT_ADMIN);
    expect(role.permissions.filter((p) => p === "*")).toHaveLength(1);
  });

  it("keeps the code, name and id exactly as given", async () => {
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*"] }, uow, ALL_MODULES, TENANT_ADMIN);
    expect(role).toMatchObject({ id: "role-1", code: "OPS", name: "العمليات" });
    expect(uow.saved[0]).toMatchObject({ id: "role-1", code: "OPS" });
  });
});
