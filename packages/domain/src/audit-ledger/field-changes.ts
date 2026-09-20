export enum AuditChangeAction {
  Create = "CREATE",
  Update = "UPDATE",
  Activate = "ACTIVATE",
  Deactivate = "DEACTIVATE",
  Approve = "APPROVE",
  Lock = "LOCK",
}

export type AuditFieldValue =
  | string
  | number
  | boolean
  | null
  | readonly AuditFieldValue[]
  | { readonly [key: string]: AuditFieldValue };

export interface AuditFieldChange {
  readonly field: string;
  readonly key?: string;
  /**
   * What the `key` NAMES, captured when the change was recorded. A per-item key
   * is an id, and an id on a history screen tells a reader nothing; resolving it
   * at read time would show today's name for yesterday's change, or nothing at
   * all once the item is gone.
   */
  readonly label?: string;
  readonly from: AuditFieldValue;
  readonly to: AuditFieldValue;
}

export function auditFieldValue(value: unknown): AuditFieldValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "function" || typeof value === "symbol") return null;
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === "function") return auditFieldValue(withJson.toJSON());
  if (Array.isArray(value)) return value.map(auditFieldValue);
  const out: Record<string, AuditFieldValue> = {};
  for (const key of Object.keys(value as object).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = auditFieldValue(v);
  }
  return out;
}

export function diffAuditFields<T extends object>(
  before: T | null | undefined,
  after: T,
  fields: readonly (keyof T & string)[],
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = [];
  for (const field of fields) {
    const from = before ? auditFieldValue(before[field]) : null;
    const to = auditFieldValue(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field, from, to });
  }
  return changes;
}

export function diffAuditCollection<T>(
  field: string,
  before: readonly T[] | null | undefined,
  after: readonly T[],
  keyOf: (item: T) => string,
  valueOf: (item: T) => unknown,
  labelOf?: (item: T) => string | null,
): AuditFieldChange[] {
  const previous = new Map(
    (before ?? []).map((item) => [keyOf(item), { value: auditFieldValue(valueOf(item)), label: labelOf?.(item) ?? null }] as const),
  );
  const changes: AuditFieldChange[] = [];
  for (const item of after) {
    const key = keyOf(item);
    const to = auditFieldValue(valueOf(item));
    const seen = previous.get(key);
    const from = seen ? seen.value : null;
    previous.delete(key);
    const label = labelOf?.(item) ?? seen?.label ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field, key, ...(label ? { label } : {}), from, to });
    }
  }
  for (const [key, seen] of previous) {
    changes.push({ field, key, ...(seen.label ? { label: seen.label } : {}), from: seen.value, to: null });
  }
  return changes;
}

export function auditChangesOf(details: Readonly<Record<string, unknown>> | null | undefined): AuditFieldChange[] {
  const raw = details?.["changes"];
  if (!Array.isArray(raw)) return [];
  const out: AuditFieldChange[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const field = (entry as { field?: unknown }).field;
    if (typeof field !== "string" || field === "") continue;
    const key = (entry as { key?: unknown }).key;
    const label = (entry as { label?: unknown }).label;
    out.push({
      field,
      ...(typeof key === "string" ? { key } : {}),
      ...(typeof label === "string" && label !== "" ? { label } : {}),
      from: auditFieldValue((entry as { from?: unknown }).from),
      to: auditFieldValue((entry as { to?: unknown }).to),
    });
  }
  return out;
}

export function auditChangedFieldNames(details: Readonly<Record<string, unknown>> | null | undefined): string[] {
  return [...new Set(auditChangesOf(details).map((c) => c.field))].sort();
}
