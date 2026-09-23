import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_SCOPE,
  createAttachment,
  createAuthContext,
  ERASED_USER_NAME_AR,
  ERASED_USER_NAME_EN,
  erasedUserEmail,
  recordAttendance,
  saveUser,
  UserErasureRefusal,
  type AuditEvent,
  type AuditSink,
  type AuditStream,
  type Employee,
} from "@mezan/domain";
import {
  createSqliteAttachmentRepository,
  createSqliteAttendanceRepository,
  createSqliteClockCredentialRepository,
  createSqliteEmployeeRepository,
  createSqliteUnitOfWork,
  createSqliteWebauthnChallengeRepository,
  openSqliteConnection,
} from "@mezan/persistence";
import { createApp } from "./app.js";
import { createSessionRegistry } from "./session-auth.js";

const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

function memorySink(): AuditSink & { readonly rows: AuditEvent[] } {
  const rows: AuditEvent[] = [];
  return {
    rows,
    async append(event) {
      rows.push(event);
    },
    async query(stream: AuditStream, limit = 50) {
      return rows.filter((r) => r.stream === stream).slice(-limit);
    },
  };
}

const HASHER = { hash: async (v: string) => `h:${v}`, verify: async (v: string, h: string) => h === `h:${v}` };

function employeeOf(over: Partial<Employee> = {}): Employee {
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
    departmentId: null,
    jobTitleId: null,
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

/** One connection for every store, exactly as `create-backend.ts` builds the real server. */
async function harness(actorId = "admin-1") {
  const { sqlite } = openSqliteConnection(":memory:");
  closers.push(() => sqlite.close());
  const uow = createSqliteUnitOfWork(sqlite);
  const employees = createSqliteEmployeeRepository(sqlite);
  const attendance = createSqliteAttendanceRepository(sqlite);
  const attachments = createSqliteAttachmentRepository(sqlite);
  const clockCredentials = createSqliteClockCredentialRepository(sqlite);
  const challenges = createSqliteWebauthnChallengeRepository(sqlite);
  const audit = memorySink();
  const sessions = createSessionRegistry();

  const ctx = createAuthContext({ userId: actorId, permissions: ["*"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const app = createApp(uow, {
    resolveAuthContext: () => ctx,
    auditSink: audit,
    security: { sessions },
    hr: {
      departments: { findById: async () => null, list: async () => [], create: async () => {}, update: async () => {} },
      jobTitles: { findById: async () => null, list: async () => [], create: async () => {}, update: async () => {} },
      employees,
      contracts: { findById: async () => null, listByEmployeeId: async () => [], list: async () => [], create: async () => {}, update: async () => {} },
      holidays: { list: async () => [], create: async () => {}, delete: async () => {} },
      leaveRequests: { findById: async () => null, listByEmployeeId: async () => [], list: async () => [], create: async () => {}, update: async () => {} },
      users: uow.users,
      numbering: { next: async () => ({ formatted: "EMP-0002" }) },
      attendance,
      attachments,
      clockCredentials,
      challenges,
    },
  } as Parameters<typeof createApp>[1]);

  return { app, uow, employees, attendance, attachments, clockCredentials, challenges, audit, sessions };
}

async function seedUser(
  uow: Awaited<ReturnType<typeof harness>>["uow"],
  over: { id: string; email: string; isCompanyAdmin?: boolean; employeeId?: string | null; nameAr?: string },
) {
  const isCompanyAdmin = over.isCompanyAdmin ?? true;
  if (!isCompanyAdmin && !(await uow.roles.findById("role-clerk"))) {
    await uow.roles.save({
      id: "role-clerk",
      code: "CLERK",
      name: "كاتب",
      description: "",
      permissions: ["sales.invoice.view"],
      isSystem: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } as never);
  }
  const user = await saveUser(
    {
      id: over.id,
      nameAr: over.nameAr ?? "محمد الشهابي",
      nameEn: "Mohamed El-Shehaby",
      email: over.email,
      phone: "+201000000000",
      password: "TempPass123",
      pin: "4242",
      roleId: isCompanyAdmin ? null : "role-clerk",
      isCompanyAdmin,
      employeeId: over.employeeId ?? null,
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    uow,
    HASHER,
  );
  return user;
}

function erase(app: Awaited<ReturnType<typeof harness>>["app"], id: string, body: unknown) {
  return app.fetch(
    new Request(`http://x/users/${id}/erase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /users/:id/erase — personal-data erasure (D348)", () => {
  it("anonymises the user and the linked employee, drops the selfie, the keys and the GPS fix, and keeps the hours", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false, employeeId: "emp-1" });
    await h.employees.create(employeeOf());

    const entry = recordAttendance({
      id: "att-1",
      employeeId: "emp-1",
      date: "2026-09-01",
      checkIn: "08:03",
      checkOut: "17:01",
      notes: "حضور ذاتي 08:03 @ 30.04440,31.23570 ±12m",
      holidays: [],
    });
    await h.attendance.create(entry);
    await createAttachment(
      {
        entityType: "attendance",
        entityId: "att-1",
        fileName: "selfie-in-2026-09-01.jpg",
        mimeType: "image/jpeg",
        notes: "صورة الحضور الذاتي",
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
        uploadedBy: "u-1",
      },
      h.attachments,
    );
    await h.clockCredentials.create({
      id: "cred-1",
      employeeId: "emp-1",
      userId: "u-1",
      credentialId: "abc",
      publicKeySpki: "spki",
      algorithm: -7,
      rpId: "localhost",
      signCount: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    });
    await h.challenges.issue("u-1", "assert", "localhost");

    const before = await h.uow.users.findById("u-1");
    expect(before?.nameAr).toBe("محمد الشهابي");
    expect(before?.email).toBe("mohamed@cyag.test");
    expect(before?.pinHash).not.toBeNull();
    expect((await h.employees.findById("emp-1"))?.nationalId).toBe("29004021201234");

    const res = await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات محو بياناته" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { nameAr: string; nameEn: string; email: string; phone: string | null; photoUrl: string | null; erasedAt: string | null };
      erased: Record<string, unknown>;
      alreadyErased: boolean;
      retained: string[];
    };

    expect(body.user.nameAr).toBe(ERASED_USER_NAME_AR);
    expect(body.user.nameEn).toBe(ERASED_USER_NAME_EN);
    expect(body.user.email).toBe(erasedUserEmail("u-1"));
    expect(body.user.phone).toBeNull();
    expect(body.user.photoUrl).toBeNull();
    expect(body.user.erasedAt).not.toBeNull();
    expect(body.alreadyErased).toBe(false);
    expect(body.erased).toMatchObject({
      employee: true,
      clockInSelfies: 1,
      webauthnCredentials: 1,
      webauthnChallenges: 1,
      attendanceLocations: 1,
      sessionsRevoked: true,
    });
    expect(body.retained.length).toBeGreaterThan(0);

    const after = await h.uow.users.findById("u-1");
    expect(after?.pinHash).toBeNull();
    expect(after?.status).toBe("inactive");
    expect(after?.lastLoginAt).toBeNull();
    expect(after?.passwordHash).not.toBe(before?.passwordHash);

    const employee = await h.employees.findById("emp-1");
    expect(employee?.nationalId).toBeNull();
    expect(employee?.phone).toBeNull();
    expect(employee?.address).toBeNull();
    // The code, the branch and the hire date are what payroll and the posted
    // journals still reason about; erasing them would break the books.
    expect(employee?.code).toBe("EMP-0001");
    expect(employee?.hireDate).toBe("2020-01-01");

    expect(await h.attachments.list("attendance", "att-1")).toHaveLength(0);
    expect(await h.clockCredentials.findByEmployeeId("emp-1")).toBeNull();

    const scrubbed = await h.attendance.findById("att-1");
    expect(scrubbed?.notes).toBe("حضور ذاتي 08:03");
    expect(scrubbed?.checkIn).toBe("08:03");
    expect(scrubbed?.checkOut).toBe("17:01");
    expect(scrubbed?.workedMinutes).toBe(entry.workedMinutes);
    expect(scrubbed?.status).toBe(entry.status);
  });

  it("records the erasure on the security stream without copying the name or email into it", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false });

    await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });

    const row = h.audit.rows.find((r) => r.action === "PERSONAL_DATA_ERASED");
    expect(row).toBeDefined();
    expect(row?.stream).toBe("security");
    expect(row?.actor).toBe("admin-1");
    expect(row?.entityId).toBe("u-1");
    expect(row?.severity).toBe("CRITICAL");
    expect(row?.timestamp).toBeTruthy();

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("محمد الشهابي");
    expect(serialized).not.toContain("mohamed@cyag.test");
  });

  it("is idempotent — the second call changes nothing and is not an error", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false });

    const first = await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });
    expect(first.status).toBe(200);
    const snapshot = await h.uow.users.findById("u-1");

    const second = await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { alreadyErased: boolean }).alreadyErased).toBe(true);

    expect(await h.uow.users.findById("u-1")).toEqual(snapshot);
    expect(h.audit.rows.filter((r) => r.action === "PERSONAL_DATA_ERASED")).toHaveLength(1);
  });

  it("refuses the last active company admin, in Arabic and English", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "u-admin", email: "only-admin@cyag.test", isCompanyAdmin: true });

    const res = await erase(h.app, "u-admin", { confirmEmail: "only-admin@cyag.test", reason: "طلب صاحب البيانات" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string; message: string; messageEn: string };
    expect(body.error).toBe("USER_ERASURE_REFUSED");
    expect(body.reason).toBe(UserErasureRefusal.LastCompanyAdmin);
    expect(body.message).toContain("آخر مدير شركة");
    expect(body.messageEn).toContain("last active company administrator");

    const untouched = await h.uow.users.findById("u-admin");
    expect(untouched?.email).toBe("only-admin@cyag.test");
    expect(untouched?.erasedAt ?? null).toBeNull();
  });

  it("refuses a confirmation email that does not match, and changes nothing", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false });

    const res = await erase(h.app, "u-1", { confirmEmail: "someone-else@cyag.test", reason: "طلب صاحب البيانات" });
    expect(res.status).toBe(422);
    expect((await h.uow.users.findById("u-1"))?.nameAr).toBe("محمد الشهابي");
  });

  it("refuses an admin erasing themselves", async () => {
    const h = await harness("u-self");
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-self", email: "self@cyag.test", isCompanyAdmin: false });

    const res = await erase(h.app, "u-self", { confirmEmail: "self@cyag.test", reason: "طلب صاحب البيانات" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(UserErasureRefusal.Self);
  });

  it("refuses while the linked employee is still employed", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false, employeeId: "emp-1" });
    await h.employees.create(employeeOf({ status: "active" }));

    const res = await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(UserErasureRefusal.EmployeeStillEmployed);
    expect((await h.employees.findById("emp-1"))?.nationalId).toBe("29004021201234");
  });

  it("refuses to edit or re-enable an erased account", async () => {
    const h = await harness();
    await seedUser(h.uow, { id: "admin-2", email: "second-admin@cyag.test" });
    await seedUser(h.uow, { id: "u-1", email: "mohamed@cyag.test", isCompanyAdmin: false });
    await erase(h.app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });

    const activate = await h.app.fetch(
      new Request("http://x/users/u-1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    );
    expect(activate.status).toBe(409);
    expect(((await activate.json()) as { error: string }).error).toBe("USER_ERASED");
  });

  it("is gated on admin.users.erase_personal", async () => {
    const { sqlite } = openSqliteConnection(":memory:");
    closers.push(() => sqlite.close());
    const uow = createSqliteUnitOfWork(sqlite);
    const employees = createSqliteEmployeeRepository(sqlite);
    const ctx = createAuthContext({
      userId: "admin-1",
      permissions: ["admin.users.view", "admin.users.edit"],
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const app = createApp(uow, {
      resolveAuthContext: () => ctx,
      auditSink: memorySink(),
      hr: {
        departments: { findById: async () => null, list: async () => [], create: async () => {}, update: async () => {} },
        jobTitles: { findById: async () => null, list: async () => [], create: async () => {}, update: async () => {} },
        employees,
        contracts: { findById: async () => null, listByEmployeeId: async () => [], list: async () => [], create: async () => {}, update: async () => {} },
        holidays: { list: async () => [], create: async () => {}, delete: async () => {} },
        leaveRequests: { findById: async () => null, listByEmployeeId: async () => [], list: async () => [], create: async () => {}, update: async () => {} },
        users: uow.users,
        numbering: { next: async () => ({ formatted: "EMP-0002" }) },
      },
    } as Parameters<typeof createApp>[1]);

    const res = await erase(app, "u-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" });
    expect(res.status).toBe(403);
  });
});
