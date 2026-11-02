import { Money } from "../../money/index.js";
import type { ReasonInput } from "../../bilingual-reasons.js";
import type { AccountRepository } from "../../accounts/account.js";
import { routedAccountId, type AccountRoutingRepository } from "../../accounts/account-routing.js";
import type { ProjectRepository } from "../../projects/project.js";
import type { TreasuryAccountRepository } from "../../treasury-accounts/treasury-account.js";
import type { AuditSink } from "../../audit/index.js";
import { recordTransition } from "../audit.js";
import { nextEntryGenerationId, postJournalEntry, reverseJournalEntry, ReversalDateBeforeOriginalError, standingEntryGeneration, type JournalLineInput, type JournalPostingDeps } from "../../gl/index.js";
import type { JournalEntry } from "../../journal.js";
import {
  daysToExpiry,
  derivedGuaranteeStatus,
  guaranteeMarginOf,
  isGuaranteeKind,
  isGuaranteeOutstanding,
  type ContractExistencePort,
  type GuaranteeKind,
  type GuaranteeReduction,
  type LetterOfGuarantee,
  type LetterOfGuaranteeRepository,
} from "./guarantee.js";
import {
  GuaranteeAmountExceedsValueError,
  GuaranteeBankAccountInvalidError,
  GuaranteeChargeAccountNotFoundError,
  GuaranteeNotDraftError,
  GuaranteeNotFoundError,
  GuaranteeNothingToReverseError,
  GuaranteePostingFromDocumentError,
  InvalidGuaranteeError,
  InvalidGuaranteeTransitionError,
} from "./errors.js";
import { tenantTodayIso } from "../../dates.js";

/**
 * سجل خطابات الضمان — the register's use cases and the ledger behind them
 * (design §05). Every status move posts ONE balanced journal entry through the
 * real GL engine, dated with the DOCUMENT's date, numbered from the
 * transactional counter, and gated by the fiscal period like any other posting.
 */

/** The document type stamped on every journal entry this service posts. */
export const GUARANTEE_DOC_TYPE = "LETTER_OF_GUARANTEE";

/** The numbering sequence the register draws `LG-…` numbers from. */
const GUARANTEE_SEQUENCE = "LETTER_OF_GUARANTEE";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d+(\.\d+)?$/;

export interface GuaranteeServiceDeps {
  readonly guarantees: LetterOfGuaranteeRepository;
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly accounts: Pick<AccountRepository, "findById">;
  /** Projects, so a `projectId` names a project that exists. */
  readonly projects?: Pick<ProjectRepository, "findById">;
  /** Supplied by the contracts slice. Omitted, a `contractId` is kept as an opaque reference. */
  readonly contracts?: ContractExistencePort;
  readonly routing?: Pick<AccountRoutingRepository, "get">;
  readonly gl: JournalPostingDeps;
  /** سجل العمليات الحساسة — a letter of guarantee locks the company's cash, so every move is recorded. */
  readonly audit?: AuditSink;
  /** ISO `YYYY-MM-DD` "today", overridable for deterministic tests. */
  readonly today?: () => string;
}

/** Who is acting. Stamped on the row and named in the audit trail. */
export interface GuaranteeActor {
  readonly userId: string;
}

export interface CreateGuaranteeCommand {
  readonly id: string;
  readonly kind: GuaranteeKind;
  readonly projectId?: string | null;
  readonly contractId?: string | null;
  readonly tenderRef?: string | null;
  readonly beneficiaryNameAr: string;
  readonly bankTreasuryAccountId: string;
  readonly faceValue: Money;
  readonly percentOfContract?: string | null;
  readonly cashMarginPercent?: string;
  /** Overrides the computed face × margin%. Omitted, the percentage decides. */
  readonly cashMarginAmount?: Money;
  readonly issueDate: string;
  readonly expiryDate: string;
  readonly notes?: string | null;
}

export interface UpdateGuaranteeCommand {
  readonly kind?: GuaranteeKind;
  readonly projectId?: string | null;
  readonly contractId?: string | null;
  readonly tenderRef?: string | null;
  readonly beneficiaryNameAr?: string;
  readonly bankTreasuryAccountId?: string;
  readonly faceValue?: Money;
  readonly percentOfContract?: string | null;
  readonly cashMarginPercent?: string;
  readonly cashMarginAmount?: Money;
  readonly issueDate?: string;
  readonly expiryDate?: string;
  readonly notes?: string | null;
}

export interface ReduceGuaranteeCommand {
  readonly date: string;
  readonly amount: Money;
  readonly reason: string;
  readonly sourceRef?: string | null;
  /** WHO. Null only when a background port (the certificate's own recovery) acts. */
  readonly userId?: string | null;
}

export interface ReleaseGuaranteeCommand {
  readonly date: string;
  readonly userId?: string | null;
}

export interface CallGuaranteeCommand {
  readonly date: string;
  readonly userId?: string | null;
  /** Omitted, the beneficiary draws the whole outstanding value. */
  readonly amount?: Money;
  /** Where the loss lands. Omitted, the `contracting.onerous_loss` routing slot decides. */
  readonly chargeAccountId?: string | null;
}

export interface ReverseGuaranteePostingCommand {
  readonly reversalId: string;
  readonly date?: string;
  readonly memo?: string;
  readonly userId?: string | null;
}

interface GuaranteePostingStep {
  readonly action: string;
  readonly entry: JournalEntry;
  readonly sourceRef: string | null;
  readonly restored: LetterOfGuarantee;
}

export class GuaranteeService {
  constructor(private readonly deps: GuaranteeServiceDeps) {}

  private today(): string {
    return this.deps.today ? this.deps.today() : tenantTodayIso();
  }

  private async routed(key: string, fallback: string): Promise<string> {
    const routing = this.deps.routing ? await this.deps.routing.get() : null;
    return routedAccountId(routing, key) ?? fallback;
  }

  /** The bank's GL account. A treasury account with none cannot post, and guessing one is how a margin lands in the wrong cash account. */
  private async bankGlAccountId(treasuryAccountId: string): Promise<string> {
    const treasury = await this.deps.treasuryAccounts.findById(treasuryAccountId);
    if (!treasury) {
      throw new GuaranteeBankAccountInvalidError(treasuryAccountId, `حساب الخزينة "${treasuryAccountId}" غير موجود.`, `Treasury account "${treasuryAccountId}" was not found.`);
    }
    if (treasury.glAccountId === null) {
      throw new GuaranteeBankAccountInvalidError(
        treasuryAccountId,
        `حساب الخزينة "${treasury.name}" ليس له حساب أستاذ، فلا يمكن ترحيل الغطاء النقدي عليه.`,
        `Treasury account "${treasury.name}" has no ledger account, so the cash margin cannot be posted to it.`,
      );
    }
    return treasury.glAccountId;
  }

  private async validate(
    draft: {
      kind: unknown;
      projectId: string | null;
      contractId: string | null;
      tenderRef: string | null;
      beneficiaryNameAr: string;
      bankTreasuryAccountId: string;
      faceValue: Money;
      cashMarginPercent: string;
      cashMarginAmount: Money;
      issueDate: string;
      expiryDate: string;
      percentOfContract: string | null;
    },
  ): Promise<void> {
    const reasons: ReasonInput[] = [];
    if (!isGuaranteeKind(draft.kind)) reasons.push({ ar: "نوع خطاب الضمان غير معروف.", en: "The letter of guarantee type is unknown." });
    if (draft.beneficiaryNameAr.trim() === "") reasons.push({ ar: "اسم المستفيد مطلوب.", en: "The beneficiary name is required." });
    if (draft.faceValue.scaled <= 0n) reasons.push({ ar: "القيمة الاسمية يجب أن تكون أكبر من صفر.", en: "The face value must be greater than zero." });
    if (!ISO_DATE.test(draft.issueDate)) reasons.push({ ar: "تاريخ الإصدار غير صحيح.", en: "The issue date is not valid." });
    if (!ISO_DATE.test(draft.expiryDate)) reasons.push({ ar: "تاريخ الانتهاء غير صحيح.", en: "The expiry date is not valid." });
    if (ISO_DATE.test(draft.issueDate) && ISO_DATE.test(draft.expiryDate) && draft.expiryDate <= draft.issueDate) {
      reasons.push({ ar: "تاريخ الانتهاء يجب أن يكون بعد تاريخ الإصدار.", en: "The expiry date must be after the issue date." });
    }
    if (!DECIMAL.test(draft.cashMarginPercent)) reasons.push({ ar: "نسبة الغطاء النقدي غير صحيحة.", en: "The cash margin percentage is not valid." });
    if (draft.percentOfContract !== null && !DECIMAL.test(draft.percentOfContract)) {
      reasons.push({ ar: "نسبة الخطاب من قيمة العقد غير صحيحة.", en: "The letter's percentage of the contract value is not valid." });
    }
    if (draft.cashMarginAmount.scaled < 0n) reasons.push({ ar: "قيمة الغطاء النقدي لا يمكن أن تكون سالبة.", en: "The cash margin amount cannot be negative." });
    if (draft.cashMarginAmount.scaled > draft.faceValue.scaled) {
      reasons.push({ ar: "قيمة الغطاء النقدي لا يمكن أن تتجاوز القيمة الاسمية للخطاب.", en: "The cash margin amount cannot exceed the face value of the letter." });
    }
    // A letter with neither a project nor a tender reference belongs to nothing
    // — the register's whole purpose is reporting exposure BY project and BY bank.
    if (draft.projectId === null && (draft.tenderRef === null || draft.tenderRef.trim() === "")) {
      reasons.push({ ar: "يجب ربط الخطاب بمشروع أو بمرجع مناقصة.", en: "The letter must be linked to a project or a tender reference." });
    }
    if (draft.projectId !== null && this.deps.projects) {
      if (!(await this.deps.projects.findById(draft.projectId))) {
        reasons.push({ ar: `المشروع "${draft.projectId}" غير موجود.`, en: `Project "${draft.projectId}" was not found.` });
      }
    }
    if (draft.contractId !== null && this.deps.contracts) {
      if (!(await this.deps.contracts.exists(draft.contractId))) {
        reasons.push({ ar: `العقد "${draft.contractId}" غير موجود.`, en: `Contract "${draft.contractId}" was not found.` });
      }
    }
    if (reasons.length > 0) throw new InvalidGuaranteeError(reasons);

    const treasury = await this.deps.treasuryAccounts.findById(draft.bankTreasuryAccountId);
    if (!treasury) {
      throw new GuaranteeBankAccountInvalidError(
        draft.bankTreasuryAccountId,
        `حساب الخزينة "${draft.bankTreasuryAccountId}" غير موجود.`,
        `Treasury account "${draft.bankTreasuryAccountId}" was not found.`,
      );
    }
    if (treasury.type !== "bank") {
      throw new GuaranteeBankAccountInvalidError(
        draft.bankTreasuryAccountId,
        `خطاب الضمان يصدر عن حساب بنكي — "${treasury.name}" حساب نقدي.`,
        `A letter of guarantee is issued from a bank account — "${treasury.name}" is a cash account.`,
      );
    }
  }

  private async bankName(treasuryAccountId: string): Promise<string> {
    const treasury = await this.deps.treasuryAccounts.findById(treasuryAccountId);
    return treasury?.name ?? treasuryAccountId;
  }

  async createDraft(command: CreateGuaranteeCommand): Promise<LetterOfGuarantee> {
    const cashMarginPercent = command.cashMarginPercent ?? "20";
    const cashMarginAmount = command.cashMarginAmount ?? guaranteeMarginOf(command.faceValue, cashMarginPercent);
    const shape = {
      kind: command.kind,
      projectId: command.projectId ?? null,
      contractId: command.contractId ?? null,
      tenderRef: command.tenderRef ?? null,
      beneficiaryNameAr: command.beneficiaryNameAr,
      bankTreasuryAccountId: command.bankTreasuryAccountId,
      faceValue: command.faceValue,
      cashMarginPercent,
      cashMarginAmount,
      issueDate: command.issueDate,
      expiryDate: command.expiryDate,
      percentOfContract: command.percentOfContract ?? null,
    };
    await this.validate(shape);

    const guarantee: LetterOfGuarantee = {
      id: command.id,
      docNo: null,
      ...shape,
      kind: command.kind,
      bankNameAr: await this.bankName(command.bankTreasuryAccountId),
      status: "draft",
      currentValue: command.faceValue,
      reductions: [],
      restorations: [],
      closedDate: null,
      closedBy: null,
      closedAmount: Money.zero(),
      notes: command.notes ?? null,
    };
    await this.deps.guarantees.create(guarantee);
    return guarantee;
  }

  async updateDraft(id: string, command: UpdateGuaranteeCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (current.status !== "draft") throw new GuaranteeNotDraftError(id, current.status);

    const faceValue = command.faceValue ?? current.faceValue;
    const cashMarginPercent = command.cashMarginPercent ?? current.cashMarginPercent;
    // A new face value or percentage recomputes the margin unless the caller
    // states one — the two must never disagree on a draft nobody has issued.
    const cashMarginAmount =
      command.cashMarginAmount ??
      (command.faceValue !== undefined || command.cashMarginPercent !== undefined
        ? guaranteeMarginOf(faceValue, cashMarginPercent)
        : current.cashMarginAmount);
    const bankTreasuryAccountId = command.bankTreasuryAccountId ?? current.bankTreasuryAccountId;
    const shape = {
      kind: command.kind ?? current.kind,
      projectId: command.projectId !== undefined ? command.projectId : current.projectId,
      contractId: command.contractId !== undefined ? command.contractId : current.contractId,
      tenderRef: command.tenderRef !== undefined ? command.tenderRef : current.tenderRef,
      beneficiaryNameAr: command.beneficiaryNameAr ?? current.beneficiaryNameAr,
      bankTreasuryAccountId,
      faceValue,
      cashMarginPercent,
      cashMarginAmount,
      issueDate: command.issueDate ?? current.issueDate,
      expiryDate: command.expiryDate ?? current.expiryDate,
      percentOfContract:
        command.percentOfContract !== undefined ? command.percentOfContract : current.percentOfContract,
    };
    await this.validate(shape);

    const updated: LetterOfGuarantee = {
      ...current,
      ...shape,
      kind: shape.kind as GuaranteeKind,
      bankNameAr:
        bankTreasuryAccountId === current.bankTreasuryAccountId
          ? current.bankNameAr
          : await this.bankName(bankTreasuryAccountId),
      currentValue: faceValue,
      notes: command.notes !== undefined ? command.notes : current.notes,
    };
    await this.deps.guarantees.update(updated);
    return updated;
  }

  /**
   * إصدار — the bank issues the letter. Posts the memorandum pair for the face
   * value (Dr 9100 / Cr 9200) and, when there is one, the cash margin out of
   * the bank into restricted cash (Dr 1340 / Cr bank), as ONE balanced entry so
   * neither half can exist without the other.
   */
  async issue(id: string, actor?: GuaranteeActor): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (current.status !== "draft") throw new InvalidGuaranteeTransitionError(current.status, "active");

    const [memoDebit, memoCredit, restrictedCash] = await Promise.all([
      this.routed("contracting.memo_debit", "9100"),
      this.routed("contracting.memo_credit", "9200"),
      this.routed("contracting.restricted_cash", "1340"),
    ]);

    const lines: JournalLineInput[] = [
      this.memoLine(memoDebit, current.faceValue, "debit", current, "القيمة الاسمية لخطاب الضمان"),
      this.memoLine(memoCredit, current.faceValue, "credit", current, "التزام عرضي — خطاب ضمان"),
    ];
    if (current.cashMarginAmount.scaled > 0n) {
      const bankGl = await this.bankGlAccountId(current.bankTreasuryAccountId);
      lines.push(
        this.memoLine(restrictedCash, current.cashMarginAmount, "debit", current, "غطاء نقدي مقيد"),
        this.memoLine(bankGl, current.cashMarginAmount, "credit", current, `تحويل الغطاء النقدي — ${current.bankNameAr}`),
      );
    }

    const docNo = current.docNo ?? (await this.deps.gl.numbering.next(GUARANTEE_SEQUENCE)).formatted;
    await this.post(`${GUARANTEE_DOC_TYPE}:ISSUE:${current.id}`, current.issueDate, `إصدار خطاب ضمان ${docNo}`, docNo, current, lines);

    const issued: LetterOfGuarantee = { ...current, docNo, status: "active", currentValue: current.faceValue };
    await this.deps.guarantees.update(issued);
    await this.audit(issued, "ISSUE", actor?.userId, {
      faceValue: issued.faceValue.toString(),
      cashMarginAmount: issued.cashMarginAmount.toString(),
      issueDate: issued.issueDate,
      expiryDate: issued.expiryDate,
    });
    return issued;
  }

  /**
   * تخفيض — an advance guarantee shrinks as the advance is recovered. Reverses
   * the memorandum pair for the reduction only; the cash margin is untouched,
   * because the bank does not release it until the letter itself is returned.
   */
  async reduce(id: string, command: ReduceGuaranteeCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (!isGuaranteeOutstanding(current)) throw new InvalidGuaranteeTransitionError(current.status, "reduced");
    if (command.amount.scaled <= 0n) throw new InvalidGuaranteeError([{ ar: "قيمة التخفيض يجب أن تكون أكبر من صفر.", en: "The reduction amount must be greater than zero." }]);
    if (command.amount.scaled > current.currentValue.scaled) {
      throw new GuaranteeAmountExceedsValueError(id, command.amount.toString(), current.currentValue.toString());
    }
    if (command.reason.trim() === "") throw new InvalidGuaranteeError([{ ar: "سبب التخفيض مطلوب.", en: "A reduction reason is required." }]);
    this.assertEventDate("تاريخ التخفيض", "reduction date", command.date, current);

    const [memoDebit, memoCredit] = await Promise.all([
      this.routed("contracting.memo_debit", "9100"),
      this.routed("contracting.memo_credit", "9200"),
    ]);
    const lines: JournalLineInput[] = [
      this.memoLine(memoCredit, command.amount, "debit", current, "تخفيض التزام عرضي — خطاب ضمان"),
      this.memoLine(memoDebit, command.amount, "credit", current, "تخفيض القيمة الاسمية لخطاب الضمان"),
    ];
    const docNo = current.docNo ?? current.id;
    await this.post(
      `${GUARANTEE_DOC_TYPE}:REDUCE:${current.id}:${current.reductions.length + 1}`,
      command.date,
      `تخفيض خطاب ضمان ${docNo} — ${command.reason}`,
      docNo,
      current,
      lines,
    );

    const reduction: GuaranteeReduction = {
      date: command.date,
      amount: command.amount,
      reason: command.reason,
      sourceRef: command.sourceRef ?? null,
      userId: command.userId ?? null,
    };
    const reduced: LetterOfGuarantee = {
      ...current,
      status: "reduced",
      currentValue: current.currentValue.add(command.amount.negate()),
      reductions: [...current.reductions, reduction],
    };
    await this.deps.guarantees.update(reduced);
    await this.audit(reduced, "REDUCE", command.userId, {
      amount: command.amount.toString(),
      date: command.date,
      reason: command.reason,
      sourceRef: command.sourceRef ?? null,
      currentValue: reduced.currentValue.toString(),
    });
    return reduced;
  }

  /**
   * استرجاع التخفيض — the step back up, for a reduction whose cause was
   * reversed (a voided مستخلص). It posts the memorandum pair the reduction
   * reversed, never a negative reduction: the register has to be able to say
   * what was reduced and what was put back, and a signed `reductions` list
   * cannot.
   */
  async restore(id: string, command: ReduceGuaranteeCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (!isGuaranteeOutstanding(current)) throw new InvalidGuaranteeTransitionError(current.status, "reduced");
    if (command.amount.scaled <= 0n) throw new InvalidGuaranteeError([{ ar: "قيمة الاسترجاع يجب أن تكون أكبر من صفر.", en: "The restoration amount must be greater than zero." }]);
    if (current.currentValue.scaled + command.amount.scaled > current.faceValue.scaled) {
      throw new GuaranteeAmountExceedsValueError(
        id,
        command.amount.toString(),
        Money.fromScaled(current.faceValue.scaled - current.currentValue.scaled).toString(),
      );
    }
    if (command.reason.trim() === "") throw new InvalidGuaranteeError([{ ar: "سبب الاسترجاع مطلوب.", en: "A restoration reason is required." }]);
    this.assertEventDate("تاريخ الاسترجاع", "restoration date", command.date, current);

    const [memoDebit, memoCredit] = await Promise.all([
      this.routed("contracting.memo_debit", "9100"),
      this.routed("contracting.memo_credit", "9200"),
    ]);
    const lines: JournalLineInput[] = [
      this.memoLine(memoDebit, command.amount, "debit", current, "استرجاع القيمة الاسمية لخطاب الضمان"),
      this.memoLine(memoCredit, command.amount, "credit", current, "استرجاع التزام عرضي — خطاب ضمان"),
    ];
    const docNo = current.docNo ?? current.id;
    await this.post(
      `${GUARANTEE_DOC_TYPE}:RESTORE:${current.id}:${current.restorations.length + 1}`,
      command.date,
      `استرجاع تخفيض خطاب ضمان ${docNo} — ${command.reason}`,
      docNo,
      current,
      lines,
    );

    const restored: LetterOfGuarantee = {
      ...current,
      currentValue: current.currentValue.add(command.amount),
      restorations: [
        ...current.restorations,
        {
          date: command.date,
          amount: command.amount,
          reason: command.reason,
          sourceRef: command.sourceRef ?? null,
          userId: command.userId ?? null,
        },
      ],
    };
    await this.deps.guarantees.update(restored);
    await this.audit(restored, "RESTORE", command.userId, {
      amount: command.amount.toString(),
      date: command.date,
      reason: command.reason,
      sourceRef: command.sourceRef ?? null,
      currentValue: restored.currentValue.toString(),
    });
    return restored;
  }

  /**
   * إفراج — the beneficiary returns the letter. Reverses the memorandum pair
   * for whatever is still outstanding and brings the margin back out of
   * restricted cash into the bank.
   */
  async release(id: string, command: ReleaseGuaranteeCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (!isGuaranteeOutstanding(current)) throw new InvalidGuaranteeTransitionError(current.status, "released");

    const [memoDebit, memoCredit, restrictedCash] = await Promise.all([
      this.routed("contracting.memo_debit", "9100"),
      this.routed("contracting.memo_credit", "9200"),
      this.routed("contracting.restricted_cash", "1340"),
    ]);
    const lines: JournalLineInput[] = [];
    if (current.currentValue.scaled > 0n) {
      lines.push(
        this.memoLine(memoCredit, current.currentValue, "debit", current, "إقفال التزام عرضي — خطاب ضمان"),
        this.memoLine(memoDebit, current.currentValue, "credit", current, "إقفال القيمة الاسمية لخطاب الضمان"),
      );
    }
    if (current.cashMarginAmount.scaled > 0n) {
      const bankGl = await this.bankGlAccountId(current.bankTreasuryAccountId);
      lines.push(
        this.memoLine(bankGl, current.cashMarginAmount, "debit", current, `استرداد الغطاء النقدي — ${current.bankNameAr}`),
        this.memoLine(restrictedCash, current.cashMarginAmount, "credit", current, "إفراج عن غطاء نقدي مقيد"),
      );
    }
    if (lines.length === 0) throw new InvalidGuaranteeError([{ ar: "لا يوجد ما يُفرَج عنه في هذا الخطاب.", en: "There is nothing to release on this letter." }]);
    this.assertEventDate("تاريخ الإفراج", "release date", command.date, current);

    const docNo = current.docNo ?? current.id;
    await this.post(`${GUARANTEE_DOC_TYPE}:RELEASE:${current.id}`, command.date, `إفراج عن خطاب ضمان ${docNo}`, docNo, current, lines);

    const released: LetterOfGuarantee = {
      ...current,
      status: "released",
      closedDate: command.date,
      closedBy: command.userId ?? null,
      closedAmount: current.currentValue,
      currentValue: Money.zero(),
    };
    await this.deps.guarantees.update(released);
    await this.audit(released, "RELEASE", command.userId, {
      date: command.date,
      closedAmount: released.closedAmount.toString(),
      cashMarginAmount: released.cashMarginAmount.toString(),
    });
    return released;
  }

  /**
   * مصادرة — the beneficiary draws on the letter. The memorandum pair closes,
   * the drawn amount is charged to `chargeAccountId` (default: the
   * `contracting.onerous_loss` slot) against the bank, and the margin comes
   * back out of restricted cash.
   */
  async call(id: string, command: CallGuaranteeCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    if (!isGuaranteeOutstanding(current)) throw new InvalidGuaranteeTransitionError(current.status, "called");

    const amount = command.amount ?? current.currentValue;
    if (amount.scaled <= 0n) throw new InvalidGuaranteeError([{ ar: "قيمة المصادرة يجب أن تكون أكبر من صفر.", en: "The forfeiture amount must be greater than zero." }]);
    if (amount.scaled > current.currentValue.scaled) {
      throw new GuaranteeAmountExceedsValueError(id, amount.toString(), current.currentValue.toString());
    }

    const [memoDebit, memoCredit, restrictedCash, defaultCharge] = await Promise.all([
      this.routed("contracting.memo_debit", "9100"),
      this.routed("contracting.memo_credit", "9200"),
      this.routed("contracting.restricted_cash", "1340"),
      this.routed("contracting.onerous_loss", "5930"),
    ]);
    const chargeAccountId = command.chargeAccountId ?? defaultCharge;
    const chargeAccount = await this.deps.accounts.findById(chargeAccountId);
    if (!chargeAccount) throw new GuaranteeChargeAccountNotFoundError(chargeAccountId);
    this.assertEventDate("تاريخ المصادرة", "forfeiture date", command.date, current);

    const bankGl = await this.bankGlAccountId(current.bankTreasuryAccountId);
    const lines: JournalLineInput[] = [
      this.memoLine(memoCredit, current.currentValue, "debit", current, "إقفال التزام عرضي — مصادرة خطاب ضمان"),
      this.memoLine(memoDebit, current.currentValue, "credit", current, "إقفال القيمة الاسمية — مصادرة خطاب ضمان"),
      this.memoLine(chargeAccountId, amount, "debit", current, "خسارة مصادرة خطاب ضمان"),
      this.memoLine(bankGl, amount, "credit", current, `سداد المصادرة — ${current.bankNameAr}`),
    ];
    if (current.cashMarginAmount.scaled > 0n) {
      lines.push(
        this.memoLine(bankGl, current.cashMarginAmount, "debit", current, `استرداد الغطاء النقدي — ${current.bankNameAr}`),
        this.memoLine(restrictedCash, current.cashMarginAmount, "credit", current, "إفراج عن غطاء نقدي مقيد"),
      );
    }

    const docNo = current.docNo ?? current.id;
    await this.post(`${GUARANTEE_DOC_TYPE}:CALL:${current.id}`, command.date, `مصادرة خطاب ضمان ${docNo}`, docNo, current, lines);

    const called: LetterOfGuarantee = {
      ...current,
      status: "called",
      closedDate: command.date,
      closedBy: command.userId ?? null,
      closedAmount: amount,
      currentValue: Money.zero(),
    };
    await this.deps.guarantees.update(called);
    await this.audit(called, "CALL", command.userId, {
      date: command.date,
      closedAmount: amount.toString(),
      chargeAccountId,
    });
    return called;
  }

  /**
   * تاريخ الحركة محصور بين تاريخ الإصدار واليوم. A release dated before the
   * letter existed, or in the future, is either a mistake or a backdate past a
   * period the books have closed — and both were accepted.
   */
  async reverseLastPosting(id: string, command: ReverseGuaranteePostingCommand): Promise<LetterOfGuarantee> {
    const current = await this.require(id);
    const step = await this.latestPosting(current);
    if (!step) throw new GuaranteeNothingToReverseError(id);
    if (step.sourceRef) throw new GuaranteePostingFromDocumentError(id, step.sourceRef);
    const date = command.date ?? step.entry.date.slice(0, 10);
    if (date < step.entry.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(step.entry.id, date, step.entry.date);
    const gl = { ...this.deps.gl, actor: command.userId ?? this.deps.gl.actor };

    return this.deps.gl.ledger.transaction(async () => {
      const { reversal } = await reverseJournalEntry(step.entry.id, gl, {
        reversalId: command.reversalId,
        date,
        memo: command.memo ?? `عكس ${step.entry.memo ?? `حركة خطاب ضمان ${current.docNo ?? current.id}`}`,
      });
      await this.deps.guarantees.update(step.restored);
      await this.audit(step.restored, "REVERSE", command.userId, {
        reversed: step.action,
        journalEntryId: step.entry.id,
        reversalId: reversal.id,
        date,
        status: step.restored.status,
        currentValue: step.restored.currentValue.toString(),
      });
      return step.restored;
    });
  }

  private async latestPosting(current: LetterOfGuarantee): Promise<GuaranteePostingStep | null> {
    const standing = (action: string, suffix = "") => standingEntryGeneration(this.deps.gl.ledger, `${GUARANTEE_DOC_TYPE}:${action}:${current.id}${suffix}`);
    const outstandingStatus = (reductions: readonly GuaranteeReduction[]): LetterOfGuarantee["status"] => (reductions.length > 0 ? "reduced" : "active");
    if (current.status === "called" || current.status === "released") {
      const action = current.status === "called" ? "CALL" : "RELEASE";
      const entry = await standing(action);
      if (!entry) return null;
      const outstanding = current.restorations.reduce((sum, r) => sum + r.amount.scaled, current.reductions.reduce((sum, r) => sum - r.amount.scaled, current.faceValue.scaled));
      return {
        action,
        entry,
        sourceRef: null,
        restored: { ...current, status: outstandingStatus(current.reductions), currentValue: Money.fromScaled(outstanding), closedDate: null, closedBy: null, closedAmount: Money.zero() },
      };
    }
    if (current.status !== "active" && current.status !== "reduced") return null;
    const lastReduction = current.reductions[current.reductions.length - 1];
    const lastRestoration = current.restorations[current.restorations.length - 1];
    const reductionEntry = lastReduction ? await standing("REDUCE", `:${current.reductions.length}`) : null;
    const restorationEntry = lastRestoration ? await standing("RESTORE", `:${current.restorations.length}`) : null;
    const stamp = (entry: JournalEntry | null) => entry?.postedAt ?? entry?.createdAt ?? "";
    if (lastRestoration && restorationEntry && stamp(restorationEntry) >= stamp(reductionEntry)) {
      return {
        action: "RESTORE",
        entry: restorationEntry,
        sourceRef: lastRestoration.sourceRef,
        restored: { ...current, currentValue: current.currentValue.add(lastRestoration.amount.negate()), restorations: current.restorations.slice(0, -1) },
      };
    }
    if (lastReduction && reductionEntry) {
      const reductions = current.reductions.slice(0, -1);
      return {
        action: "REDUCE",
        entry: reductionEntry,
        sourceRef: lastReduction.sourceRef,
        restored: { ...current, status: outstandingStatus(reductions), currentValue: current.currentValue.add(lastReduction.amount), reductions },
      };
    }
    if (current.reductions.length > 0 || current.restorations.length > 0) return null;
    const issueEntry = await standing("ISSUE");
    return issueEntry ? { action: "ISSUE", entry: issueEntry, sourceRef: null, restored: { ...current, status: "draft", currentValue: current.faceValue } } : null;
  }

  private assertEventDate(labelAr: string, labelEn: string, date: string, guarantee: LetterOfGuarantee): void {
    const reasons: ReasonInput[] = [];
    if (!ISO_DATE.test(date)) reasons.push({ ar: `${labelAr} مطلوب بصيغة YYYY-MM-DD.`, en: `The ${labelEn} is required in YYYY-MM-DD format.` });
    else {
      if (date < guarantee.issueDate) {
        reasons.push({
          ar: `${labelAr} (${date}) لا يجوز أن يسبق تاريخ إصدار الخطاب (${guarantee.issueDate}).`,
          en: `The ${labelEn} (${date}) cannot be earlier than the letter's issue date (${guarantee.issueDate}).`,
        });
      }
      const today = this.today();
      if (date > today) {
        reasons.push({ ar: `${labelAr} (${date}) لا يجوز أن يكون في المستقبل (اليوم ${today}).`, en: `The ${labelEn} (${date}) cannot be in the future (today is ${today}).` });
      }
    }
    if (reasons.length > 0) throw new InvalidGuaranteeError(reasons);
  }

  private async audit(
    guarantee: LetterOfGuarantee,
    action: string,
    userId: string | null | undefined,
    details: Record<string, unknown>,
  ): Promise<void> {
    await recordTransition(this.deps.audit, {
      entityType: GUARANTEE_DOC_TYPE,
      entityId: guarantee.id,
      action,
      actor: userId ?? "system",
      severity: action === "RELEASE" || action === "CALL" || action === "REVERSE" ? "WARNING" : "INFO",
      details: {
        docNo: guarantee.docNo,
        kind: guarantee.kind,
        projectId: guarantee.projectId,
        contractId: guarantee.contractId,
        ...details,
      },
    });
  }

  private memoLine(
    accountId: string,
    amount: Money,
    side: "debit" | "credit",
    guarantee: LetterOfGuarantee,
    memo: string,
  ): JournalLineInput {
    return {
      accountId,
      debit: side === "debit" ? amount : Money.zero(),
      credit: side === "credit" ? amount : Money.zero(),
      memo,
      // بُعد المشروع on every line (D-01). No costCategory anywhere: a guarantee
      // is a financing instrument, not a category of project cost.
      projectId: guarantee.projectId,
    };
  }

  private async post(
    entryId: string,
    date: string,
    memo: string,
    docNo: string,
    guarantee: LetterOfGuarantee,
    lines: readonly JournalLineInput[],
  ): Promise<void> {
    await postJournalEntry(
      {
        id: await nextEntryGenerationId(this.deps.gl.ledger, entryId),
        date,
        memo,
        source: "system",
        sourceDocType: GUARANTEE_DOC_TYPE,
        sourceDocId: guarantee.id,
        sourceDocNumber: docNo,
        lines,
      },
      this.deps.gl,
      { mintedBySystem: true },
    );
  }

  private async require(id: string): Promise<LetterOfGuarantee> {
    const guarantee = await this.deps.guarantees.findById(id);
    if (!guarantee) throw new GuaranteeNotFoundError(id);
    return guarantee;
  }

  /** Every letter, newest first, with the read-time expiry derivation applied by the caller. */
  async list(): Promise<LetterOfGuarantee[]> {
    return this.deps.guarantees.list();
  }

  async find(idOrDocNo: string): Promise<LetterOfGuarantee | null> {
    return (await this.deps.guarantees.findById(idOrDocNo)) ?? (await this.deps.guarantees.findByDocNo(idOrDocNo));
  }

  /** The register's own reading of "today" — one source for the expiry pills and the summary. */
  asOf(): string {
    return this.today();
  }

  statusFor(guarantee: LetterOfGuarantee): ReturnType<typeof derivedGuaranteeStatus> {
    return derivedGuaranteeStatus(guarantee, this.today());
  }

  daysLeft(guarantee: LetterOfGuarantee): number {
    return daysToExpiry(guarantee, this.today());
  }
}
