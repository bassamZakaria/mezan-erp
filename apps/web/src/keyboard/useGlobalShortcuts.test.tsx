// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { LIST_NAV_EVENT } from "@mezan/ui";
import { useGlobalShortcuts, type GlobalShortcutsOptions } from "./useGlobalShortcuts";

function makeVisible<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, "offsetParent", { get: () => document.body, configurable: true });
  return el;
}

/**
 * Dispatches from the currently focused element (falling back to `document`)
 * so `event.target` is what a real key press would carry — the listener
 * itself is on `document`, but `isTypingTarget(event.target)` reads the
 * ORIGINATING element, and a dispatch straight on `document` would always
 * report `document` as the target, silently defeating the typing-guard tests.
 */
function fire(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
  target.dispatchEvent(event);
  return event;
}

function baseOptions(overrides: Partial<GlobalShortcutsOptions> = {}): GlobalShortcutsOptions {
  return {
    navGroups: [],
    onCreate: vi.fn(),
    onShowHelp: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useGlobalShortcuts", () => {
  it("Cmd/Ctrl+N calls onCreate and prevents the default browser action", () => {
    const onCreate = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onCreate })));
    const event = fire({ key: "n", metaKey: true });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("Cmd/Ctrl+S submits the visible document form but does not call onCreate", () => {
    const form = makeVisible(document.createElement("form"));
    document.body.appendChild(form);
    const submitSpy = vi.fn();
    form.requestSubmit = submitSpy;
    const onCreate = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onCreate })));
    fire({ key: "s", metaKey: true });
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("'?' calls onShowHelp", () => {
    const onShowHelp = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onShowHelp })));
    fire({ key: "?" });
    expect(onShowHelp).toHaveBeenCalledTimes(1);
  });

  it("'/' focuses the found search input and marks it", () => {
    const main = document.createElement("main");
    const input = makeVisible(document.createElement("input"));
    input.type = "text";
    main.appendChild(input);
    document.body.appendChild(main);
    renderHook(() => useGlobalShortcuts(baseOptions()));
    fire({ key: "/" });
    expect(document.activeElement).toBe(input);
    expect(input.dataset.mzSearchFocused).toBe("true");
  });

  it("'g' then a matching letter navigates via the module jump's go()", () => {
    const go = vi.fn();
    renderHook(() =>
      useGlobalShortcuts(
        baseOptions({
          navGroups: [{ key: "sales", label: "المبيعات", items: [{ key: "i1", label: "الفواتير", onClick: go }] } as never],
        }),
      ),
    );
    fire({ key: "g" });
    fire({ key: "s" });
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("'g' then an unmatched letter does nothing further", () => {
    const go = vi.fn();
    renderHook(() =>
      useGlobalShortcuts(
        baseOptions({
          navGroups: [{ key: "sales", label: "المبيعات", items: [{ key: "i1", label: "الفواتير", onClick: go }] } as never],
        }),
      ),
    );
    fire({ key: "g" });
    fire({ key: "z" });
    expect(go).not.toHaveBeenCalled();
  });

  it("the 'g' chord expires after the timeout, so a late letter no longer jumps", () => {
    vi.useFakeTimers();
    const go = vi.fn();
    renderHook(() =>
      useGlobalShortcuts(
        baseOptions({
          navGroups: [{ key: "sales", label: "المبيعات", items: [{ key: "i1", label: "الفواتير", onClick: go }] } as never],
        }),
      ),
    );
    fire({ key: "g" });
    vi.advanceTimersByTime(1100);
    fire({ key: "s" });
    expect(go).not.toHaveBeenCalled();
  });

  it("'j' and 'k' emit list-nav events with 'next'/'prev'", () => {
    renderHook(() => useGlobalShortcuts(baseOptions()));
    const seen: string[] = [];
    window.addEventListener(LIST_NAV_EVENT, (e) => seen.push((e as CustomEvent<{ action: string }>).detail.action));
    fire({ key: "j" });
    fire({ key: "k" });
    expect(seen).toEqual(["next", "prev"]);
  });

  it("Escape with a dialog/listbox/menu open does NOT call onBack — the overlay owns it", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const onBack = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onBack })));
    fire({ key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("Escape un-focuses a marked search input instead of calling onBack", () => {
    const input = makeVisible(document.createElement("input"));
    input.type = "text";
    input.dataset.mzSearchFocused = "true";
    document.body.appendChild(input);
    input.focus();
    const onBack = vi.fn();
    const blurSpy = vi.spyOn(input, "blur");
    renderHook(() => useGlobalShortcuts(baseOptions({ onBack })));
    fire({ key: "Escape" });
    expect(blurSpy).toHaveBeenCalledTimes(1);
    expect(input.dataset.mzSearchFocused).toBeUndefined();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("Escape otherwise calls onBack — the keyboard twin of «رجوع»", () => {
    const onBack = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onBack })));
    fire({ key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("a shortcut does not fire while a text field has focus: bare '/', 'g', 'j', 'k', '?' are all ignored", () => {
    const input = makeVisible(document.createElement("input"));
    input.type = "text";
    document.body.appendChild(input);
    input.focus();

    const onShowHelp = vi.fn();
    const seen: string[] = [];
    window.addEventListener(LIST_NAV_EVENT, (e) => seen.push((e as CustomEvent<{ action: string }>).detail.action));
    renderHook(() => useGlobalShortcuts(baseOptions({ onShowHelp })));

    fire({ key: "/" });
    fire({ key: "g" });
    fire({ key: "j" });
    fire({ key: "k" });
    fire({ key: "?" });

    expect(onShowHelp).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    // The field keeps its own focus — the shortcut never stole it.
    expect(document.activeElement).toBe(input);
  });

  it("modifier combos (unlike bare letters) still act while a text field has focus", () => {
    const input = makeVisible(document.createElement("input"));
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    const onCreate = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onCreate })));
    fire({ key: "n", metaKey: true });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("Escape while a PLAIN (non-search) text field has focus is left to the field's own undo, not onBack", () => {
    const input = makeVisible(document.createElement("input"));
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    const onBack = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onBack })));
    fire({ key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("disabled:true suspends every shortcut", () => {
    const onCreate = vi.fn();
    const onShowHelp = vi.fn();
    renderHook(() => useGlobalShortcuts(baseOptions({ onCreate, onShowHelp, disabled: true })));
    fire({ key: "n", metaKey: true });
    fire({ key: "?" });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onShowHelp).not.toHaveBeenCalled();
  });

  it("removes its keydown listener on unmount", () => {
    const onShowHelp = vi.fn();
    const { unmount } = renderHook(() => useGlobalShortcuts(baseOptions({ onShowHelp })));
    unmount();
    fire({ key: "?" });
    expect(onShowHelp).not.toHaveBeenCalled();
  });

  it("returns the derived moduleJumps for the caller (e.g. the shortcuts overlay) to render", () => {
    const { result } = renderHook(() =>
      useGlobalShortcuts(
        baseOptions({
          navGroups: [{ key: "sales", label: "المبيعات", items: [{ key: "i1", label: "الفواتير", onClick: vi.fn() }] } as never],
        }),
      ),
    );
    expect(result.current.moduleJumps.length).toBe(1);
    expect(result.current.moduleJumps[0]?.label).toBe("المبيعات");
  });
});
