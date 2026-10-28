import { DEFAULT_STATEMENT_EMAIL_BODY, DEFAULT_STATEMENT_EMAIL_SUBJECT, type TenantSettings } from "@mezan/domain";

/**
 * The template defaults shipped before #129 named document fields no mail ever
 * supplied, and nothing rendered them. Books still holding those untouched
 * defaults move to the statement template; a tenant's own wording is kept.
 */
const UNRENDERED_EMAIL_TEMPLATE_SUBJECT = "{{documentType}} رقم {{documentNumber}} من {{companyName}}";
const UNRENDERED_EMAIL_TEMPLATE_BODY =
  "السلام عليكم {{recipientName}}،\n\nمرفق {{documentType}} رقم {{documentNumber}} بتاريخ {{documentDate}} بإجمالي {{documentTotal}}.\n\nمع خالص الشكر،\n{{companyName}}";

export function withStatementEmailTemplate(settings: TenantSettings): TenantSettings {
  const subject = settings.emailTemplateSubject === UNRENDERED_EMAIL_TEMPLATE_SUBJECT;
  const body = settings.emailTemplateBody === UNRENDERED_EMAIL_TEMPLATE_BODY;
  if (!subject && !body) return settings;
  return {
    ...settings,
    ...(subject ? { emailTemplateSubject: DEFAULT_STATEMENT_EMAIL_SUBJECT } : {}),
    ...(body ? { emailTemplateBody: DEFAULT_STATEMENT_EMAIL_BODY } : {}),
  };
}
