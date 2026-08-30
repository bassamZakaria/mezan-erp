// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportChart } from "./ReportChart";

const POINTS = [
  { key: "sales", label: "المبيعات", value: 1250.5 },
  { key: "returns", label: "المرتجعات", value: -300.25 },
];

describe("ReportChart", () => {
  it("renders nothing for an empty point list", () => {
    const { container } = render(<ReportChart title="تقرير" points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the title and defaults to the bar view", () => {
    render(<ReportChart title="أداء المبيعات" points={POINTS} />);
    expect(screen.getByText("أداء المبيعات")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أعمدة" })).toHaveAttribute("aria-pressed", "true");
  });

  it("formats money through the format helper, grouped with two decimals, never a raw scaled string", () => {
    render(<ReportChart title="تقرير" points={POINTS} />);
    expect(screen.getByText("1,250.50")).toBeInTheDocument();
    expect(screen.getByText("-300.25")).toBeInTheDocument();
    expect(screen.queryByText(/000000/)).not.toBeInTheDocument();
  });

  it("switches to the table view and lists each point's percentage of the total", async () => {
    const user = userEvent.setup();
    render(<ReportChart title="تقرير" points={POINTS} />);
    await user.click(screen.getByRole("button", { name: "جدول" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("المبيعات")).toBeInTheDocument();
  });

  it("switches to the pie view", async () => {
    const user = userEvent.setup();
    render(<ReportChart title="تقرير" points={POINTS} />);
    await user.click(screen.getByRole("button", { name: "دائري" }));
    expect(screen.getByRole("button", { name: "دائري" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the body entirely in the hidden view while keeping the toggle bar", async () => {
    const user = userEvent.setup();
    render(<ReportChart title="تقرير" points={POINTS} />);
    await user.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(screen.queryByText("المبيعات")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إخفاء" })).toHaveAttribute("aria-pressed", "true");
  });

  it("honours a defaultView other than bar", () => {
    render(<ReportChart title="تقرير" points={POINTS} defaultView="table" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("reaches each view toggle by Tab and Enter activates it", async () => {
    const user = userEvent.setup();
    render(<ReportChart title="تقرير" points={POINTS} />);
    await user.tab();
    expect(screen.getByRole("button", { name: "أعمدة" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "دائري" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "دائري" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders the caption when given", () => {
    render(<ReportChart title="تقرير" points={POINTS} caption="القيم بالجنيه المصري" />);
    expect(screen.getByText("القيم بالجنيه المصري")).toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ReportChart title="تقرير" points={POINTS} />);
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
