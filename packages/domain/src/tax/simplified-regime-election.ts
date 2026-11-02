/**
 * تسجيل الاختيار — the record that the taxpayer HAS ALREADY elected the
 * simplified regime on Form 1/10.
 *
 * THE ONE THING THIS MUST NOT DO. The election is irrevocable for five years.
 * A button that performs it, or a save that could be read as performing it,
 * would let a mis-click bind a business for five years — so nothing here
 * elects anything. Every field records a filing the taxpayer made with the
 * ETA: the date they filed, the reference on the form, and (for a withdrawal)
 * the Form 1/11 that ended it. `irrevocableUntil` is DERIVED from the recorded
 * election date; it is not a lock Mezan applies, it is the statutory window
 * shown back so the owner can see it.
 */

import { simplifiedRegimeScheduleOn, type SimplifiedRegimeSchedule } from "./simplified-regime-schedule.js";

export type SimplifiedRegimeState = "not_elected" | "active" | "withdrawn";

export interface SimplifiedRegimeElection {
  readonly state: SimplifiedRegimeState;
  /** The date written on Form 1/10, as filed. Null while nothing has been filed. */
  readonly electedOn: string | null;
  /** The ETA's reference for that form — what an auditor asks for first. */
  readonly form110Reference: string | null;
  /** electedOn + the statutory irrevocability, derived and stored so a later table change cannot rewrite history. */
  readonly irrevocableUntil: string | null;
  readonly withdrawnOn: string | null;
  readonly form111Reference: string | null;
  /**
   * Joining e-invoicing / e-receipt is a CONDITION OF ENTRY, so a regime record
   * with no join date is incomplete rather than merely undocumented.
   */
  readonly eInvoicingJoinedOn: string | null;
  readonly notes: string | null;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface SimplifiedRegimeRepository {
  get(): Promise<SimplifiedRegimeElection | null>;
  save(election: SimplifiedRegimeElection): Promise<void>;
}

export const NO_SIMPLIFIED_REGIME: SimplifiedRegimeElection = {
  state: "not_elected",
  electedOn: null,
  form110Reference: null,
  irrevocableUntil: null,
  withdrawnOn: null,
  form111Reference: null,
  eInvoicingJoinedOn: null,
  notes: null,
  recordedAt: "",
  recordedBy: "",
};

export class InvalidSimplifiedRegimeRecordError extends Error {
  readonly code = "INVALID_SIMPLIFIED_REGIME_RECORD";
  readonly messageEn: string;
  constructor(readonly field: string, message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidSimplifiedRegimeRecordError";
  }
}

export interface RecordSimplifiedRegimeCommand {
  readonly state: SimplifiedRegimeState;
  readonly electedOn?: string | null;
  readonly form110Reference?: string | null;
  readonly withdrawnOn?: string | null;
  readonly form111Reference?: string | null;
  readonly eInvoicingJoinedOn?: string | null;
  readonly notes?: string | null;
  readonly recordedBy?: string;
  readonly recordedAt?: string;
}

/** electedOn + n years, minus a day: the last day the election still binds. */
function irrevocableUntilOf(electedOn: string, years: number): string {
  const [y, m, d] = electedOn.split("-").map((part) => Number(part));
  const at = new Date(Date.UTC((y ?? 1970) + years, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function requireDay(value: string | null | undefined, field: string, what: string, whatEn: string): string {
  if (!value || !DAY.test(value)) {
    throw new InvalidSimplifiedRegimeRecordError(field, what, whatEn);
  }
  return value;
}

function requireText(value: string | null | undefined, field: string, what: string, whatEn: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") throw new InvalidSimplifiedRegimeRecordError(field, what, whatEn);
  return trimmed;
}

/**
 * Record what was filed. Validation refuses an INCOMPLETE record — an active
 * regime with no Form 1/10 reference is a claim with nothing behind it — but
 * it never refuses a date the ETA accepted. A withdrawal inside the five-year
 * window is recorded and flagged by {@link simplifiedRegimeFlags}, because the
 * taxpayer is telling Mezan what happened, not asking its permission.
 */
export function recordSimplifiedRegime(
  cmd: RecordSimplifiedRegimeCommand,
  schedule: SimplifiedRegimeSchedule | null = null,
): SimplifiedRegimeElection {
  const recordedAt = cmd.recordedAt ?? new Date().toISOString();
  const recordedBy = cmd.recordedBy ?? "system";

  if (cmd.state === "not_elected") {
    return { ...NO_SIMPLIFIED_REGIME, notes: cmd.notes ?? null, recordedAt, recordedBy };
  }

  const electedOn = requireDay(cmd.electedOn, "electedOn", "تاريخ تقديم نموذج 1/10 مطلوب.", "The date Form 1/10 was filed is required.");
  const form110Reference = requireText(cmd.form110Reference, "form110Reference", "رقم نموذج 1/10 المقدَّم مطلوب.", "The reference number of the filed Form 1/10 is required.");
  const inForce = schedule ?? simplifiedRegimeScheduleOn(electedOn);
  const years = inForce?.irrevocableYears.value ?? 5;

  const base = {
    electedOn,
    form110Reference,
    irrevocableUntil: irrevocableUntilOf(electedOn, years),
    eInvoicingJoinedOn: cmd.eInvoicingJoinedOn ?? null,
    notes: cmd.notes ?? null,
    recordedAt,
    recordedBy,
  };

  if (cmd.state === "active") {
    return { ...base, state: "active", withdrawnOn: null, form111Reference: null };
  }

  return {
    ...base,
    state: "withdrawn",
    withdrawnOn: requireDay(cmd.withdrawnOn, "withdrawnOn", "تاريخ تقديم نموذج 1/11 مطلوب.", "The date Form 1/11 was filed is required."),
    form111Reference: requireText(cmd.form111Reference, "form111Reference", "رقم نموذج 1/11 المقدَّم مطلوب.", "The reference number of the filed Form 1/11 is required."),
  };
}

export type SimplifiedRegimeFlagKey =
  | "eInvoicingMissing"
  | "withdrawnInsideIrrevocability"
  | "irrevocableUntil";

export interface SimplifiedRegimeFlag {
  readonly key: SimplifiedRegimeFlagKey;
  readonly source: string;
  /** The date the flag is about, when it has one — rendered by the caller in its own locale. */
  readonly date: string | null;
}

/** Whether the regime binds postings dated `day`. */
export function simplifiedRegimeActiveOn(election: SimplifiedRegimeElection, day: string): boolean {
  if (election.state !== "active" && election.state !== "withdrawn") return false;
  if (election.electedOn === null || day < election.electedOn) return false;
  if (election.state === "withdrawn" && election.withdrawnOn !== null && day > election.withdrawnOn) return false;
  return true;
}

/** What the record says that the owner should be told — shown, never acted on. */
export function simplifiedRegimeFlags(
  election: SimplifiedRegimeElection,
  schedule: SimplifiedRegimeSchedule | null,
): readonly SimplifiedRegimeFlag[] {
  if (election.state === "not_elected") return [];
  const flags: SimplifiedRegimeFlag[] = [];
  const irrevocabilitySource = schedule?.irrevocableYears.source ?? "قانون 6 لسنة 2025";
  if (election.eInvoicingJoinedOn === null) {
    flags.push({ key: "eInvoicingMissing", source: irrevocabilitySource, date: null });
  }
  if (election.irrevocableUntil !== null) {
    flags.push({ key: "irrevocableUntil", source: irrevocabilitySource, date: election.irrevocableUntil });
  }
  if (
    election.state === "withdrawn" &&
    election.withdrawnOn !== null &&
    election.irrevocableUntil !== null &&
    election.withdrawnOn <= election.irrevocableUntil
  ) {
    flags.push({ key: "withdrawnInsideIrrevocability", source: irrevocabilitySource, date: election.withdrawnOn });
  }
  return flags;
}
