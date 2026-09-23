import Constants from "expo-constants";

interface MezanExtra {
  readonly apiBaseUrl?: string;
  readonly publicSiteUrl?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as MezanExtra;

export const DEFAULT_BASE_URL = extra.apiBaseUrl ?? "https://review.mezan.app/api";

export const PUBLIC_SITE_URL = extra.publicSiteUrl ?? "https://review.mezan.app";
