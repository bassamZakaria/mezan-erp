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
import { isCostCategory } from "../contracting/cost-category.js";
import type { ProjectRepository } from "../projects/project.js";
import { ProjectNotFoundError } from "../projects/errors.js";
import type { GlEventPublisher } from "./events.js";
import {
  DuplicateJournalEntryError,
  InactiveAccountError,
  InvalidJournalPartyError,
  JournalEntryNotDraftError,
  JournalEntryNotFoundError,
  PartyRequiredOnControlAccountError,
  type PartyControlKind,
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
  readonly taxRateId?: string | null;
  /** بُعد المشروع (D-01). Validated against `deps.projects` when that port is supplied. */
  readonly projectId?: string | null;
  /** فئة التكلفة — rejected without a `projectId`, because a category with no project is a figure nothing can roll up. */
  readonly costCategory?: JournalLine["costCategory"];
  /** بُعد الفرع (DEC-20). Nullable — a line with no branch lands in the statements' «غير مخصص» bucket. */
  readonly branchId?: string | null;
  /** The customer/supplier of a line on a party control account (D205). */
  readonly partyId?: string | null;
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
 * insert are atomic (no-gap numbering, docs/archive/plan.md §3 rule 5).
 */
export interface JournalPostingDeps {
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate"> & Partial<Pick<FiscalPeriodRepository, "list">>;
  /**
   * Filed VAT returns. A separate lock from the fiscal period, answering a
   * separate question: a tenant can legitimately have an open accounting period
   * whose VAT has already gone to the authority, and a document dated into it
   * would silently restate a submitted return (D29). Omit and nothing is
   * checked, which is how every caller behaved before filings existed.
   */
  readonly vatFilings?: { findCovering(date: string): Promise<readonly { id: string; status: string }[]> };
  readonly numbering: NextNumberService;
  /**
   * Projects, so a line's `projectId` names a project that exists. Optional
   * because the in-memory ledgers of older compositions carry no projects;
   * every composition that posts contracting cost must supply it.
   */
  readonly projects?: Pick<ProjectRepository, "findById">;
  /**
   * Accounts whose lines MUST name a project — the routed contracting control
   * and cost slots. A hand-written journal that moves 1230/1150/2160/… with no
   * `projectId` is a figure no project report can ever roll up, and the module
   * that owns the account has no way to reconcile it. Omit and nothing is
   * checked, which is how every composition behaved before the set existed.
   */
  readonly projectRequiredAccountIds?: ReadonlySet<string>;
  /**
   * The party control accounts and which party each one's lines must name
   * (D205). Supplied for the hand-written journal only: a document posting
   * leaves `partyId` null because its document is the sub-ledger record.
   */
  readonly partyControlAccounts?: ReadonlyMap<string, PartyControlKind>;
  /** Whether a named party exists; checked only when `partyControlAccounts` is supplied. */
  readonly partyExists?: (kind: PartyControlKind, id: string) => Promise<boolean>;
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
    taxRateId: input.taxRateId ?? null,
    projectId: input.projectId ?? null,
    costCategory: input.costCategory ?? null,
    branchId: input.branchId ?? null,
    partyId: input.partyId ?? null,
  };
}

/**
 * Structural validation (docs/archive/catalog/04): a journal entry needs at least two
 * lines, every line targets an account, no line is both a debit and a credit,
 * and no amount is negative (a "negative debit" is a credit — model it as one).
 */
export function assertEntryStructure(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new InvalidJournalEntryError("قيد اليومية يحتاج سطرين على الأقل.", "A journal entry requires at least two lines.");
  }
  for (const line of lines) {
    if (line.accountId.trim() === "") {
      throw new InvalidJournalEntryError("كل سطر في القيد يجب أن يحدد حساباً.", "Every journal line must target an account.");
    }
    const debitNeg = line.debit.scaled < 0n;
    const creditNeg = line.credit.scaled < 0n;
    if (debitNeg || creditNeg) {
      throw new InvalidJournalEntryError(
        `سطر القيد على الحساب "${line.accountId}" يحمل مبلغاً سالباً؛ سجّله في الطرف المقابل.`,
        `Journal line for account "${line.accountId}" has a negative amount; use the opposite side instead.`,
      );
    }
    const hasDebit = line.debit.scaled !== 0n;
    const hasCredit = line.credit.scaled !== 0n;
    if (hasDebit && hasCredit) {
      throw new InvalidJournalEntryError(
        `سطر القيد على الحساب "${line.accountId}" لا يكون مديناً ودائناً معاً.`,
        `Journal line for account "${line.accountId}" cannot be both a debit and a credit.`,
      );
    }
    if (!hasDebit && !hasCredit) {
      throw new InvalidJournalEntryError(
        `سطر القيد على الحساب "${line.accountId}" يجب أن يحمل مبلغاً مديناً أو دائناً غير صفري.`,
        `Journal line for account "${line.accountId}" must have a non-zero debit or credit.`,
      );
    }
    if (line.costCategory != null && !isCostCategory(line.costCategory)) {
      throw new InvalidJournalEntryError(
        `سطر القيد على الحساب "${line.accountId}" يذكر بند تكلفة غير معروف "${String(line.costCategory)}".`,
        `Journal line for account "${line.accountId}" names an unknown cost category "${String(line.costCategory)}".`,
      );
    }
    if (line.costCategory != null && (line.projectId == null || line.projectId.trim() === "")) {
      throw new InvalidJournalEntryError(
        `سطر القيد على الحساب "${line.accountId}" يحمل بند تكلفة بلا مشروع.`,
        `Journal line for account "${line.accountId}" carries a cost category without a project.`,
      );
    }
  }
}

/** A posted entry is dated with a DAY, never an instant. */
const ENTRY_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The entry's date is a calendar day in `YYYY-MM-DD`. A poster that hands the
 * engine `new Date().toISOString()` produces an entry the period gate, the
 * trial balance's date range and every `fromDate`/`toDate` report compare as a
 * STRING against plain dates — so it silently falls outside its own month.
 */
export function assertEntryDate(date: string): void {
  if (!ENTRY_DATE.test(date)) {
    throw new InvalidJournalEntryError(
      `تاريخ القيد يجب أن يكون بصيغة YYYY-MM-DD — القيمة المرسلة "${date}".`,
    );
  }
}

/**
 * الحسابات النظامية (memorandum, 9xxx) are OFF balance sheet: every statement
 * this system prints drops them. An entry that mixes a memorandum line with a
 * real one is therefore balanced only as written and unbalanced as reported —
 * the balance-sheet identity breaks by exactly the memorandum leg. So each
 * partition has to balance on its own.
 */
export function assertMemorandumPartition(
  lines: readonly JournalLineInput[],
  accountTypeOf: (accountId: string) => string | undefined,
): void {
  let memoDebit = 0n;
  let memoCredit = 0n;
  let realDebit = 0n;
  let realCredit = 0n;
  for (const line of lines) {
    const memo = accountTypeOf(line.accountId) === "memorandum";
    if (memo) {
      memoDebit += line.debit.scaled;
      memoCredit += line.credit.scaled;
    } else {
      realDebit += line.debit.scaled;
      realCredit += line.credit.scaled;
    }
  }
  const hasMemo = memoDebit !== 0n || memoCredit !== 0n;
  const hasReal = realDebit !== 0n || realCredit !== 0n;
  if (!hasMemo || !hasReal) return;
  if (memoDebit !== memoCredit || realDebit !== realCredit) {
    throw new InvalidJournalEntryError(
      "لا يجوز خلط الحسابات النظامية بالحسابات الفعلية في قيد واحد ما لم يتوازن كل قسم منهما على حدة.",
    );
  }
}

/** Lines on an account the composition marked project-bound must carry a `projectId`. */
export function assertProjectRequired(
  lines: readonly JournalLineInput[],
  required: ReadonlySet<string> | undefined,
): void {
  if (!required || required.size === 0) return;
  for (const line of lines) {
    if (!required.has(line.accountId)) continue;
    if (line.projectId == null || line.projectId.trim() === "") {
      throw new InvalidJournalEntryError(
        `الحساب "${line.accountId}" حساب مشروعات — كل سطر عليه يجب أن يحمل مشروعاً.`,
      );
    }
  }
}

/**
 * A line on a party control account must name its customer or supplier, and a
 * line elsewhere must name none (D205). Omit `partyControlAccounts` and
 * nothing is checked.
 */
export async function assertPartyLines(
  lines: readonly JournalLineInput[],
  deps: Pick<JournalPostingDeps, "partyControlAccounts" | "partyExists">,
): Promise<void> {
  const controls = deps.partyControlAccounts;
  if (!controls) return;
  for (const line of lines) {
    const kind = controls.get(line.accountId);
    const partyId = line.partyId?.trim() ? line.partyId.trim() : null;
    if (!kind) {
      if (partyId) throw new InvalidJournalPartyError(line.accountId, partyId, "not_control");
      continue;
    }
    if (!partyId) throw new PartyRequiredOnControlAccountError(line.accountId, kind);
    if (deps.partyExists && !(await deps.partyExists(kind, partyId))) {
      throw new InvalidJournalPartyError(line.accountId, partyId, "not_found", kind);
    }
  }
}

/** Every `projectId` a line carries must name a project that exists — when the composition can check. */
export async function assertProjectsExist(
  lines: readonly JournalLineInput[],
  projects: Pick<ProjectRepository, "findById"> | undefined,
): Promise<void> {
  if (!projects) return;
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.projectId == null || seen.has(line.projectId)) continue;
    seen.add(line.projectId);
    if (!(await projects.findById(line.projectId))) throw new ProjectNotFoundError(line.projectId);
  }
}

/** The double-entry invariant: Σ debit = Σ credit (docs/archive/plan.md §3 rule 2). */
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
 * account, and be active (docs/archive/catalog/04: only حساب تفصيلي leaves accept
 * journal lines; inactive accounts are blocked).
 */
export async function assertLinesPostable(
  lines: readonly JournalLineInput[],
  accounts: Pick<AccountRepository, "findById">,
): Promise<void> {
  const typeById = new Map<string, string>();
  for (const line of lines) {
    if (typeById.has(line.accountId)) continue;
    const account = await accounts.findById(line.accountId);
    if (!account) throw new AccountNotFoundError(line.accountId);
    if (account.isHeader) throw new HeaderAccountNotPostableError(account.id);
    if (account.status !== "active") throw new InactiveAccountError(account.id);
    typeById.set(line.accountId, account.type);
  }
  assertMemorandumPartition(lines, (id) => typeById.get(id));
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
  assertEntryDate(cmd.date);
  assertEntryStructure(cmd.lines);
  assertBalanced(cmd.lines);
  assertProjectRequired(cmd.lines, deps.projectRequiredAccountIds);
  await assertLinesPostable(cmd.lines, deps.accounts);
  await assertProjectsExist(cmd.lines, deps.projects);
  await assertPartyLines(cmd.lines, deps);

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
  assertEntryDate(cmd.date);
  assertEntryStructure(cmd.lines);
  const { totalDebit, totalCredit } = assertBalanced(cmd.lines);
  assertProjectRequired(cmd.lines, deps.projectRequiredAccountIds);
  await assertLinesPostable(cmd.lines, deps.accounts);
  await assertProjectsExist(cmd.lines, deps.projects);
  await assertPartyLines(cmd.lines, deps);
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
    await recordPosted(posted, totalDebit, deps);
    return posted;
  });

  publishPosted(entry, totalDebit, totalCredit, deps);
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

  assertEntryDate(existing.date);
  assertEntryStructure(existing.lines);
  const { totalDebit, totalCredit } = assertBalanced(existing.lines);
  assertProjectRequired(existing.lines, deps.projectRequiredAccountIds);
  await assertLinesPostable(existing.lines, deps.accounts);
  await assertPartyLines(existing.lines, deps);
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
    await recordPosted(posted, totalDebit, deps);
    return posted;
  });

  publishPosted(entry, totalDebit, totalCredit, deps);
  return entry;
}

/** Command to overwrite a مسودة (draft) entry's date, memo and lines (D226). */
export interface ReplaceDraftJournalEntryCommand {
  readonly date: string;
  readonly memo: string;
  readonly source?: JournalEntrySource;
  readonly sourceDocType?: string | null;
  readonly sourceDocId?: string | null;
  readonly sourceDocNumber?: string | null;
  readonly lines: readonly JournalLineInput[];
}

/**
 * Overwrite a DRAFT entry in place — the industry-normal "edit a draft" a
 * legacy party-less line on 1105/2100 needs to become postable again (D226).
 * Refuses anything that is not `status === "draft"`; a posted or reversed
 * entry is corrected only by reversal, never by edit. Re-runs every structural
 * check `createJournalEntry` runs, so an edit cannot smuggle in what a create
 * would have refused.
 */
export async function replaceDraftJournalEntry(
  entryId: string,
  cmd: ReplaceDraftJournalEntryCommand,
  deps: JournalPostingDeps,
): Promise<JournalEntry> {
  const existing = await deps.ledger.findById(entryId);
  if (!existing) throw new JournalEntryNotFoundError(entryId);
  if (existing.status !== "draft") {
    throw new JournalEntryNotDraftError(entryId, existing.status);
  }

  assertEntryDate(cmd.date);
  assertEntryStructure(cmd.lines);
  assertBalanced(cmd.lines);
  assertProjectRequired(cmd.lines, deps.projectRequiredAccountIds);
  await assertLinesPostable(cmd.lines, deps.accounts);
  await assertProjectsExist(cmd.lines, deps.projects);
  await assertPartyLines(cmd.lines, deps);

  const entry: JournalEntry = {
    ...existing,
    date: cmd.date,
    memo: cmd.memo,
    source: cmd.source ?? existing.source ?? "manual",
    sourceDocType: cmd.sourceDocType !== undefined ? cmd.sourceDocType : existing.sourceDocType ?? null,
    sourceDocId: cmd.sourceDocId !== undefined ? cmd.sourceDocId : existing.sourceDocId ?? null,
    sourceDocNumber: cmd.sourceDocNumber !== undefined ? cmd.sourceDocNumber : existing.sourceDocNumber ?? null,
    lines: cmd.lines.map(toLine),
  };

  await deps.ledger.transaction(async () => {
    await deps.ledger.replaceDraft(entry);
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: "accounting",
        entityType: "JOURNAL_ENTRY",
        entityId: entry.id,
        action: "UPDATE",
        actor: deps.actor ?? "system",
        severity: "INFO",
        details: { entryId: entry.id, date: entry.date, lineCount: entry.lines.length },
      });
    }
  });

  return entry;
}

/**
 * Permanently remove a DRAFT entry — the industry-normal "discard a draft"
 * (D226). Refuses anything that is not `status === "draft"`; nothing ever
 * deletes a posted or reversed entry.
 */
export async function deleteDraftJournalEntry(
  entryId: string,
  deps: Pick<JournalPostingDeps, "ledger" | "audit" | "actor">,
): Promise<void> {
  const existing = await deps.ledger.findById(entryId);
  if (!existing) throw new JournalEntryNotFoundError(entryId);
  if (existing.status !== "draft") {
    throw new JournalEntryNotDraftError(entryId, existing.status);
  }

  await deps.ledger.transaction(async () => {
    await deps.ledger.deleteDraft(entryId);
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: "accounting",
        entityType: "JOURNAL_ENTRY",
        entityId: entryId,
        action: "DELETE",
        actor: deps.actor ?? "system",
        severity: "WARNING",
        details: { entryId, date: existing.date, memo: existing.memo },
      });
    }
  });
}

/**
 * The audit row belongs to the posting's OWN transaction: recorded after the
 * commit, a crash between the two left a posted entry nobody appended a record
 * for, and a rolled-back posting could still leave the record behind.
 */
async function recordPosted(entry: JournalEntry, totalDebit: Money, deps: JournalPostingDeps): Promise<void> {
  if (!deps.audit) return;
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

/** Outside the transaction on purpose: a subscriber that throws must not roll the posting back. */
function publishPosted(
  entry: JournalEntry,
  totalDebit: Money,
  totalCredit: Money,
  deps: JournalPostingDeps,
): void {
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
