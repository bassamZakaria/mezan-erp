// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { BranchDTO, ItemDTO, StockBalanceRowDTO, WarehouseDTO } from "@mezan/contracts";
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
});
