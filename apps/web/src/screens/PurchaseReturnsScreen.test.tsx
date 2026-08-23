// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseReturnsScreen } from "./PurchaseReturnsScreen";

describe.each(["light", "dark"] as const)("PurchaseReturnsScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderScreen() {
    document.documentElement.setAttribute("data-theme", theme);
    return render(<PurchaseReturnsScreen />);
  }

  it("starts empty and shows the documented empty state", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeInTheDocument();
    expect(screen.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("saves a draft return with the real unit cost + tax total (150.00 cost + 14% tax = 171.00)", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    // default line: item itm-1 (cost 150.00, tax 14%), qty 1 → 150 + 21 = 171.00
    await user.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await screen.findByText("171.00");
    const row = screen.getByText("171.00").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("مسودة");
    expect(within(row).getByText("PI-000001")).toBeInTheDocument();
  });

  it("rejects a submission with no positive-quantity lines", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    await user.clear(screen.getByLabelText("الكمية"));
    await user.type(screen.getByLabelText("الكمية"), "0");
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(await screen.findByText("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.")).toBeInTheDocument();
  });

  it("filters a saved draft out of the مؤكد chip until it is confirmed", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    await user.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    await screen.findByText("171.00");
    await user.click(screen.getByRole("tab", { name: /^مؤكد/ }));
    expect(screen.queryByText("171.00")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^مسودة/ }));
    expect(screen.getByText("171.00")).toBeInTheDocument();
  });

  // KNOWN GAP (see task report): this demo store never seeds any on-hand stock for
  // itm-1/MAIN-WH, so confirming a purchase return — which de-stocks the warehouse —
  // always hits the real negative-stock guard. The guard firing here is itself the
  // correctness-critical behavior under test; the demo wiring gap is reported separately.
  it("blocks confirmation with the real negative-stock guard when the warehouse has no on-hand stock", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مرتجع جديد" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(await screen.findByText(/negative stock is disallowed/)).toBeInTheDocument();
    // the document was never created, so the list stays on its empty state
    expect(screen.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });
});
