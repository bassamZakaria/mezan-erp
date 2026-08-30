import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, PERMISSIONS, isPlatformAdminOnly, isSensitive } from "../permissions/catalog.js";
import type { Entitlements } from "../entitlements/entitlements.js";
import type { Role } from "./role.js";
import type { UnitOfWork } from "../journal.js";
import { UnlicensedPermissionError, UnknownPermissionError, saveRole } from "./save-role.js";

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
      saveRole({ ...command, permissions: ["accounting.invented.permission"] }, uowWith(), NO_MODULES),
    ).rejects.toBeInstanceOf(UnknownPermissionError);
  });

  it("refuses a real permission whose module the tenant has not licensed", async () => {
    await expect(
      saveRole({ ...command, permissions: [GATED_PERMISSION] }, uowWith(), NO_MODULES),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("refuses to touch a system role", async () => {
    const system = { id: "role-1", code: "ADMIN", isSystem: true } as Role;
    await expect(saveRole({ ...command, permissions: [] }, uowWith([system]), NO_MODULES)).rejects.toThrow();
  });

  it("refuses a code another role already holds", async () => {
    const other = { id: "role-9", code: "OPS", isSystem: false } as Role;
    await expect(saveRole({ ...command, permissions: [] }, uowWith([other]), NO_MODULES)).rejects.toThrow();
  });
});

describe("saveRole — the escalation paths it does NOT close (D85)", () => {
  it("LIMITATION (D85): the wildcard is exempt from the licence check, so an unlicensed tenant can still mint a full admin role", async () => {
    // A named permission from a gated module is refused for this tenant…
    await expect(
      saveRole({ ...command, permissions: [GATED_PERMISSION] }, uowWith(), NO_MODULES),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);

    // …but `"*"`, which outranks all of them, is accepted.
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*"] }, uow, NO_MODULES);
    expect(role.permissions).toContain("*");
    expect(uow.saved).toHaveLength(1);
  });

  it("LIMITATION (D85): a platform-admin-only permission is grantable to an ordinary tenant role", async () => {
    const platformOnly = ALL_PERMISSION_CODES.filter((c) => isPlatformAdminOnly(c));
    if (platformOnly.length === 0) return;

    // The catalog marks these as platform-admin-only, and saveRole never asks.
    const uow = uowWith();
    const role = await saveRole(
      { ...command, permissions: ["*", ...platformOnly] },
      uow,
      NO_MODULES,
    );
    for (const code of platformOnly) expect(role.permissions).toContain(code);
    expect(uow.saved).toHaveLength(1);
  });

  it("LIMITATION (D85): saveRole never sees who is asking, so it cannot stop a role granting more than its author holds", async () => {
    // The use-case's whole signature is (command, unitOfWork, entitlements) —
    // there is no actor in it, so "you may not grant what you do not hold"
    // cannot be enforced here. It would have to live in the route's gate.
    expect(saveRole.length).toBe(3);
  });

  it("marks some permissions sensitive in the catalog, and saveRole asks nothing extra of them", async () => {
    const sensitive = ALL_PERMISSION_CODES.filter((c) => isSensitive(c));
    expect(sensitive.length).toBeGreaterThan(0);
    // They are only refused when their MODULE is unlicensed — sensitivity
    // itself carries no additional gate here.
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*"] }, uow, NO_MODULES);
    expect(role.permissions).toContain("*");
  });
});

describe("saveRole — what it does store", () => {
  it("deduplicates the permission set it was handed", async () => {
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*", "*", "*"] }, uow, NO_MODULES);
    expect(role.permissions.filter((p) => p === "*")).toHaveLength(1);
  });

  it("keeps the code, name and id exactly as given", async () => {
    const uow = uowWith();
    const role = await saveRole({ ...command, permissions: ["*"] }, uow, NO_MODULES);
    expect(role).toMatchObject({ id: "role-1", code: "OPS", name: "العمليات" });
    expect(uow.saved[0]).toMatchObject({ id: "role-1", code: "OPS" });
  });
});
