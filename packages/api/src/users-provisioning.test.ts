import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_SCOPE,
  createAuthContext,
  createDefaultUserPreferences,
  createEntitlements,
  type AuditEvent,
  type Role,
  type User,
} from "@mezan/domain";
import {
  createScryptHasher,
  createSqliteAuditSink,
  createSqliteBranchStore,
  createSqliteUnitOfWork,
  createSqliteUserPreferencesStore,
  createSqliteWarehouseStore,
  type SqliteAuditSinkHandle,
} from "@mezan/persistence";
import { createApp } from "./app.js";

const sinks: SqliteAuditSinkHandle[] = [];
afterEach(() => {
  for (const sink of sinks.splice(0)) sink.db.close();
});

const NOW = "2026-10-17T00:00:00.000Z";
const ALL_MODULES = ["sales", "purchases", "inventory", "treasury", "accounting", "financial_papers", "hr", "installments", "assets", "crm", "projects", "contracting", "cheques"];

interface Options {
  readonly permissions?: string[];
  readonly branchScope?: readonly string[] | typeof ALL_SCOPE;
  readonly seats?: number;
  readonly modules?: string[];
}

function harness(options: Options = {}) {
  const sink = createSqliteAuditSink(":memory:", { chainKey: "k".repeat(64) });
  sinks.push(sink);
  const sqlite = sink.db;
  const uow = createSqliteUnitOfWork(sqlite);
  const branches = createSqliteBranchStore(sqlite);
  const warehouses = createSqliteWarehouseStore(sqlite);
  const preferences = createSqliteUserPreferencesStore(sqlite);
  const entitlements = createEntitlements({
    plan: "test",
    activeModules: options.modules ?? ALL_MODULES,
    features: {},
    seats: options.seats ?? 50,
    expiresAt: null,
  });
  const ctx = createAuthContext({
    userId: "caller",
    permissions: options.permissions ?? ["*"],
    branchScope: options.branchScope ?? ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
  });
  const app = createApp(uow, {
    resolveAuthContext: () => ctx,
    resolveEntitlements: () => entitlements,
    branchStore: branches,
    warehouseStore: warehouses,
    userPreferences: preferences,
    hasher: createScryptHasher(),
    auditSink: {
      append: (event: AuditEvent) => sink.append(event),
      query: (stream, limit) => sink.query(stream, limit),
      atomic: <T>(fn: () => Promise<T>) => sink.atomic(fn),
      insideTransaction: () => sink.insideTransaction(),
      settled: () => sink.settled(),
      turn: <T>(fn: () => Promise<T>) => sink.turn(fn),
    },
  });
  return { app, uow, branches, warehouses, preferences, sqlite, hasher: createScryptHasher() };
}

type Harness = ReturnType<typeof harness>;

function send(h: Harness, method: string, url: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    h.app.fetch(
      new Request(`http://x${url}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  );
}

async function seedBranchAndWarehouse(h: Harness) {
  await h.branches.insert({ id: "BR1", code: "MAIN", name: "الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true });
  await h.warehouses.insert({
    id: "WH1",
    code: "WH-1",
    name: "المخزن",
    nameEn: null,
    branchId: "BR1",
    type: "MAIN",
    isDefault: true,
    active: true,
    projectId: null,
    custodianUserId: null,
  });
}

async function seedRole(h: Harness, code: string, permissions: string[]): Promise<Role> {
  const role: Role = { id: `role-${code}`, code, name: code, description: "", permissions, isSystem: false, createdAt: NOW };
  await h.uow.roles.save(role);
  return role;
}

const CASHIER_PERMISSIONS = ["treasury.cash_voucher.create", "treasury.cash_voucher.view"];

const HEADER = "name_ar,name_en,email,phone,role,branches,warehouses";
const row = (name: string, email: string, role = "CASH", branches = "MAIN", warehouses = "WH-1") => `${name},,${email},,${role},${branches},${warehouses}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

interface Report {
  dryRun: boolean;
  digest: string | null;
  fileProblems: { code: string }[];
  rows: { rowNumber: number; status: string; problems: { code: string }[] }[];
  summary: { total: number; valid: number; invalid: number };
  seats: { limit: number | null; active: number; available: number | null };
  created: number;
  credentials: { rowNumber: number; userId: string; email: string; pin: string; password: string }[];
}

async function dryRun(h: Harness, body: string, extra: Record<string, unknown> = {}) {
  const res = await send(h, "POST", "/users/import", { csv: body, dryRun: true, ...extra });
  return { res, report: (await res.json()) as Report };
}

describe("role templates", () => {
  it("lists every template with the permissions the tenant is licensed for", async () => {
    const h = harness({ modules: ["sales"] });
    const res = await send(h, "GET", "/roles/templates");
    expect(res.status).toBe(200);
    const templates = (await res.json()) as { id: string; permissions: string[]; omittedPermissions: string[] }[];
    expect(templates.map((template) => template.id)).toEqual(["cashier", "accountant", "warehouse_keeper", "sales_rep", "manager", "auditor", "external_auditor"]);
    const rep = templates.find((template) => template.id === "sales_rep")!;
    expect(rep.permissions).toContain("sales.invoice.create");
    expect(rep.omittedPermissions).toEqual(["inventory.stock.view"]);
  });

  it("creates a role from a template, audits it, and picks a free code on a repeat", async () => {
    const h = harness();
    const first = await send(h, "POST", "/roles/from-template", { templateId: "accountant" });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { code: string; permissions: string[]; templateId: string; omittedPermissions: string[] };
    expect(created.code).toBe("ACCOUNTANT");
    expect(created.templateId).toBe("accountant");
    expect(created.permissions).toContain("accounting.journal.post");
    expect(created.omittedPermissions).toEqual([]);

    const second = await send(h, "POST", "/roles/from-template", { templateId: "accountant" });
    expect(((await second.json()) as { code: string }).code).toBe("ACCOUNTANT_2");

    const events = await h.uow.roles.list();
    expect(events).toHaveLength(2);
    const audit = h.sqlite.prepare("SELECT action, details FROM audit_event WHERE entity_type = 'ROLE'").all() as { action: string; details: string }[];
    expect(audit.some((row) => row.action === "CREATE" && row.details.includes("accountant"))).toBe(true);
  });

  it("omits permissions of unlicensed modules and says so", async () => {
    const h = harness({ modules: ["sales"] });
    const res = await send(h, "POST", "/roles/from-template", { templateId: "sales_rep" });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { permissions: string[]; omittedPermissions: string[] };
    expect(created.permissions).not.toContain("inventory.stock.view");
    expect(created.omittedPermissions).toEqual(["inventory.stock.view"]);
  });

  it("keeps the platform-level permissions for a tenant with no licensed module", async () => {
    const h = harness({ modules: [] });
    const res = await send(h, "POST", "/roles/from-template", { templateId: "auditor" });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { permissions: string[]; omittedPermissions: string[] };
    expect(created.permissions).toEqual(expect.arrayContaining(["dashboard.view", "audit.logs.view", "admin.users.view"]));
    expect(created.permissions).not.toContain("accounting.journal.view");
    expect(created.omittedPermissions).toContain("accounting.journal.view");
  });

  it("answers 404 for an unknown template and 409 for a taken explicit code", async () => {
    const h = harness();
    expect((await send(h, "POST", "/roles/from-template", { templateId: "ghost" })).status).toBe(404);
    await send(h, "POST", "/roles/from-template", { templateId: "auditor", code: "READONLY" });
    const dup = await send(h, "POST", "/roles/from-template", { templateId: "auditor", code: "READONLY" });
    expect(dup.status).toBe(409);
  });

  it("never grants a caller more than they hold, template or not", async () => {
    const h = harness({ permissions: ["admin.roles.manage", "admin.roles.view", "dashboard.view"] });
    const res = await send(h, "POST", "/roles/from-template", { templateId: "manager" });
    expect(res.status).toBe(403);
    expect(await h.uow.roles.list()).toHaveLength(0);
  });
});

describe("POST /users/import", () => {
  it("dry-runs a clean file, writes nothing and returns a digest", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const { res, report } = await dryRun(h, csv(row("سلمى", "salma@x.test"), row("كريم", "karim@x.test")));
    expect(res.status).toBe(200);
    expect(report.dryRun).toBe(true);
    expect(report.summary).toEqual({ total: 2, valid: 2, invalid: 0 });
    expect(report.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(report.credentials).toEqual([]);
    expect(await h.uow.users.list()).toHaveLength(0);
  });

  it("is a dry run unless told otherwise", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const res = await send(h, "POST", "/users/import", { csv: csv(row("سلمى", "salma@x.test")) });
    expect(((await res.json()) as Report).dryRun).toBe(true);
    expect(await h.uow.users.list()).toHaveLength(0);
  });

  it("reports per-row errors and issues no digest", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = csv(
      row("سلمى", "salma@x.test"),
      row("", "not-an-email"),
      row("كريم", "salma@x.test"),
      row("ليلى", "laila@x.test", "GHOST"),
      row("هالة", "hala@x.test", "CASH", "NOWHERE", "WH-1"),
      row("عمر", "omar@x.test", "CASH", "MAIN", "NOPE"),
    );
    const { report } = await dryRun(h, body);
    expect(report.digest).toBeNull();
    const codes = Object.fromEntries(report.rows.map((entry) => [entry.rowNumber, entry.problems.map((problem) => problem.code)]));
    expect(codes[2]).toEqual([]);
    expect(codes[3]).toEqual(["ROW_NAME_REQUIRED", "ROW_INVALID_EMAIL"]);
    expect(codes[4]).toEqual(["ROW_DUPLICATE_EMAIL_IN_FILE"]);
    expect(codes[5]).toEqual(["ROW_UNKNOWN_ROLE"]);
    expect(codes[6]).toEqual(["ROW_UNKNOWN_BRANCH"]);
    expect(codes[7]).toEqual(["ROW_UNKNOWN_WAREHOUSE"]);
    expect(report.summary).toMatchObject({ total: 6, valid: 1, invalid: 5 });
  });

  it("rejects a file that carries credentials or an admin flag, and one with missing columns", async () => {
    const h = harness();
    const withPin = await dryRun(h, `${HEADER},pin\n${row("سلمى", "s@x.test")},123456`);
    expect(withPin.report.fileProblems.map((problem) => problem.code)).toEqual(["FILE_CREDENTIAL_COLUMN"]);
    const withAdmin = await dryRun(h, `${HEADER},isCompanyAdmin\n${row("سلمى", "s@x.test")},true`);
    expect(withAdmin.report.fileProblems.map((problem) => problem.code)).toEqual(["FILE_ADMIN_COLUMN"]);
    const missing = await dryRun(h, "name_ar,email\nسلمى,s@x.test");
    expect(missing.report.fileProblems.map((problem) => problem.code)).toEqual(["FILE_MISSING_COLUMN", "FILE_MISSING_COLUMN", "FILE_MISSING_COLUMN"]);
  });

  it("accepts a semicolon-delimited, BOM-prefixed file as Excel writes it", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = `﻿name_ar;name_en;email;phone;role;branches;warehouses\nسلمى;;salma@x.test;;CASH;MAIN|*;WH-1`;
    const { report } = await dryRun(h, body);
    expect(report.summary.valid).toBe(1);
  });

  it("refuses a file over the row limit", async () => {
    const h = harness();
    const rows = Array.from({ length: 101 }, (_, index) => row(`مستخدم ${index}`, `u${index}@x.test`));
    const { report } = await dryRun(h, csv(...rows));
    expect(report.fileProblems.map((problem) => problem.code)).toEqual(["FILE_TOO_MANY_ROWS"]);
  });

  it("refuses to commit without the digest of a dry run of the same file", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = csv(row("سلمى", "salma@x.test"));
    const missing = await send(h, "POST", "/users/import", { csv: body, dryRun: false });
    expect(missing.status).toBe(409);
    expect(((await missing.json()) as { error: string }).error).toBe("DRY_RUN_REQUIRED");
    const { report } = await dryRun(h, body);
    const edited = await send(h, "POST", "/users/import", { csv: csv(row("سلمى", "other@x.test")), dryRun: false, digest: report.digest });
    expect(edited.status).toBe(409);
    expect(await h.uow.users.list()).toHaveLength(0);
  });

  it("commits once: creates active users with hashed secrets and returns the sheet exactly once", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    const role = await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = csv(row("سلمى", "salma@x.test"), row("كريم", "karim@x.test"));
    const { report: dry } = await dryRun(h, body);
    const res = await send(h, "POST", "/users/import", { csv: body, dryRun: false, digest: dry.digest });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const done = (await res.json()) as Report;
    expect(done.created).toBe(2);
    expect(done.credentials).toHaveLength(2);

    const users = await h.uow.users.list();
    expect(users.map((user) => user.email).sort()).toEqual(["karim@x.test", "salma@x.test"]);
    for (const user of users) {
      expect(user.roleId).toBe(role.id);
      expect(user.isCompanyAdmin).toBe(false);
      expect(user.branchScope).toEqual(["BR1"]);
      expect(user.warehouseScope).toEqual(["WH1"]);
      const sheet = done.credentials.find((entry) => entry.userId === user.id)!;
      expect(sheet.pin).toMatch(/^\d{6}$/);
      expect(user.pinHash).not.toContain(sheet.pin);
      expect(await h.hasher.verify(sheet.pin, user.pinHash!)).toBe(true);
      expect(await h.hasher.verify(sheet.password, user.passwordHash)).toBe(true);
    }

    const again = await send(h, "POST", "/users/import", { csv: body, dryRun: false, digest: dry.digest });
    expect(again.status).toBe(422);
    expect(((await again.json()) as Report).credentials).toEqual([]);
    expect(await h.uow.users.list()).toHaveLength(2);
  });

  it("never writes a PIN or a temporary password into the audit trail", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = csv(row("سلمى", "salma@x.test"));
    const { report: dry } = await dryRun(h, body);
    const done = (await (await send(h, "POST", "/users/import", { csv: body, dryRun: false, digest: dry.digest })).json()) as Report;
    const sheet = done.credentials[0]!;
    const everything = JSON.stringify(h.sqlite.prepare("SELECT * FROM audit_event").all());
    expect(everything).not.toContain(sheet.pin);
    expect(everything).not.toContain(sheet.password);
    expect(everything).toContain("USERS_IMPORTED");
    const created = h.sqlite.prepare("SELECT details FROM audit_event WHERE action = 'CREATE' AND entity_type = 'USER'").all() as { details: string }[];
    expect(created).toHaveLength(1);
    expect(created[0]!.details).toContain("pinChanged");
  });

  it("stops at the seat limit row by row and commits nothing while any row fails", async () => {
    const h = harness({ seats: 2 });
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const body = csv(row("أ", "a@x.test"), row("ب", "b@x.test"), row("ج", "c@x.test"));
    const { report } = await dryRun(h, body);
    expect(report.seats).toEqual({ limit: 2, active: 0, available: 2 });
    expect(report.rows.map((entry) => entry.problems.map((problem) => problem.code))).toEqual([[], [], ["ROW_SEAT_LIMIT_REACHED"]]);
    const res = await send(h, "POST", "/users/import", { csv: body, dryRun: false, digest: report.digest ?? undefined });
    expect(res.status).toBe(422);
    expect(await h.uow.users.list()).toHaveLength(0);
  });

  it("will not hand out a role the caller does not hold, and never a company admin", async () => {
    const h = harness({ permissions: ["admin.users.create", "admin.users.view", "treasury.cash_voucher.view"] });
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const { report } = await dryRun(h, csv(row("سلمى", "salma@x.test")));
    expect(report.rows[0]!.problems.map((problem) => problem.code)).toEqual(["ROW_ROLE_NOT_GRANTABLE"]);
  });

  it("will not grant a branch wider than the caller's own", async () => {
    const h = harness({ permissions: ["*"], branchScope: ["BR-OTHER"] });
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const { report } = await dryRun(h, csv(row("سلمى", "salma@x.test")));
    expect(report.rows[0]!.problems.map((problem) => problem.code)).toEqual(["ROW_SCOPE_NOT_GRANTABLE"]);
  });

  it("holds a role that pairs both sides of a segregation-of-duties rule until it is acknowledged with a reason", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    await seedRole(h, "CASH", ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm"]);
    const body = csv(row("سلمى", "salma@x.test"));
    const blocked = await dryRun(h, body);
    expect(blocked.report.rows[0]!.problems.map((problem) => problem.code)).toEqual(["ROW_SOD_CONFLICT"]);
    const acknowledged = await dryRun(h, body, { acknowledge: true, reason: "مكتب صغير" });
    expect(acknowledged.report.summary.valid).toBe(1);
    const res = await send(h, "POST", "/users/import", { csv: body, dryRun: false, digest: acknowledged.report.digest, acknowledge: true, reason: "مكتب صغير" });
    expect(res.status).toBe(201);
    const overrides = h.sqlite.prepare("SELECT COUNT(*) AS c FROM audit_event WHERE action = 'SOD_OVERRIDE'").get() as { c: number };
    expect(overrides.c).toBe(1);
  });

  it("is denied without admin.users.create", async () => {
    const h = harness({ permissions: ["admin.users.view"] });
    const res = await send(h, "POST", "/users/import", { csv: csv(), dryRun: true });
    expect(res.status).toBe(403);
  });
});

describe("POST /users/:id/clone", () => {
  async function seedSource(h: Harness, overrides: Partial<User> = {}): Promise<User> {
    await seedBranchAndWarehouse(h);
    const role = await seedRole(h, "CASH", CASHIER_PERMISSIONS);
    const hash = await h.hasher.hash("OriginalPass1");
    const source: User = {
      id: "source",
      nameAr: "المصدر",
      nameEn: "Source",
      email: "source@x.test",
      phone: "0100",
      passwordHash: hash,
      pinHash: await h.hasher.hash("482913"),
      roleId: role.id,
      isCompanyAdmin: false,
      employeeId: "emp-1",
      photoUrl: "data:image/png;base64,AAAA",
      branchScope: ["BR1"],
      warehouseScope: ["WH1"],
      status: "active",
      lastLoginAt: null,
      createdAt: NOW,
      ...overrides,
    };
    await h.uow.users.save(source);
    return source;
  }

  const cloneBody = { nameAr: "النسخة", email: "copy@x.test" };

  it("copies role, scopes and preferences — not credentials, employee link or photo", async () => {
    const h = harness();
    const source = await seedSource(h);
    await h.preferences.save({ ...createDefaultUserPreferences("source"), railCollapsed: true, layoutName: "تخطيط المحاسب" });
    const res = await send(h, "POST", "/users/source/clone", cloneBody);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const result = (await res.json()) as { user: { id: string }; preferencesCopied: boolean; credentials: { pin: string; password: string } };
    expect(result.preferencesCopied).toBe(true);
    const copy = (await h.uow.users.findById(result.user.id))!;
    expect(copy.roleId).toBe(source.roleId);
    expect(copy.branchScope).toEqual(["BR1"]);
    expect(copy.warehouseScope).toEqual(["WH1"]);
    expect(copy.isCompanyAdmin).toBe(false);
    expect(copy.employeeId).toBeNull();
    expect(copy.photoUrl).toBeNull();
    expect(copy.passwordHash).not.toBe(source.passwordHash);
    expect(copy.pinHash).not.toBe(source.pinHash);
    expect(await h.hasher.verify(result.credentials.pin, copy.pinHash!)).toBe(true);
    expect(await h.hasher.verify("OriginalPass1", copy.passwordHash)).toBe(false);
    const prefs = (await h.preferences.get(copy.id))!;
    expect(prefs.railCollapsed).toBe(true);
    expect(prefs.layoutName).toBe("تخطيط المحاسب");
    expect(prefs.recentRecords).toEqual([]);
    expect((await h.preferences.get("source"))!.userId).toBe("source");
    const everything = JSON.stringify(h.sqlite.prepare("SELECT * FROM audit_event").all());
    expect(everything).not.toContain(result.credentials.pin);
    expect(everything).not.toContain(result.credentials.password);
    expect(everything).toContain("USER_CLONED");
  });

  it("clones a user who never customised their layout", async () => {
    const h = harness();
    await seedSource(h);
    const res = await send(h, "POST", "/users/source/clone", cloneBody);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { preferencesCopied: boolean }).preferencesCopied).toBe(false);
  });

  it("refuses a taken email, an unknown source, and a disallowed address", async () => {
    const h = harness();
    await seedSource(h);
    expect((await send(h, "POST", "/users/source/clone", { ...cloneBody, email: "source@x.test" })).status).toBe(409);
    expect((await send(h, "POST", "/users/ghost/clone", cloneBody)).status).toBe(404);
    expect((await send(h, "POST", "/users/source/clone", { nameAr: "", email: "bad" })).status).toBe(400);
  });

  it("will not clone a company admin", async () => {
    const h = harness();
    await seedSource(h, { id: "boss", email: "boss@x.test", roleId: null, isCompanyAdmin: true });
    const res = await send(h, "POST", "/users/boss/clone", cloneBody);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("CLONE_ADMIN_REFUSED");
    expect(await h.uow.users.list()).toHaveLength(1);
  });

  it("respects the seat limit", async () => {
    const h = harness({ seats: 1 });
    await seedSource(h);
    const res = await send(h, "POST", "/users/source/clone", cloneBody);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("SEAT_LIMIT_REACHED");
  });

  it("will not clone into a role the caller cannot grant", async () => {
    const h = harness({ permissions: ["admin.users.create", "admin.users.view"] });
    await seedSource(h);
    const res = await send(h, "POST", "/users/source/clone", cloneBody);
    expect(res.status).toBe(403);
  });

  it("requires an acknowledgement to put a new person into a conflicted seat", async () => {
    const h = harness();
    await seedBranchAndWarehouse(h);
    const role = await seedRole(h, "CASH", ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm"]);
    await h.uow.users.save({
      id: "source",
      nameAr: "المصدر",
      nameEn: null,
      email: "source@x.test",
      phone: null,
      passwordHash: await h.hasher.hash("OriginalPass1"),
      pinHash: null,
      roleId: role.id,
      isCompanyAdmin: false,
      employeeId: null,
      photoUrl: null,
      branchScope: ["BR1"],
      warehouseScope: ["WH1"],
      status: "active",
      lastLoginAt: null,
      createdAt: NOW,
    });
    const refused = await send(h, "POST", "/users/source/clone", cloneBody);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("SOD_CONFLICT");
    const accepted = await send(h, "POST", "/users/source/clone", { ...cloneBody, acknowledge: true, reason: "مكتب صغير" });
    expect(accepted.status).toBe(201);
  });
});
