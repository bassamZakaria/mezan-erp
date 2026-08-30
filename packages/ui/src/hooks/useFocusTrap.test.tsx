// @vitest-environment jsdom
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

/**
 * jsdom never runs layout, so `offsetParent` is always null — including on
 * elements that are genuinely visible. The trap treats a null `offsetParent`
 * as "not really on the page" (its whole reason for existing: excluding a
 * closed-but-mounted panel's controls from the Tab cycle), so a test that
 * wants an element counted as visible has to say so explicitly.
 */
function makeVisible(el: HTMLElement): void {
  Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
}

function makeHidden(el: HTMLElement): void {
  Object.defineProperty(el, "offsetParent", { value: null, configurable: true });
}

function Dialog({ active, onEscape, preventEscapeDefault }: { active: boolean; onEscape?: () => void; preventEscapeDefault?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap({ active, containerRef, onEscape, preventEscapeDefault });
  return (
    <div>
      <button>outside-before</button>
      <div ref={containerRef} data-testid="container">
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </div>
      <button>outside-after</button>
    </div>
  );
}

function renderVisibleDialog(props: { active: boolean; onEscape?: () => void; preventEscapeDefault?: boolean }) {
  const result = render(<Dialog {...props} />);
  makeVisible(screen.getByText("first"));
  makeVisible(screen.getByText("middle"));
  makeVisible(screen.getByText("last"));
  return result;
}

describe("useFocusTrap", () => {
  it("wraps Tab from the last focusable element back to the first", () => {
    renderVisibleDialog({ active: true });
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps Shift+Tab from the first focusable element to the last", () => {
    renderVisibleDialog({ active: true });
    const first = screen.getByText("first");
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("does not intercept Tab away from a middle element", () => {
    renderVisibleDialog({ active: true });
    const middle = screen.getByText("middle");
    middle.focus();
    const event = fireEvent.keyDown(middle, { key: "Tab" });
    // Not prevented — the browser's own default Tab order proceeds.
    expect(event).toBe(true);
  });

  it("calls onEscape and does not preventDefault by default", () => {
    const onEscape = vi.fn();
    render(<Dialog active onEscape={onEscape} />);
    const result = fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("prevents the default Escape behaviour when preventEscapeDefault is set", () => {
    const onEscape = vi.fn();
    render(<Dialog active onEscape={onEscape} preventEscapeDefault />);
    const result = fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
    expect(result).toBe(false);
  });

  it("is inert while inactive — Tab does not wrap and Escape does not fire", () => {
    const onEscape = vi.fn();
    renderVisibleDialog({ active: false, onEscape });
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("excludes a focusable element with no visible layout (offsetParent null) from the Tab cycle", () => {
    function HiddenLast() {
      const containerRef = useRef<HTMLDivElement | null>(null);
      useFocusTrap({ active: true, containerRef });
      return (
        <div ref={containerRef} data-testid="container">
          <button>first</button>
          <button style={{ display: "none" }}>hidden-last</button>
        </div>
      );
    }
    render(<HiddenLast />);
    makeVisible(screen.getByText("first"));
    makeHidden(screen.getByText("hidden-last"));
    const first = screen.getByText("first");
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    // The hidden button has no offsetParent, so it is excluded and `first` is
    // both the first and last real focus target — Shift+Tab from it wraps
    // back to itself, not to the hidden control.
    expect(document.activeElement).toBe(first);
  });

  it("re-subscribes when active flips from false to true", () => {
    function Toggle() {
      const [active, setActive] = useState(false);
      const containerRef = useRef<HTMLDivElement | null>(null);
      useFocusTrap({ active, containerRef });
      return (
        <div>
          <button onClick={() => setActive(true)}>activate</button>
          <div ref={containerRef}>
            <button>first</button>
            <button>last</button>
          </div>
        </div>
      );
    }
    render(<Toggle />);
    makeVisible(screen.getByText("first"));
    makeVisible(screen.getByText("last"));
    fireEvent.click(screen.getByText("activate"));
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("first"));
  });
});
