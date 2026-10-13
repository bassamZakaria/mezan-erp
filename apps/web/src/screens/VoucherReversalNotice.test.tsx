// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { VoucherReversalNotice } from "./VoucherReversalNotice";

const render = (document: { reversesDocId?: string | null; reversedByDocId?: string | null }, opened: string[] = []) => {
  renderWithProviders(<VoucherReversalNotice document={document} onOpen={(id) => opened.push(id)} />, { transport: stubTransport({}), initialSession: testAdminSession });
  return opened;
};

describe("VoucherReversalNotice — a reversed voucher names the voucher that reversed it", () => {
  it("links a reversed voucher to its reversing voucher", () => {
    const opened = render({ reversedByDocId: "cv-1:rev", reversesDocId: null });
    expect(screen.getByRole("note")).toHaveTextContent("عُكس هذا السند");
    fireEvent.click(screen.getByRole("button", { name: "فتح السند العاكس" }));
    expect(opened).toEqual(["cv-1:rev"]);
  });

  it("links a reversing voucher back to the voucher it reverses", () => {
    const opened = render({ reversedByDocId: null, reversesDocId: "cv-1" });
    expect(screen.getByRole("note")).toHaveTextContent("هذا السند عكسٌ لسند سابق");
    fireEvent.click(screen.getByRole("button", { name: "فتح السند الأصلي" }));
    expect(opened).toEqual(["cv-1"]);
  });

  it("shows nothing on a voucher that neither reverses nor was reversed", () => {
    render({ reversedByDocId: null, reversesDocId: null });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
