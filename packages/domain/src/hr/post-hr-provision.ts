import { Money } from "../money/index.js";
import { recordSensitiveEvent } from "../audit/index.js";
import type { JournalEntry } from "../journal.js";
import { nextEntryGenerationId, postJournalEntry, reverseJournalEntry, ReversalDateBeforeOriginalError, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { HrProvisionLaterPostingError, HrProvisionPostingNotFoundError, InvalidPayrollRunError } from "./errors.js";

/**
 * ترحيل المخصصات — posting the HR obligations the books do not otherwise hold.
 *
 * WHY THIS EXISTS. Unused leave that is cashed out on termination is a real
 * liability that accrues every month and appears nowhere in the ledger until
 * somebody resigns. Their reports could compute
 * them exactly and still reconcile to zero forever, which is the shape of a
 * report compensating for a fact the ledger never recorded: the figure looks
 * right on screen and the balance sheet is understated.
 *
 * WHAT IT POSTS. The MOVEMENT, never the total: the difference between what
 * the obligation is now and what the liability account already carries.
 *
 *   growing:   Dr مصروف المخصص      Cr المخصص
 *   shrinking: Dr المخصص            Cr مصروف المخصص   (people left, or were paid)
 *
 * Posting it twice in a row therefore posts nothing the second time — there is
 * no double-count to guard against, because the second run's movement is zero
 * and a zero movement is REFUSED rather than posted as an empty entry.
 *
 * The computed total is passed in by the caller, which reads it from the same
 * report definition the screen renders. The posted figure and the reported
 * figure are then the same number by construction rather than by agreement.
 */

/**
 * Only the leave obligation is provisioned. The end-of-service gratuity is
 * payable only past the statutory age and without a pension entitlement, so a
 * monthly provision for every employee overstated the liability; it stays out
 * until that condition is what the provision is computed on.
 */
export type HrProvisionKind = "leave";

export interface HrProvisionDefinition {
  readonly kind: HrProvisionKind;
  readonly labelAr: string;
  readonly expenseAccountId: string;
  readonly liabilityAccountId: string;
  readonly sourceDocType: string;
}

export const HR_PROVISION_DEFINITIONS: readonly HrProvisionDefinition[] = [
  {
    kind: "leave",
    labelAr: "مخصص التزام الإجازات",
    // Leave that is paid out is wages, so it accrues against the salary
    // expense account rather than an account of its own.
    expenseAccountId: "5120",
    liabilityAccountId: "2180",
    sourceDocType: "HR_LEAVE_PROVISION",
  },
] as const;

export function getHrProvisionDefinition(kind: HrProvisionKind): HrProvisionDefinition {
  const definition = HR_PROVISION_DEFINITIONS.find((d) => d.kind === kind);
  if (!definition) throw new InvalidPayrollRunError([`نوع مخصص غير معروف: ${kind}`]);
  return definition;
}

export interface PostHrProvisionCommand {
  readonly kind: HrProvisionKind;
  /** "YYYY-MM-DD" — the entry's date, and the date the obligation was measured at. */
  readonly asOfDate: string;
  /** The obligation as the report computes it at `asOfDate`. */
  readonly computedTotal: Money;
  /** What the liability account already carries. The movement is the difference. */
  readonly postedBalance: Money;
}

export interface PostHrProvisionDeps {
  readonly gl: JournalPostingDeps;
}

export interface HrProvisionResult {
  readonly kind: HrProvisionKind;
  readonly asOfDate: string;
  readonly computedTotal: Money;
  readonly previousBalance: Money;
  readonly movement: Money;
  readonly journalEntryId: string;
}

export function hrProvisionMovement(computedTotal: Money, postedBalance: Money): Money {
  return Money.fromScaled(computedTotal.scaled - postedBalance.scaled);
}

export async function postHrProvision(cmd: PostHrProvisionCommand, deps: PostHrProvisionDeps): Promise<HrProvisionResult> {
  const definition = getHrProvisionDefinition(cmd.kind);
  const movement = hrProvisionMovement(cmd.computedTotal, cmd.postedBalance);
  if (movement.scaled === 0n) {
    throw new InvalidPayrollRunError([`${definition.labelAr} مطابق للمُقيَّد بالفعل — لا يوجد فرق يُرحَّل.`]);
  }

  const growing = movement.scaled > 0n;
  const amount = Money.fromScaled(growing ? movement.scaled : -movement.scaled);
  const lines: JournalLineInput[] = growing
    ? [
        { accountId: definition.expenseAccountId, debit: amount, credit: Money.zero() },
        { accountId: definition.liabilityAccountId, debit: Money.zero(), credit: amount },
      ]
    : [
        { accountId: definition.liabilityAccountId, debit: amount, credit: Money.zero() },
        { accountId: definition.expenseAccountId, debit: Money.zero(), credit: amount },
      ];

  const entry = await postJournalEntry(
    {
      id: await nextEntryGenerationId(deps.gl.ledger, `HR-PROVISION:${cmd.kind}:${cmd.asOfDate}`),
      date: cmd.asOfDate,
      memo: `${definition.labelAr} — تسوية حتى ${cmd.asOfDate}`,
      source: "system",
      sourceDocType: definition.sourceDocType,
      sourceDocId: provisionSourceDocId(cmd.kind, cmd.asOfDate),
      sourceDocNumber: `${definition.labelAr} ${cmd.asOfDate}`,
      lines,
    },
    deps.gl,
    { mintedBySystem: true },
  );

  return {
    kind: cmd.kind,
    asOfDate: cmd.asOfDate,
    computedTotal: cmd.computedTotal,
    previousBalance: cmd.postedBalance,
    movement,
    journalEntryId: entry.id,
  };
}

function provisionSourceDocId(kind: HrProvisionKind, asOfDate: string): string {
  return `${kind}:${asOfDate}`;
}

export interface HrProvisionPosting {
  readonly kind: HrProvisionKind;
  readonly asOfDate: string;
  readonly entry: JournalEntry;
  readonly reversal: JournalEntry | null;
}

export async function listHrProvisionPostings(kind: HrProvisionKind, gl: Pick<JournalPostingDeps, "ledger">): Promise<HrProvisionPosting[]> {
  const definition = getHrProvisionDefinition(kind);
  const entries = await gl.ledger.list({ sourceDocTypes: [definition.sourceDocType] });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return entries
    .filter((entry) => !entry.reversesEntryId && entry.status !== "draft")
    .map((entry) => ({
      kind,
      asOfDate: entry.date.slice(0, 10),
      entry,
      reversal: entry.reversedByEntryId ? (byId.get(entry.reversedByEntryId) ?? null) : null,
    }))
    .sort((a, b) => (a.asOfDate === b.asOfDate ? 0 : a.asOfDate < b.asOfDate ? 1 : -1));
}

export interface ReverseHrProvisionOptions {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
}

export interface HrProvisionReversalResult {
  readonly kind: HrProvisionKind;
  readonly asOfDate: string;
  readonly journalEntryId: string;
  readonly reversal: JournalEntry;
}

export async function reverseHrProvision(kind: HrProvisionKind, asOfDate: string, deps: PostHrProvisionDeps, opts: ReverseHrProvisionOptions): Promise<HrProvisionReversalResult> {
  const definition = getHrProvisionDefinition(kind);
  const standing = (await listHrProvisionPostings(kind, deps.gl)).filter((posting) => posting.entry.status === "posted");
  const target = standing.find((posting) => posting.asOfDate === asOfDate);
  if (!target) throw new HrProvisionPostingNotFoundError(definition.labelAr, asOfDate);
  const later = standing.filter((posting) => posting.asOfDate > asOfDate).sort((a, b) => (a.asOfDate < b.asOfDate ? 1 : -1))[0];
  if (later) throw new HrProvisionLaterPostingError(definition.labelAr, asOfDate, later.asOfDate);
  const date = opts.date ?? asOfDate;
  if (date < asOfDate) throw new ReversalDateBeforeOriginalError(target.entry.id, date, target.entry.date);

  return deps.gl.ledger.transaction(async () => {
    const { reversal } = await reverseJournalEntry(target.entry.id, deps.gl, {
      reversalId: opts.reversalId,
      date,
      memo: opts.memo ?? `عكس ${definition.labelAr} — تسوية ${asOfDate}`,
    });
    if (deps.gl.audit) {
      await recordSensitiveEvent(deps.gl.audit, {
        module: "hr",
        entityType: definition.sourceDocType,
        entityId: provisionSourceDocId(kind, asOfDate),
        action: "REVERSE",
        actor: deps.gl.actor ?? "system",
        severity: "WARNING",
        details: { kind, asOfDate, journalEntryId: target.entry.id, reversalId: reversal.id, reversalNo: reversal.entryNo ?? null, date },
      });
    }
    return { kind, asOfDate, journalEntryId: target.entry.id, reversal };
  });
}
