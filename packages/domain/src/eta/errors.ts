import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import { getEtaStatusLabel, getEtaStatusLabelEn, type EtaSubmissionStatus } from "./submission.js";

const ETA_ACTION_AR: Readonly<Record<string, string>> = {
  submit: "إرسال",
  refresh: "تحديث حالة",
  accept: "قبول",
  reject: "رفض",
  exclude: "استبعاد",
  requeue: "إعادة الطابور",
};

const ETA_ACTION_EN: Readonly<Record<string, string>> = {
  submit: "submit",
  refresh: "refresh the status of",
  accept: "accept",
  reject: "reject",
  exclude: "exclude",
  requeue: "requeue",
};

function etaActionAr(action: string): string {
  return ETA_ACTION_AR[action] ?? action;
}

export class EtaSubmissionNotFoundError extends Error {
  readonly code = "ETA_SUBMISSION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`تقديم الفاتورة الإلكترونية "${id}" غير موجود.`);
    this.messageEn = `ETA submission "${id}" not found.`;
    this.name = "EtaSubmissionNotFoundError";
  }
}

export class DuplicateEtaSubmissionError extends Error {
  readonly code = "ETA_SUBMISSION_DUPLICATE";
  readonly messageEn: string;
  constructor(readonly internalId: string) {
    super(`يوجد بالفعل تقديم للفاتورة الإلكترونية للمستند "${internalId}".`);
    this.messageEn = `ETA submission for document "${internalId}" already exists.`;
    this.name = "DuplicateEtaSubmissionError";
  }
}

export class InvalidEtaTransitionError extends Error {
  readonly code = "ETA_INVALID_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly from: EtaSubmissionStatus,
    readonly action: string,
  ) {
    super(`لا يمكن ${etaActionAr(action)} تقديمًا للفاتورة الإلكترونية في حالة "${getEtaStatusLabel(from)}".`);
    this.messageEn = `Cannot ${ETA_ACTION_EN[action] ?? action} an ETA submission in status "${getEtaStatusLabelEn(from)}".`;
    this.name = "InvalidEtaTransitionError";
  }
}

export class EtaSubmissionInFlightError extends Error {
  readonly code = "ETA_SUBMISSION_IN_PROGRESS";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super("هذا المستند قيد الإرسال إلى مصلحة الضرائب الآن. انتظر حتى تنتهي المحاولة الجارية ثم حاول مرة أخرى.");
    this.messageEn = `ETA submission "${id}" is being transmitted right now; wait for that attempt to finish.`;
    this.name = "EtaSubmissionInFlightError";
  }
}

/** The ONLINE transmit path is a stub in this build — it is refused offline. */
export class EtaOfflineError extends Error {
  readonly code = "ETA_OFFLINE";
  readonly messageEn: string;
  constructor(
    message = "إرسال الفاتورة الإلكترونية يتطلب اتصالاً بالإنترنت وهو معطّل تجريبيًا في هذا الإصدار؛ تم وضع المستند في قائمة الانتظار.",
    messageEn = "ETA transmission is online-only and is stubbed in this build; the document was queued.",
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "EtaOfflineError";
  }
}

export const ETA_CLIENT_SECRET_NEEDS_REENTRY_AR =
  "سر الربط (Client Secret) المحفوظ لا يمكن فتحه على هذا النظام — حُفظ بمفتاح آخر. أعد إدخاله من «الفاتورة الإلكترونية» ← بيانات الربط. بقي المستند في قائمة الانتظار.";
export const ETA_CLIENT_SECRET_NEEDS_REENTRY_EN =
  "The stored Client Secret cannot be opened on this system — it was sealed under another key. Enter it again under E-invoicing → Credentials. The document stays queued.";

/** The stored client secret cannot be opened here: no token is requested, the document stays queued, and the user is told why. */
export class EtaClientSecretNeedsReentryError extends EtaOfflineError {
  readonly reason = "CLIENT_SECRET_NEEDS_REENTRY";
  constructor() {
    super(ETA_CLIENT_SECRET_NEEDS_REENTRY_AR, ETA_CLIENT_SECRET_NEEDS_REENTRY_EN);
    this.name = "EtaClientSecretNeedsReentryError";
  }
}

/**
 * No POS device serial is registered for the branch the sale was made in. The
 * authority identifies the issuing till by that serial, so a receipt cannot be
 * reported without one and must not be sent with the field blank.
 */
export class EtaDeviceSerialNotRegisteredError extends Error {
  readonly code = "ETA_DEVICE_SERIAL_NOT_REGISTERED";
  readonly messageEn: string;
  constructor(readonly branch: string | null) {
    const where = branch ? ` (${branch})` : "";
    super(
      `لا يمكن إصدار إيصال إلكتروني: لم يُسجَّل رقم تسلسلي لجهاز نقطة البيع لهذا الفرع${where} لدى المصلحة. ` +
        `سجّل الرقم التسلسلي للجهاز في «أكواد الفروع لدى المصلحة» قبل البيع.`,
    );
    this.messageEn = `No POS device serial number is registered with the Tax Authority for this branch${where}; ` +
      `register the device serial under the ETA branch codes before issuing a receipt.`;
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
  readonly messageEn: string;
  constructor(readonly receiptNumber: string) {
    super(`لا يمكن إصدار إيصال مرتجع (${receiptNumber}) دون الإشارة إلى الإيصال الإلكتروني الأصلي للبيع.`);
    this.messageEn = `A refund receipt (${receiptNumber}) must reference the original sale receipt's UUID.`;
    this.name = "EtaRefundReferenceRequiredError";
  }
}

/** The original sale was never receipted, so there is no UUID a refund receipt can reference. */
export class EtaOriginalReceiptNotFoundError extends Error {
  readonly code = "ETA_ORIGINAL_RECEIPT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly invoiceNumber: string) {
    super(`لا يوجد إيصال إلكتروني للفاتورة الأصلية ${invoiceNumber}، فلا يمكن إصدار إيصال مرتجع يشير إليه.`);
    this.messageEn = `The original sale ${invoiceNumber} has no e-receipt for a refund receipt to reference.`;
    this.name = "EtaOriginalReceiptNotFoundError";
  }
}

/** A serial named for a receipt that no branch (or terminal) has registered. */
export class EtaDeviceSerialUnknownError extends Error {
  readonly code = "ETA_DEVICE_SERIAL_UNKNOWN";
  readonly messageEn: string;
  constructor(readonly serial: string) {
    super(`الرقم التسلسلي ${serial} غير مسجّل لأي جهاز نقطة بيع لدى المصلحة.`);
    this.messageEn = `Serial ${serial} is not a registered POS device.`;
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
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "some registration data is missing");
    super(`لا يمكن إصدار الإيصال الإلكتروني قبل استكمال بيانات التسجيل: ${split.ar.join("، ")}.`);
    this.reasons = split.ar;
    this.messageEn = `The e-receipt cannot be issued until its registration data is complete: ${split.en}.`;
    this.name = "EtaReceiptNotReadyError";
  }
}

export class EtaReceiptNotASupplyError extends Error {
  readonly code = "ETA_RECEIPT_NOT_A_SUPPLY";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(`المستند ${documentNumber} إفراج عن محتجزات وليس بيعاً، فلا يصدر له إيصال إلكتروني ولا يُرسل لمصلحة الضرائب.`);
    this.messageEn = `Document ${documentNumber} is a retention release, not a sale; it is issued no e-receipt and is not filed with the tax authority.`;
    this.name = "EtaReceiptNotASupplyError";
  }
}

/** SDK Receipt v1.2 buyer: a natural person at or above the threshold must carry a national ID and a name. */
export class EtaBuyerIdentityRequiredError extends Error {
  readonly code = "ETA_BUYER_IDENTITY_REQUIRED";
  readonly messageEn: string;
  constructor(readonly threshold: string) {
    super(`إيصال بقيمة ${threshold} جنيه أو أكثر لشخص طبيعي يتطلب الرقم القومي والاسم. سجّلهما على العميل ثم أعد الإصدار.`);
    this.messageEn = `A receipt of EGP ${threshold} or more to a natural person needs the buyer's national ID and name.`;
    this.name = "EtaBuyerIdentityRequiredError";
  }
}

/** SDK Receipt Issuance FAQ: a return receipt may be issued at most 540 days after the sale receipt. */
export class EtaRefundTooLateError extends Error {
  readonly code = "ETA_REFUND_TOO_LATE";
  readonly messageEn: string;
  constructor(readonly saleIssuedAt: string) {
    super(`لا يمكن إصدار إيصال مرتجع بعد مرور 540 يوماً على إيصال البيع (${saleIssuedAt}).`);
    this.messageEn = `A return receipt cannot be issued more than 540 days after the sale receipt (${saleIssuedAt}).`;
    this.name = "EtaRefundTooLateError";
  }
}

/** Only a receipt the authority REJECTED (أخطاء) can be corrected and re-issued. */
export class EtaReissueNotRejectedError extends Error {
  readonly code = "ETA_REISSUE_NOT_REJECTED";
  readonly messageEn: string;
  constructor(readonly internalId: string) {
    super(`لا يمكن إعادة إصدار الإيصال "${internalId}" لأن المصلحة لم ترفضه.`);
    this.messageEn = `Receipt "${internalId}" cannot be re-issued because the authority has not rejected it.`;
    this.name = "EtaReissueNotRejectedError";
  }
}

/** SDK Receipt Issuance FAQ: a rejected receipt may be corrected and re-issued only within 96 hours of its own issuance. */
export class EtaReissueWindowExpiredError extends Error {
  readonly code = "ETA_REISSUE_WINDOW_EXPIRED";
  readonly messageEn: string;
  constructor(
    readonly issuedAt: string,
    readonly windowHours: number,
  ) {
    super(`لا يمكن إعادة إصدار الإيصال المرفوض بعد مرور ${windowHours} ساعة على إصداره (${issuedAt}).`);
    this.messageEn = `A rejected receipt cannot be re-issued more than ${windowHours} hours after it was issued (${issuedAt}).`;
    this.name = "EtaReissueWindowExpiredError";
  }
}

/** The corrected receipt is a NEW document on the device's chain; it cannot reuse the rejected receipt's own number. */
export class EtaReissueSameInternalIdError extends Error {
  readonly code = "ETA_REISSUE_SAME_INTERNAL_ID";
  readonly messageEn: string;
  constructor(readonly internalId: string) {
    super(`لا يمكن إعادة إصدار الإيصال "${internalId}" بنفس رقمه — يجب أن يحمل التصحيح رقم إيصال جديداً.`);
    this.messageEn = `The corrected receipt cannot reuse rejected receipt "${internalId}"'s own number — it needs a new receipt number.`;
    this.name = "EtaReissueSameInternalIdError";
  }
}

export class EtaExclusionReasonRequiredError extends Error {
  readonly code = "ETA_EXCLUSION_REASON_REQUIRED";
  readonly messageEn: string;
  constructor() {
    super("استبعاد مستند من التقديم للفاتورة الإلكترونية يتطلب سببًا.");
    this.messageEn = "Excluding a document from ETA submission requires a reason.";
    this.name = "EtaExclusionReasonRequiredError";
  }
}

/** التوقيع الإلكتروني غير مُهيّأ — no external signing program is configured. */
export class EtaSignerNotConfiguredError extends Error {
  readonly code = "ETA_SIGNER_NOT_CONFIGURED";
  readonly messageEn =
    "Electronic signing is done with the taxpayer's signing device (token) and cannot be performed inside the app. Configure the external signing command in the e-invoicing settings before submitting.";
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
  readonly messageEn: string;
  constructor(
    readonly detail: string,
    readonly detailEn: string = detail,
  ) {
    super(`تعذّر توقيع المستند: ${detail}`);
    this.messageEn = `The document could not be signed: ${detailEn}`;
    this.name = "EtaSigningFailedError";
  }
}
