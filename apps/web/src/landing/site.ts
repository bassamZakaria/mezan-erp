import { CLOUD_SITE_META } from "@mezan/contracts";

export const LANDING_PATH = "/welcome";

export function isCloudSite(): boolean {
  return typeof document !== "undefined" && document.querySelector(`meta[name="${CLOUD_SITE_META.name}"][content="${CLOUD_SITE_META.content}"]`) !== null;
}

// shortcut: the owner has not supplied a number yet, so every WhatsApp link stays hidden; set it in international form (e.g. "2010…") when it exists.
export const WHATSAPP_NUMBER: string | null = null;

export function whatsappHref(number: string): string {
  return `https://wa.me/${number}`;
}
