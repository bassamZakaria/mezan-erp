import { useEffect, useState } from "react";
import { Button, Card, MoneyStringInput, Select, Switch, TextArea, TextInput } from "@mezan/ui";
import { DunningChannelDTO, type DunningPolicyDTO, type DunningStepDTO } from "@mezan/contracts";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useDunningPolicy, useUpdateDunningPolicy } from "./hooks";

const CHANNELS: readonly DunningChannelDTO[] = [DunningChannelDTO.Email, DunningChannelDTO.WhatsApp, DunningChannelDTO.Call, DunningChannelDTO.Sms];
const MAX_STEPS = 8;
const NEW_STEP_DAYS = 90;

interface StepDraft extends DunningStepDTO {
  readonly daysText: string;
}

function toDraft(step: DunningStepDTO): StepDraft {
  return { ...step, daysText: String(step.daysOverdue) };
}

function PolicyEditor({ policy, mayManage }: { policy: DunningPolicyDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const save = useUpdateDunningPolicy();
  const [steps, setSteps] = useState<StepDraft[]>(() => policy.steps.map(toDraft));
  const [minimum, setMinimum] = useState(policy.minimumOverdueAmount);
  const [pauseOnPromise, setPauseOnPromise] = useState(policy.pauseWhilePromisePending);
  const [autoSend, setAutoSend] = useState(policy.autoSendEnabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSteps(policy.steps.map(toDraft));
    setMinimum(policy.minimumOverdueAmount);
    setPauseOnPromise(policy.pauseWhilePromisePending);
    setAutoSend(policy.autoSendEnabled);
  }, [policy]);

  function patch(index: number, change: Partial<StepDraft>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...change } : step)));
    setSaved(false);
  }

  function addStep() {
    setSteps((current) => [
      ...current,
      {
        stepKey: `step-${Date.now().toString(36)}`,
        level: current.length + 1,
        daysOverdue: NEW_STEP_DAYS,
        daysText: String(NEW_STEP_DAYS),
        channel: DunningChannelDTO.Email,
        subjectAr: "",
        subjectEn: null,
        bodyAr: "",
        bodyEn: null,
        active: true,
      },
    ]);
    setSaved(false);
  }

  function submit() {
    if (save.isPending) return;
    setError(null);
    setSaved(false);
    save.mutate(
      {
        steps: steps.map((step) => ({
          stepKey: step.stepKey,
          daysOverdue: Number.parseInt(step.daysText, 10) || 0,
          channel: step.channel,
          subjectAr: step.subjectAr,
          subjectEn: step.subjectEn && step.subjectEn.trim() !== "" ? step.subjectEn : null,
          bodyAr: step.bodyAr,
          bodyEn: step.bodyEn && step.bodyEn.trim() !== "" ? step.bodyEn : null,
          active: step.active,
        })),
        autoSendEnabled: autoSend,
        minimumOverdueAmount: minimum,
        pauseWhilePromisePending: pauseOnPromise,
      },
      { onSuccess: () => setSaved(true), onError: (err) => setError(errorMessage(err, t("collections.policy.saveFailed"))) },
    );
  }

  const placeholders = policy.placeholders.map((name) => `{{${name}}}`).join("  ");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {policy.isDefault ? <div className="text-[12.5px] text-ink-muted">{t("collections.policy.default")}</div> : null}
      {!mayManage ? <div className="text-[12.5px] text-ink-muted">{t("collections.policy.stepsReadOnly")}</div> : null}

      <Card className="flex flex-col gap-4 p-[16px_18px]">
        <div>
          <div className="text-[14px] font-semibold text-ink">{t("collections.policy.stepsTitle")}</div>
          <div className="text-[12px] text-ink-faint">{t("collections.policy.stepsHint")}</div>
          <div className="mt-1 text-[11.5px] text-ink-faint" dir="ltr">
            {t("collections.policy.placeholders", { list: placeholders })}
          </div>
        </div>
        <fieldset disabled={!mayManage} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {steps.map((step, index) => (
            <div key={step.stepKey} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[13px] font-semibold text-ink">{t("collections.policy.stepLevel", { level: index + 1 })}</div>
                <div className="flex items-center gap-3">
                  <Switch checked={step.active} onChange={(active) => patch(index, { active })} label={t("collections.policy.active")} />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t("collections.policy.removeStep", { level: index + 1 })}
                    onClick={() => {
                      setSteps((current) => current.filter((_, i) => i !== index));
                      setSaved(false);
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("collections.policy.daysOverdue")} htmlFor={`days-${step.stepKey}`}>
                  <TextInput id={`days-${step.stepKey}`} numeric inputMode="numeric" value={step.daysText} onChange={(e) => patch(index, { daysText: e.target.value })} />
                </Field>
                <Field label={t("collections.policy.channel")} htmlFor={`channel-${step.stepKey}`}>
                  <Select
                    id={`channel-${step.stepKey}`}
                    value={step.channel}
                    onChange={(value) => patch(index, { channel: value as DunningChannelDTO })}
                    options={CHANNELS.map((channel) => ({
                      value: channel,
                      label: t(`collections.channel.${channel}` as AppTranslationKey),
                      disabled: channel === DunningChannelDTO.Sms,
                    }))}
                  />
                  {step.channel === DunningChannelDTO.Sms ? <span className="text-[11.5px] text-danger-ink">{t("collections.policy.smsNeedsProvider")}</span> : null}
                </Field>
                <Field label={t("collections.policy.subjectAr")} htmlFor={`subject-ar-${step.stepKey}`}>
                  <TextInput id={`subject-ar-${step.stepKey}`} value={step.subjectAr} onChange={(e) => patch(index, { subjectAr: e.target.value })} />
                </Field>
                <Field label={t("collections.policy.subjectEn")} htmlFor={`subject-en-${step.stepKey}`}>
                  <TextInput id={`subject-en-${step.stepKey}`} dir="ltr" value={step.subjectEn ?? ""} onChange={(e) => patch(index, { subjectEn: e.target.value })} />
                </Field>
                <Field label={t("collections.policy.bodyAr")} htmlFor={`body-ar-${step.stepKey}`}>
                  <TextArea id={`body-ar-${step.stepKey}`} rows={6} value={step.bodyAr} onChange={(e) => patch(index, { bodyAr: e.target.value })} />
                </Field>
                <Field label={t("collections.policy.bodyEn")} htmlFor={`body-en-${step.stepKey}`}>
                  <TextArea id={`body-en-${step.stepKey}`} rows={6} dir="ltr" value={step.bodyEn ?? ""} onChange={(e) => patch(index, { bodyEn: e.target.value })} />
                </Field>
              </div>
            </div>
          ))}
          {steps.length < MAX_STEPS ? (
            <div>
              <Button type="button" size="sm" onClick={addStep}>
                {t("collections.policy.addStep")}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </Card>

      <Card className="flex flex-col gap-4 p-[16px_18px]">
        <fieldset disabled={!mayManage} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          <Field label={t("collections.policy.minimum")} htmlFor="policy-minimum">
            <MoneyStringInput id="policy-minimum" value={minimum} onChange={(value) => { setMinimum(value); setSaved(false); }} />
          </Field>
          <Switch checked={pauseOnPromise} onChange={(value) => { setPauseOnPromise(value); setSaved(false); }} label={t("collections.policy.pauseOnPromise")} />
          <div>
            <Switch checked={autoSend} onChange={(value) => { setAutoSend(value); setSaved(false); }} label={t("collections.policy.autoSend")} />
            <div className="mt-1 text-[11.5px] text-ink-faint">{t("collections.policy.autoSendHint")}</div>
          </div>
        </fieldset>
      </Card>

      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {saved ? <div className="text-[12.5px] text-success-ink">{t("collections.policy.saved")}</div> : null}
      {mayManage ? (
        <div>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {t("collections.policy.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function PolicyTab({ mayManage }: { mayManage: boolean }) {
  const { t } = useAppTranslation();
  const query = useDunningPolicy();
  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError || !query.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error?.message ?? t("collections.policy.loadFailed")}
      </Card>
    );
  }
  return <PolicyEditor policy={query.data} mayManage={mayManage} />;
}
