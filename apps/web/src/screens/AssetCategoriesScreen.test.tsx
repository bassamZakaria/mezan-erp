// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
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
    await waitFor(() => expect(screen.queryByText("مركبات")).not.toBeInTheDocument());
    expect(screen.getByText("أثاث مكتبي")).toBeInTheDocument();
  });

  it("adds a new asset category through the side panel", async () => {
    renderScreen();
    await screen.findByText("مركبات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة تصنيف" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة تصنيف" });
    // The identity section's two text fields render code first, then name;
    // its two numeric fields render useful life first, then salvage rate.
    const [codeInput, nameInput] = within(dialog).getAllByRole("textbox");
    const [lifeInput, salvageInput] = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(codeInput, { target: { value: "FA-03" } });
    fireEvent.change(nameInput, { target: { value: "معدات تصنيع" } });
    fireEvent.change(lifeInput, { target: { value: "48" } });
    fireEvent.change(salvageInput, { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("معدات تصنيع")).toBeInTheDocument();
  });

  it("rejects a duplicate category code with an inline error", async () => {
    renderScreen();
    await screen.findByText("مركبات");
    fireEvent.click(screen.getByRole("button", { name: "إضافة تصنيف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة تصنيف" });
    const [codeInput, nameInput] = within(dialog).getAllByRole("textbox");
    const [lifeInput, salvageInput] = within(dialog).getAllByRole("spinbutton");
    fireEvent.change(codeInput, { target: { value: "FA-01" } });
    fireEvent.change(nameInput, { target: { value: "نسخة" } });
    fireEvent.change(lifeInput, { target: { value: "48" } });
    fireEvent.change(salvageInput, { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });
});
