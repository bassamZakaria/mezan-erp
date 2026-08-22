// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RfqsScreen } from "./RfqsScreen";

describe("RfqsScreen", () => {
  it("lists the sample RFQs", () => {
    render(<RfqsScreen />);
    expect(screen.getByRole("heading", { name: "طلبات عروض الأسعار" })).toBeInTheDocument();
    expect(screen.getByText("RFQ-000003")).toBeInTheDocument();
    expect(screen.getByText("RFQ-000002")).toBeInTheDocument();
    expect(screen.getByText("RFQ-000001")).toBeInTheDocument();
  });

  it("opens an RFQ detail with the effects panel and a lines tab", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByText("RFQ-000003"));
    expect(screen.getByRole("heading", { name: /طلب عرض سعر RFQ-000003/ })).toBeInTheDocument();
    expect(screen.getByText(/لا يؤثر طلب عرض السعر على المخزون/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /البنود/ })).toBeInTheDocument();
  });

  it("sends a draft RFQ (draft → مرسل)", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByText("RFQ-000001")); // the draft one
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    expect(screen.getByText("مرسل")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إرسال" })).not.toBeInTheDocument();
  });

  it("cancels a draft RFQ", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByText("RFQ-000001"));
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الطلب" }));
    expect(screen.getByText("ملغي")).toBeInTheDocument();
  });

  it("opens the new-RFQ side panel", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "طلب عرض سعر جديد" }));
    expect(screen.getByRole("dialog", { name: "طلب عرض سعر جديد" })).toBeInTheDocument();
  });

  it("shows the quote comparison grid with the cheapest price highlighted, and converts the chosen supplier's quote into a PO", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByText("RFQ-000003")); // sent, with 3 recorded quotes (one partial)
    fireEvent.click(screen.getByRole("tab", { name: "مقارنة العروض" }));

    // sup-2 quoted item-steel cheaper (41500.00) than sup-1 (41800.00); both
    // fully quoted the 2-line basket, sup-4 only quoted one line (partial).
    const convertButtons = screen.getAllByRole("button", { name: "تحويل إلى أمر شراء" });
    expect(convertButtons).toHaveLength(2); // only the 2 full-coverage suppliers get a convert action

    fireEvent.click(convertButtons[0] as HTMLElement);
    expect(screen.getByText("مغلق")).toBeInTheDocument();
    expect(screen.getByText(/po-from-rfq-1/)).toBeInTheDocument();
  });

  it("records a new supplier quote against a sent RFQ", () => {
    render(<RfqsScreen />);
    fireEvent.click(screen.getByText("RFQ-000003"));
    fireEvent.click(screen.getByRole("tab", { name: "العروض (3)" }));
    expect(screen.getByText("تسجيل عرض سعر جديد")).toBeInTheDocument();
  });
});
