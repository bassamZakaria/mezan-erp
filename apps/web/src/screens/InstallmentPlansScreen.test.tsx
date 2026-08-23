// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallmentPlansScreen } from "./InstallmentPlansScreen";

describe.each(["light", "dark"] as const)("InstallmentPlansScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderScreen() {
    document.documentElement.setAttribute("data-theme", theme);
    return render(<InstallmentPlansScreen />);
  }

  it("starts empty and shows the documented empty state", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "خطط الأقساط" })).toBeInTheDocument();
    expect(screen.getByText("أنشئ خطة أقساط لتقسيم مبلغ الفاتورة على دفعات")).toBeInTheDocument();
  });

  it("previews an even 6-way monthly split of the invoice balance via the real generateInstallmentSchedule", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "خطة جديدة" }));
    // default invoice INV-000123 has remaining 450.00, default 6 monthly installments, no down payment
    // → 6 equal shares of 75.00, first due on the default start date 2026-08-21
    expect(await screen.findByText("معاينة الجدول")).toBeInTheDocument();
    const amounts = screen.getAllByText("75.00");
    expect(amounts).toHaveLength(6);
    expect(screen.getByText("#1 — 2026-08-21")).toBeInTheDocument();
    expect(screen.getByText("#6 — 2027-01-21")).toBeInTheDocument();
  });

  it("creates a plan and lists it with the real remaining balance and IP- number", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "خطة جديدة" }));
    await screen.findByText("معاينة الجدول");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await screen.findByText("IP-000001");
    const row = screen.getByText("IP-000001").closest("tr") as HTMLElement;
    expect(within(row).getByText("450.00")).toBeInTheDocument(); // 6 × 75.00 remaining
    expect(within(row).getByText("شهري")).toBeInTheDocument();
    expect(within(row).getByText("نشط")).toBeInTheDocument();

    // stats update: 1 total plan, 1 active
    expect(screen.getByText("إجمالي الخطط").nextElementSibling).toHaveTextContent("1");
  });

  it("processing overdue installments with nothing overdue reports zero and applies no late fees", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "معالجة المتأخرات" }));
    const btns = screen.getAllByRole("button", { name: "معالجة المتأخرات" });
    await user.click(btns[1] as HTMLElement);
    await waitFor(() => expect(document.body.textContent).toContain("تم تحديث"));
    expect(document.body.textContent).toContain("تم تحديث 0 قسط إلى متأخر");
  });
});
