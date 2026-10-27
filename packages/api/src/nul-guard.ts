import type { Context, MiddlewareHandler } from "hono";
import { isMutatingRequest, preloadBody } from "./audit-boundary.js";

export const NUL_CHARACTER_REFUSED = "NUL_CHARACTER_REFUSED";

const JSON_NUL_ESCAPE = /(?<!\\)(?:\\\\)*\\u0000/i;
const ENCODED_NUL = /%00/i;
const MULTIPART = /^multipart\//i;

export interface NulGuardOptions {
  // Bodies larger than this, or of unknown length, are left to the app mounted below, which checks them under its own size limit.
  readonly maxBodyBytes?: number;
}

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

function bodyIsChecked(c: Context, options: NulGuardOptions): boolean {
  if (!isMutatingRequest(c) || MULTIPART.test(c.req.header("content-type") ?? "")) return false;
  if (options.maxBodyBytes === undefined) return true;
  const length = Number(c.req.header("content-length"));
  return Number.isFinite(length) && length <= options.maxBodyBytes;
}

// SECURITY: Postgres refuses a NUL in text and in jsonb; one stored as JSON text
// later breaks every query that casts that column, for the whole tenant. Handlers
// parse JSON whatever the content type says, so every non-multipart body is read.
export function refuseNulCharacters(options: NulGuardOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    if (ENCODED_NUL.test(c.req.url) || c.req.url.includes("\u0000")) return refuse(c);
    if (bodyIsChecked(c, options)) {
      await preloadBody(c);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.includes(0) || JSON_NUL_ESCAPE.test(new TextDecoder().decode(bytes))) return refuse(c);
    }
    return next();
  };
}
