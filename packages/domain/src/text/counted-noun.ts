export enum CountedNoun {
  Day = "day",
  Invoice = "invoice",
  Customer = "customer",
  Item = "item",
}

export enum CountLocale {
  Ar = "ar",
  En = "en",
}

export enum ArabicCase {
  Nominative = "nominative",
  Oblique = "oblique",
}

interface ArabicNounForms {
  readonly singular: string;
  readonly one: string;
  readonly dual: string;
  readonly dualOblique: string;
  readonly plural: string;
  readonly tamyeez: string;
}

const ARABIC_FORMS: Record<CountedNoun, ArabicNounForms> = {
  [CountedNoun.Day]: { singular: "يوم", one: "يوم واحد", dual: "يومان", dualOblique: "يومين", plural: "أيام", tamyeez: "يومًا" },
  [CountedNoun.Invoice]: { singular: "فاتورة", one: "فاتورة واحدة", dual: "فاتورتان", dualOblique: "فاتورتين", plural: "فواتير", tamyeez: "فاتورة" },
  [CountedNoun.Customer]: { singular: "عميل", one: "عميل واحد", dual: "عميلان", dualOblique: "عميلين", plural: "عملاء", tamyeez: "عميلًا" },
  [CountedNoun.Item]: { singular: "صنف", one: "صنف واحد", dual: "صنفان", dualOblique: "صنفين", plural: "أصناف", tamyeez: "صنفًا" },
};

const ENGLISH_FORMS: Record<CountedNoun, { readonly one: string; readonly other: string }> = {
  [CountedNoun.Day]: { one: "day", other: "days" },
  [CountedNoun.Invoice]: { one: "invoice", other: "invoices" },
  [CountedNoun.Customer]: { one: "customer", other: "customers" },
  [CountedNoun.Item]: { one: "item", other: "items" },
};

const AR_RULES = new Intl.PluralRules("ar");
const EN_RULES = new Intl.PluralRules("en");

export interface CountPhraseOptions {
  readonly grammaticalCase?: ArabicCase;
  readonly formatNumber?: (n: number) => string;
}

/**
 * A number with its counted noun in agreement. Arabic picks the form from
 * Intl.PluralRules("ar"): «يوم واحد», «يومان/يومين», «3 أيام», «11 يومًا»,
 * «100 يوم»; English the singular or the plural.
 */
export function countPhrase(
  locale: CountLocale | `${CountLocale}`,
  count: number,
  noun: CountedNoun,
  options: CountPhraseOptions = {},
): string {
  const shown = (options.formatNumber ?? String)(count);
  if (locale === CountLocale.En) {
    const forms = ENGLISH_FORMS[noun];
    return `${shown} ${EN_RULES.select(count) === "one" ? forms.one : forms.other}`;
  }
  const forms = ARABIC_FORMS[noun];
  switch (AR_RULES.select(count)) {
    case "one":
      return forms.one;
    case "two":
      return options.grammaticalCase === ArabicCase.Oblique ? forms.dualOblique : forms.dual;
    case "few":
      return `${shown} ${forms.plural}`;
    case "many":
      return `${shown} ${forms.tamyeez}`;
    default:
      return `${shown} ${forms.singular}`;
  }
}

export function arabicDays(count: number, grammaticalCase: ArabicCase = ArabicCase.Nominative): string {
  return countPhrase(CountLocale.Ar, count, CountedNoun.Day, { grammaticalCase });
}
