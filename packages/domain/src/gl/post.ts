import { Money } from "../money/index.js";
import type {
  JournalEntry,
  JournalLine,
  JournalEntrySource,
} from "../journal.js";
import type { AccountRepository } from "../accounts/account.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { HeaderAccountNotPostableError } from "../accounts/errors.js";
import type { FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";
import { assertOpenForPosting } from "../fiscal-periods/transitions.js";
import { NoFiscalPeriodForDateError } from "../fiscal-periods/errors.js";
import { NextNumberService } from "../numbering/index.js";
import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import {
  UnbalancedEntryError,
  InvalidJournalEntryError,
} from "../post-journal-entry.js";
import type { LedgerRepository } from "./ledger.js";
import type { GlEventPublisher } from "./events.js";
import {
  DuplicateJournalEntryError,
  InactiveAccountError,
  JournalEntryNotDraftError,
  JournalEntryNotFoundError,
} from "./errors.js";

/** Sequence code the JE numbering engine uses (numbering/sequences.ts). */
const JOURNAL_ENTRY_SEQUENCE = "JOURNAL_ENTRY";

/** A debit/credit line as supplied to the engine. */
export interface JournalLineInput {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo?: string | null;
  /** Optional cost-center dimension ("مركز التكلفة"), for the Cost Center P&L report. */
  readonly costCenterId?: string | null;
  /** Original transaction currency of a multi-currency line; debit/credit stay base-currency. */
  readonly currency?: string | null;
  /** Foreign→base exchange rate applied at confirmation, as an exact decimal string. */
  readonly fxRate?: string | null;
  /** VAT rate this line was charged at, so the VAT return can report the rates actually charged (D28). */
  readonly taxRatePercent?: number | null;
}

/** Command to create/post a journal entry. */
export interface CreateJournalEntryCommand {
  readonly id: string;
  /** ISO date (YYYY-MM-DD) the entry is dated into (drives the period gate). */
  readonly date: string;
  readonly memo: string;
  /** Defaults to "manual". Document-driven callers pass "system". */
  readonly source?: JournalEntrySource;
  /**
   * The document behind the entry (R6.3) — the journal list derives its
   * source-module column from this rather than storing the module separately,
   * which would be a second source of truth that could disagree.
   */
  readonly sourceDocType?: string | null;
  readonly sourceDocId?: string | null;
  readonly sourceDocNumber?: string | null;
  readonly lines: readonly JournalLineInput[];
}

/**
 * Ports the GL posting engine depends on. `ledger` and `numbering` MUST be
 * backed by the same connection/transaction so number allocation and the entry
 * insert are atomic (no-gap numbering, docs/plan.md §3 rule 5).
 */
export interface JournalPostingDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate">;
  /**
   * Filed VAT returns. A separate lock from the fiscal period, answering a
   * separate question: a tenant can legitimately have an open accounting period
   * whose VAT has already gone to the authority, and a document dated into it
   * would silently restate a submitted return (D29). Omit and nothing is
   * checked, which is how every caller behaved before filings existed.
   */
  readonly vatFilings?: { findCovering(date: string): Promise<readonly { id: string; status: string }[]> };
  readonly numbering: NextNumberService;
  readonly audit?: AuditSink;
  readonly events?: GlEventPublisher;
  /** ISO-8601 UTC "now"; overridable for deterministic tests. */
  readonly now?: () => string;
  /** Audit actor; defaults to "system". */
  readonly actor?: string;
}

function nowIso(deps: JournalPostingDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

function toLine(input: JournalLineInput): JournalLine {
  return {
    accountId: input.accountId,
    debit: input.debit,
    credit: input.credit,
    memo: input.memo ?? null,
    costCenterId: input.costCenterId ?? null,
    currency: input.currency ?? null,
    fxRate: input.fxRate ?? null,
    taxRatePercent: input.taxRatePercent ?? null,
  };
}

/**
 * Structural validation (docs/catalog/04): a journal entry needs at least two
 * lines, every line targets an account, no line is both a debit and a credit,
 * and no amount is negative (a "negative debit" is a credit — model it as one).
 */
export function assertEntryStructure(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new InvalidJournalEntryError("A journal entry requires at least two lines.");
  }
  for (const line of lines) {
    if (line.accountId.trim() === "") {
      throw new InvalidJournalEntryError("Every journal line must target an account.");
    }
    const debitNeg = line.debit.scaled < 0n;
    const creditNeg = line.credit.scaled < 0n;
    if (debitNeg || creditNeg) {
      throw new InvalidJournalEntryError(
        `Journal line for account "${line.accountId}" has a negative amount; use the opposite side instead.`,
      );
    }
    const hasDebit = line.debit.scaled !== 0n;
    const hasCredit = line.credit.scaled !== 0n;
    if (hasDebit && hasCredit) {
      throw new InvalidJournalEntryError(
        `Journal line for account "${line.accountId}" cannot be both a debit and a credit.`,
      );
    }
    if (!hasDebit && !hasCredit) {
      throw new InvalidJournalEntryError(
        `Journal line for account "${line.accountId}" must have a non-zero debit or credit.`,
      );
    }
  }
}

/** The double-entry invariant: Σ debit = Σ credit (docs/plan.md §3 rule 2). */
export function assertBalanced(lines: readonly JournalLineInput[]): {
  totalDebit: Money;
  totalCredit: Money;
} {
  const totalDebit = Money.sum(lines.map((l) => l.debit));
  const totalCredit = Money.sum(lines.map((l) => l.credit));
  if (!totalDebit.equals(totalCredit)) {
    throw new UnbalancedEntryError(totalDebit, totalCredit);
  }
  return { totalDebit, totalCredit };
}

/**
 * Every referenced account must exist, be a postable (detail, non-header)
 * account, and be active (docs/catalog/04: only حساب تفصيلي leaves accept
 * journal lines; inactive accounts are blocked).
 */
export async function assertLinesPostable(
  lines: readonly JournalLineInput[],
  accounts: Pick<AccountRepository, "findById">,
): Promise<void> {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.accountId)) continue;
    seen.add(line.accountId);
    const account = await accounts.findById(line.accountId);
    if (!account) throw new AccountNotFoundError(line.accountId);
    if (account.isHeader) throw new HeaderAccountNotPostableError(account.id);
    if (account.status !== "active") throw new InactiveAccountError(account.id);
  }
}

/** The period covering `date` must exist and be مفتوحة (open) — the period gate. */
export async function assertPeriodOpen(
  date: string,
  periods: Pick<FiscalPeriodRepository, "findByDate">,
): Promise<void> {
  const period = await periods.findByDate(date);
  if (!period) throw new NoFiscalPeriodForDateError(date);
  assertOpenForPosting(period);
}

/** The period's VAT return must not have been filed — see `vatFilings` above. */
export async function assertVatNotFiled(
  date: string,
  filings: { findCovering(date: string): Promise<readonly { id: string; status: string }[]> } | undefined,
): Promise<void> {
  if (!filings) return;
  const live = (await filings.findCovering(date)).find((f) => f.status === "filed");
  if (live) throw new VatPeriodAlreadyFiledError(live.id, date);
}

/**
 * Create a مسودة (draft) journal entry: structurally valid, balanced, and
 * targeting postable accounts — but NOT yet number-stamped and NOT period-gated
 * (a draft may be dated into any period; the gate is enforced when it posts).
 */
export async function createJournalEntry(
  cmd: CreateJournalEntryCommand,
  deps: JournalPostingDeps,
): Promise<JournalEntry> {
  assertEntryStructure(cmd.lines);
  assertBalanced(cmd.lines);
  await assertLinesPostable(cmd.lines, deps.accounts);

  return deps.ledger.transaction(async () => {
    if (await deps.ledger.findById(cmd.id)) {
      throw new DuplicateJournalEntryError(cmd.id);
    }
    const entry: JournalEntry = {
      id: cmd.id,
      entryNo: null,
      date: cmd.date,
      memo: cmd.memo,
      status: "draft",
      source: cmd.source ?? "manual",
      sourceDocType: cmd.sourceDocType ?? null,
      sourceDocId: cmd.sourceDocId ?? null,
      sourceDocNumber: cmd.sourceDocNumber ?? null,
      lines: cmd.lines.map(toLine),
      createdAt: nowIso(deps),
      postedAt: null,
      reversesEntryId: null,
      reversedByEntryId: null,
    };
    await deps.ledger.save(entry);
    return entry;
  });
}

/**
 * Create AND post a journal entry in one atomic step — the common path for both
 * system-generated entries (a confirmed document posts its GL entry directly)
 * and a manual entry the user posts straight away.
 *
 * Enforces, in order: structure, Σdebit=Σcredit, postable/active accounts, and
 * the period-open gate. Then, inside ONE transaction: allocates the next
 * JE number, writes the "posted" entry, records a sensitive audit event, and
 * publishes JOURNAL_ENTRY_POSTED.
 */
export async function postJournalEntry(
  cmd: CreateJournalEntryCommand,
  deps: JournalPostingDeps,
): Promise<JournalEntry> {
  assertEntryStructure(cmd.lines);
  const { totalDebit, totalCredit } = assertBalanced(cmd.lines);
  await assertLinesPostable(cmd.lines, deps.accounts);
  await assertPeriodOpen(cmd.date, deps.periods);
  await assertVatNotFiled(cmd.date, deps.vatFilings);

  const entry = await deps.ledger.transaction(async () => {
    if (await deps.ledger.findById(cmd.id)) {
      throw new DuplicateJournalEntryError(cmd.id);
    }
    const stamp = nowIso(deps);
    const number = await deps.numbering.next(JOURNAL_ENTRY_SEQUENCE);
    const posted: JournalEntry = {
      id: cmd.id,
      entryNo: number.formatted,
      date: cmd.date,
      memo: cmd.memo,
      status: "posted",
      source: cmd.source ?? "manual",
      sourceDocType: cmd.sourceDocType ?? null,
      sourceDocId: cmd.sourceDocId ?? null,
      sourceDocNumber: cmd.sourceDocNumber ?? null,
      lines: cmd.lines.map(toLine),
      createdAt: stamp,
      postedAt: stamp,
      reversesEntryId: null,
      reversedByEntryId: null,
    };
    await deps.ledger.save(posted);
    return posted;
  });

  await emitPosted(entry, totalDebit, totalCredit, deps);
  return entry;
}

/**
 * Post an existing مسودة (draft) entry: draft → posted. Re-checks balance,
 * postable accounts and the period gate at post time (a period may have closed
 * since the draft was saved), then stamps the JE number and posting time.
 */
export async function postDraftJournalEntry(
  entryId: string,
  deps: JournalPostingDeps,
): Promise<JournalEntry> {
  const existing = await deps.ledger.findById(entryId);
  if (!existing) throw new JournalEntryNotFoundError(entryId);
  if (existing.status !== "draft") {
    throw new JournalEntryNotDraftError(entryId, existing.status);
  }

  assertEntryStructure(existing.lines);
  const { totalDebit, totalCredit } = assertBalanced(existing.lines);
  await assertLinesPostable(existing.lines, deps.accounts);
  await assertPeriodOpen(existing.date, deps.periods);
  await assertVatNotFiled(existing.date, deps.vatFilings);

  const entry = await deps.ledger.transaction(async () => {
    const number = await deps.numbering.next(JOURNAL_ENTRY_SEQUENCE);
    const posted: JournalEntry = {
      ...existing,
      entryNo: number.formatted,
      status: "posted",
      postedAt: nowIso(deps),
    };
    await deps.ledger.update(posted);
    return posted;
  });

  await emitPosted(entry, totalDebit, totalCredit, deps);
  return entry;
}

async function emitPosted(
  entry: JournalEntry,
  totalDebit: Money,
  totalCredit: Money,
  deps: JournalPostingDeps,
): Promise<void> {
  if (deps.audit) {
    await recordSensitiveEvent(deps.audit, {
      module: "accounting",
      entityType: "JOURNAL_ENTRY",
      entityId: entry.id,
      action: "POST",
      actor: deps.actor ?? "system",
      severity: "INFO",
      details: {
        entryId: entry.id,
        entryNo: entry.entryNo,
        date: entry.date,
        source: entry.source ?? "manual",
        totalDebit: totalDebit.toString(),
        lineCount: entry.lines.length,
      },
    });
  }
  deps.events?.publish({
    type: "JOURNAL_ENTRY_POSTED",
    entryId: entry.id,
    entryNo: entry.entryNo ?? null,
    date: entry.date,
    source: entry.source ?? "manual",
    totalDebit,
    totalCredit,
    occurredAt: entry.postedAt ?? nowIso(deps),
  });
}
