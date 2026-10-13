import { amountInWords } from "@mezan/domain";
import type { PrintDocumentLine, PrintDocumentModel } from "@mezan/ui";
import type { PayslipDTO, PayrollRunDTO } from "@mezan/contracts";
import { majorOf } from "../lib/money";

/**
 * كشف الراتب — a payslip, as the print engine's generic document.
 *
 * WHY THIS EXISTS. Payroll produced a payslip that could be read on screen and
 * never handed to the person it belonged to. An employee who queries their net
 * is owed a document that shows the arithmetic, and an employer who is asked
 * for one by a labour inspector needs it on paper.
 *
 * WHAT IT PRINTS, and why it is not a simplified summary. Every line the
 * calculation produced, in the order it produced them, so the net can be
 * followed from the basic salary down. Deductions print as NEGATIVE amounts:
 * a column of unsigned figures that some rows add and others subtract is how
 * a payslip becomes an argument.
 *
 * Employer contributions are shown too, and are excluded from the net by
 * construction — they are the employer's cost, not the employee's money, and
 * printing them in the same column as a deduction would tell the employee they
 * had been charged for them.
 */

export interface PayslipLetterhead {
  readonly companyName: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly taxRegistrationNumber: string | null;
  readonly commercialRegistrationNumber: string | null;
}

/** The employee's own details, resolved by the caller against the real register. */
export interface PayslipPrintEmployee {
  readonly code: string;
  readonly name: string;
  readonly jobTitle?: string;
  readonly department?: string;
}

export interface PayslipPrintContext {
  readonly payslip: PayslipDTO;
  readonly run: Pick<PayrollRunDTO, "number" | "year" | "month" | "periodStart" | "periodEnd">;
  readonly employee: PayslipPrintEmployee;
  readonly settings: PayslipLetterhead | null;
  readonly branchName?: string;
  readonly currencyLabel: string;
  readonly documentTypeLabel: string;
  readonly employeeRoleLabel: string;
  readonly labels: {
    readonly earning: string;
    readonly deduction: string;
    readonly employerContribution: string;
    readonly terminationAdjustment: string;
    readonly grossEarnings: string;
    readonly totalDeductions: string;
    readonly netPay: string;
    readonly employerContributions: string;
    readonly paidDays: string;
    /** Shown beside a line a statutory recovery cap reduced — the Art. 44 wage-attachment cap on a garnishment line, or the Art. 43 10% cap (D183) on an advance-recovery line. */
    readonly statutoryCapped: string;
    readonly insurableWage: string;
    readonly payBasis?: string;
    readonly basisName?: string;
    readonly quantityUnit?: string;
    readonly contractCurrency?: string;
    readonly fxRate?: string;
    readonly grossInContractCurrency?: string;
    readonly netInContractCurrency?: string;
  };
  /** Formats an API money string for the paper copy; defaults to the raw two-decimal figure. */
  readonly formatAmount?: (value: string) => string;
  /** True when the run was computed with statutory rules on; the insurable wage is printed then. */
  readonly statutory?: boolean;
  /** What the net does NOT include, printed on the paper copy so a partial net is never read as a statutory one. */
  readonly statutoryNotice?: string;
}

function basisTerms(ctx: PayslipPrintContext): string[] {
  const basis = ctx.payslip.basis;
  if (!basis) return [];
  const { labels } = ctx;
  const amount = ctx.formatAmount ?? ((value: string) => majorOf(value).toFixed(2));
  const foreign = basis.fxRate !== null;
  if (basis.payBasis === "monthly" && !foreign) return [];
  const rate = foreign ? `${amount(basis.rate)} ${basis.contractCurrency}` : amount(basis.rate);
  const terms = [
    basis.quantity !== null
      ? `${labels.payBasis}: ${labels.basisName} — ${basis.quantity} ${labels.quantityUnit} × ${rate}`
      : `${labels.payBasis}: ${labels.basisName} — ${rate}`,
  ];
  if (foreign) {
    terms.push(`${labels.contractCurrency}: ${basis.contractCurrency}`);
    terms.push(`${labels.fxRate}: 1 ${basis.contractCurrency} = ${basis.fxRate} ${ctx.payslip.currency}${basis.fxRateDate ? ` (${basis.fxRateDate})` : ""}`);
    if (basis.grossInContractCurrency !== null) terms.push(`${labels.grossInContractCurrency}: ${amount(basis.grossInContractCurrency)} ${basis.contractCurrency}`);
    if (basis.netInContractCurrency !== null) terms.push(`${labels.netInContractCurrency}: ${amount(basis.netInContractCurrency)} ${basis.contractCurrency}`);
  }
  return terms;
}

export function payslipPrintModel(ctx: PayslipPrintContext): PrintDocumentModel {
  const { payslip, run, employee, settings, labels } = ctx;

  const lines: PrintDocumentLine[] = payslip.lines.map((line) => {
    const amount = majorOf(line.amount);
    const kindLabel =
      line.kind === "earning"
        ? labels.earning
        : line.kind === "deduction"
          ? labels.deduction
          : line.kind === "termination_adjustment"
            ? labels.terminationAdjustment
            : labels.employerContribution;
    const reducesNet = line.kind === "deduction" || line.kind === "termination_adjustment";
    return {
      description: line.capped ? `${line.nameAr} — ${labels.statutoryCapped}` : line.nameAr,
      unit: kindLabel,
      qty: 1,
      // A deduction reduces the net, so it prints as a negative number rather
      // than as a positive one the reader is expected to know to subtract.
      unitPrice: reducesNet ? -amount : amount,
      lineTotal: reducesNet ? -amount : amount,
    };
  });

  const gross = majorOf(payslip.grossEarnings);
  const deductions = majorOf(payslip.totalDeductions);
  const net = majorOf(payslip.netPay);

  return {
    documentType: "PAYSLIP",
    documentTypeLabel: ctx.documentTypeLabel,
    number: payslip.number,
    date: payslip.periodEnd,
    statusLabel: `${run.year}-${String(run.month).padStart(2, "0")} · ${run.number}`,
    company: {
      name: settings?.companyName ?? "",
      address: settings?.address || undefined,
      phone: settings?.phone || undefined,
      email: settings?.email || undefined,
      taxNumber: settings?.taxRegistrationNumber || undefined,
      commercialRegister: settings?.commercialRegistrationNumber || undefined,
    },
    branchName: ctx.branchName,
    party: {
      roleLabel: ctx.employeeRoleLabel,
      name: employee.name,
      code: employee.code,
      // The party block's tax-number slot is deliberately left empty. An
      // employee has no tax registration, and printing their national id under
      // a «الرقم الضريبي» label would be a mislabelled identifier on a document
      // that gets filed.
      address: employee.department,
      phone: employee.jobTitle,
    },
    paymentTerms: [
      `${labels.paidDays}: ${payslip.paidDays} / ${payslip.periodDays}`,
      ...(ctx.statutory ? [`${labels.insurableWage}: ${payslip.insurableWage}`] : []),
      ...basisTerms(ctx),
    ].join(" · "),
    complianceNotice: ctx.statutoryNotice,
    lines,
    totals: {
      // Gross IS the subtotal, so it is not repeated in the breakdown below:
      // a payslip that prints the same figure twice under two names invites
      // the reader to add it twice.
      subtotal: gross,
      taxBreakdown: [
        { label: labels.totalDeductions, amount: -deductions },
        // The employer's share is its own row rather than folded into the
        // totals: it never reduced the employee's pay and must not read as
        // though it did.
        { label: labels.employerContributions, amount: majorOf(payslip.employerContributions) },
      ],
      grandTotal: net,
      currencyLabel: ctx.currencyLabel,
      amountInWords: amountInWords(net),
    },
  };
}
