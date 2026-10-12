import { AuditSeverityCode, recordSensitiveEvent } from "../audit/index.js";
import {
  JournalTaxLineUnclassifiedError,
  PostedLineNotFoundError,
  TaxRateAlreadyClassifiedError,
  isSystemTaxRate,
  SystemTaxRateOnlyError,
  planTaxClassification,
  alreadyClassifiedAs,
  TaxClassificationAuditAction,
  TaxClassificationAuditEntity,
  TaxClassificationAuditModule,
  TaxClassificationJournalUntaggedError,
  TaxClassificationNotASupplyError,
  TaxClassificationNotPostedError,
  TaxClassificationStaleError,
  type ClassifyPostedLineTaxRequest,
  type TaxClassificationDependentsPort,
  type AppliedTaxRate,
  type ChosenJournalLinesNamed,
  type ExpectedTaxJournalLine,
  type TaxClassificationPlan,
  type TaxRateRepository,
} from "../tax-rates/index.js";
import type { Money } from "../money/index.js";
import { isRetentionRelease } from "../documents/invoice-document-kind.js";
import { atomically, type PurchaseAuditDeps } from "./audit.js";
import { PurchaseInvoiceNotFoundError } from "./errors.js";
import { buildInvoicePosting, purchaseInvoiceLineBase, type PurchaseInvoice, type PurchaseInvoiceRepository } from "./purchase-invoice.js";
import type { PurchaseGlAccounts } from "./types.js";
import { PurchaseInvoiceStatusCode } from "./types.js";

export const PURCHASE_INVOICE_STATUS_LABELS_AR: Readonly<Record<PurchaseInvoiceStatusCode, string>> = {
  [PurchaseInvoiceStatusCode.Draft]: "مسودة",
  [PurchaseInvoiceStatusCode.Confirmed]: "مؤكدة",
  [PurchaseInvoiceStatusCode.Cancelled]: "ملغاة",
};

export interface PurchaseInvoiceTaxTagPort {
  retagUnnamedTaxRate(invoiceId: string, taxRatePercent: number, taxRateId: string, expected?: readonly ExpectedTaxJournalLine[]): Promise<number>;
  nameChosenLines(
    invoiceId: string,
    lineIndexes: readonly number[],
    taxRatePercent: number,
    taxRateId: string,
    expected: readonly ExpectedTaxJournalLine[],
  ): Promise<ChosenJournalLinesNamed>;
}

export interface ClassifyPurchaseInvoiceLineTaxDeps extends PurchaseAuditDeps {
  readonly invoices: PurchaseInvoiceRepository;
  readonly taxRates?: Pick<TaxRateRepository, "list">;
  readonly taxTags?: PurchaseInvoiceTaxTagPort;
  readonly taxDependents?: TaxClassificationDependentsPort;
  /**
   * The accounts the invoice posted to. With them the lines a classification
   * may name are the ones the invoice's own posting builder produces — account
   * for account and amount for amount — never "any debit of the entry".
   */
  readonly accounts?: PurchaseGlAccounts;
  readonly baseCurrency?: string;
  /**
   * The lines of the entry the invoice ACTUALLY posted. An invoice confirmed
   * under accounts of its own — a subcontract certificate books its work to
   * the subcontract's account, never the chain's expense account — is rebuilt
   * with those, so the lines it expects are the lines its entry holds.
   */
  readonly postedLines?: (invoiceId: string) => Promise<readonly PostedPurchaseJournalLine[] | null>;
}

export interface PostedPurchaseJournalLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

// INVARIANT: only the expense account is ever the caller's own (see the two
// subcontract confirms); every other account is the chain's. It is read off
// the entry only when exactly ONE debit account is none of the chain's —
// anything else keeps the defaults, and the match then refuses.
export function postedPurchaseAccounts(defaults: PurchaseGlAccounts, posted: readonly PostedPurchaseJournalLine[]): PurchaseGlAccounts {
  const chain = new Set(
    [defaults.inventoryAccountId, defaults.payableAccountId, defaults.taxAccountId, defaults.freightAccountId, defaults.expenseAccountId, defaults.goodsReceivedNotInvoicedAccountId].filter(
      (accountId): accountId is string => typeof accountId === "string",
    ),
  );
  const own = [...new Set(posted.filter((line) => line.debit.scaled > 0n && !chain.has(line.accountId)).map((line) => line.accountId))];
  return own.length === 1 ? { ...defaults, expenseAccountId: own[0] } : defaults;
}

async function expectedPurchaseTaxJournalLines(
  invoice: PurchaseInvoice,
  tax: AppliedTaxRate,
  deps: Pick<ClassifyPurchaseInvoiceLineTaxDeps, "accounts" | "baseCurrency" | "postedLines">,
): Promise<ExpectedTaxJournalLine[] | undefined> {
  if (!deps.accounts) return undefined;
  const posted = (await deps.postedLines?.(invoice.id)) ?? null;
  const accounts = posted ? postedPurchaseAccounts(deps.accounts, posted) : deps.accounts;
  const fx = invoice.fxRate ? { rate: invoice.fxRate, baseCurrency: deps.baseCurrency ?? "EGP" } : undefined;
  return buildInvoicePosting(invoice, accounts, fx)
    .lines.filter((line) => line.taxRatePercent === tax.taxRatePercent && (line.taxRateId ?? null) === tax.taxRateId)
    .map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit }));
}

export interface ClassifyPurchaseInvoiceLineTaxResult {
  readonly invoice: PurchaseInvoice;
  readonly plan: TaxClassificationPlan;
  readonly journalLinesNamed: number;
}

/**
 * تصنيف ضريبة بند فاتورة المشتريات — the purchase twin of
 * `SalesInvoiceService.classifyLineTax`. A line is addressed by its index,
 * as a purchase return addresses it.
 *
 * INVARIANT: NULL → a rate at the line's own stored percent, on the invoice
 * line and its journal lines, in one transaction. No amount, account, date or
 * status moves, and a line that names a rate is never re-pointed.
 */
export async function classifyPurchaseInvoiceLineTax(
  id: string,
  request: ClassifyPostedLineTaxRequest,
  deps: ClassifyPurchaseInvoiceLineTaxDeps,
): Promise<ClassifyPurchaseInvoiceLineTaxResult> {
  // INVARIANT: the read, the plan and both writes share ONE transaction, and
  // the invoice is written by `nameLineTaxRate` alone — never `update`.
  return atomically(deps, async () => {
    const existing = await deps.invoices.findById(id);
    if (!existing) throw new PurchaseInvoiceNotFoundError(id);
    if (existing.status !== PurchaseInvoiceStatusCode.Confirmed) {
      throw new TaxClassificationNotPostedError(PURCHASE_INVOICE_STATUS_LABELS_AR[existing.status]);
    }
    if (isRetentionRelease(existing)) throw new TaxClassificationNotASupplyError(existing.number);
    const taxRates = deps.taxRates ? await deps.taxRates.list() : null;
    const postedLines = existing.lines.map((line, index) => ({
      lineRef: String(index),
      label: line.description ?? line.itemId ?? `بند ${index + 1}`,
      stored: { taxRateId: line.taxRateId ?? null, taxRatePercent: line.taxRatePercent },
    }));
    const standing = alreadyClassifiedAs(taxRates, postedLines, request);
    if (standing) {
      const reached = await deps.taxDependents?.carry({ sourceDocumentId: existing.id, taxRatePercent: standing.before.taxRatePercent, taxRateId: request.taxRateId });
      if (deps.audit && reached && (reached.documentNumbers.length > 0 || reached.journalLinesNamed > 0)) {
        await recordSensitiveEvent(deps.audit, {
          module: TaxClassificationAuditModule.Purchases,
          entityType: TaxClassificationAuditEntity.PurchaseInvoice,
          entityId: existing.id,
          action: TaxClassificationAuditAction.CarryLineTax,
          actor: deps.actor ?? "system",
          branchId: existing.branchId ?? null,
          severity: AuditSeverityCode.Warning,
          details: {
            invoiceId: existing.id,
            number: existing.number,
            lineIds: standing.lineRefs,
            before: standing.before,
            after: standing.after,
            taxRateName: standing.taxRateName,
            carriedToDocuments: reached.documentNumbers,
            carriedJournalLinesNamed: reached.journalLinesNamed,
          },
        });
      }
      return { invoice: existing, plan: standing, journalLinesNamed: 0 };
    }
    const plan = planTaxClassification(taxRates, postedLines, request);
    if (isSystemTaxRate(request.taxRateId)) throw new SystemTaxRateOnlyError(request.taxRateId, plan.taxRateName);
    // ORDER MATTERS: the journal goes first — it is what refuses a filed VAT
    // period, and it must refuse before the invoice line is written.
    let journalLinesNamed = 0;
    let chosenJournalLines: ChosenJournalLinesNamed | null = null;
    if (deps.taxTags) {
      const expected = await expectedPurchaseTaxJournalLines(existing, plan.before, deps);
      if (request.journalLineIndexes) {
        chosenJournalLines = await deps.taxTags.nameChosenLines(existing.id, request.journalLineIndexes, plan.before.taxRatePercent, request.taxRateId, expected ?? []);
        journalLinesNamed = chosenJournalLines.after.length;
      } else {
        journalLinesNamed = await deps.taxTags.retagUnnamedTaxRate(existing.id, plan.before.taxRatePercent, request.taxRateId, expected);
      }
      // INVARIANT: lines that extend to nothing posted no journal line, so the
      // group classifies on the document alone; any other is refused.
      const postedSomething = expected
        ? expected.length > 0
        : plan.lineRefs.some((lineRef) => {
            const line = existing.lines[Number(lineRef)];
            return !line || purchaseInvoiceLineBase(line).scaled !== 0n;
          });
      if (journalLinesNamed === 0 && postedSomething) throw new TaxClassificationJournalUntaggedError(existing.number);
    }
    const carried = (await deps.taxDependents?.carry({
      sourceDocumentId: existing.id,
      taxRatePercent: plan.before.taxRatePercent,
      taxRateId: request.taxRateId,
    })) ?? { documentNumbers: [], journalLinesNamed: 0 };
    const linesNamed = await deps.invoices.nameLineTaxRate(existing.id, plan.lineRefs.map(Number), plan.before.taxRatePercent, request.taxRateId);
    if (linesNamed !== plan.lineRefs.length) throw new TaxClassificationStaleError(existing.number);
    const invoice = (await deps.invoices.findById(id)) as PurchaseInvoice;
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: TaxClassificationAuditModule.Purchases,
        entityType: TaxClassificationAuditEntity.PurchaseInvoice,
        entityId: invoice.id,
        action: TaxClassificationAuditAction.ClassifyLineTax,
        actor: deps.actor ?? "system",
        branchId: invoice.branchId ?? null,
        severity: AuditSeverityCode.Warning,
        details: {
          invoiceId: invoice.id,
          number: invoice.number,
          lineIds: plan.lineRefs,
          before: plan.before,
          after: plan.after,
          taxRateName: plan.taxRateName,
          journalLinesNamed,
          ...(chosenJournalLines ? { journalLines: chosenJournalLines } : {}),
          carriedToDocuments: carried.documentNumbers,
        },
      });
    }
    return { invoice, plan, journalLinesNamed };
  });
}

export async function namePurchaseInvoiceJournalLineTax(
  id: string,
  request: { readonly lineRef: string; readonly withLineRefs?: readonly string[]; readonly taxRateId?: string; readonly journalLineIndexes: readonly number[] },
  deps: ClassifyPurchaseInvoiceLineTaxDeps,
): Promise<ClassifyPurchaseInvoiceLineTaxResult> {
  const found = await deps.invoices.findById(id);
  if (!found) throw new PurchaseInvoiceNotFoundError(id);
  const target = found.lines[Number(request.lineRef)];
  if (!target) throw new PostedLineNotFoundError(request.lineRef);
  if ((target.taxRateId ?? null) === null) {
    if (!request.taxRateId) throw new JournalTaxLineUnclassifiedError(request.lineRef);
    return classifyPurchaseInvoiceLineTax(id, { ...request, taxRateId: request.taxRateId }, deps);
  }
  return atomically(deps, async () => {
    const existing = await deps.invoices.findById(id);
    if (!existing) throw new PurchaseInvoiceNotFoundError(id);
    if (existing.status !== PurchaseInvoiceStatusCode.Confirmed) {
      throw new TaxClassificationNotPostedError(PURCHASE_INVOICE_STATUS_LABELS_AR[existing.status]);
    }
    const line = existing.lines[Number(request.lineRef)];
    const taxRateId = line?.taxRateId ?? null;
    if (!line || taxRateId === null) throw new JournalTaxLineUnclassifiedError(request.lineRef);
    const taxRates = deps.taxRates ? await deps.taxRates.list() : null;
    const taxRateName = taxRates?.find((rate) => rate.id === taxRateId)?.name ?? taxRateId;
    if (request.taxRateId && request.taxRateId !== taxRateId) throw new TaxRateAlreadyClassifiedError(taxRateId, taxRateName);
    const stored: AppliedTaxRate = { taxRateId, taxRatePercent: line.taxRatePercent };
    const expected = await expectedPurchaseTaxJournalLines(existing, stored, deps);
    if (!deps.taxTags || !expected) throw new TaxClassificationJournalUntaggedError(existing.number);
    const journalLines = await deps.taxTags.nameChosenLines(existing.id, request.journalLineIndexes, stored.taxRatePercent, taxRateId, expected);
    const lineRefs = existing.lines
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => (candidate.taxRateId ?? null) === taxRateId && candidate.taxRatePercent === stored.taxRatePercent)
      .map(({ index }) => String(index));
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: TaxClassificationAuditModule.Purchases,
        entityType: TaxClassificationAuditEntity.PurchaseInvoice,
        entityId: existing.id,
        action: TaxClassificationAuditAction.NameJournalLineTax,
        actor: deps.actor ?? "system",
        branchId: existing.branchId ?? null,
        severity: AuditSeverityCode.Warning,
        details: { invoiceId: existing.id, number: existing.number, lineIds: lineRefs, taxRateId, taxRateName, journalLines },
      });
    }
    return { invoice: existing, plan: { lineRefs, before: stored, after: stored, taxRateName }, journalLinesNamed: journalLines.after.length };
  });
}
