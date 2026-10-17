export const EGYPT_IBAN_COUNTRY = "EG";
export const EGYPT_IBAN_LENGTH = 29;

export enum IbanProblem {
  Empty = "empty",
  NotEgyptian = "not_egyptian",
  WrongLength = "wrong_length",
  BadCharacters = "bad_characters",
  ChecksumFailed = "checksum_failed",
}

const IBAN_PROBLEM_AR: Record<IbanProblem, string> = {
  [IbanProblem.Empty]: "رقم الآيبان مطلوب",
  [IbanProblem.NotEgyptian]: "رقم الآيبان يجب أن يبدأ بـ EG (حساب في بنك مصري)",
  [IbanProblem.WrongLength]: `رقم الآيبان المصري ${EGYPT_IBAN_LENGTH} حرفًا ورقمًا`,
  [IbanProblem.BadCharacters]: "رقم الآيبان يحتوي على حروف أو رموز غير مسموح بها",
  [IbanProblem.ChecksumFailed]: "رقم الآيبان غير صحيح — رقما التحقق لا يطابقان باقي الرقم",
};

const IBAN_PROBLEM_EN: Record<IbanProblem, string> = {
  [IbanProblem.Empty]: "An IBAN is required",
  [IbanProblem.NotEgyptian]: "The IBAN must start with EG (an account at an Egyptian bank)",
  [IbanProblem.WrongLength]: `An Egyptian IBAN is ${EGYPT_IBAN_LENGTH} characters long`,
  [IbanProblem.BadCharacters]: "The IBAN contains characters that are not allowed",
  [IbanProblem.ChecksumFailed]: "The IBAN is not valid — its check digits do not match the rest of the number",
};

export function ibanProblemAr(problem: IbanProblem): string {
  return IBAN_PROBLEM_AR[problem];
}

export function ibanProblemEn(problem: IbanProblem): string {
  return IBAN_PROBLEM_EN[problem];
}

export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder;
}

export function ibanChecksumValid(iban: string): boolean {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let numeric = "";
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    numeric += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return mod97(numeric) === 1;
}

/** ISO 13616 validation narrowed to the Egyptian layout: EG + 2 check digits + 4 bank + 4 branch + 17 account. */
export function validateEgyptianIban(raw: string): IbanProblem | null {
  const iban = normalizeIban(raw);
  if (iban.length === 0) return IbanProblem.Empty;
  if (!/^[A-Z0-9]+$/.test(iban)) return IbanProblem.BadCharacters;
  if (!iban.startsWith(EGYPT_IBAN_COUNTRY)) return IbanProblem.NotEgyptian;
  if (iban.length !== EGYPT_IBAN_LENGTH) return IbanProblem.WrongLength;
  if (!/^EG\d{27}$/.test(iban)) return IbanProblem.BadCharacters;
  if (!ibanChecksumValid(iban)) return IbanProblem.ChecksumFailed;
  return null;
}

export interface EgyptianIbanParts {
  readonly bankCode: string;
  readonly branchCode: string;
  readonly accountNumber: string;
}

/** The parts are positional only; this module deliberately carries no bank-code → bank-name table, since the published lists disagree. */
export function egyptianIbanParts(iban: string): EgyptianIbanParts {
  const normalized = normalizeIban(iban);
  return {
    bankCode: normalized.slice(4, 8),
    branchCode: normalized.slice(8, 12),
    accountNumber: normalized.slice(12),
  };
}

export function maskIban(iban: string): string {
  const normalized = normalizeIban(iban);
  if (normalized.length <= 6) return normalized;
  return `${normalized.slice(0, 2)}${"•".repeat(normalized.length - 6)}${normalized.slice(-4)}`;
}
