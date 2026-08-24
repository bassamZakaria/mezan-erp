import type { PillTone } from "@mezan/ui";
import type { DocumentStatusDTO } from "@mezan/contracts";
import type { AppTranslationKey } from "./i18n";

/**
 * The document framework's six statuses, as every document screen shows them.
 * Six screens carried byte-identical copies of this map before it was lifted
 * here; the tones were identical in all six.
 *
 * NOT universal: a screen whose domain reads a status differently states its
 * own label and says why — `InstallmentPlansScreen` calls a confirmed plan
 * "active", because that is what a confirmed instalment plan is to its user.
 */

export const DOC_STATUS_KEY: Record<DocumentStatusDTO, AppTranslationKey> = {
  draft: "docStatus.draft",
  pending: "docStatus.pending",
  confirmed: "docStatus.confirmed",
  posted: "docStatus.posted",
  cancelled: "docStatus.cancelled",
  reversed: "docStatus.reversed",
};

export const DOC_STATUS_TONE: Record<DocumentStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

export function documentStatusLabel(status: DocumentStatusDTO, t: (key: AppTranslationKey) => string): string {
  return t(DOC_STATUS_KEY[status]);
}
