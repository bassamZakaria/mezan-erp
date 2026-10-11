import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrandMark,
  Button,
  StatusPill,
  TextInput,
} from "@mezan/ui";
import type { BootstrapSeedResultDTO } from "@mezan/contracts";
import { COMPANY_NAME_MAX_LENGTH } from "@mezan/domain";
import { companyNameError } from "../company-name";
import {
  isDesktopHost,
  useBootstrapSeed,
  useBootstrapStatus,
  useCreateFirstAdmin,
  useDesktopLicence,
} from "../data/hooks";
import { useLicenceImport } from "../data/license-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { PortableImportPanel } from "../settings/PortableImportPanel";

/**
 * The base data one idempotent `POST /bootstrap/seed` creates. Each row's
 * "جاهز" state is the REAL count the server reports, never a local flag —
 * numbering sequences are absent because they are initialised lazily on first
 * use, so there is nothing to seed.
 */
/**
 * The COUNT keys only. `BootstrapSeedResultDTO` also carries `claimed`, which
 * answers "has anybody set this install up" rather than "how many of these
 * exist" — it drives which screen a signed-out visitor lands on, and rendering
 * it as a seed row would print a boolean in a column of quantities.
 */
type SeedCountKey = Exclude<keyof BootstrapSeedResultDTO, "claimed">;

const SEED_ROWS: readonly { key: SeedCountKey; labelKey: AppTranslationKey; hintKey: AppTranslationKey }[] = [
  { key: "accounts", labelKey: "firstRun.chartOfAccounts", hintKey: "firstRun.accountsHint" },
  { key: "taxRates", labelKey: "firstRun.tax", hintKey: "firstRun.taxHint" },
  { key: "fiscalPeriods", labelKey: "firstRun.financialPeriods", hintKey: "firstRun.periodsHint" },
  { key: "branches", labelKey: "firstRun.headBranch", hintKey: "firstRun.branchHint" },
  { key: "warehouses", labelKey: "firstRun.mainWarehouse", hintKey: "firstRun.warehouseHint" },
];

const STEPS = [
  { key: "activate", labelKey: "firstRun.activateTheLicence" },
  { key: "admin", labelKey: "firstRun.administratorAccount" },
  { key: "seed", labelKey: "firstRun.coreData" },
  { key: "import", labelKey: "firstRun.import" },
] as const satisfies readonly { key: string; labelKey: AppTranslationKey }[];

type StepKey = (typeof STEPS)[number]["key"];

export interface FirstRunWizardProps {
  onFinish: () => void;
  onCancel: () => void;
}

function StepIndicator({ currentIndex }: { currentIndex: number }) {
  const { t } = useAppTranslation();
  return (
    <ol className="flex items-center gap-[8px]">
      {STEPS.map((step, index) => {
        const isDone = index < currentIndex;
        const isActive = index === currentIndex;
        return (
          <li key={step.key} className="flex items-center gap-[8px]">
            <span
              className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-[11px] font-bold ${
                isDone
                  ? "bg-brand text-brand-ink"
                  : isActive
                    ? "border-2 border-brand text-brand"
                    : "border border-border text-ink-faint"
              }`}
              aria-hidden
            >
              {isDone ? "✓" : index + 1}
            </span>
            <span className={`text-[12px] font-semibold ${isActive ? "text-ink" : "text-ink-faint"}`}>{t(step.labelKey)}</span>
            {index < STEPS.length - 1 ? <span aria-hidden className="mx-[4px] h-px w-[20px] bg-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * First-run wizard skeleton — docs/archive/catalog/09-settings-dashboard-ux.md
 * (نقل البيانات wizard + Dashboard's `GET /api/dashboard/setup` onboarding
 * checklist) plus the Phase-1 task's step sequence: install the licence →
 * create admin → seed COA/tax/numbering/branch/warehouse → optional import.
 *
 * The licence step is a FILE IMPORT that reports the verification's own verdict.
 * It used to ask for an `XXXX-XXXX-XXXX-XXXX` key the product has never used,
 * call nothing, and paint a green «مُفعّل» pill — so the one moment a new owner
 * is told whether they are licensed was the one moment nothing was checked, and
 * every save afterwards was refused with a 403.
 */
export function FirstRunWizard({ onFinish, onCancel }: FirstRunWizardProps) {
  const { t } = useAppTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const step: StepKey = (STEPS[stepIndex] ?? STEPS[0]).key;

  const seedMutation = useBootstrapSeed();
  const seedStatus = useBootstrapStatus();
  const createAdmin = useCreateFirstAdmin();

  const licence = useDesktopLicence();
  const importLicence = useLicenceImport();
  const licenceStatus = licence.data && licence.data.ok ? licence.data : null;

  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [adminPinConfirm, setAdminPinConfirm] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  /**
   * True when the server said this install already belongs to somebody.
   *
   * `POST /bootstrap/admin` answers a claimed tenant with a bare 409 — it used
   * to hand back the EXISTING admin's session, which was an anonymous
   * takeover. Correct, but the wizard then printed the refusal and STOPPED: the
   * message tells the owner to sign in with their account and the screen gave
   * them no way to. Anyone who got here after an interrupted first run, or by
   * opening the wizard on a machine already set up, was stuck on step 2 with
   * only «رجوع».
   */
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const queryClient = useQueryClient();
  const [adminCreated, setAdminCreated] = useState(false);



  function handleAdminNext() {
    const nameError = companyNameError(companyName, t);
    if (nameError) {
      setAdminError(nameError);
      return;
    }
    if (!adminName.trim() || !adminEmail.trim()) {
      setAdminError(t("firstRun.theFullNameAndThe"));
      return;
    }
    if (!/^\d{6}$/.test(adminPin)) {
      setAdminError(t("firstRun.thePinMustBe4"));
      return;
    }
    if (adminPin !== adminPinConfirm) {
      setAdminError(t("firstRun.thePinAndItsConfirmation"));
      return;
    }
    setAdminError(null);
    if (adminCreated) {
      goNext();
      return;
    }
    // Persist the admin for real and establish their session, then advance.
    createAdmin.mutate(
      { nameAr: adminName.trim(), nameEn: null, email: adminEmail.trim().toLowerCase(), pin: adminPin, companyName: companyName.trim() },
      {
        onSuccess: () => {
          setAdminCreated(true);
          goNext();
        },
        onError: (err) => {
          setAdminError(err.message);
          if (err.status === 409) setAlreadyClaimed(true);
        },
      },
    );
  }

  function runSeed() {
    seedMutation.mutate();
  }

  function goNext() {
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  const counts = seedStatus.data ?? null;
  const allSeeded = counts !== null && SEED_ROWS.every((row) => counts[row.key] > 0);

  /**
   * The verification's own verdict, in the words of the verification. A refusal
   * is the main process's Arabic sentence; an acceptance states the plan, the
   * seats and the expiry the signed payload actually carries, because "activated"
   * on its own is exactly the claim this step used to make and could not back.
   */
  const importResult = importLicence.data ?? null;
  let importVerdict: string | null = null;
  if (importResult && !importResult.ok) {
    importVerdict = importResult.code === "CANCELLED" ? null : importResult.message;
  } else if (importResult) {
    const expiry = importResult.status.expiresAt?.slice(0, 10) ?? null;
    importVerdict = !importResult.accepted
      ? t("licenceUi.importRefused")
      : expiry
        ? t("licenceUi.importAccepted", {
            plan: importResult.status.plan,
            seats: String(importResult.status.seats),
            expiry,
          })
        : t("licenceUi.importAcceptedPerpetual", {
            plan: importResult.status.plan,
            seats: String(importResult.status.seats),
          });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-[24px]">
      <div className="w-full max-w-[640px] rounded-lg border border-border bg-surface p-[28px] shadow-2">
        <div className="mb-[20px] flex items-center gap-[10px]">
          <BrandMark className="h-[28px] w-[28px] text-brand" />
          <div>
            <h1 className="font-display text-[17px] font-bold text-ink">{t("firstRun.firstRunWizard")}</h1>
            <p className="text-[11.5px] text-ink-faint">{t("firstRun.settingMezanUp")}</p>
          </div>
        </div>

        <div className="mb-[22px] overflow-x-auto">
          <StepIndicator currentIndex={stepIndex} />
        </div>

        {step === "activate" ? (
          <section aria-label={t("firstRun.activateTheLicence")}>
            <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.activateTheLicence")}</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("firstRun.licenceFileHint")}</p>
            {!isDesktopHost() ? (
              <p className="mt-[10px] text-[12px] text-ink-muted">{t("licenceUi.importDesktopOnly")}</p>
            ) : licenceStatus && licenceStatus.code === "LIC-OK" ? (
              <p className="mt-[10px] text-[12.5px] text-ink">
                {t("firstRun.licenceCurrent", {
                  plan: licenceStatus.plan,
                  seats: String(licenceStatus.seats),
                })}
              </p>
            ) : (
              <p className="mt-[10px] text-[12.5px] text-ink-muted">{t("firstRun.licenceNone")}</p>
            )}
            <div className="mt-[14px] flex flex-wrap items-center gap-[10px]">
              <Button
                type="button"
                variant="primary"
                disabled={importLicence.isPending || !isDesktopHost()}
                onClick={() => {
                  if (importLicence.isPending) return;
                  importLicence.mutate();
                }}
              >
                {importLicence.isPending ? t("licenceUi.importWorking") : t("licenceUi.import")}
              </Button>
              {/*
                A pill ONLY on a verified verdict. The step it replaces set its
                own status to "done" without calling anything and showed a green
                «مُفعّل», so the new owner was told the licence took and then met
                a 403 on every save.
              */}
              {importLicence.data?.ok && importLicence.data.accepted ? (
                <StatusPill label={t("firstRun.activated2")} tone="success" />
              ) : null}
            </div>
            {importVerdict ? (
              <p
                className={`mt-[10px] text-[12.5px] font-semibold ${
                  importLicence.data?.ok && importLicence.data.accepted
                    ? "text-success-ink"
                    : "text-danger-ink"
                }`}
              >
                {importVerdict}
              </p>
            ) : null}
            {isDesktopHost() ? (
              <div className="mt-[18px] border-t border-border pt-[14px]">
                <PortableImportPanel sessionToken="" firstRun />
              </div>
            ) : null}
          </section>
        ) : null}

        {step === "admin" ? (
          <section aria-label={t("firstRun.createTheAdministratorAccount")}>
            <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.createTheAdministratorAccount")}</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("firstRun.thisAccountWillHoldFull")}</p>
            <div className="mt-[14px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
              <label className="flex flex-col gap-[6px] sm:col-span-2">
                <span className="text-[12.5px] font-semibold text-ink">{t("firstRun.companyName")}</span>
                <TextInput value={companyName} maxLength={COMPANY_NAME_MAX_LENGTH} required onChange={(e) => setCompanyName(e.target.value)} />
                <span className="text-[11px] text-ink-faint">{t("firstRun.companyNameHint")}</span>
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("firstRun.fullName")}</span>
                <TextInput value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("common.email")}</span>
                <TextInput
                  type="email"
                  value={adminEmail}
                  placeholder="admin@example.com"
                  onChange={(e) => setAdminEmail(e.target.value.trim().toLowerCase())}
                />
                <span className="text-[11px] text-ink-faint">{t("firstRun.emailIsTheLoginHint")}</span>
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("firstRun.pin4Digits")}</span>
                <TextInput
                  type="password"
                  numeric
                  inputMode="numeric"
                  maxLength={6}
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("firstRun.confirmThePin")}</span>
                <TextInput
                  type="password"
                  numeric
                  inputMode="numeric"
                  maxLength={6}
                  value={adminPinConfirm}
                  onChange={(e) => setAdminPinConfirm(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            </div>
            {adminError ? (
              <p role="alert" className="mt-[10px] text-[12px] font-semibold text-danger-ink">
                {adminError}
              </p>
            ) : null}
            {alreadyClaimed ? (
              <Button
                type="button"
                variant="primary"
                className="mt-[10px]"
                onClick={() => {
                  // Re-read the claim before leaving: the login screen renders
                  // only once `/bootstrap/status` reports the install claimed,
                  // and this component is what the shell shows while it reports
                  // otherwise. Without the refetch, leaving lands straight back
                  // on this same wizard.
                  void queryClient.invalidateQueries({ queryKey: ["bootstrap", "status"] });
                  onCancel();
                }}
              >
                {t("firstRun.signInInstead")}
              </Button>
            ) : null}
            <p className="mt-[10px] text-[11.5px] text-ink-muted">
              {t("firstRun.thisReallyIsSavedAs")}
            </p>
          </section>
        ) : null}

        {step === "seed" ? (
          <section aria-label={t("firstRun.seedTheCoreData")}>
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.seedTheCoreData")}</h2>
              <Button type="button" size="sm" disabled={seedMutation.isPending} onClick={runSeed}>
                {t("firstRun.runTheSeed")}
              </Button>
            </div>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("firstRun.theChartOfAccountsTax")}</p>
            <ul className="mt-[14px] flex flex-col gap-[8px]">
              {SEED_ROWS.map((row) => {
                const count = counts?.[row.key] ?? 0;
                return (
                  <li key={row.key} className="flex items-center justify-between gap-[12px] rounded-md border border-border p-[10px_12px]">
                    <div>
                      <div className="text-[13px] font-semibold text-ink">{t(row.labelKey)}</div>
                      <div className="mt-[2px] text-[11.5px] text-ink-faint">{t(row.hintKey)}</div>
                    </div>
                    <div className="flex items-center gap-[8px]">
                      <span className="mz-num text-[12px] text-ink-muted">{count}</span>
                      {count > 0 ? <StatusPill label={t("firstRun.ready")} tone="success" /> : <StatusPill label={t("firstRun.notCreated")} tone="neutral" />}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-[10px] text-[11.5px] text-ink-muted">
              {t("firstRun.theSeedReallyRunsAgainst")}
            </p>
          </section>
        ) : null}

        {step === "import" ? (
          <section aria-label={t("firstRun.importData")}>
            <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.importDataOptional")}</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">
              {t("firstRun.youCanImportYourExisting")}
            </p>
            <p className="mt-[10px] text-[11.5px] text-ink-muted">
              {t("firstRun.theFullImportWizardPick")}
            </p>
          </section>
        ) : null}

        <div className="mt-[26px] flex items-center justify-between gap-[12px] border-t border-border pt-[18px]">
          <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-ink-muted hover:text-ink">
            {t("firstRun.cancelAndGoBackTo")}
          </button>
          <div className="flex items-center gap-[10px]">
            {stepIndex > 0 ? (
              <Button type="button" onClick={goBack}>
                {t("common.back")}
              </Button>
            ) : null}
            {step === "activate" ? (
              // Never gated on the licence. A shop without a file yet must still
              // be able to finish setting up and read its data — the write gate
              // is what enforces the licence, not this button.
              <Button type="button" variant="primary" onClick={goNext}>
                {t("firstRun.next")}
              </Button>
            ) : null}
            {step === "admin" ? (
              <Button type="button" variant="primary" onClick={handleAdminNext}>
                {t("firstRun.next")}
              </Button>
            ) : null}
            {step === "seed" ? (
              <Button type="button" variant="primary" disabled={!allSeeded} onClick={goNext}>
                {t("firstRun.next")}
              </Button>
            ) : null}
            {step === "import" ? (
              <Button type="button" variant="primary" onClick={onFinish}>
                {t("firstRun.finishAndGoIntoThe")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
