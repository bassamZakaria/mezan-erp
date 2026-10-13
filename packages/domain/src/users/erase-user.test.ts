import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { describe, expect, it } from "vitest";
import { ALL_SCOPE } from "../permissions/auth-context.js";
import type { Employee } from "../hr/employee.js";
import type { User } from "./user.js";
import {
  ERASED_USER_NAME_AR,
  ERASED_USER_NAME_EN,
  UserErasureRefusal,
  UserErasureRefusedError,
  assertUserErasable,
  attendanceNoteCarriesLocation,
  erasedEmployee,
  erasedUser,
  erasedUserEmail,
  isErasedUser,
  scrubAttendanceNote,
} from "./erase-user.js";

function user(over: Partial<User> = {}): User {
  return {
    id: "u-1",
    nameAr: "محمد الشهابي",
    nameEn: "Mohamed El-Shehaby",
    email: "mohamed@cyag.test",
    phone: "+201000000000",
    passwordHash: "hash",
    pinHash: "pin",
    roleId: "role-1",
    isCompanyAdmin: false,
    employeeId: null,
    photoUrl: "data:image/png;base64,AAA",
    branchScope: ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
    status: "active",
    lastLoginAt: "2026-09-01T08:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function employee(over: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    code: "EMP-0001",
    firstName: "Mohamed",
    lastName: "El-Shehaby",
    firstNameAr: "محمد",
    lastNameAr: "الشهابي",
    email: "mohamed@cyag.test",
    phone: "+201000000000",
    birthDate: "1990-04-02",
    nationalId: "29004021201234",
    gender: "male",
    maritalStatus: "married",
    departmentId: "dep-1",
    jobTitleId: "job-1",
    managerId: null,
    branchId: "MAIN",
    hireDate: "2020-01-01",
    workerCategory: "administrative",
    employmentType: "full_time",
    overtimeEligibility: "eligible",
    standardWorkHours: 8,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: true,
    requireBiometricAtClockIn: false,
    deviceBadgeId: "0042",
    hasPensionEntitlement: false,
    taxDisabilityExemption: false,
    address: { street: "12 ش الجلاء", city: "القاهرة", governorate: "القاهرة", postalCode: "11511" },
    emergencyContact: { name: "سارة", relationship: "زوجة", phone: "+201111111111", altPhone: null },
    status: "terminated",
    createdAt: "2020-01-01T00:00:00.000Z",
    ...over,
  } as Employee;
}

describe("erasedUser", () => {
  it("replaces every personal field with the placeholder and leaves the id, role and scopes in place", () => {
    const erased = erasedUser(user(), "2026-09-23T10:00:00.000Z", "unusable");

    expect(erased.nameAr).toBe(ERASED_USER_NAME_AR);
    expect(erased.nameEn).toBe(ERASED_USER_NAME_EN);
    expect(erased.email).toBe(erasedUserEmail("u-1"));
    expect(erased.phone).toBeNull();
    expect(erased.photoUrl).toBeNull();
    expect(erased.pinHash).toBeNull();
    expect(erased.passwordHash).toBe("unusable");
    expect(erased.lastLoginAt).toBeNull();
    expect(erased.status).toBe("inactive");

    // The id is what posted entries and audit rows name; it must survive, or
    // every screen that resolves a creator falls back to rendering a raw id.
    expect(erased.id).toBe("u-1");
    expect(erased.roleId).toBe("role-1");
    expect(erased.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(isErasedUser(erased)).toBe(true);
  });

  it("never leaves a blank name", () => {
    const erased = erasedUser(user(), "2026-09-23T10:00:00.000Z", "unusable");
    expect(erased.nameAr.trim()).not.toBe("");
    expect((erased.nameEn ?? "").trim()).not.toBe("");
  });

  it("is a fixed point: erasing an erased row changes nothing but the stamp", () => {
    const once = erasedUser(user(), "2026-09-23T10:00:00.000Z", "unusable");
    const twice = erasedUser(once, "2026-09-24T10:00:00.000Z", "unusable");
    expect({ ...twice, erasedAt: once.erasedAt }).toEqual(once);
  });

  it("gives every account a distinct unroutable address so the email index still holds", () => {
    expect(erasedUserEmail("U-1")).toBe("erased-u-1@erased.invalid");
    expect(erasedUserEmail("u-2")).not.toBe(erasedUserEmail("u-1"));
  });
});

describe("erasedEmployee", () => {
  it("drops the national id, contact and address but keeps what payroll reasons about", () => {
    const erased = erasedEmployee(employee());
    expect(erased.nationalId).toBeNull();
    expect(erased.birthDate).toBeNull();
    expect(erased.email).toBeNull();
    expect(erased.phone).toBeNull();
    expect(erased.address).toBeNull();
    expect(erased.emergencyContact).toBeNull();
    expect(erased.deviceBadgeId).toBeNull();
    expect(erased.gender).toBeNull();
    expect(erased.maritalStatus).toBeNull();

    expect(erased.code).toBe("EMP-0001");
    expect(erased.hireDate).toBe("2020-01-01");
    expect(erased.branchId).toBe("MAIN");
    expect(erased.priorServiceYears).toBe(0);
    expect(erased.firstNameAr).not.toBeNull();
    expect(erased.lastNameAr).not.toBeNull();
  });
});

describe("assertUserErasable", () => {
  const actorId = "admin-1";

  it("refuses the last active company admin, bilingually", () => {
    const target = user({ id: "admin-2", isCompanyAdmin: true });
    try {
      assertUserErasable(target, { actorId, users: [target], employee: null });
      expect.unreachable("the last admin must not be erasable");
    } catch (err) {
      expect(err).toBeInstanceOf(UserErasureRefusedError);
      const refusal = err as UserErasureRefusedError;
      expect(refusal.reason).toBe(UserErasureRefusal.LastCompanyAdmin);
      expect(refusal.message).toContain("آخر مدير شركة");
      expect(refusal.messageEn).toContain("last active company administrator");
    }
  });

  it("allows it once a second active admin exists, and refuses again when that one is itself erased", () => {
    const target = user({ id: "admin-2", isCompanyAdmin: true });
    const other = user({ id: "admin-3", isCompanyAdmin: true });
    expect(() => assertUserErasable(target, { actorId, users: [target, other], employee: null })).not.toThrow();

    const erasedOther = erasedUser(other, "2026-09-23T10:00:00.000Z", "unusable");
    expect(() => assertUserErasable(target, { actorId, users: [target, erasedOther], employee: null })).toThrow(
      UserErasureRefusedError,
    );
  });

  it("refuses an admin erasing themselves", () => {
    const target = user({ id: actorId });
    expect(() => assertUserErasable(target, { actorId, users: [target], employee: null })).toThrow(/بنفسك/);
  });

  it("refuses while the linked employee is still on the books", () => {
    const target = user({ employeeId: "emp-1" });
    expect(() => assertUserErasable(target, { actorId, users: [target], employee: employee({ status: EmployeeRefStatus.Active }) })).toThrow(
      UserErasureRefusedError,
    );
    expect(() => assertUserErasable(target, { actorId, users: [target], employee: employee() })).not.toThrow();
  });
});

describe("scrubAttendanceNote", () => {
  it("removes the coordinates the web clock stamped and leaves the hours", () => {
    const note = "حضور ذاتي 08:03 @ 30.04440,31.23570 ±12m · انصراف ذاتي 17:01 @ 30.04441,31.23571";
    expect(scrubAttendanceNote(note)).toBe("حضور ذاتي 08:03 · انصراف ذاتي 17:01");
    expect(attendanceNoteCarriesLocation(note)).toBe(true);
  });

  it("leaves a note with no fix alone", () => {
    expect(scrubAttendanceNote("حضور ذاتي 08:03")).toBe("حضور ذاتي 08:03");
    expect(attendanceNoteCarriesLocation("حضور ذاتي 08:03")).toBe(false);
    expect(scrubAttendanceNote(null)).toBeNull();
    expect(attendanceNoteCarriesLocation(null)).toBe(false);
  });
});
