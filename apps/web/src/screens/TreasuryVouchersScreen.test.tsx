// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TreasuryVouchersScreen } from "./TreasuryVouchersScreen";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

function setMoney(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("TreasuryVouchersScreen — list", () => {
  it("renders the seeded vouchers and type-breakdown chips", () => {
    render(<TreasuryVouchersScreen />);
    expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument();
    expect(screen.getByText("CV-000001")).toBeInTheDocument();
    expect(screen.getByText("CV-000004")).toBeInTheDocument();
    // Type-breakdown quick-filter chip for the collection type.
    expect(screen.getByRole("button", { name: /تحصيل من عميل/ })).toBeInTheDocument();
  });

  it("filters to vouchers that still need allocation", () => {
    render(<TreasuryVouchersScreen />);
    fireEvent.click(screen.getByRole("tab", { name: /بحاجة لتخصيص/ }));
    // CV-000001 (1000, only 400 allocated) needs allocation and stays visible.
    expect(screen.getByText("CV-000001")).toBeInTheDocument();
    // CV-000002 (other income, not allocatable) is filtered out.
    expect(screen.queryByText("CV-000002")).not.toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — create + confirm", () => {
  it("creates and confirms a customer collection, adding a CV- numbered row", async () => {
    render(<TreasuryVouchersScreen />);
    fireEvent.click(screen.getByRole("button", { name: "سند جديد" }));

    // Step 1: pick the type.
    fireEvent.click(screen.getByText("تحصيل من عميل"));

    // Step 2: fill the form.
    setMoney(screen.getByLabelText("المبلغ"), "300");
    const partyInput = screen.getByPlaceholderText("ابحث عن عميل…");
    fireEvent.focus(partyInput);
    fireEvent.mouseDown(screen.getByText("شركة الأمل للتجارة"));

    fireEvent.click(screen.getByRole("button", { name: "إنشاء وتأكيد" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "السندات النقدية" })).toBeInTheDocument());
    // Continues the sequence from CV-000004 → CV-000005.
    expect(await screen.findByText("CV-000005")).toBeInTheDocument();
  });
});

describe("TreasuryVouchersScreen — allocation", () => {
  it("allocates part of a collection to an open invoice and reverses it", async () => {
    render(<TreasuryVouchersScreen />);
    fireEvent.click(screen.getByText("CV-000001"));

    // Open the allocation tab (seeded with one allocation to INV-000001).
    fireEvent.click(screen.getByRole("tab", { name: /تخصيص على الفواتير/ }));
    expect(screen.getByText("INV-000001")).toBeInTheDocument();

    // Allocate 200 more to INV-000002.
    fireEvent.change(screen.getByLabelText("الفاتورة"), { target: { value: "inv-2" } });
    setMoney(screen.getByLabelText("مبلغ التخصيص"), "200");
    fireEvent.click(screen.getByRole("button", { name: "تخصيص" }));

    expect(await screen.findByText("INV-000002")).toBeInTheDocument();
    // 1000 − 400 − 200 = 400 still unallocated → still needs allocation.
    expect(screen.getByText("بحاجة لتخصيص")).toBeInTheDocument();

    // Reverse the first (seeded) allocation → INV-000001 leaves the active list.
    const reverseButtons = screen.getAllByRole("button", { name: "عكس التخصيص" });
    fireEvent.click(reverseButtons[0]!);
    await waitFor(() => expect(screen.queryByText("INV-000001")).not.toBeInTheDocument());
  });
});
