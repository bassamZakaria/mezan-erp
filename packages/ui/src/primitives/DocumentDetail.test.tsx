// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentDetail } from "./DocumentDetail";

function renderDetail(overrides: Partial<ComponentProps<typeof DocumentDetail>> = {}) {
  return render(
    <DocumentDetail
      title={<span>فاتورة مبيعات INV-000123</span>}
      statusLabel="مؤكد"
      statusTone="success"
      summary={[
        { label: "الإجمالي", value: "1,150.00" },
        { label: "المتبقي", value: "450.00", valueTone: "danger" },
      ]}
      effects={[<span key="1">تم خصم الكمية من مستودع الفرع الرئيسي</span>]}
      tabs={[
        { key: "lines", label: "بنود الفاتورة", content: <div>محتوى البنود</div> },
        { key: "je", label: "القيود المحاسبية", content: <div>محتوى القيود</div> },
      ]}
      {...overrides}
    />,
  );
}

describe("DocumentDetail", () => {
  it("renders title, status, and summary values", () => {
    renderDetail();
    expect(screen.getByText("فاتورة مبيعات INV-000123")).toBeInTheDocument();
    expect(screen.getByText("مؤكد")).toBeInTheDocument();
    expect(screen.getByText("1,150.00")).toBeInTheDocument();
  });

  it("renders the effects panel with 'تأثيرات هذا المستند' as its default title", () => {
    renderDetail();
    expect(screen.getByText("تأثيرات هذا المستند")).toBeInTheDocument();
    expect(screen.getByText("تم خصم الكمية من مستودع الفرع الرئيسي")).toBeInTheDocument();
  });

  it("renders correctly against a dark theme root", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    renderDetail();
    expect(screen.getByText("تأثيرات هذا المستند")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });

  it("shows the first tab's content by default and switches on click", () => {
    renderDetail();
    expect(screen.getByText("محتوى البنود")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(screen.getByText("محتوى القيود")).toBeVisible();
  });

  it("supports a controlled active tab via onTabChange", () => {
    const onTabChange = vi.fn();
    renderDetail({ activeTabKey: "lines", onTabChange });
    fireEvent.click(screen.getByRole("tab", { name: "القيود المحاسبية" }));
    expect(onTabChange).toHaveBeenCalledWith("je");
  });

  it("renders the aside slot when provided", () => {
    renderDetail({ aside: <div>لوحة جانبية</div> });
    expect(screen.getByText("لوحة جانبية")).toBeInTheDocument();
  });
});
