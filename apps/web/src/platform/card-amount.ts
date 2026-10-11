const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** The wire amount carries six decimals; the operator reads and types piasters. Cut as text — a money figure never passes through a float here. */
export function toPiasters(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .replace(/٫/g, ".");
}

export function isPositiveAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value) && /[1-9]/.test(value);
}
