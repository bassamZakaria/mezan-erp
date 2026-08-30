// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppliedFilters, ListViews } from "./ListViews";

describe("ListViews", () => {
  it("renders a tablist with an accessible name, defaulting to the ui translation", () => {
    render(
      <ListViews
        views={[{ key: "all", label: "الكل", count: 3 }]}
        activeKey="all"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tablist", { name: "العرض" })).toBeInTheDocument();
  });

  it("accepts a caller-supplied aria-label", () => {
    render(
      <ListViews
        views={[{ key: "all", label: "الكل", count: 3 }]}
        activeKey="all"
        onChange={() => {}}
        aria-label="طرق العرض"
      />,
    );
    expect(screen.getByRole("tablist", { name: "طرق العرض" })).toBeInTheDocument();
  });

  it("hides a view whose count is exactly zero", () => {
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "drafts", label: "مسودات", count: 0 },
        ]}
        activeKey="all"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole("tab", { name: /مسودات/ })).not.toBeInTheDocument();
  });

  it("keeps a zero-count view visible when it is the active selection", () => {
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "drafts", label: "مسودات", count: 0 },
        ]}
        activeKey="drafts"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /مسودات/ })).toBeInTheDocument();
  });

  it("keeps a zero-count view visible when alwaysShow is set", () => {
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "drafts", label: "مسودات", count: 0, alwaysShow: true },
        ]}
        activeKey="all"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /مسودات/ })).toBeInTheDocument();
  });

  it("renders honestly with zero rows: nothing at all when every view would be hidden", () => {
    const { container } = render(
      <ListViews views={[{ key: "drafts", label: "مسودات", count: 0 }]} activeKey="all" onChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the active tab aria-selected and the rest false", () => {
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "confirmed", label: "مؤكد", count: 1 },
        ]}
        activeKey="confirmed"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /الكل/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /مؤكد/ })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onChange with the clicked view's key", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "confirmed", label: "مؤكد", count: 1 },
        ]}
        activeKey="all"
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /مؤكد/ }));
    expect(onChange).toHaveBeenCalledWith("confirmed");
  });

  it("reaches a tab by Tab and activates it with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ListViews
        views={[
          { key: "all", label: "الكل", count: 3 },
          { key: "confirmed", label: "مؤكد", count: 1 },
        ]}
        activeKey="all"
        onChange={onChange}
      />,
    );
    await user.tab();
    expect(screen.getByRole("tab", { name: /الكل/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tab", { name: /مؤكد/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("confirmed");
  });

  it("activates the focused tab with Space too", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ListViews views={[{ key: "confirmed", label: "مؤكد", count: 1 }]} activeKey="all" onChange={onChange} />,
    );
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith("confirmed");
  });

  it("renders the count badge and an optional description", () => {
    render(
      <ListViews
        views={[{ key: "all", label: "الكل", count: 12, description: "كل الفواتير" }]}
        activeKey="all"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("كل الفواتير")).toBeInTheDocument();
  });
});

describe("AppliedFilters", () => {
  it("renders nothing when there are no filters", () => {
    const { container } = render(<AppliedFilters filters={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each filter's label with a remove control labelled in Arabic", () => {
    render(<AppliedFilters filters={[{ key: "status", label: "مؤكد", onRemove: () => {} }]} />);
    expect(screen.getByText("مؤكد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إزالة مؤكد" })).toBeInTheDocument();
  });

  it("calls onRemove for the clicked filter only", async () => {
    const user = userEvent.setup();
    const removeA = vi.fn();
    const removeB = vi.fn();
    render(
      <AppliedFilters
        filters={[
          { key: "a", label: "مؤكد", onRemove: removeA },
          { key: "b", label: "مسودة", onRemove: removeB },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "إزالة مسودة" }));
    expect(removeB).toHaveBeenCalledOnce();
    expect(removeA).not.toHaveBeenCalled();
  });

  it("does not render 'clear all' with a single filter even when onClearAll is given", () => {
    render(<AppliedFilters filters={[{ key: "a", label: "مؤكد", onRemove: () => {} }]} onClearAll={() => {}} />);
    expect(screen.queryByText("مسح الكل")).not.toBeInTheDocument();
  });

  it("renders 'clear all' with more than one filter and calls onClearAll", async () => {
    const user = userEvent.setup();
    const onClearAll = vi.fn();
    render(
      <AppliedFilters
        filters={[
          { key: "a", label: "مؤكد", onRemove: () => {} },
          { key: "b", label: "مسودة", onRemove: () => {} },
        ]}
        onClearAll={onClearAll}
      />,
    );
    await user.click(screen.getByText("مسح الكل"));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("does not render 'clear all' with more than one filter when onClearAll is not given", () => {
    render(
      <AppliedFilters
        filters={[
          { key: "a", label: "مؤكد", onRemove: () => {} },
          { key: "b", label: "مسودة", onRemove: () => {} },
        ]}
      />,
    );
    expect(screen.queryByText("مسح الكل")).not.toBeInTheDocument();
  });
});
