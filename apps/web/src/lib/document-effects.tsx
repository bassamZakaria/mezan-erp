import { useCallback } from "react";
import type { DocumentEffect } from "@mezan/domain";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { ENGLISH_LOCALE, useFormat } from "@mezan/ui";
import { useWarehouses } from "../data/hooks";
import { useEntityName } from "./entity-names";
import { majorOf } from "./money";
import { EMPTY } from "../lib/empty";

/**
 * Renders the "تأثيرات هذا المستند" panel lines.
 *
 * `describeEffects` runs in the domain, which has no locale, no warehouse names
 * and no number format — so it hands over a catalogue key plus raw params and
 * this resolves them. Rendering `description` directly is what put Arabic in
 * the English UI, printed the warehouse **id** where a name belongs, and showed
 * scaled money as "0.000000" (D48).
 *
 * Any effect that has not been given a key yet still falls back to the domain's
 * Arabic sentence, so a document type can be converted without breaking others.
 */
export function useDocumentEffectText(): (effect: DocumentEffect) => { text: string; detail: string | null } {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const warehouses = useWarehouses().data ?? EMPTY;
  const nameOf = useEntityName();

  const resolve = useCallback(
    (params: Readonly<Record<string, string | number>> | undefined): Record<string, string | number> => {
      if (!params) return {};
      const out: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(params)) {
        if (key === "warehouseId" || key === "fromWarehouseId" || key === "toWarehouseId") {
          const wh = warehouses.find((w) => w.id === value);
          out[key.replace(/Id$/, "")] = wh ? nameOf(wh, String(value)) : String(value);
        } else if (key === "currency") {
          continue;
        } else if (key === "value" || key === "amount") {
          const currency = typeof params.currency === "string" && params.currency !== "" ? params.currency : format.currencyLabel;
          out[key] = `${format.money(String(value))} ${currency}`;
        } else if (key === "reasonAr" || key === "reasonEn") {
          if (key === (locale === ENGLISH_LOCALE ? "reasonEn" : "reasonAr")) out.reason = String(value);
        } else {
          out[key] = value;
        }
      }
      return out;
    },
    [warehouses, nameOf, format, locale],
  );

  return useCallback(
    (effect: DocumentEffect) => ({
      text: effect.key ? t(effect.key as AppTranslationKey, resolve(effect.params)) : effect.description,
      detail: effect.detailKey ? t(effect.detailKey as AppTranslationKey, resolve(effect.detailParams)) : (effect.detail ?? null),
    }),
    [t, resolve],
  );
}
