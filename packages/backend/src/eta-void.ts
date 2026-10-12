import {
  DocumentReversalRefusedError,
  EtaVoidVerdict,
  etaVoidVerdictOf,
  type EtaDocumentType,
  type EtaService,
  type EtaSubmissionStatus,
  type FrameworkDocument,
  type SalesReturnLine,
  type SalesReturnRefund,
} from "@mezan/domain";
import { latestReceiptOf } from "./eta-receipts.js";

export interface EtaVoidPort {
  statusOf(internalId: string): Promise<EtaSubmissionStatus | null>;
  documentOf(internalId: string): Promise<{ readonly status: EtaSubmissionStatus; readonly documentType: EtaDocumentType } | null>;
  withdraw(internalId: string, reason: string): Promise<void>;
}

// INVARIANT: reads the LAST link of a document's chain — a rejected receipt
// that was reissued is judged by its reissue, never by the rejection.
export function createEtaVoidPort(eta: Pick<EtaService, "findByInternalId" | "exclude">): EtaVoidPort {
  return {
    async statusOf(internalId) {
      return (await latestReceiptOf(eta, internalId))?.status ?? null;
    },
    async documentOf(internalId) {
      const submission = await latestReceiptOf(eta, internalId);
      return submission ? { status: submission.status, documentType: submission.documentType } : null;
    },
    async withdraw(internalId, reason) {
      const submission = await latestReceiptOf(eta, internalId);
      if (!submission || etaVoidVerdictOf(submission.status) !== EtaVoidVerdict.Withdraw) return;
      await eta.exclude(submission.id, reason);
    },
  };
}

export enum ReturnVoidRefusalCode {
  HasRefunds = "RETURN_HAS_REFUNDS",
  EtaAwaitingVerdict = "ETA_RETURN_AWAITING_VERDICT",
  EtaAccepted = "ETA_RETURN_ACCEPTED",
}

type SalesReturn = FrameworkDocument<SalesReturnLine>;

export function createSalesReturnVoidGuards(deps: {
  readonly refundsOf: (returnId: string) => Promise<readonly SalesReturnRefund[]>;
  readonly eta: EtaVoidPort;
}): { guard(doc: SalesReturn): Promise<void>; withdraw(original: SalesReturn): Promise<void> } {
  return {
    async guard(doc) {
      const number = doc.docNo ?? doc.id;
      const refunds = await deps.refundsOf(doc.id);
      if (refunds.length > 0) {
        const vouchers = refunds.map((refund) => refund.voucherNo ?? refund.voucherId).join("، ");
        throw new DocumentReversalRefusedError(
          ReturnVoidRefusalCode.HasRefunds,
          `لا يمكن إلغاء المرتجع ${number}: صُرف عليه رد مبلغ للعميل (${vouchers}). اعكس سند الرد أولاً ثم ألغِ المرتجع.`,
          `Return ${number} cannot be voided: a customer refund was paid against it (${vouchers}). Reverse the refund voucher first.`,
        );
      }
      const verdict = etaVoidVerdictOf(await deps.eta.statusOf(number));
      if (verdict === EtaVoidVerdict.AwaitingVerdict) {
        throw new DocumentReversalRefusedError(
          ReturnVoidRefusalCode.EtaAwaitingVerdict,
          `المستند الإلكتروني للمرتجع ${number} أُرسل إلى مصلحة الضرائب وما زال قيد المراجعة. انتظر رد المصلحة: إن رُفض أمكن إلغاء المرتجع، وإن قُبل فيُصحَّح بفاتورة مبيعات جديدة.`,
          `The e-document of return ${number} has been sent to the tax authority and is awaiting its verdict. Wait for it: a rejected one can be voided, an accepted one is corrected by a new sales invoice.`,
        );
      }
      if (verdict === EtaVoidVerdict.Accepted) {
        throw new DocumentReversalRefusedError(
          ReturnVoidRefusalCode.EtaAccepted,
          `المستند الإلكتروني للمرتجع ${number} مقبول لدى مصلحة الضرائب ولا يُلغى من الدفاتر وحدها. صحّحه بفاتورة مبيعات جديدة.`,
          `The e-document of return ${number} is accepted by the tax authority and cannot be voided in the books alone. Correct it with a new sales invoice.`,
        );
      }
    },
    async withdraw(original) {
      const number = original.docNo ?? original.id;
      await deps.eta.withdraw(number, `أُلغي المرتجع ${number} قبل قبوله لدى المصلحة.`);
    },
  };
}
