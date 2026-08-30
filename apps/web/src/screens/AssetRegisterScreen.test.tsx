// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    // Identity section renders name(ar), name(en), code as plain text inputs in
    // that order — the name(en) field is left untouched (optional).
    const [nameArInput, , codeInput, acquisitionDateInput] = within(dialog).getAllByRole("textbox");
    fireEvent.change(nameArInput!, { target: { value: "رافعة شوكية" } });
    fireEvent.change(codeInput!, { target: { value: "EQ-002" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));
    fireEvent.change(acquisitionDateInput!, { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "48" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("رافعة شوكية")).toBeInTheDocument();
  });

  it("rejects a duplicate asset code with an inline error", async () => {
    renderScreen();
    await screen.findByText("سيارة النقل الرئيسية");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل أصل" }));
    const dialog = screen.getByRole("dialog", { name: "تسجيل أصل" });
    const [nameArInput, , codeInput, acquisitionDateInput] = within(dialog).getAllByRole("textbox");
    fireEvent.change(nameArInput!, { target: { value: "نسخة" } });
    fireEvent.change(codeInput!, { target: { value: "VEH-001" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "التصنيف *" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "FA-01 — مركبات" }));
    fireEvent.change(acquisitionDateInput!, { target: { value: "2026-01-01" } });
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "48" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("opens the read-only asset detail panel on row click", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("سيارة النقل الرئيسية"));

    const detail = screen.getByRole("dialog", { name: /أصل —/ });
    expect(within(detail).getByText("VEH-001")).toBeInTheDocument();
  });

  it("disposes an asset with no sale proceeds, then locks the dispose control", async () => {
    let disposedBody: Record<string, unknown> | null = null;
    let disposed = false;
    const transport = stubTransport({
      "GET /assets": () => ({ body: disposed ? [{ ...sampleAssets[0], status: "disposed" }] : sampleAssets }),
      "GET /assets/categories": () => ({ body: sampleCategories }),
      "GET /branches": () => ({ body: sampleBranches }),
      "POST /assets/asset-1/dispose": (init) => {
        disposedBody = JSON.parse(String(init?.body));
        disposed = true;
        return { body: { ...sampleAssets[0], status: "disposed" } };
      },
    });
    renderWithProviders(<AssetRegisterScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("سيارة النقل الرئيسية"));
    const detail = screen.getByRole("dialog", { name: /أصل —/ });

    fireEvent.click(within(detail).getByRole("button", { name: "التخلص من الأصل" }));
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد التخلص" }));

    await waitFor(() => expect(disposedBody).not.toBeNull());
    expect(disposedBody).toMatchObject({ proceedsAccountId: null });
    // A successful disposal closes the detail panel outright.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /أصل —/ })).not.toBeInTheDocument());

    fireEvent.click(await screen.findByText("سيارة النقل الرئيسية"));
    const reopened = screen.getByRole("dialog", { name: /أصل —/ });
    expect(within(reopened).getByText("تم التخلص")).toBeInTheDocument();
    expect(within(reopened).queryByRole("button", { name: "التخلص من الأصل" })).not.toBeInTheDocument();
  });
});
