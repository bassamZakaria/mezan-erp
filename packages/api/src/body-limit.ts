import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isMutatingRequest } from "./audit-boundary.js";
import type { AuthContextResolver } from "./permission-gate.js";

const KIB = 1024;
const MIB = 1024 * KIB;

export enum BodyLimitBytes {
  /** A caller nobody has identified: a sign-in, a first-run claim, a probe. */
  Anonymous = 64 * KIB,
  /** A signed-in caller's document: the longest invoice is a fraction of this. */
  Document = 2 * MIB,
  /** A signed-in caller sending a file: the 5 MiB attachment ceiling, base64-encoded inside JSON, with room. */
  Upload = 16 * MIB,
}

const UPLOAD_PATH = /\/(attachments|data-migration|import|import-file|commit|clock|photo|boq|settings|profile|users|print-templates|label-layouts)(\/|$)/;

function tooLarge(c: Context): Response {
  return c.json(
    {
      error: "PAYLOAD_TOO_LARGE",
      message: "حجم البيانات المرسلة أكبر من المسموح به لهذه العملية.",
      messageEn: "The request body is larger than this operation accepts.",
    },
    413,
  );
}

// Registered ahead of everything that reads a body. The body is buffered before
// the connection's turn is taken (audit-boundary.ts `preloadBody`), which is
// before any route's gate has run — so how much a caller may make the server
// hold is decided here, from who is asking: the generous limit is for a
// signed-in caller on a route that takes files, and for nobody else.
export function requestBodyLimit(resolveAuthContext: AuthContextResolver): MiddlewareHandler {
  const limits: Readonly<Record<BodyLimitBytes, MiddlewareHandler>> = {
    [BodyLimitBytes.Anonymous]: bodyLimit({ maxSize: BodyLimitBytes.Anonymous, onError: tooLarge }),
    [BodyLimitBytes.Document]: bodyLimit({ maxSize: BodyLimitBytes.Document, onError: tooLarge }),
    [BodyLimitBytes.Upload]: bodyLimit({ maxSize: BodyLimitBytes.Upload, onError: tooLarge }),
  };
  return async (c, next) => {
    if (!isMutatingRequest(c)) return next();
    const signedIn = (await resolveAuthContext(c)).authenticated;
    const allowed = !signedIn ? BodyLimitBytes.Anonymous : UPLOAD_PATH.test(c.req.path) ? BodyLimitBytes.Upload : BodyLimitBytes.Document;
    return limits[allowed](c, next);
  };
}
