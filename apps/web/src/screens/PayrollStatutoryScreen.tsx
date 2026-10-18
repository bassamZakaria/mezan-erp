import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, EmptyState, SidePanel, StatusPill } from "@mezan/ui";
import { TextField, ToggleField } from "../settings/form-controls";
import { ApiError } from "../data/hooks";
import { useApi } from "../data/ApiContext";
import {
  usePayrollStatutoryFlag,
  useRemoveInsuranceYear,
  useSaveInsuranceYear,
  useSetPayrollStatutoryFlag,
  useStatutoryTables,
} from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useConfirmAction } from "../lib/use-confirm-action";

/**
 * الجداول القانونية للرواتب — what payroll computes against, whether each figure
 * has been checked against the law, and the switch that lets payroll use them.
 */

const SHARE_LABEL: Readonly<Record<string, AppTranslationKey>> = {
  pension: "statutory.share.pension",
  end_of_service: "statutory.share.end_of_service",
  sickness: "statutory.share.sickness",
  unemployment: "statutory.share.unemployment",
  work_injury: "statutory.share.work_injury",
  martyrs_fund: "statutory.levy.martyrs_fund",
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card className="mb-[18px] p-[18px_20px]">
      <h2 className="font-display text-[14px] font-bold text-ink">{title}</h2>
      {hint ? <p className="mt-[4px] text-[12.5px] leading-relaxed text-ink-muted">{hint}</p> : null}
      <div className="mt-[12px]">{children}</div>
    </Card>
  );
}

function Citation({ text, source, verified }: { text: string; source: string; verified: boolean }) {
  const { t } = useAppTranslation();
  return (
    <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
      {verified ? null : <StatusPill label={t("statutory.unverified")} tone="warning" />}
      <p lang="ar" dir="rtl" className="text-[11.5px] leading-relaxed text-ink-faint">
        {text}
      </p>
      <p className="mz-num min-w-0 max-w-full text-[11px] text-ink-faint [overflow-wrap:anywhere]" dir="ltr">
        {source}
      </p>
    </div>
  );
}

function StatutorySwitch() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const flag = usePayrollStatutoryFlag();
  const setFlag = useSetPayrollStatutoryFlag();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = session?.permissions.includes("*") === true;
  const state = flag.data;

  async function apply(enabled: boolean) {
    setError(null);
    try {
      await setFlag.mutateAsync({ enabled, acknowledged: enabled ? acknowledged : undefined });
      setOpen(false);
      setAcknowledged(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("statutory.couldNotSwitch"));
    }
  }

  return (
    <Card className="mb-[18px] p-[18px_20px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <h2 className="font-display text-[14px] font-bold text-ink">{t("statutory.switchTitle")}</h2>
          <p className="mt-[4px] text-[12.5px] leading-relaxed text-ink-muted">{t("statutory.switchBody")}</p>
        </div>
        <StatusPill label={state?.enabled ? t("statutory.switchOn") : t("statutory.switchOff")} tone={state?.enabled ? "warning" : "neutral"} />
      </div>
      {state?.changedAt ? (
        <p className="mz-num mt-[6px] text-[11.5px] text-ink-faint">
          {t("statutory.switchChanged", { by: state.changedBy ?? "", at: state.changedAt.slice(0, 10) })}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="mt-[12px]">
        {state?.enabled ? (
          <Button disabled={!isAdmin || setFlag.isPending} onClick={() => void apply(false)}>
            {t("statutory.switchDisable")}
          </Button>
        ) : (
          <Button variant="primary" disabled={!isAdmin || !state} onClick={() => setOpen(true)}>
            {t("statutory.switchEnable")}
          </Button>
        )}
        {!isAdmin ? <span className="ms-[10px] text-[11.5px] text-ink-faint">{t("statutory.switchAdminOnly")}</span> : null}
      </div>

      <SidePanel open={open} onClose={() => setOpen(false)} title={t("statutory.switchEnable")}>
        <div className="flex flex-col gap-[14px]">
          <p className="text-[12.5px] leading-relaxed text-ink">{t("statutory.acknowledgementBody")}</p>
          {state && state.unverifiedTableCodes.length > 0 ? (
            <ul className="mz-num flex flex-wrap gap-[6px]" dir="ltr">
              {state.unverifiedTableCodes.map((code) => (
                <li key={code} className="rounded-full border border-warning px-[8px] py-[2px] text-[11px] text-warning-ink">
                  {code}
                </li>
              ))}
            </ul>
          ) : null}
          <ToggleField label={t("statutory.acknowledgement")} checked={acknowledged} onChange={setAcknowledged} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!acknowledged || setFlag.isPending} onClick={() => void apply(true)}>
              {t("statutory.switchEnable")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </Card>
  );
}

export function PayrollStatutoryScreen() {
  const { t } = useAppTranslation();
  const shareLabel = (share: { readonly code: string; readonly labelAr: string }) => {
    const key = SHARE_LABEL[share.code];
    return key ? t(key) : share.labelAr;
  };
  const query = useStatutoryTables();
  const saveYear = useSaveInsuranceYear();
  const removeYear = useRemoveInsuranceYear();
  const confirm = useConfirmAction();

  const [formOpen, setFormOpen] = useState(false);
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const [floor, setFloor] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [removingYear, setRemovingYear] = useState<number | null>(null);

  const tables = query.data;
  const overrides = useMemo(() => tables?.insuranceYearOverrides ?? [], [tables]);
  const overrideYears = useMemo(() => new Set(overrides.map((o) => o.year)), [overrides]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsedYear = Number.parseInt(year, 10);
    if (!Number.isInteger(parsedYear) || floor.trim() === "" || ceiling.trim() === "") {
      setFormError(t("statutory.yearFloorAndCeilingRequired"));
      return;
    }
    setFormError(null);
    try {
      await saveYear.mutateAsync({
        year: parsedYear,
        monthlyWageFloor: floor.trim(),
        monthlyWageCeiling: ceiling.trim(),
        note: note.trim() === "" ? null : note.trim(),
      });
      setFormOpen(false);
      setFloor("");
      setCeiling("");
      setNote("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("statutory.couldNotSaveYear"));
    }
  }

  function remove(y: number) {
    if (removingYear !== null) return;
    confirm.ask({
      title: t("statutory.removeYearTitle"),
      consequence: t("statutory.removeYearBody", { year: String(y) }),
      confirmLabel: t("statutory.removeYear"),
      onConfirm: async () => {
        setRemovingYear(y);
        try {
          await removeYear.mutateAsync(y);
        } finally {
          setRemovingYear(null);
        }
      },
    });
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("statutory.couldNotLoad")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  if (!tables) {
    return <EmptyState title={t("common.loading")} description={t("statutory.loadingBody")} />;
  }

  return (
    <div className="w-full">
      <div className="mb-[18px]">
        <h1 className="font-display text-[18px] font-bold text-ink">{t("statutory.title")}</h1>
        <p className="mt-[4px] text-[12.5px] leading-relaxed text-ink-muted">{t("statutory.description")}</p>
      </div>

      <StatutorySwitch />

      <Section title={t("statutory.insuranceLimits")} hint={t("statutory.insuranceLimitsHint")}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-start text-ink-muted">
                <th className="p-[6px] text-start">{t("statutory.year")}</th>
                <th className="p-[6px] text-start">{t("statutory.floor")}</th>
                <th className="p-[6px] text-start">{t("statutory.ceiling")}</th>
                <th className="p-[6px] text-start">{t("statutory.employeeShare")}</th>
                <th className="p-[6px] text-start">{t("statutory.employerShare")}</th>
                <th className="p-[6px] text-start">{t("statutory.source")}</th>
                <th className="p-[6px] text-start">{t("statutory.verification")}</th>
                <th className="p-[6px]" />
              </tr>
            </thead>
            <tbody>
              {tables.socialInsurance.map((row) => {
                const rowYear = Number.parseInt(row.effectiveFrom.slice(0, 4), 10);
                const entered = row.code.endsWith("_OVERRIDE");
                return (
                  <tr key={row.code} className="border-b border-border">
                    <td className="mz-num p-[6px] font-semibold text-ink">{rowYear}</td>
                    <td className="mz-num p-[6px]">{row.monthlyWageFloor ?? t("statutory.notPublished")}</td>
                    <td className="mz-num p-[6px]">{row.monthlyWageCeiling ?? t("statutory.notPublished")}</td>
                    <td className="mz-num p-[6px]">{row.employeeTotalPercent}%</td>
                    <td className="mz-num p-[6px]">{row.employerTotalPercent}%</td>
                    <td className="p-[6px]">
                      <StatusPill label={entered ? t("statutory.enteredByAdmin") : t("statutory.shippedWithApp")} tone={entered ? "warning" : "neutral"} />
                    </td>
                    <td className="p-[6px]">
                      {row.verified ? <StatusPill label={t("statutory.verified")} tone="success" /> : <StatusPill label={t("statutory.unverified")} tone="warning" />}
                    </td>
                    <td className="p-[6px] text-end">
                      {entered ? (
                        <Button size="sm" variant="danger-outline" disabled={removingYear === rowYear} onClick={() => remove(rowYear)}>
                          {t("statutory.removeYear")}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-[12px] flex flex-wrap items-center gap-[10px]">
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            {t("statutory.addYear")}
          </Button>
          <span className="text-[11.5px] text-ink-faint">{t("statutory.addYearHint")}</span>
        </div>
        <ul className="mt-[12px] flex flex-col gap-[6px] text-[11.5px] text-ink-muted">
          {tables.socialInsurance.map((row) => (
            <li key={`${row.code}-shares`}>
              <span className="mz-num font-semibold text-ink">{row.effectiveFrom.slice(0, 4)}</span> — {t("statutory.employeeShare")}:{" "}
              {row.employeeShares.map((sh) => `${shareLabel(sh)} ${sh.ratePercent}%`).join(" · ")} · {t("statutory.employerShare")}:{" "}
              {row.employerShares.map((sh) => `${shareLabel(sh)} ${sh.ratePercent}%`).join(" · ")}
              <Citation text={row.citationAr} source={row.source} verified={row.verified} />
            </li>
          ))}
        </ul>
      </Section>

      {tables.incomeTax.map((table) => (
        <Section key={table.code} title={t("statutory.incomeTaxBrackets")} hint={t("statutory.incomeTaxHint")}>
          <p className="mb-[10px] text-[12.5px] text-ink">
            {t("statutory.annualPersonalExemption")}: <span className="mz-num font-semibold">{table.annualPersonalExemption}</span> ·{" "}
            {t("statutory.disabilityExemption")}: <span className="mz-num font-semibold">×{Number(table.disabilityExemptionMultiplierPercent) / 100}</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[6px] text-start">{t("statutory.annualBand")}</th>
                  <th className="p-[6px] text-start">{t("statutory.rate")}</th>
                </tr>
              </thead>
              <tbody>
                {table.brackets.map((bracket, index) => {
                  const lower = index === 0 ? "0" : (table.brackets[index - 1]?.upToAnnual ?? "0");
                  return (
                    <tr key={`${table.code}-${index}`} className="border-b border-border">
                      <td className="mz-num p-[6px]">{bracket.upToAnnual === null ? `${lower} ${t("statutory.andAbove")}` : `${lower} — ${bracket.upToAnnual}`}</td>
                      <td className="mz-num p-[6px] font-semibold text-ink">{bracket.ratePercent}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {table.eliminationTiers.length > 0 ? (
            <div className="mt-[12px]">
              <h3 className="font-display text-[12.5px] font-bold text-ink">{t("statutory.bracketElimination")}</h3>
              <p className="mt-[3px] text-[11.5px] leading-relaxed text-ink-muted">{t("statutory.bracketEliminationHint")}</p>
              <ul className="mt-[6px] flex flex-col gap-[3px] text-[12px] text-ink-muted">
                {table.eliminationTiers.map((tier) => (
                  <li key={tier.aboveAnnual} className="mz-num">
                    {tier.aboveAnnual}
                    {tier.upToAnnual ? ` — ${tier.upToAnnual}` : ` ${t("statutory.andAbove")}`}: {t("statutory.dropsLowest", { count: String(tier.dropsLowestBrackets) })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Citation text={table.citationAr} source={table.source} verified={table.verified} />
        </Section>
      ))}

      {tables.overtime
        .filter((table) => table.effectiveTo === null)
        .map((table) => (
          <Section key={table.code} title={t("statutory.overtimePremiums")}>
            <ul className="flex flex-col gap-[4px] text-[12.5px] text-ink">
              <li>
                {t("statutory.dayPremium")}: <span className="mz-num font-semibold">{table.dayPremiumPercent}%</span>
              </li>
              <li>
                {t("statutory.nightPremium")}: <span className="mz-num font-semibold">{table.nightPremiumPercent}%</span>
              </li>
              <li>
                {t("statutory.restDayPremium")}: <span className="mz-num font-semibold">{table.restDayExtraDayWagePercent}%</span> {t("statutory.ofDayWage")}
              </li>
              <li>
                {t("statutory.holidayPremium")}: <span className="mz-num font-semibold">{table.holidayExtraDayWagePercent}%</span> {t("statutory.ofDayWage")}
              </li>
              <li>
                {t("statutory.replacementRestDayWithin")}: <span className="mz-num font-semibold">{table.restDayReplacementWithinDays}</span>
              </li>
              <li>
                {t("statutory.holidaySubstituteDay")}: <span className="font-semibold">{t(table.holidaySubstituteDayAllowed ? "statutory.allowed" : "statutory.notAllowed")}</span>
              </li>
              <li>
                {t("statutory.standardHours")}: <span className="mz-num font-semibold">{table.standardDailyHours}</span> /{" "}
                <span className="mz-num font-semibold">{table.standardWeeklyHours}</span>
              </li>
            </ul>
            <Citation text={table.citationAr} source={table.source} verified={table.verified} />
          </Section>
        ))}

      {tables.endOfService.map((table) => (
        <Section key={table.code} title={t("statutory.endOfServiceTiers")}>
          <ul className="flex flex-col gap-[4px] text-[12.5px] text-ink">
            {table.tiers.map((tier, index) => (
              <li key={index} className="mz-num">
                {tier.throughYears === null ? t("statutory.afterThat") : `${t("statutory.throughYear")} ${tier.throughYears}`}: {tier.monthsPerYear}{" "}
                {t("statutory.monthsPerYear")}
              </li>
            ))}
            <li>
              {t("statutory.gratuityCondition", { age: String(table.minimumAge) })}
            </li>
            <li>
              {t("statutory.minimumAnnualRaise")}: <span className="mz-num font-semibold">{table.minimumAnnualRaisePercent}%</span>
            </li>
          </ul>
          <Citation text={table.citationAr} source={table.source} verified={table.verified} />
        </Section>
      ))}

      {tables.levies.map((table) => (
        <Section key={table.code} title={t("statutory.levies")}>
          <ul className="flex flex-col gap-[4px] text-[12.5px] text-ink">
            {table.levies.map((levy) => (
              <li key={levy.code}>
                {shareLabel(levy)}: <span className="mz-num font-semibold">{levy.ratePercent}%</span>
                {levy.exemptPayBases.includes("daily") ? <span className="ms-[8px] text-ink-muted">{t("statutory.dailyExempt")}</span> : null}
              </li>
            ))}
          </ul>
          <Citation text={table.citationAr} source={table.source} verified={table.verified} />
        </Section>
      ))}

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("statutory.addYear")}>
        <form onSubmit={submit} className="flex flex-col gap-[14px]">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">{t("statutory.addYearBody")}</p>
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label={t("statutory.year")} value={year} onChange={setYear} />
          {overrideYears.has(Number.parseInt(year, 10)) ? (
            <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12px] text-warning-ink">
              {t("statutory.yearAlreadyEntered")}
            </div>
          ) : null}
          <TextField label={t("statutory.floor")} value={floor} onChange={setFloor} hint={t("statutory.floorHint")} />
          <TextField label={t("statutory.ceiling")} value={ceiling} onChange={setCeiling} hint={t("statutory.ceilingHint")} />
          <TextField label={t("statutory.decreeNote")} value={note} onChange={setNote} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={saveYear.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>

      {confirm.dialog}
    </div>
  );
}
