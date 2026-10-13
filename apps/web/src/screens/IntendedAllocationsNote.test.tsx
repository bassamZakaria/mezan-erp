// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { IntendedAllocationsNote } from "./IntendedAllocationsNote";
import { renderWithProviders, testAdminSession } from "../data/test-support";

const invoices = [{ id: "INV-ID-1", invoiceNo: "INV-000123" }];

function renderNote(status: string, heldAllocations: { allocationId: string; invoiceId: string; amount: string | null }[] | undefined) {
  return renderWithProviders(<IntendedAllocationsNote voucher={{ status, heldAllocations }} invoices={invoices} />, { initialSession: testAdminSession });
}

describe("what confirming a draft collection will settle", () => {
  it("names the invoice by its number and the amount, on a draft", () => {
    renderNote("draft", [{ allocationId: "V-1:A1", invoiceId: "INV-ID-1", amount: "100.000000" }]);

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("عند تأكيد هذا السند سيُخصَّص على الفواتير التالية");
    expect(note).toHaveTextContent("INV-000123");
    expect(note).toHaveTextContent("100.00");
  });

  it("says the remainder of the voucher when no amount was named, and keeps showing while the voucher waits for approval", () => {
    renderNote("pending", [{ allocationId: "V-1:A1", invoiceId: "INV-ID-1", amount: null }]);

    expect(screen.getByRole("note")).toHaveTextContent("INV-000123 — كامل المتبقي من السند");
  });

  it("falls back to the invoice's id when the open-invoice list does not hold it", () => {
    renderNote("draft", [{ allocationId: "V-1:A1", invoiceId: "INV-GONE", amount: "5.000000" }]);

    expect(screen.getByRole("note")).toHaveTextContent("INV-GONE");
  });

  it.each([
    ["a confirmed voucher", "confirmed", [{ allocationId: "V-1:A1", invoiceId: "INV-ID-1", amount: "100.000000" }]],
    ["a draft that names no invoice", "draft", []],
    ["a draft from before the field existed", "draft", undefined],
  ] as const)("shows nothing on %s", (_name, status, held) => {
    renderNote(status, held as never);

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
