import { Money } from "../../money/index.js";

/**
 * خطابات الضمان — the letters-of-guarantee register
 * (docs/artifacts/mezan-contracting-designs.html §05 "Guarantees — the
 * contractor's real ceiling").
 *
 * A contractor's guarantee limit at its bank, not its cash, caps how many jobs
 * it can run. Two facts have to be on the books and generic ERPs record only
 * one: the FACE VALUE off balance sheet as a نظامي مدين / نظامي دائن pair
 * (9100/9200), and the CASH MARGIN on balance sheet as restricted cash (1340).
 */

export type GuaranteeKind = "bid" | "performance" | "advance" | "maintenance";

export interface GuaranteeKindDefinition {
  readonly code: GuaranteeKind;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const GUARANTEE_KIND_DEFINITIONS: readonly GuaranteeKindDefinition[] = [
  { code: "bid", labelAr: "ابتدائي", labelEn: "Bid bond" },
  { code: "performance", labelAr: "حسن تنفيذ", labelEn: "Performance bond" },
  { code: "advance", labelAr: "دفعة مقدمة", labelEn: "Advance payment guarantee" },
  { code: "maintenance", labelAr: "صيانة", labelEn: "Maintenance bond" },
] as const;

export function getGuaranteeKindLabel(kind: GuaranteeKind): string {
  return GUARANTEE_KIND_DEFINITIONS.find((d) => d.code === kind)?.labelAr ?? kind;
}

export function isGuaranteeKind(value: unknown): value is GuaranteeKind {
  return GUARANTEE_KIND_DEFINITIONS.some((d) => d.code === value);
}

/**
 * `expired` is NEVER stored. It is derived at read time from `expiryDate` and
 * the live date ({@link derivedGuaranteeStatus}) — an expired letter is still
 * legally outstanding until the beneficiary returns it, and its memorandum
 * pair and its margin stay on the ledger until `release` reverses them.
 */
export type GuaranteeStatus = "draft" | "active" | "reduced" | "released" | "called" | "expired";

export interface GuaranteeStatusDefinition {
  readonly code: GuaranteeStatus;
  readonly labelAr: string;
}

export const GUARANTEE_STATUS_DEFINITIONS: readonly GuaranteeStatusDefinition[] = [
  { code: "draft", labelAr: "مسودة" },
  { code: "active", labelAr: "قائم" },
  { code: "reduced", labelAr: "يتناقص مع الاسترداد" },
  { code: "released", labelAr: "مُفرَج عنه" },
  { code: "called", labelAr: "مُصادَر" },
  { code: "expired", labelAr: "منتهي" },
] as const;

export function getGuaranteeStatusLabel(status: GuaranteeStatus): string {
  return GUARANTEE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

/** The statuses whose face value is still outstanding against the bank's facility. */
export const OUTSTANDING_GUARANTEE_STATUSES: readonly GuaranteeStatus[] = ["active", "reduced"];

export function isGuaranteeOutstanding(guarantee: Pick<LetterOfGuarantee, "status">): boolean {
  return OUTSTANDING_GUARANTEE_STATUSES.includes(guarantee.status);
}

/** One append-only step down the face value — an advance guarantee shrinks as the advance is recovered. */
export interface GuaranteeReduction {
  readonly date: string;
  readonly amount: Money;
  readonly reason: string;
  /** The document that caused it (a progress certificate, say). Null when entered by hand. */
  readonly sourceRef: string | null;
  /** WHO recorded it. Null only on rows written before the column existed. */
  readonly userId: string | null;
}

export interface LetterOfGuarantee {
  readonly id: string;
  /** Stamped from the `LETTER_OF_GUARANTEE` sequence when the letter is issued — null while draft. */
  readonly docNo: string | null;
  readonly kind: GuaranteeKind;
  readonly projectId: string | null;
  readonly contractId: string | null;
  /** The tender a bid bond belongs to, when there is no project yet. */
  readonly tenderRef: string | null;
  /** The employer the letter is issued in favour of. */
  readonly beneficiaryNameAr: string;
  readonly bankTreasuryAccountId: string;
  /** Display snapshot of the issuing bank, derived server-side from the treasury account. */
  readonly bankNameAr: string;
  readonly faceValue: Money;
  /** Exact decimal string, e.g. "5" for a 5% performance bond. Null when the letter is not a percentage of a contract. */
  readonly percentOfContract: string | null;
  /** Exact decimal string, e.g. "20". */
  readonly cashMarginPercent: string;
  readonly cashMarginAmount: Money;
  readonly issueDate: string;
  readonly expiryDate: string;
  readonly status: GuaranteeStatus;
  /** Face value net of every reduction; zero once released or called. */
  readonly currentValue: Money;
  readonly reductions: readonly GuaranteeReduction[];
  /**
   * Append-only steps back UP the face value: a reduction driven by a
   * certificate that was later voided. Kept apart from `reductions` so the
   * history of what the bank was told stays readable in both directions —
   * currentValue = faceValue − Σ reductions + Σ restorations.
   */
  readonly restorations: readonly GuaranteeReduction[];
  /** The date the letter was released or called. Null while it is still outstanding. */
  readonly closedDate: string | null;
  /** WHO released or called it. Null while the letter is still outstanding. */
  readonly closedBy: string | null;
  /** What was released back or drawn by the beneficiary. Zero while outstanding. */
  readonly closedAmount: Money;
  readonly notes: string | null;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The status a reader sees. An outstanding letter whose `expiryDate` has
 * passed reads «منتهي» — but the STORED status is untouched, because the bank
 * has not returned anything and the ledger still carries both the memorandum
 * pair and the margin.
 */
export function derivedGuaranteeStatus(guarantee: LetterOfGuarantee, today: string): GuaranteeStatus {
  if (!isGuaranteeOutstanding(guarantee)) return guarantee.status;
  return guarantee.expiryDate < today ? "expired" : guarantee.status;
}

/** Days left before the letter expires. Negative once it has. */
export function daysToExpiry(guarantee: LetterOfGuarantee, today: string): number {
  return daysBetween(today, guarantee.expiryDate);
}

/** Outstanding and expiring inside `days` days of `today` (an already-expired letter counts). */
export function isExpiringWithin(guarantee: LetterOfGuarantee, today: string, days: number): boolean {
  if (!isGuaranteeOutstanding(guarantee)) return false;
  return daysToExpiry(guarantee, today) <= days;
}

/** Persistence port. The domain depends on this interface only — no SQL, no driver. */
export interface LetterOfGuaranteeRepository {
  findById(id: string): Promise<LetterOfGuarantee | null>;
  findByDocNo(docNo: string): Promise<LetterOfGuarantee | null>;
  list(): Promise<LetterOfGuarantee[]>;
  create(guarantee: LetterOfGuarantee): Promise<void>;
  update(guarantee: LetterOfGuarantee): Promise<void>;
}

/**
 * Contract existence, supplied by the contracts slice when it is composed in.
 * Omitted, a `contractId` is accepted as an opaque reference rather than
 * refused — the register has to be usable before the contracts module lands.
 */
export interface ContractExistencePort {
  exists(contractId: string): Promise<boolean>;
}

/** amount × percent / 100, rounded to the minor unit. Exact bigint arithmetic — never a float. */
export function guaranteeMarginOf(faceValue: Money, percent: string): Money {
  const parsed = Number(percent);
  if (!Number.isFinite(parsed) || parsed === 0) return Money.zero();
  const pctScaled = BigInt(Math.round(parsed * 1_000_000));
  const raw = faceValue.scaled * pctScaled;
  // Divide by 1e8 (1e6 percent scale × 100) half-up, then quantize to 1e-2.
  const divided = divHalfUp(raw, 100_000_000n);
  return Money.fromScaled(divHalfUp(divided, 10_000n) * 10_000n);
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  const rounded = r * 2n >= denominator ? q + 1n : q;
  return negative ? -rounded : rounded;
}
