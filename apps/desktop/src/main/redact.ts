export const REDACTED = "[redacted]";

const SENSITIVE_WORDS = new Set([
  "pin",
  "pass",
  "password",
  "passphrase",
  "token",
  "secret",
  "iban",
  "email",
  "authorization",
  "cookie",
  "cipher",
  "credential",
  "credentials",
]);
const KEY_QUALIFIERS = new Set(["database", "db", "encryption", "private", "api", "cipher", "secret"]);

function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  return words.some(
    (word, i) =>
      SENSITIVE_WORDS.has(word) || (word === "key" && i > 0 && KEY_QUALIFIERS.has(words[i - 1]!)),
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Za-z0-9]{4}){3,7}(?: ?[A-Za-z0-9]{1,4})?\b/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYED_VALUE =
  /(["']?(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*(?:pin|pass(?:word|phrase)?|token|secret|iban|authorization|cookie|cipher[A-Za-z]*|(?:database|db|encryption|private|api)[\s_-]?key)(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+)/gi;
const LONG_HEX = /\b[0-9a-fA-F]{32,}\b/g;
const LONG_BASE64 = /\b[A-Za-z0-9+_-]{40,}={0,2}(?![A-Za-z0-9+_-])/g;

export function redactText(text: string): string {
  return text
    .replace(KEYED_VALUE, (_m, head: string) => `${head}${REDACTED}`)
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(IBAN, REDACTED)
    .replace(LONG_HEX, REDACTED)
    .replace(LONG_BASE64, REDACTED);
}

const MAX_DEPTH = 4;
const MAX_STRING = 4000;

export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactText(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined) return undefined;
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), stack: redactText(value.stack ?? "") };
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, depth + 1);
    }
    return out;
  }
  return redactText(String(value));
}
