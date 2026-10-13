import { IMPORT_ROW_LIMIT, importLimitNotice, importTooLargeMessage } from "@mezan/contracts";
import type { Locale } from "../i18n";

export function oversizeImportRefusal(rows: number, locale: Locale): string | null {
  return rows > IMPORT_ROW_LIMIT ? importTooLargeMessage(rows)[locale] : null;
}

export function importLimitSentence(locale: Locale): string {
  return importLimitNotice()[locale];
}
