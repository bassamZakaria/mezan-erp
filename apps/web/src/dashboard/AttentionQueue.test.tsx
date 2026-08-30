// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../data/test-support";
import { AttentionQueue, type AttentionItem } from "./AttentionQueue";

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "a1",
    kind: "overdue",
    tone: "danger",
    title: "فواتير متأخرة",
    detail: "3 فواتير بقيمة 4,500 ج.م",
    actionLabel: "عرض",
    onAction: vi.fn(),
    ...overrides,
  };
}

describe("AttentionQueue", () => {
  it("renders an empty list with nothing when there are no items", () => {
    const { container } = renderWithProviders(<AttentionQueue items={[]} />);
    expect(container.querySelector("ul")?.children.length).toBe(0);
  });

  it("renders every item's title, detail and action label", () => {
    const items = [
      item(),
      item({ key: "a2", kind: "tax", tone: "warning", title: "ضريبة مستحقة", detail: "1,200 ج.م مستحقة", actionLabel: "دفع" }),
    ];
    renderWithProviders(<AttentionQueue items={items} />);
    expect(screen.getByText("فواتير متأخرة")).toBeInTheDocument();
    expect(screen.getByText("ضريبة مستحقة")).toBeInTheDocument();
    expect(screen.getByText("3 فواتير بقيمة 4,500 ج.م")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "دفع" })).toBeInTheDocument();
  });

  it("navigates by calling the item's onAction when its button is clicked", () => {
    const onAction = vi.fn();
    renderWithProviders(<AttentionQueue items={[item({ onAction })]} />);
    fireEvent.click(screen.getByRole("button", { name: "عرض" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("does not fire a different row's action when one row's button is clicked", () => {
    const onActionA = vi.fn();
    const onActionB = vi.fn();
    renderWithProviders(
      <AttentionQueue
        items={[
          item({ key: "a1", actionLabel: "عرض أ", onAction: onActionA }),
          item({ key: "a2", actionLabel: "عرض ب", onAction: onActionB }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "عرض ب" }));
    expect(onActionB).toHaveBeenCalledTimes(1);
    expect(onActionA).not.toHaveBeenCalled();
  });
});
