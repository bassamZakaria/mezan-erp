// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PhysicalCountsScreen } from "./PhysicalCountsScreen";

describe("PhysicalCountsScreen — empty seeded state", () => {
  it("matches the catalog's real empty state (zero counts in the demo tenant)", () => {
    render(<PhysicalCountsScreen />);
    expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument();
    expect(
      screen.getByText("لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام"),
    ).toBeInTheDocument();
  });
});

describe("PhysicalCountsScreen — count → variance → adjustment flow", () => {
  it("starts a count, records a variance, completes it, and generates the reconciling adjustment", async () => {
    render(<PhysicalCountsScreen />);

    fireEvent.click(screen.getByRole("button", { name: "جرد جديد" }));
    expect(screen.getByRole("heading", { name: "جرد جديد" })).toBeInTheDocument();

    // Wait for the seeded stock-balance rollup to load (async) so the item count is non-zero.
    const addButton = screen.getByRole("button", { name: "إضافة" });
    await waitFor(() => expect(addButton).toBeEnabled());

    fireEvent.click(addButton);

    // Now on the count-entry grid for the newly started (IN_PROGRESS) count.
    await waitFor(() => expect(screen.getByRole("button", { name: "إنهاء الجرد" })).toBeInTheDocument());
    expect(screen.getByText("أرز أبيض مصري 5 كجم (ITM-000001)")).toBeInTheDocument();

    // itm-1's system qty at MAIN-WH is 90 (100 opening balance − 10 transferred to VAN-1) — count it short by 5.
    const countedInput = screen.getByLabelText("الكمية المعدودة لصنف أرز أبيض مصري 5 كجم (ITM-000001)");
    fireEvent.change(countedInput, { target: { value: "85" } });
    expect(screen.getByText("-5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء الجرد" }));

    // Completing routes back to the list — the new count now shows "مكتمل".
    await waitFor(() => expect(screen.getByRole("heading", { name: "الجرد الفعلي" })).toBeInTheDocument());
    const countNo = await screen.findByText("CNT-000001");
    fireEvent.click(countNo);

    // Detail view: generate the reconciling adjustment.
    expect(await screen.findByText("مكتمل")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "توليد تسوية" }));

    await screen.findByText("تم إنشاء التسوية");
    expect(screen.getByText("تم إنشاؤها")).toBeInTheDocument();
    // The OUT variance line (-5) for itm-1 is visible in the lines tab.
    expect(screen.getByText("-5.000000")).toBeInTheDocument();
  });
});
