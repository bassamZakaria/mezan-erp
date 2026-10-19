import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlatform, type PlatformHandle } from "@mezan/backend";
import type { SmtpConfig } from "@mezan/api";
import { createLegalRoutes } from "./legal-routes.js";
import { reachable } from "./cloud-harness.js";

const T = "2026-09-21T10:00:00.000Z";

const SMTP: SmtpConfig = {
  smtpEnabled: true,
  smtpHost: "smtp.mezan.test",
  smtpPort: 587,
  smtpSecurity: "STARTTLS",
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "Mezan",
  smtpFromEmail: "no-reply@mezan.test",
};

function form(fields: Record<string, string>, query = ""): Request {
  return new Request(`http://legal/account-deletion${query}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("legal pages", () => {
  let platform: PlatformHandle;

  beforeEach(async () => {
    platform = await createPlatform({ dbPath: ":memory:" });
  });

  afterEach(() => platform.close());

  it("serves the privacy policy in Arabic by default and in English on ?lang=en, headed as a draft", async () => {
    const app = reachable(createLegalRoutes({ platform, supportEmail: "support@mezan.test", now: () => new Date(T) }));

    const ar = await app.fetch(new Request("http://legal/privacy"));
    expect(ar.status).toBe(200);
    const arHtml = await ar.text();
    expect(arHtml).toContain('lang="ar" dir="rtl"');
    expect(arHtml).toContain("مسودة — تحتاج مراجعة قانونية");
    expect(arHtml).toContain("صورة تسجيل الحضور");
    expect(arHtml).toContain('href="mailto:support@mezan.test"');

    const en = await app.fetch(new Request("http://legal/privacy?lang=en"));
    const enHtml = await en.text();
    expect(enHtml).toContain('lang="en" dir="ltr"');
    expect(enHtml).toContain("Draft — needs legal review");
    expect(enHtml).toContain("Face ID or fingerprint");
  });

  it("offers no form when no request could reach a person, only the administrator path", async () => {
    const app = reachable(createLegalRoutes({ platform, now: () => new Date(T) }));

    const html = await (await app.fetch(new Request("http://legal/account-deletion?lang=en"))).text();
    expect(html).toContain("Users screen");
    expect(html).not.toContain("<form");
    expect(html).toContain("contact your company&#39;s administrator");
    expect(html).not.toContain("Ask us directly");

    const post = await app.fetch(form({ companyCode: "acme", email: "a@acme.test" }));
    expect(post.status).toBe(200);
    expect(await platform.audit.query("security")).toHaveLength(0);
  });

  it("points at the support mailbox, without a form, when the platform sends no mail", async () => {
    const app = reachable(createLegalRoutes({ platform, supportEmail: "support@mezan.test", now: () => new Date(T) }));
    const html = await (await app.fetch(new Request("http://legal/account-deletion?lang=en"))).text();
    expect(html).not.toContain("<form");
    expect(html).toContain("write to the email address at the end of this page");
    expect(html).toContain('href="mailto:support@mezan.test"');
  });

  it("records a deletion request, mails it to support, and answers with its reference", async () => {
    const send = vi.fn(async () => ({ outcome: "sent" as const, detail: "250" }));
    const app = reachable(createLegalRoutes({ platform, supportEmail: "support@mezan.test", platformSmtp: SMTP, now: () => new Date(T), send }));

    const page = await (await app.fetch(new Request("http://legal/account-deletion?lang=en"))).text();
    expect(page).toContain("<form");
    expect(page).toContain("use the form below");

    const res = await app.fetch(form({ companyCode: "acme", email: "Mona@Acme.test", note: "left the company" }, "?lang=en"));
    expect(res.status).toBe(201);
    const html = await res.text();
    const reference = /Request number: ([0-9A-F]{8})/.exec(html)?.[1];
    expect(reference).toBeDefined();

    expect(send).toHaveBeenCalledTimes(1);
    const [, to, message] = send.mock.calls[0] as unknown as [SmtpConfig, string, { subject: string; body: string }];
    expect(to).toBe("support@mezan.test");
    expect(message.body).toContain("Account email: mona@acme.test");
    expect(message.body).toContain(`Reference: ${reference}`);

    const events = await platform.audit.query("security");
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("ACCOUNT_DELETION_REQUESTED");
    expect(events[0]!.details).toMatchObject({ reference, companyCode: "acme", email: "mona@acme.test" });
  });

  it("refuses an invalid request without mailing, and says so when the mail does not go", async () => {
    const send = vi.fn(async () => ({ outcome: "offline" as const, detail: "ECONNREFUSED" }));
    const app = reachable(createLegalRoutes({ platform, supportEmail: "support@mezan.test", platformSmtp: SMTP, now: () => new Date(T), send }));

    const invalid = await app.fetch(form({ companyCode: "", email: "not-an-email" }));
    expect(invalid.status).toBe(400);
    expect(send).not.toHaveBeenCalled();

    const oversized = await app.fetch(form({ companyCode: "acme", email: "a@acme.test", note: "x".repeat(20_000) }));
    expect(oversized.status).toBe(400);
    expect(send).not.toHaveBeenCalled();

    const failed = await app.fetch(form({ companyCode: "acme", email: "a@acme.test" }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain("تعذّر إرسال الطلب");
  });

  it("rate-limits a flood of requests from one address", async () => {
    const send = vi.fn(async () => ({ outcome: "sent" as const, detail: "250" }));
    const app = reachable(createLegalRoutes({ platform, supportEmail: "support@mezan.test", platformSmtp: SMTP, now: () => new Date(T), send }));

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await app.fetch(form({ companyCode: "acme", email: `u${i}@acme.test`, note: "<script>x</script>" }))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });

  it("counts a deletion request against the hop the trusted proxy appended, never a hop the caller wrote ahead of it", async () => {
    const send = vi.fn(async () => ({ outcome: "sent" as const, detail: "250" }));
    const app = createLegalRoutes({
      platform, supportEmail: "support@mezan.test", platformSmtp: SMTP, now: () => new Date(T), send,
      clientSource: { trustedProxyHops: 2 },
    });
    const from = (chain: string, i: number) => {
      const request = form({ companyCode: "acme", email: `u${i}@acme.test` });
      request.headers.set("x-forwarded-for", chain);
      return app.fetch(request);
    };

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await from(`9.9.9.${i}, 5.5.5.5, 130.176.0.7`, i)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);

    expect((await from("5.5.5.5, 41.33.10.10, 130.176.0.7", 7)).status).toBe(201);
    expect((await from("130.176.0.7", 8)).status).toBe(503);
    expect(send).toHaveBeenCalledTimes(6);
  });
});
