/**
 * Arabic-forgiving text matching for the primitives that filter in the
 * browser (EntityPicker and friends).
 *
 * CONTRACT: this must fold exactly what `normalizeForSearch` in
 * `packages/domain/src/search/arabic.ts` folds — it is a verbatim copy of it.
 * The server's list filters and the screens' own filters run that one; a
 * picker that folds LESS is D114: «الامل» finds the customer in the list and
 * nothing in the picker bound to the same data. @mezan/ui deliberately
 * carries no dependency on @mezan/domain (see print/types.ts,
 * PermissionMatrix.tsx), hence the copy rather than an import.
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
