import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSupplierRepository,
  createSqliteCustomerRepository,
  createSqliteItemStore,
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteBranchStore,
  createSqliteWarehouseStore,
} from "@mezan/persistence";
import type { Department, DepartmentRepository, Employee, EmployeeRepository } from "@mezan/domain";
import { createDataMigrationRoutes, type DataMigrationRoutesDeps } from "./data-migration-routes.js";

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

interface AppOptions {
  readonly withOpeningBalances?: boolean;
  readonly confirmThrows?: string;
  readonly historicalCounts?: boolean;
  readonly secondBranch?: boolean;
}

async function newApp(opts: AppOptions = {}) {
  const treasuryAccounts = createSqliteTreasuryAccountRepository();
  const suppliers = createSqliteSupplierRepository();
  const customers = createSqliteCustomerRepository();
  const items = createSqliteItemStore();
  const assetCategories = createSqliteAssetCategoryRepository();
  const assets = createSqliteAssetRepository();
  const branches = createSqliteBranchStore();
  const warehouses = createSqliteWarehouseStore();
  for (const h of [treasuryAccounts, suppliers, customers, items, assetCategories, assets, branches, warehouses]) {
    handles.push(h as unknown as { close(): void });
  }

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
  if (opts.secondBranch) {
    await branches.save({
      id: "b2",
      code: "ALEX",
      name: "فرع الإسكندرية",
      parentBranchId: null,
      phone: null,
      email: null,
      address: null,
      isMain: false,
      active: true,
    });
  }
  await warehouses.save({
    id: "wh-1",
    code: "MAIN-WH",
    name: "المستودع الرئيسي",
    nameEn: null,
    branchId: "b1",
    type: "MAIN",
    isDefault: true,
    active: true,
  });

  const confirmed: Array<{ id: string; lines: unknown[] }> = [];
  const stockAdjustments = {
    async createDraft(input: { id: string; lines: unknown[] }) {
      return { id: input.id, lines: input.lines };
    },
    async confirm(id: string) {
      if (opts.confirmThrows) throw new Error(opts.confirmThrows);
      confirmed.push({ id, lines: [] });
      return { document: { id } };
    },
  };

  const deps: DataMigrationRoutesDeps = {
    departments: inMemoryDepartments(),
    employees: inMemoryEmployees(),
    treasuryAccounts,
    suppliers,
    customers,
    items,
    assetCategories,
    assets,
    branches,
    ...(opts.historicalCounts
      ? {
          historicalCounts: async () => ({
            salesInvoices: 3,
            salesReturns: 1,
            purchaseInvoices: 2,
            purchaseReturns: 0,
          }),
        }
      : {}),
    ...(opts.withOpeningBalances
      ? {
          warehouses,
          stockAdjustments: stockAdjustments as unknown as DataMigrationRoutesDeps["stockAdjustments"],
        }
      : {}),
  };
  return { app: createDataMigrationRoutes(deps), items, confirmed };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

const EDIT = "admin.settings.edit";

async function step(app: App, path: string, rows: unknown, permissions = EDIT) {
  return app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": permissions },
      body: JSON.stringify({ rows }),
    }),
  );
}

async function raw(app: App, path: string, body: unknown, permissions = EDIT) {
  return app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": permissions },
      body: JSON.stringify(body),
    }),
  );
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface StepResult {
  validCount: number;
  errors: Array<{ rowNumber: number; reasons: string[] }>;
  createdIds?: string[];
}

async function reasonsOf(app: App, path: string, rows: unknown): Promise<string[]> {
  const result = await json<StepResult>(await step(app, path, rows));
  return result.errors.flatMap((e) => e.reasons);
}

describe("data-migration-routes — what each step refuses, row by row", () => {
  it("names every missing field on a department, an employee and a treasury account", async () => {
    const { app } = await newApp();
    expect(await reasonsOf(app, "/departments/preview", [{}])).toEqual(
      expect.arrayContaining(["كود القسم مطلوب", "اسم القسم مطلوب"]),
    );
    expect(await reasonsOf(app, "/employees/preview", [{}])).toEqual(
      expect.arrayContaining(["كود الموظف مطلوب", "اسم الموظف مطلوب", "تاريخ التعيين مطلوب"]),
    );
    expect(await reasonsOf(app, "/treasury-accounts/preview", [{}])).toEqual(
      expect.arrayContaining(["كود حساب الخزينة مطلوب", "اسم حساب الخزينة مطلوب"]),
    );
  });

  it("names every missing field on a supplier, a customer and an item", async () => {
    const { app } = await newApp();
    expect(await reasonsOf(app, "/suppliers/preview", [{}])).toEqual(
      expect.arrayContaining(["كود المورد مطلوب", "اسم المورد مطلوب"]),
    );
    expect(await reasonsOf(app, "/customers/preview", [{}])).toEqual(
      expect.arrayContaining(["كود العميل مطلوب", "اسم العميل مطلوب"]),
    );
    expect(await reasonsOf(app, "/items/preview", [{}])).toEqual(
      expect.arrayContaining(["كود الصنف مطلوب", "اسم الصنف مطلوب", "وحدة القياس الأساسية مطلوبة"]),
    );
  });

  it("names every missing field on an item unit, an asset category and an asset", async () => {
    const { app } = await newApp();
    expect(await reasonsOf(app, "/item-units/preview", [{}])).toEqual(
      expect.arrayContaining(["كود الصنف مطلوب", "كود الوحدة مطلوب", "معامل التحويل يجب أن يكون رقمًا أكبر من صفر"]),
    );
    expect(await reasonsOf(app, "/asset-categories/preview", [{}])).toEqual(
      expect.arrayContaining(["كود التصنيف مطلوب", "اسم التصنيف مطلوب", "العمر الإنتاجي (بالأشهر) يجب أن يكون أكبر من صفر"]),
    );
    expect(await reasonsOf(app, "/assets/preview", [{}])).toEqual(
      expect.arrayContaining([
        "كود الأصل مطلوب",
        "اسم الأصل مطلوب",
        "كود تصنيف الأصل مطلوب",
        "تاريخ الاقتناء مطلوب",
        "تكلفة الاقتناء مطلوبة",
      ]),
    );
  });

  it("refuses a salvage percentage outside 0–100 and a non-positive useful life", async () => {
    const { app } = await newApp();
    expect(
      await reasonsOf(app, "/asset-categories/preview", [
        { code: "CAT-1", nameAr: "أجهزة", defaultUsefulLifeMonths: 60, defaultSalvagePercent: 120 },
      ]),
    ).toContain("نسبة القيمة التخريدية يجب أن تكون بين 0 و 100");
    expect(
      await reasonsOf(app, "/asset-categories/preview", [
        { code: "CAT-1", nameAr: "أجهزة", defaultUsefulLifeMonths: 0 },
      ]),
    ).toContain("العمر الإنتاجي (بالأشهر) يجب أن يكون أكبر من صفر");
  });

  it("refuses a code that is already registered, on every code-bearing step", async () => {
    const { app } = await newApp();
    await step(app, "/suppliers/commit", [{ code: "SUP-1", nameAr: "مورد" }]);
    expect(await reasonsOf(app, "/suppliers/preview", [{ code: "SUP-1", nameAr: "مورد آخر" }])).toEqual([
      'المورد بالكود "SUP-1" مسجل بالفعل',
    ]);

    await step(app, "/customers/commit", [{ code: "CUS-1", nameAr: "عميل" }]);
    expect(await reasonsOf(app, "/customers/preview", [{ code: "CUS-1", nameAr: "عميل آخر" }])).toEqual([
      'العميل بالكود "CUS-1" مسجل بالفعل',
    ]);

    await step(app, "/items/commit", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }]);
    expect(await reasonsOf(app, "/items/preview", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }])).toEqual([
      'الصنف بالكود "IT-1" مسجل بالفعل',
    ]);
  });

  it("refuses the same code twice inside one file", async () => {
    const { app } = await newApp();
    const reasons = await reasonsOf(app, "/customers/preview", [
      { code: "CUS-1", nameAr: "عميل" },
      { code: "CUS-1", nameAr: "عميل مكرر" },
    ]);
    expect(reasons).toEqual(['الكود "CUS-1" مكرر في نفس الملف']);
  });

  it("refuses an item unit whose item is not imported, and one the item already carries", async () => {
    const { app } = await newApp();
    expect(
      await reasonsOf(app, "/item-units/preview", [{ itemCode: "GHOST", unitCode: "BOX", factor: 12 }]),
    ).toContain('الصنف بالكود "GHOST" غير موجود — استورد الأصناف أولاً');

    await step(app, "/items/commit", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }]);
    await step(app, "/item-units/commit", [{ itemCode: "IT-1", unitCode: "BOX", factor: 12 }]);
    expect(
      await reasonsOf(app, "/item-units/preview", [{ itemCode: "IT-1", unitCode: "BOX", factor: 6 }]),
    ).toContain('الوحدة "BOX" مسجلة بالفعل على الصنف "IT-1"');
  });

  it("refuses an employee whose department was never imported", async () => {
    const { app } = await newApp();
    const reasons = await reasonsOf(app, "/employees/preview", [
      { code: "E-1", nameAr: "أحمد علي", hireDate: "2026-01-01", departmentCode: "GHOST" },
    ]);
    expect(reasons).toContain('القسم بالكود "GHOST" غير موجود — استورد الأقسام أولاً');
  });

  it("refuses a row whose branch code names no branch at all", async () => {
    const { app } = await newApp();
    const reasons = await reasonsOf(app, "/treasury-accounts/preview", [
      { code: "CASH-1", name: "الخزنة", branchCode: "NOWHERE" },
    ]);
    expect(reasons).toContain("لا يوجد فرع لربط الحساب به — أضف فرعًا أولاً");
  });

  it("binds a row to the branch its code names rather than the main one", async () => {
    const { app } = await newApp({ secondBranch: true });
    const res = await step(app, "/treasury-accounts/commit", [
      { code: "CASH-2", name: "خزنة الإسكندرية", branchCode: "ALEX" },
    ]);
    expect(res.status).toBe(201);
    expect((await json<StepResult>(res)).validCount).toBe(1);
  });

  it("refuses an opening balance that is not a number, and a negative one on a cash account", async () => {
    const { app } = await newApp();
    expect(
      await reasonsOf(app, "/treasury-accounts/preview", [
        { code: "CASH-1", name: "الخزنة", openingBalance: "غير رقم" },
      ]),
    ).toContain("الرصيد الافتتاحي رقم غير صالح");

    expect(
      await reasonsOf(app, "/treasury-accounts/preview", [
        { code: "CASH-1", name: "الخزنة", openingBalance: "-5.00" },
      ]),
    ).toContain("لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي سالبًا");

    // A bank account may legitimately be overdrawn, so the guard does not apply.
    const bank = await json<StepResult>(
      await step(app, "/treasury-accounts/preview", [
        { code: "BANK-1", name: "بنك", type: "bank", openingBalance: "-5.00" },
      ]),
    );
    expect(bank.errors).toEqual([]);
  });

  it("surfaces the create path's own refusal as a row reason rather than a 500", async () => {
    const { app } = await newApp();
    const reasons = await reasonsOf(app, "/suppliers/preview", [{ code: "BAD CODE!", nameAr: "مورد" }]);
    expect(reasons.join(" ")).toContain("الكود");

    const assetReasons = await reasonsOf(app, "/assets/preview", [
      { code: "AST-1", nameAr: "أصل", categoryCode: "GHOST", acquisitionDate: "2026-01-01", acquisitionCost: "10" },
    ]);
    expect(assetReasons).toContain('تصنيف الأصول بالكود "GHOST" غير موجود — استورد تصنيفات الأصول أولاً');
  });

  it("treats a body whose rows are not an array as an empty batch", async () => {
    const { app } = await newApp();
    const res = await raw(app, "/customers/commit", { rows: "not-an-array" });
    expect(res.status).toBe(201);
    expect(await json<StepResult>(res)).toMatchObject({ validCount: 0, errors: [] });
  });

  it("carries every optional column through on a supplier, a customer and an item", async () => {
    const { app, items } = await newApp();
    const supplier = await json<StepResult>(
      await step(app, "/suppliers/commit", [
        {
          code: "SUP-9",
          nameAr: "مورد",
          nameEn: "Supplier",
          phone: "0100",
          email: "s@example.com",
          taxNumber: "123",
          category: "خامات",
          paymentTermsDays: "45",
        },
      ]),
    );
    expect(supplier.validCount).toBe(1);

    const customer = await json<StepResult>(
      await step(app, "/customers/commit", [
        { code: "CUS-9", nameAr: "عميل", creditLimit: "5000.00", paymentTermsDays: "not-a-number" },
      ]),
    );
    expect(customer.validCount).toBe(1);

    await step(app, "/items/commit", [
      {
        code: "IT-9",
        nameAr: "صنف",
        nameEn: "Item",
        baseUnitCode: "PCS",
        type: "service",
        brand: "براند",
        salePrice: "100.00",
        costPrice: "60.00",
        taxRatePercent: "14",
      },
    ]);
    const stored = (await items.list()).find((i) => i.code === "IT-9");
    expect(stored?.type).toBe("service");
    expect(stored?.salePrice?.toString()).toBe("100.000000");
  });
});

describe("data-migration-routes — الحالة", () => {
  it("reports zero for the historical steps when no archive is wired", async () => {
    const { app } = await newApp();
    const status = await json<Record<string, number>>(
      await app.fetch(new Request("http://local/status", { headers: { "x-permissions": EDIT } })),
    );
    expect(status).toMatchObject({
      departments: 0,
      employees: 0,
      treasuryAccounts: 0,
      suppliers: 0,
      customers: 0,
      items: 0,
      itemUnits: 0,
      assetCategories: 0,
      assets: 0,
      salesInvoices: 0,
      purchaseReturns: 0,
    });
  });

  it("counts what has been imported, alternate units included", async () => {
    const { app } = await newApp({ historicalCounts: true });
    await step(app, "/items/commit", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }]);
    await step(app, "/item-units/commit", [{ itemCode: "IT-1", unitCode: "BOX", factor: 12 }]);
    await step(app, "/customers/commit", [{ code: "CUS-1", nameAr: "عميل" }]);

    const status = await json<Record<string, number>>(
      await app.fetch(new Request("http://local/status", { headers: { "x-permissions": EDIT } })),
    );
    expect(status).toMatchObject({
      items: 1,
      itemUnits: 1,
      customers: 1,
      salesInvoices: 3,
      salesReturns: 1,
      purchaseInvoices: 2,
      purchaseReturns: 0,
    });
  });

  it("403s the status and every commit for a caller who may only view", async () => {
    const { app } = await newApp();
    const status = await app.fetch(new Request("http://local/status", { headers: { "x-permissions": "sales.invoice.view" } }));
    expect(status.status).toBe(403);
    expect((await step(app, "/customers/commit", [], "admin.settings.view")).status).toBe(403);
    // …but preview is open to a viewer.
    expect((await step(app, "/customers/preview", [], "admin.settings.view")).status).toBe(200);
  });
});

describe("data-migration-routes — أرصدة افتتاحية للأصناف", () => {
  const body = (rows: unknown[], warehouseId = "wh-1") => ({
    warehouseId,
    date: "2026-08-01",
    rows,
  });

  it("is not mounted at all when no warehouse or adjustment service is wired", async () => {
    const { app } = await newApp();
    expect((await raw(app, "/opening-balances/preview", body([]))).status).toBe(404);
    expect((await raw(app, "/opening-balances/commit", body([]))).status).toBe(404);
  });

  it("400s a body the schema rejects and 404s a warehouse that is not there", async () => {
    const { app } = await newApp({ withOpeningBalances: true });
    const perm = "inventory.adjustment.create";
    expect((await raw(app, "/opening-balances/preview", { rows: [] }, perm)).status).toBe(400);

    const missing = await raw(app, "/opening-balances/commit", body([{ rowNumber: 1, itemCode: "IT-1", qty: "1", unitCost: "1" }], "wh-none"), perm);
    expect(missing.status).toBe(404);
    expect((await json<{ error: string }>(missing)).error).toBe("WAREHOUSE_NOT_FOUND");
  });

  it("flags a row naming an item the catalogue does not hold", async () => {
    const { app } = await newApp({ withOpeningBalances: true });
    const perm = "inventory.adjustment.create";
    const res = await raw(app, "/opening-balances/preview", body([{ rowNumber: 1, itemCode: "GHOST", qty: "5", unitCost: "10" }]), perm);
    expect(res.status).toBe(200);
    const preview = await json<{ validCount: number; total: number; errors: Array<{ reasons: string[] }> }>(res);
    expect(preview.validCount).toBe(0);
    expect(preview.total).toBe(1);
    expect(preview.errors[0]?.reasons.join(" ")).toContain("GHOST");
  });

  it("422s a commit that carries an error, and 400s a batch with no rows at all", async () => {
    const { app } = await newApp({ withOpeningBalances: true });
    const perm = "inventory.adjustment.create";
    const withError = await raw(
      app,
      "/opening-balances/commit",
      body([{ rowNumber: 1, itemCode: "GHOST", qty: "5", unitCost: "10" }]),
      perm,
    );
    expect(withError.status).toBe(422);
    expect((await json<StepResult>(withError)).validCount).toBe(0);

    expect((await raw(app, "/opening-balances/commit", body([]), perm)).status).toBe(400);
  });

  it("posts one INITIAL_STOCK adjustment for the whole batch", async () => {
    const { app, confirmed } = await newApp({ withOpeningBalances: true });
    const perm = "inventory.adjustment.create";
    await step(app, "/items/commit", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }]);

    const res = await raw(
      app,
      "/opening-balances/commit",
      body([{ rowNumber: 1, itemCode: "IT-1", qty: "5", unitCost: "10" }]),
      perm,
    );
    expect(res.status).toBe(201);
    expect(await json<StepResult>(res)).toMatchObject({ validCount: 1, errors: [] });
    expect(confirmed).toHaveLength(1);
  });

  it("422s — never 500s — when the adjustment service refuses the posting", async () => {
    const { app } = await newApp({ withOpeningBalances: true, confirmThrows: "الفترة مقفلة" });
    const perm = "inventory.adjustment.create";
    await step(app, "/items/commit", [{ code: "IT-1", nameAr: "صنف", baseUnitCode: "PCS" }]);

    const res = await raw(
      app,
      "/opening-balances/commit",
      body([{ rowNumber: 1, itemCode: "IT-1", qty: "5", unitCost: "10" }]),
      perm,
    );
    expect(res.status).toBe(422);
    const payload = await json<{ error: string; message: string }>(res);
    expect(payload.error).toBe("OPENING_BALANCE_IMPORT_FAILED");
    expect(payload.message).toBe("الفترة مقفلة");
  });
});
