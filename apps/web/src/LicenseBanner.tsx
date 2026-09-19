import { useState } from "react";
import { Button, Checkbox } from "@mezan/ui";
import { useDesktopLicence } from "./data/hooks";
import {
  useLicenceCheckin,
  useLicenceImport,
  useLicenseState,
  type LicenceCheckinOutcome,
} from "./data/license-hooks";
import { CopyableValue } from "./settings/SupportInfoCard";
import { useStartRenewal, useTenantBilling } from "./billing/hooks";
import { routePathForScreen } from "./routing";
import { useAppTranslation, type AppTranslationKey } from "./i18n";

/**
 * The persistent licence banner, and the one screen a shop meets when something
 * about its licence is wrong.
 *
 * IT BRANCHED ON `state` ALONE, and that made it lie. A perfectly valid licence
 * whose only fault was an overdue online check-in resolved to READ_ONLY, so the
 * band said «حتى تجديد الترخيص» — telling a shop that had already paid to renew,
 * for a problem a network cable fixes. The correct sentence existed and went to
 * a `console.warn`.
 *
 * So every branch now turns on `reason`, and each one names the ACTION that
 * clears it: connect and press «تحقّق الآن» for an overdue check-in, send the
 * fingerprint to support for a machine mismatch, import a file for an absent or
 * damaged licence, contact support for a revoked licence or a build with no
 * vendor key — which is a build defect and must not be worded as the shop's
 * fault.
 *
 * PAST THE HARD LIMIT the banner becomes a full-screen notice, because a
 * one-line band at the top of a screen full of working buttons is not how you
 * tell somebody their postings have stopped. It is still dismissible — the
 * ethic is that a lapse never withholds DATA — but the dismissal costs an
 * explicit acknowledgement, so nobody clicks past it without reading it.
 */

/** The hard limit `license-checkin.ts` enforces; past it, writing has stopped. */
const REFUSE_TO_START_AFTER_DAYS = 30;

interface BannerCopy {
  readonly title: string;
  readonly body: string;
  readonly tone: "warning" | "danger";
  /** «تحقّق الآن» — only where a check-in is what actually clears the state. */
  readonly showCheckin: boolean;
  /** «استيراد ملف الترخيص» — only where a new file is what clears it. */
  readonly showImport: boolean;
  /** The machine-transfer procedure, for a licence bound to another machine. */
  readonly showTransfer: boolean;
}

export function LicenseBanner() {
  const { t, locale } = useAppTranslation();
  const server = useLicenseState().data;
  const desktop = useDesktopLicence().data;
  const desktopStatus = desktop && desktop.ok ? desktop : null;
  const checkin = useLicenceCheckin();
  const importLicence = useLicenceImport();
  const billing = useTenantBilling().data;
  const renewal = useStartRenewal();
  const [acknowledged, setAcknowledged] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // The desktop reading is the VERIFIED one and wins where it exists; the
  // server view is what the browser edition and the write gate both answer.
  const state = desktopStatus?.state ?? server?.state ?? null;
  const reason = desktopStatus?.reason ?? server?.reason ?? null;
  const code = desktopStatus?.code ?? null;
  const fingerprint = desktopStatus?.fingerprint ?? null;
  const daysSince = desktopStatus?.daysSinceCheckin ?? server?.daysSince ?? null;

  if (!state) return null;
  if (state === "ACTIVE" && reason === null) return null;

  const copy = describe();
  const blocking =
    reason === "CHECKIN_OVERDUE" &&
    daysSince !== null &&
    daysSince >= REFUSE_TO_START_AFTER_DAYS &&
    !dismissed;

  function describe(): BannerCopy {
    if (reason === "CHECKIN_OVERDUE") {
      return {
        title: t("licenceUi.checkinTitle"),
        body:
          daysSince === null
            ? t("licenceUi.checkinBodyNoCount")
            : t("licenceUi.checkinBody", { days: String(daysSince) }),
        tone: state === "READ_ONLY" || state === "UNLICENSED" ? "danger" : "warning",
        showCheckin: true,
        showImport: true,
        showTransfer: false,
      };
    }
    if (reason === "REVOKED" || state === "REVOKED") {
      return {
        title: t("licenceUi.revokedTitle"),
        body: t("licenceUi.revokedBody"),
        tone: "danger",
        showCheckin: false,
        showImport: true,
        showTransfer: false,
      };
    }
    if (reason === "NO_PUBLIC_KEY") {
      return {
        title: t("licenceUi.noKeyTitle"),
        body: t("licenceUi.noKeyBody"),
        tone: "danger",
        // Importing cannot help: this build can verify nothing. Offering the
        // button would send the owner hunting for a file that will be refused.
        showCheckin: false,
        showImport: false,
        showTransfer: false,
      };
    }
    if (state === "FINGERPRINT_MISMATCH" || reason === "MACHINE_NOT_BOUND") {
      return {
        title: t("licenceUi.machineTitle"),
        body: t("licenceUi.machineBody"),
        tone: "danger",
        showCheckin: false,
        showImport: true,
        showTransfer: true,
      };
    }
    if (state === "TAMPERED" || reason === "CLOCK_ROLLBACK") {
      return {
        title: t("licenceUi.clockTitle"),
        body: t("licenceUi.clockBody"),
        tone: "danger",
        showCheckin: false,
        showImport: false,
        showTransfer: false,
      };
    }
    if (state === "NOT_YET_VALID") {
      return {
        title: t("licenceUi.notYetTitle"),
        body: t("licenceUi.notYetBody"),
        tone: "danger",
        showCheckin: false,
        showImport: true,
        showTransfer: false,
      };
    }
    if (state === "INVALID") {
      return {
        title: t("license.banner.invalid.title"),
        body:
          code === "LIC-MALFORMED"
            ? t("licenceUi.malformedBody")
            : t("licenceUi.badSignatureBody"),
        tone: "danger",
        showCheckin: false,
        showImport: true,
        showTransfer: false,
      };
    }
    if (state === "GRACE") {
      const date = server?.graceEndsAt
        ? new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
            dateStyle: "long",
          }).format(new Date(server.graceEndsAt))
        : "";
      return {
        title: t("license.banner.grace.title"),
        body: t("license.banner.grace.body", { date }),
        tone: "warning",
        showCheckin: false,
        showImport: true,
        showTransfer: false,
      };
    }
    if (state === "UNLICENSED") {
      return {
        title: t("license.banner.unlicensed.title"),
        body: t("licenceUi.unlicensedBody"),
        tone: "danger",
        showCheckin: false,
        showImport: true,
        showTransfer: false,
      };
    }
    return {
      title: t("license.banner.readonly.title"),
      body: t("license.banner.readonly.body"),
      tone: "danger",
      showCheckin: false,
      showImport: true,
      showTransfer: false,
    };
  }

  const checkinNotice = checkinMessage(checkin.data?.outcome ?? null, t);
  const importNotice = importMessage(importLicence.data ?? null, t);

  const actions = (
    <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
      {billing?.canRenew ? (
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={renewal.isPending}
          onClick={() => renewal.start(`/${routePathForScreen("settings-general")}`)}
        >
          {renewal.isPending ? t("billing.renew.opening") : t("billing.renew")}
        </Button>
      ) : null}
      {copy.showCheckin ? (
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={checkin.isPending}
          onClick={() => {
            if (checkin.isPending) return;
            checkin.mutate();
          }}
        >
          {checkin.isPending ? t("licenceUi.checkinWorking") : t("licenceUi.checkinButton")}
        </Button>
      ) : null}
      {copy.showImport ? (
        <Button
          type="button"
          size="sm"
          disabled={importLicence.isPending}
          onClick={() => {
            if (importLicence.isPending) return;
            importLicence.mutate();
          }}
        >
          {importLicence.isPending ? t("licenceUi.importWorking") : t("licenceUi.import")}
        </Button>
      ) : null}
    </div>
  );

  const identity = (
    <div className="mt-[10px] flex flex-col gap-[8px]">
      {code ? (
        <div className="flex flex-wrap items-center gap-[8px] text-[12px]">
          <span>{t("licenceUi.supportCode")}</span>
          <span className="mz-lat font-bold" dir="ltr">
            {code}
          </span>
        </div>
      ) : null}
      {fingerprint ? (
        <div className="flex flex-col gap-[4px] text-[12px]">
          <span>{t("licenceUi.fingerprint")}</span>
          <CopyableValue
            value={fingerprint}
            copyLabel={t("licenceUi.copy")}
            copiedLabel={t("licenceUi.copied")}
          />
        </div>
      ) : null}
    </div>
  );

  const transfer = copy.showTransfer ? (
    <ol className="mt-[10px] list-decimal space-y-[4px] text-[12px] ps-[18px]">
      <li>{t("licenceUi.transferStep1")}</li>
      <li>{t("licenceUi.transferStep2")}</li>
      <li>{t("licenceUi.transferStep3")}</li>
    </ol>
  ) : null;

  const notices = (
    <>
      {checkinNotice ? (
        <p
          className={`mt-[8px] text-[12px] font-semibold ${
            checkin.data?.outcome === "confirmed" ? "text-success-ink" : "text-danger-ink"
          }`}
        >
          {checkinNotice}
        </p>
      ) : null}
      {importNotice ? (
        <p
          className={`mt-[8px] text-[12px] font-semibold ${
            importLicence.data && importLicence.data.ok && importLicence.data.accepted
              ? "text-success-ink"
              : "text-danger-ink"
          }`}
        >
          {importNotice}
        </p>
      ) : null}
    </>
  );

  if (blocking) {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={t("licenceUi.blockedTitle")}
        className="fixed inset-0 z-50 flex items-center justify-center bg-surface-2/95 p-[24px]"
      >
        <div className="w-full max-w-[560px] rounded-lg border border-danger bg-surface p-[24px] shadow-2">
          <h2 className="font-display text-[17px] font-bold text-danger-ink">
            {t("licenceUi.blockedTitle")}
          </h2>
          <p className="mt-[8px] text-[13px] text-ink">
            {daysSince === null
              ? t("licenceUi.blockedBodyNoCount")
              : t("licenceUi.blockedBody", { days: String(daysSince) })}
          </p>
          <p className="mt-[6px] text-[12.5px] text-ink-muted">{t("licenceUi.blockedDataSafe")}</p>
          {identity}
          {actions}
          {notices}
          <Checkbox
            className="mt-[16px]"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            label={t("licenceUi.blockedAcknowledge")}
          />
          <Button
            type="button"
            className="mt-[12px]"
            disabled={!acknowledged}
            onClick={() => setDismissed(true)}
          >
            {t("licenceUi.blockedDismiss")}
          </Button>
        </div>
      </div>
    );
  }

  const tone =
    copy.tone === "warning"
      ? "border-warning bg-warning-soft text-warning-ink"
      : "border-danger bg-danger-soft text-danger-ink";

  return (
    <div
      role="alert"
      className={`mb-[16px] rounded-md border px-[14px] py-[10px] text-[12.5px] ${tone}`}
    >
      <div className="font-semibold">{copy.title}</div>
      <div className="mt-[2px]">{copy.body}</div>
      {transfer}
      {identity}
      {actions}
      {notices}
    </div>
  );
}

/**
 * The check-in outcome, said in Arabic THIS file owns.
 *
 * The main process's own sentence interpolates the raw transport error into
 * Arabic prose — «تعذّر الوصول إلى خدمة التراخيص (fetch failed)…» — and on a
 * shipped install that is the only variant possible. An English `Error` message
 * inside an Arabic sentence is not a message; it is a stack trace with a veil.
 */
function checkinMessage(
  outcome: LicenceCheckinOutcome | null,
  t: (key: AppTranslationKey, vars?: Record<string, string>) => string,
): string | null {
  switch (outcome) {
    case "confirmed":
      return t("licenceUi.checkinConfirmed");
    case "revoked":
      return t("licenceUi.checkinRevoked");
    case "unreachable":
      return t("licenceUi.checkinUnreachable");
    case "unavailable":
      return t("licenceUi.checkinUnavailable");
    default:
      return null;
  }
}

/** The import verdict, stated as the verification found it — plan, seats, expiry. */
function importMessage(
  result:
    | { ok: true; status: { plan: string; seats: number; expiresAt: string | null }; accepted: boolean }
    | { ok: false; code: string; message: string }
    | null,
  t: (key: AppTranslationKey, vars?: Record<string, string>) => string,
): string | null {
  if (result === null) return null;
  if (!result.ok) return result.code === "CANCELLED" ? null : result.message;
  if (!result.accepted) return t("licenceUi.importRefused");
  const expiry = result.status.expiresAt ? result.status.expiresAt.slice(0, 10) : null;
  return expiry
    ? t("licenceUi.importAccepted", {
        plan: result.status.plan,
        seats: String(result.status.seats),
        expiry,
      })
    : t("licenceUi.importAcceptedPerpetual", {
        plan: result.status.plan,
        seats: String(result.status.seats),
      });
}
