import { CLOUD_SITE_META } from "@mezan/contracts";

export const LANDING_PATH = "/welcome";

export function isCloudSite(): boolean {
  return typeof document !== "undefined" && document.querySelector(`meta[name="${CLOUD_SITE_META.name}"][content="${CLOUD_SITE_META.content}"]`) !== null;
}

export function whatsappHref(number: string): string {
  return `https://wa.me/${number}`;
}

export function contactHref(contact: { whatsapp: string | null; email: string | null; phone: string | null } | null): string | null {
  if (contact?.whatsapp) return whatsappHref(contact.whatsapp);
  if (contact?.email) return `mailto:${contact.email}`;
  if (contact?.phone) return `tel:${contact.phone}`;
  return null;
}
