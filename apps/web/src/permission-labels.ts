import type { PermissionDef } from "@mezan/domain";
import type { AppTranslationKey } from "./i18n";

/**
 * Presentation-only labels for the permission matrix. The catalog
 * (`@mezan/domain` `permissions/catalog.ts`) intentionally carries no per-permission
 * copy — only per-module names (`MODULES[i].labelAr`) — so the ~268 individual
 * permission labels shown here are DERIVED, not sourced from the catalog:
 * `<action verb> — <entity segment>`. This keeps every card's meaning traceable
 * to its exact `module.entity.action` code (always shown alongside, monospace)
 * rather than inventing bespoke prose per permission. Only the action verb is
 * translated; the entity segment stays the identifier it is in the code.
 */

const ACTION_KEYS = [
  "view",
  "view_own",
  "view_all",
  "view_cost",
  "view_salary",
  "view_personal",
  "create",
  "edit",
  "edit_cost",
  "delete_draft",
  "confirm",
  "void",
  "cancel",
  "approve",
  "reject",
  "manage",
  "print",
  "merge",
  "close",
  "reopen",
  "run",
  "deactivate",
  "assign",
  "convert",
  "override",
  "rebuild",
  "open",
  "open_session",
  "close_session",
  "settle",
  "terminate",
  "apply_preset",
  "calculate",
  "pay",
  "dispose",
  "submit",
  "import",
  "match",
  "finalize",
  "force_close",
  "set_priority",
  "discount",
  "refund",
  "suspend",
  "resume",
  "collect",
  "bounce",
  "deposit",
  "migrate_open",
  "year_end",
  "order",
  "operate",
  "recall",
  "manage_own",
  "execute",
] as const;

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(ACTION_KEYS);

/** `module.entity.action` -> `entity`; `module.action` (no entity) -> `module`. */
export function entitySegment(code: string): string {
  const parts = code.split(".");
  return parts.length >= 3 ? (parts[1] as string) : (parts[0] as string);
}

function actionSegment(code: string): string {
  const parts = code.split(".");
  return parts[parts.length - 1] as string;
}

/** Human-ish label: translated verb for the action, entity segment kept as a readable identifier. */
export function permissionLabel(permission: PermissionDef, t: (key: AppTranslationKey) => string): string {
  const entity = entitySegment(permission.code).replace(/_/g, " ");
  const segment = actionSegment(permission.code);
  const action = KNOWN_ACTIONS.has(segment) ? t(`perm.action.${segment}` as AppTranslationKey) : segment;
  return `${action} — ${entity}`;
}

/** Sub-group label for the matrix: the entity segment, title-cased. */
export function subgroupLabel(permission: PermissionDef): string {
  const entity = entitySegment(permission.code).replace(/_/g, " ");
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}
