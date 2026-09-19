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
): AuditFieldChange[] {
  const previous = new Map((before ?? []).map((item) => [keyOf(item), auditFieldValue(valueOf(item))] as const));
  const changes: AuditFieldChange[] = [];
  for (const item of after) {
    const key = keyOf(item);
    const to = auditFieldValue(valueOf(item));
    const from = previous.has(key) ? (previous.get(key) ?? null) : null;
    previous.delete(key);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({ field, key, from, to });
  }
  for (const [key, from] of previous) changes.push({ field, key, from, to: null });
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
    out.push({
      field,
      ...(typeof key === "string" ? { key } : {}),
      from: auditFieldValue((entry as { from?: unknown }).from),
      to: auditFieldValue((entry as { to?: unknown }).to),
    });
  }
  return out;
}

export function auditChangedFieldNames(details: Readonly<Record<string, unknown>> | null | undefined): string[] {
  return [...new Set(auditChangesOf(details).map((c) => c.field))].sort();
}
