import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_STATEMENT_EMAIL_BODY, DEFAULT_STATEMENT_EMAIL_SUBJECT } from "@mezan/domain";
import { StatementChannelDTO } from "@mezan/contracts";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";
import { withStatementEmailTemplate } from "./statement-template-upgrade.js";

interface Sent {
  readonly fromName: string;
  readonly fromEmail: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

const sent: Sent[] = [];
let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld({
    sendMail: async (smtp, to, message) => {
      sent.push({ fromName: smtp.smtpFromName, fromEmail: smtp.smtpFromEmail, to, subject: message.subject, body: message.body });
      return { outcome: "sent", detail: "250" };
    },
  });
}, 120_000);

afterAll(() => world?.close());

describe("#129 the customer mail queue sends the tenant's sender and template", () => {
  it("a statement emailed to a customer carries the tenant's from-name and its rendered subject and body", async () => {
    const customers = (await world.request("GET", "/customers")).body as unknown as { id: string; nameAr: string; email: string | null }[];
    const customer = customers.find((row) => row.email);
    expect(customer, "the seed must hold a customer with an email").toBeDefined();
    const saved = await world.request("PUT", "/settings", {
      smtpEnabled: true,
      smtpHost: "127.0.0.1",
      smtpFromName: "ميزان — الحسابات",
      smtpFromEmail: "accounts@example.com",
      emailTemplateSubject: "كشف حساب {{customerName}}",
      emailTemplateBody: "عزيزنا {{customerName}}، رصيدكم {{balanceDue}} حتى {{asOfDate}}.\n{{companyName}}",
    });
    expect(saved.status).toBe(200);

    const queued = await world.request("POST", `/collections/customers/${customer!.id}/statement`, { channel: StatementChannelDTO.Email });
    expect(queued.status).toBe(200);
    expect((await world.request("POST", "/collections/outbox/drain")).status).toBe(200);

    const mail = sent.find((row) => row.to === customer!.email);
    expect(mail).toBeDefined();
    expect(mail!.fromName).toBe("ميزان — الحسابات");
    expect(mail!.fromEmail).toBe("accounts@example.com");
    expect(mail!.subject).toBe(`كشف حساب ${customer!.nameAr}`);
    expect(mail!.body).toMatch(new RegExp(`^عزيزنا ${customer!.nameAr}، رصيدكم [\\d,]+\\.\\d{2} ج\\.م حتى \\d{4}-\\d{2}-\\d{2}\\.`));
  });

  it("refuses a sender name that would add a mail header, and keeps the stored one", async () => {
    const refused = await world.request("PUT", "/settings", { smtpFromName: "Mezan\r\nBcc: someone@example.com" });
    expect(refused.status).toBe(422);
    expect((await world.request("GET", "/settings")).body.smtpFromName).toBe("ميزان — الحسابات");
  });
});

describe("#129 books holding the never-rendered document template move to the statement template", () => {
  const unrendered = {
    ...DEFAULT_SETTINGS,
    emailTemplateSubject: "{{documentType}} رقم {{documentNumber}} من {{companyName}}",
    emailTemplateBody:
      "السلام عليكم {{recipientName}}،\n\nمرفق {{documentType}} رقم {{documentNumber}} بتاريخ {{documentDate}} بإجمالي {{documentTotal}}.\n\nمع خالص الشكر،\n{{companyName}}",
  };

  it("replaces the untouched old defaults", () => {
    const upgraded = withStatementEmailTemplate(unrendered);
    expect(upgraded.emailTemplateSubject).toBe(DEFAULT_STATEMENT_EMAIL_SUBJECT);
    expect(upgraded.emailTemplateBody).toBe(DEFAULT_STATEMENT_EMAIL_BODY);
  });

  it("keeps a tenant's own wording", () => {
    const own = { ...unrendered, emailTemplateBody: "نصنا الخاص" };
    expect(withStatementEmailTemplate(own).emailTemplateBody).toBe("نصنا الخاص");
    expect(withStatementEmailTemplate(own).emailTemplateSubject).toBe(DEFAULT_STATEMENT_EMAIL_SUBJECT);
    expect(withStatementEmailTemplate(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
  });
});
