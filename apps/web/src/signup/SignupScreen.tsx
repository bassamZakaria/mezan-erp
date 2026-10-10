import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Money, TextInput } from "@mezan/ui";
import type { BillingCycleDTO, PublicPlanDTO, StartSignupRequestDTO, StartSignupResultDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { Field, FormError, TextField } from "../settings/form-controls";
import { SignupLayout } from "./SignupLayout";
import { checkCodeAvailability, fetchPublicPlans, SignupApiError, startSignup } from "./signup-api";

const TENANT_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

type CodeStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

interface Draft {
  nameAr: string;
  nameEn: string;
  code: string;
  ownerNameAr: string;
  ownerEmail: string;
  planId: string;
  billingCycle: BillingCycleDTO;
  /** Honeypot — a real visitor never sees or fills this field. */
  website: string;
}

function emptyDraft(): Draft {
  return { nameAr: "", nameEn: "", code: "", ownerNameAr: "", ownerEmail: "", planId: "", billingCycle: "monthly", website: "" };
}

function PlanCard({
  plan,
  cycle,
  selected,
  onSelect,
}: {
  plan: PublicPlanDTO;
  cycle: BillingCycleDTO;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useAppTranslation();
  const price = cycle === "monthly" ? plan.priceMonthly : plan.priceYearly;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-w-0 flex-1 flex-col gap-[6px] rounded-md border p-[14px] text-start transition-colors ${
        selected ? "border-accent-strong bg-accent-soft" : "border-border bg-surface hover:bg-surface-2"
      }`}
    >
      <span className="font-display text-[14px] font-bold text-ink">{plan.nameAr}</span>
      <span className="text-[11px] text-ink-muted">{plan.nameEn}</span>
      <span className="mt-[4px] flex items-baseline gap-[4px]">
        <Money value={Number(price)} />
        <span className="text-[11px] text-ink-muted">/{cycle === "monthly" ? t("platform.billingCycle.monthly") : t("platform.billingCycle.yearly")}</span>
      </span>
      {plan.trialDays > 0 ? (
        <span className="text-[11px] font-semibold text-accent-strong">{t("signup.plan.trialDays", { days: String(plan.trialDays) })}</span>
      ) : null}
    </button>
  );
}

function SuccessPanel({ result, email }: { result: StartSignupResultDTO; email: string }) {
  const { t } = useAppTranslation();
  return (
    <Card className="flex flex-col gap-[14px] p-[22px]">
      <h1 className="font-display text-lg font-bold text-ink">{t("signup.success.title")}</h1>
      <p className="text-[13px] text-ink-muted">{t("signup.success.body", { email })}</p>
      {result.devVerifyUrl ? (
        <div className="flex flex-col gap-[10px] rounded-md border-2 border-dashed border-warning-ink bg-surface-2 p-[14px]">
          <p className="text-[12px] font-bold text-warning-ink">{t("signup.success.devLabel")}</p>
          <a href={result.devVerifyUrl} className="mz-lat break-all text-[12.5px] font-semibold text-accent-strong underline" dir="ltr">
            {result.devVerifyUrl}
          </a>
        </div>
      ) : null}
      <a href="/" className="text-[12.5px] font-semibold text-accent-strong hover:underline">
        {t("signup.footer.backHome")}
      </a>
    </Card>
  );
}

export function SignupScreen() {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [codeStatus, setCodeStatus] = useState<CodeStatus>("idle");
  const codeId = useId();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<StartSignupResultDTO | null>(null);

  const plansQuery = useQuery<PublicPlanDTO[]>({ queryKey: ["signup", "plans"], queryFn: fetchPublicPlans });

  async function handleCodeBlur() {
    const code = draft.code.trim().toLowerCase();
    setDraft((d) => ({ ...d, code }));
    if (code === "") {
      setCodeStatus("idle");
      return;
    }
    if (!TENANT_CODE_RE.test(code)) {
      setCodeStatus("invalid");
      return;
    }
    setCodeStatus("checking");
    const available = await checkCodeAvailability(code);
    setCodeStatus(available === null ? "unknown" : available ? "available" : "taken");
  }

  async function handleSubmit() {
    setFormError(null);
    if (
      draft.nameAr.trim() === "" ||
      draft.code.trim() === "" ||
      draft.ownerNameAr.trim() === "" ||
      draft.ownerEmail.trim() === "" ||
      draft.planId === ""
    ) {
      setFormError(t("signup.error.required"));
      return;
    }
    if (!TENANT_CODE_RE.test(draft.code)) {
      setFormError(t("signup.tenantCodeInvalid"));
      return;
    }
    const body: StartSignupRequestDTO = {
      code: draft.code,
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      ownerEmail: draft.ownerEmail.trim().toLowerCase(),
      ownerNameAr: draft.ownerNameAr.trim(),
      planId: draft.planId,
      billingCycle: draft.billingCycle,
      website: draft.website,
    };
    setSubmitting(true);
    try {
      setResult(await startSignup(body));
    } catch (err) {
      setFormError(err instanceof SignupApiError ? err.message : t("signup.error.generic"));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <SignupLayout>
        <SuccessPanel result={result} email={draft.ownerEmail} />
      </SignupLayout>
    );
  }

  const plans = plansQuery.data ?? [];
  const codeHint =
    codeStatus === "checking"
      ? t("signup.tenantCode.checking")
      : codeStatus === "available"
        ? t("signup.tenantCode.available")
        : codeStatus === "taken"
          ? t("signup.tenantCodeTaken")
          : codeStatus === "invalid"
            ? t("signup.tenantCodeInvalid")
            : t("signup.tenantCodeHint");

  return (
    <SignupLayout>
      <Card className="flex flex-col gap-[16px] p-[22px]">
        <div>
          <h1 className="font-display text-lg font-bold text-ink">{t("signup.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("signup.subtitle")}</p>
        </div>
        <FormError message={formError} />

        <div className="grid gap-[12px] sm:grid-cols-2">
          <TextField label={t("signup.companyNameAr")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField
            label={t("signup.companyNameEn")}
            value={draft.nameEn}
            placeholder={t("signup.companyNameEnOptional")}
            onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
          />
        </div>

        <Field label={t("signup.tenantCode")} hint={codeHint} htmlFor={codeId}>
          <TextInput
            id={codeId}
            value={draft.code}
            dir="ltr"
            className="mz-lat"
            placeholder="acme"
            invalid={codeStatus === "taken" || codeStatus === "invalid"}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toLowerCase() }))}
            onBlur={handleCodeBlur}
          />
        </Field>

        <div className="grid gap-[12px] sm:grid-cols-2">
          <TextField label={t("signup.ownerNameAr")} value={draft.ownerNameAr} onChange={(v) => setDraft((d) => ({ ...d, ownerNameAr: v }))} />
          <TextField
            label={t("signup.ownerEmail")}
            type="email"
            value={draft.ownerEmail}
            onChange={(v) => setDraft((d) => ({ ...d, ownerEmail: v }))}
          />
        </div>

        {/* Honeypot: visually hidden, off the tab order, and never something a
            sighted human fills in — a filled value marks the submission as a
            bot and it is dropped server-side (`signup-routes.ts`). */}
        <label className="absolute h-px w-px overflow-hidden opacity-0" aria-hidden="true" tabIndex={-1}>
          {t("signup.honeypotLabel")}
          <TextInput
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={draft.website}
            onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))}
          />
        </label>

        <div>
          <span className="mb-[8px] block text-xs font-semibold text-ink">{t("signup.plan")}</span>
          <div className="mb-[10px] inline-flex rounded-md border border-border p-[2px]">
            {(["monthly", "yearly"] as const).map((cycle) => (
              <button
                key={cycle}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, billingCycle: cycle }))}
                className={`rounded-[5px] px-[12px] py-[5px] text-[12px] font-semibold transition-colors ${
                  draft.billingCycle === cycle ? "bg-accent-strong text-accent-ink" : "text-ink-muted"
                }`}
              >
                {cycle === "monthly" ? t("platform.billingCycle.monthly") : t("platform.billingCycle.yearly")}
              </button>
            ))}
          </div>
          {plansQuery.isLoading ? (
            <p className="text-[12px] text-ink-muted">{t("common.loading")}</p>
          ) : plansQuery.isError ? (
            <p role="alert" className="text-[12px] font-semibold text-danger-ink">
              {t("signup.error.plansFailed")}
            </p>
          ) : (
            <div className="flex flex-col gap-[10px] sm:flex-row">
              {plans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} cycle={draft.billingCycle} selected={draft.planId === plan.id} onSelect={() => setDraft((d) => ({ ...d, planId: plan.id }))} />
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] text-ink-faint">{t("signup.afterTrialNote")}</p>

        <Button variant="primary" className="w-full" disabled={submitting} onClick={handleSubmit}>
          {submitting ? t("signup.submitting") : t("signup.submit")}
        </Button>

        <p className="text-center text-[12px] text-ink-muted">
          {t("signup.footer.haveAccount")} <a href="/" className="font-semibold text-accent-strong hover:underline">{t("signup.footer.signIn")}</a>
        </p>
      </Card>
    </SignupLayout>
  );
}
