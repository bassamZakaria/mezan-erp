import type { NotificationCondition } from "./rule.js";

/**
 * Pure condition evaluation over an event payload. A rule with no condition
 * always matches; a rule whose field is absent from the payload never does
 * (a guard that cannot be evaluated must not open the gate).
 */

/** Reads a possibly-dotted path out of a plain payload object. */
export function readPayloadField(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  let cursor: unknown = payload;
  for (const segment of field.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function matchesCondition(
  condition: NotificationCondition | null,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  if (!condition) return true;
  const actual = readPayloadField(payload, condition.field);
  if (actual === undefined || actual === null) return false;

  switch (condition.operator) {
    case "eq":
      return String(actual) === condition.value;
    case "neq":
      return String(actual) !== condition.value;
    case "contains":
      return String(actual).includes(condition.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = asNumber(actual);
      const right = asNumber(condition.value);
      if (left === null || right === null) return false;
      if (condition.operator === "gt") return left > right;
      if (condition.operator === "gte") return left >= right;
      if (condition.operator === "lt") return left < right;
      return left <= right;
    }
    default:
      return false;
  }
}
