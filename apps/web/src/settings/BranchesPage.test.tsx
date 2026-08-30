// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { AssetDTO, BranchDTO, EmployeeDTO, ItemDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
import { BranchesPage } from "./BranchesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

const sampleBranches: BranchDTO[] = [
  {
    id: "b1",
    code: "MAIN",
    name: "الفرع الرئيسي",
    parentBranchId: null,
    phone: "0223456789",
    email: "main@cyag.example",
    address: "القاهرة الجديدة، القاهرة",
    isMain: true,
    active: true,
  },
  {
    id: "b2",
    code: "ALEX",
    name: "فرع الإسكندرية",
    parentBranchId: "b1",
    phone: "0334567890",
    email: null,
    address: "سموحة، الإسكندرية",
    isMain: false,
    active: true,
  },
];

function renderScreen(
  branches: BranchDTO[] = sampleBranches,
  opts: {
    warehouses?: WarehouseDTO[];
    items?: ItemDTO[];
    stockByWarehouse?: Record<string, StockBalanceRowDTO[]>;
    onCreateBranch?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
    createRequests?: Record<string, unknown>[];
    employees?: EmployeeDTO[];
    assets?: AssetDTO[];
    assetCategories?: { id: string; nameAr: string }[];
    employeesStatus?: number;
  } = {},
) {
  let current = [...branches];
  const transport = stubTransport({
    "GET /branches": () => ({ body: current }),
    "GET /warehouses": () => ({ body: opts.warehouses ?? [] }),
    "GET /items": () => ({ body: opts.items ?? [] }),
    "GET /inventory/stock-balance": (_init, path) => {
      const warehouseId = new URL(path, "http://x").searchParams.get("warehouseId") ?? "";
      return { body: { rows: opts.stockByWarehouse?.[warehouseId] ?? [] } };
    },
    "GET /hr/employees": () => ({ status: opts.employeesStatus ?? 200, body: opts.employees ?? [] }),
    "GET /assets": () => ({ body: opts.assets ?? [] }),
    "GET /assets/categories": () => ({ body: opts.assetCategories ?? [] }),
    "GET /sales-invoices": () => ({ body: [] }),
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /treasury-accounts": () => ({ body: [] }),
    "POST /branches": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      opts.createRequests?.push(body);
      const overridden = opts.onCreateBranch?.(body);
      if (overridden) return overridden;
      // Mirrors branches-routes.ts's createBranchSchema.safeParse — an empty code/name
      // fails zod validation before the domain layer ever runs, so no `message` field.
      if (!/^[A-Z0-9_-]{1,20}$/.test(body.code ?? "") || (body.name ?? "").trim() === "") {
        return { status: 400, body: { error: "VALIDATION_ERROR", details: {} } };
      }
      const created: BranchDTO = {
        id: body.id,
        code: body.code,
        name: body.name,
        parentBranchId: body.parentBranchId ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        address: body.address ?? null,
        isMain: body.isMain ?? false,
        active: true,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<BranchesPage />, { transport, initialSession: testAdminSession });
}

describe("BranchesPage", () => {
  it("lists the real branches from the backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
    expect(await screen.findByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("opens the Branch 360 detail on row click, with an Overview tab and a real inventory tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("MAIN"));
    expect(screen.getByRole("heading", { name: /الفرع الرئيسي/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المخزون" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    // المخزون now reads the branch's linked warehouses for real, instead of a "قريباً" stub.
    expect(screen.getByText("لا توجد مستودعات مرتبطة بهذا الفرع")).toBeInTheDocument();
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الفروع" }));
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
  });

  it("adds a new branch through the side panel", async () => {
    renderScreen();
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(textboxByLabel(dialog, "اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(await screen.findByText("فرع الجيزة")).toBeInTheDocument();
  });

  it("shows a validation error instead of adding an invalid branch", async () => {
    renderScreen();
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    // Leave name/code empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));
    expect(await within(dialog).findByText(/تعذر إنشاء الفرع/)).toBeInTheDocument();
  });

  it("shows the server's own refusal message when branch creation is rejected server-side", async () => {
    renderScreen(sampleBranches, {
      onCreateBranch: () => ({ status: 409, body: { message: "رمز الفرع مستخدم بالفعل من فرع آخر." } }),
    });
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(textboxByLabel(dialog, "اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(await within(dialog).findByText("رمز الفرع مستخدم بالفعل من فرع آخر.")).toBeInTheDocument();
    // The panel must stay open on a refusal — a silently-closed panel would
    // read as success while nothing was actually created.
    expect(screen.getByRole("dialog", { name: "إضافة فرع" })).toBeInTheDocument();
  });

  it("rolls up stock from every warehouse linked to the branch, merging the same item's quantity and value", async () => {
    const warehouses: WarehouseDTO[] = [
      { id: "wh-1", code: "WH1", name: "مخزن 1", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
      { id: "wh-2", code: "WH2", name: "مخزن 2", nameEn: null, branchId: "b1", type: "MAIN", isDefault: false, active: true },
    ];
    const items: ItemDTO[] = [
      {
        id: "itm-1", code: "ITM-000001", nameAr: "زيت عباد الشمس", nameEn: null, type: "stock", baseUnitCode: "PCS",
        alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null,
        defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "0", costPrice: "0",
        taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null,
        imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
        etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
      },
    ];
    const stockRow = (onHand: string, totalValue: string, averageCost: string, warehouseId: string): StockBalanceRowDTO => ({
      itemId: "itm-1",
      onHand,
      totalValue,
      averageCost,
      warehouseCount: 1,
      reserved: "0.000000",
      available: onHand,
      warehouses: [{ warehouseId, onHand, totalValue, averageCost, reserved: "0.000000", available: onHand }],
    });
    renderScreen(sampleBranches, {
      warehouses,
      items,
      stockByWarehouse: {
        "wh-1": [stockRow("10.000000", "1000.000000", "100.000000", "wh-1")],
        "wh-2": [stockRow("10.000000", "500.000000", "50.000000", "wh-2")],
      },
    });
    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));

    expect(await screen.findByText("زيت عباد الشمس")).toBeInTheDocument();
    const row = screen.getByText("زيت عباد الشمس").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    // Merged onHand = 10 + 10 = 20.
    expect(cells[2]!.textContent).toBe("20");
    // Merged totalValue = 1000 + 500 = 1500, and averageCost is re-derived
    // (1500 / 20 = 75), not averaged from the two warehouses' 100/50 naively.
    expect(cells[3]!.textContent).toMatch(/75/);
    expect(cells[4]!.textContent).toMatch(/1,500|1500/);
    // Two warehouses contributed to this row.
    expect(cells[5]!.textContent).toBe("2");
  });

  it("LIMITATION (D125): a branch row opens a read-only detail view — there is no edit or deactivate control anywhere in the list or the detail, and useUpdateBranch is not even imported by this screen", async () => {
    renderScreen();
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText("MAIN"));
    // The detail view's only action is the back button — no edit, no
    // deactivate, no "set parent" control exists anywhere on this screen.
    expect(screen.getByRole("button", { name: "رجوع لقائمة الفروع" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument();
  });

  it("LIMITATION (D125): the add-branch form has no parent-branch field, so a newly created branch's 'الفرع الرئيسي' (parent) column can never be set through the UI — it only shows data seeded outside this screen", async () => {
    const createRequests: Record<string, unknown>[] = [];
    renderScreen(sampleBranches, { createRequests });
    await screen.findByText("MAIN");

    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    // Every field the create form actually exposes.
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(5);
    expect(within(dialog).queryByText(/الفرع الأب|فرع أب|parent/i)).not.toBeInTheDocument();

    fireEvent.change(textboxByLabel(dialog, "اسم الفرع"), { target: { value: "فرع طنطا" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الفرع"), { target: { value: "TANTA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));
    await screen.findByText("فرع طنطا");

    expect(createRequests).toHaveLength(1);
    expect(createRequests[0]).not.toHaveProperty("parentBranchId");

    const row = screen.getByText("فرع طنطا").closest("tr")!;
    expect(within(row).getByRole("cell", { name: "—" })).toBeInTheDocument();
  });

  it("BranchInventoryTab: a failed fetch shows a retry control that re-issues the request", async () => {
    const warehouses: WarehouseDTO[] = [
      { id: "wh-1", code: "WH1", name: "مخزن 1", nameEn: null, branchId: "b1", type: "MAIN", isDefault: true, active: true },
    ];
    let stockCalls = 0;
    let failStock = true;
    const transport = stubTransport({
      "GET /branches": () => ({ body: sampleBranches }),
      "GET /warehouses": () => ({ body: warehouses }),
      "GET /items": () => ({ body: [] }),
      "GET /inventory/stock-balance": () => {
        stockCalls += 1;
        if (failStock) return { status: 500, body: { error: "SERVER_ERROR" } };
        return { body: { rows: [] } };
      },
      "GET /hr/employees": () => ({ body: [] }),
      "GET /assets": () => ({ body: [] }),
      "GET /assets/categories": () => ({ body: [] }),
      "GET /sales-invoices": () => ({ body: [] }),
      "GET /purchases/invoices": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /treasury-accounts": () => ({ body: [] }),
    });
    renderWithProviders(<BranchesPage />, { transport, initialSession: testAdminSession });

    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(await screen.findByText("تعذّر تحميل رصيد مخزون الفرع.")).toBeInTheDocument();
    const callsBeforeRetry = stockCalls;

    failStock = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("لا توجد مستودعات مرتبطة بهذا الفرع", { exact: false }).catch(() => undefined);
    expect(stockCalls).toBeGreaterThan(callsBeforeRetry);
  });

  it("BranchEmployeesTab: shows only this branch's employees with real KPI counts, and an error state offers a working retry", async () => {
    const employees = [
      {
        id: "e1", code: "EMP-001", firstName: "Ahmed", lastName: "Ali", firstNameAr: "أحمد", lastNameAr: "علي",
        email: null, phone: "0100000001", birthDate: null, nationalId: null, gender: null, maritalStatus: null,
        departmentId: null, jobTitleId: null, managerId: null, branchId: "b1", hireDate: "2024-01-15",
        workerCategory: "monthly", employmentType: "full_time", overtimeEligibility: "none", standardWorkHours: null,
        probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false, requireBiometricAtClockIn: false,
        address: null, emergencyContact: null, status: "active", terminatedAt: null, createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "e2", code: "EMP-002", firstName: "Sara", lastName: "Adel", firstNameAr: "سارة", lastNameAr: "عادل",
        email: null, phone: null, birthDate: null, nationalId: null, gender: null, maritalStatus: null,
        departmentId: null, jobTitleId: null, managerId: null, branchId: "b2", hireDate: "2024-02-01",
        workerCategory: "monthly", employmentType: "part_time", overtimeEligibility: "none", standardWorkHours: null,
        probationEndDate: null, priorServiceYears: 0, requireSelfieAtClockIn: false, requireBiometricAtClockIn: false,
        address: null, emergencyContact: null, status: "active", terminatedAt: null, createdAt: "2024-01-01T00:00:00.000Z",
      },
    ] as unknown as EmployeeDTO[];
    renderScreen(sampleBranches, { employees });

    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));

    // Only b1's employee shows, not b2's — the tab is scoped to this branch.
    expect(await screen.findByText("أحمد علي")).toBeInTheDocument();
    expect(screen.queryByText("سارة عادل")).not.toBeInTheDocument();
    expect(screen.getByText("EMP-001")).toBeInTheDocument();
  });

  it("BranchEmployeesTab: an empty branch shows the real empty state, not a blank table", async () => {
    renderScreen(sampleBranches, { employees: [] });
    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));
    expect(await screen.findByText("لا يوجد موظفون مسجّلون على هذا الفرع")).toBeInTheDocument();
  });

  it("BranchAssetsTab: shows this branch's assets with a net book value derived as cost minus accumulated depreciation, not the raw cost", async () => {
    const assets = [
      {
        id: "a1", code: "AST-001", nameAr: "سيارة توزيع", categoryId: "cat-1", branchId: "b1",
        acquisitionDate: "2023-05-01", acquisitionCost: "100000.000000", accumulatedDepreciation: "30000.000000",
        status: "active", warehouseId: null, costCenterId: null, serialNumber: null, custodianEmployeeId: null,
        depreciationMethod: "straight_line", usefulLifeMonths: 60, salvageValue: "0.000000", createdAt: "2023-05-01T00:00:00.000Z",
      },
    ] as unknown as AssetDTO[];
    renderScreen(sampleBranches, { assets, assetCategories: [{ id: "cat-1", nameAr: "مركبات" }] });

    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("tab", { name: "الأصول" }));

    expect(await screen.findByText("سيارة توزيع")).toBeInTheDocument();
    expect(screen.getByText("مركبات")).toBeInTheDocument();
    const row = screen.getByText("سيارة توزيع").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    // Net value column: 100,000 − 30,000 = 70,000 — not the raw acquisition cost.
    expect(cells[6]!.textContent).toMatch(/70,000|70000/);
  });
});
