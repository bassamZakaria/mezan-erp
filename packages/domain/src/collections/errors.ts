export class InvalidDunningPolicyError extends Error {
  readonly code = "INVALID_DUNNING_POLICY";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidDunningPolicyError";
  }
}

export class DunningReminderNotFoundError extends Error {
  readonly code = "DUNNING_REMINDER_NOT_FOUND";
  constructor(readonly reminderId: string) {
    super(`لا يوجد تذكير تحصيل بالمعرّف "${reminderId}".`);
    this.name = "DunningReminderNotFoundError";
  }
}

export class DunningReminderNotSendableError extends Error {
  readonly code = "DUNNING_REMINDER_NOT_SENDABLE";
  constructor(readonly reminderId: string, readonly status: string) {
    super("لا يمكن إرسال هذا التذكير في حالته الحالية.");
    this.name = "DunningReminderNotSendableError";
  }
}

export class CustomerContactMissingError extends Error {
  readonly code = "CUSTOMER_CONTACT_MISSING";
  constructor(readonly customerId: string, readonly channel: string) {
    super(channel === "email" ? "لا يوجد بريد إلكتروني مسجَّل لهذا العميل." : "لا يوجد رقم هاتف صالح مسجَّل لهذا العميل.");
    this.name = "CustomerContactMissingError";
  }
}

export class SmsProviderNotConfiguredError extends Error {
  readonly code = "SMS_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super("لم يُربط مزوّد رسائل SMS بعد؛ يحتاج اشتراكاً من صاحب المنشأة. استخدم البريد الإلكتروني أو واتساب.");
    this.name = "SmsProviderNotConfiguredError";
  }
}

export class InvalidPromiseToPayError extends Error {
  readonly code = "INVALID_PROMISE_TO_PAY";
  constructor(message: string) {
    super(message);
    this.name = "InvalidPromiseToPayError";
  }
}

export class PromiseToPayNotFoundError extends Error {
  readonly code = "PROMISE_TO_PAY_NOT_FOUND";
  constructor(readonly promiseId: string) {
    super(`لا يوجد وعد بالسداد بالمعرّف "${promiseId}".`);
    this.name = "PromiseToPayNotFoundError";
  }
}
