// @vitest-environment jsdom
// Side-effect import so jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveTextContent, …) is visible to apps/web's own `tsc --noEmit` — its
// tsconfig doesn't include packages/ui/src/test/setup.ts (which registers
// this for the rest of the workspace), even though the matchers work at
// runtime via vitest.config.ts's `setupFiles`.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartOfAccountsScreen } from "./ChartOfAccountsScreen";
import { demoAccounts } from "../accounts-sample-data";

describe("ChartOfAccountsScreen", () => {
  it("renders the page title and stat totals matching the sample COA", () => {
    render(<ChartOfAccountsScreen />);
    expect(screen.getByRole("heading", { name: "دليل الحسابات" })).toBeInTheDocument();
    expect(screen.getAllByText(String(demoAccounts.length)).length).toBeGreaterThan(0);
    const headerCount = demoAccounts.filter((a) => a.isHeader).length;
    expect(screen.getAllByText(String(headerCount)).length).toBeGreaterThan(0);
  });

  it("renders root and nested accounts from the sample tree", () => {
    render(<ChartOfAccountsScreen />);
    expect(screen.getByText("الأصول")).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي الفرع الرئيسي")).toBeInTheDocument();
  });

  it("filters the visible rows by search text", async () => {
    const user = userEvent.setup();
    render(<ChartOfAccountsScreen />);
    await user.type(screen.getByPlaceholderText("بحث بالاسم أو الرقم..."), "النقدية");
    expect(screen.getByText("النقدية")).toBeInTheDocument();
    expect(screen.queryByText("الالتزامات")).not.toBeInTheDocument();
  });

  it("opens the account detail panel on row click, showing balance and parent", async () => {
    const user = userEvent.setup();
    render(<ChartOfAccountsScreen />);
    await user.click(screen.getByText("صندوق نقدي الفرع الرئيسي"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("حركات الحساب")).toBeInTheDocument();
    expect(within(dialog).getByText("مدين")).toBeInTheDocument();
    // Stubbed movements note (Phase 2), not a real movements table.
    expect(within(dialog).getByText(/المرحلة الثانية/)).toBeInTheDocument();
  });

  it("opens the add-account form and creates a new detail account under a header parent", async () => {
    const user = userEvent.setup();
    render(<ChartOfAccountsScreen />);
    await user.click(screen.getByRole("button", { name: "إضافة حساب" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    await user.type(within(dialog).getByLabelText("الكود *"), "1330-1");
    await user.type(within(dialog).getByLabelText("الاسم *"), "حساب اختبار");

    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(screen.queryByRole("dialog", { name: "إضافة حساب" })).not.toBeInTheDocument();
    expect(screen.getByText("حساب اختبار")).toBeInTheDocument();
  });

  it("rejects creating an account with a duplicate code and keeps the form open with an error", async () => {
    const user = userEvent.setup();
    render(<ChartOfAccountsScreen />);
    await user.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    await user.type(within(dialog).getByLabelText("الكود *"), "1000"); // already exists as a root
    await user.type(within(dialog).getByLabelText("الاسم *"), "نسخة");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
    expect(screen.getByRole("dialog", { name: "إضافة حساب" })).toBeInTheDocument();
  });

  it("toggles a single header row's children with the tree-row toggle", () => {
    render(<ChartOfAccountsScreen />);
    // Cash (1300) is a header and starts expanded by default; collapse it via its toggle.
    const cashRow = screen.getByText("النقدية").closest("tr")!;
    const toggle = within(cashRow).getByRole("button", { name: "طي" });
    fireEvent.click(toggle);
    expect(screen.queryByText("صندوق نقدي الفرع الرئيسي")).not.toBeInTheDocument();
  });
});
