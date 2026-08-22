// @vitest-environment jsdom
// Side-effect import so jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveTextContent, …) is visible to apps/web's own `tsc --noEmit` — its
// tsconfig doesn't include packages/ui/src/test/setup.ts (which registers
// this for the rest of the workspace), even though the matchers work at
// runtime via vitest.config.ts's `setupFiles`.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemsScreen } from "./ItemsScreen";
import { demoItems } from "../items-sample-data";

describe("ItemsScreen", () => {
  it("renders the page title and stat totals matching the sample catalog", () => {
    render(<ItemsScreen />);
    expect(screen.getByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
    expect(screen.getAllByText(String(demoItems.length)).length).toBeGreaterThan(0);
    const activeCount = demoItems.filter((i) => i.status === "active").length;
    expect(screen.getAllByText(String(activeCount)).length).toBeGreaterThan(0);
  });

  it("filters the visible rows by search text", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.type(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), "زيت عباد الشمس");
    expect(screen.getByText("زيت عباد الشمس 1 لتر")).toBeInTheDocument();
    expect(screen.queryByText("ورق طباعة A4 (رزمة 500 ورقة)")).not.toBeInTheDocument();
  });

  it("opens the item detail view on row click and shows the stubbed stock tab", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.click(screen.getByText("أرز أبيض مصري 5 كجم"));

    expect(screen.getByRole("heading", { name: "ITM-000001 — أرز أبيض مصري 5 كجم" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(screen.getByText(/المرحلة الثانية/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "رجوع للقائمة" }));
    expect(screen.getByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
  });

  it("hides the inventory-policy section once the item type is switched to service", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    expect(within(dialog).getByText("تتبع المخزون")).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText("نوع الصنف *"), "service");
    expect(within(dialog).queryByText("تتبع المخزون")).not.toBeInTheDocument();
  });

  it("creates a new item from the add form and it's findable via search", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    await user.type(within(dialog).getByLabelText("اسم الصنف *"), "منتج اختباري جديد");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.queryByRole("dialog", { name: "إضافة صنف" })).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("بحث بالاسم أو الكود..."), "منتج اختباري جديد");
    expect(screen.getByText("منتج اختباري جديد")).toBeInTheDocument();
  });

  it("rejects a duplicate barcode and keeps the form open with an error", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.click(screen.getByRole("button", { name: "إضافة صنف" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة صنف" });

    await user.type(within(dialog).getByLabelText("اسم الصنف *"), "صنف باركود مكرر");
    await user.click(within(dialog).getByRole("button", { name: "+ إضافة باركود آخر" }));
    await user.click(within(dialog).getByRole("button", { name: "+ إضافة باركود آخر" }));
    const [firstBarcodeInput, secondBarcodeInput] = within(dialog).getAllByLabelText("الباركود");
    await user.type(firstBarcodeInput!, "1112223334445");
    await user.type(secondBarcodeInput!, "1112223334445");

    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("مكرر");
    expect(screen.getByRole("dialog", { name: "إضافة صنف" })).toBeInTheDocument();
  });

  it("edits an existing item's status via the row edit action", async () => {
    const user = userEvent.setup();
    render(<ItemsScreen />);
    await user.click(screen.getByRole("button", { name: "تعديل أرز أبيض مصري 5 كجم" }));
    const dialog = screen.getByRole("dialog", { name: "تعديل صنف" });

    await user.selectOptions(within(dialog).getByLabelText("الحالة"), "inactive");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(screen.queryByRole("dialog", { name: "تعديل صنف" })).not.toBeInTheDocument();
    const row = screen.getByText("أرز أبيض مصري 5 كجم").closest("tr")!;
    expect(within(row).getByText("غير نشط")).toBeInTheDocument();
  });
});
