import { describe, it, expect } from "vitest";
import { createEntitlements, type Entitlements } from "../entitlements/entitlements.js";
import { createFakeUow } from "../test-support/fake-uow.js";
import { createAuthContext } from "../permissions/auth-context.js";
import {
  saveRole,
  deleteRole,
  UnknownPermissionError,
  UnlicensedPermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleInUseError,
} from "./save-role.js";

function fullEntitlements(): Entitlements {
  return createEntitlements({
    plan: "ENTERPRISE",
    activeModules: ["sales", "purchases", "field", "pos", "financial_papers"],
    features: {},
    seats: 10,
    expiresAt: null,
  });
}

const TENANT_ADMIN = createAuthContext({
  userId: "actor-1",
  permissions: ["*"],
  branchScope: "*",
  warehouseScope: "*",
  authenticated: true,
});

describe("saveRole", () => {
  it("creates a custom role with a valid permission set", async () => {
    const uow = createFakeUow();
    const role = await saveRole(
      {
        id: "role-1",
        code: "VAN_SALES",
        name: "مندوب مبيعات",
        description: "",
        permissions: ["sales.invoice.view_own", "sales.invoice.create", "field.van_trip.view_own", "field.van_trip.open"],
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );

    expect(role.isSystem).toBe(false);
    expect(role.permissions).toHaveLength(4);
    expect(await uow.roles.findById("role-1")).toEqual(role);
  });

  it("rejects an unknown permission code", async () => {
    const uow = createFakeUow();
    await expect(
      saveRole(
        {
          id: "role-1",
          code: "X",
          name: "x",
          description: "",
          permissions: ["not.a.real.permission"],
          createdAt: "2026-08-08T00:00:00.000Z",
        },
        uow,
        fullEntitlements(),
        TENANT_ADMIN,
      ),
    ).rejects.toBeInstanceOf(UnknownPermissionError);
  });

  it("rejects a permission whose module is not licensed", async () => {
    const uow = createFakeUow();
    const ent = createEntitlements({
      plan: "STANDARD",
      activeModules: ["sales"],
      features: {},
      seats: 5,
      expiresAt: null,
    });
    await expect(
      saveRole(
        {
          id: "role-1",
          code: "X",
          name: "x",
          description: "",
          // Payroll is a paid HR part; the staff list (hr.employee.view) is free and grantable everywhere.
          permissions: ["hr.payroll.view"],
          createdAt: "2026-08-08T00:00:00.000Z",
        },
        uow,
        ent,
        TENANT_ADMIN,
      ),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("grants the free HR staff list on a plan without HR, and a sold HR part on its own", async () => {
    const plan = (activeModules: string[]) => createEntitlements({ plan: "STANDARD", activeModules, features: {}, seats: 5, expiresAt: null });
    const role = (id: string, permissions: string[]) => ({ id, code: id, name: id, description: "", permissions, createdAt: "2026-08-08T00:00:00.000Z" });
    await expect(saveRole(role("REP", ["sales.invoice.view", "hr.employee.view"]), createFakeUow(), plan(["sales"]), TENANT_ADMIN)).resolves.toBeDefined();
    await expect(saveRole(role("TIME", ["hr.attendance.view"]), createFakeUow(), plan(["sales", "hr.time"]), TENANT_ADMIN)).resolves.toBeDefined();
    await expect(saveRole(role("PAY", ["hr.payroll.view"]), createFakeUow(), plan(["sales", "hr.time"]), TENANT_ADMIN)).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("mints the wildcard on a plan that sells only an HR part, never on the free part alone", async () => {
    const plan = (activeModules: string[]) => createEntitlements({ plan: "STANDARD", activeModules, features: {}, seats: 5, expiresAt: null });
    const admin = (id: string) => ({ id, code: id, name: id, description: "", permissions: ["*"], createdAt: "2026-08-08T00:00:00.000Z" });
    await expect(saveRole(admin("ADM"), createFakeUow(), plan(["hr.time"]), TENANT_ADMIN)).resolves.toBeDefined();
    await expect(saveRole(admin("NOPE"), createFakeUow(), plan(["hr.people"]), TENANT_ADMIN)).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("rejects a duplicate role code on create", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );
    await expect(
      saveRole(
        { id: "role-2", code: "VAN_SALES", name: "ب", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
        uow,
        fullEntitlements(),
        TENANT_ADMIN,
      ),
    ).rejects.toBeInstanceOf(DuplicateRoleCodeError);
  });

  it("allows updating the same role by id under its own code", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );
    const updated = await saveRole(
      {
        id: "role-1",
        code: "VAN_SALES",
        name: "مندوب مبيعات محدث",
        description: "وصف",
        permissions: ["sales.invoice.view_own"],
        createdAt: "2026-08-08T00:00:00.000Z",
      },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );
    expect(updated.name).toBe("مندوب مبيعات محدث");
    expect(updated.createdAt).toBe("2026-08-08T00:00:00.000Z");
  });

  it("refuses to modify a system role", async () => {
    const uow = createFakeUow();
    uow.roleRecords.set("sys-1", {
      id: "sys-1",
      code: "OWNER",
      name: "مالك",
      description: "",
      permissions: ["*"],
      isSystem: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await expect(
      saveRole(
        { id: "sys-1", code: "OWNER", name: "تعديل", description: "", permissions: [], createdAt: "2026-01-01T00:00:00.000Z" },
        uow,
        fullEntitlements(),
        TENANT_ADMIN,
      ),
    ).rejects.toBeInstanceOf(SystemRoleImmutableError);
  });
});

describe("deleteRole", () => {
  it("deletes a custom role that no user holds", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );
    await deleteRole("role-1", uow);
    expect(await uow.roles.findById("role-1")).toBeNull();
  });

  it("refuses to delete a role still assigned to a user", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
      TENANT_ADMIN,
    );
    uow.userRecords.set("user-1", {
      id: "user-1",
      nameAr: "سائق",
    nameEn: null,
      email: "driver@cyag.test",
      phone: null,
      passwordHash: "x",
      mustChangePassword: false,
      roleId: "role-1",
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      photoUrl: null,
      lastLoginAt: null,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    await expect(deleteRole("role-1", uow)).rejects.toBeInstanceOf(RoleInUseError);
  });
});
