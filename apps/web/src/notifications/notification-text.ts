import { DOMAIN_EVENT_CATALOG, renderTemplate } from "@mezan/domain";
import type { NotificationDTO } from "@mezan/contracts";
import type { AppTranslationKey } from "../i18n";
import { WEB_TRANSLATION_KEYS, webCatalogs } from "../i18n/catalog";
import { eventLabelByCode } from "../domain-labels";

type Translate = (key: AppTranslationKey, params?: Record<string, string>) => string;

interface NotificationText {
  readonly title: string;
  readonly body: string;
}

const ENGLISH = "en";
const BODY_PARTS_SEPARATOR = " — ";
const WELL_KNOWN_FIELDS: readonly { readonly field: string; readonly key: AppTranslationKey }[] = [
  { field: "documentNumber", key: "notifications.part.documentNumber" },
  { field: "customerName", key: "notifications.part.customerName" },
  { field: "amount", key: "notifications.part.amount" },
];

function systemRuleTemplate(ruleId: string | null, slot: "title" | "body", catalog: Readonly<Record<string, string>>): string | undefined {
  if (ruleId === null) return undefined;
  const key = `notificationRule.${ruleId}.${slot}`;
  return WEB_TRANSLATION_KEYS.has(key) ? catalog[key] : undefined;
}

function definitionOf(code: string) {
  return DOMAIN_EVENT_CATALOG.find((entry) => entry.code === code);
}

function composedBody(notification: NotificationDTO, eventLabel: string, t: Translate): string | null {
  const parts = WELL_KNOWN_FIELDS.flatMap(({ field, key }) => {
    const value = notification.payload[field];
    if (value === undefined || value === null) return [];
    return [`${t(key)}: ${renderTemplate(`{{${field}}}`, notification.payload)}`];
  });
  if (parts.length > 0) return parts.join(BODY_PARTS_SEPARATOR);
  return notification.body === definitionOf(notification.eventCode)?.labelAr && eventLabel !== "" ? eventLabel : null;
}

export function notificationText(notification: NotificationDTO, locale: string, t: Translate): NotificationText {
  if (locale !== ENGLISH) return { title: notification.title, body: notification.body };
  const arabic: Readonly<Record<string, string>> = webCatalogs.ar;
  const english: Readonly<Record<string, string>> = webCatalogs.en;
  const { payload } = notification;
  const definition = definitionOf(notification.eventCode);
  const eventLabel = eventLabelByCode(notification.eventCode, t) ?? "";

  const arabicTitle = systemRuleTemplate(notification.ruleId, "title", arabic);
  const arabicBody = systemRuleTemplate(notification.ruleId, "body", arabic);
  const englishTitle = systemRuleTemplate(notification.ruleId, "title", english);
  const englishBody = systemRuleTemplate(notification.ruleId, "body", english);

  let title = notification.title;
  if (arabicTitle !== undefined && englishTitle !== undefined && notification.title === renderTemplate(arabicTitle, payload)) {
    title = renderTemplate(englishTitle, payload);
  } else if (definition !== undefined && eventLabel !== "") {
    title = eventLabel;
  }

  let body = notification.body;
  if (arabicBody !== undefined && englishBody !== undefined && notification.body === renderTemplate(arabicBody, payload)) {
    body = renderTemplate(englishBody, payload);
  } else if (definition !== undefined) {
    body = composedBody(notification, eventLabel, t) ?? notification.body;
  }
  return { title, body };
}
