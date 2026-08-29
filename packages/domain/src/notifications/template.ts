import type { EventDefinition } from "../events/catalog.js";

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Renders `{{customerName}}`/`{{amount}}`/`{{documentNumber}}`-style tokens
 * (docs/archive/catalog/09 §قواعد الإشعارات) against the triggering event's payload.
 * An unknown/missing token renders as an empty string rather than leaking the
 * literal `{{token}}` into a user-facing notification.
 */
export function renderTemplate(template: string, payload: Readonly<Record<string, unknown>>): string {
  return template.replace(TOKEN_RE, (_match, key: string) => {
    const value = payload[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

/** Default title when a rule has no `titleAr` override: the catalog's Arabic label. */
export function defaultNotificationTitle(def: EventDefinition): string {
  return def.labelAr;
}

/**
 * Default body when a rule has no `bodyAr` override — assembles whichever of
 * the three well-known template fields the payload carries; falls back to the
 * event's Arabic label alone when none are present.
 */
export function defaultNotificationBody(
  def: EventDefinition,
  payload: Readonly<Record<string, unknown>>,
): string {
  const parts: string[] = [];
  if (payload.documentNumber !== undefined && payload.documentNumber !== null) {
    parts.push(`رقم المستند: ${String(payload.documentNumber)}`);
  }
  if (payload.customerName !== undefined && payload.customerName !== null) {
    parts.push(`العميل: ${String(payload.customerName)}`);
  }
  if (payload.amount !== undefined && payload.amount !== null) {
    parts.push(`المبلغ: ${String(payload.amount)}`);
  }
  return parts.length > 0 ? parts.join(" — ") : def.labelAr;
}
