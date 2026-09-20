import AsyncStorage from "@react-native-async-storage/async-storage";
import { DevSettings, I18nManager } from "react-native";
import { isEnabled as updatesEnabled, reloadAsync } from "expo-updates";
import { Locale, activeLocale } from "@/i18n";

const RELAUNCH_MARKER_KEY = "mezan.rtl.relaunched-for";

/**
 * React Native decides layout direction in the native layer at startup, so a
 * forced flip only takes effect after a reload. Doing it here, before the
 * first screen renders, means the app relaunches once on a fresh Arabic
 * install rather than drawing one screen left-to-right and flipping under
 * the user.
 */
async function relaunch(): Promise<void> {
  // `reloadAsync` THROWS when expo-updates is disabled, which is every
  // development build and Expo Go; DevSettings is the only reload there.
  if (updatesEnabled) {
    await reloadAsync();
    return;
  }
  if (__DEV__) DevSettings.reload();
}

export async function applyLayoutDirection(): Promise<void> {
  const wantsRtl = activeLocale() === Locale.Ar;
  I18nManager.allowRTL(wantsRtl);
  if (I18nManager.isRTL === wantsRtl) {
    await AsyncStorage.removeItem(RELAUNCH_MARKER_KEY);
    return;
  }
  I18nManager.forceRTL(wantsRtl);
  /**
   * ONE relaunch per direction, remembered ACROSS the relaunch. A module-level
   * flag resets with the JS runtime, so a native layer that does not pick the
   * new direction up would relaunch the app forever.
   */
  const marker = wantsRtl ? Locale.Ar : Locale.En;
  if ((await AsyncStorage.getItem(RELAUNCH_MARKER_KEY)) === marker) return;
  await AsyncStorage.setItem(RELAUNCH_MARKER_KEY, marker);
  await relaunch();
}
