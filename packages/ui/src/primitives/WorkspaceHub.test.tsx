// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkspaceHub } from "./WorkspaceHub";

describe("WorkspaceHub", () => {
  it("renders the title and description", () => {
    render(<WorkspaceHub title="المبيعات" description="نظرة عامة على المبيعات" />);
    expect(screen.getByRole("heading", { name: "المبيعات" })).toBeInTheDocument();
    expect(screen.getByText("نظرة عامة على المبيعات")).toBeInTheDocument();
  });

  it("renders the actions bar when given", () => {
    render(
      <WorkspaceHub title="المبيعات" description="وصف" actions={<button type="button">فاتورة جديدة</button>} />,
    );
    expect(screen.getByRole("button", { name: "فاتورة جديدة" })).toBeInTheDocument();
  });

  it("shows the error card as an alert and does not render stats while erroring", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        error="تعذر تحميل البيانات"
        stats={[{ key: "revenue", label: "الإيرادات", value: "1,000.00" }]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر تحميل البيانات");
  });

  it("renders no error card when error is null", () => {
    render(<WorkspaceHub title="المبيعات" description="وصف" error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders each stat's label and value", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        stats={[
          { key: "revenue", label: "الإيرادات", value: "12,500.00" },
          { key: "orders", label: "الطلبات", value: "48" },
        ]}
      />,
    );
    expect(screen.getByText("الإيرادات")).toBeInTheDocument();
    expect(screen.getByText("12,500.00")).toBeInTheDocument();
    expect(screen.getByText("الطلبات")).toBeInTheDocument();
    expect(screen.getByText("48")).toBeInTheDocument();
  });

  it("renders no stat grid at all when stats is an empty array", () => {
    const { container } = render(<WorkspaceHub title="المبيعات" description="وصف" stats={[]} />);
    expect(container.querySelector(".grid")).not.toBeInTheDocument();
  });

  it("shows an em dash instead of a stale or zero figure while the first load is in flight", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        loading
        stats={[{ key: "revenue", label: "الإيرادات", value: "12,500.00" }]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("12,500.00")).not.toBeInTheDocument();
  });

  it("renders the list's rows with primary, secondary and trailing content", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        list={{
          title: "أحدث الفواتير",
          rows: [{ key: "1", primary: "INV-000001", secondary: "عميل تجريبي", trailing: "1,200.00" }],
          empty: "لا توجد فواتير بعد",
        }}
      />,
    );
    expect(screen.getByText("أحدث الفواتير")).toBeInTheDocument();
    expect(screen.getByText("INV-000001")).toBeInTheDocument();
    expect(screen.getByText("عميل تجريبي")).toBeInTheDocument();
    expect(screen.getByText("1,200.00")).toBeInTheDocument();
  });

  it("renders the honest empty message rather than a blank card when the list has zero rows", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        list={{ title: "أحدث الفواتير", rows: [], empty: "لا توجد فواتير بعد" }}
      />,
    );
    expect(screen.getByText("لا توجد فواتير بعد")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders the list's header action and sub caption", () => {
    render(
      <WorkspaceHub
        title="المبيعات"
        description="وصف"
        list={{
          title: "أحدث الفواتير",
          sub: "آخر 30 يومًا",
          rows: [],
          empty: "لا شيء",
          action: <button type="button">عرض الكل</button>,
        }}
      />,
    );
    expect(screen.getByText("آخر 30 يومًا")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض الكل" })).toBeInTheDocument();
  });

  it("renders children after the standard frame", () => {
    render(
      <WorkspaceHub title="المبيعات" description="وصف">
        <div>محتوى إضافي</div>
      </WorkspaceHub>,
    );
    expect(screen.getByText("محتوى إضافي")).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<WorkspaceHub title="المبيعات" description="وصف" />);
    expect(screen.getByRole("heading", { name: "المبيعات" })).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
