import { ENH_PERMISSION_ACTIONS, POS_PERMISSION_ACTIONS, type PermissionDef } from "@mezan/domain";
import type { AppTranslationKey } from "./i18n";

/**
 * Presentation-only labels for the permission matrix. The catalog
 * (`@mezan/domain` `permissions/catalog.ts`) intentionally carries no per-permission
 * copy — only per-module names — so the ~279 individual permission labels shown
 * here are DERIVED from the code itself: `<action verb> — <entity>`. Both halves
 * are translated, so an Arabic install reads «عرض — فاتورة» rather than
 * «عرض — invoice». The `module.entity.action` code is still shown alongside in
 * monospace, which is what keeps a translated label traceable to what it grants.
 *
 * A segment with no translation falls back to the raw identifier rather than
 * blank: a missing word is a defect to fix in the catalog, not a reason to
 * render an empty checkbox.
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
  "prepare",
  "certify",
  "release",
] as const;

const KNOWN_ACTIONS: ReadonlySet<string> = new Set<string>([...ACTION_KEYS, ...POS_PERMISSION_ACTIONS, ...ENH_PERMISSION_ACTIONS]);

type Translate = (key: AppTranslationKey) => string;

/** `module.entity.action` -> `entity`; `module.action` (no entity) -> `module`. */
export function entitySegment(code: string): string {
  const parts = code.split(".");
  return parts.length >= 3 ? (parts[1] as string) : (parts[0] as string);
}

function actionSegment(code: string): string {
  const parts = code.split(".");
  return parts[parts.length - 1] as string;
}

/** Translated name of the thing a permission acts on — «فاتورة», «قائمة أسعار». */
export function entityLabel(code: string, t: Translate): string {
  const segment = entitySegment(code);
  const translated = t(`perm.entity.${segment}` as AppTranslationKey);
  return translated === `perm.entity.${segment}` ? segment.replace(/_/g, " ") : translated;
}

/** Full label: `<translated verb> — <translated entity>`. */
export function permissionLabel(permission: PermissionDef, t: Translate): string {
  const segment = actionSegment(permission.code);
  const action = KNOWN_ACTIONS.has(segment) ? t(`perm.action.${segment}` as AppTranslationKey) : segment;
  return `${action} — ${entityLabel(permission.code, t)}`;
}

/** Sub-group heading for the matrix: the entity the whole group is about. */
export function subgroupLabel(permission: PermissionDef, t: Translate): string {
  return entityLabel(permission.code, t);
}
