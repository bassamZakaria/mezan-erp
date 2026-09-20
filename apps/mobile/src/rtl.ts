import { I18nManager } from "react-native";
import { reloadAsync } from "expo-updates";
import { Locale, activeLocale } from "@/i18n";

/**
 * React Native decides layout direction in the native layer at startup, so a
 * forced flip only takes effect after a reload. Doing it here, before the first
 * screen renders, means the app relaunches once on a fresh Arabic install
 * rather than drawing one screen left-to-right and flipping under the user.
 */
export async function applyLayoutDirection(): Promise<void> {
  const wantsRtl = activeLocale() === Locale.Ar;
  I18nManager.allowRTL(wantsRtl);
  if (I18nManager.isRTL === wantsRtl) return;
  I18nManager.forceRTL(wantsRtl);
  await reloadAsync();
}
