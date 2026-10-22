// Must match `SITE_META_NAME` / `CLOUD_SITE` in apps/server/src/site-head.ts, which only the cloud mount injects.
const SITE_META_SELECTOR = 'meta[name="mezan-site"][content="cloud"]';

export const LANDING_PATH = "/welcome";

export function isCloudSite(): boolean {
  return typeof document !== "undefined" && document.querySelector(SITE_META_SELECTOR) !== null;
}

// shortcut: the owner has not supplied a number yet, so every WhatsApp link stays hidden; set it in international form (e.g. "2010…") when it exists.
export const WHATSAPP_NUMBER: string | null = null;

export function whatsappHref(number: string): string {
  return `https://wa.me/${number}`;
}
