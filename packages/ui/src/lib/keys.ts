/**
 * Keyboard primitives shared by the shell and the app's global keymap.
 *
 * WHY `event.code` MATTERS HERE: on the Arabic layout every user of this
 * product types on, `event.key` for the K key is «ن», not "k". A shortcut
 * matched on `event.key` alone is dead for them. `latinLetter` falls back to
 * the physical `KeyX` code, which is layout-independent.
 */

/** The letter a key press stands for, in a–z, whatever the keyboard layout. */
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

/** U+061F ARABIC QUESTION MARK — what Shift+Q emits on the Arabic layout. */
const ARABIC_QUESTION_MARK = "؟";

/** True for the key that opens the shortcuts sheet, on either layout. */
export function isHelpKey(event: KeyboardEvent): boolean {
  return event.key === "?" || event.key === ARABIC_QUESTION_MARK;
}

/**
 * Fired on `window` when `j` / `k` / `Enter` should move or open a table
 * selection. `DocumentList` listens for it; a CustomEvent is the seam because
 * the listener lives in this package and the keymap lives in the app.
 */
export const LIST_NAV_EVENT = "mz:list-nav";

export type ListNavAction = "next" | "prev" | "open";

export interface ListNavDetail {
  action: ListNavAction;
}

export function emitListNav(action: ListNavAction): void {
  window.dispatchEvent(new CustomEvent<ListNavDetail>(LIST_NAV_EVENT, { detail: { action } }));
}

/**
 * The list that `j`/`k`/`Enter` drive. Screens render one `DocumentList`, but
 * a side panel can mount a second over it; the most recently mounted one wins,
 * so the keys always follow the list the user is looking at.
 */
const listNavStack: symbol[] = [];

export function pushListNavSubscriber(id: symbol): void {
  listNavStack.push(id);
}

export function popListNavSubscriber(id: symbol): void {
  const at = listNavStack.lastIndexOf(id);
  if (at !== -1) listNavStack.splice(at, 1);
}

export function isTopListNavSubscriber(id: symbol): boolean {
  return listNavStack[listNavStack.length - 1] === id;
}
