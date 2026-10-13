import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isMutatingRequest } from "./audit-boundary.js";
import { unauthenticated, type AuthContextResolver } from "./permission-gate.js";
import { readSessionToken } from "./session-auth.js";

const KIB = 1024;
const MIB = 1024 * KIB;

export enum BodyLimitBytes {
  Anonymous = 64 * KIB,
  Document = 2 * MIB,
  Upload = 16 * MIB,
}

export enum BodyLimitRefusal {
  PayloadTooLarge = "PAYLOAD_TOO_LARGE",
}

const UPLOAD_PATH = /\/(attachments|data-migration|historical-import|import|import-file|commit|clock|boq)(\/|$)/;

const OPEN_TO_ANONYMOUS = /^\/(auth|bootstrap)\//;

export function bodyLimitFor(path: string, signedIn: boolean): BodyLimitBytes {
  if (!signedIn) return BodyLimitBytes.Anonymous;
  return UPLOAD_PATH.test(path) ? BodyLimitBytes.Upload : BodyLimitBytes.Document;
}

function tooLarge(c: Context): Response {
  return c.json(
    {
      error: BodyLimitRefusal.PayloadTooLarge,
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
  const endedSession = bodyLimit({ maxSize: BodyLimitBytes.Anonymous, onError: unauthenticated });
  return async (c, next) => {
    if (!isMutatingRequest(c)) return next();
    const signedIn = (await resolveAuthContext(c)).authenticated;
    // SECURITY: a token the server no longer knows buys no room — the body is
    // still held to the anonymous limit — only a truthful answer: sign in again.
    if (!signedIn && readSessionToken(c) !== null && !OPEN_TO_ANONYMOUS.test(c.req.path)) return endedSession(c, next);
    return limits[bodyLimitFor(c.req.path, signedIn)](c, next);
  };
}
