import { Locale } from "../i18n/strings";

export enum LegalPage {
  Privacy = "/legal/privacy",
  AccountDeletion = "/legal/account-deletion",
}

export function legalUrl(siteUrl: string, page: LegalPage, locale: Locale): string {
  const base = `${siteUrl.replace(/\/+$/, "")}${page}`;
  return locale === Locale.En ? `${base}?lang=en` : base;
}
