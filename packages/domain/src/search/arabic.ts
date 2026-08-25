/**
 * Arabic-forgiving text matching, shared by the server's list filters and the
 * screens' own client-side filters so both forgive the same things.
 *
 * Arabic is typed inconsistently and correctly so: أحمد is routinely typed
 * احمد, فاطمة as فاطمه, ليلى as ليلي. A raw `includes` finds none of them, which
 * is what every screen used to do — searching احمد returned nothing while أحمد
 * sat in the list (D32).
 *
 * Normalisation folds the differences that are spelling variance, never the
 * ones that are meaning: hamza carriers onto bare alif, ة onto ه, ى onto ي,
 * ؤ/ئ onto و/ي, tatweel and tashkeel removed, Arabic-Indic digits onto ASCII.
 */

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const ARABIC_INDIC = /[٠-٩۰-۹]/g;

function foldDigit(ch: string): string {
  const code = ch.codePointAt(0) as number;
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return ch;
}

/** Fold a string to its searchable form. Idempotent. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(ARABIC_INDIC, foldDigit)
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىي]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * True when any of `haystacks` contains `query` once both are normalised. An
 * empty or whitespace-only query matches everything, so a cleared search box
 * shows the whole list rather than nothing.
 */
export function matchesSearch(query: string | null | undefined, ...haystacks: (string | null | undefined)[]): boolean {
  const needle = normalizeForSearch(query ?? "");
  if (needle === "") return true;
  return haystacks.some((h) => (h ? normalizeForSearch(h).includes(needle) : false));
}
