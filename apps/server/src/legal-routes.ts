import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { SmtpConfig } from "@mezan/api";
import { sendNotificationEmail } from "@mezan/api";
import { recordSecurityEvent } from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";
import { callerSource, requireCloudSource, SOCKET_ONLY, type ClientSourceOptions, type SourceReporter } from "./client-source.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import {
  ACCOUNT_DELETION,
  ASK_US,
  CHROME,
  DeletionChannel,
  DELETION_FORM,
  LEGAL_LAST_UPDATED,
  LegalLanguage,
  LegalPage,
  PRIVACY,
  type LegalDocument,
} from "./legal-content.js";

export const LEGAL_BASE_PATH = "/legal";

const DELETION_REQUESTS_PER_HOUR = 5;
const HOW_TO_ASK_SECTION = 1;
const HOUR_MS = 60 * 60 * 1000;
const MAX_NOTE_LENGTH = 1000;
const MAX_FORM_BYTES = 8 * 1024;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const COMPANY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

export interface LegalRoutesDeps {
  readonly platform: PlatformHandle;
  readonly supportEmail?: string;
  readonly platformSmtp?: SmtpConfig;
  readonly clientSource?: ClientSourceOptions;
  readonly sourceReporter?: SourceReporter;
  readonly now: () => Date;
  readonly limiter?: RateLimiter;
  readonly send?: typeof sendNotificationEmail;
}

enum Notice {
  None = "none",
  Invalid = "invalid",
  Failed = "failed",
  TooMany = "too-many",
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function languageOf(c: Context): LegalLanguage {
  return c.req.query("lang") === LegalLanguage.English ? LegalLanguage.English : LegalLanguage.Arabic;
}

function pageUrl(page: LegalPage, lang: LegalLanguage): string {
  const path = `${LEGAL_BASE_PATH}/${page}`;
  return lang === LegalLanguage.Arabic ? path : `${path}?lang=${lang}`;
}

function otherLanguage(lang: LegalLanguage): LegalLanguage {
  return lang === LegalLanguage.Arabic ? LegalLanguage.English : LegalLanguage.Arabic;
}

const STYLE = `
:root{--bg:#ffffff;--fg:#1e293b;--muted:#475569;--brand:#003ce1;--border:#e2e8f0;--warn-bg:#fef3c7;--warn-fg:#78350f;--ok-bg:#dcfce7;--ok-fg:#14532d;--err-bg:#fee2e2;--err-fg:#7f1d1d;--field:#f8fafc}
@media (prefers-color-scheme: dark){:root{--bg:#0f172a;--fg:#e2e8f0;--muted:#94a3b8;--brand:#7aa2ff;--border:#334155;--warn-bg:#422006;--warn-fg:#fde68a;--ok-bg:#052e16;--ok-fg:#bbf7d0;--err-bg:#450a0a;--err-fg:#fecaca;--field:#1e293b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,"Segoe UI","Noto Sans Arabic",Tahoma,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
nav{display:flex;flex-wrap:wrap;gap:16px;margin-block-end:16px}
a{color:var(--brand)}
h1{font-size:1.6rem;line-height:1.3;margin:8px 0}
h2{font-size:1.15rem;margin-block:28px 8px}
.draft{background:var(--warn-bg);color:var(--warn-fg);border-radius:8px;padding:12px 16px;font-weight:700}
.meta{color:var(--muted);font-size:.9rem}
.notice{border-radius:8px;padding:12px 16px;margin-block:16px}
.ok{background:var(--ok-bg);color:var(--ok-fg)}
.err{background:var(--err-bg);color:var(--err-fg)}
form{display:grid;gap:12px;border:1px solid var(--border);border-radius:12px;padding:16px}
label{display:grid;gap:4px;font-weight:600}
input,textarea{font:inherit;color:var(--fg);background:var(--field);border:1px solid var(--border);border-radius:8px;padding:10px 12px;width:100%}
button{font:inherit;font-weight:700;color:#fff;background:#003ce1;border:0;border-radius:8px;padding:12px 16px;cursor:pointer}
`;

interface ShellInput {
  readonly lang: LegalLanguage;
  readonly page: LegalPage;
  readonly title: string;
  readonly body: string;
  readonly supportEmail?: string;
}

function shell(input: ShellInput): string {
  const chrome = CHROME[input.lang];
  const other = otherLanguage(input.lang);
  const contact = input.supportEmail
    ? escapeHtml(chrome.contactBySupport(input.supportEmail)).replace(
        escapeHtml(input.supportEmail),
        `<a href="mailto:${escapeHtml(input.supportEmail)}">${escapeHtml(input.supportEmail)}</a>`,
      )
    : escapeHtml(chrome.contactNoSupport);
  return `<!doctype html>
<html lang="${input.lang}" dir="${chrome.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(input.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<nav>
<a href="${pageUrl(LegalPage.Privacy, input.lang)}">${escapeHtml(chrome.privacyLink)}</a>
<a href="${pageUrl(LegalPage.AccountDeletion, input.lang)}">${escapeHtml(chrome.deletionLink)}</a>
<a href="${pageUrl(input.page, other)}" lang="${other}" hreflang="${other}">${escapeHtml(chrome.otherLanguage)}</a>
</nav>
<p class="draft" role="note">${escapeHtml(chrome.draftNotice)}</p>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">${escapeHtml(chrome.lastUpdated)}: ${LEGAL_LAST_UPDATED}</p>
${input.body}
<h2>${escapeHtml(chrome.contactHeading)}</h2>
<p>${contact}</p>
</main>
</body>
</html>`;
}

function renderDocument(doc: LegalDocument, extraBullets: Readonly<Record<number, string>> = {}): string {
  return doc.sections
    .map((section, index) => {
      const extra = extraBullets[index];
      const allBullets = extra === undefined ? section.bullets : [...(section.bullets ?? []), extra];
      const paragraphs = section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
      const bullets = allBullets?.length
        ? `<ul>${allBullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
        : "";
      return `<h2>${escapeHtml(section.heading)}</h2>\n${paragraphs}\n${bullets}`;
    })
    .join("\n");
}

function renderNotice(lang: LegalLanguage, notice: Notice): string {
  const form = DELETION_FORM[lang];
  switch (notice) {
    case Notice.None:
      return "";
    case Notice.Invalid:
      return `<p class="notice err" role="alert">${escapeHtml(form.invalid)}</p>`;
    case Notice.Failed:
      return `<p class="notice err" role="alert">${escapeHtml(form.failed)}</p>`;
    case Notice.TooMany:
      return `<p class="notice err" role="alert">${escapeHtml(form.tooMany)}</p>`;
  }
}

function renderDeletionForm(lang: LegalLanguage, notice: Notice): string {
  const form = DELETION_FORM[lang];
  return `<h2>${escapeHtml(form.heading)}</h2>
${renderNotice(lang, notice)}
<p>${escapeHtml(form.intro)}</p>
<form method="post" action="${pageUrl(LegalPage.AccountDeletion, lang)}">
<label>${escapeHtml(form.companyCode)}<input name="companyCode" required maxlength="64" autocomplete="organization" dir="ltr"></label>
<label>${escapeHtml(form.email)}<input name="email" type="email" required maxlength="254" autocomplete="email" dir="ltr"></label>
<label>${escapeHtml(form.note)}<textarea name="note" rows="3" maxlength="${MAX_NOTE_LENGTH}"></textarea></label>
<button type="submit">${escapeHtml(form.submit)}</button>
</form>`;
}



function fieldOf(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Public, signed-out pages a store reviewer opens from the listing: the
 * privacy policy and the account-deletion request. Mounted ABOVE the demo's
 * basic auth and outside `/api`, so neither a password nor a tenant is needed.
 *
 * The deletion form is rendered only when a request can actually reach a
 * person — a support mailbox AND the platform's outbound mail. Without both,
 * the page offers the support address (if any) and the company administrator,
 * never a form whose submissions nobody reads.
 */
export function createLegalRoutes(deps: LegalRoutesDeps): Hono {
  const app = new Hono();
  const limiter = deps.limiter ?? createRateLimiter(DELETION_REQUESTS_PER_HOUR, HOUR_MS);
  const send = deps.send ?? sendNotificationEmail;
  const channel =
    deps.supportEmail === undefined
      ? DeletionChannel.AdministratorOnly
      : deps.platformSmtp === undefined
        ? DeletionChannel.SupportEmail
        : DeletionChannel.FormAndEmail;
  const formEnabled = channel === DeletionChannel.FormAndEmail;

  function deletionPage(c: Context, lang: LegalLanguage, notice: Notice, status: 200 | 400 | 429 | 502): Response {
    const doc = ACCOUNT_DELETION[lang];
    const askUs: Record<number, string> =
      channel === DeletionChannel.AdministratorOnly ? {} : { [HOW_TO_ASK_SECTION]: ASK_US[lang][channel] };
    const body = renderDocument(doc, askUs) + (formEnabled ? renderDeletionForm(lang, notice) : "");
    return c.html(shell({ lang, page: LegalPage.AccountDeletion, title: doc.title, body, supportEmail: deps.supportEmail }), status);
  }

  app.get(`/${LegalPage.Privacy}`, (c) => {
    const lang = languageOf(c);
    const doc = PRIVACY[lang];
    return c.html(shell({ lang, page: LegalPage.Privacy, title: doc.title, body: renderDocument(doc), supportEmail: deps.supportEmail }));
  });

  app.get(`/${LegalPage.AccountDeletion}`, (c) => deletionPage(c, languageOf(c), Notice.None, 200));

  app.post(`/${LegalPage.AccountDeletion}`, requireCloudSource(deps.clientSource ?? SOCKET_ONLY, deps.sourceReporter), bodyLimit({ maxSize: MAX_FORM_BYTES, onError: (c) => deletionPage(c, languageOf(c), Notice.Invalid, 400) }), async (c) => {
    const lang = languageOf(c);
    if (!formEnabled || deps.supportEmail === undefined || deps.platformSmtp === undefined) {
      return deletionPage(c, lang, Notice.None, 200);
    }
    const ip = callerSource(c);
    if (limiter.retryAfter(ip) > 0) return deletionPage(c, lang, Notice.TooMany, 429);
    limiter.consume(ip);

    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const companyCode = fieldOf(body, "companyCode");
    const email = fieldOf(body, "email").toLowerCase();
    const note = fieldOf(body, "note").slice(0, MAX_NOTE_LENGTH);
    if (!COMPANY_CODE_PATTERN.test(companyCode) || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return deletionPage(c, lang, Notice.Invalid, 400);
    }

    const reference = randomUUID().slice(0, 8).toUpperCase();
    const receivedAt = deps.now().toISOString();
    await recordSecurityEvent(deps.platform.audit, {
      module: "platform",
      entityType: "PLATFORM",
      entityId: null,
      action: "ACCOUNT_DELETION_REQUESTED",
      actor: "public",
      severity: "INFO",
      timestamp: receivedAt,
      details: { reference, companyCode, email, note: note || null, language: lang },
    });

    const outcome = await send(deps.platformSmtp, deps.supportEmail, {
      subject: `طلب حذف حساب — Account deletion request ${reference}`,
      body: [
        `Reference: ${reference}`,
        `Received: ${receivedAt}`,
        `Company code: ${companyCode}`,
        `Account email: ${email}`,
        `Language: ${lang}`,
        `Note: ${note || "-"}`,
      ].join("\n"),
    }).catch(() => ({ outcome: "offline" as const, detail: "" }));
    if (outcome.outcome !== "sent") return deletionPage(c, lang, Notice.Failed, 502);

    const form = DELETION_FORM[lang];
    const confirmation = `<h2>${escapeHtml(form.receivedTitle)}</h2>
<p class="notice ok" role="status">${escapeHtml(form.received(reference))}</p>
<p><a href="${pageUrl(LegalPage.AccountDeletion, lang)}">${escapeHtml(form.back)}</a></p>`;
    return c.html(
      shell({ lang, page: LegalPage.AccountDeletion, title: ACCOUNT_DELETION[lang].title, body: confirmation, supportEmail: deps.supportEmail }),
      201,
    );
  });

  return app;
}
