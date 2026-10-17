export interface BilingualReason {
  readonly ar: string;
  readonly en: string;
}

export class InvalidDunningPolicyError extends Error {
  readonly code = "INVALID_DUNNING_POLICY";
  readonly messageEn: string;
  constructor(readonly reasons: readonly BilingualReason[]) {
    super(reasons.map((reason) => reason.ar).join("، "));
    this.messageEn = reasons.map((reason) => reason.en).join("; ");
    this.name = "InvalidDunningPolicyError";
  }
}

export class DunningReminderNotFoundError extends Error {
  readonly code = "DUNNING_REMINDER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly reminderId: string) {
    super(`لا يوجد تذكير تحصيل بالمعرّف "${reminderId}".`);
    this.messageEn = `There is no collection reminder with id "${reminderId}".`;
    this.name = "DunningReminderNotFoundError";
  }
}

export class DunningReminderNotSendableError extends Error {
  readonly code = "DUNNING_REMINDER_NOT_SENDABLE";
  readonly messageEn = "This reminder cannot be sent in its current state.";
  constructor(readonly reminderId: string, readonly status: string) {
    super("لا يمكن إرسال هذا التذكير في حالته الحالية.");
    this.name = "DunningReminderNotSendableError";
  }
}

export class CustomerContactMissingError extends Error {
  readonly code = "CUSTOMER_CONTACT_MISSING";
  readonly messageEn: string;
  constructor(readonly customerId: string, readonly channel: string) {
    super(channel === "email" ? "لا يوجد بريد إلكتروني مسجَّل لهذا العميل." : "لا يوجد رقم هاتف صالح مسجَّل لهذا العميل.");
    this.messageEn = channel === "email" ? "This customer has no email address on file." : "This customer has no valid phone number on file.";
    this.name = "CustomerContactMissingError";
  }
}

export class SmsProviderNotConfiguredError extends Error {
  readonly code = "SMS_PROVIDER_NOT_CONFIGURED";
  readonly messageEn = "No SMS provider is connected yet; it needs a subscription from the business owner. Use email or WhatsApp instead.";
  constructor() {
    super("لم يُربط مزوّد رسائل SMS بعد؛ يحتاج اشتراكاً من صاحب المنشأة. استخدم البريد الإلكتروني أو واتساب.");
    this.name = "SmsProviderNotConfiguredError";
  }
}

export class InvalidPromiseToPayError extends Error {
  readonly code = "INVALID_PROMISE_TO_PAY";
  constructor(message: string, readonly messageEn: string) {
    super(message);
    this.name = "InvalidPromiseToPayError";
  }
}

export class PromiseToPayNotFoundError extends Error {
  readonly code = "PROMISE_TO_PAY_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly promiseId: string) {
    super(`لا يوجد وعد بالسداد بالمعرّف "${promiseId}".`);
    this.messageEn = `There is no promise to pay with id "${promiseId}".`;
    this.name = "PromiseToPayNotFoundError";
  }
}

export class DunningHoldNotFoundError extends Error {
  readonly code = "DUNNING_HOLD_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly customerId: string) {
    super(`لا يوجد إيقاف للمطالبة على العميل "${customerId}".`);
    this.messageEn = `Customer "${customerId}" has no dunning pause.`;
    this.name = "DunningHoldNotFoundError";
  }
}
