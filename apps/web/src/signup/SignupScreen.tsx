import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Money, TextInput } from "@mezan/ui";
import type { BillingCycleDTO, PublicPlanDTO, StartSignupRequestDTO, StartSignupResultDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { COMPANY_NAME_MAX_LENGTH } from "@mezan/contracts";
import { Field, FormError, TextField } from "../settings/form-controls";
import { SignupLayout } from "./SignupLayout";
import { checkCodeAvailability, fetchPublicPlans, SignupApiError, startSignup } from "./signup-api";
import type { AppTranslationKey } from "../i18n";

const TENANT_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

enum SignupField {
  NameAr = "nameAr",
  Code = "code",
  OwnerNameAr = "ownerNameAr",
  OwnerEmail = "ownerEmail",
  Plan = "planId",
}

const FIELD_ORDER: readonly SignupField[] = [SignupField.NameAr, SignupField.Code, SignupField.OwnerNameAr, SignupField.OwnerEmail, SignupField.Plan];

const FIELD_LABEL: Record<SignupField, AppTranslationKey> = {
  [SignupField.NameAr]: "signup.companyNameAr",
  [SignupField.Code]: "signup.tenantCode",
  [SignupField.OwnerNameAr]: "signup.ownerNameAr",
  [SignupField.OwnerEmail]: "signup.ownerEmail",
  [SignupField.Plan]: "signup.error.planField",
};

const FIELD_REQUIRED: Record<SignupField, AppTranslationKey> = {
  [SignupField.NameAr]: "signup.error.nameArRequired",
  [SignupField.Code]: "signup.error.codeRequired",
  [SignupField.OwnerNameAr]: "signup.error.ownerNameRequired",
  [SignupField.OwnerEmail]: "signup.error.ownerEmailRequired",
  [SignupField.Plan]: "signup.error.planRequired",
};

type FieldErrors = Partial<Record<SignupField, string>>;

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const planErrorId = useId();
  const codeErrorId = useId();
  const nameArRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const ownerNameRef = useRef<HTMLInputElement>(null);
  const ownerEmailRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<HTMLDivElement>(null);

  function edit(field: SignupField | null, change: (d: Draft) => Draft) {
    setDraft(change);
    if (field !== null) setFieldErrors((errors) => (errors[field] ? { ...errors, [field]: undefined } : errors));
  }

  function focusField(field: SignupField) {
    const target = {
      [SignupField.NameAr]: nameArRef,
      [SignupField.Code]: codeRef,
      [SignupField.OwnerNameAr]: ownerNameRef,
      [SignupField.OwnerEmail]: ownerEmailRef,
      [SignupField.Plan]: planRef,
    }[field].current;
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const blank: Record<SignupField, boolean> = {
      [SignupField.NameAr]: draft.nameAr.trim() === "",
      [SignupField.Code]: draft.code.trim() === "",
      [SignupField.OwnerNameAr]: draft.ownerNameAr.trim() === "",
      [SignupField.OwnerEmail]: draft.ownerEmail.trim() === "",
      [SignupField.Plan]: draft.planId === "",
    };
    for (const field of FIELD_ORDER) if (blank[field]) errors[field] = t(FIELD_REQUIRED[field]);
    if (!blank[SignupField.Code] && !TENANT_CODE_RE.test(draft.code)) errors[SignupField.Code] = t("signup.tenantCodeInvalid");
    if (!blank[SignupField.OwnerEmail] && !EMAIL_RE.test(draft.ownerEmail.trim())) errors[SignupField.OwnerEmail] = t("signup.error.ownerEmailInvalid");
    return errors;
  }
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
    const errors = validate();
    setFieldErrors(errors);
    const invalid = FIELD_ORDER.filter((field) => errors[field]);
    if (invalid.length > 0) {
      setFormError(t("signup.error.requiredList", { fields: invalid.map((field) => t(FIELD_LABEL[field])).join(t("signup.error.fieldSeparator")) }));
      focusField(invalid[0]!);
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
          <TextField
            label={t("signup.companyNameAr")}
            value={draft.nameAr}
            maxLength={COMPANY_NAME_MAX_LENGTH}
            error={fieldErrors[SignupField.NameAr]}
            inputRef={nameArRef}
            onChange={(v) => edit(SignupField.NameAr, (d) => ({ ...d, nameAr: v }))}
          />
          <TextField
            label={t("signup.companyNameEn")}
            value={draft.nameEn}
            placeholder={t("signup.companyNameEnOptional")}
            onChange={(v) => edit(null, (d) => ({ ...d, nameEn: v }))}
          />
        </div>

        <Field
          label={t("signup.tenantCode")}
          hint={fieldErrors[SignupField.Code] ? undefined : codeHint}
          error={fieldErrors[SignupField.Code] ? <span id={codeErrorId}>{fieldErrors[SignupField.Code]}</span> : undefined}
          htmlFor={codeId}
        >
          <TextInput
            id={codeId}
            ref={codeRef}
            value={draft.code}
            dir="ltr"
            className="mz-lat"
            placeholder="acme"
            invalid={codeStatus === "taken" || codeStatus === "invalid" || Boolean(fieldErrors[SignupField.Code])}
            aria-invalid={fieldErrors[SignupField.Code] ? true : undefined}
            aria-describedby={fieldErrors[SignupField.Code] ? codeErrorId : undefined}
            onChange={(e) => edit(SignupField.Code, (d) => ({ ...d, code: e.target.value.toLowerCase() }))}
            onBlur={handleCodeBlur}
          />
        </Field>

        <div className="grid gap-[12px] sm:grid-cols-2">
          <TextField
            label={t("signup.ownerNameAr")}
            value={draft.ownerNameAr}
            error={fieldErrors[SignupField.OwnerNameAr]}
            inputRef={ownerNameRef}
            onChange={(v) => edit(SignupField.OwnerNameAr, (d) => ({ ...d, ownerNameAr: v }))}
          />
          <TextField
            label={t("signup.ownerEmail")}
            type="email"
            value={draft.ownerEmail}
            error={fieldErrors[SignupField.OwnerEmail]}
            inputRef={ownerEmailRef}
            onChange={(v) => edit(SignupField.OwnerEmail, (d) => ({ ...d, ownerEmail: v }))}
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
            onChange={(e) => edit(null, (d) => ({ ...d, website: e.target.value }))}
          />
        </label>

        <div
          ref={planRef}
          tabIndex={-1}
          role="group"
          aria-label={t("signup.plan")}
          aria-invalid={fieldErrors[SignupField.Plan] ? true : undefined}
          aria-describedby={fieldErrors[SignupField.Plan] ? planErrorId : undefined}
          data-testid="signup-plan-picker"
          className={`rounded-md outline-none ${fieldErrors[SignupField.Plan] ? "border-2 border-danger p-[10px]" : ""}`}
        >
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
                <PlanCard key={plan.id} plan={plan} cycle={draft.billingCycle} selected={draft.planId === plan.id} onSelect={() => edit(SignupField.Plan, (d) => ({ ...d, planId: plan.id }))} />
              ))}
            </div>
          )}
          {fieldErrors[SignupField.Plan] ? (
            <p id={planErrorId} className="mt-[8px] text-[12px] font-semibold text-danger-ink">
              {fieldErrors[SignupField.Plan]}
            </p>
          ) : null}
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
