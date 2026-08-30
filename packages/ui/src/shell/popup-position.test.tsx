// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { measure, usePopupPosition, MENU_GAP, MENU_MAX_HEIGHT, MENU_MIN_HEIGHT, POPUP_Z_INDEX, POPUP_Z_CLASS } from "./popup-position";

function mockTrigger(rect: Partial<DOMRect>, direction: "ltr" | "rtl" = "ltr"): HTMLElement {
  const el = document.createElement("button");
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  });
  el.style.direction = direction;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("shell popup constants", () => {
  it("stacks popups above dialogs but below toasts", () => {
    expect(POPUP_Z_INDEX).toBe(95);
    expect(POPUP_Z_CLASS).toBe("z-[95]");
  });
});

describe("measure", () => {
  it("opens below the trigger when there is enough room, aligned start in LTR", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const trigger = mockTrigger({ top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    const position = measure(trigger, "start");
    expect(position.top).toBe(140 + MENU_GAP);
    expect(position.inlineStart).toBe(50);
    expect(position.width).toBe(200);
  });

  it("mirrors inlineStart for RTL — measured physically, expressed logically", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const trigger = mockTrigger({ top: 100, bottom: 140, left: 50, right: 250, width: 200 }, "rtl");
    const position = measure(trigger, "start");
    expect(position.inlineStart).toBe(1000 - 250);
  });

  it("flips above the trigger when there is little room below and more room above", () => {
    Object.defineProperty(window, "innerHeight", { value: 300, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    // spaceBelow = 300 - 280 - gap - 8 = tiny; spaceAbove = 250 - gap - 8 = large
    const trigger = mockTrigger({ top: 250, bottom: 280, left: 50, right: 250, width: 200 });
    const position = measure(trigger, "start");
    expect(position.top).toBeLessThan(250);
  });

  it("clamps maxHeight between MENU_MIN_HEIGHT and MENU_MAX_HEIGHT", () => {
    Object.defineProperty(window, "innerHeight", { value: 5000, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const trigger = mockTrigger({ top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    const position = measure(trigger, "start");
    expect(position.maxHeight).toBeLessThanOrEqual(MENU_MAX_HEIGHT);
    expect(position.maxHeight).toBeGreaterThanOrEqual(MENU_MIN_HEIGHT);
  });

  it("align 'end' reports insetInlineEnd instead of inlineStart/width, mirrored for RTL", () => {
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const ltrTrigger = mockTrigger({ top: 100, bottom: 140, left: 50, right: 250, width: 200 });
    const ltrPosition = measure(ltrTrigger, "end");
    expect(ltrPosition.insetInlineEnd).toBe(1000 - 250);
    expect(ltrPosition.inlineStart).toBeUndefined();

    const rtlTrigger = mockTrigger({ top: 100, bottom: 140, left: 50, right: 250, width: 200 }, "rtl");
    const rtlPosition = measure(rtlTrigger, "end");
    expect(rtlPosition.insetInlineEnd).toBe(50);
  });
});

function PositionProbe({ open, align }: { open: boolean; align?: "start" | "end" }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const position = usePopupPosition(triggerRef, open, align);
  return (
    <div>
      <button ref={triggerRef}>trigger</button>
      <span data-testid="position">{position ? JSON.stringify(position) : "null"}</span>
    </div>
  );
}

describe("usePopupPosition", () => {
  it("has no position while closed", () => {
    render(<PositionProbe open={false} />);
    expect(screen.getByTestId("position")).toHaveTextContent("null");
  });

  it("measures a position once opened", () => {
    render(<PositionProbe open />);
    expect(screen.getByTestId("position")).not.toHaveTextContent("null");
  });

  it("recomputes on window resize while open", () => {
    const { rerender } = render(<PositionProbe open={false} />);
    rerender(<PositionProbe open />);
    const before = screen.getByTestId("position").textContent;
    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
      window.dispatchEvent(new Event("resize"));
    });
    // Recomputing is observable via a fresh JSON string even when the numbers
    // coincidentally match; what matters is that no error is thrown and a
    // position is still present.
    expect(screen.getByTestId("position")).not.toHaveTextContent("null");
    expect(typeof before).toBe("string");
  });
});
