import type { Context, MiddlewareHandler } from "hono";
import { isMutatingRequest, preloadBody } from "./audit-boundary.js";

export const NUL_CHARACTER_REFUSED = "NUL_CHARACTER_REFUSED";

const JSON_NUL_ESCAPE = /\\u0000/i;

function refuse(c: Context): Response {
  return c.json(
    {
      error: NUL_CHARACTER_REFUSED,
      message: "يحتوي الطلب على حرف غير مسموح به، فلم يُحفظ أي تغيير.",
      messageEn: "The request contains a character that is not allowed, so nothing was saved.",
    },
    400,
  );
}

const TEXT_BODY = /json|text\/|x-www-form-urlencoded/i;

function carriesText(c: Context): boolean {
  const type = c.req.header("content-type") ?? "";
  return type === "" || TEXT_BODY.test(type);
}

function urlCarriesNul(c: Context): boolean {
  try {
    return decodeURIComponent(c.req.url).includes("\u0000");
  } catch {
    return false;
  }
}

// SECURITY: Postgres refuses a NUL in text and in jsonb; one stored as JSON text
// later breaks every query that casts that column, for the whole tenant.
export function refuseNulCharacters(options: { readonly body: boolean } = { body: true }): MiddlewareHandler {
  return async (c, next) => {
    if (urlCarriesNul(c)) return refuse(c);
    if (options.body && isMutatingRequest(c) && carriesText(c)) {
      await preloadBody(c);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.includes(0) || JSON_NUL_ESCAPE.test(new TextDecoder().decode(bytes))) return refuse(c);
    }
    return next();
  };
}
