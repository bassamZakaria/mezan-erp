// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { AssetCategoryDTO } from "@mezan/contracts";
import { AssetCategoriesScreen } from "./AssetCategoriesScreen";
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
  {
    id: "cat-2",
    code: "FA-02",
    nameAr: "أثاث مكتبي",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 36,
    defaultSalvagePercent: 0,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: false,
  },
];

function renderScreen(categories: AssetCategoryDTO[] = sampleCategories) {
  let current = [...categories];
  const transport = stubTransport({
    "GET /assets/categories": () => ({ body: current }),
    "POST /assets/categories": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((c) => c.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_ASSET_CATEGORY_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: AssetCategoryDTO = {
        ...body,
        nameEn: body.nameEn ?? null,
        defaultDepreciationMethod: "straight_line",
        assetAccountId: body.assetAccountId ?? null,
        depreciationExpenseAccountId: body.depreciationExpenseAccountId ?? null,
        accumulatedDepreciationAccountId: body.accumulatedDepreciationAccountId ?? null,
        gainOnDisposalAccountId: body.gainOnDisposalAccountId ?? null,
        lossOnDisposalAccountId: body.lossOnDisposalAccountId ?? null,
        active: true,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<AssetCategoriesScreen />, { transport, initialSession: testAdminSession });
}

describe("AssetCategoriesScreen", () => {
  it("lists asset categories from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "تصنيفات الأصول" })).toBeInTheDocument();
    expect(await screen.findByText("مركبات")).toBeInTheDocument();
    expect(screen.getByText("أثاث مكتبي")).toBeInTheDocument();
  });

  it("shows an empty state when there are no categories yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("filters the list by active status via the chip row", async () => {
    renderScreen();
    await screen.findByText("مركبات");
    fireEvent.click(screen.getByRole("tab", { name: /^غير نشط/ }));
    expect(screen.getByText("أثاث مكتبي")).toBeInTheDocument();
    expect(screen.queryByText("مركبات")).not.toBeInTheDocument();
  });

  it("adds a new asset category through the side panel", async () => {
    renderScreen();
    await screen.findByText("مركبات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة تصنيف" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة تصنيف" });
    fireEvent.change(within(dialog).getByLabelText("كود التصنيف *"), { target: { value: "FA-03" } });
    fireEvent.change(within(dialog).getByLabelText("اسم التصنيف *"), { target: { value: "معدات تصنيع" } });
    fireEvent.change(within(dialog).getByLabelText("العمر الإنتاجي الافتراضي (شهور) *"), { target: { value: "48" } });
    fireEvent.change(within(dialog).getByLabelText("نسبة القيمة المتبقية الافتراضية (%) *"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("معدات تصنيع")).toBeInTheDocument();
  });

  it("rejects a duplicate category code with an inline error", async () => {
    renderScreen();
    await screen.findByText("مركبات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة تصنيف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة تصنيف" });
    fireEvent.change(within(dialog).getByLabelText("كود التصنيف *"), { target: { value: "FA-01" } });
    fireEvent.change(within(dialog).getByLabelText("اسم التصنيف *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("العمر الإنتاجي الافتراضي (شهور) *"), { target: { value: "48" } });
    fireEvent.change(within(dialog).getByLabelText("نسبة القيمة المتبقية الافتراضية (%) *"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });
});
