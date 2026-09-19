import type { EtaSubmissionStatus } from "./submission.js";

export class EtaSubmissionNotFoundError extends Error {
  readonly code = "ETA_SUBMISSION_NOT_FOUND";
  constructor(readonly id: string) {
    super(`ETA submission "${id}" not found.`);
    this.name = "EtaSubmissionNotFoundError";
  }
}

export class DuplicateEtaSubmissionError extends Error {
  readonly code = "ETA_SUBMISSION_DUPLICATE";
  constructor(readonly internalId: string) {
    super(`ETA submission for document "${internalId}" already exists.`);
    this.name = "DuplicateEtaSubmissionError";
  }
}

export class InvalidEtaTransitionError extends Error {
  readonly code = "ETA_INVALID_TRANSITION";
  constructor(
    readonly from: EtaSubmissionStatus,
    readonly action: string,
  ) {
    super(`Cannot ${action} an ETA submission in status "${from}".`);
    this.name = "InvalidEtaTransitionError";
  }
}

/** The ONLINE transmit path is a stub in this build — it is refused offline. */
export class EtaOfflineError extends Error {
  readonly code = "ETA_OFFLINE";
  constructor() {
    super("ETA transmission is online-only and is stubbed in this build; the document was queued.");
    this.name = "EtaOfflineError";
  }
}

/**
 * No POS device serial is registered for the branch the sale was made in. The
 * authority identifies the issuing till by that serial, so a receipt cannot be
 * reported without one and must not be sent with the field blank.
 */
export class EtaDeviceSerialNotRegisteredError extends Error {
  readonly code = "ETA_DEVICE_SERIAL_NOT_REGISTERED";
  constructor(readonly branch: string | null) {
    const where = branch ? ` (${branch})` : "";
    super(
      `لا يمكن إصدار إيصال إلكتروني: لم يُسجَّل رقم تسلسلي لجهاز نقطة البيع لهذا الفرع${where} لدى المصلحة. ` +
        `سجّل الرقم التسلسلي للجهاز في «أكواد الفروع لدى المصلحة» قبل البيع. ` +
        `No POS device serial number is registered with the Tax Authority for this branch${where}; ` +
        `register the device serial under the ETA branch codes before issuing a receipt.`,
    );
    this.name = "EtaDeviceSerialNotRegisteredError";
  }
}

/**
 * A refund receipt without the sale it returns. The SDK makes
 * header.referenceUUID mandatory on a return receipt, and a refund that cannot
 * name its sale would be filed as a free-standing negative sale.
 */
export class EtaRefundReferenceRequiredError extends Error {
  readonly code = "ETA_REFUND_REFERENCE_REQUIRED";
  constructor(readonly receiptNumber: string) {
    super(
      `لا يمكن إصدار إيصال مرتجع (${receiptNumber}) دون الإشارة إلى الإيصال الإلكتروني الأصلي للبيع. ` +
        `A refund receipt (${receiptNumber}) must reference the original sale receipt's UUID.`,
    );
    this.name = "EtaRefundReferenceRequiredError";
  }
}

/** The original sale was never receipted, so there is no UUID a refund receipt can reference. */
export class EtaOriginalReceiptNotFoundError extends Error {
  readonly code = "ETA_ORIGINAL_RECEIPT_NOT_FOUND";
  constructor(readonly invoiceNumber: string) {
    super(
      `لا يوجد إيصال إلكتروني للفاتورة الأصلية ${invoiceNumber}، فلا يمكن إصدار إيصال مرتجع يشير إليه. ` +
        `The original sale ${invoiceNumber} has no e-receipt for a refund receipt to reference.`,
    );
    this.name = "EtaOriginalReceiptNotFoundError";
  }
}

/** A serial named for a receipt that no branch (or terminal) has registered. */
export class EtaDeviceSerialUnknownError extends Error {
  readonly code = "ETA_DEVICE_SERIAL_UNKNOWN";
  constructor(readonly serial: string) {
    super(
      `الرقم التسلسلي ${serial} غير مسجّل لأي جهاز نقطة بيع لدى المصلحة. ` +
        `Serial ${serial} is not a registered POS device.`,
    );
    this.name = "EtaDeviceSerialUnknownError";
  }
}

/**
 * A receipt the authority would reject on arrival. It is refused BEFORE its
 * UUID is minted: once hashed, printed and chained, a receipt can only be
 * corrected by a re-issue inside the authority's amendment window.
 */
export class EtaReceiptNotReadyError extends Error {
  readonly code = "ETA_RECEIPT_NOT_READY";
  constructor(readonly reasons: readonly string[]) {
    super(
      `لا يمكن إصدار الإيصال الإلكتروني قبل استكمال بيانات التسجيل: ${reasons.join("، ")}. ` +
        `The e-receipt cannot be issued until its registration data is complete: ${reasons.join("; ")}.`,
    );
    this.name = "EtaReceiptNotReadyError";
  }
}

/** SDK Receipt v1.2 buyer: a natural person at or above the threshold must carry a national ID and a name. */
export class EtaBuyerIdentityRequiredError extends Error {
  readonly code = "ETA_BUYER_IDENTITY_REQUIRED";
  constructor(readonly threshold: string) {
    super(
      `إيصال بقيمة ${threshold} جنيه أو أكثر لشخص طبيعي يتطلب الرقم القومي والاسم. سجّلهما على العميل ثم أعد الإصدار. ` +
        `A receipt of EGP ${threshold} or more to a natural person needs the buyer's national ID and name.`,
    );
    this.name = "EtaBuyerIdentityRequiredError";
  }
}

/** SDK Receipt Issuance FAQ: a return receipt may be issued at most 540 days after the sale receipt. */
export class EtaRefundTooLateError extends Error {
  readonly code = "ETA_REFUND_TOO_LATE";
  constructor(readonly saleIssuedAt: string) {
    super(
      `لا يمكن إصدار إيصال مرتجع بعد مرور 540 يوماً على إيصال البيع (${saleIssuedAt}). ` +
        `A return receipt cannot be issued more than 540 days after the sale receipt (${saleIssuedAt}).`,
    );
    this.name = "EtaRefundTooLateError";
  }
}

/**
 * A consumer sale whose e-receipt exists cannot be voided: the authority has no
 * cancellation for a receipt, so voiding would drop the VAT from the books while
 * the authority keeps it. The correction is a return, which files a refund receipt.
 */
export class EtaReceiptedSaleVoidRefusedError extends Error {
  readonly code = "ETA_RECEIPTED_SALE_VOID_REFUSED";
  constructor(readonly receiptNumber: string) {
    super(
      `لا يمكن إلغاء الفاتورة ${receiptNumber}: صدر لها إيصال إلكتروني، والإيصال لا يُلغى لدى المصلحة. استخدم مرتجع مبيعات ليصدر إيصال مرتجع. ` +
        `Invoice ${receiptNumber} has an e-receipt, which the authority cannot cancel; record a sales return instead.`,
    );
    this.name = "EtaReceiptedSaleVoidRefusedError";
  }
}

export class EtaExclusionReasonRequiredError extends Error {
  readonly code = "ETA_EXCLUSION_REASON_REQUIRED";
  constructor() {
    super("Excluding a document from ETA submission requires a reason.");
    this.name = "EtaExclusionReasonRequiredError";
  }
}

/** التوقيع الإلكتروني غير مُهيّأ — no external signing program is configured. */
export class EtaSignerNotConfiguredError extends Error {
  readonly code = "ETA_SIGNER_NOT_CONFIGURED";
  constructor() {
    super(
      "التوقيع الإلكتروني يتم بجهاز التوقيع (التوكن) الخاص بالممول ولا يمكن تنفيذه داخل البرنامج. اضبط أمر التوقيع الخارجي في إعدادات الفاتورة الإلكترونية قبل الإرسال.",
    );
    this.name = "EtaSignerNotConfiguredError";
  }
}

/** برنامج التوقيع رفض أو أخفق — the configured signing program did not return a signature. */
export class EtaSigningFailedError extends Error {
  readonly code = "ETA_SIGNING_FAILED";
  constructor(readonly detail: string) {
    super(`تعذّر توقيع المستند: ${detail}`);
    this.name = "EtaSigningFailedError";
  }
}
