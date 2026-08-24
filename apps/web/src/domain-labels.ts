import {
  DOMAIN_EVENT_CATALOG,
  GATEABLE_ACTION_TYPES,
  MODULES,
  SEQUENCE_DEFINITIONS,
  WAREHOUSE_TYPE_DEFINITIONS,
} from "@mezan/domain";
import type { AppTranslationKey } from "./i18n";

/**
 * `@mezan/domain`'s catalogues carry a single `labelAr` per entry, so their copy
 * is resolved from the entry's stable code here rather than from the payload.
 * An entry the domain gains before this app does falls back to its Arabic label
 * rather than to a humanized key.
 */

type Translate = (key: AppTranslationKey) => string;

const MODULE_IDS: ReadonlySet<string> = new Set(MODULES.map((m) => m.id));
const EVENT_CODES: ReadonlySet<string> = new Set(DOMAIN_EVENT_CATALOG.map((e) => e.code));

export function moduleLabel(module: { id: string; labelAr: string }, t: Translate): string {
  return MODULE_IDS.has(module.id) ? t(`module.${module.id}` as AppTranslationKey) : module.labelAr;
}

export function eventLabel(event: { code: string; labelAr: string }, t: Translate): string {
  return EVENT_CODES.has(event.code) ? t(`event.${event.code}` as AppTranslationKey) : event.labelAr;
}

/** Event copy resolved from a bare code, for payloads that carry no label. */
export function eventLabelByCode(code: string, t: Translate): string | undefined {
  return EVENT_CODES.has(code) ? t(`event.${code}` as AppTranslationKey) : undefined;
}

/**
 * The event's ARABIC label, regardless of the active locale. The notification
 * rule builder writes `titleAr`/`bodyAr` — Arabic-only fields by contract — so
 * their placeholders must model Arabic even when the shell is in English.
 */
export function eventLabelArByCode(code: string): string | undefined {
  return DOMAIN_EVENT_CATALOG.find((e) => e.code === code)?.labelAr;
}

const WAREHOUSE_TYPE_CODES: ReadonlySet<string> = new Set(WAREHOUSE_TYPE_DEFINITIONS.map((d) => d.code));

export function warehouseTypeLabel(type: string, t: Translate): string {
  return WAREHOUSE_TYPE_CODES.has(type) ? t(`warehouseType.${type}` as AppTranslationKey) : type;
}

const SEQUENCE_CODES: ReadonlySet<string> = new Set(SEQUENCE_DEFINITIONS.map((d) => d.code));

export function sequenceLabel(sequence: { code: string; labelAr: string }, t: Translate): string {
  return SEQUENCE_CODES.has(sequence.code) ? t(`sequence.${sequence.code}` as AppTranslationKey) : sequence.labelAr;
}

const ACTION_TYPE_CODES: ReadonlySet<string> = new Set(GATEABLE_ACTION_TYPES.map((a) => a.code));

export function actionTypeLabel(code: string, t: Translate): string {
  return ACTION_TYPE_CODES.has(code) ? t(`actionType.${code}` as AppTranslationKey) : code;
}
