// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { AssetDTO, BranchDTO, EmployeeDTO, ItemDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
import { BranchesPage } from "./BranchesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

const branches: BranchDTO[] = [
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
    phone: null,
    email: null,
    address: null,
    isMain: false,
    active: true,
  },
];

function employee(overrides: Partial<EmployeeDTO> = {}): EmployeeDTO {
  return {
    id: "e1",
    code: "EMP-001",
    firstName: "Ahmed",
    lastName: "Ali",
    firstNameAr: "أحمد",
    lastNameAr: "علي",
    email: null,
    phone: "01000000000",
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "b1",
    hireDate: "2024-01-15",
    workerCategory: "monthly",
    employmentType: "full_time",
    overtimeEligibility: "none",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as EmployeeDTO;
}

interface Options {
  readonly branchesStatus?: number;
  readonly warehousesStatus?: number;
  readonly warehouses?: WarehouseDTO[];
  readonly items?: ItemDTO[];
  readonly stockByWarehouse?: Record<string, StockBalanceRowDTO[]>;
  readonly stockStatus?: number;
  readonly employees?: EmployeeDTO[];
  readonly employeesStatus?: number;
  readonly assets?: AssetDTO[];
  readonly assetsStatus?: number;
  readonly assetCategories?: { id: string; nameAr: string }[];
  readonly onUpdateBranch?: (id: string, body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
  readonly onCreateBranch?: (body: Record<string, unknown>) => { status?: number; body: unknown } | undefined;
  readonly updateRequests?: { id: string; body: Record<string, unknown> }[];
  readonly createRequests?: Record<string, unknown>[];
}

function renderScreen(opts: Options = {}) {
  let current = [...branches];
  const transport = stubTransport({
    "GET /branches": () => ({ status: opts.branchesStatus ?? 200, body: current }),
    "GET /warehouses": () => ({ status: opts.warehousesStatus ?? 200, body: opts.warehouses ?? [] }),
    "GET /items": () => ({ body: opts.items ?? [] }),
    "GET /inventory/stock-balance": (_init, path) => {
      const warehouseId = new URL(path, "http://x").searchParams.get("warehouseId") ?? "";
      return {
        status: opts.stockStatus ?? 200,
        body: { rows: opts.stockByWarehouse?.[warehouseId] ?? [] },
      };
    },
    "GET /hr/employees": () => ({ status: opts.employeesStatus ?? 200, body: opts.employees ?? [] }),
    "GET /assets": () => ({ status: opts.assetsStatus ?? 200, body: opts.assets ?? [] }),
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
      const created = { ...body, active: true } as BranchDTO;
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PUT /branches/*": (init, path) => {
      const id = path.split("/").pop() as string;
      const body = JSON.parse((init?.body as string) ?? "{}");
      opts.updateRequests?.push({ id, body });
      const overridden = opts.onUpdateBranch?.(id, body);
      if (overridden) return overridden;
      const existing = current.find((b) => b.id === id)!;
      const updated = { ...existing, ...body } as BranchDTO;
      current = current.map((b) => (b.id === id ? updated : b));
      return { body: updated };
    },
  });
  return renderWithProviders(<BranchesPage />, { transport, initialSession: testAdminSession });
}

async function openDetail(name = "MAIN") {
  fireEvent.click(await screen.findByText(name));
}

describe("BranchesPage — when the server refuses", () => {
  it("says the branch list could not be loaded rather than showing an empty register", async () => {
    renderScreen({ branchesStatus: 503 });
    expect(await screen.findByText(/تعذّر تحميل الفروع|تعذّر/)).toBeInTheDocument();
  });

  it("offers a retry on each tab whose own query failed", async () => {
    renderScreen({ warehousesStatus: 503 });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(await screen.findByText("تعذّر تحميل مستودعات الفرع.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("says the employees could not be loaded", async () => {
    renderScreen({ employeesStatus: 503 });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));
    expect(await screen.findByText("تعذّر تحميل موظفي الفرع.")).toBeInTheDocument();
  });

  it("says the assets could not be loaded", async () => {
    renderScreen({ assetsStatus: 503 });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الأصول" }));
    expect(await screen.findByText("تعذّر تحميل أصول الفرع.")).toBeInTheDocument();
  });
});

describe("BranchesPage — the inventory tab", () => {
  const warehouse: WarehouseDTO = {
    id: "wh-1",
    code: "MAIN-WH",
    name: "مستودع الرئيسي",
    nameEn: null,
    branchId: "b1",
    type: "MAIN",
    isDefault: true,
    active: true,
  } as unknown as WarehouseDTO;

  function stockRow(itemId: string, totalValue: string): StockBalanceRowDTO {
    return {
      itemId,
      onHand: "10.000000",
      averageCost: "5.000000",
      totalValue,
      reserved: "0.000000",
      available: "10.000000",
      warehouseCount: 1,
      warehouses: [],
    } as unknown as StockBalanceRowDTO;
  }

  it("says no warehouse is linked before one exists", async () => {
    renderScreen();
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(await screen.findByText("لا توجد مستودعات مرتبطة بهذا الفرع")).toBeInTheDocument();
  });

  it("says the branch holds no stock once it has a warehouse but nothing in it", async () => {
    renderScreen({ warehouses: [warehouse] });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(await screen.findByText("لا يوجد رصيد مخزون في مستودعات هذا الفرع")).toBeInTheDocument();
  });

  it("falls back to the item id when the catalogue has no name for a row", async () => {
    renderScreen({
      warehouses: [warehouse],
      items: [],
      stockByWarehouse: { "wh-1": [stockRow("itm-unknown", "900.000000")] },
    });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));

    expect(await screen.findByText("itm-unknown")).toBeInTheDocument();
  });
});

describe("BranchesPage — the employees tab", () => {
  it("falls back to the English name when the record carries no Arabic one", async () => {
    renderScreen({ employees: [employee({ firstNameAr: null, lastNameAr: null })] });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));
    expect(await screen.findByText("Ahmed Ali")).toBeInTheDocument();
  });

  it("renders a dash for a phone the record does not carry, and names the part-time contract", async () => {
    renderScreen({ employees: [employee({ phone: null, employmentType: "part_time" })] });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));

    const row = (await screen.findByText("EMP-001")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("دوام جزئي")).toBeInTheDocument();
  });

  it("names every employment status the register can hold", async () => {
    renderScreen({
      employees: [
        employee({ id: "e1", code: "EMP-001", status: "active" }),
        employee({ id: "e2", code: "EMP-002", status: "on_leave" }),
        employee({ id: "e3", code: "EMP-003", status: "suspended" }),
        employee({ id: "e4", code: "EMP-004", status: "terminated" }),
      ],
    });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الموظفون" }));
    expect(await screen.findByText("EMP-004")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(5);
  });
});

describe("BranchesPage — the assets tab", () => {
  it("falls back to the category id when the category register has no name for it", async () => {
    const asset = {
      id: "a1",
      code: "AST-001",
      nameAr: "سيارة توزيع",
      categoryId: "cat-gone",
      branchId: "b1",
      acquisitionDate: "2023-05-01",
      acquisitionCost: "100000.000000",
      accumulatedDepreciation: "0.000000",
      status: "active",
      warehouseId: null,
      costCenterId: null,
      serialNumber: null,
      custodianEmployeeId: null,
      depreciationMethod: "straight_line",
      usefulLifeMonths: 60,
      salvageValue: "0.000000",
      createdAt: "2023-05-01T00:00:00.000Z",
    } as unknown as AssetDTO;

    renderScreen({ assets: [asset], assetCategories: [] });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الأصول" }));
    expect(await screen.findByText("cat-gone")).toBeInTheDocument();
  });

  it("says no asset is recorded against a branch that has none", async () => {
    renderScreen({ assets: [] });
    await openDetail();
    fireEvent.click(screen.getByRole("tab", { name: "الأصول" }));
    expect(await screen.findByText("لا توجد أصول مسجّلة على هذا الفرع")).toBeInTheDocument();
  });
});

describe("BranchesPage — searching and editing", () => {
  it("shows every branch again once the search box is cleared", async () => {
    renderScreen();
    const search = await screen.findByPlaceholderText(/بحث/);

    fireEvent.change(search, { target: { value: "ALEX" } });
    await waitFor(() => expect(screen.queryByText("MAIN")).not.toBeInTheDocument());

    fireEvent.change(search, { target: { value: "   " } });
    expect(await screen.findByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("ALEX")).toBeInTheDocument();
  });

  it("surfaces the server's own message when an edit is refused", async () => {
    renderScreen({
      onUpdateBranch: () => ({ status: 422, body: { error: "INVALID_BRANCH", message: "لا يمكن أن يكون الفرع أباً لنفسه." } }),
    });
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(textboxByLabel(dialog, "اسم الفرع"), { target: { value: "اسم جديد" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    expect(await screen.findByText("لا يمكن أن يكون الفرع أباً لنفسه.")).toBeInTheDocument();
  });

  it("surfaces the server's own message when a create is refused", async () => {
    renderScreen({
      onCreateBranch: () => ({ status: 409, body: { error: "ALREADY_EXISTS", message: "كود الفرع مستخدم بالفعل." } }),
    });
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));

    const dialog = await screen.findByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(textboxByLabel(dialog, "اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(await screen.findByText("كود الفرع مستخدم بالفعل.")).toBeInTheDocument();
  });

  it("sends no parent at all for a branch marked as the main one", async () => {
    const updateRequests: { id: string; body: Record<string, unknown> }[] = [];
    renderScreen({ updateRequests });
    fireEvent.click(await screen.findByText("ALEX"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "فرع رئيسي" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await screen.findByText("ALEX");
    expect(updateRequests.at(-1)?.body.parentBranchId).toBeNull();
  });
});
