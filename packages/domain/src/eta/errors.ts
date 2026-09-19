import { getEtaStatusLabel, type EtaSubmissionStatus } from "./submission.js";

const ETA_ACTION_AR: Readonly<Record<string, string>> = {
  submit: "إرسال",
  refresh: "تحديث حالة",
  accept: "قبول",
  reject: "رفض",
  exclude: "استبعاد",
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
    this.messageEn = `Cannot ${action} an ETA submission in status "${from}".`;
    this.name = "InvalidEtaTransitionError";
  }
}

/** The ONLINE transmit path is a stub in this build — it is refused offline. */
export class EtaOfflineError extends Error {
  readonly code = "ETA_OFFLINE";
  readonly messageEn: string;
  constructor() {
    super("إرسال الفاتورة الإلكترونية يتطلب اتصالاً بالإنترنت وهو معطّل تجريبيًا في هذا الإصدار؛ تم وضع المستند في قائمة الانتظار.");
    this.messageEn = "ETA transmission is online-only and is stubbed in this build; the document was queued.";
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
