import { describe, it, expect, afterEach } from "vitest";
import {
  createSqliteSupplierRepository,
  createSqliteCustomerRepository,
  createSqliteItemStore,
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteTreasuryAccountRepository,
  createSqliteBranchStore,
  createSqliteAccountRepository,
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

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
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
  }, insecureHeaderAuthContextResolver);
  return {
    app,
    departments,
    employees,
    treasuryAccounts,
    suppliers,
    customers,
    items,
    assetCategories,
    assets,
    deps: { treasuryAccounts, suppliers, customers, items, assetCategories, assets, branches },
  };
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

  async function withChart(cashAndBankParentAccountId: () => Promise<string | null>) {
    const accounts = createSqliteAccountRepository();
    handles.push(accounts as unknown as { close(): void });
    await accounts.create({ id: "1300", code: "1300", nameAr: "النقدية والبنوك", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" });
    await accounts.create({ id: "1399", code: "1399", nameAr: "صندوق تفصيلي", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" });
    const base = await newApp();
    const app = createDataMigrationRoutes(
      { ...base.deps, departments: inMemoryDepartments(), employees: inMemoryEmployees(), accounts, cashAndBankParentAccountId },
      insecureHeaderAuthContextResolver,
    );
    return { app, accounts, treasuryAccounts: base.treasuryAccounts };
  }

  it("previews a row with no ledger account as refused, in Arabic, when the routed cash-and-bank account is missing or a detail account", async () => {
    for (const routed of ["9999", "1399"]) {
      const { app } = await withChart(async () => routed);
      const res = await app.fetch(req("/treasury-accounts/preview", [{ code: "CASH-1", name: "صندوق" }], "admin.settings.view"));
      const body = (await res.json()) as { validCount: number; errors: { rowNumber: number; reasons: string[] }[] };
      expect(res.status).toBe(200);
      expect(body.validCount).toBe(0);
      expect(body.errors.map((e) => e.rowNumber)).toEqual([1]);
      expect(body.errors[0]?.reasons.join(" ")).toMatch(/النقدية والبنوك/);
    }
  });

  it("previews a named ledger account that is not a cash or bank leaf as refused", async () => {
    const { app } = await withChart(async () => "1300");
    const res = await app.fetch(req("/treasury-accounts/preview", [{ code: "CASH-1", name: "صندوق", glAccountId: "1300" }], "admin.settings.view"));
    const body = (await res.json()) as { errors: { reasons: string[] }[] };
    expect(body.errors[0]?.reasons.join(" ")).toMatch(/حساب رئيسي/);
  });

  it("answers 422 with an Arabic reason, not a bare 500, when the cash-and-bank header vanishes between the check and the write", async () => {
    let calls = 0;
    const { app, treasuryAccounts } = await withChart(async () => (++calls === 1 ? "1300" : "9999"));
    const res = await app.fetch(req("/treasury-accounts/commit", [{ code: "CASH-1", name: "صندوق" }]));
    const body = (await res.json()) as { errors: { rowNumber: number; reasons: string[] }[] };
    expect(res.status).toBe(422);
    expect(body.errors).toEqual([{ rowNumber: 1, reasons: [expect.stringMatching(/النقدية والبنوك/)] }]);
    expect(await treasuryAccounts.list()).toEqual([]);
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

// guards P-5 — the chart, the opening trial balance, and the open AR/AP: the
// three steps a real go-live cannot happen without.
describe("data-migration-routes — دليل الحسابات (P-5)", () => {
  async function chartApp() {
    const accounts = createSqliteAccountRepository();
    handles.push(accounts as unknown as { close(): void });
    const base = await newApp();
    const departments = inMemoryDepartments();
    const employees = inMemoryEmployees();
    const app = createDataMigrationRoutes(
      { ...base.deps, departments, employees, accounts },
      insecureHeaderAuthContextResolver,
    );
    return { app, accounts };
  }

  it("commits parents before children and resolves the parent code to a REAL account id", async () => {
    const { app, accounts } = await chartApp();
    const res = await app.fetch(
      req(
        "/chart-of-accounts/commit",
        [
          { code: "1100", nameAr: "النقدية", type: "asset", parentCode: "1000" },
          { code: "1000", nameAr: "الأصول المتداولة", type: "asset" },
        ],
        "accounting.coa.manage",
      ),
    );
    expect(res.status).toBe(201);

    const rows = await accounts.list();
    const parent = rows.find((a) => a.code === "1000")!;
    const child = rows.find((a) => a.code === "1100")!;
    expect(parent.isHeader).toBe(true);
    expect(child.parentId).toBe(parent.id);
    expect(child.naturalBalance).toBe("debit");
  });

  it("refuses the whole batch in Arabic when one row names an unknown type, and writes nothing", async () => {
    const { app, accounts } = await chartApp();
    const res = await app.fetch(
      req("/chart-of-accounts/commit", [{ code: "9999", nameAr: "حساب", type: "بند" }], "accounting.coa.manage"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { errors: { rowNumber: number; reasons: string[] }[] };
    expect(body.errors[0]!.reasons[0]).toContain("نوع الحساب");
    expect(await accounts.list()).toHaveLength(0);
  });

  it("gates the commit on accounting.coa.manage, not admin.settings.edit", async () => {
    const { app } = await chartApp();
    const denied = await app.fetch(
      req("/chart-of-accounts/commit", [{ code: "1", nameAr: "ح", type: "asset" }], "admin.settings.edit"),
    );
    expect(denied.status).toBe(403);
  });
});

describe("data-migration-routes — ميزان المراجعة الافتتاحي (P-5)", () => {
  async function tbApp(periodStatus: "open" | "closed" = "open") {
    const accounts = createSqliteAccountRepository();
    handles.push(accounts as unknown as { close(): void });
    await accounts.create({ id: "a-cash", code: "1100", nameAr: "النقدية", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });
    await accounts.create({ id: "a-cap", code: "3100", nameAr: "رأس المال", nameEn: null, type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" });
    await accounts.create({ id: "a-hdr", code: "1000", nameAr: "الأصول", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" });
    await accounts.create({ id: "1105", code: "1105", nameAr: "العملاء", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });
    await accounts.create({ id: "2100", code: "2100", nameAr: "الموردون", nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" });

    const periods = [
      { id: "fp-2025-12", year: 2025, periodNumber: 12, startDate: "2025-12-01", endDate: "2025-12-31", status: periodStatus },
      { id: "fp-2026-01", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "open" as const },
    ];
    const fiscalPeriods = {
      async findById(id: string) {
        return periods.find((p) => p.id === id) ?? null;
      },
      async findByDate(date: string) {
        return periods.find((p) => p.startDate <= date && date <= p.endDate) ?? null;
      },
      async findByYearAndNumber() {
        return null;
      },
      async listByYear() {
        return [];
      },
      async list() {
        return [...periods];
      },
      async create() {},
      async update() {},
    } as never;

    const posted: { id: string; date: string; lines: unknown[] }[] = [];
    const base = await newApp();
    const app = createDataMigrationRoutes(
      {
        ...base.deps,
        departments: inMemoryDepartments(),
        employees: inMemoryEmployees(),
        accounts,
        fiscalPeriods,
        partyControlAccounts: async () => new Map<string, "customer" | "supplier">([["1105", "customer"], ["2100", "supplier"]]),
        postOpeningEntry: async (entry) => {
          posted.push({ id: entry.id, date: entry.date, lines: [...entry.lines] });
        },
      },
      insecureHeaderAuthContextResolver,
    );
    return { app, posted };
  }

  it("posts ONE entry, and says out loud when the date had to move into the first open period", async () => {
    const { app, posted } = await tbApp();
    const res = await app.fetch(
      req(
        "/opening-trial-balance/commit",
        [
          { accountCode: "1100", debit: "10000.00", credit: "0" },
          { accountCode: "3100", debit: "0", credit: "10000.00" },
        ],
        "accounting.journal.create",
      ),
    );
    expect(res.status).toBe(201);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.date).toBe("2025-12-01");
    expect(posted[0]!.lines).toHaveLength(2);
  });

  it("refuses an unbalanced file in Arabic and posts nothing", async () => {
    const { app, posted } = await tbApp();
    const res = await app.fetch(
      req(
        "/opening-trial-balance/commit",
        [
          { accountCode: "1100", debit: "10000.00", credit: "0" },
          { accountCode: "3100", debit: "0", credit: "9000.00" },
        ],
        "accounting.journal.create",
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { balanced: boolean; errors: { reasons: string[] }[] };
    expect(body.balanced).toBe(false);
    expect(body.errors[0]!.reasons[0]).toContain("غير متوازن");
    expect(posted).toHaveLength(0);
  });

  it("refuses a header account and an unknown account code, row by row, in Arabic", async () => {
    const { app, posted } = await tbApp();
    const res = await app.fetch(
      req(
        "/opening-trial-balance/commit",
        [
          { accountCode: "1000", debit: "10000.00", credit: "0" },
          { accountCode: "9999", debit: "0", credit: "10000.00" },
        ],
        "accounting.journal.create",
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { rowNumber: number; reasons: string[] }[] };
    expect(body.errors[0]!.reasons[0]).toContain("رئيسي");
    expect(body.errors[1]!.reasons[0]).toContain("غير موجود");
    expect(posted).toHaveLength(0);
  });

  it("preview posts nothing and reports the date it WOULD use", async () => {
    const { app, posted } = await tbApp();
    const res = await app.fetch(
      req(
        "/opening-trial-balance/preview",
        [
          { accountCode: "1100", debit: "5.00", credit: "0" },
          { accountCode: "3100", debit: "0", credit: "5.00" },
        ],
        "admin.settings.view",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balanced: boolean; date: string | null; dateAdjusted: boolean; dateNoteAr: string | null };
    expect(body.balanced).toBe(true);
    expect(body.date).toBe("2025-12-01");
    expect(body.dateAdjusted).toBe(true);
    expect(body.dateNoteAr).toContain("2025-11-30");
    expect(posted).toHaveLength(0);
  });

  it("D225: the preview refuses a row on the customer or supplier control account, in both languages, as the commit does", async () => {
    const { app, posted } = await tbApp();
    const rows = [
      { accountCode: "1105", debit: "700.00", credit: "0" },
      { accountCode: "2100", debit: "0", credit: "200.00" },
      { accountCode: "3100", debit: "0", credit: "500.00" },
    ];
    const preview = await app.fetch(req("/opening-trial-balance/preview", rows, "admin.settings.view"));
    expect(preview.status).toBe(200);
    const body = (await preview.json()) as { validCount: number; errors: { rowNumber: number; reasons: string[] }[] };
    expect(body.errors.map((e) => e.rowNumber)).toEqual([1, 2]);
    expect(body.errors[0]!.reasons[0]).toContain("أرصدة العملاء الافتتاحية");
    expect(body.errors[0]!.reasons[0]).toContain("customer opening balances");
    expect(body.errors[0]!.reasons[0]).toContain("3210");
    expect(body.errors[1]!.reasons[0]).toContain("أرصدة الموردين الافتتاحية");
    expect(body.errors[1]!.reasons[0]).toContain("supplier opening balances");
    expect(body.validCount).toBe(1);

    const commit = await app.fetch(req("/opening-trial-balance/commit", rows, "accounting.journal.create"));
    expect(commit.status).toBe(422);
    expect(((await commit.json()) as { errors: { rowNumber: number }[] }).errors.map((e) => e.rowNumber)).toEqual([1, 2]);
    expect(posted).toHaveLength(0);
  });
});

// guards P-5 — the open AR/AP steps must post through the SAME historical-import
// path, so the sub-ledger and its control account (1105/2100) agree.
describe("data-migration-routes — أرصدة العملاء/الموردين المفتوحة (P-5)", () => {
  function inMemorySalesArchives() {
    const rows: { id: string; docType: string; originalNumber: string }[] = [];
    return {
      rows,
      repo: {
        async create(a: { id: string; docType: string; originalNumber: string }) {
          rows.push(a);
        },
        async list() {
          return rows as never;
        },
        async findById(id: string) {
          return (rows.find((r) => r.id === id) ?? null) as never;
        },
        async findByOriginalNumber(docType: string, originalNumber: string) {
          return (rows.find((r) => r.docType === docType && r.originalNumber === originalNumber) ?? null) as never;
        },
      } as never,
    };
  }

  it("archives an open customer invoice and posts ONLY its remaining balance to 1105", async () => {
    const archives = inMemorySalesArchives();
    const postings: { lines: { accountId: string; debit: unknown; credit: unknown }[] }[] = [];
    const base = await newApp();
    const app = createDataMigrationRoutes(
      {
        ...base.deps,
        departments: inMemoryDepartments(),
        employees: inMemoryEmployees(),
        openCustomerInvoices: {
          archives: archives.repo,
          gl: { post: async (posting: never) => { postings.push(posting as never); } },
          accounts: { openingBalanceAccountId: "3210", receivableAccountId: "1105" },
        },
      },
      insecureHeaderAuthContextResolver,
    );

    const res = await app.fetch(
      req(
        "/open-customer-invoices/commit",
        [
          { documentNumber: "INV-1001", customerId: "cus-1", date: "2026-01-15", qty: "1", unitPrice: "1500.00", amountPaid: "500.00" },
        ],
        "sales.invoice.create",
      ),
    );
    expect(res.status).toBe(201);
    expect(archives.rows).toHaveLength(1);
    expect(postings).toHaveLength(1);
    const accountIds = postings[0]!.lines.map((l) => l.accountId).sort();
    expect(accountIds).toEqual(["1105", "3210"]);
  });

  it("preview validates without archiving or posting anything", async () => {
    const archives = inMemorySalesArchives();
    let posted = 0;
    const base = await newApp();
    const app = createDataMigrationRoutes(
      {
        ...base.deps,
        departments: inMemoryDepartments(),
        employees: inMemoryEmployees(),
        openCustomerInvoices: {
          archives: archives.repo,
          gl: { post: async () => { posted += 1; } },
          accounts: { openingBalanceAccountId: "3210", receivableAccountId: "1105" },
        },
      },
      insecureHeaderAuthContextResolver,
    );

    const res = await app.fetch(
      req(
        "/open-customer-invoices/preview",
        [{ documentNumber: "INV-1001", customerId: "cus-1", date: "2026-01-15", qty: "1", unitPrice: "1500.00", amountPaid: "500.00" }],
        "admin.settings.view",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { validCount: number; documents: { remainingBalance: string }[] };
    expect(body.validCount).toBe(1);
    expect(body.documents[0]!.remainingBalance).toBe("1000.000000");
    expect(archives.rows).toHaveLength(0);
    expect(posted).toBe(0);
  });
});

describe("how much of the catalog an items import reads while it holds the connection", () => {
  function counted<T extends object>(repo: T): { readonly repo: T; readonly lists: () => number; readonly rowsRead: () => number } {
    let lists = 0;
    let rowsRead = 0;
    const tally = (answer: unknown): void => {
      if (Array.isArray(answer)) rowsRead += answer.length;
      else if (answer !== null && answer !== undefined) rowsRead += 1;
    };
    const wrapped = new Proxy(repo, {
      get(target, property, receiver) {
        const member: unknown = Reflect.get(target, property, receiver);
        if (typeof member !== "function" || typeof property !== "string" || !/^(list|find)/.test(property)) return member;
        return async (...args: unknown[]) => {
          if (property === "list") lists += 1;
          const answer: unknown = await (member as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          tally(answer);
          return answer;
        };
      },
    });
    return { repo: wrapped, lists: () => lists, rowsRead: () => rowsRead };
  }

  async function importOf(count: number) {
    const base = await newApp();
    const items = counted(base.items);
    const app = createDataMigrationRoutes(
      { ...base.deps, departments: base.departments, employees: base.employees, items: items.repo },
      insecureHeaderAuthContextResolver,
    );
    const seeded = await app.fetch(req("/items/commit", Array.from({ length: 50 }, (_, i) => ({ code: `OLD-${i}`, nameAr: `قديم ${i}`, baseUnitCode: "PCS", type: "stock" }))));
    expect(seeded.status).toBe(201);
    const listsBefore = items.lists();
    const readBefore = items.rowsRead();
    const res = await app.fetch(req("/items/commit", Array.from({ length: count }, (_, i) => ({ code: `NEW-${i}`, nameAr: `صنف ${i}`, baseUnitCode: "PCS", type: "stock" }))));
    expect(res.status).toBe(201);
    expect((await base.items.list()).length).toBe(50 + count);
    return { lists: items.lists() - listsBefore, rowsRead: items.rowsRead() - readBefore };
  }

  it("reads the catalog once whatever the file's size, and never once per row", async () => {
    const small = await importOf(100);
    const large = await importOf(400);

    expect(small.lists).toBe(1);
    expect(large.lists).toBe(1);
    expect(small.rowsRead).toBeLessThanOrEqual(50 + 100);
    expect(large.rowsRead).toBeLessThanOrEqual(50 + 400);
    expect(large.rowsRead - small.rowsRead).toBeLessThanOrEqual(300);
  });
});
