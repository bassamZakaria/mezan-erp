import type { ProgressCertificateDerivedStatusDTO } from "@mezan/contracts";
import type { PillTone } from "@mezan/ui";
import type { AppTranslationKey } from "../../../i18n";

/**
 * The certificate's lifecycle, as the screens name it. Kept in one place
 * because the list chips, the detail pill and the stepper all read it and a
 * status that disagreed between them would be a bug nobody could see.
 */
export const CERTIFICATE_STATUS_KEY: Record<ProgressCertificateDerivedStatusDTO, AppTranslationKey> = {
  draft: "certificates.status.draft",
  measured: "certificates.status.measured",
  certified: "certificates.status.certified",
  approved_for_payment: "certificates.status.approvedForPayment",
  invoiced: "certificates.status.invoiced",
  collected: "certificates.status.collected",
  cancelled: "certificates.status.cancelled",
  voided: "certificates.status.voided",
};

export const CERTIFICATE_STATUS_TONE: Record<ProgressCertificateDerivedStatusDTO, PillTone> = {
  draft: "neutral",
  measured: "info",
  certified: "info",
  approved_for_payment: "warning",
  invoiced: "success",
  collected: "success",
  cancelled: "danger",
  voided: "danger",
};

/** The stepper's path. «ملغي» and «معكوس» are off-path and shown by tone, not by a step. */
export const CERTIFICATE_STEPS: readonly ProgressCertificateDerivedStatusDTO[] = [
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "collected",
];

/** The API's scale-6 decimals read as noise in an editable cell — the surveyor typed "12". */
export function trimScale(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
