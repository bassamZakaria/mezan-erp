import type { SubCertificateDerivedStatusDTO, SubcontractStatusDTO } from "@mezan/contracts";
import type { PillTone } from "@mezan/ui";
import type { AppTranslationKey } from "../../../i18n";

/**
 * عقود الباطن ومستخلصاتها — the lifecycle labels, kept in one place because
 * the list chips, the detail pill and the stepper all read them and a status
 * that disagreed between them would be a bug nobody could see.
 */

export const SUBCONTRACT_STATUS_KEY: Record<SubcontractStatusDTO, AppTranslationKey> = {
  draft: "subcontracts.status.draft",
  active: "subcontracts.status.active",
  completed: "subcontracts.status.completed",
  terminated: "subcontracts.status.terminated",
};

export const SUBCONTRACT_STATUS_TONE: Record<SubcontractStatusDTO, PillTone> = {
  draft: "neutral",
  active: "success",
  completed: "info",
  terminated: "danger",
};

export const SUB_CERTIFICATE_STATUS_KEY: Record<SubCertificateDerivedStatusDTO, AppTranslationKey> = {
  draft: "subCertificates.status.draft",
  measured: "subCertificates.status.measured",
  certified: "subCertificates.status.certified",
  approved_for_payment: "subCertificates.status.approvedForPayment",
  invoiced: "subCertificates.status.invoiced",
  paid: "subCertificates.status.paid",
  cancelled: "subCertificates.status.cancelled",
};

export const SUB_CERTIFICATE_STATUS_TONE: Record<SubCertificateDerivedStatusDTO, PillTone> = {
  draft: "neutral",
  measured: "info",
  certified: "info",
  approved_for_payment: "warning",
  invoiced: "success",
  paid: "success",
  cancelled: "danger",
};

/** «ملغي» is off-path and is shown by tone, not by a step. */
export const SUB_CERTIFICATE_STEPS: readonly SubCertificateDerivedStatusDTO[] = [
  "draft",
  "measured",
  "certified",
  "approved_for_payment",
  "invoiced",
  "paid",
];

/** The API's scale-6 decimals read as noise in an editable cell — the surveyor typed "12". */
export function trimScale(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
