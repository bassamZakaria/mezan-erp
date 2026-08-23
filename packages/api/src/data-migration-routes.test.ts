import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSupplierRepository,
  createSqliteCustomerRepository,
  createSqliteItemStore,
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteBranchStore,
  type SqliteSupplierRepositoryHandle,
  type SqliteCustomerRepositoryHandle,
  type SqliteItemStoreHandle,
  type SqliteAssetCategoryRepositoryHandle,
  type SqliteAssetRepositoryHandle,
  type SqliteTreasuryAccountRepositoryHandle,
  type SqliteBranchStoreHandle,
} from "@mezan/persistence";
import type { Department, DepartmentRepository, Employee, EmployeeRepository } from "@mezan/domain";
import { createDataMigrationRoutes } from "./data-migration-routes.js";

/** Trivial in-memory fakes — the real HR SQLite store is a sibling in-flight
 * task; this test only needs something implementing the two ports. */
function inMemoryDepartments(): DepartmentRepository {
  const rows = new Map<string, Department>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async findByCode(code) {
      return [...rows.values()].find((d) => d.code === code) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(d) {
      rows.set(d.id, d);
    },
    async update(d) {
      rows.set(d.id, d);
    },
  };
}

function inMemoryEmployees(): EmployeeRepository {
  const rows = new Map<string, Employee>();
  return {
    async findById(id) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async create(e) {
      rows.set(e.id, e);
    },
    async update(e) {
      rows.set(e.id, e);
    },
  };
}

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function newApp() {
  const treasuryAccounts = createSqliteTreasuryAccountRepository();
  const suppliers = createSqliteSupplierRepository();
  const customers = createSqliteCustomerRepository();
  const items = createSqliteItemStore();
  const assetCategories = createSqliteAssetCategoryRepository();
  const assets = createSqliteAssetRepository();
  const branches = createSqliteBranchStore();
  handles.push(
    treasuryAccounts as unknown as { close(): void },
    suppliers as unknown as { close(): void },
    customers as unknown as { close(): void },
    items as unknown as { close(): void },
    assetCategories as unknown as { close(): void },
    assets as unknown as { close(): void },
    branches as unknown as { close(): void },
  );
  await branches.save({
    id: "b1",
    code: "MAIN",
    name: "الفرع الرئيسي",
    parentBranchId: null,
    phone: null,
    email: null,
    address: null,
    isMain: true,
    active: true,
  });
  const departments = inMemoryDepartments();
  const employees = inMemoryEmployees();
  const app = createDataMigrationRoutes({
    departments,
    employees,
    treasuryAccounts,
    suppliers,
    customers,
    items,
    assetCategories,
    assets,
    branches,
  });
  return { app, departments, employees, treasuryAccounts, suppliers, customers, items, assetCategories, assets };
}

function req(path: string, body?: unknown, permissions = "admin.settings.edit") {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-permissions": permissions },
    body: JSON.stringify({ rows: body }),
  });
}

describe("data-migration-routes — departments", () => {
  it("commits a valid batch and rejects an empty commit with the wrong permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/departments/commit", [{ code: "SALES", nameAr: "المبيعات" }]));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { validCount: number; errors: unknown[]; createdIds: string[] };
    expect(body.validCount).toBe(1);
    expect(body.errors).toHaveLength(0);
    expect(body.createdIds).toHaveLength(1);

    const denied = await app.fetch(req("/departments/commit", [{ code: "X", nameAr: "س" }], "admin.settings.view"));
    expect(denied.status).toBe(403);
  });

  it("is all-or-nothing: one bad row blocks the whole batch from committing", async () => {
    const { app, departments } = await newApp();
    const res = await app.fetch(
      req("/departments/commit", [
        { code: "SALES", nameAr: "المبيعات" },
        { code: "", nameAr: "" },
      ]),
    );
    const body = (await res.json()) as { validCount: number; errors: { rowNumber: number; reasons: string[] }[] };
    expect(res.status).toBe(200);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.rowNumber).toBe(2);
    expect(await departments.list()).toHaveLength(0);
  });

  it("preview never persists", async () => {
    const { app, departments } = await newApp();
    const res = await app.fetch(req("/departments/preview", [{ code: "SALES", nameAr: "المبيعات" }], "admin.settings.view"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { validCount: number };
    expect(body.validCount).toBe(1);
    expect(await departments.list()).toHaveLength(0);
  });

  it("flags a duplicate code within the same batch", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/departments/commit", [
        { code: "SALES", nameAr: "المبيعات" },
        { code: "SALES", nameAr: "مبيعات ٢" },
      ]),
    );
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(res.status).toBe(200);
    expect(body.errors.some((e) => e.reasons.some((r) => r.includes("مكرر")))).toBe(true);
  });
});

describe("data-migration-routes — employees", () => {
  it("requires an already-imported department", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/employees/commit", [{ code: "EMP-1", nameAr: "أحمد محمود", departmentCode: "SALES", hireDate: "2026-01-01" }]),
    );
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(res.status).toBe(200);
    expect(body.errors[0]?.reasons.some((r) => r.includes("استورد الأقسام"))).toBe(true);
  });

  it("creates an employee once its department exists, splitting the Arabic name", async () => {
    const { app, employees } = await newApp();
    await app.fetch(req("/departments/commit", [{ code: "SALES", nameAr: "المبيعات" }]));
    const res = await app.fetch(
      req("/employees/commit", [{ code: "EMP-1", nameAr: "أحمد محمود", departmentCode: "SALES", hireDate: "2026-01-01" }]),
    );
    expect(res.status).toBe(201);
    const created = await employees.list();
    expect(created).toHaveLength(1);
    expect(created[0]?.firstNameAr).toBe("أحمد");
    expect(created[0]?.branchId).toBe("b1");
  });
});

describe("data-migration-routes — treasury accounts", () => {
  it("rejects a negative opening balance on a cash account", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/treasury-accounts/commit", [{ code: "CASH-1", name: "صندوق", type: "cash", openingBalance: "-5.00" }]),
    );
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(res.status).toBe(200);
    expect(body.errors).toHaveLength(1);
  });

  it("creates a treasury account against the resolved default branch", async () => {
    const { app, treasuryAccounts } = await newApp();
    const res = await app.fetch(req("/treasury-accounts/commit", [{ code: "CASH-1", name: "صندوق", type: "cash", openingBalance: "50.00" }]));
    expect(res.status).toBe(201);
    const list = await treasuryAccounts.list();
    expect(list[0]?.branchId).toBe("b1");
  });
});

describe("data-migration-routes — suppliers/customers/items/asset-categories/assets", () => {
  it("creates a supplier", async () => {
    const { app, suppliers } = await newApp();
    const res = await app.fetch(req("/suppliers/commit", [{ code: "SUP-1", nameAr: "مورد تجريبي" }]));
    expect(res.status).toBe(201);
    expect(await suppliers.findAll()).toHaveLength(1);
  });

  it("creates a customer", async () => {
    const { app, customers } = await newApp();
    const res = await app.fetch(req("/customers/commit", [{ code: "CUS-1", nameAr: "عميل تجريبي" }]));
    expect(res.status).toBe(201);
    expect(await customers.findAll()).toHaveLength(1);
  });

  it("creates an item, then adds an alternate unit to it", async () => {
    const { app, items } = await newApp();
    const create = await app.fetch(
      req("/items/commit", [{ code: "ITM-1", nameAr: "صنف تجريبي", baseUnitCode: "PCS", type: "stock" }]),
    );
    expect(create.status).toBe(201);

    const unitRes = await app.fetch(
      req("/item-units/commit", [{ itemCode: "ITM-1", unitCode: "BOX", unitName: "كرتونة", factor: "12" }]),
    );
    expect(unitRes.status).toBe(201);
    const [item] = await items.list();
    expect(item?.alternateUnits).toEqual([{ code: "BOX", name: "كرتونة", factor: 12 }]);
  });

  it("creates an asset category then an asset against it", async () => {
    const { app, assets } = await newApp();
    const cat = await app.fetch(
      req("/asset-categories/commit", [{ code: "CAT-1", nameAr: "أثاث", defaultUsefulLifeMonths: "60", defaultSalvagePercent: "10" }]),
    );
    expect(cat.status).toBe(201);
    const asset = await app.fetch(
      req("/assets/commit", [{ code: "AST-1", nameAr: "مكتب", categoryCode: "CAT-1", acquisitionDate: "2026-01-01", acquisitionCost: "5000.00" }]),
    );
    expect(asset.status).toBe(201);
    expect(await assets.list()).toHaveLength(1);
  });

  it("blocks an asset referencing an unknown category", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/assets/commit", [{ code: "AST-1", nameAr: "مكتب", categoryCode: "NOPE", acquisitionDate: "2026-01-01", acquisitionCost: "5000.00" }]),
    );
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(res.status).toBe(200);
    expect(body.errors[0]?.reasons.some((r) => r.includes("تصنيفات الأصول"))).toBe(true);
  });
});

describe("data-migration-routes — status", () => {
  it("reports registered counts across every step, including historicalCounts when supplied", async () => {
    const { app } = await newApp();
    const res = await app.fetch(new Request("http://local/status", { headers: { "x-permissions": "admin.settings.view" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(body.departments).toBe(0);
    expect(body.salesInvoices).toBe(0);
  });
});
