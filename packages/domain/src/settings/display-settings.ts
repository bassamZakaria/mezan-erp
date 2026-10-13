import type { TenantSettings } from "./settings.js";

export enum DisplaySettingKey {
  Language = "language",
  Direction = "direction",
  DateFormat = "dateFormat",
  DateNumerals = "dateNumerals",
  Timezone = "timezone",
  Currency = "currency",
  CompanyName = "companyName",
  Address = "address",
  Phone = "phone",
  Email = "email",
  TaxRegistrationNumber = "taxRegistrationNumber",
  CommercialRegistrationNumber = "commercialRegistrationNumber",
}

// SECURITY: this is everything of the settings a session with no settings permission may read. A key added here is shown to every signed-in user of the tenant; policy switches, mail credentials and sign-in rules must never be listed (display-settings-by-role.test.ts).
export const DISPLAY_SETTING_KEYS: readonly DisplaySettingKey[] = Object.values(DisplaySettingKey);

export type DisplaySettings = Pick<TenantSettings, `${DisplaySettingKey}`>;

export function displaySettingsOf(settings: TenantSettings): DisplaySettings {
  const projected: Partial<Record<DisplaySettingKey, TenantSettings[DisplaySettingKey]>> = {};
  for (const key of DISPLAY_SETTING_KEYS) projected[key] = settings[key];
  return projected as DisplaySettings;
}
