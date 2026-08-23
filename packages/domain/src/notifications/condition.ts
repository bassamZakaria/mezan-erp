import type { NotificationCondition } from "./types.js";

/**
 * Evaluates a rule's optional condition against the triggering event's
 * payload. `null` condition always passes (docs/plan.md §5.6: the condition
 * is optional, unlike the workflow gate's unconditional action types).
 *
 * Missing/non-object payload or a missing field fails the match rather than
 * throwing — a malformed payload should silently suppress the rule, not crash
 * the engine for every other rule/event still waiting to be processed.
 */
export function evaluateCondition(
  condition: NotificationCondition | null,
  payload: unknown,
): boolean {
  if (!condition) return true;
  if (typeof payload !== "object" || payload === null) return false;

  const raw = (payload as Record<string, unknown>)[condition.field];
  if (raw === undefined || raw === null) return false;

  switch (condition.operator) {
    case "eq":
      return String(raw) === condition.value;
    case "neq":
      return String(raw) !== condition.value;
    case "contains":
      return String(raw).includes(condition.value);
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return compareNumeric(raw, condition.value, condition.operator);
    default:
      return false;
  }
}

function compareNumeric(
  raw: unknown,
  target: string,
  operator: "gt" | "gte" | "lt" | "lte",
): boolean {
  const a = Number(raw);
  const b = Number(target);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  switch (operator) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
  }
}
