/**
 * Arabic number-to-words for printed amounts (docs/plan.md §2.4 —
 * "Arabic amount-in-words implementation (masculine/feminine agreement,
 * currency + subunit naming)").
 *
 * Grammar note that is easy to get backwards and hard to notice in review:
 * Arabic cardinal numbers 3-10 (and the units place of 13-19) show gender
 * POLARITY, not agreement — but polarity is already baked into which word
 * list you pick. The "ة"-suffixed forms (ONES_MASCULINE / ثلاثة, أربعة, ...)
 * are the ones that go with a MASCULINE counted noun (e.g. "خمسة جنيهات" —
 * جنيه is masculine); the bare forms (ONES_FEMININE / ثلاث, أربع, ...) go
 * with a FEMININE counted noun (e.g. "خمس ليرات" — ليرة is feminine). So in
 * code this is a direct lookup by the noun's own declared gender, never an
 * "opposite" flip — don't ONES_FEMININE[i] for masculine nouns or vice versa.
 */

export type ArabicNounGender = "masculine" | "feminine";

export interface ArabicCurrencyNoun {
  readonly singular: string;
  readonly dual: string;
  readonly plural: string;
  readonly gender: ArabicNounGender;
}

export interface ArabicCurrencyWords {
  readonly main: ArabicCurrencyNoun;
  readonly subunit: ArabicCurrencyNoun;
  /** Subunits per one main unit — 100 for piastres/halalas, 1000 for fils. Defaults to 100. */
  readonly subunitsPerMain?: number;
}

export const EGP_WORDS: ArabicCurrencyWords = {
  main: { singular: "جنيه مصري", dual: "جنيهان مصريان", plural: "جنيهات مصرية", gender: "masculine" },
  subunit: { singular: "قرش", dual: "قرشان", plural: "قروش", gender: "masculine" },
};

export const SAR_WORDS: ArabicCurrencyWords = {
  main: { singular: "ريال سعودي", dual: "ريالان سعوديان", plural: "ريالات سعودية", gender: "masculine" },
  subunit: { singular: "هللة", dual: "هللتان", plural: "هللات", gender: "feminine" },
};

const ONES_MASCULINE = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"] as const;
const ONES_FEMININE = ["", "واحدة", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثماني", "تسع"] as const;

const TEENS_MASCULINE = [
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
] as const;
const TEENS_FEMININE = [
  "عشر",
  "إحدى عشرة",
  "اثنتا عشرة",
  "ثلاث عشرة",
  "أربع عشرة",
  "خمس عشرة",
  "ست عشرة",
  "سبع عشرة",
  "ثماني عشرة",
  "تسع عشرة",
] as const;

// Invariant regardless of the counted noun's gender.
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"] as const;
const HUNDREDS = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
] as const;

const THOUSAND: ArabicCurrencyNoun = { singular: "ألف", dual: "ألفان", plural: "آلاف", gender: "masculine" };
const MILLION: ArabicCurrencyNoun = { singular: "مليون", dual: "مليونان", plural: "ملايين", gender: "masculine" };
const BILLION: ArabicCurrencyNoun = { singular: "مليار", dual: "ملياران", plural: "مليارات", gender: "masculine" };
const TRILLION: ArabicCurrencyNoun = {
  singular: "تريليون",
  dual: "تريليونان",
  plural: "تريليونات",
  gender: "masculine",
};
const SCALE_NOUNS: readonly ArabicCurrencyNoun[] = [THOUSAND, MILLION, BILLION, TRILLION];

function chunkToWords(n: number, gender: ArabicNounGender): string {
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const parts: string[] = [];

  if (hundreds > 0) parts.push(HUNDREDS[hundreds] ?? "");

  if (rem > 0) {
    if (rem < 10) {
      const ones = gender === "masculine" ? ONES_MASCULINE : ONES_FEMININE;
      parts.push(ones[rem] ?? "");
    } else if (rem < 20) {
      const teens = gender === "masculine" ? TEENS_MASCULINE : TEENS_FEMININE;
      parts.push(teens[rem - 10] ?? "");
    } else {
      const tens = Math.floor(rem / 10);
      const ones = rem % 10;
      if (ones > 0) {
        const onesTable = gender === "masculine" ? ONES_MASCULINE : ONES_FEMININE;
        parts.push(`${onesTable[ones] ?? ""} و${TENS[tens] ?? ""}`);
      } else {
        parts.push(TENS[tens] ?? "");
      }
    }
  }

  return parts.join(" و");
}

/** Renders "<count> <noun>" honoring dual/plural-polarity/singular-construct forms. */
function nounCountPhrase(count: number, noun: ArabicCurrencyNoun, appendOneAdjective: boolean): string {
  if (count === 0) return "";
  if (count === 1) {
    if (!appendOneAdjective) return noun.singular;
    return `${noun.singular} ${noun.gender === "masculine" ? "واحد" : "واحدة"}`;
  }
  if (count === 2) return noun.dual;
  if (count <= 9) {
    const ones = noun.gender === "masculine" ? ONES_MASCULINE : ONES_FEMININE;
    return `${ones[count] ?? ""} ${noun.plural}`;
  }
  if (count === 10) {
    const ten = noun.gender === "masculine" ? TEENS_MASCULINE[0] : TEENS_FEMININE[0];
    return `${ten} ${noun.plural}`;
  }
  // 11+: the counted noun takes its singular ("construct") form regardless
  // of count, and the numeral itself always uses its masculine-noun forms.
  return `${chunkToWords(count, "masculine")} ${noun.singular}`;
}

function integerToWords(value: number, mainNoun: ArabicCurrencyNoun): string {
  const groups: number[] = [];
  let n = value;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  if (groups.length > SCALE_NOUNS.length + 1) {
    throw new RangeError("amountInWords: value is too large to spell out");
  }

  // The main noun (currency) is the "tamyiz" of exactly one group: the
  // units group (index 0) when it's nonzero, otherwise the smallest nonzero
  // scale group — e.g. 15000 is "خمسة عشر ألف جنيه مصري", not "...ألف" with
  // the currency dropped, and not "...ألف جنيه" repeated on every group.
  const lowestNonzeroIndex = groups.findIndex((g) => g > 0);

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) {
      parts.push(nounCountPhrase(g, mainNoun, true));
      continue;
    }
    const scaleNoun = SCALE_NOUNS[i - 1];
    if (!scaleNoun) continue;
    const scalePhrase = nounCountPhrase(g, scaleNoun, false);
    parts.push(i === lowestNonzeroIndex ? `${scalePhrase} ${mainNoun.singular}` : scalePhrase);
  }
  return parts.join(" و");
}

/**
 * Spells out a monetary amount in Arabic words, e.g.
 * `amountInWords(1092.5, SAR_WORDS)` →
 * "ألف واثنان وتسعون ريال سعودي وخمسون هللة فقط لا غير"
 * (matches the reference system's print-template preview, docs/catalog/09 §"المجاميع").
 */
export function amountInWords(value: number, currency: ArabicCurrencyWords = EGP_WORDS): string {
  if (!Number.isFinite(value)) throw new RangeError("amountInWords: value must be finite");
  if (value < 0) throw new RangeError("amountInWords: value must be non-negative");

  const subunitsPerMain = currency.subunitsPerMain ?? 100;
  const totalSubunits = Math.round(value * subunitsPerMain);
  const mainUnits = Math.floor(totalSubunits / subunitsPerMain);
  const subunits = totalSubunits % subunitsPerMain;

  const mainWords = mainUnits > 0 ? integerToWords(mainUnits, currency.main) : "";
  const subWords = subunits > 0 ? nounCountPhrase(subunits, currency.subunit, true) : "";

  let combined: string;
  if (mainUnits === 0 && subunits === 0) {
    combined = `صفر ${currency.main.singular}`;
  } else if (mainUnits > 0 && subunits > 0) {
    combined = `${mainWords} و${subWords}`;
  } else if (mainUnits > 0) {
    combined = mainWords;
  } else {
    combined = subWords;
  }

  return `${combined} فقط لا غير`;
}
