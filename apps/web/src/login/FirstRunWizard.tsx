import { useState } from "react";
import {
  BrandMark,
  Button,
  StatusPill,
  TextInput,
} from "@mezan/ui";
import type { BootstrapSeedResultDTO } from "@mezan/contracts";
import { useBootstrapSeed, useBootstrapStatus, useCreateFirstAdmin, useTenantInfo } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * The base data one idempotent `POST /bootstrap/seed` creates. Each row's
 * "جاهز" state is the REAL count the server reports, never a local flag —
 * numbering sequences are absent because they are initialised lazily on first
 * use, so there is nothing to seed.
 */
const SEED_ROWS: readonly { key: keyof BootstrapSeedResultDTO; labelKey: AppTranslationKey; hintKey: AppTranslationKey }[] = [
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

function StubNote({ children }: { children: string }) {
  const { t } = useAppTranslation();
  return (
    <div className="mt-[10px] flex items-start gap-[8px] rounded-md border border-dashed border-border bg-surface-2 p-[10px_12px] text-[11.5px] text-ink-muted">
      <StatusPill label={t("firstRun.demo")} tone="info" />
      <span>{children}</span>
    </div>
  );
}

/**
 * First-run wizard skeleton — docs/catalog/09-settings-dashboard-ux.md
 * (نقل البيانات wizard + Dashboard's `GET /api/dashboard/setup` onboarding
 * checklist) plus the Phase-1 task's step sequence: activate license → create
 * admin → seed COA/tax/numbering/branch/warehouse → optional import. Every
 * step action is STUBBED (marked "تجريبي") — no license service, no user
 * persistence, no seeding/import backend is wired yet; this only builds the
 * stepper UX and validation shape those real actions will plug into.
 */
export function FirstRunWizard({ onFinish, onCancel }: FirstRunWizardProps) {
  const { t } = useAppTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const step: StepKey = (STEPS[stepIndex] ?? STEPS[0]).key;

  const seedMutation = useBootstrapSeed();
  const seedStatus = useBootstrapStatus();
  const tenantName = useTenantInfo().data?.name ?? "";
  const createAdmin = useCreateFirstAdmin();

  const [licenseKey, setLicenseKey] = useState("");
  const [activateStatus, setActivateStatus] = useState<"idle" | "activating" | "done">("idle");

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [adminPinConfirm, setAdminPinConfirm] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminCreated, setAdminCreated] = useState(false);


  function handleActivate() {
    setActivateStatus("activating");
    // Stubbed: no license service wired yet (see docs/plan.md §2.5 / packages/domain/src/licensing).
    // Resolves synchronously here purely to drive the demo stepper forward.
    setActivateStatus("done");
  }

  function handleAdminNext() {
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
      { fullName: adminName.trim(), email: adminEmail.trim().toLowerCase(), pin: adminPin },
      {
        onSuccess: () => {
          setAdminCreated(true);
          goNext();
        },
        onError: (err) => setAdminError(err.message),
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-2 p-[24px]">
      <div className="w-full max-w-[640px] rounded-lg border border-border bg-surface p-[28px] shadow-2">
        <div className="mb-[20px] flex items-center gap-[10px]">
          <BrandMark className="h-[28px] w-[28px] text-brand" />
          <div>
            <h1 className="font-display text-[17px] font-bold text-ink">{t("firstRun.firstRunWizard")}</h1>
            <p className="text-[11.5px] text-ink-faint">{t("firstRun.settingMezanUpForA")} {tenantName} {t("firstRun.forTheFirstTime")}</p>
          </div>
        </div>

        <div className="mb-[22px] overflow-x-auto">
          <StepIndicator currentIndex={stepIndex} />
        </div>

        {step === "activate" ? (
          <section aria-label={t("firstRun.activateTheLicence")}>
            <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.activateTheLicence")}</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("firstRun.enterTheLicenceKeyYou")} {tenantName}.</p>
            <label className="mt-[14px] flex flex-col gap-[6px]">
              <span className="text-[12.5px] font-semibold text-ink">{t("firstRun.licenceKey")}</span>
              <TextInput
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className="mz-lat"
              />
            </label>
            <StubNote>{t("firstRun.reallyCallingTheLicenceServer")}</StubNote>
            <div className="mt-[14px] flex items-center gap-[10px]">
              <Button type="button" variant="primary" onClick={handleActivate} disabled={activateStatus === "done"}>
                {activateStatus === "done" ? t("firstRun.activated") : t("firstRun.activate")}
              </Button>
              {activateStatus === "done" ? <StatusPill label={t("firstRun.activated2")} tone="success" /> : null}
            </div>
          </section>
        ) : null}

        {step === "admin" ? (
          <section aria-label={t("firstRun.createTheAdministratorAccount")}>
            <h2 className="font-display text-[15px] font-bold text-ink">{t("firstRun.createTheAdministratorAccount")}</h2>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("firstRun.thisAccountWillHoldFull")}</p>
            <div className="mt-[14px] grid grid-cols-1 gap-[12px] sm:grid-cols-2">
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
              <Button type="button" variant="primary" disabled={activateStatus !== "done"} onClick={goNext}>
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
