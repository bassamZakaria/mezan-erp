/**
 * The two measurements the shell's columns share.
 *
 * The workspace column, the brand block above it and the screens bar beside it
 * are three separate components that have to line up to the pixel: the brand
 * reads as the column's own header, and the first chip on the screens bar has
 * to begin exactly where the branch selector above it does. Held as literals
 * in three files, that alignment survives until the first person changes one of
 * them.
 *
 * These are Tailwind class strings rather than numbers so the arbitrary values
 * appear verbatim in this file for the JIT scanner to find.
 */

/**
 * The workspace column's width. 256, not 224 (+14%): even at 224 the longer
 * workspace and nav labels sat a hair from the edge with no room to breathe.
 * Every consumer imports this constant rather than repeating the number —
 * change it here only.
 */
export const RAIL_WIDTH = "w-[256px]";

/**
 * Where the shell stops being a two-column desktop layout.
 *
 * Below this the workspace column becomes an OVERLAY rather than a sibling of
 * the content. A fixed 256px column on a 390px phone leaves 134px for the
 * screen itself, so every table, form and KPI row overflowed and the PAGE
 * scrolled sideways — the user dragged the whole layout left and right to read
 * one row, and the chrome went with it.
 *
 * 900px rather than a Tailwind breakpoint: the column plus a usable content
 * area needs roughly 256 + 640, and `lg` (1024) would take the column away from
 * tablets that have room for it.
 */
export const RAIL_BREAKPOINT = 900;

/** The rail as a sibling column: its normal desktop self, hidden once it overlays. */
export const RAIL_DOCKED = "max-[900px]:hidden";

/** The rail as an overlay: off the flow, above the content, full height. */
export const RAIL_OVERLAY = "fixed inset-y-0 start-0 z-50 max-w-[85vw] shadow-2";

/** Shown only below the breakpoint — the menu button, and the bar that holds it. */
export const SMALL_ONLY = "min-[901px]:hidden";

/** The screens bar's own inline padding; the header matches it after the brand. */
export const BAR_INSET = "ps-[12px]";
