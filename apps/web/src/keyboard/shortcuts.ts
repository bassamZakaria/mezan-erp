import type { NavGroup, NavItem } from "@mezan/ui";

/**
 * The DOM-level primitives behind the global keymap (spec §7). Kept separate
 * from the hook so the rules that decide "is the user typing?" and "which form
 * does ⌘S save?" are readable on their own.
 */

/**
 * Fired on `window` when `j` / `k` / `Enter` should move or open a table
 * selection. `DocumentList` (packages/ui) listens for it; a CustomEvent is the
 * seam because packages/ui cannot import from apps/web.
 */
export const LIST_NAV_EVENT = "mz:list-nav";

export type ListNavAction = "next" | "prev" | "open";

export interface ListNavDetail {
  action: ListNavAction;
}

export function emitListNav(action: ListNavAction): void {
  window.dispatchEvent(new CustomEvent<ListNavDetail>(LIST_NAV_EVENT, { detail: { action } }));
}

const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when the event target accepts text, so bare letters must never be hijacked. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return target.closest('[contenteditable="true"],[role="textbox"],[role="combobox"]') !== null;
}

/** True when Enter already means "activate this", so the list shortcut must stay out of the way. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('a[href],button,summary,[role="button"],[role="option"],[role="tab"],[role="menuitem"]') !== null;
}

/**
 * The letter a key press stands for, in a-z. Falls back to the physical
 * `KeyX` code so `g s` still works on an Arabic keyboard layout, where
 * `event.key` is `س` rather than `s`.
 */
export function latinLetter(event: KeyboardEvent): string | null {
  const key = event.key;
  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (lower >= "a" && lower <= "z") return lower;
  }
  const code = event.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  return null;
}

function isHidden(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"],[hidden]')) return true;
  // A closed SidePanel stays mounted and is translated off-screen, so
  // offsetParent alone is not enough — the aria-hidden check above carries it.
  return el.offsetParent === null && getComputedStyle(el).position !== "fixed";
}

/**
 * The form ⌘S saves: the one holding focus, else the one inside an open
 * dialog (the create/edit side panel), else the first visible form on screen.
 */
export function findDocumentForm(): HTMLFormElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const owning = active.closest("form");
    if (owning && !isHidden(owning)) return owning;
  }
  const forms = [...document.querySelectorAll("form")].filter((form) => !isHidden(form));
  return forms.find((form) => form.closest('[role="dialog"]') !== null) ?? forms[0] ?? null;
}

/**
 * The in-page search box `/` focuses: an explicitly marked field, else a search
 * input, else the first text input in the routed content. The command bar in
 * the topbar is the fallback when the screen has no search of its own.
 */
export function findSearchInput(): HTMLInputElement | null {
  const scope = document.querySelector("main") ?? document.body;
  const candidates = [
    ...scope.querySelectorAll<HTMLInputElement>('[data-mz-search],input[type="search"],input[type="text"]'),
  ];
  const inPage = candidates.find((input) => !input.disabled && !input.readOnly && !isHidden(input));
  if (inPage) return inPage;
  const commandBar = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  return commandBar && !isHidden(commandBar) ? commandBar : null;
}

export interface ModuleJump {
  /** The letter typed after `g`. */
  letter: string;
  label: string;
  go: () => void;
}

function pickLetter(source: string, used: Set<string>): string | null {
  for (const char of source.toLowerCase()) {
    if (char >= "a" && char <= "z" && char !== "g" && !used.has(char)) return char;
  }
  return null;
}

function firstFreeLetter(used: Set<string>): string | null {
  for (let code = 97; code <= 122; code += 1) {
    const char = String.fromCharCode(code);
    if (char !== "g" && !used.has(char)) return char;
  }
  return null;
}

/**
 * Derives the `g`-chord from the live navigation tree rather than a parallel
 * hardcoded map: every nav group that has at least one routable item gets a
 * letter — its first free letter, mnemonic where the module allows it — and
 * jumps to that group's first routable item (its hub, in practice). `g` itself
 * is never a target letter so a doubled `g` cannot fire a jump.
 */
export function buildModuleJumps(groups: readonly NavGroup[], top?: NavItem): ModuleJump[] {
  const used = new Set<string>();
  const jumps: ModuleJump[] = [];

  function add(source: string, label: string, go: () => void) {
    const letter = pickLetter(source, used) ?? firstFreeLetter(used);
    if (!letter) return;
    used.add(letter);
    jumps.push({ letter, label, go });
  }

  if (top?.onClick) add(top.key, top.label, top.onClick);
  for (const group of groups) {
    const target = group.items.find((item) => item.onClick);
    if (!target?.onClick) continue;
    add(group.key, group.label, target.onClick);
  }
  return jumps;
}
