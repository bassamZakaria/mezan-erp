import { sendNotificationEmail, type SmtpConfig } from "@mezan/api";

export interface PlatformMail {
  readonly subject: string;
  readonly body: string;
}

export interface PlatformMailer {
  send(to: string, mail: PlatformMail): Promise<{ readonly outcome: string; readonly detail?: string }>;
}

export function smtpMailer(config: SmtpConfig): PlatformMailer {
  return { send: (to, mail) => sendNotificationEmail(config, to, mail) };
}

export function pendingHandOverEmail(input: { readonly link: string; readonly companyName: string; readonly successorEmail: string }): PlatformMail {
  return {
    subject: "تأكيد نقل ملكية منشأتك على ميزان — Confirm the hand-over of your Mezan company",
    body: [
      `مرحبًا،`,
      ``,
      `طُلب نقل ملكية "${input.companyName}" على ميزان إلى الحساب: ${input.successorEmail}`,
      `لن يتم النقل إلا إذا أكّدته أنت. للتأكيد افتح الرابط التالي:`,
      input.link,
      ``,
      `إن لم تطلب هذا النقل فلا تفتح الرابط، وتواصل مع دعم المنصة فورًا.`,
      ``,
      `-----`,
      ``,
      `Hello,`,
      ``,
      `A hand-over of "${input.companyName}" on Mezan to this account was requested: ${input.successorEmail}`,
      `Nothing moves unless you confirm it. To confirm, open the link below:`,
      input.link,
      ``,
      `If you did not ask for this, do not open the link, and contact platform support at once.`,
    ].join("\n"),
  };
}
