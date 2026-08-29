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
 * The workspace column's width. 224, not 200: the column now carries the
 * search row, both scope selects and the user's own name at its foot, and at
 * 200 the longest workspace names sat a hair from the edge while «كل الفروع»
 * had nowhere to truncate.
 */
export const RAIL_WIDTH = "w-[224px]";

/** The screens bar's own inline padding; the header matches it after the brand. */
export const BAR_INSET = "ps-[12px]";
