import { createDefaultSettings, type SettingsRepository } from "@mezan/domain";

/**
 * تفعيل تعدد العملات (settings §"عام"). A tenant that has not switched
 * multi-currency on may only raise documents in its base currency, and one that
 * has may only use the currencies it listed — otherwise the "which additional
 * currencies are usable" list is decorative and any three-letter string reaches
 * the ledger. Returns the refusal in both languages, or null when the currency is allowed.
 */
export interface CurrencyRefusal {
  readonly message: string;
  readonly messageEn: string;
}

export type CurrencyCheck = (currency: string | null | undefined) => Promise<CurrencyRefusal | null>;

export function createCurrencyCheck(settings: SettingsRepository): CurrencyCheck {
  return async (currency) => {
    if (!currency) return null;
    const tenant = (await settings.get()) ?? createDefaultSettings();
    if (currency === tenant.currency) return null;
    if (!tenant.multiCurrencyEnabled) {
      return {
        message: `تعدد العملات غير مُفعَّل؛ لا يمكن إصدار مستند بعملة ${currency} غير العملة الأساسية ${tenant.currency}.`,
        messageEn: `Multi-currency is not turned on, so a document cannot be issued in ${currency} instead of the base currency ${tenant.currency}.`,
      };
    }
    if (!tenant.secondaryCurrencies.includes(currency)) {
      return {
        message: `العملة ${currency} غير مُدرجة ضمن العملات المسموح بها في الإعدادات.`,
        messageEn: `The currency ${currency} is not among the currencies allowed in the settings.`,
      };
    }
    return null;
  };
}
