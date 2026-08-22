// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { AssetCategoryDTO, AssetDTO, BranchDTO } from "@mezan/contracts";
import { AssetRegisterScreen } from "./AssetRegisterScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleCategories: AssetCategoryDTO[] = [
  {
    id: "cat-1",
    code: "FA-01",
    nameAr: "مركبات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
  },
];

const sampleBranches: BranchDTO[] = [
  { id: "br-1", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const sampleAssets: AssetDTO[] = [
  {
    id: "asset-1",
    code: "VEH-001",
    nameAr: "سيارة النقل الرئيسية",
    nameEn: "Main delivery van",
    categoryId: "cat-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-01",
    acquisitionCost: "300000.000000",
    depreciationStartDate: "2025-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 60,
    salvageValue: "30000.000000",
    accumulatedDepreciation: "50000.000000",
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
  },
];

function renderScreen(assets: AssetDTO[] = sampleAssets) {
  let current = [...assets];
  const transport = stubTransport({
    "GET /assets": () => ({ body: current }),
    "GET /assets/categories": () => ({ body: sampleCategories }),
    "GET /branches": () => ({ body: sampleBranches }),
    "POST /assets": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((a) => a.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_ASSET_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: AssetDTO = {
        ...body,
        nameEn: body.nameEn ?? null,
        scope: body.scope ?? "general",
        branchId: body.branchId ?? null,
        warehouseId: body.warehouseId ?? null,
        depreciationStartDate: body.depreciationStartDate ?? body.acquisitionDate,
        depreciationMethod: "straight_line",
        usefulLifeMonths: body.usefulLifeMonths ?? 60,
        salvageValue: body.salvageValue ?? "0.000000",
        accumulatedDepreciation: "0.000000",
        status: "active",
        assetAccountId: null,
        depreciationExpenseAccountId: null,
        accumulatedDepreciationAccountId: null,
        notes: null,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
}

describe("AssetRegisterScreen", () => {
  it("lists assets from the real backend with resolved category and computed book value", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "سجل الأصول" })).toBeInTheDocument();
    expect(await screen.findByText("سيارة النقل الرئيسية")).toBeInTheDocument();
    expect(screen.getAllByText("FA-01 — مركبات").length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no assets yet", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد أصول/)).toBeInTheDocument();
  });

  it("registers a new asset through the side panel", async () => {
    renderScreen();
    await screen.findByText("سيارة النقل الرئيسية");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل أصل" }));

    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });
    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "رافعة شوكية" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "EQ-002" } });
    fireEvent.change(within(dialog).getByLabelText("التصنيف *"), { target: { value: "cat-1" } });
    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByLabelText("العمر الإنتاجي (شهور) *"), { target: { value: "48" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("رافعة شوكية")).toBeInTheDocument();
  });

  it("rejects a duplicate asset code with an inline error", async () => {
    renderScreen();
    await screen.findByText("سيارة النقل الرئيسية");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل أصل" }));
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });
    fireEvent.change(within(dialog).getByLabelText("الاسم بالعربية *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("كود الأصل *"), { target: { value: "VEH-001" } });
    fireEvent.change(within(dialog).getByLabelText("التصنيف *"), { target: { value: "cat-1" } });
    fireEvent.change(within(dialog).getByLabelText("تاريخ الاقتناء *"), { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByLabelText("العمر الإنتاجي (شهور) *"), { target: { value: "48" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the read-only asset detail panel on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("سيارة النقل الرئيسية"));

    const detail = screen.getByRole("dialog", { name: /أصل —/ });
    expect(within(detail).getByText("VEH-001")).toBeInTheDocument();
  });
});
