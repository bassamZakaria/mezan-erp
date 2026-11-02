export enum BackfilledErrorCode {
  ValidationError = "VALIDATION_ERROR",
  NotFound = "NOT_FOUND",
  Unauthenticated = "UNAUTHENTICATED",
  Forbidden = "FORBIDDEN",
  NotConfigured = "NOT_CONFIGURED",
  EntitlementsUnavailable = "ENTITLEMENTS_UNAVAILABLE",
  Internal = "INTERNAL",
  Upstream = "UPSTREAM",
  Refused = "REFUSED",
  UserNotLinkedToEmployee = "USER_NOT_LINKED_TO_EMPLOYEE",
}

export interface Bilingual {
  readonly ar: string;
  readonly en: string;
}

const NOT_FOUND_SUFFIX = "_NOT_FOUND";
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

const BY_CODE: Readonly<Record<BackfilledErrorCode, Bilingual>> = {
  [BackfilledErrorCode.ValidationError]: { ar: "البيانات المُرسلة غير صالحة.", en: "The submitted data is not valid." },
  [BackfilledErrorCode.NotFound]: { ar: "السجل المطلوب غير موجود، وربما حُذف.", en: "The requested record was not found; it may have been deleted." },
  [BackfilledErrorCode.Unauthenticated]: { ar: "لم يتم تسجيل الدخول أو انتهت الجلسة. سجّل الدخول مرة أخرى.", en: "You are not signed in, or your session has ended. Sign in again." },
  [BackfilledErrorCode.Forbidden]: { ar: "ليست لديك صلاحية لتنفيذ هذه العملية.", en: "You do not have permission to do this." },
  [BackfilledErrorCode.NotConfigured]: { ar: "هذه الخدمة غير مُفعّلة على هذا الخادم.", en: "This service is not set up on this server." },
  [BackfilledErrorCode.EntitlementsUnavailable]: { ar: "تعذّر التحقق من الترخيص الآن. حاول مرة أخرى بعد قليل.", en: "The licence could not be checked right now. Try again shortly." },
  [BackfilledErrorCode.Internal]: { ar: "حدث خطأ داخلي في الخادم.", en: "An internal server error occurred." },
  [BackfilledErrorCode.Upstream]: { ar: "تعذّر الوصول إلى خدمة خارجية. حاول مرة أخرى بعد قليل.", en: "An external service could not be reached. Try again shortly." },
  [BackfilledErrorCode.Refused]: { ar: "رُفضت العملية.", en: "The operation was refused." },
  [BackfilledErrorCode.UserNotLinkedToEmployee]: { ar: "حسابك غير مرتبط بسجل موظف.", en: "Your account is not linked to an employee record." },
};

const BY_STATUS: Readonly<Record<number, Bilingual>> = {
  400: { ar: "الطلب غير صالح.", en: "The request is not valid." },
  401: BY_CODE[BackfilledErrorCode.Unauthenticated],
  403: BY_CODE[BackfilledErrorCode.Forbidden],
  404: BY_CODE[BackfilledErrorCode.NotFound],
  409: { ar: "تعارضت العملية مع الحالة الحالية للسجل.", en: "The operation conflicts with the record's current state." },
  413: { ar: "حجم البيانات المُرسلة أكبر من المسموح.", en: "The submitted data is too large." },
  422: { ar: "تعذّر تنفيذ العملية بهذه البيانات.", en: "The operation could not be carried out with this data." },
  503: { ar: "الخدمة مشغولة الآن. حاول مرة أخرى بعد قليل.", en: "The service is busy right now. Try again shortly." },
  429: { ar: "طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.", en: "Too many requests in a short time. Wait a moment and try again." },
};

const SERVER_ERROR: Bilingual = BY_CODE[BackfilledErrorCode.Internal];
const GENERIC_CLIENT_ERROR: Bilingual = BY_STATUS[400]!;

export function genericText(status: number): Bilingual {
  return BY_STATUS[status] ?? (status >= 500 ? SERVER_ERROR : GENERIC_CLIENT_ERROR);
}

export function genericMessageEn(status: number): string {
  return genericText(status).en;
}

export function messageEnOf(err: unknown, status = 422): string {
  const messageEn = (err as { readonly messageEn?: unknown } | null)?.messageEn;
  return nonEmpty(messageEn) ? messageEn : genericMessageEn(status);
}

export function bilingualText(text: string, fallback: Bilingual = BY_CODE[BackfilledErrorCode.ValidationError]): Bilingual {
  if (!nonEmpty(text)) return fallback;
  return ARABIC_SCRIPT.test(text) ? { ar: text, en: fallback.en } : { ar: fallback.ar, en: text };
}

export function issueText(issue: { readonly message: string }): { message: string; messageEn: string } {
  const params = (issue as { readonly params?: { readonly messageEn?: unknown } }).params;
  if (typeof params?.messageEn === "string") return { message: issue.message, messageEn: params.messageEn };
  const text = bilingualText(issue.message);
  return { message: text.ar, messageEn: text.en };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function invalidFieldsOf(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (fieldErrors && typeof fieldErrors === "object") return Object.keys(fieldErrors);
  const issues = Array.isArray(details) ? details : (details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  const fields = issues
    .map((issue: unknown) => (issue && typeof issue === "object" ? (issue as { path?: unknown }).path : undefined))
    .filter((path): path is unknown[] => Array.isArray(path) && path.length > 0)
    .map((path) => path.join("."));
  return [...new Set(fields)];
}

function formErrorsOf(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const formErrors = (details as { formErrors?: unknown }).formErrors;
  return Array.isArray(formErrors) ? formErrors.filter(nonEmpty) : [];
}

function textFor(code: string | undefined, status: number, details: unknown): Bilingual {
  if (code === BackfilledErrorCode.ValidationError) {
    const fields = invalidFieldsOf(details);
    if (fields.length > 0) return { ar: `بيانات غير صالحة في: ${fields.join("، ")}.`, en: `Invalid data in: ${fields.join(", ")}.` };
    const formErrors = formErrorsOf(details);
    const arabic = formErrors.filter((text) => ARABIC_SCRIPT.test(text));
    const english = formErrors.filter((text) => !ARABIC_SCRIPT.test(text));
    const generic = BY_CODE[BackfilledErrorCode.ValidationError];
    if (formErrors.length > 0) return { ar: arabic.length > 0 ? arabic.join(" ") : generic.ar, en: english.length > 0 ? english.join(" ") : generic.en };
  }
  const known = code !== undefined ? BY_CODE[code as BackfilledErrorCode] : undefined;
  if (known) return known;
  if (code?.endsWith(NOT_FOUND_SUFFIX)) return BY_CODE[BackfilledErrorCode.NotFound];
  const byStatus = genericText(status);
  if (!code) return byStatus;
  return { ar: `${byStatus.ar} (${code})`, en: `${byStatus.en} (${code})` };
}

/**
 * Gives an error body that carries no human sentence one in both languages, so the screen shows
 * why the server refused instead of its own generic fallback. Additive only: a `message` or
 * `messageEn` the route wrote is never replaced, and other keys pass through untouched.
 */
export function backfillErrorMessage(body: Record<string, unknown>, status: number): Record<string, unknown> | null {
  const hasAr = nonEmpty(body.message);
  const hasEn = nonEmpty(body.messageEn);
  if (hasAr || hasEn) return null;
  const code = nonEmpty(body.error) ? body.error : undefined;
  const text = textFor(code, status, body.details);
  return { ...body, message: text.ar, messageEn: text.en };
}
