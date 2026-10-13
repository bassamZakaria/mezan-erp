import type { MiddlewareHandler } from "hono";

const ARABIC = /[؀-ۿ]/;
const VALIDATION_ERROR = "VALIDATION_ERROR";
const GENERIC_AR = "البيانات المرسلة غير صالحة — راجع الحقول المطلوبة وصيغة كل قيمة.";
const GENERIC_EN = "The request is not valid — check the required fields and the format of each value.";

interface FlattenedIssues {
  readonly formErrors?: unknown;
  readonly fieldErrors?: unknown;
}

function firstArabicIssue(details: FlattenedIssues | undefined): { field: string | null; text: string } | null {
  const fields = details?.fieldErrors;
  if (fields !== null && typeof fields === "object") {
    for (const [field, messages] of Object.entries(fields)) {
      const text = Array.isArray(messages) ? messages.find((message): message is string => typeof message === "string" && ARABIC.test(message)) : undefined;
      if (text) return { field, text };
    }
  }
  const form = Array.isArray(details?.formErrors) ? details.formErrors.find((message): message is string => typeof message === "string" && ARABIC.test(message)) : undefined;
  return form ? { field: null, text: form } : null;
}

/**
 * EXTERNAL CONTRACT: every 400 `VALIDATION_ERROR` leaves with a top-level
 * Arabic `message`. Routes answer with zod's `details` alone, and the clients
 * show `message` when there is one — without it a refused amount reads as an
 * English schema path or as nothing.
 */
export function validationMessages(): MiddlewareHandler {
  return async function validationMessage(c, next) {
    await next();
    if (c.res.status !== 400 || !(c.res.headers.get("content-type") ?? "").includes("application/json")) return;
    const body = (await c.res.clone().json().catch(() => null)) as { error?: unknown; message?: unknown; details?: FlattenedIssues } | null;
    if (!body || body.error !== VALIDATION_ERROR || typeof body.message === "string") return;
    const issue = firstArabicIssue(body.details);
    const message = issue ? (issue.field ? `الحقل «${issue.field}»: ${issue.text}` : issue.text) : GENERIC_AR;
    const headers = new Headers(c.res.headers);
    headers.delete("content-length");
    c.res = new Response(JSON.stringify({ ...body, message, messageEn: GENERIC_EN }), { status: 400, headers });
  };
}
