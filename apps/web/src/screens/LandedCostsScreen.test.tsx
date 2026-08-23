// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandedCostsScreen } from "./LandedCostsScreen";

describe.each(["light", "dark"] as const)("LandedCostsScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  function renderScreen() {
    document.documentElement.setAttribute("data-theme", theme);
    return render(<LandedCostsScreen />);
  }

  it("starts empty and shows the documented empty state", () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "التكاليف الإضافية" })).toBeInTheDocument();
    expect(screen.getByText("أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات")).toBeInTheDocument();
  });

  it("distributes a single shipping cost over one target line by the real distributeLandedCost math (BY_VALUE)", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مستند تكلفة جديد" }));

    await user.clear(screen.getByLabelText("المبلغ"));
    await user.type(screen.getByLabelText("المبلغ"), "200");
    // the default target line is qty 10 @ unit cost 150.00 (أرز أبيض مصري) — a single
    // target absorbs the whole 200.00 regardless of BY_VALUE/BY_QUANTITY weighting.
    expect(screen.getByText(/إجمالي التكلفة:/)).toHaveTextContent("200.00");

    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد التوزيع" }));

    await screen.findByText("LC-000001");
    const row = screen.getByText("LC-000001").closest("tr") as HTMLElement;
    expect(within(row).getByText("200.00")).toBeInTheDocument();
    expect(within(row).getByText("مؤكد")).toBeInTheDocument();
    expect(within(row).getByText("حسب القيمة")).toBeInTheDocument();

    // open the detail panel and check the new landed unit cost: 150 + 200/10 = 170.00
    await user.click(screen.getByText("LC-000001"));
    expect(await screen.findByText(/تكلفة جديدة/)).toHaveTextContent("170.00");
  });

  it("filters the list by status chip", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مستند تكلفة جديد" }));
    await user.clear(screen.getByLabelText("المبلغ"));
    await user.type(screen.getByLabelText("المبلغ"), "50");
    // "حفظ" only (no confirm) leaves the document in draft
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    // a document saved without confirming has no docNo yet — the list shows "مسودة" in its place
    await screen.findByText("50.00");
    await user.click(screen.getByRole("tab", { name: /^مسودة/ }));
    expect(screen.getByText("50.00")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /^مؤكد/ }));
    expect(screen.queryByText("50.00")).not.toBeInTheDocument();
  });

  it("confirms a draft document from its detail panel", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "مستند تكلفة جديد" }));
    await user.clear(screen.getByLabelText("المبلغ"));
    await user.type(screen.getByLabelText("المبلغ"), "80");
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    await screen.findByText("80.00");

    const draftRow = screen.getByText("80.00").closest("tr") as HTMLElement;
    expect(draftRow.textContent).toContain("مسودة");
    await user.click(draftRow);
    await user.click(await screen.findByRole("button", { name: "تأكيد التوزيع" }));

    // once confirmed the document is numbered and the row's status flips to مؤكد
    // (the still-open detail panel's own heading also reads "LC-000001")
    await waitFor(() => expect(screen.getAllByText("LC-000001").length).toBeGreaterThan(0));
    const confirmedRow = screen.getByText("LC-000001", { selector: "span" }).closest("tr") as HTMLElement;
    expect(within(confirmedRow).getByText("مؤكد")).toBeInTheDocument();
  });
});
