import { CLOUD_SITE_META, type SiteStatusDTO } from "@mezan/contracts";

export const LANDING_PATH = "/welcome";

export function isCloudSite(): boolean {
  return typeof document !== "undefined" && document.querySelector(`meta[name="${CLOUD_SITE_META.name}"][content="${CLOUD_SITE_META.content}"]`) !== null;
}

export function whatsappHref(number: string): string {
  return `https://wa.me/${number}`;
}

export function contactHref(contact: SiteStatusDTO["contact"] | null): string | null {
  if (contact?.whatsapp) return whatsappHref(contact.whatsapp);
  if (contact?.email) return `mailto:${contact.email}`;
  if (contact?.phone) return `tel:${contact.phone.replace(/\s+/g, "")}`;
  return null;
}

export function contactLinkProps(href: string): { href: string; target?: string; rel?: string } {
  return href.startsWith("https:") ? { href, target: "_blank", rel: "noopener noreferrer" } : { href };
}
