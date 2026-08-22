import { describe, it, expect } from "vitest";
import { createEntitlements, type Entitlements } from "../entitlements/entitlements.js";
import { createFakeUow } from "../test-support/fake-uow.js";
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
          permissions: ["hr.employee.view"],
          createdAt: "2026-08-08T00:00:00.000Z",
        },
        uow,
        ent,
      ),
    ).rejects.toBeInstanceOf(UnlicensedPermissionError);
  });

  it("rejects a duplicate role code on create", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
    );
    await expect(
      saveRole(
        { id: "role-2", code: "VAN_SALES", name: "ب", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
        uow,
        fullEntitlements(),
      ),
    ).rejects.toBeInstanceOf(DuplicateRoleCodeError);
  });

  it("allows updating the same role by id under its own code", async () => {
    const uow = createFakeUow();
    await saveRole(
      { id: "role-1", code: "VAN_SALES", name: "أ", description: "", permissions: [], createdAt: "2026-08-08T00:00:00.000Z" },
      uow,
      fullEntitlements(),
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
    );
    uow.userRecords.set("user-1", {
      id: "user-1",
      fullName: "سائق",
      email: "driver@cyag.test",
      phone: null,
      passwordHash: "x",
      pinHash: null,
      roleId: "role-1",
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      lastLoginAt: null,
      createdAt: "2026-08-08T00:00:00.000Z",
    });
    await expect(deleteRole("role-1", uow)).rejects.toBeInstanceOf(RoleInUseError);
  });
});
