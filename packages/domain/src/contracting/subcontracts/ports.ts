import type { Money, Qty } from "../../money/index.js";

/**
 * The outside world, as عقود الباطن sees it. Every one of these is a port the
 * composition fills with the engine that already exists — the subcontract
 * never builds a purchase invoice, a voucher or a client certificate itself.
 */

/** The subcontractor, as the payability gate reads it. */
export interface SubcontractorParty {
  readonly id: string;
  readonly nameAr: string;
  /** الرقم الضريبي — without it the withheld tax cannot be remitted under anyone's name. */
  readonly taxNumber: string | null;
  /** رقم الحساب البنكي / IBAN — what the subcontractor is actually paid into. */
  readonly bankAccount: string | null;
}

export interface SubcontractSupplierPort {
  find(supplierId: string): Promise<SubcontractorParty | null>;
}

/** What the purchase invoice generated from an approved sub certificate looks like on the way in. */
export interface SubCertificateInvoiceCommand {
  readonly certificateId: string;
  readonly certificateDocNo: string;
  readonly serial: number;
  readonly subcontractDocNo: string;
  readonly supplierId: string;
  readonly projectId: string;
  readonly date: string;
  readonly dueDate: string;
  readonly amount: Money;
  /** What the line is actually raised at: 14, or 5.04 on the transitional basis. */
  readonly taxRatePercent: string;
  /**
   * The account the expense line DEBITS. A subcontractor's certified work is
   * أعمال تحت التنفيذ, not a period expense: it is relieved to cost of contract
   * revenue by the monthly recognition run (D-12), never by an AP clerk booking
   * a bill.
   */
  readonly expenseAccountId: string;
  readonly lineDescriptionAr: string;
  readonly memoAr: string;
  /** WHO approved the sub certificate — the generated purchase invoice's audit row named `system`. */
  readonly actor?: string | null;
}

export interface SubCertificateInvoiceResult {
  readonly invoiceId: string;
  readonly invoiceDocNo: string;
  /** The payable account the invoice credited — the deductions entry debits the same one. */
  readonly apAccountId: string;
  readonly total: Money;
}

export interface SubCertificateInvoiceStatus {
  readonly invoiceId: string;
  readonly docNo: string | null;
  readonly total: Money;
  readonly amountPaid: Money;
  readonly remainingBalance: Money;
  readonly dueDate: string | null;
  readonly status: string;
}

/**
 * The purchase-invoice engine, as the sub certificate sees it — the mirror of
 * `CertificateInvoicingPort`. AP, aging and voucher allocation are reused
 * unchanged, so the certificate stays its own document and the invoice a thin
 * derived one.
 */
export interface SubCertificateInvoicingPort {
  issue(cmd: SubCertificateInvoiceCommand): Promise<SubCertificateInvoiceResult>;
  status(invoiceId: string): Promise<SubCertificateInvoiceStatus | null>;
  /**
   * Records the posted deductions as settled against the invoice, so the AP
   * sub-ledger's outstanding balance equals the net payable and still ties to
   * GL 2100 — the deductions DEBITED AP in the ledger, and a sub-ledger that
   * ignored them would read permanently high.
   */
  settle(invoiceId: string, amount: Money, reference: string): Promise<void>;
}

/** A confirmed treasury voucher, as the advance link reads it. */
export interface SubcontractAdvanceVoucher {
  readonly id: string;
  readonly docNo: string | null;
  readonly date: string;
  readonly amount: Money;
  readonly supplierId: string | null;
  readonly counterpartyGlAccountId: string | null;
  readonly status: string;
  readonly direction: string;
}

export interface SubcontractVoucherPort {
  find(voucherId: string): Promise<SubcontractAdvanceVoucher | null>;
}

/**
 * The CLIENT certificates, as the back-to-back control reads them: the latest
 * cumulative quantity the consultant has certified per BOQ line. Only
 * certificates at «معتمد من الاستشاري» or beyond count — a quantity still at
 * حصر is one nobody outside the company has agreed to.
 */
export interface ClientCertifiedQuantityPort {
  certifiedCumulativeByBoqLine(contractId: string): Promise<ReadonlyMap<string, Qty>>;
}

/**
 * Slice 4A's consumption documents that name this subcontract — «مواد مصروفة
 * للمقاول». The prefill is the server's figure; the certificate screen may
 * override it, because a delivery note and a certificate period rarely line up
 * exactly.
 */
export interface SubcontractConsumptionPort {
  materialsIssuedTo(subcontractId: string): Promise<Money>;
}

/**
 * الإفراج عن المحتجزات as an AP DOCUMENT (design §06, D-05).
 *
 * The release is a purchase invoice whose single expense line debits the
 * retention-payable account, so the invoice's own posting is Dr 2195 / Cr AP:
 * GL 2100 and the payables sub-ledger move together and a voucher can pay it.
 */
export interface SubcontractRetentionReleaseInvoiceCommand {
  readonly releaseId: string;
  readonly subcontractId: string;
  readonly subcontractDocNo: string;
  readonly supplierId: string;
  readonly projectId: string;
  readonly date: string;
  /** ميعاد الاستحقاق — the release EVENT, not the invoice date plus payment terms. */
  readonly dueDate: string;
  readonly amount: Money;
  /** The retention-payable account the expense line debits. */
  readonly retentionAccountId: string;
  readonly lineDescriptionAr: string;
  readonly memoAr: string;
  /** WHO released the retention — the generated purchase invoice's audit row named `system`. */
  readonly actor?: string | null;
}

export interface SubcontractRetentionReleaseInvoiceResult {
  readonly invoiceId: string;
  readonly invoiceDocNo: string;
  readonly journalEntryId: string;
}

export interface SubcontractRetentionInvoicingPort {
  issue(cmd: SubcontractRetentionReleaseInvoiceCommand): Promise<SubcontractRetentionReleaseInvoiceResult>;
}
