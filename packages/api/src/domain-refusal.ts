export interface DomainRefusal {
  readonly code: string;
  readonly message: string;
  readonly messageEn?: string;
}

export const INTERNAL_ERROR_MESSAGE_AR = "تعذّر إكمال العملية بسبب خطأ داخلي. حاول مرة أخرى، وإن تكرر الخطأ فتواصل مع الدعم.";
export const INTERNAL_ERROR_MESSAGE_EN = "The operation could not be completed because of an internal error. Try again, and contact support if it keeps happening.";

const DOMAIN_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const FOREIGN_CODE_PREFIXES = ["SQLITE_", "ERR_"];

// SECURITY: driver errors carry a `code` too (a Postgres SQLSTATE such as "23505", a
// better-sqlite3 "SQLITE_…", a Node "ERR_…") and their message quotes SQL; only a
// domain refusal's message may reach the client.
export function domainRefusalOf(err: unknown): DomainRefusal | null {
  if (!(err instanceof Error)) return null;
  const { code, messageEn } = err as { code?: unknown; messageEn?: unknown };
  if (typeof code !== "string" || !DOMAIN_CODE.test(code) || FOREIGN_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) return null;
  return { code, message: err.message, ...(typeof messageEn === "string" ? { messageEn } : {}) };
}
