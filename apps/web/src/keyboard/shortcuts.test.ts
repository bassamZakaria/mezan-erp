// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildModuleJumps, findDocumentForm, findSearchInput, isActivatableTarget, isTypingTarget } from "./shortcuts";
import type { NavGroup, NavItem } from "@mezan/ui";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * jsdom never computes layout, so `offsetParent` is always `null` — the
 * `isHidden` visibility check in shortcuts.ts would treat every element as
 * hidden. Stub `offsetParent` to a truthy value for elements the test wants
 * treated as on-screen, mirroring how a real laid-out element behaves.
 */
function makeVisible<T extends HTMLElement>(el: T): T {
  Object.defineProperty(el, "offsetParent", { get: () => document.body, configurable: true });
  return el;
}

describe("isTypingTarget", () => {
  it("is true for a text input, a textarea, a select, and a contentEditable element", () => {
    const input = document.createElement("input");
    input.type = "text";
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    for (const el of [input, textarea, select, editable]) {
      expect(isTypingTarget(el)).toBe(true);
    }
  });

  it("is false for a button and a plain div", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });

  it("is false for non-text input types (checkbox, radio, range, etc.)", () => {
    for (const type of ["checkbox", "radio", "button", "submit", "range", "color"]) {
      const input = document.createElement("input");
      input.type = type;
      expect(isTypingTarget(input)).toBe(false);
    }
  });

  it("is true for a text input type not in the non-text set (email, search, ...)", () => {
    const input = document.createElement("input");
    input.type = "search";
    expect(isTypingTarget(input)).toBe(true);
  });

  it("is true for a plain element inside a role=textbox/combobox ancestor", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "combobox");
    const inner = document.createElement("span");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("is false for null / a non-HTMLElement target", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("isActivatableTarget", () => {
  it("is true inside a link, a button, and elements with an activatable role", () => {
    const link = document.createElement("a");
    link.href = "#";
    const span = document.createElement("span");
    link.appendChild(span);
    document.body.appendChild(link);
    expect(isActivatableTarget(span)).toBe(true);

    const button = document.createElement("button");
    const inner = document.createElement("span");
    button.appendChild(inner);
    expect(isActivatableTarget(inner)).toBe(true);

    for (const role of ["button", "option", "tab", "menuitem"]) {
      const el = document.createElement("div");
      el.setAttribute("role", role);
      expect(isActivatableTarget(el)).toBe(true);
    }
  });

  it("is false for a plain div with no activatable ancestor", () => {
    expect(isActivatableTarget(document.createElement("div"))).toBe(false);
  });
});

describe("findDocumentForm", () => {
  it("returns the form owning document.activeElement when it's visible", () => {
    const form = makeVisible(document.createElement("form"));
    const input = document.createElement("input");
    form.appendChild(input);
    document.body.appendChild(form);
    input.focus();
    expect(findDocumentForm()).toBe(form);
  });

  it("prefers a form inside an open dialog over the first form on the page", () => {
    const pageForm = makeVisible(document.createElement("form"));
    document.body.appendChild(pageForm);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const dialogForm = makeVisible(document.createElement("form"));
    dialog.appendChild(dialogForm);
    document.body.appendChild(dialog);
    expect(findDocumentForm()).toBe(dialogForm);
  });

  it("falls back to the first visible form when nothing is focused and no dialog is open", () => {
    const form1 = makeVisible(document.createElement("form"));
    const form2 = makeVisible(document.createElement("form"));
    document.body.appendChild(form1);
    document.body.appendChild(form2);
    expect(findDocumentForm()).toBe(form1);
  });

  it("skips a form hidden via aria-hidden or [hidden]", () => {
    const hiddenWrap = document.createElement("div");
    hiddenWrap.setAttribute("aria-hidden", "true");
    const hiddenForm = makeVisible(document.createElement("form"));
    hiddenWrap.appendChild(hiddenForm);
    document.body.appendChild(hiddenWrap);

    const visibleForm = makeVisible(document.createElement("form"));
    document.body.appendChild(visibleForm);

    expect(findDocumentForm()).toBe(visibleForm);
  });

  it("returns null when there are no forms on the page", () => {
    expect(findDocumentForm()).toBeNull();
  });
});

describe("findSearchInput", () => {
  it("prefers a [data-mz-search] input inside <main>", () => {
    const main = document.createElement("main");
    const marked = makeVisible(document.createElement("input"));
    marked.setAttribute("data-mz-search", "");
    main.appendChild(marked);
    const plain = makeVisible(document.createElement("input"));
    plain.type = "text";
    main.appendChild(plain);
    document.body.appendChild(main);
    expect(findSearchInput()).toBe(marked);
  });

  it("falls back to the first enabled text input inside <main> when none is explicitly marked", () => {
    const main = document.createElement("main");
    const disabled = makeVisible(document.createElement("input"));
    disabled.type = "text";
    disabled.disabled = true;
    main.appendChild(disabled);
    const enabled = makeVisible(document.createElement("input"));
    enabled.type = "text";
    main.appendChild(enabled);
    document.body.appendChild(main);
    expect(findSearchInput()).toBe(enabled);
  });

  it("skips a readOnly input and falls back to the command bar combobox", () => {
    const main = document.createElement("main");
    const readOnly = makeVisible(document.createElement("input"));
    readOnly.type = "text";
    readOnly.readOnly = true;
    main.appendChild(readOnly);
    document.body.appendChild(main);

    const commandBar = makeVisible(document.createElement("input"));
    commandBar.setAttribute("role", "combobox");
    document.body.appendChild(commandBar);

    expect(findSearchInput()).toBe(commandBar);
  });

  it("returns null when there is no search input and no command bar", () => {
    document.body.appendChild(document.createElement("main"));
    expect(findSearchInput()).toBeNull();
  });
});

describe("buildModuleJumps", () => {
  function item(key: string, label: string, onClick?: () => void): NavItem {
    return { key, label, onClick } as unknown as NavItem;
  }
  function group(key: string, label: string, items: NavItem[]): NavGroup {
    return { key, label, items } as unknown as NavGroup;
  }

  it("assigns one letter per group with a routable item, mnemonic to the group key where possible", () => {
    const jumps = buildModuleJumps([
      group("sales", "المبيعات", [item("i1", "الفواتير", vi.fn())]),
      group("purchases", "المشتريات", [item("i2", "أوامر الشراء", vi.fn())]),
    ]);
    expect(jumps.map((j) => j.letter).sort()).toEqual(["p", "s"]);
  });

  it("skips a group with no routable item (no item has onClick)", () => {
    const jumps = buildModuleJumps([group("empty", "فارغ", [item("i1", "بند", undefined)])]);
    expect(jumps).toEqual([]);
  });

  it("never assigns 'g' as a target letter, even for a group literally called 'g...'", () => {
    const jumps = buildModuleJumps([group("gadgets", "أدوات", [item("i1", "أداة", vi.fn())])]);
    expect(jumps.every((j) => j.letter !== "g")).toBe(true);
  });

  it("gives two groups whose keys start with the same letter DIFFERENT letters", () => {
    const jumps = buildModuleJumps([
      group("sales", "أ", [item("i1", "a", vi.fn())]),
      group("supplies", "ب", [item("i2", "b", vi.fn())]),
    ]);
    const letters = jumps.map((j) => j.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it("calling a jump's go() invokes the right item's onClick", () => {
    const onClick = vi.fn();
    const jumps = buildModuleJumps([group("sales", "المبيعات", [item("i1", "الفواتير", onClick)])]);
    jumps[0]?.go();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("includes the top nav item's own jump when it has an onClick", () => {
    const onClick = vi.fn();
    const jumps = buildModuleJumps([], item("dashboard", "لوحة التحكم", onClick));
    expect(jumps.length).toBe(1);
    jumps[0]?.go();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the group's first routable item, not a later non-routable one", () => {
    const first = vi.fn();
    const jumps = buildModuleJumps([group("sales", "المبيعات", [item("i1", "أ", first), item("i2", "ب", vi.fn())])]);
    jumps[0]?.go();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
