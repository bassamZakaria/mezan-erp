import type { Locale } from "@mezan/ui";

/**
 * Which of a person's two names to show.
 *
 * The Arabic name is the record — it is what every printed document, approval
 * trail and audit row carries, and it is required. The Latin name is optional,
 * so an English screen falls back to the Arabic rather than showing a blank
 * where a person should be.
 */
export function displayName(person: { nameAr: string; nameEn?: string | null }, locale: Locale): string {
  if (locale === "en") return person.nameEn?.trim() || person.nameAr;
  return person.nameAr;
}
